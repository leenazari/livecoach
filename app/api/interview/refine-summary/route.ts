import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 40;

// Fold the host's post-call notes INTO the saved summary. Their notes were made
// in the room, so they are authoritative: they correct/extend strengths,
// concerns and scores, and especially update the next actions. Returns the full
// updated summary (same shape) and persists it to interview_summaries.
export async function POST(req: NextRequest) {
  try {
    const { sessionId, summary, notes, transcript, candidate } =
      await req.json();
    const n = typeof notes === "string" ? notes.trim() : "";
    if (!summary || typeof summary !== "object" || !n) {
      return NextResponse.json({ summary: summary || null });
    }

    const system = `You are updating a call summary using the HOST's own post-call notes. The host was in the room, so their notes are AUTHORITATIVE - prefer them over the transcript when they differ.

You are given the current summary as JSON and the host's notes. Return the FULL summary as JSON with the SAME shape and ALL the same fields, but folded through with the notes:
- Update myNextActions to include anything the host says THEY will do next. Update theirNextActions for what the other party will do. Add to suggestedNextActions where the notes imply a smart move.
- Correct or add to strengths and concerns where the notes change the picture. Adjust a competency score only if the notes clearly justify it, and update its note.
- Keep the headline/overview/recommendation accurate to the notes. Keep notCovered, questionReview, contributors, styleProfile unless the notes clearly change them.
- Do NOT invent anything not in the summary or the notes. Keep every existing field present (use the same keys). Keep items short.

Output ONLY the full updated JSON object, no prose, no markdown.`;

    const user = `CURRENT SUMMARY (JSON):
${JSON.stringify(summary).slice(0, 9000)}

HOST'S POST-CALL NOTES (authoritative):
${n.slice(0, 4000)}
${
  transcript && typeof transcript === "string" && transcript.trim()
    ? `\nTRANSCRIPT (for grounding, secondary to the notes):\n${transcript.slice(-4000)}`
    : ""
}

Return the full updated summary JSON now.`;

    let merged: any = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 34000);
      try {
        const msg = await anthropic.messages.create(
          {
            model: CLAUDE_MODEL_PRO,
            max_tokens: 3000,
            temperature: 0.3,
            system,
            messages: [{ role: "user", content: user }],
          },
          { signal: controller.signal }
        );
        await logModelUsage("refine-summary", "sonnet", (msg as any).usage);
        const raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("")
          .replace(/```json|```/g, "")
          .trim();
        const s = raw.indexOf("{");
        const e = raw.lastIndexOf("}");
        merged = s >= 0 && e > s ? JSON.parse(raw.slice(s, e + 1)) : null;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      merged = null;
    }

    if (!merged || typeof merged !== "object") {
      // Model failed - hand back the original so the UI never breaks.
      return NextResponse.json({ summary });
    }

    // Persist the refined summary against the call so the record reflects it.
    if (typeof sessionId === "string" && sessionId) {
      try {
        await supabaseAdmin
          .from("interview_summaries")
          .update({ summary: merged })
          .eq("session_id", sessionId);
      } catch {
        /* persistence is best-effort */
      }
    }

    return NextResponse.json({ summary: merged });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to refine" },
      { status: 200 }
    );
  }
}
