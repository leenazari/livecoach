import { NextResponse } from "next/server";
import { sweepOutreachReplies } from "@/lib/outreach-replies";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return NextResponse.json({ ok: true, ...(await sweepOutreachReplies(20)) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to check replies" }, { status: 500 });
  }
}
