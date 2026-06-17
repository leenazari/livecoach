import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fold loose (unlinked) to-dos into the opportunity they're about, so the
// opportunity board groups them instead of a flat pile. Deterministic and
// conservative: a task links to a client only when exactly ONE external client's
// name or alias appears in it. Genuinely cross-cutting or internal tasks (named
// by no single client) stay loose, which is correct.

const norm = (s: string) =>
  ` ${String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;

export async function GET() {
  return run();
}
export async function POST() {
  return run();
}

async function run() {
  try {
    const [{ data: tasks }, { data: companies }] = await Promise.all([
      supabaseAdmin
        .from("tasks")
        .select("id, text")
        .eq("status", "open")
        .is("company_id", null)
        .limit(300),
      supabaseAdmin.from("companies").select("id, name, profile"),
    ]);

    // Build each EXTERNAL client's matchable terms (name + aliases, >= 5 chars).
    const terms: { id: string; term: string }[] = [];
    for (const c of companies || []) {
      const profile = (c as any).profile || {};
      if (profile.internal === true) continue; // internal entity isn't an opportunity
      const aliases = Array.isArray(profile.aliases) ? profile.aliases : [];
      for (const raw of [(c as any).name, ...aliases]) {
        const t = norm(String(raw || "")).trim();
        if (t.length >= 5) terms.push({ id: (c as any).id as string, term: t });
      }
    }

    const folded: { id: string; companyId: string }[] = [];
    for (const task of tasks || []) {
      const hay = norm((task as any).text);
      const hits = new Set<string>();
      for (const { id, term } of terms) {
        if (hay.includes(term)) hits.add(id);
      }
      if (hits.size === 1) {
        folded.push({
          id: (task as any).id as string,
          companyId: Array.from(hits)[0],
        });
      }
    }

    // Apply (grouped per company keeps it to a handful of updates).
    const byCompany = new Map<string, string[]>();
    for (const f of folded) {
      const arr = byCompany.get(f.companyId) || [];
      arr.push(f.id);
      byCompany.set(f.companyId, arr);
    }
    for (const [companyId, ids] of byCompany) {
      await supabaseAdmin
        .from("tasks")
        .update({ company_id: companyId })
        .in("id", ids);
    }

    return NextResponse.json({ ok: true, folded: folded.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "fold failed" },
      { status: 500 }
    );
  }
}
