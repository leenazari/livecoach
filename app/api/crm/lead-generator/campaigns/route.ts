import { NextRequest, NextResponse } from "next/server";

import { createLeadCampaign, listLeadCampaigns } from "@/lib/lead-bank";
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

export async function GET() {
  try {
    requireLeadGeneratorManager();
    const list = await listLeadCampaigns();
    return NextResponse.json(list, { headers: leadGeneratorNoStore });
  } catch (error) {
    return leadGeneratorJson(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireLeadGeneratorManager();
    const body = await request.json().catch(() => null);
    const parsed = parseLeadCampaign(body);
    if (!parsed.ok) throw leadGeneratorInvalid(parsed.message);
    const estimate = await fetchLeadCostEstimate({
      filters: parsed.campaign.filters,
      daysToRun: parsed.campaign.daysToRun,
      dailyLeadTarget: parsed.campaign.dailyLeadTarget,
    });
    const campaign = await createLeadCampaign(parsed.campaign);
    return NextResponse.json(
      { campaign, estimate, saved: true },
      { headers: leadGeneratorNoStore }
    );
  } catch (error) {
    return leadGeneratorJson(error);
  }
}
