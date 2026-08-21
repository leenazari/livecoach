import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveExistingCompany } from "@/lib/company-resolver";
import { requireRequestScope } from "@/lib/request-scope";
import {
  activeSharedClientIds,
  loadSafeSharedCompanies,
} from "@/lib/team-client-sharing";

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
    const scope = requireRequestScope();
    const q = (req.nextUrl.searchParams.get("q") || "").trim();
    let query = supabaseAdmin
      .from("companies")
      .select("*")
      .eq("owner_id", scope.userId)
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

    const [{ data, error }, sharedIds] = await Promise.all([
      query,
      activeSharedClientIds(),
    ]);
    if (error) throw error;
    const ownedIds = new Set((data || []).map((company: any) => company.id));
    const shared = await loadSafeSharedCompanies(
      sharedIds.filter((id) => !ownedIds.has(id)),
      scope.workspaceId
    );
    const needle = q.toLowerCase();
    const matchingShared = needle
      ? shared.filter((company) =>
          [company.name, company.sector, company.domain]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
      : shared;
    return NextResponse.json({ companies: [...(data || []), ...matchingShared] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to list companies" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Manual creation should be idempotent. Reuse an exact existing client
    // name (case-insensitive) instead of quietly splitting its history.
    const existing = await resolveExistingCompany(
      {
        name,
        domain: typeof body.domain === "string" ? body.domain : null,
      },
      { select: "*" }
    );
    if (existing) {
      return NextResponse.json({ company: existing, existing: true });
    }

    const sharedIds = await activeSharedClientIds();
    const sharedCompanies = await loadSafeSharedCompanies(
      sharedIds,
      scope.workspaceId
    );
    const sharedExisting = sharedCompanies.find(
      (company) => company.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (sharedExisting) {
      return NextResponse.json({
        company: sharedExisting,
        existing: true,
        shared: true,
      });
    }

    // Generic client creation fails closed to private. Dedicated outreach and
    // approved sharing flows set team visibility explicitly, so a manually
    // entered investor or confidential relationship cannot leak by default.
    const row: Record<string, any> = { name, visibility: "private" };
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
