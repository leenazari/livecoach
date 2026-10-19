import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { upsertTasks } from "@/lib/tasks";
import { requireRequestScope } from "@/lib/request-scope";
import { loadTeamLeadCoverCompanies } from "@/lib/team-lead-cover";
import { loadSafeSharedCompanies } from "@/lib/team-client-sharing";
import { sharedClientBlockReason } from "@/lib/client-sharing-policy";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLASSIFICATIONS = new Set([
  "prospect",
  "partner",
  "customer",
  "product_trial",
  "in_house",
  "irrelevant",
]);

const ACTIVE_PROSPECT_STAGES = new Set([
  "New",
  "Discovery",
  "Qualified",
  "Proposal",
  "Negotiation",
]);

const stageFor = (classification: string, currentStage: string | null) => {
  if (classification === "partner") return "Partner";
  if (classification === "customer") return "Customer";
  if (classification === "product_trial") return "Product Trial";
  if (classification === "in_house") return "In House";
  if (classification === "irrelevant") return "Dormant";
  return currentStage && ACTIVE_PROSPECT_STAGES.has(currentStage)
    ? currentStage
    : "New";
};

// One click reviews up to five clients. The server merges its small triage
// marker into the existing profile instead of trusting the browser to replace
// the whole JSON document. Nothing is deleted: irrelevant records become
// Dormant and their open reminders are dismissed, while all history remains.
export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const items = Array.isArray(body.items) ? body.items.slice(0, 5) : [];
    if (!items.length) {
      return NextResponse.json({ error: "Choose at least one client" }, { status: 400 });
    }

    const clean: { id: string; classification: string; nextAction: string }[] =
      items.map((item: any) => {
        const id = String(item?.id || "");
        const classification = String(item?.classification || "");
        const nextAction =
          typeof item?.nextAction === "string"
            ? item.nextAction.trim().slice(0, 500)
            : "";
        if (!UUID_RE.test(id) || !CLASSIFICATIONS.has(classification)) {
          throw new Error("One of the triage choices is invalid");
        }
        return { id, classification, nextAction };
      });

    const ids = clean.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json(
        { error: "The same client cannot appear twice in one triage batch." },
        { status: 400 }
      );
    }
    const [{ data: ownedCompanies, error: companyError }, coveredCompanies, { data: shares, error: shareError }] =
      await Promise.all([
        supabaseAdmin
          .from("companies")
          .select("id,name,stage,profile,owner_id,updated_at")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .in("id", ids),
        loadTeamLeadCoverCompanies(scope, ids),
        supabaseAdmin
          .from("team_client_shares")
          .select("company_id,assigned_to_user_id")
          .eq("workspace_id", scope.workspaceId)
          .in("company_id", ids)
          .eq("status", "active"),
      ]);
    if (companyError) throw companyError;
    if (shareError) throw shareError;
    const editableShareIds = (shares || [])
      .filter((share) => scope.role !== "sales" || share.assigned_to_user_id === scope.userId)
      .map((share) => share.company_id);
    const sharedCompanies = await loadSafeSharedCompanies(editableShareIds, scope.workspaceId);
    const permittedIds = new Set([...ownedCompanies || [], ...coveredCompanies, ...sharedCompanies].map((company) => company.id));
    if (ids.some((id) => !permittedIds.has(id))) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "triage_client_unavailable",
          title: "Client review could not be saved",
          reason: "A selected client is unavailable or your access has changed",
          nextAction: "Refresh the client list. If it repeats, ask a workspace owner to check the client sharing",
          responsible: "owner",
        }),
        { status: 404 }
      );
    }

    // Match the guarded company editor: validate ownership, team cover or an
    // editable share before using the server client. Private profile contents
    // stay on the server and are never returned to the salesperson.
    const [{ data: companies, error: snapshotError }, { data: openDeals, error: dealError }] = await Promise.all([
      supabaseService.from("companies")
        .select("id,name,stage,sector,profile,owner_id,is_confidential,updated_at")
        .eq("workspace_id", scope.workspaceId).in("id", ids),
      supabaseService.from("opportunities").select("company_id")
        .eq("workspace_id", scope.workspaceId).in("company_id", ids)
        .eq("status", "open").eq("opportunity_type", "revenue"),
    ]);
    if (snapshotError) throw snapshotError;
    if (dealError) throw dealError;
    if (companies?.length !== ids.length) {
      return NextResponse.json({ error: "The client list changed. Refresh and review again." }, { status: 409 });
    }
    // Recheck protected relationships against the current server snapshot.
    for (const company of companies) {
      const item = clean.find((choice) => choice.id === company.id)!;
      if (company.owner_id !== scope.userId && (
        company.profile?.internal === true || sharedClientBlockReason(company) ||
        item.classification === "in_house" || item.classification === "product_trial"
      )) {
        return NextResponse.json(crmBlockerPayload({
          code: "triage_private_relationship",
          title: "Client review needs the record owner",
          reason: "Private relationship classifications must be reviewed by the record owner",
          nextAction: "Ask the record owner to review this client",
          responsible: "owner",
        }), { status: 403 });
      }
    }

    const dealCompanyIds = new Set((openDeals || []).map((deal: any) => deal.company_id));
    const companyById = new Map((companies || []).map((company: any) => [company.id, company]));
    for (const item of clean) {
      if (item.classification === "irrelevant" && dealCompanyIds.has(item.id)) {
        return NextResponse.json(
          { error: `${companyById.get(item.id)?.name || "That client"} has an open opportunity and cannot be archived from triage.` },
          { status: 409 }
        );
      }
    }

    const reviewedAt = new Date().toISOString();
    const results: { id: string; name: string; stage: string; classification: string }[] = [];
    for (const item of clean) {
      const company: any = companyById.get(item.id);
      const profile =
        company.profile && typeof company.profile === "object" ? company.profile : {};
      const stage = stageFor(item.classification, company.stage || null);
      const archived = item.classification === "irrelevant";
      const update = supabaseService
        .from("companies")
        .update({
          stage,
          profile: {
            ...profile,
            archived,
            triage: {
              classification: item.classification,
              reviewedAt,
              source: "client_triage",
            },
            updated: reviewedAt,
          },
          updated_at: reviewedAt,
        })
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", company.owner_id)
        .eq("id", item.id);
      const { data: saved, error } = await (company.updated_at
        ? update.eq("updated_at", company.updated_at)
        : update.is("updated_at", null)).select("id");
      if (error) throw error;
      if (saved?.length !== 1) {
        return NextResponse.json({ error: "A client changed during this review. Refresh before trying again." }, { status: 409 });
      }

      if (archived) {
        // `tasks` deliberately has no updated_at column. Status is the
        // authoritative persisted state; selecting it back makes the bulk
        // triage save fail loudly if Supabase does not confirm the dismissal.
        const { data: dismissedTasks, error: taskError } = await supabaseAdmin
          .from("tasks")
          .update({ status: "dismissed" })
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .eq("company_id", item.id)
          .eq("status", "open")
          .select("id,status");
        if (taskError) throw taskError;
        if ((dismissedTasks || []).some((task: any) => task.status !== "dismissed")) {
          throw new Error("Supabase did not confirm the archived reminders");
        }
      } else if (item.nextAction) {
        await upsertTasks(item.id, [
          {
            text: item.nextAction,
            kind: "next_step",
            linkKind: "client",
            source: "client_triage",
            sourceRef: `triage:${item.id}`,
          },
        ]);
      }

      results.push({
        id: item.id,
        name: company.name,
        stage,
        classification: item.classification,
      });
    }

    return NextResponse.json(
      { ok: true, reviewedAt, results },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to save client triage" },
      { status: 500 }
    );
  }
}
