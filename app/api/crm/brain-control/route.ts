import { randomUUID } from "node:crypto";

import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";

import {
  createBrainRoutineRun,
  executeBrainRoutineRun,
  getBrainControlSnapshot,
  proposeBrainLearning,
  reviewBrainLearning,
  saveBrainPage,
  saveBrainPlay,
  saveBrainRoutine,
  updateBrainTrustRule,
  type BrainActionKind,
  type BrainTrustMode,
} from "@/lib/brain-control";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET() {
  try {
    const scope = requireRequestScope();
    const snapshot = await getBrainControlSnapshot(scope);
    return NextResponse.json(snapshot, { headers: noStore });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Brain Control could not be loaded" },
      { status: 500, headers: noStore }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || "");

    if (action === "update_trust") {
      if (scope.role !== "owner") {
        return NextResponse.json(
          { error: "Only the workspace owner can change Brain permissions" },
          { status: 403, headers: noStore }
        );
      }
      const rule = await updateBrainTrustRule(scope, {
        actionKind: String(payload.actionKind || "") as BrainActionKind,
        mode: String(payload.mode || "") as BrainTrustMode,
        targetUserId: String(payload.targetUserId || scope.userId),
      });
      return NextResponse.json({ ok: true, rule }, { headers: noStore });
    }
    if (action === "save_routine") {
      const routine = await saveBrainRoutine(scope, payload.routine || {});
      return NextResponse.json({ ok: true, routine }, { headers: noStore });
    }
    if (action === "save_play") {
      const play = await saveBrainPlay(scope, payload.play || {});
      return NextResponse.json({ ok: true, play }, { headers: noStore });
    }
    if (action === "save_page") {
      const page = await saveBrainPage(scope, payload.page || {});
      return NextResponse.json({ ok: true, page }, { headers: noStore });
    }
    if (action === "propose_learning") {
      const learning = await proposeBrainLearning(scope, payload.learning || {});
      return NextResponse.json(
        { ok: true, learning },
        { status: 201, headers: noStore }
      );
    }
    if (action === "review_learning") {
      const learning = await reviewBrainLearning(scope, payload.learning || {});
      return NextResponse.json({ ok: true, learning }, { headers: noStore });
    }
    if (action === "run_routine") {
      const routineId = String(payload.routineId || "");
      const idempotencyKey = String(payload.idempotencyKey || randomUUID());
      if (!routineId) throw new Error("Choose a routine to run");
      const result = await createBrainRoutineRun({
        scope,
        routineId,
        triggerKind: "manual",
        idempotencyKey: `manual:${routineId}:${idempotencyKey}`.slice(0, 240),
      });
      if (!result.existing) {
        waitUntil(
          executeBrainRoutineRun({
            scope,
            routineId: result.routine.id,
            runId: result.run.id,
          }).catch((error) => console.error("Brain routine failed", error))
        );
      }
      return NextResponse.json(
        {
          ok: true,
          run: result.run,
          existing: result.existing,
          message: result.existing ? "This run was already queued" : "Routine queued safely",
        },
        { status: result.existing ? 200 : 202, headers: noStore }
      );
    }
    return NextResponse.json(
      { error: "Choose a valid Brain Control action" },
      { status: 400, headers: noStore }
    );
  } catch (error: any) {
    const message = error?.message || "Brain Control could not save that change";
    const status = /choose|give|valid|never|only|access|required|active/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status, headers: noStore });
  }
}
