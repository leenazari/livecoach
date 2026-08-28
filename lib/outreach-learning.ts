import { supabaseAdmin } from "@/lib/supabase";

const DIMENSIONS = ["tone", "angle", "cta", "persona"] as const;

export async function refreshOutreachLearnings() {
  const [{ data: messages }, { data: events }] = await Promise.all([
    supabaseAdmin.from("outreach_messages").select("id,campaign_id,prospect_id,message_tags,sent_at").eq("status", "sent").eq("message_source", "campaign").not("campaign_id", "is", null).order("sent_at", { ascending: true }).limit(10000),
    supabaseAdmin.from("outreach_events").select("campaign_id,prospect_id,kind").not("campaign_id", "is", null).in("kind", ["reply", "positive_reply", "objection", "later", "referral", "meeting_booked"]).limit(10000),
  ]);
  const eventByCampaignProspect = new Map<string, Set<string>>();
  for (const event of events || []) {
    const key = `${event.campaign_id}:${event.prospect_id}`;
    const kinds = eventByCampaignProspect.get(key) || new Set<string>();
    kinds.add(event.kind);
    eventByCampaignProspect.set(key, kinds);
  }
  const groups = new Map<string, { campaignId: string; dimension: string; label: string; sent: Set<string>; replies: Set<string>; positive: Set<string>; meetings: Set<string> }>();
  const latestMessageByProspect = new Map<string, string>();
  for (const message of messages || []) latestMessageByProspect.set(`${message.campaign_id}:${message.prospect_id}`, message.id);
  for (const message of messages || []) {
    const tags = message.message_tags && typeof message.message_tags === "object" ? message.message_tags : {};
    for (const dimension of DIMENSIONS) {
      const label = String(tags[dimension] || "").trim().toLowerCase();
      if (!label) continue;
      const key = `${message.campaign_id}:${dimension}:${label}`;
      const group = groups.get(key) || { campaignId: message.campaign_id, dimension, label, sent: new Set<string>(), replies: new Set<string>(), positive: new Set<string>(), meetings: new Set<string>() };
      group.sent.add(message.prospect_id);
      const kinds = eventByCampaignProspect.get(`${message.campaign_id}:${message.prospect_id}`) || new Set<string>();
      const isLatest = latestMessageByProspect.get(`${message.campaign_id}:${message.prospect_id}`) === message.id;
      if (isLatest && [...kinds].some((kind) => ["reply", "positive_reply", "objection", "later", "referral"].includes(kind))) group.replies.add(message.prospect_id);
      if (isLatest && kinds.has("positive_reply")) group.positive.add(message.prospect_id);
      if (isLatest && kinds.has("meeting_booked")) group.meetings.add(message.prospect_id);
      groups.set(key, group);
    }
  }
  const rows = [...groups.values()].filter((group) => group.sent.size >= 5).map((group) => {
    const positiveRate = Math.round((group.positive.size / group.sent.size) * 1000) / 10;
    const replyRate = Math.round((group.replies.size / group.sent.size) * 1000) / 10;
    const confidence = group.sent.size >= 30 && group.positive.size >= 5 ? "strong" : group.sent.size >= 10 ? "directional" : "early";
    const promoted = group.sent.size >= 10 && (group.positive.size >= 2 || group.meetings.size >= 1);
    return {
      campaign_id: group.campaignId,
      dimension: group.dimension,
      label: group.label,
      insight: `${positiveRate}% positive reply rate, ${replyRate}% total reply rate and ${group.meetings.size} meeting${group.meetings.size === 1 ? "" : "s"} from ${group.sent.size} prospects.`,
      sent_count: group.sent.size,
      reply_count: group.replies.size,
      positive_reply_count: group.positive.size,
      meeting_count: group.meetings.size,
      confidence,
      status: promoted ? "promoted" : "observing",
      evidence: { positiveRate, replyRate },
      updated_at: new Date().toISOString(),
    };
  });
  if (rows.length) await supabaseAdmin.from("outreach_learnings").upsert(rows, { onConflict: "campaign_id,dimension,label" });
  return { groups: rows.length, promoted: rows.filter((row) => row.status === "promoted").length };
}
