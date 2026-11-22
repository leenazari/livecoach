import { NextResponse } from "next/server";

import { fetchLeadCostEstimate } from "@/lib/lead-generator-upstream";
import {
  leadGeneratorJson,
  leadGeneratorNoStore,
  requireLeadGeneratorManager,
} from "@/lib/lead-generator-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    requireLeadGeneratorManager();
    const estimate = await fetchLeadCostEstimate();
    return NextResponse.json(estimate, { headers: leadGeneratorNoStore });
  } catch (error) {
    return leadGeneratorJson(error);
  }
}
