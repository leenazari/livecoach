import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";
import { workspaceContextBlock } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 25;

// The CRM dashboard: everything on your plate across all clients, in one call.
// KPIs, a short AI read of your day, and a "do next" list pulled from follow-up
// drafts, open opportunities and the commitments you made on recent calls.
export async function GET(req: Request) {
  // ?light=1 skips the (slow) AI "your day" blurb - used by the To-do board so
  // it loads instantly. The dashboard home fetches the blurb separately.
  const light = new URL(req.url).searchParams.get("light") === "1";
  try {
    const [companiesRes, draftsRes, oppsRes, tasksRes, costRes] =
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
    let weekCost = 0;
    let monthCost = 0;
    let allCost = 0;
    for (const r of costRes.data || []) {
      // Postgres `numeric` comes back from supabase as a STRING, so coerce.
      const c = Number(r.cost) || 0;
      if (!c) continue;
      allCost += c;
      const age = now - new Date(r.created_at as string).getTime();
      if (age <= WEEK) weekCost += c;
      if (age <= MONTH) monthCost += c;
    }

    const kpis = {
      clients: (companiesRes.data || []).length,
      tasks: tasks.length,
      drafts: (draftsRes.data || []).length,
      openOppValue,
      openOppCount: openOpps.length,
      weekCost,
      monthCost,
      allCost,
    };

    // A short, cheap AI read of the day. Optional - never block the dashboard.
    let dayRead = "";
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

        // Server-side cache: the "your day" read only depends on the workload
        // (drafts + opps + commitments). Reuse the stored read while that is
        // unchanged, so the dashboard doesn't pay for a fresh LLM call (slow +
        // costly) on every visit - it only regenerates when the inputs change.
        const cacheKey =
          "dayread:" + createHash("sha256").update(lines).digest("hex");
        try {
          const { data: hit } = await supabaseAdmin
            .from("ai_cache")
            .select("value")
            .eq("key", cacheKey)
            .maybeSingle();
          if (hit?.value) dayRead = String(hit.value);
        } catch {
          /* cache miss is fine */
        }

        if (!dayRead) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const msg = await anthropic.messages.create(
              {
                model: CLAUDE_MODEL_LIVE,
                max_tokens: 160,
                temperature: 0.4,
                system:
                  (await workspaceContextBlock()) +
                  "You write a 2-3 sentence read of the user's day from their CRM workload. Warm, sharp, specific - name the client and the single most pressing thing. Plain English. No lists, no preamble, just the read.",
                messages: [{ role: "user", content: lines }],
              },
              { signal: controller.signal }
            );
            dayRead = msg.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("")
              .trim();
            if (dayRead) {
              try {
                await supabaseAdmin.from("ai_cache").upsert({
                  key: cacheKey,
                  value: dayRead,
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

    return NextResponse.json({ kpis, tasks: tasks.slice(0, 20), dayRead });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to load dashboard" },
      { status: 500 }
    );
  }
}
