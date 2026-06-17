import { NextRequest, NextResponse } from "next/server";
import { anthropic, CLAUDE_MODEL_PRO } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";
import { getCoachingTasteBlock } from "@/lib/workspace";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// A post-call SPEAKING debrief, separate from the deal summary. It goes through
// the host's OWN lines and, for the moments that mattered, shows a sharper way
// they could have said it and why - so Lee gets better at speaking. Each point
// is votable, and those votes tune future debriefs (the coach learns how Lee
// likes to be coached).

async function loadCall(callId: string) {
  const { data: sum } = await supabaseAdmin
    .from("interview_summaries")
    .select("id, session_id, company_id")
    .eq("id", callId)
    .maybeSingle();
  if (!sum?.session_id) return null;
  const { data: sess } = await supabaseAdmin
    .from("interview_sessions")
    .select("transcript")
    .eq("session_id", sum.session_id as string)
    .maybeSingle();
  return {
    sessionId: sum.session_id as string,
    companyId: (sum.company_id as string) || null,
    transcript: typeof sess?.transcript === "string" ? sess.transcript : "",
  };
}

async function existingPoints(sessionId: string) {
  const { data } = await supabaseAdmin
    .from("coaching_points")
    .select("id, quote, better, why, vote, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  return data || [];
}

export async function GET(req: NextRequest) {
  try {
    const callId = new URL(req.url).searchParams.get("callId") || "";
    if (!callId) return NextResponse.json({ points: [] });
    const call = await loadCall(callId);
    if (!call) return NextResponse.json({ points: [] });
    return NextResponse.json({ points: await existingPoints(call.sessionId) });
  } catch (err: any) {
    return NextResponse.json({ points: [], error: err?.message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const callId = typeof body.callId === "string" ? body.callId : "";
    if (!callId)
      return NextResponse.json({ error: "callId required" }, { status: 400 });
    const call = await loadCall(callId);
    if (!call || call.transcript.trim().length < 200) {
      return NextResponse.json({
        points: [],
        error: "Not enough transcript to coach on this call.",
      });
    }
    // Idempotent: if a debrief already exists for this call, return it.
    const already = await existingPoints(call.sessionId);
    if (already.length) return NextResponse.json({ points: already });

    const taste = await getCoachingTasteBlock();
    const system = `You are a world-class communication and speaking coach. You are reviewing a call transcript to help the HOST (the user - their lines are labelled "You:", "Interviewer:", or by their own name like "Lee Nazari:") get better at SPEAKING: being clear, concise, persuasive and well understood. ${taste}
Go through the HOST'S OWN lines only and pick the 6 to 10 moments that matter most - where they rambled, buried the point, were vague, over-talked, used weak or filler phrasing, missed a stronger frame, talked instead of listened, or simply could have landed it better. For each, output:
- quote: a short, near-exact snippet of what the host actually said (trim to the relevant part, max ~25 words).
- better: a sharper, more effective way they could have said it - concrete and in their own voice, never generic advice.
- why: one short line on what it improves (e.g. "gets to the point", "sounds more certain", "hands them the floor").
Coach kindly, honestly and specifically. Do NOT coach the other party's lines. Do NOT critique the deal content - a separate summary covers that. Focus purely on HOW the host communicates.
Output ONLY a JSON array: [{"quote":"...","better":"...","why":"..."}] with 6 to 10 items.`;

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_PRO,
      max_tokens: 1800,
      temperature: 0.4,
      system,
      messages: [
        {
          role: "user",
          content: `TRANSCRIPT (speaker-labelled):\n${call.transcript.slice(
            -14000
          )}\n\nReturn the JSON array of speaking-coaching points now.`,
        },
      ],
    });
    await logModelUsage("coaching-debrief", "sonnet", (msg as any).usage);
    const raw = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    const a = raw.indexOf("[");
    const b = raw.lastIndexOf("]");
    let parsed: any[] = [];
    try {
      parsed = a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : [];
    } catch {
      parsed = [];
    }
    const rows = (Array.isArray(parsed) ? parsed : [])
      .filter((p: any) => p && typeof p.better === "string" && p.better.trim())
      .slice(0, 10)
      .map((p: any) => ({
        session_id: call.sessionId,
        company_id: call.companyId,
        quote: typeof p.quote === "string" ? p.quote.trim() : "",
        better: String(p.better).trim(),
        why: typeof p.why === "string" ? p.why.trim() : "",
      }));
    if (!rows.length) return NextResponse.json({ points: [] });
    const { data: inserted } = await supabaseAdmin
      .from("coaching_points")
      .insert(rows)
      .select("id, quote, better, why, vote, created_at");
    return NextResponse.json({ points: inserted || [] });
  } catch (err: any) {
    return NextResponse.json(
      { points: [], error: err?.message || "coaching failed" },
      { status: 200 }
    );
  }
}
