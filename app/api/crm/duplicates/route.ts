import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { findDuplicateCompanies } from "@/lib/crm-health";
import { requireRequestScope, requireWorkspaceOwner } from "@/lib/request-scope";
import {
  loadAllScopedRows,
  readLeadClashStatus,
  workspaceDuplicateInputs,
} from "@/lib/lead-clash";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Conservative duplicate detector: exact normalised names/domains or the same
// contact email attached to different clients. It only suggests review and
// never mutates CRM records. Workspace scope is owner/manager only and only
// runs after the lead-clash switch is turned on.
export async function GET(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const wantsWorkspace = req.nextUrl.searchParams.get("scope") === "workspace";
    const leadClash = wantsWorkspace || scope.role === "owner"
      ? await readLeadClashStatus(scope.workspaceId)
      : { enabled: false, available: false, forcedOff: false };
    const workspaceScope =
      wantsWorkspace &&
      leadClash.enabled &&
      scope.status === "active" &&
      (scope.role === "owner" || scope.role === "manager");
    if (!workspaceScope) requireWorkspaceOwner();

    const companySelect = "id, name, domain, website, profile, updated_at, owner_id";
    const companies = await loadAllScopedRows<any>((from, to) => {
      let query = (workspaceScope ? supabaseService : supabaseAdmin)
        .from("companies")
        .select(companySelect)
        .eq("workspace_id", scope.workspaceId)
        .order("id", { ascending: true })
        .range(from, to);
      if (!workspaceScope) query = query.eq("owner_id", scope.userId);
      return query;
    });
    const contacts = await loadAllScopedRows<any>((from, to) => {
      let query = (workspaceScope ? supabaseService : supabaseAdmin)
        .from("contacts")
        .select("id, company_id, email")
        .eq("workspace_id", scope.workspaceId)
        .not("company_id", "is", null)
        .not("email", "is", null)
        .order("id", { ascending: true })
        .range(from, to);
      if (!workspaceScope) query = query.eq("owner_id", scope.userId);
      return query;
    });

    const prepared = workspaceScope
      ? workspaceDuplicateInputs(companies, contacts)
      : { companies, contacts };
    const ownerNames = new Map<string, string>();
    if (workspaceScope) {
      const ownerIds = [...new Set(prepared.companies.map((company: any) => company.owner_id).filter(Boolean))];
      if (ownerIds.length) {
        const { data: profiles } = await supabaseService
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", ownerIds);
        for (const profile of profiles || []) {
          const name = String(profile.display_name || "").replace(/\s+/g, " ").trim();
          if (name) ownerNames.set(profile.user_id, name);
        }
      }
    }
    const namedCompanies = prepared.companies.map((company: any) => ({
      ...company,
      owner_name: ownerNames.get(company.owner_id) || null,
    }));
    const duplicates = findDuplicateCompanies(
      namedCompanies,
      prepared.contacts,
      workspaceScope ? 100 : 20
    );

    return NextResponse.json({
      duplicates,
      scope: workspaceScope ? "workspace" : "owner",
      leadClash,
    });
  } catch (err: any) {
    const message = err?.message || "";
    if (/workspace owner access is required/i.test(message)) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "duplicate_report_owner_only",
          title: "Duplicate report unavailable",
          reason: "The duplicate report is limited to the workspace owner.",
          nextAction: "Ask a workspace owner to open the duplicate report.",
          responsible: "owner",
        }),
        { status: 403 }
      );
    }
    console.error("Duplicate report failed", message.slice(0, 180));
    return NextResponse.json(
      crmBlockerPayload({
        code: "duplicate_report_not_confirmed",
        title: "Duplicate report unavailable",
        reason: "LiveCoach could not confirm the duplicate client list.",
        nextAction: "Refresh the page once. If it still fails, send this blocker code to a workspace owner.",
        responsible: "system",
      }),
      { status: 500 }
    );
  }
}
