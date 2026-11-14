import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { validateKnowledgeNote } from "@/lib/interviewer/form-fields";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function POST(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const body = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const checked = validateKnowledgeNote({
      campaignId: String(record.campaignId || ""),
      title: String(record.title || ""),
      body: String(record.body || ""),
    });
    if (Object.keys(checked.fields).length) {
      return interviewerFieldError("interviewer_document_blocked", "Knowledge note was not saved", checked.fields);
    }
    const campaignId = String(record.campaignId || "");
    const title = checked.title;
    const text = checked.body;
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("interviewer_campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) {
      return interviewerFieldError("interviewer_document_missing_campaign", "Knowledge note was not saved", {
        campaignId: "That campaign is not available on your account.",
      });
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
