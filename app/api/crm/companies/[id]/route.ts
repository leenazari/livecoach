import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

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
] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { data: company, error } = await supabaseAdmin
      .from("companies")
      .select("*")
      .eq("id", params.id)
      .single();
    if (error) throw error;

    const { data: contacts, error: cErr } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("company_id", params.id)
      .order("created_at", { ascending: true });
    if (cErr) throw cErr;

    return NextResponse.json({ company, contacts: contacts || [] });
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
    const body = await req.json();
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
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("companies")
      .update(patch)
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ company: data });
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
    const { error } = await supabaseAdmin
      .from("companies")
      .delete()
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to delete company" },
      { status: 500 }
    );
  }
}
