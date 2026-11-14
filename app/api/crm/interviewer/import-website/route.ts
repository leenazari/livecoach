import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { requireInterviewerOwner, interviewerOwnerError } from "@/lib/interviewer/access";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import {
  htmlToText,
  isBlockedAddress,
  pickInternalLinks,
  robotsAllows,
} from "@/lib/interviewer/website-pages";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USER_AGENT = "LiveCoachInterviewer/1.0";

type Draft = { title: string; body: string };

async function assertPublicUrl(target: URL): Promise<string | null> {
  if (target.protocol !== "http:" && target.protocol !== "https:") return "Use a public http or https address.";
  const host = target.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return "That address is not a public website.";
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((item) => item.address);
  if (addresses.some((address) => isBlockedAddress(address))) return "That address is not a public website.";
  return null;
}

async function readPage(target: URL, timeoutMs: number, hops = 0): Promise<{ url: string; html: string } | null> {
  if (hops > 3) return null;
  const blocked = await assertPublicUrl(target);
  if (blocked) return null;
  const response = await fetch(target, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (response.status >= 300 && response.status < 400) {
    const next = response.headers.get("location");
    if (!next) return null;
    return readPage(new URL(next, target), timeoutMs, hops + 1);
  }
  if (!response.ok) return null;
  const type = response.headers.get("content-type") || "";
  if (type && !type.includes("html") && !type.includes("text")) return null;
  return { url: target.toString(), html: await response.text() };
}

async function draftNotes(pages: Array<{ url: string; text: string }>): Promise<Draft[]> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("not_configured");
  const source = pages.map((page) => `PAGE ${page.url}\n${page.text}`).join("\n\n").slice(0, 24000);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Turn website text into voice-agent knowledge. Return JSON {"documents":[{"title":"","body":""}]}.
Use only these titles, and omit a title when the pages do not state it: business summary; products and services; pricing exactly as stated; who it's for; FAQs and objections; booking and next step.
Never invent facts, prices, names, or numbers. Leave missing sections out.
Write short plain sentences. Use lines that start with "- " for separate facts. Write prices the way they are spoken, and also keep the figure, for example "forty nine pounds a month (£49)".
No markdown headings, no tables, no links. Each body must be under 1500 characters.
End every body with one line: Source: and the page addresses you used, and say not to read the addresses aloud.`,
        },
        { role: "user", content: source },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error("draft_failed");
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content) as { documents?: Array<{ title?: string; body?: string }> };
  return (parsed.documents || []).flatMap((document) => {
    const title = String(document.title || "").trim().slice(0, 160);
    const body = String(document.body || "").trim().slice(0, 1500);
    return title && body ? [{ title, body }] : [];
  });
}

export async function POST(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const body = await req.json().catch(() => ({}));
    if (body?.action === "save") {
      const campaignId = String(body.campaignId || "");
      const documents = Array.isArray(body.documents) ? body.documents as Draft[] : [];
      if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
        return interviewerFieldError("interviewer_import_blocked", "Website notes were not saved", { campaignId: "Pick a campaign." });
      }
      const rows = documents.flatMap((document) => {
        const title = String(document.title || "").trim().slice(0, 160);
        const text = String(document.body || "").trim().slice(0, 20000);
        return title && text ? [{ workspace_id: scope.workspaceId, campaign_id: campaignId, title, body: text }] : [];
      });
      if (!rows.length) {
        return interviewerFieldError("interviewer_import_blocked", "Website notes were not saved", { body: "There is nothing to save." });
      }
      const { error } = await supabaseAdmin.from("interviewer_documents").insert(rows);
      if (error) throw error;
      return Response.json({ saved: rows.length }, { headers: { "Cache-Control": "private, no-store" } });
    }

    let pageUrl: URL;
    try { pageUrl = new URL(String(body?.url || "")); }
    catch { return interviewerFieldError("interviewer_import_blocked", "Website was not read", { url: "Enter a full website address, including https://." }); }
    const blocked = await assertPublicUrl(pageUrl);
    if (blocked) return interviewerFieldError("interviewer_import_blocked", "Website was not read", { url: blocked });

    let robots = "";
    try {
      const robotsUrl = new URL("/robots.txt", pageUrl.origin);
      const robotsPage = await readPage(robotsUrl, 4000);
      robots = robotsPage?.html || "";
    } catch { robots = ""; }
    const allowed = (path: string) => !robots || robotsAllows(robots, path);
    if (!allowed(pageUrl.pathname)) {
      return interviewerFieldError("interviewer_import_blocked", "Website was not read", { url: "That page is disallowed by robots.txt." });
    }

    const home = await readPage(pageUrl, 8000);
    if (!home) return interviewerFieldError("interviewer_import_blocked", "Website was not read", { url: "The page did not return readable text." });
    const links = pickInternalLinks(home.html, pageUrl).filter((link) => {
      try { return allowed(new URL(link).pathname); } catch { return false; }
    });
    const pages = [{ url: home.url, text: htmlToText(home.html) }];
    for (const link of links) {
      if (pages.length >= 10) break;
      try {
        const page = await readPage(new URL(link), 8000);
        if (!page) continue;
        const text = htmlToText(page.html);
        if (text) pages.push({ url: page.url, text });
      } catch { /* skip a slow or blocked page */ }
    }
    const documents = await draftNotes(pages);
    if (!documents.length) {
      return interviewerFieldError("interviewer_import_blocked", "Website was not read", { url: "No facts could be taken from those pages without guessing." });
    }
    return Response.json({ documents, pages: pages.map((page) => page.url) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "not_configured") {
      return interviewerFieldError("interviewer_import_blocked", "Website was not read", { url: "The writing service is not configured." });
    }
    return interviewerOwnerError(error);
  }
}
