import { NextResponse } from "next/server";

import { generateEmailAssistantVoiceNote } from "@/lib/email-assistant-voice";
import { EmailAssistantVoiceBudgetError } from "@/lib/email-assistant-voice-note";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    requireRequestScope();
    const result = await generateEmailAssistantVoiceNote(params.id);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: noStore }
    );
  } catch (error: any) {
    const requested =
      error instanceof EmailAssistantVoiceBudgetError
        ? error.status
        : Number(error?.status) || 500;
    const status = [400, 404, 409, 422, 502].includes(requested)
      ? requested
      : 500;
    return NextResponse.json(
      {
        error:
          status === 500
            ? "Could not create the personal voice note"
            : String(error?.message || "Could not create the personal voice note"),
      },
      { status, headers: noStore }
    );
  }
}
