import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  googleConnected,
  googleGrantedScopes,
} from "@/lib/google";
import { gmailAccessStatus, OUTREACH_FROM_EMAIL } from "@/lib/gmail";
import { londonDate, OUTREACH_DAILY_HARD_LIMIT } from "@/lib/outreach";

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
    const today = londonDate();
    const [google, campaignResult, eligibleResult, queuedResult, sentAliasResult] =
      await Promise.all([
        googleConnected(),
        supabaseAdmin
          .from("outreach_campaigns")
          .select("*")
          .eq("status", "active")
          .order("created_at"),
        supabaseAdmin
          .from("outreach_prospects")
          .select("id", { count: "exact", head: true })
          .in("status", ["imported", "queued"])
          .not("email", "is", null),
        supabaseAdmin
          .from("outreach_enrolments")
          .select("id", { count: "exact", head: true })
          .eq("queued_for", today)
          .in("status", ["queued", "researched", "drafted", "approved", "contacted"]),
        supabaseAdmin
          .from("outreach_messages")
          .select("id", { count: "exact", head: true })
          .eq("status", "sent")
          .eq("from_email", OUTREACH_FROM_EMAIL),
      ]);

    const [scopes, gmailApi] = google.connected
      ? await Promise.all([googleGrantedScopes(), gmailAccessStatus()])
      : [new Set<string>(), "disconnected" as const];
    const readAccess = scopes.has(GMAIL_READ_SCOPE) || gmailApi === "ok";
    const sendScope = scopes.has(GMAIL_SEND_SCOPE);
    const databaseError =
      campaignResult.error ||
      eligibleResult.error ||
      queuedResult.error ||
      sentAliasResult.error;
    if (databaseError) throw databaseError;

    const activeCampaigns = campaignResult.data || [];
    const campaign = activeCampaigns[0] || null;
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

    const checks: ReadinessCheck[] = [
      {
        id: "google",
        label: "Google account",
        status: google.connected ? "pass" : "fail",
        detail: google.connected
          ? `${google.email || "Google"} is connected.`
          : "Connect Google before outreach can monitor replies or send approved mail.",
        href: "/settings",
        action: google.connected ? undefined : "Connect Google",
      },
      {
        id: "gmail",
        label: "Gmail permissions",
        status: !readAccess ? "fail" : sendScope || aliasPreviouslyVerified ? "pass" : "warn",
        detail:
          readAccess && (sendScope || aliasPreviouslyVerified)
            ? "Reading replies and sending approved messages are permitted."
            : readAccess
              ? "Gmail reading works. Sending will be verified safely on the first approved email."
              : "Gmail reading permission is unavailable. Check the Google connection in Settings.",
        href: "/settings",
        action: readAccess ? undefined : "Check Google",
      },
      {
        id: "sender",
        label: "Interviewa sender",
        status: aliasPreviouslyVerified ? "pass" : "warn",
        detail: aliasPreviouslyVerified
          ? `${OUTREACH_FROM_EMAIL} has already sent successfully.`
          : `${OUTREACH_FROM_EMAIL} is locked in. Gmail will verify the alias on the first approved send.`,
      },
      {
        id: "campaign",
        label: "Active campaign",
        status: activeCampaigns.length === 1 ? "pass" : "fail",
        detail:
          activeCampaigns.length === 1
            ? `${campaign.name} is active for ${String(campaign.audience || "the saved audience").slice(0, 100)}.`
            : activeCampaigns.length > 1
              ? `${activeCampaigns.length} campaigns are active. Keep exactly one active to prevent the wrong audience being selected.`
              : "Choose and activate one campaign before building the daily queue.",
        href: "/crm/outreach?tab=campaign",
        action: activeCampaigns.length === 1 ? undefined : "Review campaigns",
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
