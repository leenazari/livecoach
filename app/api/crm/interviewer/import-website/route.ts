import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { requireInterviewerOwner, interviewerOwnerError } from "@/lib/interviewer/access";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { llmUsd, loadCostRates, recordCostEvent } from "@/lib/interviewer/cost-store";
import {
  BROWSER_USER_AGENT,
  MIN_IMPORT_CHARS,
  choosePages,
  dropInventedPrices,
  isBlockedAddress,
  moduleScriptUrls,
  pickInternalLinks,
  readablePageText,
  robotsAllows,
  scriptRoutes,
  sitemapLocs,
} from "@/lib/interviewer/website-pages";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type FetchedPage = { url: string; chars: number };
type ImportResult = { documents: Draft[]; pages: FetchedPage[] };
const importInflight = new Map<string, Promise<ImportResult>>();
const importRecent = new Map<string, { at: number; result: ImportResult }>();

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
    headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
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
  if (type && !/html|text|xml|javascript|json/i.test(type)) return null;
  return { url: target.toString(), html: await response.text() };
}

async function draftNotes(pages: Array<{ url: string; text: string }>): Promise<{ documents: Draft[]; inputTokens: number; outputTokens: number }> {
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
Use only these titles, and omit a title when the pages do not state it: Business summary; Products and services; Pricing; FAQs and objections; Next step and booking.
Use only facts that are written in the page text. Do not add a product, price, name, or number from anywhere else.
Copy each price exactly as it appears, including the £ sign. On that same line, add the page URL in parentheses. If the page text has no price, do not mention a price.
Write short plain sentences. Use lines that start with "- " for separate facts.
No markdown headings and no tables. Each body must be under 1500 characters.`,
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
  return {
    documents: (parsed.documents || []).flatMap((document) => {
      const title = String(document.title || "").trim().slice(0, 160);
      const body = String(document.body || "").trim().slice(0, 1500);
      return title && body ? [{ title, body }] : [];
    }),
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
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

    const campaignKey = /^[0-9a-f-]{36}$/i.test(String(body?.campaignId || ""))
      ? `${scope.workspaceId}:${String(body.campaignId)}`
      : "";
    if (campaignKey) {
      const recent = importRecent.get(campaignKey);
      if (recent && Date.now() - recent.at < 60_000) {
        return Response.json({ ...recent.result, reused: true }, { headers: { "Cache-Control": "private, no-store" } });
      }
      const running = importInflight.get(campaignKey);
      if (running) {
        const result = await running;
        return Response.json({ ...result, reused: true }, { headers: { "Cache-Control": "private, no-store" } });
      }
      const since = new Date(Date.now() - 60_000).toISOString();
      const prior = await supabaseAdmin
        .from("interviewer_cost_events")
        .select("id")
        .eq("campaign_id", String(body.campaignId))
        .eq("kind", "website_import")
        .gte("created_at", since)
        .limit(1);
      if (!prior.error && (prior.data || []).length) {
        const stored = await supabaseAdmin
          .from("interviewer_documents")
          .select("title, body")
          .eq("campaign_id", String(body.campaignId))
          .order("created_at", { ascending: false })
          .limit(20);
        const documents = (stored.data || []).flatMap((document) => {
          const title = String(document.title || "");
          const text = String(document.body || "");
          return title && text ? [{ title, body: text }] : [];
        });
        if (documents.length) {
          return Response.json({ documents, pages: [], reused: true }, { headers: { "Cache-Control": "private, no-store" } });
        }
      }
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

    const scrape = async (): Promise<ImportResult> => {
    const home = await readPage(pageUrl, 8000);
    if (!home) throw new Error("empty_page");
    const scripts: string[] = [];
    for (const scriptUrl of moduleScriptUrls(home.html, pageUrl).slice(0, 3)) {
      try {
        const script = await readPage(new URL(scriptUrl), 8000);
        if (!script || !/function|const |=>/.test(script.html) || script.html.length > 2_000_000) continue;
        if (/<html[\s>]/i.test(script.html.slice(0, 200))) continue;
        scripts.push(script.html);
      } catch { /* a missing script is recorded as no extra text */ }
    }
    const sitemapPages = ["/sitemap.xml", "/sitemap_index.xml"].map((path) => new URL(path, pageUrl.origin));
    const sitemapLinks: string[] = [];
    for (const sitemapUrl of sitemapPages) {
      try {
        const sitemap = await readPage(sitemapUrl, 8000);
        if (sitemap && /<loc>/i.test(sitemap.html)) sitemapLinks.push(...sitemapLocs(sitemap.html, pageUrl));
      } catch { /* a missing sitemap is normal */ }
    }
    const routeLinks = scripts.flatMap((script) => scriptRoutes(script).map((path) => new URL(path, pageUrl.origin).toString()));
    const links = choosePages(
      [home.url, ...sitemapLinks, ...pickInternalLinks(home.html, pageUrl), ...routeLinks],
      pageUrl,
      25,
    ).filter((link) => {
      try { return allowed(new URL(link).pathname); } catch { return false; }
    });
    const pages: Array<{ url: string; text: string }> = [];
    for (const link of links) {
      if (pages.length >= 25) break;
      try {
        const page = link === home.url ? home : await readPage(new URL(link), 8000);
        if (!page) continue;
        const read = readablePageText({ html: page.html, pathname: new URL(page.url).pathname, scripts });
        if (read.text) pages.push({ url: page.url, text: read.text });
      } catch { /* skip a slow or blocked page */ }
    }
    const fetched = pages.map((page) => ({ url: page.url, chars: page.text.length }));
    const totalChars = fetched.reduce((sum, page) => sum + page.chars, 0);
    console.info("interviewer website fetched", { url: pageUrl.toString(), pages: fetched, totalChars });
    if (totalChars < MIN_IMPORT_CHARS) {
      const error = new Error("thin_text") as Error & { pages?: FetchedPage[]; totalChars?: number };
      error.pages = fetched;
      error.totalChars = totalChars;
      throw error;
    }
    const drafted = await draftNotes(pages);
    const source = pages.map((page) => page.text).join("\n");
    const documents = drafted.documents.flatMap((document) => {
      const body = dropInventedPrices(document.body, source);
      return body ? [{ title: document.title, body }] : [];
    });
    if (!documents.length) {
      const error = new Error("no_facts") as Error & { pages?: FetchedPage[] };
      error.pages = fetched;
      throw error;
    }
    const rates = await loadCostRates();
    const campaignId = String(body?.campaignId || "");
    if (rates) {
      await recordCostEvent({
        workspaceId: scope.workspaceId,
        campaignId: /^[0-9a-f-]{36}$/i.test(campaignId) ? campaignId : null,
        kind: "website_import",
        usd: llmUsd(rates, drafted.inputTokens, drafted.outputTokens),
        detail: { pages: pages.length, inputTokens: drafted.inputTokens, outputTokens: drafted.outputTokens },
      });
    }
    return { documents, pages: fetched };
    };
    const job = scrape();
    if (campaignKey) importInflight.set(campaignKey, job);
    try {
      const result = await job;
      if (campaignKey) importRecent.set(campaignKey, { at: Date.now(), result });
      return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (error instanceof Error && error.message === "empty_page") {
        return interviewerFieldError("interviewer_import_blocked", "Website was not read", { url: "The page did not return readable text." });
      }
      if (error instanceof Error && error.message === "thin_text") {
        const detail = error as Error & { pages?: FetchedPage[]; totalChars?: number };
        const list = (detail.pages || []).map((page) => `${page.url} (${page.chars} characters)`).join("; ");
        return interviewerFieldError("interviewer_import_blocked", "Website was not read", {
          url: `Only ${detail.totalChars || 0} characters of page text were fetched, so nothing was written. ${list}`,
        }, { pages: detail.pages || [] });
      }
      if (error instanceof Error && error.message === "no_facts") {
        const detail = error as Error & { pages?: FetchedPage[] };
        const list = (detail.pages || []).map((page) => `${page.url} (${page.chars} characters)`).join("; ");
        return interviewerFieldError("interviewer_import_blocked", "Website was not read", {
          url: `No facts could be taken from those pages without guessing. ${list}`,
        }, { pages: detail.pages || [] });
      }
      throw error;
    } finally {
      if (campaignKey) importInflight.delete(campaignKey);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "not_configured") {
      return interviewerFieldError("interviewer_import_blocked", "Website was not read", { url: "The writing service is not configured." });
    }
    return interviewerOwnerError(error);
  }
}
