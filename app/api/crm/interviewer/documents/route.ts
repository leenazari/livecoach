import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { validateKnowledgeNote } from "@/lib/interviewer/form-fields";
import { KNOWLEDGE_SECTIONS, SOURCE_WEBSITE_TITLE, WEBSITE_IMPORT_SOURCE, isMissingSourceColumn, sectionKeyForTitle, websiteImportIds } from "@/lib/interviewer/knowledge";
import { QUALIFYING_TITLE } from "@/lib/interviewer/qualifying";
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
    const rich = await supabaseAdmin
      .from("interviewer_documents")
      .select("id, title, body, created_at, source")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (rich.error && !isMissingSourceColumn(rich.error)) throw rich.error;
    if (!rich.error) return NextResponse.json({ documents: rich.data || [] }, { headers: noStore });
    const plain = await supabaseAdmin
      .from("interviewer_documents")
      .select("id, title, body, created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (plain.error) throw plain.error;
    return NextResponse.json({ documents: plain.data || [] }, { headers: noStore });
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
      if (record.scraped === true || record.replaceWebsiteNotes === true) {
        if (!rows.length) {
          return interviewerFieldError("interviewer_import_blocked", "Website notes were not saved", {
            url: "Nothing was written, and no existing notes were deleted.",
          });
        }
        const existing = await supabaseService
          .from("interviewer_documents")
          .select("id, source")
          .eq("campaign_id", campaignId)
          .eq("workspace_id", scope.workspaceId);
        if (existing.error) {
          if (isMissingSourceColumn(existing.error)) {
            return interviewerFieldError("interviewer_import_blocked", "Website notes were not saved", {
              url: "The source column is not on interviewer_documents yet, so nothing was deleted or written.",
            });
          }
          throw existing.error;
        }
        const stale = websiteImportIds((existing.data || []) as Array<{ id: string; source?: string | null }>);
        if (stale.length) {
          const removed = await supabaseService
            .from("interviewer_documents")
            .delete()
            .in("id", stale)
            .eq("campaign_id", campaignId)
            .eq("workspace_id", scope.workspaceId);
          if (removed.error) throw removed.error;
        }
        const marked = rows.map((row) => ({ ...row, source: WEBSITE_IMPORT_SOURCE }));
        const { error } = await supabaseService.from("interviewer_documents").insert(marked);
        if (error) {
          if (isMissingSourceColumn(error)) {
            return interviewerFieldError("interviewer_import_blocked", "Website notes were not saved", {
              url: "The source column is not on interviewer_documents yet, so nothing was written.",
            });
          }
          throw error;
        }
      } else {
        await supabaseService.from("interviewer_documents").delete().eq("campaign_id", campaignId).eq("workspace_id", scope.workspaceId).in("title", titles);
        if (rows.length) {
          const { error } = await supabaseService.from("interviewer_documents").insert(rows);
          if (error) throw error;
        }
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
    if (title === QUALIFYING_TITLE) {
      await supabaseService.from("interviewer_documents").delete().eq("campaign_id", campaign.id).eq("workspace_id", scope.workspaceId).eq("title", QUALIFYING_TITLE);
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
