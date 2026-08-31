import { NextRequest, NextResponse } from "next/server";

import { listActiveAccountScopes } from "@/lib/automation-accounts";
import {
  createBrainRoutineRun,
  executeBrainRoutineRun,
} from "@/lib/brain-control";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runAccount(account: { userId: string; workspaceId: string }) {
  const dueAt = new Date().toISOString();
  const { data: routines, error } = await supabaseService
    .from("brain_routines")
    .select("id,next_run_at")
    .eq("workspace_id", account.workspaceId)
    .eq("owner_id", account.userId)
    .eq("status", "active")
    .in("schedule_mode", ["daily", "weekdays"])
    .not("next_run_at", "is", null)
    .lte("next_run_at", dueAt)
    .order("next_run_at", { ascending: true })
    .limit(5);
  if (error) throw error;
  const results = [];
  for (const routine of routines || []) {
    const key = `scheduled:${routine.id}:${routine.next_run_at}`;
    try {
      const created = await createBrainRoutineRun({
        scope: account,
        routineId: routine.id,
        triggerKind: "scheduled",
        idempotencyKey: key,
      });
      if (!created.existing) {
        await executeBrainRoutineRun({
          scope: account,
          routineId: created.routine.id,
          runId: created.run.id,
        });
      }
      results.push({ routineId: routine.id, ok: true, existing: created.existing });
    } catch (routineError: any) {
      results.push({
        routineId: routine.id,
        ok: false,
        error: String(routineError?.message || "Routine failed"),
      });
    }
  }
  return results;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  const accounts = await listActiveAccountScopes();
  const results = [];
  for (const account of accounts) {
    try {
      const routines = await runWithServiceRecordScope(account, () =>
        runAccount(account)
      );
      results.push({ userId: account.userId, ok: routines.every((row) => row.ok), routines });
    } catch (error: any) {
      results.push({
        userId: account.userId,
        ok: false,
        error: String(error?.message || "Brain routines failed"),
      });
    }
  }
  return NextResponse.json({
    ok: results.every((result) => result.ok),
    accounts: results,
  });
}
