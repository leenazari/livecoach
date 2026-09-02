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
      .select("id,company_id,owner_id,workspace_id")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", params.id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) {
      return NextResponse.json({ error: "contact not found" }, { status: 404 });
    }
    const access = await loadAssignedClientAccess(current.company_id, scope);
    if (!access) {
      return NextResponse.json(
        { error: "This contact is not owned by or assigned to your account" },
        { status: 403 }
      );
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
    if ("departmentId" in body) {
      const departmentId =
        typeof body.departmentId === "string" && body.departmentId
          ? body.departmentId
          : null;
      if (departmentId) {
        const { data: department, error: departmentError } = await supabaseAdmin
          .from("departments")
          .select("id")
          .eq("workspace_id", scope.workspaceId)
          .eq("id", departmentId)
          .eq("company_id", current.company_id)
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
    return NextResponse.json(
      { error: err?.message || "failed to update contact" },
      { status: 500 }
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
