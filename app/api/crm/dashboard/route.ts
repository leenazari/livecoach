import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 25;

// The CRM dashboard: everything on your plate across all clients, in one call.
// KPIs, a short AI read of your day, and a "do next" list pulled from follow-up
// drafts, open opportunities and the commitments you made on recent calls.
export async function GET() {
  try {
    const [companiesRes, draftsRes, oppsRes, summariesRes] = await Promise.all([
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
      supabaseAdmin
        .from("interview_summaries")
        .select("company_id, summary, created_at")
        .not("company_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);

    const nameById = new Map<string, string>();
    for (const c of companiesRes.data || []) nameById.set(c.id, c.name);

    type Task = {
      text: string;
      company: string;
      companyId: string;
      kind: "draft" | "commitment";
      note?: string;
    };
    const tasks: Task[] = [];

    for (const d of draftsRes.data || []) {
      if (!d.company_id) continue;
      tasks.push({
        text: `Send: ${d.draft_subject || "follow-up email"}`,
        company: nameById.get(d.company_id) || "a client",
        companyId: d.company_id,
        kind: "draft",
        note: "draft ready",
      });
    }

    // Commitments: the host's own next-actions from recent calls (one per
    // company's latest call, to avoid flooding the list with old promises).
    const seenCompany = new Set<string>();
    for (const s of summariesRes.data || []) {
      if (!s.company_id || seenCompany.has(s.company_id)) continue;
      seenCompany.add(s.company_id);
      const my = Array.isArray((s.summary as any)?.myNextActions)
        ? (s.summary as any).myNextActions
        : [];
      for (const a of my.slice(0, 3)) {
        if (typeof a === "string" && a.trim()) {
          tasks.push({
            text: a.trim(),
            company: nameById.get(s.company_id) || "a client",
            companyId: s.company_id,
            kind: "commitment",
            note: "you committed to this",
          });
        }
      }
    }

    const openOpps = oppsRes.data || [];
    const openOppValue = openOpps.reduce(
      (sum: number, o: any) => sum + (typeof o.value === "number" ? o.value : 0),
      0
    );

    const kpis = {
      tasks: tasks.length,
      drafts: (draftsRes.data || []).length,
      openOppValue,
      openOppCount: openOpps.length,
    };

    // A short, cheap AI read of the day. Optional - never block the dashboard.
    let dayRead = "";
    try {
      if (tasks.length || openOpps.length) {
        const lines = [
          `Follow-up drafts ready: ${(draftsRes.data || [])
            .map((d: any) => `${nameById.get(d.company_id) || "?"}: ${d.draft_subject}`)
            .slice(0, 8)
            .join("; ")}`,
          `Open opportunities: ${openOpps
            .map((o: any) => `${nameById.get(o.company_id) || "?"}: ${o.title}${o.value ? ` (£${o.value})` : ""}`)
            .slice(0, 8)
            .join("; ")}`,
          `Commitments outstanding: ${tasks
            .filter((t) => t.kind === "commitment")
            .map((t) => `${t.company}: ${t.text}`)
            .slice(0, 8)
            .join("; ")}`,
        ].join("\n");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const msg = await anthropic.messages.create(
            {
              model: CLAUDE_MODEL_LIVE,
              max_tokens: 160,
              temperature: 0.4,
              system:
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
        } finally {
          clearTimeout(timer);
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
