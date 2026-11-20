import { NextRequest, NextResponse } from "next/server";
import { draftAdamProspect } from "@/lib/adam-outbound-server";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { requireRequestScope, type WorkspaceRole } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const account = requireRequestScope();
    if (account.status !== "active") {
      return NextResponse.json(
        crmBlockerPayload({
          code: "adam_account_inactive",
          title: "Adam drafting needs an active account",
          reason: "This membership cannot draft Adam emails.",
          nextAction: "Sign in with an active workspace account and try again.",
          responsible: "user",
        }),
        { status: 403 }
      );
    }
    const body = await request.json().catch(() => ({}));
    const prospectId = String(body.prospectId || "");
    if (!UUID.test(prospectId)) {
      return NextResponse.json(
        crmBlockerPayload({
          code: "adam_prospect_required",
          title: "Choose an Adam lead first",
          reason: "Drafting needs one saved Adam prospect.",
          nextAction: "Sync the sheet, then press Draft Adam email on the lead.",
          responsible: "user",
        }),
        { status: 400 }
      );
    }
    const result = await draftAdamProspect({
      userId: account.userId,
      workspaceId: account.workspaceId,
      role: account.role as WorkspaceRole,
    }, prospectId);
    if ("blocker" in result) {
      return NextResponse.json(
        { error: result.error, blocker: result.blocker },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Adam draft failed", error);
    return NextResponse.json(
      crmBlockerPayload({
        code: "adam_draft_unconfirmed",
        title: "The Adam draft was not confirmed",
        reason: "LiveCoach could not confirm that the email text was saved.",
        nextAction: "Refresh the prospect and look for an existing draft before drafting again. Nothing was sent.",
        responsible: "user",
      }),
      { status: 500 }
    );
  }
}
