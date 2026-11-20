import { NextRequest, NextResponse } from "next/server";
import {
  ensureAdamCampaign,
  loadAdamCampaign,
  saveAdamPrompt,
} from "@/lib/adam-outbound-server";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { getAccessToken, googleHasScope, GOOGLE_SHEETS_SCOPE } from "@/lib/google";
import { requireRequestScope, type WorkspaceRole } from "@/lib/request-scope";

export const dynamic = "force-dynamic";

function actor() {
  const account = requireRequestScope();
  if (account.status !== "active") {
    return null;
  }
  return {
    userId: account.userId,
    workspaceId: account.workspaceId,
    role: account.role as WorkspaceRole,
  };
}

function inactive() {
  return NextResponse.json(
    crmBlockerPayload({
      code: "adam_account_inactive",
      title: "Adam outbound needs an active account",
      reason: "This membership cannot import or draft Adam leads.",
      nextAction: "Sign in with an active workspace account and try again.",
      responsible: "user",
    }),
    { status: 403 }
  );
}

export async function GET() {
  try {
    const account = actor();
    if (!account) return inactive();
    const loaded = await loadAdamCampaign(account);
    if ("blocker" in loaded) {
      return NextResponse.json(
        { error: loaded.error, blocker: loaded.blocker },
        { status: loaded.status }
      );
    }
    const token = await getAccessToken(false, account.userId);
    const sheetsGranted = token ? await googleHasScope(GOOGLE_SHEETS_SCOPE, account.userId) : false;
    return NextResponse.json({
      migrationReady: loaded.migrationReady,
      campaign: loaded.campaign,
      sheetsConnected: Boolean(token),
      sheetsGranted,
      reconnectUrl: "/api/auth/google/start?sheets=1",
    });
  } catch (error) {
    console.error("Adam outbound status failed", error);
    return NextResponse.json(
      crmBlockerPayload({
        code: "adam_status_unconfirmed",
        title: "Adam outbound could not be loaded",
        reason: "LiveCoach could not confirm the campaign or the Google Sheets connection.",
        nextAction: "Refresh Outreach. Nothing was imported or sent.",
        responsible: "user",
      }),
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const account = actor();
    if (!account) return inactive();
    const body = await request.json().catch(() => ({}));
    const saved = await saveAdamPrompt(account, String(body.emailPrompt || ""));
    if ("blocker" in saved) {
      return NextResponse.json(
        { error: saved.error, blocker: saved.blocker },
        { status: saved.status }
      );
    }
    return NextResponse.json({ ok: true, playbook: saved.playbook });
  } catch (error) {
    console.error("Adam prompt save failed", error);
    return NextResponse.json(
      crmBlockerPayload({
        code: "adam_prompt_unconfirmed",
        title: "The Adam prompt was not saved",
        reason: "LiveCoach could not confirm the campaign update.",
        nextAction: "Reload the prompt and check it before saving again.",
        responsible: "manager",
      }),
      { status: 500 }
    );
  }
}
