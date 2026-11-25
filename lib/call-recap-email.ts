import "server-only";
import { createHash } from "node:crypto";
import { supabaseService } from "@/lib/supabase";
import { resolveRecordScope, type RecordScope } from "@/lib/record-scope";
import { setAppConfigValue } from "@/lib/app-config";
import { connectedMailProvider, sendConnectedMail } from "@/lib/mail";
import { loadHostIdentityForUser } from "@/lib/speakers";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { CALL_RECAP_KEY, CALL_RECAP_CURSOR_KEY, CALL_RECAP_GENERATION, CALL_RECAP_DETAIL_INSTRUCTIONS, CALL_RECAP_DETAIL_FORMAT, CALL_RECAP_DETAIL_REVIEW_FORMAT, CALL_RECAP_DETAIL_REVIEW_INSTRUCTIONS, detailedRecapReviewInput, selectReviewedCallRecap, callRecapReviewMessage, callRecapPassages, callRecapParticipants, recapPreference, validateDetailedCallRecap, renderCallRecap } from "@/lib/call-recap";

const receiptQuery = (scope: RecordScope) => supabaseService.from("call_recap_emails").select("*").eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const textOf = (r: any) => (r?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
const uncertainMessage = "Email delivery was not confirmed. Check your inbox and sent mail before contacting support. LiveCoach will not send another copy automatically.";

export async function requireActiveRecapScope(): Promise<RecordScope> {
  const scope = await resolveRecordScope();
  const { data, error } = await supabaseService.from("workspace_members").select("user_id")
    .eq("workspace_id", scope.workspaceId).eq("user_id", scope.userId).eq("status", "active").maybeSingle();
  if (error || !data) throw new Error("RECAP_ACCESS_DENIED");
  return scope;
}

async function configValue(scope: RecordScope, key: string) {
  // Personal preferences must NEVER inherit a team-visible configuration.
  const { data, error } = await supabaseService.from("app_config").select("value")
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("visibility", "private").eq("key", key).maybeSingle();
  if (error) throw error;
  return data?.value || null;
}

export async function getCallRecapPreference() {
  const scope = await requireActiveRecapScope();
  return recapPreference(await configValue(scope, CALL_RECAP_KEY));
}

export async function saveCallRecapPreference(enabled: boolean) {
  await requireActiveRecapScope();
  const previous = await getCallRecapPreference();
  const value = { enabled, enabledSince: enabled ? (previous.enabled ? previous.enabledSince : new Date().toISOString()) : previous.enabledSince };
  const saved = await setAppConfigValue({ key: CALL_RECAP_KEY, value: JSON.stringify(value), visibility: "private", note: "Email only this user's connected mailbox with a shareable recap of newly completed calls" });
  return recapPreference(saved.value);
}

export async function getCallRecapReceipts(callId?: string) {
  const scope = await requireActiveRecapScope();
  let query = supabaseService.from("call_recap_emails")
    .select("call_id,status,recipient,sent_at,last_error,created_at")
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId);
  if (callId) query = query.eq("call_id", callId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(callId ? 1 : 5);
  if (error) throw error;
  return data || [];
}

// Poll persisted summaries, not the browser. A cursor and unique session receipt
// cover manual finishes, auto-ended calls and delayed recovery without replaying
// old transcripts or adding work to the live end-call response.
export async function discoverCallRecapEmails() {
  const scope = await requireActiveRecapScope();
  const preference = await getCallRecapPreference();
  if (!preference.enabled || !preference.enabledSince) return;
  let cursor: any = null;
  try { cursor = JSON.parse(await configValue(scope, CALL_RECAP_CURSOR_KEY) || "null"); } catch { /* restart safely through unique receipts */ }
  let query = supabaseService.from("interview_summaries").select("id,session_id,created_at")
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId)
    .gte("created_at", preference.enabledSince);
  if (cursor?.enabledSince === preference.enabledSince && typeof cursor.at === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.at) && Number.isFinite(Date.parse(cursor.at)) && /^[0-9a-f-]{36}$/i.test(cursor.id)) {
    // Preserve Postgres microseconds. JS Date would round the cursor backwards.
    query = query.or(`created_at.gt.${cursor.at},and(created_at.eq.${cursor.at},id.gt.${cursor.id})`);
  }
  const { data, error } = await query.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(50);
  if (error) throw error;
  const calls = data || [];
  if (!calls.length) return;
  const pending = calls.filter((c: any) => c.session_id).map((c: any) => ({ workspace_id: scope.workspaceId, owner_id: scope.userId, call_id: c.id, session_id: c.session_id }));
  if (pending.length) {
    const { error: saveError } = await supabaseService.from("call_recap_emails").upsert(pending, { onConflict: "workspace_id,owner_id,session_id", ignoreDuplicates: true });
    if (saveError) throw saveError;
  }
  const last = calls[calls.length - 1];
  await setAppConfigValue({ key: CALL_RECAP_CURSOR_KEY, value: JSON.stringify({ enabledSince: preference.enabledSince, at: last.created_at, id: last.id }), visibility: "private" });
}

async function loadRecapSource(scope: RecordScope, receipt: any) {
  const [{ data: call, error: callError }, { data: session, error: sessionError }] = await Promise.all([
    supabaseService.from("interview_summaries").select("id,session_id")
      .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", receipt.call_id).eq("session_id", receipt.session_id).maybeSingle(),
    // No prep, brief, userNotes, private CRM history or internal scorecard.
    supabaseService.from("interview_sessions").select("transcript,started_at,ended_at,created_at")
      .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("session_id", receipt.session_id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (callError || sessionError) throw new Error("RECAP_SOURCE_READ_FAILED");
  if (!call || !session || !session.ended_at) return null;
  return session;
}

export async function processCallRecapEmail(id: string) {
  const scope = await requireActiveRecapScope();
  const preference = await getCallRecapPreference();
  if (!preference.enabled) return;
  const { data: row, error } = await receiptQuery(scope).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("RECAP_ACCESS_DENIED");
  const now = new Date().toISOString();
  if (row.lease_until && row.lease_until > now) return;
  if (row.status === "sending") {
    // Includes hard timeouts after provider acceptance. Never blindly resend.
    const { error: updateError } = await supabaseService.from("call_recap_emails")
      .update({ status: "uncertain", last_error: uncertainMessage, updated_at: now })
      .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", id).eq("status", "sending");
    if (updateError) throw updateError;
    return;
  }
  if (!["queued", "preparing", "ready"].includes(row.status)) return;
  const lease = new Date(Date.now() + 180000).toISOString();
  const { data: claim, error: claimError } = await supabaseService.from("call_recap_emails")
    .update({ status: "preparing", attempts: row.attempts + 1, lease_until: lease, updated_at: now })
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", id)
    .eq("status", row.status).eq("attempts", row.attempts).select("id").maybeSingle();
  if (claimError) throw claimError;
  if (!claim) return;
  const update = async (values: Record<string, unknown>) => {
    const { data, error } = await supabaseService.from("call_recap_emails")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", id).eq("lease_until", lease).select("id").maybeSingle();
    if (error || !data) throw new Error("RECAP_SAVE_NOT_CONFIRMED");
  };
  let sendClaimed = false;
  try {
    const session = await loadRecapSource(scope, row);
    if (!session) throw new Error("RECAP_SOURCE_NOT_READY");
    if (Date.parse(session.ended_at) < Date.parse(preference.enabledSince!)) {
      await update({ status: "skipped", lease_until: null, last_error: "This call ended before recap emails were enabled." });
      return;
    }
    const transcript = String(session.transcript || "").trim();
    if (transcript.length < 30 || transcript.length > 180000) throw new Error("RECAP_REVIEW_REQUIRED_LIMITS");
    const sourceHash = hash(transcript);
    const host = await loadHostIdentityForUser(scope.userId, scope.workspaceId);
    let recap = row.source_hash === sourceHash && row.recap?.version === CALL_RECAP_GENERATION ? row.recap : null;
    if (!recap) {
      let parsed: any = row.source_hash === sourceHash && row.recap?.version === 0 && row.recap?.generation === CALL_RECAP_GENERATION ? row.recap.proposed : null;
      if (!parsed) {
        const response = await openai.messages.create({ model: OPENAI_MODEL_LIVE, max_tokens: 14000, temperature: 0,
          system: CALL_RECAP_DETAIL_INSTRUCTIONS,
          response_format: CALL_RECAP_DETAIL_FORMAT,
          messages: [{ role: "user", content: JSON.stringify({ hostName: host.name, passages: callRecapPassages(transcript) }) }],
        });
        await logModelUsage("call_recap_email", "live", (response as any).usage, { stop_reason: response.stop_reason, receipt_id: id }, scope);
        if (response.stop_reason === "max_tokens") throw new Error("RECAP_REVIEW_REQUIRED_FORMAT");
        try { parsed = JSON.parse(textOf(response)); } catch { throw new Error("RECAP_REVIEW_REQUIRED_FORMAT"); }
        // Private, unapproved proposal with passage IDs only, no copied source.
        // It is NEVER eligible for sending or returned by the browser API.
        // Keeping it allows a failed check to be diagnosed without paying to
        // re-extract the unchanged call. Only the current generation passes
        // both detail and coverage checks. Already-sent receipts never replay.
        await update({ recap: { version: 0, generation: CALL_RECAP_GENERATION, proposed: parsed }, source_hash: sourceHash });
      }
      recap = validateDetailedCallRecap(parsed, transcript, host.name || "");
      // The review sees all safe passages, not only the chosen bullets, so it
      // can catch missing requests as well as unsafe or incorrect claims.
      const review = await openai.messages.create({ model: OPENAI_MODEL_LIVE, max_tokens: 2200, temperature: 0,
        system: CALL_RECAP_DETAIL_REVIEW_INSTRUCTIONS,
        response_format: CALL_RECAP_DETAIL_REVIEW_FORMAT,
        messages: [{ role: "user", content: JSON.stringify(detailedRecapReviewInput(recap, parsed, transcript, host.name)) }],
      });
      await logModelUsage("call_recap_privacy_review", "live", (review as any).usage, {}, scope);
      let verdict: any;
      try { verdict = JSON.parse(textOf(review)); } catch { throw new Error("RECAP_REVIEW_REQUIRED_PRIVACY"); }
      if (review.stop_reason === "max_tokens") throw new Error("RECAP_REVIEW_REQUIRED_PRIVACY");
      if (verdict.coverageComplete !== true) throw new Error("RECAP_REVIEW_REQUIRED_COVERAGE");
      recap = selectReviewedCallRecap(recap, verdict);
      await update({ status: "ready", recap, source_hash: sourceHash, meeting_at: session.started_at || session.created_at, last_error: null });
    }
    // Recheck live permissions and consent after model work, immediately before
    // sending. A revoked account cannot finish an already-running delivery.
    await requireActiveRecapScope();
    const latestPreference = await getCallRecapPreference();
    if (!latestPreference.enabled || latestPreference.enabledSince !== preference.enabledSince) {
      await update({ status: "skipped", lease_until: null, last_error: "Recap emails were turned off before sending." });
      return;
    }
    const latest = await loadRecapSource(scope, row);
    if (!latest || hash(String(latest.transcript || "").trim()) !== sourceHash) throw new Error("RECAP_SOURCE_CHANGED");
    const connection = await connectedMailProvider(scope.userId);
    const recipient = String(connection.email || "").trim().toLowerCase();
    if (!connection.provider || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("RECAP_MAILBOX_UNAVAILABLE");
    // Formatting is universal, but priority order is the exact recipient's.
    // Refresh attendees from this verified source even when using cached v2 data.
    const message = renderCallRecap({ ...recap, participants: callRecapParticipants(transcript, host.name) }, session.started_at || session.created_at, { recipientName: host.name });
    // Durable send barrier. Even if the process dies, the next run only reports
    // an uncertain outcome. It never retries the external side effect.
    await update({ status: "sending", recipient, last_error: null });
    sendClaimed = true;
    const sent = await sendConnectedMail({ to: recipient, ...message }, scope.userId);
    if (!sent.ok) throw new Error("RECAP_DELIVERY_UNCONFIRMED");
    await update({ status: "sent", provider_message_id: sent.id || null, sent_at: new Date().toISOString(), lease_until: null, last_error: null });
  } catch (error: any) {
    const code = String(error?.message || "");
    const review = code.startsWith("RECAP_REVIEW_REQUIRED") || row.attempts >= 2;
    await update({ status: sendClaimed ? "uncertain" : review ? "needs_review" : "queued",
      lease_until: sendClaimed || review ? null : new Date(Date.now() + 300000).toISOString(),
      last_error: sendClaimed ? uncertainMessage : review ? callRecapReviewMessage(code) : "Your call is saved. The recap email is waiting for preparation or a connected mailbox. LiveCoach will check again automatically.",
    });
  }
}

export async function runCallRecapEmails() {
  const scope = await requireActiveRecapScope();
  if (!(await getCallRecapPreference()).enabled) return { processed: 0 };
  await discoverCallRecapEmails();
  const { data, error } = await receiptQuery(scope).in("status", ["queued", "preparing", "ready", "sending"])
    .or(`lease_until.is.null,lease_until.lte.${new Date().toISOString()}`).order("created_at", { ascending: true }).limit(3);
  if (error) throw error;
  await Promise.all((data || []).map((r: any) => processCallRecapEmail(r.id)));
  return { processed: data?.length || 0 };
}
