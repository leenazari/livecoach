import { NextRequest, NextResponse } from "next/server";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { modelText, parseObject } from "@/lib/outreach";
import { removeDashesFromProse } from "@/lib/outreach-voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COMMENT_FORMAT = {
  type: "json_schema",
  name: "linkedin_engagement_comment",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["authorName", "postSummary", "angle", "evidence", "comment"],
    properties: {
      authorName: { type: "string" },
      postSummary: { type: "string" },
      angle: { type: "string" },
      evidence: { type: "array", maxItems: 3, items: { type: "string" } },
      comment: { type: "string" },
    },
  },
};

function clean(value: unknown, max: number) {
  return removeDashesFromProse(String(value || "").replace(/\s+/g, " ").trim()).slice(0, max);
}

function validUrl(value: string) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function normaliseSourceUrl(value: string) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    for (const key of [...parsed.searchParams.keys()])
      if (key.toLowerCase().startsWith("utm_") || key.toLowerCase() === "rcm") parsed.searchParams.delete(key);
    return parsed.toString();
  } catch {
    return value;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const source = String(body.source || "").trim();
    let sourceText = String(body.sourceText || source).trim().slice(0, 9000);
    let sourceUrl = String(body.sourceUrl || "").trim().slice(0, 1200);
    if (!sourceUrl && /^https?:\/\/\S+$/i.test(sourceText)) {
      sourceUrl = sourceText;
      sourceText = "";
    }
    sourceUrl = normaliseSourceUrl(sourceUrl);
    if (!sourceText && !sourceUrl)
      return NextResponse.json({ error: "Paste a LinkedIn link or the post text." }, { status: 400 });
    if (!validUrl(sourceUrl))
      return NextResponse.json({ error: "That LinkedIn link is not valid." }, { status: 400 });
    const needsPublicLookup = sourceText.length < 25 && !!sourceUrl;

    const system = `You write one excellent LinkedIn comment for Lee Nazari, CEO of Interviewa.

Interviewa helps recruiters prepare candidates for interviews and improve the visibility of candidate readiness. Lee wants to build genuine commercial relationships and thoughtful visibility, not spam random posts with a product pitch.

Read the exact supplied post. Respond to what the author actually said. Add one commercially intelligent point, useful observation or thoughtful question. Create curiosity about Lee's work only when there is a natural connection. A subtle first hand reference such as "Building Interviewa has reinforced this for us" is acceptable when directly relevant. Do not force Interviewa, candidate preparation or recruitment into an unrelated post. Credibility creates more interest than a forced sales message.

The comment must be 35 to 75 words, natural, specific and ready to paste. Avoid generic praise such as "great post", "spot on", "could not agree more" and "this is so true". Do not repeat the post back to the author. Do not ask for a call, include a link, use hashtags, pitch a free trial or claim a relationship. Never invent facts, results, customers or experience. Use British English in Lee's voice. Do not use hyphens, dashes, em dashes or semicolons.

If the exact post cannot be read, return an empty evidence list and an empty comment instead of guessing. Nothing will be posted automatically and nothing from this request will be saved to Brain memory.`;
    const user = `LINKEDIN URL: ${sourceUrl || "not supplied"}

POST TEXT:
${sourceText || "No text was pasted. Open the exact public LinkedIn URL above. If it is inaccessible, do not guess."}`;
    const message = await openai.messages.create({
      model: OPENAI_MODEL_PRO,
      max_tokens: 700,
      response_format: COMMENT_FORMAT,
      system,
      ...(needsPublicLookup ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }] as any } : {}),
      messages: [{ role: "user", content: user }],
    }, { timeout: 50_000 });
    await logModelUsage("linkedin_engagement", "pro", (message as any).usage, {
      publicLinkLookup: needsPublicLookup,
    });
    const parsed = parseObject(modelText(message));
    if (!parsed) throw new Error("The comment draft was incomplete. Try again.");
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.map((item: unknown) => clean(item, 240)).filter(Boolean).slice(0, 3)
      : [];
    const comment = clean(parsed.comment, 1400);
    if (!evidence.length || !comment)
      return NextResponse.json({ error: "LinkedIn did not expose enough of that post. Copy the post text into the box and try again." }, { status: 422 });
    return NextResponse.json({
      draft: {
        authorName: clean(parsed.authorName, 160),
        postSummary: clean(parsed.postSummary, 500),
        angle: clean(parsed.angle, 300),
        evidence,
        comment,
        sourceUrl: sourceUrl || null,
      },
      savedToBrain: false,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not prepare this LinkedIn comment." }, { status: 500 });
  }
}
