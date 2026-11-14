import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { validateKnowledgeNote } from "@/lib/interviewer/form-fields";
import { KNOWLEDGE_SECTIONS, SOURCE_WEBSITE_TITLE, sectionKeyForTitle } from "@/lib/interviewer/knowledge";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const campaignId = new URL(req.url).searchParams.get("campaignId") || "";
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
      return NextResponse.json({ documents: [] }, { headers: noStore });
    }
    const { data, error } = await supabaseAdmin
      .from("interviewer_documents")
      .select("id, title, body, created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw error;
    return NextResponse.json({ documents: data || [] }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}

export async function POST(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const body = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    if (Array.isArray(record.sections)) {
      const campaignId = String(record.campaignId || "");
      if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
        return interviewerFieldError("interviewer_document_blocked", "Knowledge was not saved", { campaignId: "Pick a campaign." });
      }
      const { data: campaign, error: campaignError } = await supabaseAdmin
        .from("interviewer_campaigns")
        .select("id")
        .eq("id", campaignId)
        .eq("workspace_id", scope.workspaceId)
        .maybeSingle();
      if (campaignError) throw campaignError;
      if (!campaign) {
        return interviewerFieldError("interviewer_document_missing_campaign", "Knowledge was not saved", {
          campaignId: "That campaign is not available on your account.",
        });
      }
      const rows = (record.sections as Array<{ title?: string; body?: string }>).flatMap((section) => {
        const title = KNOWLEDGE_SECTIONS.find((item) => item.title === String(section.title || ""))?.title
          || (sectionKeyForTitle(String(section.title || "")) ? String(section.title) : "");
        const text = String(section.body || "").trim().slice(0, 20000);
        if (!title) return [];
        return text ? [{ workspace_id: scope.workspaceId, campaign_id: campaignId, title, body: text }] : [];
      });
      const titles = KNOWLEDGE_SECTIONS.map((section) => section.title);
      await supabaseService.from("interviewer_documents").delete().eq("campaign_id", campaignId).in("title", titles);
      if (rows.length) {
        const { error } = await supabaseService.from("interviewer_documents").insert(rows);
        if (error) throw error;
      }
      const websiteUrl = String(record.websiteUrl || "").trim().slice(0, 500);
      let websiteStored = false;
      if (websiteUrl) {
        const patch: Record<string, string> = { website_url: websiteUrl, updated_at: new Date().toISOString() };
        if (record.scraped === true) patch.website_scraped_at = new Date().toISOString();
        const updated = await supabaseService
          .from("interviewer_campaigns")
          .update(patch)
          .eq("id", campaignId)
          .eq("workspace_id", scope.workspaceId);
        websiteStored = !updated.error;
        if (updated.error) {
          await supabaseService.from("interviewer_documents").delete().eq("campaign_id", campaignId).eq("title", SOURCE_WEBSITE_TITLE);
          await supabaseService.from("interviewer_documents").insert({
            workspace_id: scope.workspaceId,
            campaign_id: campaignId,
            title: SOURCE_WEBSITE_TITLE,
            body: `${websiteUrl}\nDo not read this address aloud.`,
          });
        }
      }
      return NextResponse.json({ saved: rows.length, websiteStored }, { headers: noStore });
    }
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
