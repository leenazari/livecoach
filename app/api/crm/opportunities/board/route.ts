import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_THINK } from "@/lib/anthropic";
import { coachSystemBlock } from "@/lib/brain-coach";
import { workspaceContextBlock } from "@/lib/workspace";
import { logModelUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 40;
// Reads live workload and (optionally) runs the coach. Must be dynamic.
export const dynamic = "force-dynamic";

const THINK_LABEL: "opus" | "sonnet" = CLAUDE_MODEL_THINK.toLowerCase().includes(
  "opus"
)
  ? "opus"
  : "sonnet";

// The opportunity-grouped, prioritised view of the whole to-do pile. Instead of
// a flat list of every task, this groups the open work by client/deal into a
// short ranked list. The coach (THINK model) decides the order by what moves the
// goal - how close the deal is, an imminent call, the work that unlocks it, and
// the size of the prize - and Lee's manual drag order, when set, wins over it.
//
// The to-dos themselves are NOT returned here: the UI mounts the existing
// <TaskList companyId/> when a row is expanded, so all the tick / dismiss /
// click-to-act behaviour is reused. This endpoint only ranks the opportunities.

type Opp = {
  companyId: string;
  company: string;
  value: number | null;
  valueIsEstimate: boolean;
  count: number;
  dueSoon: boolean;
  nextCallAt: string | null;
  reason: string;
  // Internal, for ranking only - not sent to the client.
  _texts?: string[];
};

const SOON_MS = 48 * 60 * 60 * 1000;

// Deterministic fallback order (and tie-break): an imminent call leads, then the
// soonest next call, then the biggest prize, then the most open work.
function heuristicSort(a: Opp, b: Opp): number {
  if (a.dueSoon !== b.dueSoon) return a.dueSoon ? -1 : 1;
  const an = a.nextCallAt ? new Date(a.nextCallAt).getTime() : Infinity;
  const bn = b.nextCallAt ? new Date(b.nextCallAt).getTime() : Infinity;
  if (an !== bn) return an - bn;
  const av = a.value || 0;
  const bv = b.value || 0;
  if (av !== bv) return bv - av;
  if (a.count !== b.count) return b.count - a.count;
  return a.company.localeCompare(b.company);
}

function heuristicReason(o: Opp): string {
  if (o.dueSoon && o.nextCallAt) return "Call coming up, prep now";
  if (o.nextCallAt) return "Next call scheduled";
  if (o.value && o.value > 0)
    return `£${Math.round(o.value).toLocaleString()} in play`;
  return `${o.count} open ${o.count === 1 ? "to-do" : "to-dos"}`;
}

export async function GET(req: Request) {
  const light = new URL(req.url).searchParams.get("light") === "1";
  try {
    const nowMs = Date.now();
    const graceIso = new Date(nowMs - 3 * 60 * 60 * 1000).toISOString();

    const [
      { data: companies },
      { data: openTasks },
      { data: ucals },
      { data: opps },
      { data: prio },
    ] = await Promise.all([
      supabaseAdmin.from("companies").select("id, name"),
      supabaseAdmin
        .from("tasks")
        .select("company_id, text, due_at")
        .eq("status", "open")
        .not("company_id", "is", null)
        .limit(1000),
      supabaseAdmin
        .from("upcoming_calls")
        .select("company_id, title, scheduled_at, prepped")
        .not("company_id", "is", null)
        .eq("prepped", false)
        .gte("scheduled_at", graceIso)
        .limit(300),
      supabaseAdmin
        .from("opportunities")
        .select("company_id, value, title")
        .eq("status", "open")
        .limit(300),
      supabaseAdmin
        .from("company_priority")
        .select("company_id, position"),
    ]);

    const nameById = new Map<string, string>();
    for (const c of companies || []) nameById.set(c.id, c.name);

    // Group open tasks + prep calls by client into opportunity rows.
    const byCompany = new Map<string, Opp>();
    const ensure = (companyId: string): Opp => {
      let o = byCompany.get(companyId);
      if (!o) {
        o = {
          companyId,
          company: nameById.get(companyId) || "a client",
          value: null,
          valueIsEstimate: false,
          count: 0,
          dueSoon: false,
          nextCallAt: null,
          reason: "",
          _texts: [],
        };
        byCompany.set(companyId, o);
      }
      return o;
    };

    let looseCount = 0;
    for (const t of openTasks || []) {
      const cid = t.company_id as string | null;
      if (!cid) {
        looseCount += 1;
        continue;
      }
      const o = ensure(cid);
      o.count += 1;
      if (o._texts!.length < 5 && typeof t.text === "string")
        o._texts!.push(t.text);
      const due = t.due_at ? new Date(t.due_at as string).getTime() : null;
      if (due != null && due - nowMs <= SOON_MS) o.dueSoon = true;
    }

    for (const u of ucals || []) {
      const cid = u.company_id as string | null;
      if (!cid || !u.scheduled_at) continue;
      const o = ensure(cid);
      o.count += 1; // the prep to-do counts as work on the deal
      const ms = new Date(u.scheduled_at as string).getTime();
      if (!o.nextCallAt || ms < new Date(o.nextCallAt).getTime())
        o.nextCallAt = u.scheduled_at as string;
      if (ms - nowMs <= SOON_MS) o.dueSoon = true;
      if (o._texts!.length < 5 && typeof u.title === "string")
        o._texts!.push(`Call: ${u.title}`);
    }

    // Real opportunity value: the biggest open opp for that client.
    for (const op of opps || []) {
      const cid = op.company_id as string | null;
      if (!cid || !byCompany.has(cid)) continue;
      const v = Number(op.value) || 0;
      const o = byCompany.get(cid)!;
      if (v > 0 && (o.value == null || v > o.value)) {
        o.value = v;
        o.valueIsEstimate = false;
      }
    }

    let list = [...byCompany.values()];
    if (list.length === 0) {
      return NextResponse.json({ opportunities: [], looseCount, manual: false });
    }

    // Manual drag order, when Lee has set one, wins.
    const posById = new Map<string, number>();
    for (const p of prio || [])
      posById.set(p.company_id as string, Number(p.position));
    const hasManual = posById.size > 0;

    // Coach ranking (THINK), cached by workload so it is not recomputed each
    // load. Returns an order + a one-line reason + an optional value estimate.
    let coachOrder: string[] = [];
    const coachReason = new Map<string, string>();
    if (!light && list.length > 1) {
      const summary = list
        .map(
          (o, i) =>
            `${i}. ${o.company} | value: ${
              o.value ? `£${o.value}` : "unknown"
            } | open items: ${o.count} | next call: ${
              o.nextCallAt
                ? new Date(o.nextCallAt).toISOString().slice(0, 16)
                : "none"
            } | work: ${(o._texts || []).join("; ").slice(0, 240)}`
        )
        .join("\n");
      const cacheKey =
        "oppboard1:" + createHash("sha256").update(summary).digest("hex");
      try {
        const { data: hit } = await supabaseAdmin
          .from("ai_cache")
          .select("value")
          .eq("key", cacheKey)
          .maybeSingle();
        if (hit?.value) {
          const parsed = JSON.parse(String(hit.value));
          if (Array.isArray(parsed)) {
            for (const r of parsed) {
              const idx = Number(r?.i);
              if (Number.isInteger(idx) && list[idx]) {
                coachOrder.push(list[idx].companyId);
                if (typeof r?.reason === "string")
                  coachReason.set(list[idx].companyId, r.reason.trim());
                const est = Number(r?.value);
                if (
                  est > 0 &&
                  list[idx].value == null
                ) {
                  list[idx].value = est;
                  list[idx].valueIsEstimate = true;
                }
              }
            }
          }
        }
      } catch {
        /* cache miss is fine */
      }

      if (!coachOrder.length) {
        try {
          const biz = await workspaceContextBlock();
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 22000);
          try {
            const msg = await anthropic.messages.create(
              {
                model: CLAUDE_MODEL_THINK,
                max_tokens: 900,
                system: `${biz}${coachSystemBlock()}

You are ranking Lee's open OPPORTUNITIES (one per client) by what most moves him toward the goal. Weigh: how close the deal is to a decision, an imminent next call, the set of to-dos that must be finished to UNLOCK the deal, and the size of the prize. Order by impact, most important first - not by recency. For any opportunity with an unknown value, estimate a rough potential value in GBP from the context (a number, clearly an estimate). Output ONLY a JSON array, most important first:
[{"i": the opportunity's index number, "reason": a max 8 word why-it-ranks-here, "value": a GBP number or null}]
Include every index exactly once. Be honest and specific, never flattering.`,
                messages: [{ role: "user", content: summary }],
              },
              { signal: controller.signal }
            );
            await logModelUsage("opp-board-rank", THINK_LABEL, (msg as any).usage);
            const raw = msg.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("");
            const a = raw.indexOf("[");
            const b = raw.lastIndexOf("]");
            const parsed = a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : [];
            if (Array.isArray(parsed)) {
              const order: { i: number; reason: string; value: number | null }[] =
                [];
              for (const r of parsed) {
                const idx = Number(r?.i);
                if (!Number.isInteger(idx) || !list[idx]) continue;
                const reason =
                  typeof r?.reason === "string" ? r.reason.trim() : "";
                const est = Number(r?.value);
                const value = est > 0 ? est : null;
                order.push({ i: idx, reason, value });
                coachOrder.push(list[idx].companyId);
                if (reason) coachReason.set(list[idx].companyId, reason);
                if (value && list[idx].value == null) {
                  list[idx].value = value;
                  list[idx].valueIsEstimate = true;
                }
              }
              if (order.length) {
                try {
                  await supabaseAdmin.from("ai_cache").upsert({
                    key: cacheKey,
                    value: JSON.stringify(order),
                    created_at: new Date().toISOString(),
                  });
                } catch {
                  /* caching is best-effort */
                }
              }
            }
          } finally {
            clearTimeout(timer);
          }
        } catch {
          /* coach ranking is optional - heuristic order covers it */
        }
      }
    }

    // Final order: manual positions first (Lee's drag wins), then the coach
    // order, then the heuristic for anything left or if the coach didn't run.
    const coachRank = new Map<string, number>();
    coachOrder.forEach((cid, i) => coachRank.set(cid, i));
    const heuristicRanked = [...list].sort(heuristicSort);
    const heuristicRank = new Map<string, number>();
    heuristicRanked.forEach((o, i) => heuristicRank.set(o.companyId, i));

    list.sort((a, b) => {
      if (hasManual) {
        const ap = posById.has(a.companyId)
          ? posById.get(a.companyId)!
          : Infinity;
        const bp = posById.has(b.companyId)
          ? posById.get(b.companyId)!
          : Infinity;
        if (ap !== bp) return ap - bp;
      }
      const ac = coachRank.has(a.companyId)
        ? coachRank.get(a.companyId)!
        : Infinity;
      const bc = coachRank.has(b.companyId)
        ? coachRank.get(b.companyId)!
        : Infinity;
      if (ac !== bc) return ac - bc;
      return heuristicRank.get(a.companyId)! - heuristicRank.get(b.companyId)!;
    });

    const opportunities = list.map((o) => ({
      companyId: o.companyId,
      company: o.company,
      value: o.value,
      valueIsEstimate: o.valueIsEstimate,
      count: o.count,
      dueSoon: o.dueSoon,
      nextCallAt: o.nextCallAt,
      reason: coachReason.get(o.companyId) || heuristicReason(o),
    }));

    return NextResponse.json({ opportunities, looseCount, manual: hasManual });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load the opportunity board" },
      { status: 500 }
    );
  }
}
