import { NextRequest, NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import {
  controlSendPilotCampaign,
  stopSendPilotLead,
} from "@/lib/sendpilot-outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "");
    const result =
      action === "stop_lead"
        ? await stopSendPilotLead(scope, {
            prospectId: body?.prospectId,
            requestId: body?.requestId,
            confirmed: body?.confirmed,
            note: body?.note,
          })
        : await controlSendPilotCampaign(scope, {
            livecoachCampaignId: body?.livecoachCampaignId,
            action,
            requestId: body?.requestId,
            confirmed: body?.confirmed,
          });
    return NextResponse.json({ ok: true, ...result }, { headers: noStore });
  } catch (error: any) {
    const requested = Number(error?.status) || 500;
    const status = [400, 401, 403, 404, 409, 429, 502, 503, 504].includes(requested)
      ? requested
      : 500;
    if (status === 500) {
      console.error("SendPilot control failed", error?.message || error);
    }
    return NextResponse.json(
      {
        error:
          status === 500
            ? "The SendPilot action did not complete"
            : String(error?.message || "The SendPilot action did not complete"),
        code: String(error?.code || "") || undefined,
        nextAction:
          String(error?.nextAction || "") ||
          (status >= 500
            ? "Refresh the SendPilot status before preparing another action because the provider outcome may be unknown"
            : undefined),
      },
      { status, headers: noStore }
    );
  }
}
