import { NextRequest, NextResponse } from "next/server";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { getCoachingTasteBlock } from "@/lib/workspace";
import { logModelUsage } from "@/lib/usage";
import { requireRequestScope } from "@/lib/request-scope";
import { loadSharedCallAccess } from "@/lib/shared-call-access";
import { loadHostIdentityForUser } from "@/lib/speakers";
import {
  buildStrategicCoachingTranscript,
  hostSpeakingStats,
  keepGroundedHostQuotes,
  normaliseCoachingText,
  otherSpeakerNames,
} from "@/lib/coaching-transcript";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// A post-call SPEAKING debrief, separate from the deal summary. It goes through
// the signed-in user's OWN lines and, for the moments that mattered, shows a
// sharper way they could have said it and why. Shared calls remain one raw
// transcript, while each verified attendee receives their own private debrief.

async function loadCall(
  callId: string,
  scope: { userId: string; workspaceId: string }
) {
  const { data: ownedSummary, error: ownedSummaryError } = await supabaseAdmin
    .from("interview_summaries")
    .select("id, session_id, company_id, candidate, summary")
    .eq("id", callId)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .maybeSingle();
  if (ownedSummaryError) throw ownedSummaryError;
  let sum: any = ownedSummary;
  let sharedAccess: Awaited<ReturnType<typeof loadSharedCallAccess>> = null;
  if (!sum) {
    const { data: candidate, error: candidateError } = await supabaseService
      .from("interview_summaries")
      .select("id, session_id, company_id, candidate, summary")
      .eq("id", callId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (candidateError) throw candidateError;
    if (candidate?.session_id) {
      sharedAccess = await loadSharedCallAccess({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        sessionId: candidate.session_id,
      });
    }
    if (sharedAccess) sum = candidate;
  }
  if (!sum?.session_id) return null;
  sharedAccess =
    sharedAccess ||
    (await loadSharedCallAccess({
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      sessionId: sum.session_id,
    }));

  const { data: ownedSession, error: ownedSessionError } = await supabaseAdmin
    .from("interview_sessions")
    .select("transcript, candidate, brief, competencies, call_type")
    .eq("session_id", sum.session_id as string)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ownedSessionError) throw ownedSessionError;
  let sess: any = ownedSession;
  if (!sess && sharedAccess) {
    const { data: sharedSession, error: sharedSessionError } = await supabaseService
      .from("interview_sessions")
      .select("transcript, candidate, brief, competencies, call_type")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", (sharedAccess.capture as any).owner_id)
      .eq("session_id", sum.session_id as string)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sharedSessionError) throw sharedSessionError;
    sess = sharedSession;
  }
  if (!sess) return null;

  const viewer = await loadHostIdentityForUser(scope.userId, scope.workspaceId);
  const viewerUpcomingId = String(
    (sharedAccess?.access as any)?.upcoming_id || ""
  );
  let viewerUpcoming: any = null;
  if (viewerUpcomingId && sharedAccess) {
    const { data, error } = await supabaseService
      .from("upcoming_calls")
      .select("intent,prep,owner_id")
      .eq("id", viewerUpcomingId)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .maybeSingle();
    if (error) throw error;
    viewerUpcoming = data;
  }

  const prep =
    viewerUpcoming?.prep && typeof viewerUpcoming.prep === "object"
      ? viewerUpcoming.prep
      : {};
  const canonicalFocus = Array.isArray(prep.selectedComps)
    ? prep.selectedComps
    : Array.isArray(prep.suggestedComps)
      ? prep.suggestedComps
      : null;
  const [{ data: company }, { data: opportunities }] = await Promise.all([
    sum.company_id
      ? supabaseAdmin
          .from("companies")
          .select("name, stage")
          .eq("id", sum.company_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sum.company_id
      ? supabaseAdmin
          .from("opportunities")
          .select("id, title, detail, value, status, close_plan")
          .eq("company_id", sum.company_id as string)
          .eq("status", "open")
          .order("value", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
  ]);
  const transcript = typeof sess?.transcript === "string" ? sess.transcript : "";
  const allowGenericHostLabels =
    !sharedAccess || (sharedAccess.access as any)?.access_role === "host";
  return {
    sessionId: sum.session_id as string,
    companyId: company ? (sum.company_id as string) || null : null,
    transcript,
    intent:
      (typeof viewerUpcoming?.intent === "string" && viewerUpcoming.intent.trim()) ||
      (typeof sess?.brief === "string" ? sess.brief.trim() : ""),
    focus: Array.isArray(canonicalFocus)
      ? canonicalFocus.map((v: any) => String(v || "").trim()).filter(Boolean)
      : Array.isArray(sess?.competencies)
      ? sess.competencies.map((v: any) => String(v || "").trim()).filter(Boolean)
      : [],
    callType:
      (typeof prep.callType === "string" && prep.callType) ||
      (typeof sess?.call_type === "string" ? sess.call_type : "general"),
    summary:
      sum?.summary && typeof sum.summary === "object" ? sum.summary : {},
    viewerName: viewer.name || "Host",
    allowGenericHostLabels,
    speaking: hostSpeakingStats(
      transcript,
      viewer.name || "Host",
      allowGenericHostLabels
    ),
    otherSpeakers: otherSpeakerNames(
      transcript,
      viewer.name || "Host",
      allowGenericHostLabels
    ),
    dealContext: {
      company: company?.name || null,
      relationshipStage: company?.stage || null,
      opportunities: (opportunities || []).map((o: any) => ({
        title: o.title,
        detail: o.detail || null,
        value: Number(o.value) || null,
        closePlan: o.close_plan || null,
      })),
    },
  };
}

const MIN_USEFUL_POINTS = 4;

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
    const scope = requireRequestScope();
    const callId = new URL(req.url).searchParams.get("callId") || "";
    if (!callId) return NextResponse.json({ points: [] });
    const call = await loadCall(callId, scope);
    if (!call) return NextResponse.json({ points: [] });
    const points = keepGroundedHostQuotes(
      await existingPoints(call.sessionId),
      call.transcript,
      call.viewerName,
      call.allowGenericHostLabels
    );
    return NextResponse.json({
      points,
      note:
        call.speaking.words < 35
          ? `There was not enough recorded speech from ${call.viewerName} to build a personal speaking debrief.`
          : null,
    });
  } catch (err: any) {
    return NextResponse.json({ points: [], error: err?.message });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const callId = typeof body.callId === "string" ? body.callId : "";
    if (!callId)
      return NextResponse.json({ error: "callId required" }, { status: 400 });
    const call = await loadCall(callId, scope);
    if (!call || call.transcript.trim().length < 200) {
      return NextResponse.json({
        points: [],
        error: "Not enough transcript to coach on this call.",
      });
    }
    // A complete debrief is immutable and free to reopen. A historic partial
    // result may be topped up once rather than trapping the user with one weak
    // point forever.
    const already = keepGroundedHostQuotes(
      await existingPoints(call.sessionId),
      call.transcript,
      call.viewerName,
      call.allowGenericHostLabels
    );
    if (already.length >= MIN_USEFUL_POINTS)
      return NextResponse.json({ points: already });
    if (call.speaking.words < 35) {
      return NextResponse.json({
        points: already,
        note: `There was not enough recorded speech from ${call.viewerName} to build a personal speaking debrief.`,
      });
    }

    const taste = await getCoachingTasteBlock();
    const viewerLabels = call.allowGenericHostLabels
      ? `"${call.viewerName}:", "Team member ${call.viewerName}:", "You:", "Interviewer:", or "Host:"`
      : `"${call.viewerName}:" or "Team member ${call.viewerName}:". Generic labels such as "You:" belong to the call host and must not be attributed to ${call.viewerName}`;
    const otherBlock = `WHO IS WHO (read this first - it is the single most important rule):
- The person you are coaching is "${call.viewerName}". Their permitted transcript labels are ${viewerLabels}.
- Other recorded speakers are ${call.otherSpeakers.length ? call.otherSpeakers.map((name) => `"${name}"`).join(", ") : "not reliably identified"}.
- Coach ONLY ${call.viewerName}. Never quote, rewrite or coach another participant's words.
- This may be a shared call. The person who clicked Start is not automatically the person being coached. Use the exact labels above.`;
    const system = `You are a world-class strategic call coach. You are reviewing a completed call to help the HOST achieve better outcomes, not merely sound polished. ${taste}
${otherBlock}
Prioritise the 5 to 8 moments with the greatest practical impact, in this order:
1. Missed opportunities to advance the stated INTENT or highest-priority FOCUS.
2. On sales calls, missed buying signals, qualification questions, value framing, objections, decision process, next-step commitments, or appropriate opportunities to advance/close the deal. Never invent a close where the buyer was not ready.
3. Decisions, owners, dates, success criteria or follow-ups the host should have secured but left vague.
4. Important risks or contradictions in the SUMMARY that the host failed to challenge.
5. Communication problems only when they materially weakened the outcome: rambling, leading questions, over-talking, weak framing or failing to listen.
When DEAL CONTEXT is present, explicitly compare the call with the real opportunity stage and unfinished close-plan milestones. Surface missed chances to:
- confirm measurable value or urgency,
- reach the economic decision-maker,
- clarify the buying and approval process,
- resolve a stalled or overdue milestone,
- book the next meeting while both parties are present,
- agree owners and dates,
- or appropriately ask for the decision.
Do not praise routine conversation. Prefer advice that moves the opportunity toward a verifiable buyer commitment.
For each, output:
- quote: a short, near-exact snippet of what the HOST actually said (trim to the relevant part, max ~25 words). It MUST be a line the HOST spoke, copied from a "You:" / "Interviewer:" / host-name turn - never a line from the other party.
- better: the exact stronger question or statement the host could have used at that moment, in their own voice. Make it specific to this call, intent and focus; never generic advice.
- why: one short outcome-led reason, such as "tests whether there is a real buying process", "turns interest into a dated next step", or "brings the call back to the priority focus".
Coach kindly, honestly and specifically. Internal/product calls should be coached toward decisions and delivery, not forced into sales language. Sales calls should surface commercially important misses even when the host sounded articulate.
Before you finalise, re-check every quote: if it is the other party's line and not the host's, drop it and replace it with a real host line. Output ONLY a JSON array: [{"quote":"...","better":"...","why":"..."}] with 5 to 8 items.`;

    const strategicContext = JSON.stringify({
      callType: call.callType,
      intent: call.intent || null,
      priorityFocus: call.focus.slice(0, 10),
      dealContext: call.dealContext,
      summary: call.summary,
      existingPoints: already.map((point: any) => ({
        quote: point.quote,
        better: point.better,
      })),
    }).slice(0, 8000);

    const coachingTranscript = buildStrategicCoachingTranscript(
      call.transcript,
      call.viewerName,
      30000,
      call.allowGenericHostLabels
    );
    if (coachingTranscript.length < 200) {
      return NextResponse.json({
        points: already,
        note: `There was not enough attributable speech from ${call.viewerName} to build a personal speaking debrief.`,
      });
    }

    const msg = await openai.messages.create({
      model: OPENAI_MODEL_PRO,
      max_tokens: 1800,
      temperature: 0.4,
      system,
      messages: [
        {
          role: "user",
          content: `CALL CONTEXT (use this to judge what mattered):\n${strategicContext}\n\nSELECTED MOMENTS FROM THE FULL CALL (speaker-labelled and chronological):\n${coachingTranscript}\n\nDo not repeat an existing point. Return the JSON array of strategic coaching points now.`,
        },
      ],
    });
    await logModelUsage("coaching-debrief", "pro", (msg as any).usage);
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
    const onlyHost = keepGroundedHostQuotes(
      Array.isArray(parsed) ? parsed : [],
      call.transcript,
      call.viewerName,
      call.allowGenericHostLabels
    );
    const existingFingerprints = new Set(
      already.map((point: any) =>
        normaliseCoachingText(`${point.quote || ""} ${point.better || ""}`)
      )
    );
    const rows = onlyHost
      .filter((p: any) => p && typeof p.better === "string" && p.better.trim())
      .filter(
        (p: any) =>
          !existingFingerprints.has(
            normaliseCoachingText(`${p.quote || ""} ${p.better || ""}`)
          )
      )
      .slice(0, Math.max(0, 8 - already.length))
      .map((p: any) => ({
        session_id: call.sessionId,
        company_id: call.companyId,
        quote: typeof p.quote === "string" ? p.quote.trim() : "",
        better: String(p.better).trim(),
        why: typeof p.why === "string" ? p.why.trim() : "",
      }));
    if (!rows.length)
      return NextResponse.json({
        points: already,
        note: already.length
          ? "No additional grounded coaching moments were found."
          : "No grounded coaching moments were found for this speaker.",
      });
    const { error: insertError } = await supabaseAdmin
      .from("coaching_points")
      .insert(rows)
      .select("id, quote, better, why, vote, created_at");
    if (insertError) throw insertError;
    const saved = keepGroundedHostQuotes(
      await existingPoints(call.sessionId),
      call.transcript,
      call.viewerName,
      call.allowGenericHostLabels
    );
    return NextResponse.json({ points: saved });
  } catch (err: any) {
    return NextResponse.json(
      { points: [], error: err?.message || "coaching failed" },
      { status: 200 }
    );
  }
}
