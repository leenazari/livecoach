import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET  /api/crm/contacts?companyId=...  -> contacts for a company
// POST /api/crm/contacts                -> create ({ company_id, name, ... })

export async function GET(req: NextRequest) {
  try {
    const companyId = req.nextUrl.searchParams.get("companyId");
    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      );
    }
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ contacts: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to list contacts" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const companyId =
      typeof body.company_id === "string" ? body.company_id : null;
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const row: Record<string, any> = { name, company_id: companyId };
    for (const f of ["role", "email", "sector", "notes"]) {
      if (typeof body[f] === "string" && body[f].trim()) row[f] = body[f].trim();
    }
    if (body.attributes && typeof body.attributes === "object") {
      row.attributes = body.attributes;
    }

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ contact: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to create contact" },
      { status: 500 }
    );
  }
}
