import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data, error } = await supabaseAdmin.from("outreach_suppressions").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suppressions: data || [] });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const target = String(body.target || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
    if (!target) return NextResponse.json({ error: "Enter an email or domain" }, { status: 400 });
    const kind = target.includes("@") ? "email" : "domain";
    const { data, error } = await supabaseAdmin.from("outreach_suppressions").upsert({ target, kind, reason: String(body.reason || "Manually blocked").slice(0, 300), source: "manual" }).select("*").single();
    if (error) throw error;
    if (kind === "email") await supabaseAdmin.from("outreach_prospects").update({ status: "suppressed", suppression_reason: data.reason, updated_at: new Date().toISOString() }).ilike("email", target);
    return NextResponse.json({ suppression: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to add suppression" }, { status: 500 });
  }
}
