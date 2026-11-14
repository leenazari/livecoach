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
    const name = String(body?.prospectName || "").trim();
    const email = String(body?.prospectEmail || "").trim().toLowerCase();
    const hours = Number(body?.expiresInHours ?? 24 * 7);
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_invite_blocked",
        title: "Test link was not created",
        reason: "Choose a campaign first.",
        nextAction: "Create a campaign, then create the test link again.",
        responsible: "owner",
        outcome: "No invite was created.",
      }), { status: 400, headers: noStore });
    }
    if (!name || name.length > 160) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_invite_blocked",
        title: "Test link was not created",
        reason: "Add the prospect's name.",
        nextAction: "Enter a name of up to 160 characters and try again.",
        responsible: "owner",
        outcome: "No invite was created.",
      }), { status: 400, headers: noStore });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_invite_blocked",
        title: "Test link was not created",
        reason: "The email address does not look usable.",
        nextAction: "Correct the email or leave it blank, then try again.",
        responsible: "owner",
        outcome: "No invite was created.",
      }), { status: 400, headers: noStore });
    }
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_invite_blocked",
        title: "Test link was not created",
        reason: "The link lifetime must be between 1 hour and 30 days.",
        nextAction: "Choose a lifetime in that range and try again.",
        responsible: "owner",
        outcome: "No invite was created.",
      }), { status: 400, headers: noStore });
    }
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("interviewer_campaigns")
      .select("id, workspace_id")
      .eq("id", campaignId)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) {
      return NextResponse.json(crmBlockerPayload({
        code: "interviewer_invite_missing_campaign",
        title: "Test link was not created",
        reason: "That campaign is not available on your account.",
        nextAction: "Reload the interviewer page and choose a campaign you can see.",
        responsible: "owner",
        outcome: "No invite was created.",
      }), { status: 404, headers: noStore });
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
      expiresAt: data.expires_at,
    }, { headers: noStore });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
