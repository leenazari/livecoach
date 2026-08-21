import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { loadSafeSharedCompany } from "@/lib/team-client-sharing";

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
        .select("id,company_id,status,shared_by_user_id,updated_at")
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
        .select("id,company_id,status,shared_by_user_id,updated_at")
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
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    }

    const [contactsResult, departmentsResult, workstreamsResult, linksResult] =
      sharedSalesAccess
        ? [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ]
        : await Promise.all([
        supabaseAdmin
          .from("contacts")
          .select("*")
          .eq("company_id", params.id)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("departments")
          .select("id, company_id, name, description, created_at, updated_at")
          .eq("company_id", params.id)
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("workstreams")
          .select(
            "id, company_id, department_id, name, kind, status, purpose, created_at, updated_at"
          )
          .eq("company_id", params.id)
          .order("status", { ascending: true })
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("workstream_contacts")
          .select(
            "workstream_id, contact_id, company_id, relationship_role, is_primary"
          )
          .eq("company_id", params.id),
          ]);
    for (const result of [
      contactsResult,
      departmentsResult,
      workstreamsResult,
      linksResult,
    ]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      company,
      contacts: contactsResult.data || [],
      departments: departmentsResult.data || [],
      workstreams: workstreamsResult.data || [],
      workstreamContacts: linksResult.data || [],
      access: {
        mode: sharedSalesAccess ? "shared_sales" : "owner",
        shared: !!activeShare,
        canManageSharing:
          !sharedSalesAccess &&
          scope.role === "owner" &&
          company.owner_id === scope.userId,
        privateSourcesHidden: sharedSalesAccess,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "company not found" },
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
      .select("id,owner_id,workspace_id")
      .eq("id", params.id)
      .maybeSingle();
    if (currentError) throw currentError;

    let sharedSalesAccess = false;
    if (!current || current.owner_id !== scope.userId) {
      const { data: share, error: shareError } = await supabaseAdmin
        .from("team_client_shares")
        .select("id")
        .eq("workspace_id", scope.workspaceId)
        .eq("company_id", params.id)
        .eq("status", "active")
        .maybeSingle();
      if (shareError) throw shareError;
      sharedSalesAccess = !!share;
      if (!sharedSalesAccess) {
        return NextResponse.json({ error: "company not found" }, { status: 404 });
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
        { error: "name cannot be empty" },
        { status: 400 }
      );
    }
    if (!sharedSalesAccess && body.attributes && typeof body.attributes === "object") {
      patch.attributes = body.attributes;
    }
    // Stamp when the email context last changed, so the UI can show "updated X".
    if ("email_context" in patch) {
      patch.email_context_updated_at = patch.email_context
        ? new Date().toISOString()
        : null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    let data: any;
    if (sharedSalesAccess) {
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
    } else {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("companies")
        .update(patch)
        .eq("id", params.id)
        .select()
        .single();
      if (updateError) throw updateError;
      data = updated;
    }
    return NextResponse.json(
      { company: data },
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
      { error: err?.message || "failed to update company" },
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
      return NextResponse.json({ error: "company not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete company" },
      { status: 500 }
    );
  }
}
