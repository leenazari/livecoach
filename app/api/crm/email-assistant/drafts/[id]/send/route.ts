import { NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import { sendTaskEmailDraft } from "@/lib/task-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    requireRequestScope();
    const result = await sendTaskEmailDraft(params.id);
    return NextResponse.json({ ok: true, ...result }, { headers: noStore });
  } catch (error: any) {
    const requested = Number(error?.status) || 500;
    const status = [400, 404, 409, 502].includes(requested) ? requested : 500;
    const message =
      status === 500
        ? "LiveCoach could not confirm the task email send"
        : String(error?.message || "LiveCoach could not send the task email");
    return NextResponse.json(
      {
        error: message,
        blocker: {
          title: status === 502 ? "Mailbox delivery not confirmed" : "Email not sent",
          reason: message,
          nextAction:
            status === 500 || status === 502
              ? "Refresh the task before doing anything else. The CRM will not send the same approved draft twice."
              : "Correct the named issue, then review the exact email before approving it again.",
          code: `TASK_EMAIL_SEND_${status}`,
        },
      },
      { status, headers: noStore }
    );
  }
}
