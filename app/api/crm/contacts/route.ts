import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { privateRecordFields } from "@/lib/record-scope";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// GET  /api/crm/contacts?companyId=...  -> contacts for a company
// POST /api/crm/contacts                -> create ({ company_id, name, ... })

export async function GET(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const companyId = req.nextUrl.searchParams.get("companyId");
    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }
    const access = await loadAssignedClientAccess(companyId, scope);
    if (!access) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "contact_company_not_assigned",
          title: "Contacts unavailable",
          reason: "This client is not owned by or assigned to your account",
          nextAction: "Ask a workspace owner to assign the client before opening its contacts",
          responsible: "owner",
        }),
        { status: 404 }
      );
    }
    // A salesperson assigned to a shared client sees only contacts they added.
    // The original owner's contact book remains private.
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("company_id", companyId)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ contacts: data || [] });
  } catch (err: any) {
    console.error("Contact list failed", err?.message || err);
    return NextResponse.json(
      crmBlockerPayload({
        code: "contact_list_not_confirmed",
        title: "Contacts could not be loaded",
        reason: "LiveCoach could not confirm this client's contact list",
        nextAction: "Refresh the client once. If it still fails, send this blocker code to a workspace owner",
        responsible: "system",
      }),
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const companyId =
      typeof body.company_id === "string" ? body.company_id : null;
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    if (companyId) {
      const access = await loadAssignedClientAccess(companyId, scope);
      if (!access) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "contact_company_not_assigned",
            title: "Contact not added",
            reason: "This client is not owned by or assigned to your account",
            nextAction: "Ask a workspace owner to assign the client, then add the contact again",
            responsible: "owner",
          }),
          { status: 404 }
        );
      }
    }
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    let duplicateQuery = supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId);
    duplicateQuery = email
      ? duplicateQuery.ilike("email", email)
      : (companyId
          ? duplicateQuery.eq("company_id", companyId)
          : duplicateQuery.is("company_id", null)
        ).ilike("name", name);
    const { data: duplicate, error: duplicateError } = await duplicateQuery
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) {
      if ((duplicate.company_id || null) !== companyId) {
        return NextResponse.json(
          crmBlockerPayload({
            code: "contact_already_on_another_client",
            title: "Contact not duplicated",
            reason: `${duplicate.name} already exists on another client in your CRM`,
            nextAction: "Open the existing contact and correct its company before adding another copy",
            responsible: "user",
          }),
          { status: 409 }
        );
      }
      return NextResponse.json({
        ok: true,
        contact: duplicate,
        created: false,
        alreadyExists: true,
      });
    }
    const row: Record<string, any> = {
      name,
      company_id: companyId,
      ...privateRecordFields(scope),
    };
    for (const f of ["role", "sector", "notes"]) {
      if (typeof body[f] === "string" && body[f].trim()) row[f] = body[f].trim();
    }
    if (email) row.email = email;
    if (body.attributes && typeof body.attributes === "object") {
      row.attributes = body.attributes;
    }
    if (typeof body.department_id === "string" && body.department_id) {
      const { data: department, error: departmentError } = await supabaseAdmin
        .from("departments")
        .select("id")
        .eq("id", body.department_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (departmentError) throw departmentError;
      if (!department)
        return NextResponse.json(
          { error: "department does not belong to this company" },
          { status: 409 }
        );
      row.department_id = body.department_id;
    }

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      contact: data,
      created: true,
      alreadyExists: false,
    });
  } catch (err: any) {
    console.error("Contact save failed", err?.message || err);
    return NextResponse.json(
      crmBlockerPayload({
        code: "contact_save_not_confirmed",
        title: "Contact not added",
        reason: "LiveCoach could not confirm the contact in your CRM",
        nextAction: "Refresh the client and try once more. If it repeats, send this blocker code to a workspace owner",
        responsible: "system",
      }),
      { status: 500 }
    );
  }
}
