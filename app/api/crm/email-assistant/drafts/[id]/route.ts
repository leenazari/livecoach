import { NextRequest, NextResponse } from "next/server";

import { updateEmailAssistantDraft } from "@/lib/email-assistant";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    requireRequestScope();
    const body = await request.json().catch(() => ({}));
    const draft = await updateEmailAssistantDraft(params.id, {
      subject: body?.subject,
      body: body?.body,
      action: body?.action,
    });
    return NextResponse.json({ ok: true, draft }, { headers: noStore });
  } catch (error: any) {
    const requested = Number(error?.status) || 500;
    const status = [400, 404, 409].includes(requested) ? requested : 500;
    return NextResponse.json(
      {
        error:
          status === 500
            ? "Could not update the next-move draft"
            : String(error?.message || "Could not update the next-move draft"),
      },
      { status, headers: noStore }
    );
  }
}
