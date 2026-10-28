import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { chatGptActionForSlug } from "@/lib/chatgpt-action";
import {
  principalFromAuthInfo,
  verifyStaffMcpAccessToken,
} from "@/lib/staff-mcp-auth";
import { executeStaffCoreAction } from "@/lib/staff-mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 32 * 1024;
const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  "X-Content-Type-Options": "nosniff",
};

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

function actionError(input: {
  status: number;
  code: string;
  message: string;
  nextStep: string;
  requestId: string;
}) {
  return NextResponse.json(
    {
      ok: false,
      errorCode: input.code,
      message: input.message,
      nextStep: input.nextStep,
      requestId: input.requestId,
    },
    {
      status: input.status,
      headers: {
        ...noStore,
        ...(input.status === 401
          ? { "WWW-Authenticate": 'Bearer realm="LiveCoach GPT Action"' }
          : {}),
      },
    }
  );
}

export async function POST(
  request: NextRequest,
  context: { params: { action: string } }
) {
  const requestId = randomUUID();
  const action = chatGptActionForSlug(String(context.params.action || ""));
  if (!action) {
    return actionError({
      status: 404,
      code: "chatgpt_action_unknown",
      message: "That LiveCoach action is not available.",
      nextStep: "Refresh the Custom GPT action schema before trying again.",
      requestId,
    });
  }

  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) {
    return actionError({
      status: 413,
      code: "chatgpt_action_too_large",
      message: "That request contains too much text for one LiveCoach action.",
      nextStep: "Shorten the lead context and submit one lead at a time.",
      requestId,
    });
  }

  const accessToken = bearerToken(request);
  if (!accessToken) {
    return actionError({
      status: 401,
      code: "chatgpt_action_login_required",
      message: "Connect this GPT to your own LiveCoach login before using CRM actions.",
      nextStep: "Use the GPT sign-in button, then approve the LiveCoach connection.",
      requestId,
    });
  }

  let principal;
  try {
    const authInfo = await verifyStaffMcpAccessToken(
      accessToken,
      "chatgpt_action"
    );
    principal = principalFromAuthInfo(authInfo);
  } catch {
    return actionError({
      status: 401,
      code: "chatgpt_action_login_expired",
      message: "The LiveCoach connection is expired, revoked or not approved for this GPT.",
      nextStep: "Reconnect the GPT using your own active LiveCoach account.",
      requestId,
    });
  }

  let payload: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return actionError({
        status: 413,
        code: "chatgpt_action_too_large",
        message: "That request contains too much text for one LiveCoach action.",
        nextStep: "Shorten the lead context and submit one lead at a time.",
        requestId,
      });
    }
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return actionError({
      status: 400,
      code: "chatgpt_action_invalid_json",
      message: "LiveCoach could not read the action details.",
      nextStep: "Ask the GPT to rebuild the action using the required fields.",
      requestId,
    });
  }

  try {
    const result = await executeStaffCoreAction({
      principal,
      action: action.tool,
      arguments: payload,
      requestId,
    });
    const structured =
      result.structuredContent && typeof result.structuredContent === "object"
        ? result.structuredContent
        : {};
    const content = Array.isArray(result.content)
      ? (result.content as Array<{ type?: string; text?: string }>)
      : [];
    const message = content.length
      ? content
          .filter((item) => item.type === "text")
          .map((item) => (item.type === "text" ? item.text || "" : ""))
          .filter(Boolean)
          .join("\n")
      : "";
    return NextResponse.json(
      {
        ...structured,
        message,
        action: action.tool,
        requestId,
      },
      { status: 200, headers: noStore }
    );
  } catch {
    return actionError({
      status: 400,
      code: "chatgpt_action_details_invalid",
      message: "The action details did not match the LiveCoach requirements.",
      nextStep: "Check the exact email and required fields, then ask the GPT to try once more.",
      requestId,
    });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...noStore,
      Allow: "POST, OPTIONS",
    },
  });
}
