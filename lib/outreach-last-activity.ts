// Compare timestamps rather than preferring an older reply over a new action.
export function outreachLastActivityAt(prospect: {
  [key: string]: any;
  last_reply_at?: string | null; updated_at?: string | null; source_metadata?: any;
  outreach?: { latestSentMessage?: { sent_at?: string | null } | null; latestMessage?: { updated_at?: string | null } | null } | null;
}): string | null {
  const dates = [prospect.last_reply_at, prospect.source_metadata?.latest_notification_action?.at,
    prospect.source_metadata?.latest_manual_call?.occurredAt, prospect.outreach?.latestSentMessage?.sent_at,
    prospect.outreach?.latestMessage?.updated_at, prospect.updated_at];
  return dates.filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}
