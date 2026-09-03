import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";

export const runtime = "nodejs";

// PATCH  /api/crm/contacts/:id -> update core fields + custom attributes
// DELETE /api/crm/contacts/:id -> remove

const PATCHABLE = ["name", "role", "email", "sector", "notes"] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const { data: current, error: currentError } = await supabaseAdmin
      .from("contacts")
      .select("id,company_id,owner_id,workspace_id,name,email")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", params.id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) {
      return NextResponse.json({ error: "contact not found" }, { status: 404 });
    }
    if (current.owner_id !== scope.userId) {
      return NextResponse.json(
        { error: "Only the person who owns this contact can change its company" },
        { status: 403 }
      );
    }
    if (current.company_id) {
      const access = await loadAssignedClientAccess(current.company_id, scope);
      if (!access) {
        return NextResponse.json(
          { error: "This contact's current company is not available to your account" },
          { status: 403 }
        );
      }
    }
    const patch: Record<string, any> = {};
    for (const f of PATCHABLE) {
      if (typeof body[f] === "string") patch[f] = body[f].trim() || null;
    }
    if (typeof body.name === "string" && !body.name.trim()) {
      return NextResponse.json(
        { error: "name cannot be empty" },
        { status: 400 }
      );
    }
    if (body.attributes && typeof body.attributes === "object") {
      patch.attributes = body.attributes;
    }
    if ("companyId" in body) {
      const companyId =
        body.companyId === null
          ? null
          : typeof body.companyId === "string"
            ? body.companyId.trim()
            : "";
      if (companyId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyId)) {
        return NextResponse.json(
          { error: "Choose one exact CRM company for this contact" },
          { status: 400 }
        );
      }
      const targetAccess = companyId
        ? await loadAssignedClientAccess(companyId, scope)
        : null;
      if (companyId && !targetAccess) {
        return NextResponse.json(
          { error: "The selected company is not owned by or assigned to your account" },
          { status: 403 }
        );
      }
      if (companyId && current.email) {
        const { data: duplicate, error: duplicateError } = await supabaseAdmin
          .from("contacts")
          .select("id,name")
          .eq("workspace_id", scope.workspaceId)
          .eq("company_id", companyId)
          .ilike("email", String(current.email).trim())
          .neq("id", current.id)
          .limit(1)
          .maybeSingle();
        if (duplicateError) throw duplicateError;
        if (duplicate) {
          return NextResponse.json(
            {
              error: `${duplicate.name || "Another contact"} already uses this exact email at the selected company. Review the duplicate before linking.`,
              code: "contact_company_exact_email_duplicate",
            },
            { status: 409 }
          );
        }
      }
      patch.company_id = companyId;
      patch.department_id = null;
    }
    if ("departmentId" in body) {
      const departmentId =
        typeof body.departmentId === "string" && body.departmentId
          ? body.departmentId
          : null;
      if (departmentId) {
        const departmentCompanyId = Object.prototype.hasOwnProperty.call(
          patch,
          "company_id"
        )
          ? patch.company_id
          : current.company_id;
        if (!departmentCompanyId) {
          return NextResponse.json(
            { error: "Link the contact to a company before choosing a department" },
            { status: 409 }
          );
        }
        const { data: department, error: departmentError } = await supabaseAdmin
          .from("departments")
          .select("id")
          .eq("workspace_id", scope.workspaceId)
          .eq("id", departmentId)
          .eq("company_id", departmentCompanyId)
          .maybeSingle();
        if (departmentError) throw departmentError;
        if (!department)
          return NextResponse.json(
            { error: "department does not belong to this contact's company" },
            { status: 409 }
          );
      }
      patch.department_id = departmentId;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .update(patch)
      .eq("workspace_id", scope.workspaceId)
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ contact: data });
  } catch (err: any) {
    const message = err?.message || "failed to update contact";
    return NextResponse.json(
      { error: message },
      { status: /access|owned by|assigned to/i.test(message) ? 403 : 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const deletion = supabaseAdmin
      .from("contacts")
      .delete()
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("id", params.id);
    const { data, error } = await deletion.select("id").maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: "contact not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete contact" },
      { status: 500 }
    );
  }
}
