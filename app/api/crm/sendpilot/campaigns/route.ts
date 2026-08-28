import { NextRequest, NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import {
  saveSendPilotCampaignMapping,
  sendPilotCampaignConfiguration,
} from "@/lib/sendpilot-outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

function errorResponse(error: any) {
  const requested = Number(error?.status) || 500;
  const status = [400, 401, 403, 404, 409, 429, 502, 503, 504].includes(requested)
    ? requested
    : 500;
  if (status === 500) {
    console.error("SendPilot campaign configuration failed", error?.message || error);
  }
  return NextResponse.json(
    {
      error:
        status === 500
          ? "Could not load the SendPilot campaigns"
          : String(error?.message || "Could not load the SendPilot campaigns"),
    },
    { status, headers: noStore }
  );
}

export async function GET() {
  try {
    const scope = requireRequestScope();
    return NextResponse.json(await sendPilotCampaignConfiguration(scope), {
      headers: noStore,
    });
  } catch (error: any) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await request.json().catch(() => ({}));
    const result = await saveSendPilotCampaignMapping(scope, {
      livecoachCampaignId: body?.livecoachCampaignId,
      sendpilotCampaignId: body?.sendpilotCampaignId,
    });
    return NextResponse.json(
      {
        ok: true,
        ...result,
        configuration: await sendPilotCampaignConfiguration(scope),
      },
      { headers: noStore }
    );
  } catch (error: any) {
    return errorResponse(error);
  }
}
