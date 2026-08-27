import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { londonDayBounds } from "@/lib/outreach";
import { requireRequestScope } from "@/lib/request-scope";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const summaryOnly = req.nextUrl.searchParams.get("summary") === "1";
    const { start, end } = londonDayBounds();
    const [sent, sentAll, approved, replies, positive, meetings, prospects, manualCalls] = await Promise.all([
      supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("sender_user_id", account.userId).eq("status", "sent").gte("sent_at", start).lt("sent_at", end),
      supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("sender_user_id", account.userId).eq("status", "sent"),
      supabaseAdmin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("sender_user_id", account.userId).eq("status", "approved"),
      supabaseAdmin.from("outreach_events").select("id,message:outreach_messages!inner(sender_user_id)", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("message.sender_user_id", account.userId).in("kind", ["reply", "positive_reply", "objection", "later", "referral", "unsubscribe"]),
      supabaseAdmin.from("outreach_events").select("id,message:outreach_messages!inner(sender_user_id)", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("message.sender_user_id", account.userId).eq("kind", "positive_reply"),
      supabaseAdmin.from("outreach_events").select("id,message:outreach_messages!inner(sender_user_id)", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("message.sender_user_id", account.userId).eq("kind", "meeting_booked"),
      supabaseAdmin.from("outreach_prospects").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("assigned_to_user_id", account.userId),
      supabaseAdmin.from("outreach_events").select("id,prospect_id,metadata,created_at").eq("workspace_id", account.workspaceId).eq("owner_id", account.userId).eq("kind", "manual_call").order("created_at", { ascending: false }).limit(10000),
    ]);
    for (const result of [sent, sentAll, approved, replies, positive, meetings, prospects, manualCalls]) {
      if (result.error) throw result.error;
    }
    const personalCalls = manualCalls.data || [];
    const connectedOutcomes = new Set(["connected", "meeting_booked", "callback_requested", "not_now"]);
    const metrics = {
      sentToday: sent.count || 0,
      sent: sentAll.count || 0,
      approved: approved.count || 0,
      replies: replies.count || 0,
      positiveReplies: positive.count || 0,
      meetings: meetings.count || 0,
      prospects: prospects.count || 0,
      callsToday: personalCalls.filter((call: any) => call.created_at >= start && call.created_at < end).length,
      calls: personalCalls.length,
      connectedCalls: personalCalls.filter((call: any) => connectedOutcomes.has(call.metadata?.outcome)).length,
      callMeetings: personalCalls.filter((call: any) => call.metadata?.outcome === "meeting_booked").length,
    };
    // The default Today queue needs only five small counts. Avoid loading every
    // historical message, reply and learning until a reporting tab is opened.
    if (summaryOnly) return NextResponse.json(
      { metrics, scope: "personal" },
      { headers: { "Cache-Control": "private, no-store" } }
    );
    const detailResults = await Promise.all([
      supabaseAdmin.from("outreach_prospects").select("id,first_name,last_name,company_name,email,reply_category,reply_summary,last_reply_at,status,crm_company_id,personal_messages:outreach_messages!inner(sender_user_id,status)").eq("workspace_id", account.workspaceId).eq("personal_messages.sender_user_id", account.userId).eq("personal_messages.status", "sent").not("last_reply_at", "is", null).order("last_reply_at", { ascending: false }).limit(50),
      supabaseAdmin.from("outreach_messages").select("prospect_id,variant,message_tags,campaign_id").eq("workspace_id", account.workspaceId).eq("sender_user_id", account.userId).eq("status", "sent"),
      supabaseAdmin.from("outreach_events").select("prospect_id,kind,metadata,campaign_id,message:outreach_messages!inner(sender_user_id)").eq("workspace_id", account.workspaceId).eq("message.sender_user_id", account.userId).in("kind", ["reply", "positive_reply", "objection", "later", "referral", "unsubscribe", "meeting_booked"]),
      supabaseAdmin.from("outreach_messages").select("*").eq("workspace_id", account.workspaceId).eq("sender_user_id", account.userId).eq("step_number", 10).in("status", ["draft", "approved", "sent"]).order("updated_at", { ascending: false }),
      supabaseAdmin.from("outreach_learnings").select("*").eq("workspace_id", account.workspaceId).eq("owner_id", account.userId).order("meeting_count", { ascending: false }).order("positive_reply_count", { ascending: false }).limit(100),
      supabaseAdmin.from("outreach_messages").select("id,prospect_id,subject,body_text,status,step_number,sent_at,from_email").eq("workspace_id", account.workspaceId).eq("sender_user_id", account.userId).eq("status", "sent").order("sent_at", { ascending: false }).limit(100),
    ]);
    for (const result of detailResults) if (result.error) throw result.error;
    const [
      { data: recentReplies },
      { data: variantMessages },
      { data: variantReplies },
      { data: replyDrafts },
      { data: learnings },
      { data: recentMessages },
    ] = detailResults;
    const variants = ["A", "B"].map((variant) => {
      const sentCount = (variantMessages || []).filter((row: any) => (row.variant || "A") === variant).length;
      const replyCount = (variantReplies || []).filter((row: any) => row.kind !== "meeting_booked" && (row.metadata?.variant || "A") === variant).length;
      return { variant, sent: sentCount, replies: replyCount, replyRate: sentCount ? Math.round((replyCount / sentCount) * 1000) / 10 : 0 };
    });
    const recentMessageProspectIds = (recentMessages || []).map((message: any) => message.prospect_id);
    const recentManualCallProspectIds = personalCalls.slice(0, 100).map((call: any) => call.prospect_id);
    const messageProspectIds = Array.from(new Set([...recentMessageProspectIds, ...recentManualCallProspectIds]));
    const { data: messageProspects } = messageProspectIds.length
      ? await supabaseAdmin
          .from("outreach_prospects")
          .select("id,first_name,last_name,company_name,email,last_reply_at,reply_category")
          .eq("workspace_id", account.workspaceId)
          .in("id", messageProspectIds)
      : { data: [] as any[] };
    const messageProspectMap = new Map((messageProspects || []).map((prospect: any) => [prospect.id, prospect]));
    const sentHistory = (recentMessages || []).map((message: any) => ({
      ...message,
      prospect: messageProspectMap.get(message.prospect_id) || null,
    }));
    const manualCallHistory = personalCalls.slice(0, 100).map((call: any) => ({
      ...call,
      prospect: messageProspectMap.get(call.prospect_id) || null,
    }));
    const linkedCompanyIds = Array.from(
      new Set(
        (recentReplies || [])
          .map((reply: any) => reply.crm_company_id)
          .filter(Boolean)
      )
    );
    const { data: linkedCompanies } = linkedCompanyIds.length
      ? await supabaseAdmin
          .from("companies")
          .select("id,name")
          .eq("workspace_id", account.workspaceId)
          .in("id", linkedCompanyIds)
      : { data: [] as any[] };
    const linkedCompanyNames = new Map(
      (linkedCompanies || []).map((company: any) => [company.id, company.name])
    );
    const bookingByProspect = new Map(
      (variantReplies || [])
        .filter((event: any) => event.kind === "meeting_booked")
        .map((event: any) => [event.prospect_id, event.metadata || {}])
    );
    const replyDraftByProspect = new Map((replyDrafts || []).map((draft: any) => [draft.prospect_id, draft]));
    const replyRows = (recentReplies || []).map((reply: any) => {
      const personalReply = { ...reply };
      delete personalReply.personal_messages;
      return {
        ...personalReply,
        bookingDraft: replyDraftByProspect.get(reply.id) || null,
        crmCompany: reply.crm_company_id
          ? {
              id: reply.crm_company_id,
              name: linkedCompanyNames.get(reply.crm_company_id) || reply.company_name,
            }
          : null,
        bookedMeeting: bookingByProspect.get(reply.id) || null,
      };
    });
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
    return NextResponse.json(
      { metrics, replies: replyRows, sentHistory, manualCalls: manualCallHistory, variants, performance, learnings: learnings || [], scope: "personal" },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to load outreach metrics" }, { status: 500 });
  }
}
