import { NextResponse } from "next/server";

import { InterviewerDataError } from "@/lib/interviewer/data";
import { interviewerReadyEmailStatus } from "@/lib/interviewer/ready-email";

export const interviewerNoStore = { "Cache-Control": "private, no-store" };

export function interviewerJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: interviewerNoStore });
}

export function interviewerPublicError(error: unknown) {
  if (error instanceof InterviewerDataError && error.code === "not_ready") {
    return interviewerJson(
      { error: "This conversation is not available right now." },
      503
    );
  }
  return interviewerJson(
    { error: "This conversation could not be continued. Please try the link again." },
    500
  );
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? body as Record<string, unknown> : {};
}

// Referenced so the ready-email TODO stays in the server path without sending.
export function readyEmailStillDisabled(): boolean {
  return interviewerReadyEmailStatus() === "disabled";
}
