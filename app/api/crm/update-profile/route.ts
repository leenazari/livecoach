import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 30;

// PHASE 3 - the evolving client profile. After a linked call is summarised, one
// Sonnet pass merges the latest call into the company's running "what we know"
// brief. This is what makes Phase 2's auto-attached history get richer over
// time instead of being just a stack of raw scorecards. Fire-and-forget from
// the client; never blocks the call.
export async function POST(req: NextRequest) {
  try {
    const { companyId, summary } = await req.json();
    if (typeof companyId !== "string" || !companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }
    if (!summary || typeof summary !== "object") {
      return NextResponse.json(
        { error: "summary is required" },
        { status: 400 }
      );
    }

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name, profile")
      .eq("id", companyId)
      .single();
    if (!company) {
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    const existingBrief =
      company.profile && typeof company.profile === "object"
        ? String((company.profile as any).brief || "")
        : "";

    // Feed only the durable, useful parts of the scorecard.
    const s = summary as any;
    const newCall = [
      s.headline ? `Headline: ${s.headline}` : "",
      s.overview ? `How it went: ${s.overview}` : "",
      Array.isArray(s.myNextActions) && s.myNextActions.length
        ? `We still owe: ${s.myNextActions.join("; ")}`
        : "",
      Array.isArray(s.theirNextActions) && s.theirNextActions.length
        ? `They said they'd: ${s.theirNextActions.join("; ")}`
        : "",
      Array.isArray(s.suggestedNextActions) && s.suggestedNextActions.length
        ? `Smart next moves: ${s.suggestedNextActions.join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const system = `You maintain a CONCISE running profile of a client (a company/person a coach speaks with repeatedly). Given the EXISTING profile brief and the LATEST call, produce an UPDATED brief.

The brief is a tight running memory (<= 180 words, plain English) capturing only DURABLE, useful facts: who they are and what they want, key people and their roles, decisions made, open threads / promises still outstanding on either side, and any preferences or sensitivities to remember.

Merge, don't append: keep what is still true, update what changed, fold in what's new, and drop stale or one-off noise. Do not invent anything not supported by the inputs. No scores, no call-by-call log - a single current picture of the relationship.

Output ONLY JSON: { "brief": "..." }`;

    const userMsg = `EXISTING PROFILE BRIEF (may be empty for a first call):
${existingBrief || "(none yet)"}

LATEST CALL:
${newCall || "(little of note)"}

Return the updated JSON brief now.`;

    let brief = existingBrief;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 22000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_PRO,
            max_tokens: 400,
            temperature: 0.3,
            system,
            messages: [{ role: "user", content: userMsg }],
          },
          { signal: controller.signal }
        );
        const raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .replace(/```json|```/g, "")
          .trim();
        const a = raw.indexOf("{");
        const b = raw.lastIndexOf("}");
        const parsed = a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : null;
        if (parsed && typeof parsed.brief === "string" && parsed.brief.trim()) {
          brief = parsed.brief.trim();
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      console.error("Profile update model call failed:", e);
      // Keep the existing brief rather than wiping it.
    }

    const profile = { brief, updated: new Date().toISOString() };
    const { error } = await supabaseAdmin
      .from("companies")
      .update({ profile })
      .eq("id", companyId);
    if (error) throw error;

    return NextResponse.json({ ok: true, profile });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update profile" },
      { status: 500 }
    );
  }
}
