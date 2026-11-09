import { NextResponse } from "next/server";
import { syncAdamSheet } from "@/lib/adam-outbound-server";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { requireRequestScope, type WorkspaceRole } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const account = requireRequestScope();
    if (account.status !== "active") {
      return NextResponse.json(
        crmBlockerPayload({
          code: "adam_account_inactive",
          title: "Adam sync needs an active account",
          reason: "This membership cannot import Adam leads.",
          nextAction: "Sign in with an active workspace account and try again.",
          responsible: "user",
        }),
        { status: 403 }
      );
    }
    const result = await syncAdamSheet({
      userId: account.userId,
      workspaceId: account.workspaceId,
      role: account.role as WorkspaceRole,
    });
    if ("blocker" in result) {
      return NextResponse.json(
        { error: result.error, blocker: result.blocker },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Adam sheet sync failed", error);
    return NextResponse.json(
      crmBlockerPayload({
        code: "adam_sync_unconfirmed",
        title: "The Adam sync did not finish",
        reason: "LiveCoach could not confirm how far the import got.",
        nextAction: "Refresh the Adam outbound list and see which companies were saved before syncing again. Nothing was emailed.",
        responsible: "user",
      }),
      { status: 500 }
    );
  }
}
