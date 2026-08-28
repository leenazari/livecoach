import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import {
  configureSendPilotWebhookSecret,
  connectSendPilot,
  disconnectSendPilot,
  sendPilotIntegrationStatus,
} from "@/lib/sendpilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

const responseError = (error: any, fallback: string) => {
  const requested = Number(error?.status) || 500;
  const status = [400, 401, 403, 409, 429, 502, 503, 504].includes(requested)
    ? requested
    : 500;
  if (status === 500) console.error(fallback, error?.message || error);
  return NextResponse.json(
    { error: status === 500 ? fallback : String(error?.message || fallback) },
    { status, headers: noStore }
  );
};

export async function GET() {
  try {
    const scope = requireRequestScope();
    return NextResponse.json(await sendPilotIntegrationStatus(scope), {
      headers: noStore,
    });
  } catch (error: any) {
    return responseError(error, "Could not load the SendPilot integration");
  }
}

export async function POST(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await request.json().catch(() => ({}));
    await connectSendPilot(scope, body?.apiKey, body?.senderId);
    return NextResponse.json(
      { ok: true, ...(await sendPilotIntegrationStatus(scope)) },
      { status: 201, headers: noStore }
    );
  } catch (error: any) {
    return responseError(error, "Could not connect SendPilot");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await request.json().catch(() => ({}));
    await configureSendPilotWebhookSecret(scope, body?.webhookSecret);
    return NextResponse.json(
      { ok: true, ...(await sendPilotIntegrationStatus(scope)) },
      { headers: noStore }
    );
  } catch (error: any) {
    return responseError(error, "Could not configure the SendPilot webhook");
  }
}

export async function DELETE() {
  try {
    const scope = requireRequestScope();
    await disconnectSendPilot(scope);
    return NextResponse.json(
      { ok: true, ...(await sendPilotIntegrationStatus(scope)) },
      { headers: noStore }
    );
  } catch (error: any) {
    return responseError(error, "Could not disconnect SendPilot");
  }
}
