import { NextRequest, NextResponse } from "next/server";

import { requireRequestScope } from "@/lib/request-scope";
import { enrolProspectInSendPilot } from "@/lib/sendpilot-outreach";
import { verifyBrainOwnerOverride } from "@/lib/brain-authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const body = await request.json().catch(() => ({}));
    const ownerOverride = verifyBrainOwnerOverride({
      token: request.headers.get("x-livecoach-brain-action") || "",
      scope,
      actionType: "sendpilot_enrol",
      endpoint: `/api/crm/outreach/${params.id}/sendpilot`,
      method: "POST",
      body,
    });
    const result = await enrolProspectInSendPilot(scope, params.id, {
      requestId: body?.requestId,
      enrolmentId: body?.enrolmentId,
      confirmed: body?.confirmed,
      ownerOverride,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { status: result.alreadySubmitted ? 200 : 201, headers: noStore }
    );
  } catch (error: any) {
    const requested = Number(error?.status) || 500;
    const status = [400, 401, 403, 404, 409, 429, 502, 503, 504].includes(requested)
      ? requested
      : 500;
    if (status === 500) {
      console.error("SendPilot lead handoff failed", error?.message || error);
    }
    return NextResponse.json(
      {
        code: String(error?.code || "") || undefined,
        error:
          status === 500
            ? "The SendPilot handoff did not complete"
            : String(error?.message || "The SendPilot handoff did not complete"),
      },
      { status, headers: noStore }
    );
  }
}
