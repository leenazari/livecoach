export const SALES_LEAD_EVENTS = ['page_view', 'demo_start', 'demo_completed', 'reply', 'positive_reply', 'meeting_booked', 'sales_confirmed', 'opt_out', 'negative_reply'] as const;
export function trackingIdentity(value: unknown): { slug: string; token: string } | null {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const match = url.pathname.match(/^\/([^/]+)\/p\/([^/]+)\/?$/);
    return match ? { slug: decodeURIComponent(match[1]), token: decodeURIComponent(match[2]) } : null;
  } catch { return null; }
}
export function replyEvent(category: unknown) {
  const value = String(category || '').trim().toLowerCase();
  if (['unsubscribe', 'unsubscribed', 'opt_out'].includes(value)) return 'opt_out';
  if (['negative', 'not_interested'].includes(value)) return 'negative_reply';
  return ['positive', 'interested', 'positive_reply'].includes(value) ? 'positive_reply' : 'reply';
}
export function engagementLabel(activity: Record<string, unknown> = {}) {
  for (const [key, label] of [['opt_out', 'Do not contact'], ['negative_reply', 'Not interested'], ['meeting_booked', 'Meeting booked'], ['positive_reply', 'Positive reply'], ['reply', 'Reply to review'], ['demo_completed', 'Demo completed'], ['demo_start', 'Demo started'], ['page_view', 'Page visited']] as const) if (activity[key]) return label;
  return 'No tracked activity';
}
