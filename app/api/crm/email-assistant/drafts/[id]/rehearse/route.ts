import { NextRequest, NextResponse } from "next/server";

import {
  rehearseEmailAssistantDraft,
  type EmailAssistantVoiceIntent,
} from "@/lib/email-assistant";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    requireRequestScope();
    const body = await request.json().catch(() => ({}));
    const voiceIntent = String(body?.voice_intent || "") as EmailAssistantVoiceIntent;
    if (voiceIntent !== "include" && voiceIntent !== "omit") {
      return NextResponse.json(
        { error: "Choose whether this test includes voice" },
        { status: 400, headers: noStore }
      );
    }
    const result = await rehearseEmailAssistantDraft(params.id, voiceIntent);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: noStore }
    );
  } catch (error: any) {
    const requested = Number(error?.status) || 500;
    const status = [400, 404, 409, 502].includes(requested) ? requested : 500;
    return NextResponse.json(
      {
        error:
          status === 500
            ? "Could not send the Email Assistant test"
            : String(error?.message || "Could not send the Email Assistant test"),
      },
      { status, headers: noStore }
    );
  }
}
