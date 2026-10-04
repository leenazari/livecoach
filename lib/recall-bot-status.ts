type RecallStatusChange = {
  code?: unknown;
  sub_code?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  message?: unknown;
};

const TERMINAL_CODES = new Set(["call_ended", "done", "fatal"]);

export type RecallBotPhase =
  | "scheduled"
  | "joining"
  | "waiting_room"
  | "in_call_not_recording"
  | "recording"
  | "ended"
  | "failed"
  | "unknown";

function normaliseCode(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^bot[._]/, "");
}

function normaliseSubCode(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function changeTimestamp(change: RecallStatusChange) {
  return Date.parse(String(change.created_at || change.updated_at || ""));
}

function latestChange(
  changes: RecallStatusChange[],
  predicate: (change: RecallStatusChange) => boolean = () => true
) {
  return changes.reduce<RecallStatusChange | null>((current, change) => {
    if (!predicate(change)) return current;
    const timestamp = changeTimestamp(change);
    if (!Number.isFinite(timestamp)) return current;
    if (!current) return change;
    const currentTimestamp = changeTimestamp(current);
    return !Number.isFinite(currentTimestamp) || timestamp > currentTimestamp
      ? change
      : current;
  }, null);
}

function failureMessage(subCode: string) {
  const messages: Record<string, string> = {
    google_meet_bot_blocked:
      "Google blocked the notetaker before it reached the waiting room. Retry once. If it repeats, the meeting needs a signed-in notetaker or different Meet access settings.",
    google_meet_internal_error:
      "Google Meet returned an internal error before the notetaker joined. Retry the notetaker once.",
    google_meet_sign_in_failed:
      "The notetaker could not sign in to Google Meet. Its Google login needs attention before this meeting can be captured.",
    google_meet_sign_in_captcha_failed:
      "Google challenged the notetaker with a sign-in check, so it could not reach the meeting.",
    google_meet_sign_in_missing_login_credentials:
      "This Meet needs a signed-in participant, but no Google login is configured for the notetaker.",
    google_meet_login_not_available:
      "No configured Google notetaker login was available for this meeting.",
    meeting_requires_sign_in:
      "This meeting only accepts signed-in participants, but the notetaker is not configured with a suitable login.",
    meeting_not_started:
      "The meeting had not started when the notetaker tried to join. Open the meeting, then retry the notetaker.",
    meeting_not_found:
      "The meeting provider could not find a meeting at this link. Check the link before retrying.",
    meeting_link_invalid:
      "The meeting link was rejected as invalid. Check the link before retrying.",
    meeting_link_expired:
      "The meeting link has expired. Use the current meeting link before retrying.",
    meeting_not_accessible:
      "The meeting access settings blocked the notetaker before it could join.",
    failed_to_launch_in_time:
      "The notetaker provider could not launch the bot in time. Retry the notetaker.",
  };
  return (
    messages[subCode] ||
    `The notetaker failed before it could capture the call. Blocker code ${
      subCode || "unknown"
    }.`
  );
}

function endedMessage(subCode: string) {
  const messages: Record<string, string> = {
    timeout_exceeded_waiting_room:
      "The notetaker left after waiting too long to be admitted.",
    timeout_exceeded_noone_joined:
      "The notetaker left because nobody else joined the meeting.",
    timeout_exceeded_in_call_not_recording:
      "The notetaker joined but never began recording, so it left automatically.",
    timeout_exceeded_silence:
      "The notetaker ended after five continuous minutes without speech.",
    bot_kicked_from_call: "The notetaker was removed from the meeting.",
    host_ended_meeting: "The meeting host ended the meeting.",
    meeting_ended:
      "The meeting had already ended before the notetaker could capture it.",
  };
  return messages[subCode] || "The notetaker has left the meeting.";
}

function phaseFor(code: string): RecallBotPhase {
  if (code === "joining_call") return "joining";
  if (code === "in_waiting_room") return "waiting_room";
  if (
    code === "in_call_not_recording" ||
    code === "recording_permission_allowed" ||
    code === "recording_permission_denied"
  ) {
    return "in_call_not_recording";
  }
  if (code === "in_call_recording") return "recording";
  if (code === "fatal") return "failed";
  if (code === "call_ended" || code === "done") return "ended";
  return "unknown";
}

function messageFor(phase: RecallBotPhase, code: string, subCode: string) {
  if (phase === "scheduled") {
    return "The notetaker is scheduled to join five minutes before the meeting. It is not in the waiting room yet.";
  }
  if (phase === "joining") {
    return "The notetaker is launching. It has not reached the meeting yet.";
  }
  if (phase === "waiting_room") {
    return "The notetaker is in the waiting room and needs to be admitted.";
  }
  if (phase === "recording") {
    return "The notetaker is in the meeting and recording.";
  }
  if (phase === "in_call_not_recording") {
    return code === "recording_permission_denied"
      ? "The notetaker joined, but recording permission was denied."
      : "The notetaker has joined the meeting and is preparing capture.";
  }
  if (phase === "failed") return failureMessage(subCode);
  if (phase === "ended") return endedMessage(subCode);
  return "The provider accepted the request, but has not reported a verified meeting state yet.";
}

export function currentRecallBotState(payload: unknown) {
  const changes = Array.isArray((payload as any)?.status_changes)
    ? ((payload as any).status_changes as RecallStatusChange[])
    : [];
  const latest = latestChange(changes);
  const latestCode = normaliseCode(latest?.code);
  // Recall emits `done` after both successful and failed bots. Preserve the
  // meaningful terminal cause so the UI never turns a launch failure into a
  // vague "done" state and guesses that the bot is in a waiting room.
  const terminalCause =
    latestCode === "done"
      ? latestChange(changes, (change) =>
          ["fatal", "call_ended"].includes(normaliseCode(change.code))
        ) || latest
      : latest;
  const code = normaliseCode(terminalCause?.code);
  const subCode = normaliseSubCode(terminalCause?.sub_code);
  const phase = !latest && Date.parse(String((payload as any)?.join_at || "")) > Date.now()
    ? "scheduled" : phaseFor(code);
  const everJoined = changes.some((change) =>
    [
      "in_call_not_recording",
      "recording_permission_allowed",
      "recording_permission_denied",
      "in_call_recording",
    ].includes(normaliseCode(change.code))
  );
  const latestTimestamp = latest ? changeTimestamp(latest) : Number.NaN;
  const endedAt =
    TERMINAL_CODES.has(latestCode) && Number.isFinite(latestTimestamp)
      ? new Date(latestTimestamp).toISOString()
      : null;
  return {
    code,
    subCode,
    phase,
    message: messageFor(phase, code, subCode),
    terminal: TERMINAL_CODES.has(latestCode),
    endedAt,
    changedAt: Number.isFinite(latestTimestamp)
      ? new Date(latestTimestamp).toISOString()
      : null,
    joined: everJoined,
    recording: phase === "recording",
  };
}
