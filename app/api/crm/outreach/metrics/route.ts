import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { londonDayBounds } from "@/lib/outreach";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const summaryOnly = req.nextUrl.searchParams.get("summary") === "1";
    const { start, end } = londonDayBounds();
    const [sent, approved, replies, positive, prospects] = await Promise.all([
      supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", start).lt("sent_at", end),
      supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("status", "approved"),
      supabaseAdmin.from("outreach_events").select("id", { count: "exact", head: true }).in("kind", ["reply", "positive_reply", "objection", "later", "referral", "unsubscribe"]),
      supabaseAdmin.from("outreach_events").select("id", { count: "exact", head: true }).eq("kind", "positive_reply"),
      supabaseAdmin.from("outreach_prospects").select("id", { count: "exact", head: true }),
    ]);
    const metrics = {
      sentToday: sent.count || 0,
      approved: approved.count || 0,
      replies: replies.count || 0,
      positiveReplies: positive.count || 0,
      prospects: prospects.count || 0,
    };
    // The default Today queue needs only five small counts. Avoid loading every
    // historical message, reply and learning until a reporting tab is opened.
    if (summaryOnly) return NextResponse.json({ metrics });
    const [{ data: recentReplies }, { data: variantMessages }, { data: variantReplies }, { data: replyDrafts }, { data: learnings }] = await Promise.all([
      supabaseAdmin.from("outreach_prospects").select("id,first_name,last_name,company_name,email,reply_category,reply_summary,last_reply_at,status").not("last_reply_at", "is", null).order("last_reply_at", { ascending: false }).limit(50),
      supabaseAdmin.from("outreach_messages").select("prospect_id,variant,message_tags,campaign_id").eq("status", "sent"),
      supabaseAdmin.from("outreach_events").select("prospect_id,kind,metadata,campaign_id").in("kind", ["reply", "positive_reply", "objection", "later", "referral", "unsubscribe", "meeting_booked"]),
      supabaseAdmin.from("outreach_messages").select("*").eq("step_number", 10).in("status", ["draft", "approved", "sent"]).order("updated_at", { ascending: false }),
      supabaseAdmin.from("outreach_learnings").select("*").order("meeting_count", { ascending: false }).order("positive_reply_count", { ascending: false }).limit(100),
    ]);
    const variants = ["A", "B"].map((variant) => {
      const sentCount = (variantMessages || []).filter((row: any) => (row.variant || "A") === variant).length;
      const replyCount = (variantReplies || []).filter((row: any) => row.kind !== "meeting_booked" && (row.metadata?.variant || "A") === variant).length;
      return { variant, sent: sentCount, replies: replyCount, replyRate: sentCount ? Math.round((replyCount / sentCount) * 1000) / 10 : 0 };
    });
    const replyDraftByProspect = new Map((replyDrafts || []).map((draft: any) => [draft.prospect_id, draft]));
    const replyRows = (recentReplies || []).map((reply: any) => ({ ...reply, bookingDraft: replyDraftByProspect.get(reply.id) || null }));
    const positiveProspects = new Set((variantReplies || []).filter((event: any) => event.kind === "positive_reply").map((event: any) => event.prospect_id));
    const meetingProspects = new Set((variantReplies || []).filter((event: any) => event.kind === "meeting_booked").map((event: any) => event.prospect_id));
    const performanceMap = new Map<string, any>();
    for (const message of variantMessages || []) {
      const tags = message.message_tags && typeof message.message_tags === "object" ? message.message_tags : {};
      for (const dimension of ["tone", "angle", "cta", "persona"]) {
        const label = String(tags[dimension] || "").trim();
        if (!label) continue;
        const key = `${dimension}:${label.toLowerCase()}`;
        const row = performanceMap.get(key) || { dimension, label, sent: 0, positive: 0, meetings: 0 };
        row.sent += 1;
        if (positiveProspects.has(message.prospect_id)) row.positive += 1;
        if (meetingProspects.has(message.prospect_id)) row.meetings += 1;
        performanceMap.set(key, row);
      }
    }
    const performance = [...performanceMap.values()].map((row) => ({ ...row, positiveRate: row.sent ? Math.round((row.positive / row.sent) * 1000) / 10 : 0 })).sort((a, b) => b.meetings - a.meetings || b.positiveRate - a.positiveRate).slice(0, 30);
    return NextResponse.json({ metrics, replies: replyRows, variants, performance, learnings: learnings || [] });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to load outreach metrics" }, { status: 500 });
  }
}
