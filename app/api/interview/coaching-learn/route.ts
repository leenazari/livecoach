import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 30;

// Learn what the USER personally needs to get better at, from their own calls,
// and maintain a running DEVELOPMENT profile they carry into future calls.
// Three dimensions: (1) technical expertise - systems development and AI
// concepts, (2) articulating why the product fits THIS client's scenario,
// (3) pitch and closing habits. Plus genuine strengths. The profile is
// consolidated (never a growing log) and fed into every plan, cue and the
// assistant via the brain (workspaceContextBlock).
export async function POST(req: NextRequest) {
  try {
    const { transcript, candidate, callType } = await req.json();
    const t = typeof transcript === "string" ? transcript.trim() : "";
    if (t.length < 200) return NextResponse.json({ ok: false }); // too little to judge

    const { data: prof } = await supabaseAdmin
      .from("workspace_profile")
      .select("coaching")
      .eq("id", "main")
      .maybeSingle();
    const existing =
      typeof prof?.coaching === "string" ? prof.coaching.trim() : "";

    const system = `You maintain the USER's personal development profile. They are the HOST/seller on these calls, NOT the other party. The goal is to train them toward being a world-class technology expert who can pitch and win.

Judge ONLY the user's own contributions in the transcript, across these areas:
1. TECHNICAL EXPERTISE - their grasp of systems development and AI concepts. Where were they sharp and credible, and where were they vague, hand-wavy, buzzwordy, or wrong?
2. PRODUCT FIT - how well they connected their product to THIS client's specific need and scenario, versus generic feature-dumping.
3. PITCH & CLOSING - clarity, structure, listening vs talking, handling objections, asking for the next step, and not forgetting key points.
Also capture their genuine STRENGTHS.

Given the EXISTING profile and this new call, return an UPDATED profile: keep what still applies, fold in what this call shows, sharpen or drop anything resolved, and NEVER let it grow into a long log. 6 to 10 short, specific, kind lines - each a concrete habit to keep or to improve, loosely grouped by the areas above. Reference real recurring patterns, not one-off call facts. Plain lines, no headings, no preamble, no markdown.

Output ONLY the updated profile text.`;

    const user = `EXISTING DEVELOPMENT PROFILE:
${existing || "(none yet)"}

NEW CALL${candidate ? ` (with ${candidate})` : ""}${
      callType ? ` - ${callType}` : ""
    } TRANSCRIPT (the user is the host/seller):
${t.slice(-9000)}

Return the updated profile now.`;

    let updated = "";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 26000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_LIVE,
            max_tokens: 700,
            temperature: 0.3,
            system,
            messages: [{ role: "user", content: user }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("coaching-learn", "haiku", (msg as any).usage);
        updated = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .trim();
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return NextResponse.json({ ok: false });
    }

    if (updated && updated.length > 10) {
      await supabaseAdmin
        .from("workspace_profile")
        .update({ coaching: updated.slice(0, 4000) })
        .eq("id", "main");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "failed" });
  }
}
