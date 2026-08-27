import { NextRequest, NextResponse } from "next/server";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { modelText, parseObject } from "@/lib/outreach";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import { requireRequestScope } from "@/lib/request-scope";
import { getSalesProfile } from "@/lib/sales-profile";
import { supabaseService } from "@/lib/supabase";

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
    const scope = requireRequestScope();
    const [{ data: accountProfile, error: profileError }, salesProfile] =
      await Promise.all([
        supabaseService
          .from("profiles")
          .select("display_name")
          .eq("user_id", scope.userId)
          .maybeSingle(),
        getSalesProfile(scope),
      ]);
    if (profileError) throw profileError;
    const writerName = clean(accountProfile?.display_name, 100) || "the signed in salesperson";
    const roleTitle = clean(salesProfile.roleTitle, 140) || "an Interviewa sales team member";
    const voice = clean(salesProfile.emailTone.replace(/_/g, " "), 80) || "warm and direct";
    const customerFocus = salesProfile.customerFocus
      .map((item) => clean(item, 80))
      .filter(Boolean)
      .slice(0, 5)
      .join(", ") || "recruiters and hiring teams";
    const body = await req.json();
    const source = String(body.source || "").trim();
    let sourceText = String(body.sourceText || source).trim().slice(0, 9000);
    let sourceUrl = String(body.sourceUrl || "").trim().slice(0, 1200);
    if (!sourceUrl && /^https?:\/\/\S+$/i.test(sourceText)) {
      sourceUrl = sourceText;
      sourceText = "";
    }
    sourceUrl = normaliseSourceUrl(sourceUrl);
    if (sourceText.length < 25)
      return NextResponse.json(
        { error: "Paste the words from the LinkedIn post. LiveCoach no longer opens or scrapes LinkedIn links." },
        { status: 422 }
      );
    if (!validUrl(sourceUrl))
      return NextResponse.json({ error: "That LinkedIn link is not valid." }, { status: 400 });
    const system = `You write one excellent LinkedIn comment for ${writerName}, ${roleTitle}.

Interviewa helps recruiters prepare candidates for interviews and improve the visibility of candidate readiness. ${writerName} focuses on ${customerFocus}. They want to build genuine commercial relationships and thoughtful visibility, not spam random posts with a product pitch.

Read the exact supplied post. Respond to what the author actually said. Add one commercially intelligent point, useful observation or thoughtful question. Create curiosity about ${writerName}'s work only when there is a natural connection. A subtle first hand reference such as "Working with Interviewa has reinforced this for us" is acceptable when directly relevant. Do not force Interviewa, candidate preparation or recruitment into an unrelated post. Credibility creates more interest than a forced sales message.

The comment must be 35 to 75 words, natural, specific and ready to paste. Avoid generic praise such as "great post", "spot on", "could not agree more" and "this is so true". Do not repeat the post back to the author. Do not ask for a call, include a link, use hashtags, pitch a free trial or claim a relationship. Never invent facts, results, customers, job titles or experience. Write in British English with a ${voice} voice. Never present this person as Lee, as Interviewa's CEO or as another teammate unless their own saved identity above explicitly says so. Do not use hyphens, dashes, em dashes or semicolons.

If the exact post cannot be read, return an empty evidence list and an empty comment instead of guessing. Nothing will be posted automatically and nothing from this request will be saved to Brain memory.`;
    const user = `REFERENCE URL: ${sourceUrl || "not supplied"}

POST TEXT:
${sourceText}`;
    const message = await openai.messages.create({
      model: OPENAI_MODEL_PRO,
      max_tokens: 700,
      response_format: COMMENT_FORMAT,
      system,
      messages: [{ role: "user", content: user }],
    }, { timeout: 50_000 });
    await logModelUsage("linkedin_engagement", "pro", (message as any).usage, {
      publicLinkLookup: false,
    }, { userId: scope.userId, workspaceId: scope.workspaceId });
    const parsed = parseObject(modelText(message));
    if (!parsed) throw new Error("The comment draft was incomplete. Try again.");
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.map((item: unknown) => clean(item, 240)).filter(Boolean).slice(0, 3)
      : [];
    const comment = clean(parsed.comment, 1400);
    if (!evidence.length || !comment)
      return NextResponse.json({ error: "The pasted post did not contain enough clear content. Copy the full post text and try again." }, { status: 422 });
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
