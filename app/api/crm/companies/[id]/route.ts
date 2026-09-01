import { NextRequest, NextResponse } from "next/server";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { loadSafeSharedCompany } from "@/lib/team-client-sharing";
import { withCompanyPipelineExclusion } from "@/lib/company-pipeline-exclusion";
import {
  verifiedCompanyResearchEvidence,
  verifiedJobResearchEvidence,
} from "@/lib/job-research-sources";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

// GET    /api/crm/companies/:id -> the company + its contacts
// PATCH  /api/crm/companies/:id -> update core fields + custom attributes
// DELETE /api/crm/companies/:id -> remove (contacts cascade via FK)

const PATCHABLE = [
  "name",
  "domain",
  "website",
  "sector",
  "stage",
  "notes",
  // A running summary of the email thread/relationship so far. Feeds the plan,
  // the assistant and the build-profile pass.
  "email_context",
] as const;

async function loadVerifiedCompanySalesResearch(
  companyId: string,
  workspaceId: string
) {
  const { data: prospects, error: prospectError } = await supabaseAdmin
    .from("outreach_prospects")
    .select("id,research,website,company_domain,last_researched_at")
    .eq("workspace_id", workspaceId)
    .eq("crm_company_id", companyId)
    .order("last_researched_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (prospectError) throw prospectError;
  const prospect = prospects?.[0];
  if (!prospect) {
    return {
      companyOverview: "",
      companyOverviewUrl: "",
      jobBoardUrl: "",
      jobSignals: [],
    };
  }

  const { data: enrolments, error: enrolmentError } = await supabaseAdmin
    .from("outreach_enrolments")
    .select("research,research_sources,researched_at")
    .eq("workspace_id", workspaceId)
    .eq("prospect_id", prospect.id)
    .order("researched_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (enrolmentError) throw enrolmentError;
  const enrolment = enrolments?.[0];
  const research = enrolment?.research || prospect.research;
  const sources = Array.isArray(enrolment?.research_sources)
    ? enrolment.research_sources
    : [];
  return {
    ...verifiedCompanyResearchEvidence(research, sources, prospect),
    ...verifiedJobResearchEvidence(research, sources, prospect),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const { data: privateCompany, error } = await supabaseAdmin
      .from("companies")
      .select("*")
      .eq("id", params.id)
      .maybeSingle();
    if (error) throw error;

    // A historical team-visible company row must not bypass the newer safe
    // projection. Full rows are available only to their privacy owner.
    let company: any =
      privateCompany?.owner_id === scope.userId ? privateCompany : null;
    let sharedSalesAccess = false;
    let activeShare: any = null;
    if (!company) {
      const { data: share, error: shareError } = await supabaseAdmin
        .from("team_client_shares")
        .select("id,company_id,status,shared_by_user_id,assigned_to_user_id,updated_at")
        .eq("company_id", params.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("status", "active")
        .maybeSingle();
      if (shareError) throw shareError;
      if (share) {
        activeShare = share;
        company = await loadSafeSharedCompany(params.id, scope.workspaceId);
        sharedSalesAccess = !!company;
      }
    } else {
      const { data: share, error: shareError } = await supabaseAdmin
        .from("team_client_shares")
        .select("id,company_id,status,shared_by_user_id,assigned_to_user_id,updated_at")
        .eq("company_id", params.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("status", "active")
        .maybeSingle();
      if (shareError) throw shareError;
      activeShare = share;
    }

    // A safely merged client gets a permanent pointer to the surviving
    // record. Old bookmarks, timeline links and browser history continue to
    // work instead of landing on a confusing 404.
    if (!company) {
      const { data: redirect, error: redirectError } = await supabaseAdmin
        .from("crm_company_redirects")
        .select("target_id")
        .eq("source_id", params.id)
        .maybeSingle();
      if (redirectError) throw redirectError;
      if (redirect?.target_id) {
        return NextResponse.json(
          { redirectTo: redirect.target_id },
          {
            headers: {
              "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
              Pragma: "no-cache",
              Expires: "0",
            },
          }
        );
      }
      return NextResponse.json(
        crmBlockerPayload({
          code: "company_unavailable",
          title: "Company unavailable",
          reason: "This company no longer exists or has not been shared with your account",
          nextAction: "Return to the lead and ask a workspace owner to assign or safely share the company",
          responsible: "owner",
        }),
        { status: 404 }
      );
    }

    const salesResearchPromise = loadVerifiedCompanySalesResearch(
      params.id,
      scope.workspaceId
    );
    // Related records remain private to the person who created them. On a
    // safely shared client this lets the assigned salesperson see and add their
    // own contacts and relationship threads without exposing the owner's ones.
    const [contactsResult, departmentsResult, workstreamsResult, linksResult] =
      await Promise.all([
        supabaseAdmin
          .from("contacts")
          .select("*")
          .eq("company_id", params.id)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("departments")
          .select("id, company_id, name, description, created_at, updated_at")
          .eq("company_id", params.id)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("workstreams")
          .select(
            "id, company_id, department_id, name, kind, status, purpose, created_at, updated_at"
          )
          .eq("company_id", params.id)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .order("status", { ascending: true })
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("workstream_contacts")
          .select(
            "workstream_id, contact_id, company_id, relationship_role, is_primary"
          )
          .eq("company_id", params.id)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId),
      ]);
    for (const result of [
      contactsResult,
      departmentsResult,
      workstreamsResult,
      linksResult,
    ]) {
      if (result.error) throw result.error;
    }
    const salesResearch = await salesResearchPromise;

    return NextResponse.json({
      company,
      contacts: contactsResult.data || [],
      departments: departmentsResult.data || [],
      workstreams: workstreamsResult.data || [],
      workstreamContacts: linksResult.data || [],
      salesResearch,
      access: {
        mode: sharedSalesAccess ? "shared_sales" : "owner",
        shared: !!activeShare,
        canManageSharing:
          !sharedSalesAccess &&
          scope.role === "owner" &&
          company.owner_id === scope.userId,
        assignedToUserId: activeShare?.assigned_to_user_id || scope.userId,
        canEdit:
          !sharedSalesAccess ||
          scope.role === "owner" ||
          scope.role === "manager" ||
          activeShare?.assigned_to_user_id === scope.userId,
        privateSourcesHidden: sharedSalesAccess,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      crmBlockerPayload({
        code: "company_access_not_confirmed",
        title: "Company could not be opened",
        reason: "The CRM could not confirm access to this company",
        nextAction: "Refresh once. If it still fails, ask a workspace owner to check the company assignment",
        responsible: "owner",
      }),
      { status: 404 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const { data: current, error: currentError } = await supabaseAdmin
      .from("companies")
      .select("id,name,stage,profile,owner_id,workspace_id")
      .eq("id", params.id)
      .eq("workspace_id", scope.workspaceId)
      .maybeSingle();
    if (currentError) throw currentError;

    let sharedSalesAccess = false;
    if (!current || current.owner_id !== scope.userId) {
      const { data: share, error: shareError } = await supabaseAdmin
        .from("team_client_shares")
        .select("id,assigned_to_user_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("company_id", params.id)
        .eq("status", "active")
        .maybeSingle();
      if (shareError) throw shareError;
      sharedSalesAccess = !!share;
      if (!sharedSalesAccess) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "company_edit_access_missing",
            title: "Company update blocked",
            reason: "This company is not owned by or safely shared with your account",
            nextAction: "Ask a workspace owner to assign or share the company before editing it",
            responsible: "owner",
          }),
          { status: 404 }
        );
      }
      if (
        scope.role === "sales" &&
        share?.assigned_to_user_id !== scope.userId
      ) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "company_assigned_to_another_salesperson",
            title: "Company update blocked",
            reason: "This company is assigned to another salesperson and is view only for you",
            nextAction: "Ask a manager to reassign the company if you should be responsible for it",
            responsible: "manager",
          }),
          { status: 403 }
        );
      }
    }

    const patch: Record<string, any> = {};
    for (const f of PATCHABLE) {
      if (
        sharedSalesAccess &&
        (f === "notes" || f === "email_context")
      )
        continue;
      if (typeof body[f] === "string") patch[f] = body[f].trim() || null;
    }
    if (typeof body.name === "string" && !body.name.trim()) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "company_name_empty",
          title: "Company update blocked",
          reason: "The company name cannot be empty",
          nextAction: "Enter a company name, then save again",
        }),
        { status: 400 }
      );
    }
    if (!sharedSalesAccess && body.attributes && typeof body.attributes === "object") {
      patch.attributes = body.attributes;
    }
    const removeFromPipeline = body.removeFromPipeline === true;
    const pipelineRemovalReason =
      typeof body.rationale === "string" && body.rationale.trim()
        ? body.rationale.trim().slice(0, 1000)
        : "User confirmed this relationship is not an active sales prospect";
    const pipelineRemovalSource =
      typeof body.sourceChannel === "string" && body.sourceChannel.trim()
        ? body.sourceChannel.trim().slice(0, 80)
        : "client_relationship_update";
    // This owner-level marker prevents later AI synthesis from quietly
    // recreating a deal that the user explicitly removed. It does not prevent
    // a deliberate human-created deal, so real partner expansion stays valid.
    if (removeFromPipeline && current?.owner_id === scope.userId) {
      patch.profile = withCompanyPipelineExclusion(current.profile, {
        reason: pipelineRemovalReason,
        sourceType: body.sourceType === "system" ? "system" : "human",
        sourceChannel: pipelineRemovalSource,
        updatedAt: new Date().toISOString(),
        actorUserId: scope.userId,
      });
    }
    // Stamp when the email context last changed, so the UI can show "updated X".
    if ("email_context" in patch) {
      patch.email_context_updated_at = patch.email_context
        ? new Date().toISOString()
        : null;
    }
    if (Object.keys(patch).length === 0 && !removeFromPipeline) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "company_no_changes",
          title: "Nothing to save",
          reason: "No company fields or pipeline choices were changed",
          nextAction: "Change a field or close the editor without saving",
        }),
        { status: 400 }
      );
    }

    let data: any = current;
    if (sharedSalesAccess && Object.keys(patch).length > 0) {
      const { data: updated, error: updateError } = await supabaseService
        .from("companies")
        .update(patch)
        .eq("workspace_id", scope.workspaceId)
        .eq("id", params.id)
        .select("id,name,domain,website,sector,stage,created_at,updated_at")
        .single();
      if (updateError) throw updateError;
      data = {
        ...updated,
        profile: {},
        attributes: {},
        notes: null,
        email_context: null,
        commercial_memory: null,
      };
      const { error: auditError } = await supabaseService
        .from("access_audit_events")
        .insert({
          workspace_id: scope.workspaceId,
          actor_user_id: scope.userId,
          source: "human",
          action: "shared_client_core_updated",
          target_table: "companies",
          target_id: params.id,
          metadata: { fields: Object.keys(patch) },
        });
      if (auditError) throw auditError;
    } else if (Object.keys(patch).length > 0) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("companies")
        .update(patch)
        .eq("workspace_id", scope.workspaceId)
        .eq("id", params.id)
        .select()
        .single();
      if (updateError) throw updateError;
      data = updated;
    }

    // A relationship label and a revenue opportunity answer different
    // questions. Changing a client to Partner must not silently erase a real
    // expansion deal. When the user explicitly says this company is not a
    // prospect, however, dismiss its active revenue opportunities in the same
    // confirmed action. The rows and their immutable history remain available.
    let dismissedOpportunityIds: string[] = [];
    if (removeFromPipeline) {
      const now = new Date().toISOString();
      let dismissQuery = supabaseService
        .from("opportunities")
        .update({
          status: "dismissed",
          forecast_category: "omitted",
          updated_at: now,
          last_change_context: {
            nonce: crypto.randomUUID(),
            sourceType: body.sourceType === "system" ? "system" : "human",
            sourceChannel:
              pipelineRemovalSource,
            rationale: pipelineRemovalReason,
            evidence: {
              companyId: params.id,
              relationshipStage: patch.stage || data?.stage || null,
              removeFromPipeline: true,
            },
          },
        })
        .eq("workspace_id", scope.workspaceId)
        .eq("company_id", params.id)
        .eq("status", "open")
        .eq("opportunity_type", "revenue");

      // Salespeople may clean up only deals assigned to them. Owners can make
      // the workspace-level call for a company they own.
      if (!(scope.role === "owner" && current?.owner_id === scope.userId)) {
        dismissQuery = dismissQuery.eq("assigned_to_user_id", scope.userId);
      }
      const { data: dismissed, error: dismissError } = await dismissQuery.select("id");
      if (dismissError) throw dismissError;
      dismissedOpportunityIds = (dismissed || []).map((row: any) => row.id);
    }
    return NextResponse.json(
      {
        company: data,
        pipeline: {
          removed: removeFromPipeline,
          dismissedOpportunityIds,
          dismissedCount: dismissedOpportunityIds.length,
        },
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      crmBlockerPayload({
        code: "company_update_not_confirmed",
        title: "Company update not saved",
        reason: "The CRM could not confirm the company change",
        nextAction: "Refresh the company and try once more. If it still fails, ask a workspace owner to check access",
        responsible: "owner",
      }),
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data, error } = await supabaseAdmin
      .from("companies")
      .delete()
      .eq("id", params.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json(
        crmBlockerPayload({
          code: "company_delete_access_missing",
          title: "Company deletion blocked",
          reason: "The company does not exist or is not owned by your account",
          nextAction: "Refresh the client list and ask a workspace owner to verify the record before deleting it",
          responsible: "owner",
        }),
        { status: 404 }
      );
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      crmBlockerPayload({
        code: "company_delete_not_confirmed",
        title: "Company deletion not completed",
        reason: "The CRM could not confirm that the company was removed",
        nextAction: "Refresh the client list before trying again. Do not assume the record was deleted",
        responsible: "system",
      }),
      { status: 500 }
    );
  }
}
