import { NextRequest, NextResponse } from "next/server";
import { sweepOutreachReplies } from "@/lib/outreach-replies";
import { resolveRecordScope } from "@/lib/record-scope";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "not authorised" }, { status: 401 });
  try {
    await resolveRecordScope();
    return NextResponse.json({ ok: true, ...(await sweepOutreachReplies(20)) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to check replies" }, { status: 500 });
  }
}
