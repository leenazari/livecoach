import { NextResponse } from "next/server";

import { interviewerOwnerError, requireInterviewerOwner } from "@/lib/interviewer/access";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { validateInviteFields } from "@/lib/interviewer/form-fields";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const campaignId = new URL(req.url).searchParams.get("campaignId") || "";
    if (!UUID.test(campaignId)) return NextResponse.json({ invites: [] }, { headers: noStore });
    const { data, error } = await supabaseAdmin
      .from("interviewer_invites")
      .select("token, prospect_name, expires_at, created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", campaignId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return NextResponse.json({
      invites: (data || []).map((row) => ({
        path: `/i/${row.token}`,
        name: String(row.prospect_name || "Guest"),
        expiresAt: row.expires_at,
      })),
    }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}

export async function POST(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const body = await req.json().catch(() => null);
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const fields = validateInviteFields({
      campaignId: String(record.campaignId || ""),
      prospectName: String(record.prospectName || ""),
      prospectEmail: String(record.prospectEmail || ""),
    });
    if (Object.keys(fields).length) {
      return interviewerFieldError("interviewer_invite_blocked", "Test link was not created", fields);
    }
    const campaignId = String(record.campaignId || "");
    const name = String(record.prospectName || "").trim();
    const email = String(record.prospectEmail || "").trim().toLowerCase();
    const hours = Number(record.expiresInHours ?? 24 * 7);
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) {
      return interviewerFieldError("interviewer_invite_blocked", "Test link was not created", {
        expiresInHours: "The link lifetime must be between 1 hour and 30 days.",
      });
    }
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("interviewer_campaigns")
      .select("id, workspace_id")
      .eq("id", campaignId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) {
      return interviewerFieldError("interviewer_invite_missing_campaign", "Test link was not created", {
        campaignId: "That campaign is not available on your account.",
      });
    }
    const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("interviewer_invites")
      .insert({
        workspace_id: scope.workspaceId,
        campaign_id: campaign.id,
        prospect_name: name,
        prospect_email: email || null,
        expires_at: expiresAt,
        created_by: scope.userId,
      })
      .select("token, expires_at")
      .single();
    if (error) throw error;
    return NextResponse.json({
      path: `/i/${data.token}`,
      name,
      expiresAt: data.expires_at,
    }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
