import { NextRequest, NextResponse } from "next/server";

import { setLeadCampaignStatus, updateLeadCampaign } from "@/lib/lead-bank";
import { fetchLeadCostEstimate } from "@/lib/lead-generator-upstream";
import {
  leadGeneratorInvalid,
  leadGeneratorJson,
  leadGeneratorNoStore,
  requireLeadGeneratorManager,
} from "@/lib/lead-generator-http";
import { parseLeadCampaign } from "@/lib/lead-generator-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    requireLeadGeneratorManager();
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    if (action === "pause" || action === "resume") {
      const campaign = await setLeadCampaignStatus(
        params.id,
        action === "pause" ? "paused" : "active"
      );
      return NextResponse.json(
        { campaign, saved: true },
        { headers: leadGeneratorNoStore }
      );
    }
    if (action !== "save") throw leadGeneratorInvalid("Choose save, pause, or resume.");
    const parsed = parseLeadCampaign(body);
    if (!parsed.ok) throw leadGeneratorInvalid(parsed.message);
    const estimate = await fetchLeadCostEstimate({
      filters: parsed.campaign.filters,
      daysToRun: parsed.campaign.daysToRun,
      dailyLeadTarget: parsed.campaign.dailyLeadTarget,
    });
    const campaign = await updateLeadCampaign(params.id, parsed.campaign);
    return NextResponse.json(
      { campaign, estimate, saved: true },
      { headers: leadGeneratorNoStore }
    );
  } catch (error) {
    return leadGeneratorJson(error);
  }
}
