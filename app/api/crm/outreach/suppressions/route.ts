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
    const valid = kind === "email"
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
      : /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(target);
    if (!valid) return NextResponse.json({ error: "Enter a valid email or company domain" }, { status: 400 });
    const { data, error } = await supabaseAdmin.from("outreach_suppressions").upsert({ target, kind, reason: String(body.reason || "Manually blocked").slice(0, 300), source: "manual" }).select("*").single();
    if (error) throw error;
    const matching = kind === "email"
      ? await supabaseAdmin.from("outreach_prospects").select("id").ilike("email", target)
      : await supabaseAdmin
          .from("outreach_prospects")
          .select("id")
          .or(`company_domain.ilike.${target},email.ilike.%@${target}`);
    if (matching.error) throw matching.error;
    const prospectIds = (matching.data || []).map((prospect: any) => prospect.id);
    if (prospectIds.length) {
      const now = new Date().toISOString();
      const results = await Promise.all([
        supabaseAdmin
          .from("outreach_prospects")
          .update({ status: "suppressed", suppression_reason: data.reason, updated_at: now })
          .in("id", prospectIds),
        supabaseAdmin
          .from("outreach_enrolments")
          .update({ status: "suppressed", next_action_at: null, updated_at: now })
          .in("prospect_id", prospectIds)
          .in("status", ["queued", "researched", "drafted", "approved", "contacted", "paused"]),
        supabaseAdmin
          .from("outreach_messages")
          .update({ status: "cancelled", updated_at: now })
          .in("prospect_id", prospectIds)
          .in("status", ["draft", "approved"]),
      ]);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
    }
    return NextResponse.json({ suppression: data, affectedProspects: prospectIds.length });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to add suppression" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const target = String(body.target || "").trim().toLowerCase();
    if (!target) return NextResponse.json({ error: "Choose an item to restore" }, { status: 400 });
    const kind = target.includes("@") ? "email" : "domain";
    const valid = kind === "email"
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
      : /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(target);
    if (!valid) return NextResponse.json({ error: "The saved email or domain is invalid" }, { status: 400 });
    const matching = kind === "email"
      ? await supabaseAdmin.from("outreach_prospects").select("id,email,company_domain,last_reply_at,last_contacted_at").ilike("email", target)
      : await supabaseAdmin
          .from("outreach_prospects")
          .select("id,email,company_domain,last_reply_at,last_contacted_at")
          .or(`company_domain.ilike.${target},email.ilike.%@${target}`);
    if (matching.error) throw matching.error;
    const { error: deleteError } = await supabaseAdmin.from("outreach_suppressions").delete().eq("target", target);
    if (deleteError) throw deleteError;
    const { data: remaining } = await supabaseAdmin.from("outreach_suppressions").select("target");
    const blocked = new Set((remaining || []).map((row: any) => String(row.target || "").toLowerCase()));
    const restorable = (matching.data || []).filter((prospect: any) => {
      const email = String(prospect.email || "").toLowerCase();
      const domain = String(prospect.company_domain || email.split("@").pop() || "").toLowerCase();
      return !blocked.has(email) && !blocked.has(domain);
    });
    const now = new Date().toISOString();
    const groups = {
      replied: restorable.filter((prospect: any) => prospect.last_reply_at).map((prospect: any) => prospect.id),
      contacted: restorable.filter((prospect: any) => !prospect.last_reply_at && prospect.last_contacted_at).map((prospect: any) => prospect.id),
      imported: restorable.filter((prospect: any) => !prospect.last_reply_at && !prospect.last_contacted_at).map((prospect: any) => prospect.id),
    };
    const updates: any[] = [];
    for (const [status, ids] of Object.entries(groups))
      if (ids.length)
        updates.push(
          supabaseAdmin
            .from("outreach_prospects")
            .update({ status, suppression_reason: null, updated_at: now })
            .in("id", ids)
        );
    const ids = restorable.map((prospect: any) => prospect.id);
    if (ids.length)
      updates.push(
        supabaseAdmin
          .from("outreach_enrolments")
          .update({ status: "paused", updated_at: now })
          .in("prospect_id", ids)
          .eq("status", "suppressed")
      );
    const results = await Promise.all(updates);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    return NextResponse.json({ ok: true, restoredProspects: ids.length });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to restore outreach access" }, { status: 500 });
  }
}
