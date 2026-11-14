import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function POST(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const body = await req.json().catch(() => null);
    const campaignId = String(body?.campaignId || "");
    const title = String(body?.title || "").trim();
    const text = String(body?.body || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(campaignId) || title.length < 1 || title.length > 160 || text.length < 1 || text.length > 20000) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_document_blocked",
        title: "Knowledge note was not saved",
        reason: "A campaign, a title and a note of up to 20,000 characters are required.",
        nextAction: "Shorten the note if needed, then save it again. The previous notes are unchanged.",
        responsible: "owner",
        outcome: "No knowledge note was confirmed saved.",
      }), { status: 400, headers: noStore });
    }
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("interviewer_campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_document_missing_campaign",
        title: "Knowledge note was not saved",
        reason: "That campaign is not available on your account.",
        nextAction: "Reload the page and choose a campaign you can see.",
        responsible: "owner",
        outcome: "No knowledge note was saved.",
      }), { status: 404, headers: noStore });
    }
    const { data, error } = await supabaseAdmin
      .from("interviewer_documents")
      .insert({
        workspace_id: scope.workspaceId,
        campaign_id: campaign.id,
        title,
        body: text,
      })
      .select("id, title, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ document: data }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
