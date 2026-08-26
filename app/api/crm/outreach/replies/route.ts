import { NextResponse } from "next/server";
import { sweepOutreachReplies } from "@/lib/outreach-replies";
import { requireRequestScope } from "@/lib/request-scope";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const account = requireRequestScope();
    return NextResponse.json({
      ok: true,
      ...(await sweepOutreachReplies(20, account.userId)),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "failed to check replies" }, { status: 500 });
  }
}
