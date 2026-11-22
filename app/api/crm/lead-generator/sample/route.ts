import { NextRequest, NextResponse } from "next/server";

import { fetchLeadSample } from "@/lib/lead-generator-upstream";
import {
  leadGeneratorInvalid,
  leadGeneratorJson,
  leadGeneratorNoStore,
  requireLeadGeneratorManager,
} from "@/lib/lead-generator-http";
import { parseLeadFilters } from "@/lib/lead-generator-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    requireLeadGeneratorManager();
    const body = await request.json().catch(() => null);
    const parsed = parseLeadFilters(body);
    if (!parsed.ok) throw leadGeneratorInvalid(parsed.message);
    const sample = await fetchLeadSample(parsed.filters);
    return NextResponse.json(sample, { headers: leadGeneratorNoStore });
  } catch (error) {
    return leadGeneratorJson(error);
  }
}
