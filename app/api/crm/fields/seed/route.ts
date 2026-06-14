import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Seeds the standard fields every client should have (owner, priority, value,
// address) into the field registry, if they aren't there already. Idempotent:
// the unique (owner, entity, key) index means re-seeding is a no-op. Called once
// when the CRM loads so the standard fields always exist.
const STANDARD = [
  { key: "relationship_owner", label: "Relationship owner", type: "text", options: [], position: 1 },
  { key: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"], position: 2 },
  { key: "value", label: "Value / deal size", type: "currency", options: [], position: 3 },
  { key: "address", label: "Address", type: "text", options: [], position: 4 },
];

export async function POST() {
  try {
    const rows = STANDARD.map((f) => ({
      entity: "company",
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options,
      filterable: true,
      searchable: true,
      position: f.position,
    }));
    // Insert ignoring duplicates (unique index on entity+key for single-user).
    const { error } = await supabaseAdmin
      .from("field_definitions")
      .upsert(rows, {
        onConflict:
          "owner_id,entity,key" as any,
        ignoreDuplicates: true,
      });
    if (error) {
      // Fall back to per-row insert that tolerates conflicts.
      for (const r of rows) {
        await supabaseAdmin.from("field_definitions").insert(r).then(
          () => {},
          () => {}
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "seed failed" },
      { status: 500 }
    );
  }
}
