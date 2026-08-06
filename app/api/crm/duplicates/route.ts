import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Company = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  updated_at: string | null;
};

const nameKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/\b(limited|ltd|incorporated|inc|llc|plc|company|co)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();

const domainKey = (domain?: string | null, website?: string | null) =>
  String(domain || website || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim();

// Conservative duplicate detector: exact normalised names/domains or the same
// contact email attached to different clients. It only suggests review and
// never mutates CRM records.
export async function GET() {
  try {
    const [{ data: companies, error: companyError }, { data: contacts, error: contactError }] =
      await Promise.all([
        supabaseAdmin
          .from("companies")
          .select("id, name, domain, website, updated_at")
          .limit(1000),
        supabaseAdmin
          .from("contacts")
          .select("company_id, email")
          .not("company_id", "is", null)
          .not("email", "is", null)
          .limit(3000),
      ]);
    if (companyError) throw companyError;
    if (contactError) throw contactError;

    const rows = (companies || []) as Company[];
    const byId = new Map(rows.map((c) => [c.id, c]));
    const pairReasons = new Map<string, Set<string>>();
    const addPair = (a: string, b: string, reason: string) => {
      if (!a || !b || a === b) return;
      const ids = [a, b].sort();
      const key = ids.join(":");
      const reasons = pairReasons.get(key) || new Set<string>();
      reasons.add(reason);
      pairReasons.set(key, reasons);
    };

    const group = (entries: { id: string; key: string }[], reason: string) => {
      const groups = new Map<string, string[]>();
      for (const entry of entries) {
        if (!entry.key) continue;
        const ids = groups.get(entry.key) || [];
        ids.push(entry.id);
        groups.set(entry.key, ids);
      }
      for (const ids of groups.values()) {
        if (ids.length < 2) continue;
        for (let i = 0; i < ids.length; i += 1)
          for (let j = i + 1; j < ids.length; j += 1)
            addPair(ids[i], ids[j], reason);
      }
    };

    group(
      rows.map((c) => {
        const key = nameKey(c.name || "");
        return { id: c.id, key: key.length >= 4 ? key : "" };
      }),
      "same name"
    );
    group(
      rows.map((c) => ({ id: c.id, key: domainKey(c.domain, c.website) })),
      "same website"
    );
    group(
      (contacts || []).map((c: any) => ({
        id: String(c.company_id || ""),
        key: String(c.email || "").toLowerCase().trim(),
      })),
      "same contact email"
    );

    const duplicates = [...pairReasons.entries()]
      .map(([key, reasons]) => {
        const [aId, bId] = key.split(":");
        const a = byId.get(aId);
        const b = byId.get(bId);
        if (!a || !b) return null;
        return {
          id: key,
          reason: [...reasons].join(" + "),
          records: [
            { id: a.id, name: a.name, updatedAt: a.updated_at },
            { id: b.id, name: b.name, updatedAt: b.updated_at },
          ],
        };
      })
      .filter(Boolean)
      .slice(0, 20);

    return NextResponse.json({ duplicates });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to check duplicate clients" },
      { status: 500 }
    );
  }
}
