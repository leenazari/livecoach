import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const body = await req.json().catch(() => ({}));
    const campaignId = String(body.campaignId || "").trim();
    if (!UUID.test(campaignId)) {
      return NextResponse.json({ error: "Choose an active campaign" }, { status: 400 });
    }

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from("outreach_campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("workspace_id", account.workspaceId)
      .eq("status", "active")
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) {
      return NextResponse.json(
        { error: "That campaign is not active in this workspace" },
        { status: 404 }
      );
    }

    const { error } = await supabaseAdmin
      .from("outreach_user_campaign_preferences")
      .upsert(
        {
          workspace_id: account.workspaceId,
          user_id: account.userId,
          active_campaign_id: campaign.id,
          updated_by: account.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,user_id" }
      );
    if (error) throw error;

    return NextResponse.json({ campaign, selectedCampaignId: campaign.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The campaign could not be selected" },
      { status: 500 }
    );
  }
}
