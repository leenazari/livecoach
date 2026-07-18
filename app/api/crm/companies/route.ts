import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// GET /api/crm/companies?q=...  -> list companies (newest-touched first).
// POST /api/crm/companies       -> create a company ({ name, ...optional }).

const CORE_FIELDS = [
  "name",
  "domain",
  "website",
  "sector",
  "stage",
  "notes",
] as const;

export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    let query = supabaseAdmin
      .from("companies")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);

    if (q) {
      // Sanitise so the value can't break the PostgREST or-filter syntax.
      const safe = q.replace(/[,()*%]/g, " ").trim();
      if (safe) {
        query = query.or(
          `name.ilike.%${safe}%,sector.ilike.%${safe}%,domain.ilike.%${safe}%`
        );
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ companies: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to list companies" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const row: Record<string, any> = { name };
    for (const f of CORE_FIELDS) {
      if (f === "name") continue;
      if (typeof body[f] === "string" && body[f].trim()) row[f] = body[f].trim();
    }
    if (body.attributes && typeof body.attributes === "object") {
      row.attributes = body.attributes;
    }

    const { data, error } = await supabaseAdmin
      .from("companies")
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ company: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to create company" },
      { status: 500 }
    );
  }
}
