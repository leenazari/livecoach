import { NextRequest, NextResponse } from "next/server";

import { setLeadCampaignActive, updateLeadCampaign } from "@/lib/lead-bank";
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
      const campaign = await setLeadCampaignActive(params.id, action === "resume");
      return NextResponse.json(
        { campaign, saved: true },
        { headers: leadGeneratorNoStore }
      );
    }
    if (action !== "save") throw leadGeneratorInvalid("Choose save, pause, or resume.");
    const parsed = parseLeadCampaign(body, typeof body?.code === "string" ? body.code : undefined);
    if (!parsed.ok) throw leadGeneratorInvalid(parsed.message);
    const estimate = await fetchLeadCostEstimate();
    const campaign = await updateLeadCampaign(params.id, parsed.campaign);
    return NextResponse.json(
      { campaign, estimate, saved: true },
      { headers: leadGeneratorNoStore }
    );
  } catch (error) {
    return leadGeneratorJson(error);
  }
}
