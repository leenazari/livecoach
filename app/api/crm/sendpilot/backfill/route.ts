import { NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { runSendPilotBackfill, sendPilotIntegrationStatus } from "@/lib/sendpilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST() {
  try {
    const scope = requireRequestScope();
    const result = await runSendPilotBackfill(scope);
    return NextResponse.json(
      { ok: true, ...result, integration: await sendPilotIntegrationStatus(scope) },
      { headers: noStore }
    );
  } catch (error: any) {
    const requested = Number(error?.status) || 500;
    const status = [400, 401, 403, 409, 429, 502, 503, 504].includes(requested)
      ? requested
      : 500;
    if (status === 500) {
      console.error("SendPilot backfill failed", error?.message || error);
    }
    return NextResponse.json(
      {
        error:
          status === 500
            ? "SendPilot backfill failed"
            : String(error?.message || "SendPilot backfill failed"),
      },
      { status, headers: noStore }
    );
  }
}
