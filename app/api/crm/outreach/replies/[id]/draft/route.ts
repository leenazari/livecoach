import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { preparePositiveReplyForApproval } from "@/lib/outreach-positive-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const scope = requireRequestScope();
    if (!UUID.test(params.id))
      return NextResponse.json({ error: "Outreach relationship not found" }, { status: 404 });
    return NextResponse.json(
      await preparePositiveReplyForApproval(scope, params.id)
    );
  } catch (error: any) {
    const status = [400, 401, 403, 404, 409, 502].includes(Number(error?.status))
      ? Number(error.status)
      : 500;
    return NextResponse.json(
      { error: error?.message || "failed to prepare booking reply" },
      { status }
    );
  }
}
