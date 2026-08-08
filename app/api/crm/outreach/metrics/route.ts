import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { londonDayBounds } from "@/lib/outreach";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { start, end } = londonDayBounds();
    const [sent, approved, replies, positive, prospects] = await Promise.all([
      supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", start).lt("sent_at", end),
      supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("status", "approved"),
      supabaseAdmin.from("outreach_events").select("id", { count: "exact", head: true }).in("kind", ["reply", "positive_reply", "objection", "later", "referral", "unsubscribe"]),
      supabaseAdmin.from("outreach_events").select("id", { count: "exact", head: true }).eq("kind", "positive_reply"),
      supabaseAdmin.from("outreach_prospects").select("id", { count: "exact", head: true }),
    ]);
    const [{ data: recentReplies }, { data: variantMessages }, { data: variantReplies }] = await Promise.all([
      supabaseAdmin.from("outreach_prospects").select("id,first_name,last_name,company_name,email,reply_category,reply_summary,last_reply_at,status").not("last_reply_at", "is", null).order("last_reply_at", { ascending: false }).limit(50),
      supabaseAdmin.from("outreach_messages").select("variant").eq("status", "sent"),
      supabaseAdmin.from("outreach_events").select("metadata").in("kind", ["reply", "positive_reply", "objection", "later", "referral", "unsubscribe"]),
    ]);
    const variants = ["A", "B"].map((variant) => {
      const sentCount = (variantMessages || []).filter((row: any) => (row.variant || "A") === variant).length;
      const replyCount = (variantReplies || []).filter((row: any) => (row.metadata?.variant || "A") === variant).length;
      return { variant, sent: sentCount, replies: replyCount, replyRate: sentCount ? Math.round((replyCount / sentCount) * 1000) / 10 : 0 };
    });
    return NextResponse.json({ metrics: { sentToday: sent.count || 0, approved: approved.count || 0, replies: replies.count || 0, positiveReplies: positive.count || 0, prospects: prospects.count || 0 }, replies: recentReplies || [], variants });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to load outreach metrics" }, { status: 500 });
  }
}
