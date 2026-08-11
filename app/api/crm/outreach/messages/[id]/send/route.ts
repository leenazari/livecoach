import { NextResponse } from "next/server";
import { queueApprovedOutreachMessage } from "@/lib/outreach-send-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    return NextResponse.json(await queueApprovedOutreachMessage(params.id));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to queue email" },
      { status: 400 }
    );
  }
}
