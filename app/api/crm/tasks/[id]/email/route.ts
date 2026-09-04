import { NextRequest, NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import {
  generateTaskEmailDraft,
  loadTaskEmailWorkspace,
} from "@/lib/task-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

const errorResponse = (error: any, fallback: string) => {
  const requested = Number(error?.status) || 500;
  const status = [400, 404, 409, 502].includes(requested) ? requested : 500;
  return NextResponse.json(
    {
      error: status === 500 ? fallback : String(error?.message || fallback),
      blocker: {
        title: "Task email not ready",
        reason: status === 500 ? fallback : String(error?.message || fallback),
        nextAction:
          status === 500
            ? "Refresh this task once. If it repeats, send the blocker to a workspace owner."
            : "Correct the named issue, then reopen this email task.",
        code: `TASK_EMAIL_${status}`,
      },
    },
    { status, headers: noStore }
  );
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    requireRequestScope();
    const workspace = await loadTaskEmailWorkspace(params.id);
    return NextResponse.json({ ok: true, ...workspace }, { headers: noStore });
  } catch (error: any) {
    return errorResponse(error, "LiveCoach could not load this task email workspace");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    requireRequestScope();
    const body = await request.json().catch(() => ({}));
    const draft = await generateTaskEmailDraft({
      taskId: params.id,
      recipientEmail: body?.recipient_email,
      intent: body?.intent,
    });
    return NextResponse.json({ ok: true, draft }, { headers: noStore });
  } catch (error: any) {
    return errorResponse(error, "LiveCoach could not optimise this task email");
  }
}
