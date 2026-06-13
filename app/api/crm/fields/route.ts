import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// The "Lego" field registry. Add a definition here and it appears as an
// editable custom field on every record of that entity - no migration.
//
// GET  /api/crm/fields?entity=company|contact -> definitions, ordered
// POST /api/crm/fields                        -> add one

const TYPES = [
  "text",
  "number",
  "currency",
  "date",
  "select",
  "multiselect",
  "url",
  "boolean",
];

function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

export async function GET(req: NextRequest) {
  try {
    const entity = req.nextUrl.searchParams.get("entity");
    let query = supabaseAdmin
      .from("field_definitions")
      .select("*")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (entity === "company" || entity === "contact") {
      query = query.eq("entity", entity);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ fields: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to list fields" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entity = body.entity;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const type = body.type;

    if (entity !== "company" && entity !== "contact") {
      return NextResponse.json(
        { error: "entity must be 'company' or 'contact'" },
        { status: 400 }
      );
    }
    if (!label) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    if (!TYPES.includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    const key = typeof body.key === "string" && body.key.trim()
      ? slugifyKey(body.key)
      : slugifyKey(label);
    if (!key) {
      return NextResponse.json(
        { error: "could not derive a key from the label" },
        { status: 400 }
      );
    }

    const options = Array.isArray(body.options)
      ? body.options.filter((o: any) => typeof o === "string" && o.trim())
      : [];

    const row = {
      entity,
      key,
      label,
      type,
      options,
      filterable: body.filterable !== false,
      searchable: body.searchable !== false,
      position: Number.isFinite(body.position) ? body.position : 0,
    };

    const { data, error } = await supabaseAdmin
      .from("field_definitions")
      .insert(row)
      .select()
      .single();
    if (error) {
      // Unique (owner, entity, key) violation -> friendly message.
      if (String(error.message || "").toLowerCase().includes("duplicate")) {
        return NextResponse.json(
          { error: `a "${label}" field already exists for ${entity}` },
          { status: 409 }
        );
      }
      throw error;
    }
    return NextResponse.json({ field: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to create field" },
      { status: 500 }
    );
  }
}
