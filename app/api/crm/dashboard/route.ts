import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { logModelUsage } from "@/lib/usage";
import { workspaceContextBlock } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 25;

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

// The CRM dashboard: everything on your plate across all clients, in one call.
// KPIs, a short AI read of your day, and a "do next" list pulled from follow-up
// drafts, open opportunities and the commitments you made on recent calls.
export async function GET(req: Request) {
  // ?light=1 skips the (slow) AI "your day" blurb - used by the To-do board so
  // it loads instantly. The dashboard home fetches the blurb separately.
  const light = new URL(req.url).searchParams.get("light") === "1";
  try {
    const [companiesRes, draftsRes, oppsRes, tasksRes, costRes, usageRes] =
      await Promise.all([
        supabaseAdmin.from("companies").select("id, name"),
        supabaseAdmin
          .from("follow_ups")
          .select("company_id, draft_subject, created_at")
          .eq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(50),
        supabaseAdmin
          .from("opportunities")
          .select("company_id, title, value, status")
          .eq("status", "open")
          .limit(100),
        // Open to-dos from the tasks table (next steps + call commitments).
        supabaseAdmin
          .from("tasks")
          .select("text, company_id, kind")
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
          .select("kind, cost_gbp, created_at")
          .order("created_at", { ascending: false })
          .limit(5000),
      ]);

    const nameById = new Map<string, string>();
    for (const c of companiesRes.data || []) nameById.set(c.id, c.name);

    const tasks = (tasksRes.data || []).map((t: any) => ({
      text: t.text,
      company: t.company_id ? nameById.get(t.company_id) || "a client" : "—",
      companyId: t.company_id as string,
      kind: t.kind as string,
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
    };

    // A short, cheap AI read of the day, BROKEN INTO SEPARATE LINES (one per
    // client or priority) rather than one bunched paragraph. Optional - never
    // block the dashboard.
    let dayParts: { label: string; text: string }[] = [];
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
          "dayread2:" + createHash("sha256").update(lines).digest("hex");
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
            const msg = await anthropic.messages.create(
              {
                model: CLAUDE_MODEL_LIVE,
                max_tokens: 400,
                temperature: 0.4,
                system:
                  (await workspaceContextBlock()) +
                  'You turn the user\'s CRM workload into a short, scannable read of their day, BROKEN INTO SEPARATE LINES, one per client or priority, never one bunched paragraph. Output ONLY a JSON array of 3 to 6 items, each {"label": a 1 to 3 word client or topic name, "text": one short sentence on the single most useful thing for them on that today}. Order by importance, most pressing first. Ground only in the workload given, invent no names, numbers or dates. Plain English, no markdown, no em-dashes or semicolons.',
                messages: [{ role: "user", content: lines }],
              },
              { signal: controller.signal }
            );
            await logModelUsage("day-read", "haiku", (msg as any).usage);
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

    return NextResponse.json({
      kpis,
      tasks: tasks.slice(0, 20),
      dayParts,
      // Joined string kept for any older client that still reads dayRead.
      dayRead: dayParts.map((p) => p.text).join(" "),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load dashboard" },
      { status: 500 }
    );
  }
}
