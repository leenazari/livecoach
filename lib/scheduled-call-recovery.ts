import "server-only";

import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseService } from "@/lib/supabase";

// Reuse the existing summary recovery job. No provider poll, new AI pass or
// duplicate transcript store is needed to recover an unattended scheduled call.
export async function recoverScheduledCallInputs(
  haveSummary: Set<string>,
  dueForRetry: (attempts: number, lastTry: string | null) => boolean,
  nowMs = Date.now()
) {
  const scope = await resolveRecordScope();
  const since = new Date(nowMs - 14 * 86400000).toISOString();
  const { data: subscriptions, error: subscriptionError } = await supabaseService
    .from("meet_capture_subscribers")
    .select("capture_id,session_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (subscriptionError) throw subscriptionError;
  const pending = (subscriptions || []).filter((row) => !haveSummary.has(row.session_id));
  if (!pending.length) return { recovered: [], scheduledSessionIds: [] as string[] };

  const { data: captures, error: captureError } = await supabaseService
    .from("meet_bots")
    .select("id,bot_id,status,ended_at")
    .eq("workspace_id", scope.workspaceId)
    .in("id", Array.from(new Set(pending.map((row) => row.capture_id))))
    .gte("scheduled_join_at", since);
  if (captureError) throw captureError;
  const captureById = new Map((captures || []).map((row) => [row.id, row]));
  const sessionIds = pending.filter((row) => captureById.has(row.capture_id)).map((row) => row.session_id);
  if (!sessionIds.length) return { recovered: [], scheduledSessionIds: [] as string[] };

  const { data: sessions, error: sessionError } = await supabaseService
    .from("interview_sessions")
    .select("session_id,company_id,workstream_id,candidate,role,call_type,competencies,transcript,created_at,upcoming_id,updated_at,ended_at,summary_attempts,summary_last_try")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .in("session_id", sessionIds);
  if (sessionError) throw sessionError;

  const recovered: any[] = [];
  for (const session of sessions || []) {
    if (!dueForRetry(Number(session.summary_attempts || 0), session.summary_last_try)) continue;
    const subscription = pending.find((row) => row.session_id === session.session_id);
    const capture = subscription && captureById.get(subscription.capture_id);
    if (!capture) continue;
    // Even if a browser stopped writing notes, recent canonical speech means
    // the call is still live. Never summarise it in the middle of a meeting.
    const { data: last, error: lastError } = await supabaseService
      .from("meet_utterances")
      .select("created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("bot_id", capture.bot_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw lastError;
    if (!last || nowMs - Date.parse(last.created_at) < 15 * 60000) continue;

    const lines: string[] = [];
    // Supabase caps page sizes. Read the complete stored capture in bounded
    // pages and fail safely rather than silently summarising a truncated call.
    for (let offset = 0; offset < 20000; offset += 1000) {
      const { data: rows, error } = await supabaseService
        .from("meet_utterances")
        .select("id,speaker,text,created_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("bot_id", capture.bot_id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      for (const row of rows || []) {
        if (String(row.text || "").trim()) {
          lines.push(`${String(row.speaker || "Speaker").trim()}: ${String(row.text).trim()}`);
        }
      }
      if ((rows || []).length < 1000) break;
      if (offset === 19000) throw new Error("Scheduled capture exceeds the safe recovery limit");
    }
    const transcript = lines.join("\n");
    if (transcript.length < 500) continue;
    const endedAt = session.ended_at || capture.ended_at || last.created_at;
    if (!session.ended_at) {
      const { error } = await supabaseService.from("interview_sessions")
        .update({ ended_at: endedAt })
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("session_id", session.session_id)
        .is("ended_at", null);
      if (error) throw error;
    }
    recovered.push({
      ...session,
      transcript,
      ended_at: endedAt,
      updated_at: last.created_at,
    });
  }
  return { recovered, scheduledSessionIds: sessionIds };
}
