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
    .select("id, session_id, company_id, candidate")
    .eq("id", callId)
    .maybeSingle();
  if (!sum?.session_id) return null;
  const { data: sess } = await supabaseAdmin
    .from("interview_sessions")
    .select("transcript, candidate")
    .eq("session_id", sum.session_id as string)
    .maybeSingle();
  return {
    sessionId: sum.session_id as string,
    companyId: (sum.company_id as string) || null,
    transcript: typeof sess?.transcript === "string" ? sess.transcript : "",
    // The OTHER party on the call - so the coach never coaches their lines.
    other:
      (typeof sum.candidate === "string" && sum.candidate.trim()) ||
      (typeof (sess as any)?.candidate === "string" && (sess as any).candidate.trim()) ||
      "",
  };
}

// Labels that mean "the host" (the user being coached). Everything else in a
// speaker-labelled transcript is treated as the other party.
const HOST_LABELS = new Set([
  "you",
  "interviewer",
  "host",
  "me",
  "lee",
  "lee nazari",
]);

function normalizeText(s: any): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Split a speaker-labelled transcript into the host's words and everyone
// else's. A leading "Label:" starts a turn; unlabelled lines continue the
// current speaker (multi-line turns). Any label that is not a known host label
// counts as the other party - so an unexpected name never leaks into "host".
function splitBySpeaker(transcript: string): { host: string; other: string } {
  const lines = String(transcript || "").split(/\r?\n/);
  let curHost = false;
  let sawLabel = false;
  const hostParts: string[] = [];
  const otherParts: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z .'\-]{0,39}):\s?(.*)$/);
    if (m) {
      sawLabel = true;
      curHost = HOST_LABELS.has(normalizeText(m[1]));
      (curHost ? hostParts : otherParts).push(m[2] || "");
    } else if (sawLabel) {
      (curHost ? hostParts : otherParts).push(line);
    }
  }
  return {
    host: normalizeText(hostParts.join(" ")),
    other: normalizeText(otherParts.join(" ")),
  };
}

// Deterministic backstop: keep only points whose quote is the HOST's words. A
// quote that matches the other party's words (and not the host's) is dropped
// outright, so the coach can never coach the other person even if the model
// misreads who is who. Points with no real quote (pure advice) are kept.
function keepHostQuotes(points: any[], transcript: string): any[] {
  const { host, other } = splitBySpeaker(transcript);
  if (!host && !other) return points; // couldn't classify - don't over-filter
  return (Array.isArray(points) ? points : []).filter((p: any) => {
    const q = normalizeText(p && p.quote);
    if (q.length < 8) return true; // too short to misattribute meaningfully
    const inOther = !!other && other.includes(q);
    const inHost = !!host && host.includes(q);
    return !(inOther && !inHost);
  });
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
    const other = (call.other || "").trim();
    const otherBlock = other
      ? `WHO IS WHO (read this first - it is the single most important rule):
- The HOST is the user you are coaching. Their lines are labelled "You:", "Interviewer:", or by their own name like "Lee Nazari:".
- The OTHER party on this call is "${other}" - the client/buyer/guest. Their lines are labelled with their name (e.g. "${other}:") or "Candidate:".
- You coach ONLY the HOST. You must NEVER quote, rewrite or coach the OTHER party's lines, no matter how much they ramble, hedge or over-talk. Their words are off limits.
- Be careful: on this call the HOST may be labelled "Interviewer:" even though it is a sales or business call, and the OTHER party may do a lot of the talking and questioning. Do not be fooled by who talks more - coach the HOST only.`
      : `WHO IS WHO: The HOST is the user you are coaching - their lines are labelled "You:", "Interviewer:", or by their own name like "Lee Nazari:". Any other named speaker is the OTHER party. You coach ONLY the HOST and must NEVER quote, rewrite or coach the other party's lines.`;
    const system = `You are a world-class communication and speaking coach. You are reviewing a call transcript to help the HOST get better at SPEAKING: being clear, concise, persuasive and well understood. ${taste}
${otherBlock}
Go through the HOST'S OWN lines only and pick the 6 to 10 moments that matter most - where they rambled, buried the point, were vague, over-talked, used weak or filler phrasing, missed a stronger frame, talked instead of listened, or simply could have landed it better. For each, output:
- quote: a short, near-exact snippet of what the HOST actually said (trim to the relevant part, max ~25 words). It MUST be a line the HOST spoke, copied from a "You:" / "Interviewer:" / host-name turn - never a line from the other party.
- better: a sharper, more effective way they could have said it - concrete and in their own voice, never generic advice.
- why: one short line on what it improves (e.g. "gets to the point", "sounds more certain", "hands them the floor").
Coach kindly, honestly and specifically. Do NOT critique the deal content - a separate summary covers that. Focus purely on HOW the host communicates.
Before you finalise, re-check every quote: if it is the other party's line and not the host's, drop it and replace it with a real host line. Output ONLY a JSON array: [{"quote":"...","better":"...","why":"..."}] with 6 to 10 items.`;

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
    const onlyHost = keepHostQuotes(Array.isArray(parsed) ? parsed : [], call.transcript);
    const rows = onlyHost
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
