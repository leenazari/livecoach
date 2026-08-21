type RecallStatusChange = {
  code?: unknown;
  created_at?: unknown;
};

const TERMINAL_CODES = new Set(["call_ended", "done", "fatal"]);

export function currentRecallBotState(payload: unknown) {
  const changes = Array.isArray((payload as any)?.status_changes)
    ? ((payload as any).status_changes as RecallStatusChange[])
    : [];
  const latest = changes.reduce<RecallStatusChange | null>((current, change) => {
    const timestamp = Date.parse(String(change?.created_at || ""));
    if (!Number.isFinite(timestamp)) return current;
    if (!current) return change;
    const currentTimestamp = Date.parse(String(current.created_at || ""));
    return !Number.isFinite(currentTimestamp) || timestamp > currentTimestamp
      ? change
      : current;
  }, null);
  const code = String(latest?.code || "")
    .trim()
    .toLowerCase()
    .replace(/^bot[._]/, "");
  const endedAt = latest?.created_at
    ? new Date(String(latest.created_at)).toISOString()
    : null;
  return {
    code,
    terminal: TERMINAL_CODES.has(code),
    endedAt,
  };
}
