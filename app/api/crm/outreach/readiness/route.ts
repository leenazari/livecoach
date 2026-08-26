import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  googleConnected,
  googleGrantedScopes,
} from "@/lib/google";
import { gmailAccessStatus } from "@/lib/gmail";
import { microsoftAccessStatus } from "@/lib/microsoft";
import { londonDate, OUTREACH_DAILY_HARD_LIMIT } from "@/lib/outreach";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import { resolveOutreachCampaignSelection } from "@/lib/outreach-campaign-selection";
import { requireRequestScope } from "@/lib/request-scope";

export const dynamic = "force-dynamic";

type CheckStatus = "pass" | "warn" | "fail";
type ReadinessCheck = {
  id: string;
  label: string;
  detail: string;
  status: CheckStatus;
  href?: string;
  action?: string;
};

export async function GET() {
  try {
    const account = requireRequestScope();
    const sender = await resolveOutreachIdentity();
    const today = londonDate();
    const selection = await resolveOutreachCampaignSelection(
      account.userId,
      account.workspaceId
    );
    const campaign = selection.campaign;
    const { data: membershipRows, error: membershipError } = campaign
      ? await supabaseAdmin
          .from("outreach_enrolments")
          .select("prospect_id")
          .eq("workspace_id", account.workspaceId)
          .eq("campaign_id", campaign.id)
          .limit(5000)
      : { data: [] as any[], error: null };
    if (membershipError) throw membershipError;
    const membershipIds = Array.from(
      new Set((membershipRows || []).map((row: any) => row.prospect_id))
    );
    const { data: assignedRows, error: assignedError } = await supabaseAdmin
      .from("outreach_prospects")
      .select("id")
      .eq("workspace_id", account.workspaceId)
      .eq("assigned_to_user_id", account.userId)
      .limit(5000);
    if (assignedError) throw assignedError;
    const assignedIds = (assignedRows || []).map((row: any) => row.id);
    let eligibleQuery = supabaseAdmin
      .from("outreach_prospects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", account.workspaceId)
      .or(`assigned_to_user_id.is.null,assigned_to_user_id.eq.${account.userId}`)
      .in("status", ["imported", "queued"])
      .not("email", "is", null);
    if (membershipIds.length) eligibleQuery = eligibleQuery.in("id", membershipIds);
    else if (campaign) eligibleQuery = eligibleQuery.eq("id", "00000000-0000-0000-0000-000000000000");

    const [google, microsoft, eligibleResult, queuedResult, sentAliasResult] =
      await Promise.all([
        googleConnected(),
        microsoftAccessStatus(),
        eligibleQuery,
        assignedIds.length
          ? supabaseAdmin
              .from("outreach_enrolments")
              .select("id", { count: "exact", head: true })
              .eq("workspace_id", account.workspaceId)
              .eq("campaign_id", campaign?.id || "00000000-0000-0000-0000-000000000000")
              .eq("queued_for", today)
              .in("prospect_id", assignedIds)
              .in("status", ["queued", "researched", "drafted", "approved", "contacted"])
          : Promise.resolve({ count: 0, error: null }),
        supabaseAdmin
          .from("outreach_messages")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", account.workspaceId)
          .eq("status", "sent")
          .eq("sender_user_id", sender.userId)
          .eq("from_email", sender.senderEmail),
      ]);

    const [scopes, gmailApi] = sender.provider === "google" && google.connected
      ? await Promise.all([googleGrantedScopes(), gmailAccessStatus()])
      : [new Set<string>(), "disconnected" as const];
    const readAccess = sender.provider === "google"
      ? scopes.has(GMAIL_READ_SCOPE) || gmailApi === "ok"
      : microsoft.status === "ok" && microsoft.mailRead;
    const sendAccess = sender.provider === "google"
      ? scopes.has(GMAIL_SEND_SCOPE)
      : microsoft.status === "ok" && microsoft.mailSend;
    const databaseError =
      eligibleResult.error ||
      queuedResult.error ||
      sentAliasResult.error;
    if (databaseError) throw databaseError;

    const sequence = Array.isArray(campaign?.sequence) ? campaign.sequence : [];
    const sequenceValid =
      sequence.length > 0 &&
      sequence.every(
        (step: any, index: number) =>
          Number(step?.step) === index + 1 &&
          (index === 0 ? Number(step?.delayDays || 0) === 0 : Number(step?.delayDays) >= 1) &&
          !!String(step?.purpose || "").trim()
      );
    const dailyLimit = Number(campaign?.daily_limit || 0);
    const eligible = eligibleResult.count || 0;
    const queued = queuedResult.count || 0;
    const aliasPreviouslyVerified = (sentAliasResult.count || 0) > 0;
    const providerName = sender.provider === "google" ? "Google" : "Microsoft";
    const senderVerified = sender.provider === "google"
      ? sendAccess || aliasPreviouslyVerified
      : sendAccess && sender.senderEmail === sender.mailboxEmail;

    const checks: ReadinessCheck[] = [
      {
        id: "mailbox",
        label: "Email and calendar account",
        status: sender.provider === "google"
          ? google.connected ? "pass" : "fail"
          : microsoft.status === "ok" ? "pass" : "fail",
        detail:
          sender.provider === "google" && google.connected
            ? `${google.email || "Google"} is connected through Google.`
            : sender.provider === "microsoft" && microsoft.status === "ok"
              ? `${microsoft.email || sender.mailboxEmail} is connected through Microsoft.`
              : `Reconnect ${providerName} before outreach can monitor replies or send approved mail.`,
        href: "/settings",
        action:
          (sender.provider === "google" && google.connected) ||
          (sender.provider === "microsoft" && microsoft.status === "ok")
            ? undefined
            : `Reconnect ${providerName}`,
      },
      {
        id: "mail-permissions",
        label: `${providerName} permissions`,
        status: !readAccess ? "fail" : senderVerified ? "pass" : "warn",
        detail:
          readAccess && senderVerified
            ? "Reading replies and sending approved messages are permitted."
            : readAccess
              ? `${providerName} reading works. Sending will be verified safely on the first approved email.`
              : `${providerName} has not made mail reading available to LiveCoach. Reply monitoring stays paused.`,
        href: "/settings",
        action: undefined,
      },
      {
        id: "sender",
        label: "Interviewa sender",
        status: senderVerified ? "pass" : "warn",
        detail: aliasPreviouslyVerified
          ? `${sender.senderEmail} has already sent successfully.`
          : senderVerified
            ? `${sender.senderEmail} is authorised for approved sends.`
          : sender.provider === "google"
            ? `${sender.senderEmail} is locked in. Gmail will verify the address on the first approved send.`
            : `Microsoft outreach currently sends only from ${sender.mailboxEmail}.`,
      },
      {
        id: "campaign",
        label: "Your active campaign",
        status: campaign ? "pass" : "fail",
        detail:
          campaign
            ? `${campaign.name} is selected for your queue. Teammates can use a different active campaign.`
            : "Choose an active campaign before building your daily queue.",
        href: "/crm/outreach?tab=campaign",
        action: campaign ? undefined : "Review campaigns",
      },
      {
        id: "sequence",
        label: "Follow-up sequence",
        status: sequenceValid ? "pass" : "fail",
        detail: sequenceValid
          ? `${sequence.length} approval-gated step${sequence.length === 1 ? "" : "s"}; replies stop every later step.`
          : "Add a valid first email and purpose-led follow-up steps.",
        href: "/crm/outreach?tab=campaign",
        action: sequenceValid ? undefined : "Fix sequence",
      },
      {
        id: "booking",
        label: "Booking handoff",
        status: campaign?.booking_url ? "pass" : "warn",
        detail: campaign?.booking_url
          ? "A positive reply can receive the saved booking link after approval."
          : "Add the AI13 booking link so interested replies can convert straight into calls.",
        href: "/crm/outreach?tab=intelligence",
        action: campaign?.booking_url ? undefined : "Add booking link",
      },
      {
        id: "limit",
        label: "Daily safety limit",
        status:
          campaign && dailyLimit >= 1 && dailyLimit <= OUTREACH_DAILY_HARD_LIMIT
            ? "pass"
            : "fail",
        detail: campaign
          ? `${Math.min(dailyLimit || 0, OUTREACH_DAILY_HARD_LIMIT)} maximum sends per London day; the hard ceiling is 20.`
          : "The daily limit will be checked when a campaign is activated.",
        href: "/crm/outreach?tab=campaign",
        action:
          campaign && dailyLimit >= 1 && dailyLimit <= OUTREACH_DAILY_HARD_LIMIT
            ? undefined
            : "Fix limit",
      },
      {
        id: "prospects",
        label: "Eligible prospects",
        status: eligible > 0 ? "pass" : "fail",
        detail: eligible
          ? `${eligible.toLocaleString("en-GB")} unsent contacts are available for free ranking.`
          : "No unsent contacts are currently eligible for a campaign.",
        href: "/crm/outreach?tab=prospects",
        action: eligible ? undefined : "Review prospects",
      },
      {
        id: "automation",
        label: "Morning and reply checks",
        status: process.env.CRON_SECRET ? "pass" : "fail",
        detail: process.env.CRON_SECRET
          ? `Daily queue and reply monitoring are enabled. ${queued} contact${queued === 1 ? " is" : "s are"} in today’s queue.`
          : "The secure scheduler key is missing, so daily automation cannot run.",
      },
    ];

    const failures = checks.filter((check) => check.status === "fail").length;
    const warnings = checks.filter((check) => check.status === "warn").length;
    return NextResponse.json({
      status: failures ? "blocked" : warnings ? "attention" : "ready",
      canLaunch: failures === 0,
      failures,
      warnings,
      checks,
      checkedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "failed to check outreach readiness" },
      { status: 500 }
    );
  }
}
