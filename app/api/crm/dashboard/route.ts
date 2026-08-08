import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { workspaceContextBlock } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 25;
// Live state, must never be statically optimised or cached.
export const dynamic = "force-dynamic";

// Guarantee the "your day" read is plain prose: the model sometimes ignores the
// "no markdown / no em-dash" instruction (and a cached blurb can predate the
// rule), so we strip it deterministically. Removes markdown emphasis/headings,
// turns em/en dashes and semicolons into commas, and a leading "Your day" label
// the model occasionally prepends. Never trust the LLM to self-police format.
function sanitizeRead(s: string): string {
  return (s || "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*your day[^.:\n]*[:\n]\s*/i, "") // drop a "Your day ...:" title
    .replace(/[—–]/g, ", ") // em / en dash -> comma
    .replace(/;/g, ",")
    .replace(/\s+([,.;:!?])/g, "$1") // no space before punctuation
    .replace(/,\s*,/g, ",") // collapse doubled commas
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Keep a day-read line short. A scheduled call's `intent` can hold a whole
// saved game plan, which would swamp the dashboard, so we show only the first
// sentence here (the full plan is still on the call/client page). Falls back to
// a hard word-boundary clamp if the first sentence is itself very long.
function firstSentence(s: string, max = 180): string {
  const t = (s || "").trim();
  if (!t) return "";
  const m = t.match(/^[\s\S]*?[.!?](\s|$)/);
  let out = (m ? m[0] : t).trim();
  if (out.length > max) {
    out = out.slice(0, max).replace(/\s+\S*$/, "").trim() + "…";
  }
  return out;
}

// The CRM dashboard: everything on your plate across all clients, in one call.
// KPIs, a short AI read of your day, and a "do next" list pulled from follow-up
// drafts, open opportunities and the commitments you made on recent calls.
export async function GET(req: Request) {
  // ?light=1 skips the (slow) AI "your day" blurb - used by the To-do board so
  // it loads instantly. The dashboard home fetches the blurb separately.
  const light = new URL(req.url).searchParams.get("light") === "1";
  try {
    const [
      companiesRes,
      draftsRes,
      oppsRes,
      tasksRes,
      costRes,
      usageRes,
      upcomingRes,
      recentTouchRes,
    ] =
      await Promise.all([
        supabaseAdmin.from("companies").select("id, name, stage"),
        supabaseAdmin
          .from("follow_ups")
          .select("id, company_id, draft_subject, created_at")
          .eq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(50),
        supabaseAdmin
          .from("opportunities")
          .select("id, company_id, title, value, status, created_at")
          .eq("status", "open")
          .limit(100),
        // Open to-dos from the tasks table (next steps + call commitments).
        supabaseAdmin
          .from("tasks")
          .select("id, text, company_id, kind, due_at, created_at")
          .eq("status", "open")
          .order("created_at", { ascending: true })
          .limit(300),
        // Spend-so-far rollup: every call's cost, regardless of company link.
        supabaseAdmin
          .from("interview_summaries")
          .select("cost, created_at")
          .not("cost", "is", null)
          .order("created_at", { ascending: false })
          .limit(1000),
        // All other AI spend (assistant, day reads, profile syntheses, task
        // extraction, lessons) plus the background automation jobs.
        supabaseAdmin
          .from("usage_log")
          .select("kind, cost_gbp, meta, created_at")
          .order("created_at", { ascending: false })
          .limit(5000),
        supabaseAdmin
          .from("upcoming_calls")
          .select("id, company_id, title, scheduled_at, intent, prepped")
          .is("completed_at", null)
          .gte("scheduled_at", new Date().toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(50),
        supabaseAdmin
          .from("interview_summaries")
          .select("company_id, created_at")
          .not("company_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);

    const nameById = new Map<string, string>();
    const idByName = new Map<string, string>();
    for (const c of companiesRes.data || []) {
      nameById.set(c.id, c.name);
      if (c.name) idByName.set(String(c.name).toLowerCase().trim(), c.id);
    }
    // Resolve a day-read label (a client or topic name) to a company id so the
    // line is clickable. Exact match first, then a conservative contains match.
    const idForLabel = (label?: string): string | undefined => {
      const l = (label || "").toLowerCase().trim();
      if (!l) return undefined;
      if (idByName.has(l)) return idByName.get(l);
      for (const [name, id] of idByName) {
        if (name.length < 4) continue;
        if (l.startsWith(name) || name.startsWith(l) || l.includes(name)) return id;
      }
      return undefined;
    };

    const openTaskRows = tasksRes.data || [];
    const tasks = openTaskRows
      .filter((t: any) => t.kind !== "counterparty_commitment")
      .map((t: any) => ({
      id: t.id as string,
      text: t.text,
      company: t.company_id ? nameById.get(t.company_id) || "a client" : "—",
      companyId: t.company_id as string,
      kind: t.kind as string,
      dueAt: (t.due_at as string) || null,
      createdAt: (t.created_at as string) || null,
      }));

    const openOpps = oppsRes.data || [];
    const openOppValue = openOpps.reduce(
      (sum: number, o: any) => sum + (Number(o.value) || 0),
      0
    );

    // Spend so far, split into a rolling 7-day and 30-day window (GBP). The
    // dashboard toggles between the two; allCost is the lifetime total.
    const now = Date.now();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const MONTH = 30 * 24 * 60 * 60 * 1000;
    // Calls (costed per session), in-app AI, and background automation - all in,
    // so the dashboard shows true spend, not just calls.
    let callsW = 0, callsM = 0, callsA = 0;
    for (const r of costRes.data || []) {
      // Postgres `numeric` comes back from supabase as a STRING, so coerce.
      const c = Number(r.cost) || 0;
      if (!c) continue;
      callsA += c;
      const age = now - new Date(r.created_at as string).getTime();
      if (age <= WEEK) callsW += c;
      if (age <= MONTH) callsM += c;
    }
    let aiW = 0, aiM = 0, aiA = 0;
    let autoW = 0, autoM = 0, autoA = 0;
    for (const r of usageRes.data || []) {
      const c = Number(r.cost_gbp) || 0;
      if (!c) continue;
      const isAuto = String(r.kind || "").startsWith("automation");
      const age = now - new Date(r.created_at as string).getTime();
      if (isAuto) {
        autoA += c;
        if (age <= WEEK) autoW += c;
        if (age <= MONTH) autoM += c;
      } else {
        aiA += c;
        if (age <= WEEK) aiW += c;
        if (age <= MONTH) aiM += c;
      }
    }
    const weekCost = callsW + aiW + autoW;
    const monthCost = callsM + aiM + autoM;
    const allCost = callsA + aiA + autoA;
    const costBreakdown = {
      calls: { week: callsW, month: callsM, all: callsA },
      ai: { week: aiW, month: aiM, all: aiA },
      automation: { week: autoW, month: autoM, all: autoA },
    };

    type WindowCost = { week: number; month: number; all: number };
    const featureMap = new Map<string, WindowCost>();
    const addFeature = (name: string, cost: number, age: number) => {
      const row = featureMap.get(name) || { week: 0, month: 0, all: 0 };
      row.all += cost;
      if (age <= WEEK) row.week += cost;
      if (age <= MONTH) row.month += cost;
      featureMap.set(name, row);
    };
    for (const r of costRes.data || []) {
      const c = Number(r.cost) || 0;
      if (!c) continue;
      addFeature(
        "Live calls & cues",
        c,
        now - new Date(r.created_at as string).getTime()
      );
    }
    const featureForKind = (value: any): string => {
      const kind = String(value || "").toLowerCase();
      if (kind.startsWith("automation")) return "Automation";
      if (/intent|research|battlecard|prep/.test(kind))
        return "Preparation & intent";
      if (/summary|profile|commitment|extract|digest|cross-link/.test(kind))
        return "Summaries & CRM sync";
      if (/coach|brain|lesson|assistant|correct/.test(kind))
        return "Brain & coaching";
      if (/opp|day-read|pipeline/.test(kind)) return "CRM organisation";
      return "Other AI";
    };
    for (const r of usageRes.data || []) {
      const c = Number(r.cost_gbp) || 0;
      if (!c) continue;
      addFeature(
        featureForKind(r.kind),
        c,
        now - new Date(r.created_at as string).getTime()
      );
    }
    const featureCosts = [...featureMap.entries()]
      .map(([feature, cost]) => ({ feature, ...cost }))
      .sort((a, b) => b.week - a.week);

    // Deterministic Today control centre. This is deliberately model-free: it
    // should be instant, cheap and grounded in deadlines/calendar state.
    const next24h = now + 24 * 60 * 60 * 1000;
    const callsToPrep = (upcomingRes.data || [])
      .filter(
        (u: any) =>
          !u.prepped &&
          u.scheduled_at &&
          new Date(u.scheduled_at).getTime() <= next24h
      )
      .slice(0, 5)
      .map((u: any) => ({
        id: u.id,
        text: u.title || "Upcoming call",
        company: u.company_id ? nameById.get(u.company_id) || null : null,
        at: u.scheduled_at,
        href: `/crm/prep?upcoming=${u.id}`,
      }));
    const allOverduePromises = tasks.filter(
        (t: any) =>
          t.kind === "commitment" &&
          t.dueAt &&
          new Date(t.dueAt).getTime() < now
      );
    const overduePromises = allOverduePromises
      .slice(0, 5)
      .map((t: any) => ({
        id: t.id,
        text: t.text,
        company: t.company === "—" ? null : t.company,
        at: t.dueAt,
        href: t.companyId ? `/crm/${t.companyId}` : "/crm/board?tab=tasks",
        entity: "task" as const,
      }));
    const awaitingReply = (draftsRes.data || []).slice(0, 5).map((d: any) => ({
      id: d.id,
      text: d.draft_subject || "Follow-up ready to review",
      company: d.company_id ? nameById.get(d.company_id) || null : null,
      at: d.created_at,
      href: "/crm/board?tab=drafts",
    }));
    const awaitingOthers = openTaskRows
      .filter((t: any) => t.kind === "counterparty_commitment")
      .sort((a: any, b: any) => {
        const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity;
        const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity;
        return ad - bd;
      })
      .slice(0, 5)
      .map((t: any) => ({
        id: t.id,
        text: t.text,
        company: t.company_id ? nameById.get(t.company_id) || null : null,
        at: t.due_at || t.created_at,
        href: t.company_id ? `/crm/${t.company_id}` : "/crm/board?tab=tasks",
        entity: "task" as const,
      }));
    const latestTouch = new Map<string, number>();
    for (const s of recentTouchRes.data || []) {
      const cid = s.company_id as string;
      if (!cid || latestTouch.has(cid)) continue;
      latestTouch.set(cid, new Date(s.created_at as string).getTime());
    }
    const companiesWithNextCall = new Set(
      (upcomingRes.data || [])
        .map((u: any) => u.company_id as string)
        .filter(Boolean)
    );
    const COOLING = 14 * 24 * 60 * 60 * 1000;
    const allCoolingDeals = openOpps.filter((o: any) => {
        const cid = o.company_id as string;
        const last = latestTouch.get(cid) || new Date(o.created_at).getTime();
        return cid && !companiesWithNextCall.has(cid) && now - last >= COOLING;
      });
    const coolingDeals = allCoolingDeals
      .sort((a: any, b: any) => (Number(b.value) || 0) - (Number(a.value) || 0))
      .slice(0, 5)
      .map((o: any) => ({
        id: o.id,
        text: o.title || "Open opportunity",
        company: o.company_id ? nameById.get(o.company_id) || null : null,
        at: latestTouch.get(o.company_id) || o.created_at,
        href: o.company_id ? `/crm/${o.company_id}` : "/crm/board?tab=opportunities",
      }));
    // Rank the whole workload, not just rows that happen to have a deadline.
    // This stops important older actions and high-value opportunity work from
    // disappearing behind the many dashboard checklists.
    const oppValueByCompany = new Map<string, number>();
    for (const opp of openOpps) {
      const companyId = opp.company_id as string;
      if (!companyId) continue;
      oppValueByCompany.set(
        companyId,
        Math.max(oppValueByCompany.get(companyId) || 0, Number(opp.value) || 0)
      );
    }
    const rankedOpenTasks = tasks
      .map((task: any) => {
        const due = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
        const ageDays = task.createdAt
          ? Math.max(0, (now - new Date(task.createdAt).getTime()) / (24 * 60 * 60 * 1000))
          : 0;
        const value = oppValueByCompany.get(task.companyId) || 0;
        let score = Math.min(25, ageDays / 2) + Math.min(35, value / 50_000);
        let reason = value ? "Revenue opportunity" : "Important open action";
        if (Number.isFinite(due) && due < now) {
          score += 120;
          reason = "Overdue";
        } else if (Number.isFinite(due) && due <= next24h) {
          score += 90;
          reason = "Due within 24 hours";
        } else if (Number.isFinite(due) && due <= now + 7 * 24 * 60 * 60 * 1000) {
          score += 55;
          reason = "Due this week";
        }
        if (task.kind === "commitment") {
          score += 35;
          if (!Number.isFinite(due)) reason = "Promise you made";
        }
        return {
          id: task.id,
          text: task.text,
          company: task.company === "—" ? null : task.company,
          at: task.dueAt || task.createdAt,
          href: task.companyId ? `/crm/${task.companyId}` : "/crm/board?tab=tasks",
          entity: "task" as const,
          reason,
          score,
        };
      })
      .sort((a: any, b: any) => b.score - a.score);
    const topCandidates = [
      ...overduePromises.map((x: any) => ({ ...x, reason: "Overdue promise", score: 150 })),
      ...callsToPrep.map((x: any) => ({ ...x, reason: "Call within 24 hours", score: 130 })),
      ...awaitingOthers
        .filter((x: any) => x.at && new Date(x.at).getTime() < now)
        .map((x: any) => ({ ...x, reason: "Chase overdue promise", score: 115 })),
      ...awaitingReply.map((x: any) => ({ ...x, reason: "Reply ready to send", score: 70 })),
      ...coolingDeals.map((x: any) => ({ ...x, reason: "Deal is cooling", score: 60 })),
      ...rankedOpenTasks,
    ].sort((a: any, b: any) => (b.score || 0) - (a.score || 0));
    const seenTopActions = new Set<string>();
    const topActions = topCandidates.filter((item: any) => {
      const key = `${item.entity || "item"}:${item.id}`;
      if (seenTopActions.has(key)) return false;
      seenTopActions.add(key);
      return true;
    }).slice(0, 5);
    const today = {
      callsToPrep,
      overduePromises,
      awaitingReply,
      awaitingOthers,
      coolingDeals,
      topActions,
    };

    // Model-free weekly pipeline reset. It reuses the records already fetched
    // for the dashboard, so organisation does not add another AI call or page
    // request. Each check links straight to the place where it can be fixed.
    const activeCompanyIds = new Set(
      openOpps.map((o: any) => o.company_id as string).filter(Boolean)
    );
    const activeWithTask = new Set(
      tasks.map((t: any) => t.companyId as string).filter(Boolean)
    );
    const activeWithCall = new Set(
      (upcomingRes.data || [])
        .map((u: any) => u.company_id as string)
        .filter(Boolean)
    );
    const stageById = new Map(
      (companiesRes.data || []).map((c: any) => [
        c.id as string,
        typeof c.stage === "string" ? c.stage.trim() : "",
      ])
    );
    const missingStages = [...activeCompanyIds].filter(
      (id) => !stageById.get(id)
    ).length;
    const noNextStep = [...activeCompanyIds].filter(
      (id) => !activeWithTask.has(id) && !activeWithCall.has(id)
    ).length;
    const normalName = (value: any) =>
      String(value || "")
        .toLowerCase()
        .replace(/\b(limited|ltd|incorporated|inc|llc|plc|company|co)\b/g, "")
        .replace(/[^a-z0-9]/g, "");
    const companyNameCounts = new Map<string, number>();
    for (const c of companiesRes.data || []) {
      const key = normalName(c.name);
      if (key.length >= 4)
        companyNameCounts.set(key, (companyNameCounts.get(key) || 0) + 1);
    }
    const duplicateNames = [...companyNameCounts.values()].filter(
      (count) => count > 1
    ).length;
    const weeklyReview = [
      {
        key: "overdue",
        label: "Overdue promises",
        count: allOverduePromises.length,
        href: "/crm/board?tab=tasks",
      },
      {
        key: "cooling",
        label: "Cooling opportunities",
        count: new Set(
          allCoolingDeals.map((o: any) => o.company_id as string).filter(Boolean)
        ).size,
        href: "/crm/board?tab=opportunities",
      },
      {
        key: "stages",
        label: "Missing stages",
        count: missingStages,
        href: "/crm/board?tab=opportunities",
      },
      {
        key: "next-step",
        label: "No next step",
        count: noNextStep,
        href: "/crm/board?tab=opportunities",
      },
      {
        key: "drafts",
        label: "Drafts waiting",
        count: (draftsRes.data || []).length,
        href: "/crm/board?tab=drafts",
      },
      {
        key: "duplicates",
        label: "Possible duplicates",
        count: duplicateNames,
        href: "/crm#duplicates",
      },
    ];

    const kpis = {
      clients: (companiesRes.data || []).length,
      tasks: tasks.length,
      drafts: (draftsRes.data || []).length,
      openOppValue,
      openOppCount: openOpps.length,
      weekCost,
      monthCost,
      allCost,
      costBreakdown,
      featureCosts,
    };

    // A short, cheap AI read of the day, BROKEN INTO SEPARATE LINES (one per
    // client or priority) rather than one bunched paragraph. Optional - never
    // block the dashboard.
    let dayParts: {
      label: string;
      text: string;
      time?: string;
      companyId?: string;
    }[] = [];
    // The no-AI dashboard response still needs a fresh "Your day" after a
    // task mutation. Build a compact deterministic version from the current
    // open rows. This is immediate, costs no tokens, and can never preserve a
    // dismissed task from an older AI snapshot.
    if (light) {
      dayParts = tasks
        .filter((t: any) => t.kind !== "counterparty_commitment")
        .slice(0, 6)
        .map((t: any) => ({
          label: t.company && t.company !== "—" ? t.company : "Priority",
          text: String(t.text || "").trim(),
          companyId: t.companyId || undefined,
        }))
        .filter((p: any) => p.text);
    }
    try {
      if (!light && (tasks.length || openOpps.length)) {
        const lines = [
          `Follow-up drafts ready: ${(draftsRes.data || [])
            .map((d: any) => `${nameById.get(d.company_id) || "?"}: ${d.draft_subject}`)
            .slice(0, 8)
            .join("; ")}`,
          `Open opportunities: ${openOpps
            .map((o: any) => `${nameById.get(o.company_id) || "?"}: ${o.title}${o.value ? ` (£${o.value})` : ""}`)
            .slice(0, 8)
            .join("; ")}`,
          `Your open to-dos: ${tasks
            .map((t) => `${t.company}: ${t.text}`)
            .slice(0, 10)
            .join("; ")}`,
        ].join("\n");

        // Server-side cache, keyed by the workload. dayread2 = the new
        // per-client structured format, so the old dayread: cache is ignored.
        const cacheKey =
          "dayread3:" + createHash("sha256").update(lines).digest("hex");
        try {
          const { data: hit } = await supabaseAdmin
            .from("ai_cache")
            .select("value")
            .eq("key", cacheKey)
            .maybeSingle();
          if (hit?.value) {
            try {
              const arr = JSON.parse(String(hit.value));
              if (Array.isArray(arr)) dayParts = arr;
            } catch {
              /* malformed cache - regenerate */
            }
          }
        } catch {
          /* cache miss is fine */
        }

        if (!dayParts.length) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const msg = await openai.messages.create(
              {
                model: OPENAI_MODEL_LIVE,
                max_tokens: 400,
                temperature: 0.4,
                system:
                  (await workspaceContextBlock()) +
                  'You turn the user\'s CRM workload into a short, scannable read of their day, BROKEN INTO SEPARATE LINES. Output ONLY a JSON array of 3 to 6 items, each {"label": a 1 to 3 word client or topic name, "text": one short sentence on the single most useful move for THAT client or topic today}. STRICT RULES: each line is about ONE client or topic only. NEVER mention or mix in another client within a line (do not write things like "once Testhouse is locked in" on the Alain line). NEVER feature the same client in two lines, no duplication. Scheduled calls are shown separately above with their times, so do NOT list calls here, focus on the priorities and moves. Order by importance, most pressing first. Ground only in the workload given, invent no names, numbers or dates. Plain English, no markdown, no em-dashes or semicolons.',
                messages: [{ role: "user", content: lines }],
              },
              { signal: controller.signal }
            );
            await logModelUsage("day-read", "live", (msg as any).usage);
            const raw = msg.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("");
            const a = raw.indexOf("[");
            const b = raw.lastIndexOf("]");
            const parsed = a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : [];
            if (Array.isArray(parsed)) {
              dayParts = parsed
                .map((p: any) => ({
                  label: sanitizeRead(
                    typeof p?.label === "string" ? p.label : ""
                  ),
                  text: sanitizeRead(
                    typeof p?.text === "string"
                      ? p.text
                      : typeof p === "string"
                      ? p
                      : ""
                  ),
                }))
                .filter((p: { label: string; text: string }) => p.text)
                .slice(0, 6);
            }
            if (dayParts.length) {
              try {
                await supabaseAdmin.from("ai_cache").upsert({
                  key: cacheKey,
                  value: JSON.stringify(dayParts),
                  created_at: new Date().toISOString(),
                });
              } catch {
                /* storing the cache is best-effort */
              }
            }
          } finally {
            clearTimeout(timer);
          }
        }
      }
    } catch {
      /* read is optional */
    }

    // Scheduled calls LEAD the day with their time, since they are fixed
    // commitments. Computed fresh each request (not cached) so the times stay
    // current, and placed above the AI priority lines.
    let callParts: {
      label: string;
      text: string;
      time?: string;
      companyId?: string;
    }[] = [];
    try {
      // upcomingRes was already fetched for the Today panel, so reuse it for
      // both full and light reads instead of making another database request.
      callParts = (upcomingRes.data || [])
        .slice(0, 4)
        .filter((u: any) => u.scheduled_at)
        .map((u: any) => {
            const when = new Date(u.scheduled_at).toLocaleString("en-GB", {
              timeZone: "Europe/London",
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            });
            const who = u.company_id ? nameById.get(u.company_id) || "" : "";
            const intent = typeof u.intent === "string" ? u.intent.trim() : "";
            const title = typeof u.title === "string" ? u.title.trim() : "";
            // First sentence only - the full plan lives on the call/client page.
            return {
              label: who || title || "Call",
              text: firstSentence(sanitizeRead(intent || title || "Scheduled call")),
              time: when,
              companyId: (u.company_id as string) || undefined,
            };
        });
    } catch {
      /* calls in the day read are optional */
    }

    // Attach a click target to every line (cached day-read lines included) so
    // each segment is actionable: its client page, or the to-do board fallback.
    const withTarget = <T extends { label?: string; companyId?: string }>(
      p: T
    ): T => ({ ...p, companyId: p.companyId || idForLabel(p.label) });
    const dayPartsAll = [...callParts, ...dayParts].map(withTarget);
    return NextResponse.json(
      {
        kpis,
        tasks: tasks.slice(0, 20),
        today,
        weeklyReview,
        dayParts: dayPartsAll,
        // Joined string kept for any older client that still reads dayRead.
        dayRead: dayPartsAll.map((p) => p.text).join(" "),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load dashboard" },
      { status: 500 }
    );
  }
}
