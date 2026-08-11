import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getWorkstreamScope } from "@/lib/workstreams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const [{ data: workstream, error }, { data: links, error: linksError }] =
      await Promise.all([
        supabaseAdmin
          .from("workstreams")
          .select("*")
          .eq("id", params.id)
          .maybeSingle(),
        supabaseAdmin
          .from("workstream_contacts")
          .select("contact_id, relationship_role, is_primary")
          .eq("workstream_id", params.id),
      ]);
    if (error) throw error;
    if (linksError) throw linksError;
    if (!workstream)
      return NextResponse.json({ error: "workstream not found" }, { status: 404 });

    const contactIds = (links || []).map((link: any) => link.contact_id);
    const { data: contacts, error: contactsError } = contactIds.length
      ? await supabaseAdmin
          .from("contacts")
          .select("id, company_id, department_id, name, role, email, attributes")
          .in("id", contactIds)
      : { data: [], error: null };
    if (contactsError) throw contactsError;
    const scope = await getWorkstreamScope(params.id);

    return NextResponse.json({
      workstream: {
        ...workstream,
        departmentName: scope?.departmentName || null,
      },
      contacts: contacts || [],
      contactLinks: links || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load workstream" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const current = await getWorkstreamScope(params.id);
    if (!current)
      return NextResponse.json({ error: "workstream not found" }, { status: 404 });
    const body = await req.json();
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const field of ["name", "purpose", "email_context"] as const) {
      if (typeof body[field] === "string") patch[field] = body[field].trim() || null;
    }
    if (typeof body.status === "string" && ["active", "paused", "completed", "archived"].includes(body.status))
      patch.status = body.status;
    if (typeof body.kind === "string" && ["relationship", "opportunity", "partnership", "project", "support", "internal"].includes(body.kind))
      patch.kind = body.kind;
    if ("departmentId" in body) {
      const departmentId =
        typeof body.departmentId === "string" && body.departmentId
          ? body.departmentId
          : null;
      if (departmentId) {
        const { data: department, error: departmentError } = await supabaseAdmin
          .from("departments")
          .select("id")
          .eq("id", departmentId)
          .eq("company_id", current.companyId)
          .maybeSingle();
        if (departmentError) throw departmentError;
        if (!department)
          return NextResponse.json(
            { error: "department does not belong to this company" },
            { status: 409 }
          );
      }
      patch.department_id = departmentId;
    }
    if ("email_context" in patch) {
      patch.email_context_updated_at = patch.email_context
        ? new Date().toISOString()
        : null;
    }

    const contactId =
      typeof body.contactId === "string" &&
      /^[0-9a-f-]{36}$/i.test(body.contactId)
        ? body.contactId
        : null;
    if (contactId) {
      const { data: contact, error: contactError } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("id", contactId)
        .eq("company_id", current.companyId)
        .maybeSingle();
      if (contactError) throw contactError;
      if (!contact)
        return NextResponse.json(
          { error: "contact does not belong to this company" },
          { status: 409 }
        );
    }

    const { data, error } = await supabaseAdmin
      .from("workstreams")
      .update(patch)
      .eq("id", params.id)
      .eq("company_id", current.companyId)
      .select()
      .single();
    if (error) throw error;
    if (contactId && typeof body.assigned === "boolean") {
      const membership = supabaseAdmin.from("workstream_contacts");
      const { error: membershipError } = body.assigned
        ? await membership.upsert(
            {
              workstream_id: current.id,
              contact_id: contactId,
              company_id: current.companyId,
            },
            { onConflict: "workstream_id,contact_id" }
          )
        : await membership
            .delete()
            .eq("workstream_id", current.id)
            .eq("contact_id", contactId);
      if (membershipError) throw membershipError;
    }
    return NextResponse.json({
      workstream: data,
      contactId,
      assigned: contactId ? body.assigned : undefined,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to update workstream" },
      { status: 500 }
    );
  }
}
