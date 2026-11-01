import { NextRequest, NextResponse } from "next/server";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { normaliseMatchDomain } from "@/lib/lead-clash-rules";
import { readLeadClashStatus } from "@/lib/lead-clash";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function managerScope() {
  const scope = requireRequestScope();
  if (scope.status !== "active" || (scope.role !== "owner" && scope.role !== "manager")) {
    const error = new Error("manager required");
    (error as { status?: number }).status = 403;
    throw error;
  }
  return scope;
}

export async function GET() {
  try {
    const scope = managerScope();
    const status = await readLeadClashStatus(scope.workspaceId);
    if (!status.available) return NextResponse.json({ exclusions: [] });
    const { data, error } = await supabaseService
      .from("lead_clash_exclusions")
      .select("id, company_id, domain, reason, created_at")
      .eq("workspace_id", scope.workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ exclusions: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      crmBlockerPayload({
        code: "lead_clash_exclusions_unavailable",
        title: "Lead clash exclusions unavailable",
        reason: "Only a workspace owner or manager can review excluded test records.",
        nextAction: "Open this list from an owner or manager account.",
        responsible: "owner",
      }),
      { status: err?.status || 403 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = managerScope();
    const status = await readLeadClashStatus(scope.workspaceId);
    if (!status.available) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "lead_clash_exclusions_unavailable",
          title: "Lead clash exclusions are not installed",
          reason: "The exclusion list is not available until the lead clash migration is applied.",
          nextAction: "Apply the migration in a preview database first. No exclusion was saved.",
          responsible: "owner",
        }),
        { status: 503 }
      );
    }
    const body = await req.json().catch(() => ({}));
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    const domain = normaliseMatchDomain(body.domain);
    if (companyId && !UUID.test(companyId)) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "lead_clash_exclusion_invalid",
          title: "Exclusion not saved",
          reason: "The company to exclude was not a valid record id.",
          nextAction: "Choose a company from the duplicate report and try again. Nothing was saved.",
          responsible: "user",
        }),
        { status: 400 }
      );
    }
    if (!companyId && (!domain || !domain.includes("."))) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "lead_clash_exclusion_invalid",
          title: "Exclusion not saved",
          reason: "Add a company or a website domain to exclude.",
          nextAction: "Enter a domain such as example.test, or choose a company. Nothing was saved.",
          responsible: "user",
        }),
        { status: 400 }
      );
    }
    const { data, error } = await supabaseService
      .from("lead_clash_exclusions")
      .insert({
        workspace_id: scope.workspaceId,
        company_id: companyId || null,
        domain: domain || null,
        reason: String(body.reason || "").replace(/\s+/g, " ").trim().slice(0, 300) || null,
        created_by: scope.userId,
      })
      .select("id, company_id, domain, reason, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, exclusion: data });
  } catch (err: any) {
    console.error("Lead clash exclusion was not saved", err?.code || err?.message);
    return NextResponse.json(
      crmBlockerPayload({
        code: "lead_clash_exclusion_not_confirmed",
        title: "Exclusion not confirmed",
        reason: "LiveCoach could not confirm the exclusion.",
        nextAction: "Refresh the exclusion list before adding it again.",
        responsible: "system",
      }),
      { status: err?.status || 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const scope = managerScope();
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!UUID.test(id)) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "lead_clash_exclusion_invalid",
          title: "Exclusion not removed",
          reason: "The exclusion to remove was not found.",
          nextAction: "Refresh the list and choose the exclusion again.",
          responsible: "user",
        }),
        { status: 400 }
      );
    }
    const { error } = await supabaseService
      .from("lead_clash_exclusions")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      crmBlockerPayload({
        code: "lead_clash_exclusion_not_confirmed",
        title: "Exclusion not removed",
        reason: "LiveCoach could not confirm the exclusion was removed.",
        nextAction: "Refresh the list and check whether it is still there before trying again.",
        responsible: "system",
      }),
      { status: err?.status || 500 }
    );
  }
}
