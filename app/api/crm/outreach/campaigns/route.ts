import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabaseAdmin.from("outreach_campaigns").select("*").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data || [] });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    const goal = String(body.goal || "").trim();
    const audience = String(body.audience || "").trim();
    const offerAngle = String(body.offer_angle || "").trim();
    if (!name || !goal || !audience || !offerAngle) return NextResponse.json({ error: "Name, goal, audience and angle are required" }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("outreach_campaigns").insert({ name, goal, audience, offer_angle: offerAngle, daily_limit: Math.min(20, Math.max(1, Number(body.daily_limit) || 20)), approval_mode: true, sequence: body.sequence || [{ step: 1, delayDays: 0, purpose: "Relevant opening" }, { step: 2, delayDays: 3, purpose: "Second use case" }, { step: 3, delayDays: 7, purpose: "Close the loop" }] }).select("*").single();
    if (error) throw error;
    return NextResponse.json({ campaign: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to create campaign" }, { status: 500 });
  }
}
