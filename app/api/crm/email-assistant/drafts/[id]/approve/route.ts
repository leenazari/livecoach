import { NextResponse } from "next/server";

import { handOffEmailAssistantDraft } from "@/lib/email-assistant";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    requireRequestScope();
    const draft = await handOffEmailAssistantDraft(params.id);
    return NextResponse.json({ ok: true, draft }, { headers: noStore });
  } catch (error: any) {
    const requested = Number(error?.status) || 500;
    const status = [400, 404, 409, 502].includes(requested) ? requested : 500;
    return NextResponse.json(
      {
        error:
          status === 500
            ? "Could not create the provider draft"
            : String(error?.message || "Could not create the provider draft"),
      },
      { status, headers: noStore }
    );
  }
}
