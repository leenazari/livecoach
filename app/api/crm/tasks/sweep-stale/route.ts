import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  isStaleTask,
  londonYMD,
  TASK_RETENTION_DAYS,
  type StaleCtx,
} from "@/lib/stale";
import { resolveRecordScope } from "@/lib/record-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clear to-dos that have PASSED. Deterministic and conservative (see lib/stale):
// a prep task whose call has happened, a "tomorrow/today" that's gone, or an
// explicit past date, or an unprotected loose task untouched for 60 days.
// Dismissed (not deleted), so history and duplicate prevention remain intact.
// Safe to run often - it only does work when something's stale.

const norm = (s: string) =>
  (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

async function run() {
  try {
    const scope = await resolveRecordScope();
    const [
      tasksResult,
      companiesResult,
      summariesResult,
      opportunitiesResult,
      workstreamsResult,
    ] =
      await Promise.all([
        supabaseAdmin
          .from("tasks")
          .select(
            "id, company_id, workstream_id, text, kind, link_kind, created_at, due_at, payload"
          )
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .eq("status", "open")
          .order("created_at", { ascending: true })
          .limit(1000),
        supabaseAdmin
          .from("companies")
          .select("id, name, profile")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId),
        supabaseAdmin
          .from("interview_summaries")
          .select("company_id, created_at")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .not("company_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1000),
        supabaseAdmin
          .from("opportunities")
          .select("company_id")
          .eq("workspace_id", scope.workspaceId)
          .eq("assigned_to_user_id", scope.userId)
          .eq("status", "open")
          .not("company_id", "is", null)
          .limit(1000),
        supabaseAdmin
          .from("workstreams")
          .select("id")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .eq("status", "active")
          .limit(1000),
      ]);
    if (tasksResult.error) throw tasksResult.error;
    if (companiesResult.error) throw companiesResult.error;
    if (summariesResult.error) throw summariesResult.error;
    if (opportunitiesResult.error) throw opportunitiesResult.error;
    if (workstreamsResult.error) throw workstreamsResult.error;
    const tasks = tasksResult.data || [];
    const companies = companiesResult.data || [];
    const summaries = summariesResult.data || [];
    const activePriorityCompanyIds = new Set<string>(
      (opportunitiesResult.data || [])
        .map((opportunity: any) => opportunity.company_id as string | null)
        .filter((id): id is string => Boolean(id))
    );
    const activeWorkstreamIds = new Set<string>(
      (workstreamsResult.data || []).map((workstream: any) =>
        String(workstream.id)
      )
    );

    const cos = (companies || []).map((c: any) => {
      const aliases = Array.isArray((c.profile || {}).aliases)
        ? (c.profile as any).aliases
        : [];
      const names = [c.name, ...aliases]
        .map((n: any) => norm(String(n || "")))
        .filter((n: string) => n.length >= 3);
      return { id: c.id as string, names };
    });

    const lastCallMsByCompany = new Map<string, number>();
    for (const s of summaries || []) {
      const cid = (s as any).company_id as string | null;
      if (!cid) continue;
      const ms = new Date((s as any).created_at).getTime();
      const cur = lastCallMsByCompany.get(cid);
      if (cur === undefined || ms > cur) lastCallMsByCompany.set(cid, ms);
    }

    const ctx: StaleCtx = {
      companies: cos,
      lastCallMsByCompany,
      todayYMD: londonYMD(new Date()),
      activePriorityCompanyIds,
      activeWorkstreamIds,
      nowMs: Date.now(),
    };

    const stale: { id: string; reason: string }[] = [];
    for (const t of tasks || []) {
      const r = isStaleTask(
        {
          company_id: (t as any).company_id,
          workstream_id: (t as any).workstream_id,
          text: (t as any).text,
          kind: (t as any).kind,
          link_kind: (t as any).link_kind,
          created_at: (t as any).created_at,
          due_at: (t as any).due_at,
          payload: (t as any).payload,
        },
        ctx
      );
      if (r.stale) stale.push({ id: (t as any).id as string, reason: r.reason });
    }

    if (stale.length) {
      const { data: dismissed, error } = await supabaseAdmin
        .from("tasks")
        .update({ status: "dismissed" })
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("status", "open")
        .in(
          "id",
          stale.map((s) => s.id)
        )
        .select("id");
      if (error) throw error;
      if ((dismissed || []).length !== stale.length) {
        throw new Error("Some stale to-dos changed before cleanup and were left untouched");
      }
    }

    return NextResponse.json({
      ok: true,
      dismissed: stale.length,
      retentionDays: TASK_RETENTION_DAYS,
      items: stale.slice(0, 50),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "sweep failed" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return run();
}
export async function POST() {
  return run();
}
