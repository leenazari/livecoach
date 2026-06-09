import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// Takes a PUBLIC url (a company site, an about/team page, a public profile)
// and turns it into a short background brief that gets folded into the call
// plan. Public pages only. Degrades gracefully: if a page can't be read, it
// returns a soft error and the caller carries on without it.

// Block obviously-private / internal hosts (basic SSRF guard - the URL is
// user-supplied and fetched server-side).
function hostIsBlocked(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  // IPv4 private / link-local ranges
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  return false;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "No link provided." }, { status: 400 });
    }

    // Normalise: allow the user to omit the scheme.
    let raw = url.trim();
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return NextResponse.json(
        { error: "That doesn't look like a valid link." },
        { status: 400 }
      );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json(
        { error: "Only web links (http/https) can be read." },
        { status: 400 }
      );
    }
    if (hostIsBlocked(parsed.hostname)) {
      return NextResponse.json(
        { error: "That link can't be read." },
        { status: 400 }
      );
    }

    const site = parsed.hostname.replace(/^www\./, "");

    // Fetch with a timeout and a normal desktop UA.
    let html = "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      clearTimeout(timer);
      if (!resp.ok) {
        return NextResponse.json({
          error: `couldn't read that page (status ${resp.status}) \u2013 carry on without it`,
          site,
        });
      }
      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("html") && !ct.includes("text")) {
        return NextResponse.json({
          error: "that link isn't a readable web page \u2013 carry on without it",
          site,
        });
      }
      html = await resp.text();
    } catch {
      return NextResponse.json({
        error: "couldn't reach that page \u2013 carry on without it",
        site,
      });
    }

    const text = htmlToText(html).slice(0, 6000);

    // Too little usable text usually means a login wall / JS-only page
    // (e.g. a profile behind auth). Degrade gracefully.
    if (text.length < 200) {
      return NextResponse.json({
        error:
          "that page didn't expose much readable text (it may need a login) \u2013 carry on without it",
        site,
      });
    }

    const system = `You turn a PUBLIC web page into a short background brief for someone about to have a call with this person or company.

Write 3-5 plain sentences covering, where the page supports it: what they do, their size/stage if shown, their focus or positioning, and any notable recent signal (a launch, a stated problem, a priority). Be factual and grounded ONLY in the page text - never invent or speculate. If the page is thin or mostly navigation/marketing boilerplate, say briefly what little is clear. No preamble, no headings, no bullet points - just the brief.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 400,
      system,
      messages: [
        {
          role: "user",
          content: `Public page: ${parsed.toString()}\n\nPage text:\n${text}\n\nWrite the background brief now.`,
        },
      ],
    });

    const background = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();

    if (!background) {
      return NextResponse.json({
        error: "couldn't summarise that page \u2013 carry on without it",
        site,
      });
    }

    return NextResponse.json({ background, site });
  } catch (err: any) {
    console.error("Research error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to research link" },
      { status: 500 }
    );
  }
}
