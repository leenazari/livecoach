import { NextRequest, NextResponse } from "next/server";

import { fetchLeadCostEstimate } from "@/lib/lead-generator-upstream";
import {
  leadGeneratorInvalid,
  leadGeneratorJson,
  leadGeneratorNoStore,
  requireLeadGeneratorManager,
} from "@/lib/lead-generator-http";
import { parseLeadFilters } from "@/lib/lead-generator-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const optionalCount = (value: string | null, label: string) => {
  if (!value) return null;
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 1) {
    throw leadGeneratorInvalid(`${label} must be a whole number, or left blank.`);
  }
  return amount;
};

export async function GET(request: NextRequest) {
  try {
    requireLeadGeneratorManager();
    const params = request.nextUrl.searchParams;
    const parsed = parseLeadFilters({
      sector: params.get("sector") || "",
      city: params.get("city") || "",
      minRating: params.get("minRating") || "",
      minReviews: params.get("minReviews") || "",
      maxReviews: params.get("maxReviews") || "",
      mustHaveWebsite: params.get("mustHaveWebsite") !== "false",
    });
    if (!parsed.ok) throw leadGeneratorInvalid(parsed.message);
    const estimate = await fetchLeadCostEstimate({
      filters: parsed.filters,
      daysToRun: optionalCount(params.get("daysToRun"), "Days to run"),
      dailyLeadTarget: optionalCount(params.get("dailyLeadTarget"), "Daily lead target"),
    });
    return NextResponse.json(estimate, { headers: leadGeneratorNoStore });
  } catch (error) {
    return leadGeneratorJson(error);
  }
}
