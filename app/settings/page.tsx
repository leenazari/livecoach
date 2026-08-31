"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached, setCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";
import InitialCalendarSync from "@/components/InitialCalendarSync";

type Lesson = {
  id: string;
  topic: string;
  title: string | null;
  content: string;
  source_url: string | null;
};
const TOPICS = ["negotiation", "psychology", "strategy", "general"];
type GmailIssue =
  | "none"
  | "disconnected"
  | "scope_missing"
  | "workspace_policy"
  | "api_disabled"
  | "token_rejected"
  | "rate_limited"
  | "google_error";

type LinkedInStatus = {
  status: "ok" | "expired" | "disconnected";
  connected: boolean;
  email: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  socialAccess: boolean;
  expiresAt: string | null;
  configured: boolean;
};

type LinkedInInboxStatus = {
  active: boolean;
  status: "active" | "revoked" | "not_created";
  tokenLastFour: string | null;
  browserBound: boolean;
  maxConversations: number;
  lookbackDays: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  importedMessageCount: number;
  reviewCount: number;
};

type SendPilotStatus = {
  configured: boolean;
  connected: boolean;
  status: "active" | "disconnected" | "not_connected";
  apiKeyLastFour: string | null;
  senderName: string | null;
  senderLinkedInUrl: string | null;
  senderStatus: string | null;
  webhookConfigured: boolean;
  webhookUrl: string | null;
  lastBackfillAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  importedMessageCount: number;
  reviewCount: number;
  messageReviewCount: number;
  leadReviewCount: number;
  leadReviews: Array<{
    id: string;
    sendpilot_lead_id: string;
    sendpilot_campaign_name: string | null;
    linkedin_url: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    company_name: string | null;
    job_title: string | null;
    external_status: string | null;
    review_reason: string;
    last_seen_at: string;
  }>;
  lookbackDays: number;
  mappedCampaignCount: number;
  activeLeadCount: number;
  outboundReady: boolean;
};

type SendPilotCampaignConfiguration = {
  connected: boolean;
  webhookConfigured: boolean;
  campaigns: Array<{
    id: string;
    name: string;
    status: "started" | "paused" | "draft" | "finished";
    totalLeads: number;
    connectionsSent: number;
    messagesSent: number;
    repliesReceived: number;
  }>;
  livecoachCampaigns: Array<{
    id: string;
    name: string;
    status: string;
    approval_mode: boolean;
    daily_limit: number;
  }>;
  mappings: Array<{
    id: string;
    livecoach_campaign_id: string;
    sendpilot_campaign_id: string;
    sendpilot_campaign_name: string;
    sendpilot_campaign_status: string;
    active: boolean;
  }>;
};

function gmailIssueCopy(issue?: GmailIssue): string {
  if (issue === "scope_missing")
    return "The Google token does not contain Gmail read permission.";
  if (issue === "workspace_policy")
    return "Google Workspace policy is blocking Gmail access for LiveCoach.";
  if (issue === "api_disabled")
    return "The Gmail API is disabled in the connected Google Cloud project.";
  if (issue === "token_rejected")
    return "Google rejected the saved access token.";
  if (issue === "rate_limited")
    return "Google temporarily rate-limited the Gmail check.";
  return "Google did not make Gmail reading available to LiveCoach.";
}

// Settings = the global "brain". One knowledge base about you and your business
// that gets fed into every AI pass (assistant, build-from-context, post-call
// profiles, the day read, and live-call coaching) so the CRM always reasons
// with your real-world context.
export default function SettingsPage() {
  const cached = getCached<{ knowledge: string; objectionStances?: string }>(
    "/api/crm/workspace"
  );
  const [knowledge, setKnowledge] = useState(cached?.knowledge || "");
  const [objectionStances, setObjectionStances] = useState(
    cached?.objectionStances || ""
  );
  const [loaded, setLoaded] = useState(!!cached);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [saveErr, setSaveErr] = useState("");
  // Once you've typed, the background load must NOT overwrite your text.
  const touchedRef = useRef(false);
  const objTouchedRef = useRef(false);

  // Lessons library state.
  const [lessons, setLessons] = useState<Lesson[]>(
    getCached<{ lessons: Lesson[] }>("/api/crm/lessons")?.lessons || []
  );
  const [lTopic, setLTopic] = useState("negotiation");
  const [lSource, setLSource] = useState("");
  const [lContent, setLContent] = useState("");
  const [lYt, setLYt] = useState("");
  const [distilling, setDistilling] = useState(false);
  const [lErr, setLErr] = useState("");

  // Google Calendar connection.
  const [gcal, setGcal] = useState<{
    connected: boolean;
    email: string | null;
    configured: boolean;
    gmail?: "ok" | "missing" | "disconnected";
    gmailSend?: boolean;
    gmailDraft?: boolean;
    gmailIssue?: GmailIssue;
    drive?: "ok" | "missing" | "disconnected";
    driveReconnectRequired?: boolean;
    calendarList?: "ok" | "missing" | "disconnected";
    calendarReconnectRequired?: boolean;
  } | null>(null);
  const [gcalNote, setGcalNote] = useState("");
  const [microsoft, setMicrosoft] = useState<{
    status: "ok" | "missing" | "disconnected";
    email: string | null;
    mailRead: boolean;
    mailSend: boolean;
    mailDraft: boolean;
    calendar: boolean;
    configured: boolean;
  } | null>(null);
  const [microsoftNote, setMicrosoftNote] = useState("");
  const [linkedin, setLinkedin] = useState<LinkedInStatus | null>(null);
  const [linkedinNote, setLinkedinNote] = useState("");
  const [linkedinDisconnecting, setLinkedinDisconnecting] = useState(false);
  const [linkedinDisconnectConfirm, setLinkedinDisconnectConfirm] = useState(false);
  const [linkedinDisconnectError, setLinkedinDisconnectError] = useState("");
  const [linkedinInbox, setLinkedinInbox] = useState<LinkedInInboxStatus | null>(null);
  const [linkedinInboxLoaded, setLinkedinInboxLoaded] = useState(false);
  const [linkedinInboxToken, setLinkedinInboxToken] = useState("");
  const [linkedinInboxBusy, setLinkedinInboxBusy] = useState(false);
  const [linkedinInboxNote, setLinkedinInboxNote] = useState("");
  const [linkedinInboxError, setLinkedinInboxError] = useState("");
  const [sendPilot, setSendPilot] = useState<SendPilotStatus | null>(null);
  const [sendPilotCampaigns, setSendPilotCampaigns] =
    useState<SendPilotCampaignConfiguration | null>(null);
  const [sendPilotMappingBusy, setSendPilotMappingBusy] = useState("");
  const [sendPilotLoaded, setSendPilotLoaded] = useState(false);
  const [sendPilotApiKey, setSendPilotApiKey] = useState("");
  const [sendPilotWebhookSecret, setSendPilotWebhookSecret] = useState("");
  const [sendPilotBusy, setSendPilotBusy] = useState<
    "connect" | "webhook" | "backfill" | "disconnect" | null
  >(null);
  const [sendPilotNote, setSendPilotNote] = useState("");
  const [sendPilotError, setSendPilotError] = useState("");
  const [disconnectConfirm, setDisconnectConfirm] = useState<
    "google" | "microsoft" | null
  >(null);
  const [disconnecting, setDisconnecting] = useState<
    "google" | "microsoft" | null
  >(null);
  const [disconnectError, setDisconnectError] = useState("");

  useEffect(() => {
    crmFetch<{ knowledge: string; objectionStances?: string }>(
      "/api/crm/workspace"
    )
      .then((d) => {
        // Never clobber text the user has already started editing.
        if (!touchedRef.current) setKnowledge(d.knowledge || "");
        if (!objTouchedRef.current) setObjectionStances(d.objectionStances || "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    crmFetch<{ lessons: Lesson[] }>("/api/crm/lessons")
      .then((d) => setLessons(d.lessons || []))
      .catch(() => {});
    crmFetch<{ connected: boolean; email: string | null; configured: boolean; gmail?: "ok" | "missing" | "disconnected"; gmailSend?: boolean; gmailDraft?: boolean; gmailIssue?: GmailIssue; drive?: "ok" | "missing" | "disconnected"; driveReconnectRequired?: boolean; calendarList?: "ok" | "missing" | "disconnected"; calendarReconnectRequired?: boolean }>(
      "/api/auth/google/status"
    )
      .then((d) => setGcal(d))
      .catch(() => {});
    crmFetch<{
      status: "ok" | "missing" | "disconnected";
      email: string | null;
      mailRead: boolean;
      mailSend: boolean;
      mailDraft: boolean;
      calendar: boolean;
      configured: boolean;
    }>("/api/auth/microsoft/status")
      .then((d) => setMicrosoft(d))
      .catch(() => {});
    crmFetch<LinkedInStatus>("/api/auth/linkedin/status")
      .then((d) => setLinkedin(d))
      .catch(() => {});
    crmFetch<LinkedInInboxStatus>("/api/crm/linkedin-inbox")
      .then((d) => setLinkedinInbox(d))
      .catch(() => setLinkedinInbox(null))
      .finally(() => setLinkedinInboxLoaded(true));
    crmFetch<SendPilotStatus>("/api/crm/sendpilot")
      .then((d) => setSendPilot(d))
      .catch(() => setSendPilot(null))
      .finally(() => setSendPilotLoaded(true));
    crmFetch<SendPilotCampaignConfiguration>("/api/crm/sendpilot/campaigns")
      .then((d) => setSendPilotCampaigns(d))
      .catch(() => setSendPilotCampaigns(null));
    if (typeof window !== "undefined") {
      const g = new URLSearchParams(window.location.search).get("google");
      if (g === "connected") setGcalNote("Google Calendar connected.");
      else if (g === "denied") setGcalNote("Connection cancelled.");
      else if (g === "error") setGcalNote("Couldn't connect - try again.");
      else if (g === "account_in_use")
        setGcalNote(
          "That Google account is already connected to another LiveCoach user. Choose your own separate work account."
        );
      else if (g === "identity_missing")
        setGcalNote("Google did not return an account identity. Try connecting again.");
      const m = new URLSearchParams(window.location.search).get("microsoft");
      if (m === "connected") setMicrosoftNote("Microsoft connected.");
      else if (m === "denied") setMicrosoftNote("Microsoft connection cancelled.");
      else if (m === "error") setMicrosoftNote("Microsoft could not be connected. Try again.");
      else if (m === "account_in_use")
        setMicrosoftNote(
          "That Microsoft account is already connected to another LiveCoach user."
        );
      else if (m === "identity_missing")
        setMicrosoftNote("Microsoft did not return an account identity.");
      const linkedInResult = new URLSearchParams(window.location.search).get("linkedin");
      if (linkedInResult === "connected")
        setLinkedinNote("LinkedIn connected to this LiveCoach account.");
      else if (linkedInResult === "social_enabled")
        setLinkedinNote("LinkedIn connected with approved posting and like permission.");
      else if (linkedInResult === "denied")
        setLinkedinNote("LinkedIn connection cancelled. Nothing changed.");
      else if (linkedInResult === "account_in_use")
        setLinkedinNote(
          "That LinkedIn account is already connected to another LiveCoach user."
        );
      else if (linkedInResult === "identity_missing")
        setLinkedinNote("LinkedIn did not return an account identity. Try again.");
      else if (linkedInResult === "access_denied")
        setLinkedinNote("This LiveCoach account no longer has active workspace access.");
      else if (linkedInResult === "error")
        setLinkedinNote("LinkedIn could not be connected. Check the app setup and try again.");
    }
  }, []);

  const distil = async () => {
    if (lContent.trim().length < 80) {
      setLErr("Paste a bit more content to learn from.");
      return;
    }
    setDistilling(true);
    setLErr("");
    try {
      const { lesson } = await crmFetch<{ lesson: Lesson }>("/api/crm/lessons", {
        method: "POST",
        body: JSON.stringify({
          content: lContent,
          topic: lTopic,
          sourceUrl: lSource.trim() || null,
        }),
      });
      setLessons((p) => [lesson, ...p]);
      setLContent("");
      setLSource("");
    } catch (e: any) {
      setLErr(e.message || "couldn't distil that");
    } finally {
      setDistilling(false);
    }
  };

  const disconnectConnector = async (provider: "google" | "microsoft") => {
    setDisconnecting(provider);
    setDisconnectError("");
    try {
      const result = await crmFetch<{
        ok: boolean;
        identity: {
          provider: "google" | "microsoft" | null;
          senderEmail: string | null;
        };
        warning?: string | null;
      }>(`/api/auth/${provider}/disconnect`, { method: "DELETE" });
      if (!result.ok) throw new Error("The database did not confirm the disconnect");
      const warning = result.warning ? ` ${result.warning}` : "";
      if (provider === "google") {
        setGcal((current) => ({
          connected: false,
          email: null,
          configured: current?.configured ?? true,
          gmail: "disconnected",
          gmailSend: false,
          gmailDraft: false,
          gmailIssue: "disconnected",
        }));
        setGcalNote(
          result.identity.provider === "microsoft"
            ? `Google disconnected. Microsoft remains connected.${warning}`
            : `Google disconnected. Email, calendar sync and outreach are paused until another provider is connected.${warning}`
        );
      } else {
        setMicrosoft((current) => ({
          status: "disconnected",
          email: null,
          mailRead: false,
          mailSend: false,
          mailDraft: false,
          calendar: false,
          configured: current?.configured ?? true,
        }));
        setMicrosoftNote(
          result.identity.provider === "google"
            ? `Microsoft disconnected. Google remains connected.${warning}`
            : `Microsoft disconnected. Email, calendar sync and outreach are paused until another provider is connected.${warning}`
        );
      }
      setDisconnectConfirm(null);
    } catch (error: any) {
      setDisconnectError(
        error?.message || "The connection was not removed. Please try again."
      );
    } finally {
      setDisconnecting(null);
    }
  };

  const disconnectLinkedIn = async () => {
    setLinkedinDisconnecting(true);
    setLinkedinDisconnectError("");
    try {
      const result = await crmFetch<{ ok: boolean }>(
        "/api/auth/linkedin/disconnect",
        { method: "DELETE" }
      );
      if (!result.ok) throw new Error("The database did not confirm the disconnect");
      setLinkedin((current) => ({
        status: "disconnected",
        connected: false,
        email: null,
        displayName: null,
        pictureUrl: null,
        socialAccess: false,
        expiresAt: null,
        configured: current?.configured ?? true,
      }));
      setLinkedinNote("LinkedIn disconnected from this LiveCoach account.");
      setLinkedinDisconnectConfirm(false);
    } catch (error: any) {
      setLinkedinDisconnectError(
        error?.message || "The LinkedIn connection was not removed. Please try again."
      );
    } finally {
      setLinkedinDisconnecting(false);
    }
  };

  const createLinkedInInboxKey = async (rotate: boolean) => {
    if (
      rotate &&
      !window.confirm(
        "Replace the current inbox key? The key already saved in Chrome will stop working."
      )
    ) {
      return;
    }
    setLinkedinInboxBusy(true);
    setLinkedinInboxError("");
    setLinkedinInboxNote("");
    try {
      const result = await crmFetch<{
        ok: boolean;
        token: string;
        tokenLastFour: string;
        active: boolean;
        shownOnce: boolean;
      }>("/api/crm/linkedin-inbox", {
        method: "POST",
        body: JSON.stringify({
          rotate,
          maxConversations: linkedinInbox?.maxConversations || 10,
          lookbackDays: linkedinInbox?.lookbackDays || 14,
        }),
      });
      if (!result.ok || !result.token || !result.shownOnce) {
        throw new Error("The server did not confirm the new connector key");
      }
      setLinkedinInboxToken(result.token);
      setLinkedinInbox((current) => ({
        active: true,
        status: "active",
        tokenLastFour: result.tokenLastFour,
        browserBound: false,
        maxConversations: current?.maxConversations || 10,
        lookbackDays: current?.lookbackDays || 14,
        lastRunAt: current?.lastRunAt || null,
        lastSuccessAt: current?.lastSuccessAt || null,
        lastError: null,
        importedMessageCount: current?.importedMessageCount || 0,
        reviewCount: current?.reviewCount || 0,
      }));
      setLinkedinInboxNote(
        "Connector key created. Copy it into the Chrome connector now. It will not be shown again."
      );
    } catch (error: any) {
      setLinkedinInboxError(
        error?.message || "The LinkedIn inbox connector key could not be created."
      );
    } finally {
      setLinkedinInboxBusy(false);
    }
  };

  const copyLinkedInInboxKey = async () => {
    if (!linkedinInboxToken) return;
    try {
      await navigator.clipboard.writeText(linkedinInboxToken);
      setLinkedinInboxNote("Connector key copied.");
    } catch {
      setLinkedinInboxError("Copy failed. Select the key and copy it manually.");
    }
  };

  const revokeLinkedInInboxKey = async () => {
    if (
      !window.confirm(
        "Revoke the local inbox connector? Existing imported CRM records will remain."
      )
    ) {
      return;
    }
    setLinkedinInboxBusy(true);
    setLinkedinInboxError("");
    setLinkedinInboxNote("");
    try {
      const result = await crmFetch<{ ok: boolean; active: boolean }>(
        "/api/crm/linkedin-inbox",
        { method: "DELETE" }
      );
      if (!result.ok || result.active) {
        throw new Error("The server did not confirm that revocation");
      }
      setLinkedinInboxToken("");
      setLinkedinInbox((current) =>
        current
          ? {
              ...current,
              active: false,
              status: "revoked",
              browserBound: false,
            }
          : current
      );
      setLinkedinInboxNote(
        "Local inbox access revoked. Imported contacts and messages remain in the CRM."
      );
    } catch (error: any) {
      setLinkedinInboxError(
        error?.message || "The LinkedIn inbox connector could not be revoked."
      );
    } finally {
      setLinkedinInboxBusy(false);
    }
  };

  const connectSendPilotAccount = async () => {
    if (!sendPilotApiKey.trim()) {
      setSendPilotError("Paste the SendPilot API key first.");
      return;
    }
    setSendPilotBusy("connect");
    setSendPilotError("");
    setSendPilotNote("");
    try {
      const result = await crmFetch<SendPilotStatus & { ok: boolean }>(
        "/api/crm/sendpilot",
        {
          method: "POST",
          body: JSON.stringify({ apiKey: sendPilotApiKey.trim() }),
        }
      );
      if (!result.ok || !result.connected) {
        throw new Error("The server did not confirm the SendPilot connection");
      }
      setSendPilot(result);
      setSendPilotApiKey("");
      const configuration = await crmFetch<SendPilotCampaignConfiguration>(
        "/api/crm/sendpilot/campaigns"
      );
      setSendPilotCampaigns(configuration);
      setSendPilotNote(
        "SendPilot connected. Add its CRM event webhook below, then map the campaigns this salesperson is allowed to use."
      );
    } catch (error: any) {
      setSendPilotError(error?.message || "SendPilot could not be connected.");
    } finally {
      setSendPilotBusy(null);
    }
  };

  const saveSendPilotWebhook = async () => {
    if (!sendPilotWebhookSecret.trim()) {
      setSendPilotError("Paste the webhook secret shown by SendPilot first.");
      return;
    }
    setSendPilotBusy("webhook");
    setSendPilotError("");
    setSendPilotNote("");
    try {
      const result = await crmFetch<SendPilotStatus & { ok: boolean }>(
        "/api/crm/sendpilot",
        {
          method: "PATCH",
          body: JSON.stringify({
            webhookSecret: sendPilotWebhookSecret.trim(),
          }),
        }
      );
      if (!result.ok || !result.webhookConfigured) {
        throw new Error("The server did not confirm the webhook secret");
      }
      setSendPilot(result);
      setSendPilotWebhookSecret("");
      setSendPilotNote(
        "Automatic SendPilot activity and reply capture is ready. Map a running campaign below before handing over approved leads."
      );
    } catch (error: any) {
      setSendPilotError(
        error?.message || "The SendPilot webhook secret could not be saved."
      );
    } finally {
      setSendPilotBusy(null);
    }
  };

  const runSendPilotInitialBackfill = async () => {
    setSendPilotBusy("backfill");
    setSendPilotError("");
    setSendPilotNote("");
    try {
      const result = await crmFetch<{
        ok: boolean;
        imported: number;
        duplicates: number;
        review: number;
        conversations: number;
        truncated: boolean;
        leadReconciliation: {
          campaigns: number;
          scanned: number;
          matched: number;
          updated: number;
          review: number;
          duplicatesBlocked: number;
          emailOutreachPaused: number;
          truncated: boolean;
        };
        integration: SendPilotStatus;
      }>("/api/crm/sendpilot/backfill", { method: "POST" });
      if (!result.ok) throw new Error("The 14-day import did not complete");
      setSendPilot(result.integration);
      const leads = result.leadReconciliation;
      setSendPilotNote(
        `${leads.scanned} SendPilot leads checked. ${leads.matched} matched exactly to the CRM. ${leads.duplicatesBlocked} workspace duplicates blocked. ${leads.review} leads need review. ${leads.emailOutreachPaused} competing LiveCoach email items paused. ${result.imported} recent messages imported and ${result.duplicates} message duplicates skipped.${result.truncated ? " The safety cap was reached, so the remaining oldest records were not requested." : ""}`
      );
    } catch (error: any) {
      setSendPilotError(
        error?.message || "The SendPilot 14-day import did not complete."
      );
    } finally {
      setSendPilotBusy(null);
    }
  };

  const dismissSendPilotReview = async (reviewId: string) => {
    setSendPilotMappingBusy(reviewId);
    setSendPilotError("");
    try {
      await crmFetch("/api/crm/sendpilot/reviews", {
        method: "PATCH",
        body: JSON.stringify({ id: reviewId, action: "dismiss" }),
      });
      setSendPilot((current) =>
        current
          ? {
              ...current,
              reviewCount: Math.max(0, current.reviewCount - 1),
              leadReviewCount: Math.max(0, current.leadReviewCount - 1),
              leadReviews: current.leadReviews.filter(
                (review) => review.id !== reviewId
              ),
            }
          : current
      );
      setSendPilotNote("SendPilot review item dismissed. No CRM lead was created.");
    } catch (error: any) {
      setSendPilotError(error?.message || "The SendPilot review item did not update.");
    } finally {
      setSendPilotMappingBusy("");
    }
  };

  const copySendPilotWebhookUrl = async () => {
    if (!sendPilot?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(sendPilot.webhookUrl);
      setSendPilotNote("Webhook URL copied.");
    } catch {
      setSendPilotError("Copy failed. Select the URL and copy it manually.");
    }
  };

  const disconnectSendPilotAccount = async () => {
    if (
      !window.confirm(
        "Disconnect SendPilot from LiveCoach? Existing CRM messages remain, but new replies stop importing."
      )
    ) {
      return;
    }
    setSendPilotBusy("disconnect");
    setSendPilotError("");
    setSendPilotNote("");
    try {
      const result = await crmFetch<SendPilotStatus & { ok: boolean }>(
        "/api/crm/sendpilot",
        { method: "DELETE" }
      );
      if (!result.ok || result.connected) {
        throw new Error("The server did not confirm the disconnect");
      }
      setSendPilot(result);
      setSendPilotCampaigns(null);
      setSendPilotNote(
        "SendPilot disconnected. Existing CRM contacts, replies and activity history remain available."
      );
    } catch (error: any) {
      setSendPilotError(error?.message || "SendPilot could not be disconnected.");
    } finally {
      setSendPilotBusy(null);
    }
  };

  const saveSendPilotCampaignLink = async (
    livecoachCampaignId: string,
    sendpilotCampaignId: string
  ) => {
    setSendPilotMappingBusy(livecoachCampaignId);
    setSendPilotError("");
    setSendPilotNote("");
    try {
      const result = await crmFetch<{
        ok: boolean;
        configuration: SendPilotCampaignConfiguration;
      }>("/api/crm/sendpilot/campaigns", {
        method: "PATCH",
        body: JSON.stringify({ livecoachCampaignId, sendpilotCampaignId }),
      });
      if (!result.ok) throw new Error("The campaign mapping was not confirmed");
      setSendPilotCampaigns(result.configuration);
      const activeMappings = result.configuration.mappings.filter(
        (mapping) => mapping.active
      ).length;
      setSendPilot((current) =>
        current
          ? {
              ...current,
              mappedCampaignCount: activeMappings,
              outboundReady:
                current.connected &&
                current.webhookConfigured &&
                activeMappings > 0,
            }
          : current
      );
      const livecoachName = result.configuration.livecoachCampaigns.find(
        (campaign) => campaign.id === livecoachCampaignId
      )?.name;
      const sendpilotName = result.configuration.campaigns.find(
        (campaign) => campaign.id === sendpilotCampaignId
      )?.name;
      setSendPilotNote(
        sendpilotCampaignId
          ? `${livecoachName || "LiveCoach campaign"} now hands approved LinkedIn leads to ${sendpilotName || "SendPilot"}.`
          : `${livecoachName || "LiveCoach campaign"} will no longer hand leads to SendPilot.`
      );
    } catch (error: any) {
      setSendPilotError(
        error?.message || "The SendPilot campaign mapping could not be saved."
      );
    } finally {
      setSendPilotMappingBusy("");
    }
  };

  const distilYt = async () => {
    if (!lYt.trim()) {
      setLErr("Paste a YouTube link first.");
      return;
    }
    setDistilling(true);
    setLErr("");
    try {
      const { lesson } = await crmFetch<{ lesson: Lesson }>("/api/crm/lessons", {
        method: "POST",
        body: JSON.stringify({ youtubeUrl: lYt.trim(), topic: lTopic }),
      });
      setLessons((p) => [lesson, ...p]);
      setLYt("");
    } catch (e: any) {
      setLErr(e.message || "couldn't fetch that video");
    } finally {
      setDistilling(false);
    }
  };

  const deleteLesson = async (id: string) => {
    const previous = lessons;
    setLErr("");
    setLessons((current) => current.filter((lesson) => lesson.id !== id));
    try {
      const result = await crmFetch<{ deletedId: string }>(`/api/crm/lessons/${id}`, {
        method: "DELETE",
      });
      if (result.deletedId !== id) throw new Error("database did not confirm deletion");
    } catch (error: any) {
      setLessons(previous);
      setLErr(error?.message || "That lesson did not delete. Please try again.");
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveErr("");
    try {
      const saved = await crmFetch<{
        ok: boolean;
        knowledge: string;
        objectionStances: string;
        updatedAt: string;
      }>("/api/crm/workspace", {
        method: "PUT",
        body: JSON.stringify({ knowledge, objectionStances }),
      });
      if (
        !saved.ok ||
        saved.knowledge !== knowledge ||
        saved.objectionStances !== objectionStances
      ) {
        throw new Error("database returned different Brain content");
      }
      // Keep the in-memory cache in step so navigating away and back shows the
      // saved text, not a stale copy.
      setCached("/api/crm/workspace", {
        knowledge: saved.knowledge,
        objectionStances: saved.objectionStances,
        updatedAt: saved.updatedAt,
      });
      touchedRef.current = false;
      objTouchedRef.current = false;
      setSavedAt(new Date(saved.updatedAt).toLocaleTimeString());
    } catch (e: any) {
      // Surface failures LOUDLY - a silent fail is what made edits "vanish"
      // (the save 404'd, then the page reloaded the old value over the top).
      setSaveErr(
        e?.message
          ? `Not saved: ${e.message}. Your text is still here - don't reload yet.`
          : "Not saved - the save request failed. Your text is still here, don't reload yet."
      );
    } finally {
      setSaving(false);
    }
  };

  const googleReconnectRequired = Boolean(
    gcal?.calendarReconnectRequired ||
      gcal?.gmailDraft === false ||
      gcal?.driveReconnectRequired
  );

  return (
    <main className="relative z-10 mx-auto max-w-[900px] px-5 py-10">
      <header className="mb-5 flex items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / settings
          </span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/settings/readiness"
            className="rounded-full border border-sky/45 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-sky transition hover:bg-sky/10"
          >
            Account readiness
          </Link>
          <Link
            href="/settings/sales-profile"
            className="rounded-full border border-sage/45 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-sage transition hover:bg-sage/10"
          >
            My Sales Setup
          </Link>
          <Link
            href="/settings/team"
            className="rounded-full border border-amber/45 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/10"
          >
            Team access
          </Link>
          <Link
            href="/crm"
            className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
          >
            ◂ dashboard
          </Link>
        </div>
      </header>

      <InitialCalendarSync />

      <div
        id="linkedin"
        className={`mb-5 rounded-xl border p-5 ${
          gcal === null
            ? "border-edge bg-panel/40"
            : gcal.connected && !googleReconnectRequired
              ? "border-sage/45 bg-sage/[0.06]"
              : gcal.connected
                ? "border-amber/50 bg-amber/[0.07]"
                : "border-rust/50 bg-rust/[0.07]"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p
              className={`font-mono text-[0.62rem] uppercase tracking-[0.2em] ${
                gcal === null
                  ? "text-muted"
                  : gcal.connected && !googleReconnectRequired
                    ? "text-sage"
                    : gcal.connected
                      ? "text-amber"
                      : "text-rust"
              }`}
            >
              {gcal === null
                ? "◷"
                : gcal.connected
                  ? googleReconnectRequired
                    ? "!"
                    : "✓"
                  : "!"} Google connection
            </p>
            <p className="mt-1 font-mono text-[0.6rem] leading-relaxed text-muted">
              {gcal === null
                ? "Checking the live connection…"
                : gcal.connected
                ? gcal.calendarReconnectRequired
                  ? `Connected${gcal.email ? ` as ${gcal.email}` : ""}, but Google has not granted permission to discover secondary and shared calendars. Reconnect Google once below, then sync again.`
                  : gcal.gmailDraft === false
                    ? `Connected${gcal.email ? ` as ${gcal.email}` : ""}, but Google has not granted permission to create approval-only Gmail drafts. Reconnect once below. LiveCoach will still never send those drafts automatically.`
                    : gcal.driveReconnectRequired
                      ? `Connected${gcal.email ? ` as ${gcal.email}` : ""}, but Google Drive storage has not been granted yet. Grant Drive access once below to use Save to Drive in Team Chat.`
                    : `Connected${
                    gcal.email ? ` as ${gcal.email}` : ""
                  }. Calendar is working${
                    gcal.gmail !== "ok"
                      ? `. ${gmailIssueCopy(gcal.gmailIssue)} Email context and automatic reply checks are paused; reconnecting again is not required`
                      : !gcal.gmailSend
                        ? " and Gmail context is working; Outreach will safely verify sending on the first approved email"
                        : " and Gmail reading and sending are working"
                  }. The Sync button on the dashboard pulls calendar changes on demand.`
                : "Not connected. Reconnect Google Calendar so meetings, cancellations and reschedules stay in sync."}
            </p>
            {gcal?.connected && gcal.drive === "ok" ? (
              <p className="mt-1 font-mono text-[0.58rem] leading-relaxed text-sage">
                Google Drive storage is ready. Chat files are copied only when you press Save to Drive.
              </p>
            ) : null}
            {gcalNote && (
              <p aria-live="polite" className="mt-1 font-mono text-[0.58rem] text-sage">{gcalNote}</p>
            )}
            {gcal && !gcal.configured && (
              <p className="mt-1 font-mono text-[0.58rem] text-rust">
                Not set up yet - add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
                GOOGLE_REDIRECT_URI in Vercel, then redeploy.
              </p>
            )}
          </div>
          {gcal?.connected ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {googleReconnectRequired ? (
                <a
                  href="/api/auth/google/start"
                  className="rounded-full border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25"
                >
                  {gcal.calendarReconnectRequired
                    ? "Grant calendar access"
                    : gcal.gmailDraft === false
                      ? "Grant email draft access"
                      : "Grant Drive access"}
                </a>
              ) : null}
              <span
                className={`rounded-full border px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider ${
                  googleReconnectRequired
                    ? "border-amber/55 bg-amber/10 text-amber"
                    : "border-sage/55 bg-sage/10 text-sage"
                }`}
              >
                {googleReconnectRequired
                  ? "● Google partly connected"
                  : "● Google connected"}
              </span>
              <button
                type="button"
                aria-label="Disconnect Google"
                onClick={() => {
                  setDisconnectError("");
                  setDisconnectConfirm("google");
                }}
                className="min-h-10 rounded-full border border-rust/50 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust/10"
              >
                Disconnect
              </button>
            </div>
          ) : gcal ? (
            <a
              href="/api/auth/google/start"
              className="shrink-0 rounded-full border border-rust/60 bg-rust/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-rust transition hover:bg-rust/25"
            >
              reconnect google
            </a>
          ) : (
            <span className="shrink-0 rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted">
              checking…
            </span>
          )}
        </div>
        {disconnectConfirm === "google" ? (
          <div role="alert" className="mt-4 rounded-lg border border-rust/45 bg-rust/[0.07] p-3">
            <p className="text-sm text-bone">Disconnect Google from this LiveCoach account?</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              Google email and calendar access will stop immediately. Another connected provider will take over, otherwise outreach and calendar sync will pause.
            </p>
            {disconnectError ? <p className="mt-2 text-xs text-rust">{disconnectError}</p> : null}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setDisconnectConfirm(null)} disabled={!!disconnecting} className="min-h-10 rounded-full border border-edge px-4 font-mono text-[0.58rem] uppercase text-muted disabled:opacity-40">Cancel</button>
              <button type="button" onClick={() => disconnectConnector("google")} disabled={!!disconnecting} className="min-h-10 rounded-full border border-rust/60 bg-rust/15 px-4 font-mono text-[0.58rem] uppercase text-rust disabled:opacity-40">{disconnecting === "google" ? "Disconnecting…" : "Yes, disconnect Google"}</button>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={`mb-5 rounded-xl border p-5 ${
          microsoft === null
            ? "border-edge bg-panel/40"
            : microsoft.status === "ok" && microsoft.mailDraft
              ? "border-sky/45 bg-sky/[0.06]"
              : microsoft.status === "missing" || microsoft.status === "ok"
                ? "border-amber/45 bg-amber/[0.06]"
                : "border-edge bg-panel/40"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className={`font-mono text-[0.62rem] uppercase tracking-[0.2em] ${microsoft?.status === "ok" && microsoft.mailDraft ? "text-sky" : microsoft?.status === "missing" || microsoft?.status === "ok" ? "text-amber" : "text-muted"}`}>
              {microsoft === null ? "◷" : microsoft.status === "ok" && microsoft.mailDraft ? "✓" : microsoft.status === "missing" || microsoft.status === "ok" ? "!" : "○"} Microsoft connection
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {microsoft === null
                ? "Checking the live connection…"
                : microsoft.status === "ok"
                  ? microsoft.mailDraft
                    ? `Connected${microsoft.email ? ` as ${microsoft.email}` : ""}. Outlook email and Microsoft Calendar belong only to this LiveCoach account.`
                    : `Connected${microsoft.email ? ` as ${microsoft.email}` : ""}, but Microsoft has not granted permission to create approval-only Outlook drafts. Reconnect once below. LiveCoach will still never send those drafts automatically.`
                  : microsoft.status === "missing"
                    ? `A Microsoft connection is saved${microsoft.email ? ` for ${microsoft.email}` : ""}, but Microsoft is not granting access. Reconnect it or disconnect it below.`
                  : microsoft.configured
                    ? "Optional. Connect Outlook, Hotmail or Microsoft 365 for this user's email and calendar."
                    : "Microsoft support is installed but needs the Microsoft app credentials before accounts can connect."}
            </p>
            {microsoftNote ? (
              <p aria-live="polite" className="mt-1 font-mono text-[0.58rem] text-sky">{microsoftNote}</p>
            ) : null}
          </div>
          {microsoft && microsoft.status !== "disconnected" ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {microsoft.status === "ok" && !microsoft.mailDraft ? (
                <a
                  href="/api/auth/microsoft/start"
                  className="rounded-full border border-amber/60 bg-amber/15 px-4 py-2 text-center font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25"
                >
                  Grant email draft access
                </a>
              ) : null}
              <span className={`rounded-full border px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider ${microsoft.status === "ok" && microsoft.mailDraft ? "border-sky/55 bg-sky/10 text-sky" : "border-amber/55 bg-amber/10 text-amber"}`}>
                {microsoft.status === "ok" && microsoft.mailDraft ? "● Microsoft connected" : "! Microsoft needs attention"}
              </span>
              <button
                type="button"
                aria-label="Disconnect Microsoft"
                onClick={() => {
                  setDisconnectError("");
                  setDisconnectConfirm("microsoft");
                }}
                className="min-h-10 rounded-full border border-rust/50 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust/10"
              >
                Disconnect
              </button>
            </div>
          ) : microsoft?.configured ? (
            <a
              href="/api/auth/microsoft/start"
              className="shrink-0 rounded-full border border-sky/60 bg-sky/10 px-4 py-2 text-center font-mono text-[0.62rem] uppercase tracking-wider text-sky transition hover:bg-sky/20"
            >
              connect microsoft
            </a>
          ) : (
            <span className="shrink-0 rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted">
              administrator setup needed
            </span>
          )}
        </div>
        {disconnectConfirm === "microsoft" ? (
          <div role="alert" className="mt-4 rounded-lg border border-rust/45 bg-rust/[0.07] p-3">
            <p className="text-sm text-bone">Disconnect Microsoft from this LiveCoach account?</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              Outlook email and Microsoft Calendar access will stop immediately. Another connected provider will take over, otherwise outreach and calendar sync will pause.
            </p>
            {disconnectError ? <p className="mt-2 text-xs text-rust">{disconnectError}</p> : null}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setDisconnectConfirm(null)} disabled={!!disconnecting} className="min-h-10 rounded-full border border-edge px-4 font-mono text-[0.58rem] uppercase text-muted disabled:opacity-40">Cancel</button>
              <button type="button" onClick={() => disconnectConnector("microsoft")} disabled={!!disconnecting} className="min-h-10 rounded-full border border-rust/60 bg-rust/15 px-4 font-mono text-[0.58rem] uppercase text-rust disabled:opacity-40">{disconnecting === "microsoft" ? "Disconnecting…" : "Yes, disconnect Microsoft"}</button>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={`mb-5 rounded-xl border p-5 ${
          linkedin === null
            ? "border-edge bg-panel/40"
            : linkedin.status === "ok"
              ? "border-sky/45 bg-sky/[0.06]"
              : linkedin.status === "expired"
                ? "border-amber/45 bg-amber/[0.06]"
                : "border-edge bg-panel/40"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-3xl">
            <p
              className={`font-mono text-[0.62rem] uppercase tracking-[0.2em] ${
                linkedin?.status === "ok"
                  ? "text-sky"
                  : linkedin?.status === "expired"
                    ? "text-amber"
                    : "text-muted"
              }`}
            >
              {linkedin === null
                ? "◷"
                : linkedin.status === "ok"
                  ? "✓"
                  : linkedin.status === "expired"
                    ? "!"
                    : "○"} LinkedIn connection
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {linkedin === null
                ? "Checking the live connection…"
                : linkedin.status === "ok"
                  ? `Connected${linkedin.displayName ? ` as ${linkedin.displayName}` : linkedin.email ? ` as ${linkedin.email}` : ""}. This LinkedIn identity belongs only to this LiveCoach account.${linkedin.socialAccess ? " LinkedIn has also approved posting and like permission." : " Posting and like permission has not been requested."}`
                  : linkedin.status === "expired"
                    ? "The saved LinkedIn permission has expired. Reconnect to renew it."
                    : linkedin.configured
                      ? "Optional. Connect this salesperson's own LinkedIn account without sharing it with another LiveCoach user."
                      : "LinkedIn support is installed but needs the LinkedIn app credentials before accounts can connect."}
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">
              This approved API connection does not read LinkedIn messages. The separate local inbox capture below is optional and user-triggered. Neither connection gives another salesperson access to this account or publishes anything automatically.
            </p>
            {linkedinNote ? (
              <p aria-live="polite" className="mt-2 font-mono text-[0.58rem] text-sky">
                {linkedinNote}
              </p>
            ) : null}
          </div>
          {linkedin?.status === "ok" ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {!linkedin.socialAccess ? (
                <a
                  href="/api/auth/linkedin/start?social=1"
                  className="min-h-10 rounded-full border border-amber/55 bg-amber/10 px-4 py-2 text-center font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
                >
                  allow posts and likes
                </a>
              ) : (
                <span className="rounded-full border border-sky/55 bg-sky/10 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-sky">
                  ● LinkedIn connected
                </span>
              )}
              <button
                type="button"
                aria-label="Disconnect LinkedIn"
                onClick={() => {
                  setLinkedinDisconnectError("");
                  setLinkedinDisconnectConfirm(true);
                }}
                className="min-h-10 rounded-full border border-rust/50 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust/10"
              >
                Disconnect
              </button>
            </div>
          ) : linkedin?.configured ? (
            <a
              href="/api/auth/linkedin/start"
              className="shrink-0 rounded-full border border-sky/60 bg-sky/10 px-4 py-2 text-center font-mono text-[0.62rem] uppercase tracking-wider text-sky transition hover:bg-sky/20"
            >
              {linkedin.status === "expired" ? "reconnect LinkedIn" : "connect LinkedIn"}
            </a>
          ) : (
            <span className="shrink-0 rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted">
              administrator setup needed
            </span>
          )}
        </div>
        {linkedinDisconnectConfirm ? (
          <div role="alert" className="mt-4 rounded-lg border border-rust/45 bg-rust/[0.07] p-3">
            <p className="text-sm text-bone">Disconnect LinkedIn from this LiveCoach account?</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              The saved LinkedIn token and account identity will be removed. Reconnecting later starts LinkedIn authorization again.
            </p>
            {linkedinDisconnectError ? (
              <p className="mt-2 text-xs text-rust">{linkedinDisconnectError}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setLinkedinDisconnectConfirm(false)}
                disabled={linkedinDisconnecting}
                className="min-h-10 rounded-full border border-edge px-4 font-mono text-[0.58rem] uppercase text-muted disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={disconnectLinkedIn}
                disabled={linkedinDisconnecting}
                className="min-h-10 rounded-full border border-rust/60 bg-rust/15 px-4 font-mono text-[0.58rem] uppercase text-rust disabled:opacity-40"
              >
                {linkedinDisconnecting ? "Disconnecting…" : "Yes, disconnect LinkedIn"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div
        id="sendpilot-inbox"
        className={`mb-5 rounded-xl border p-5 ${
          sendPilot?.connected && sendPilot.webhookConfigured
            ? "border-moss/45 bg-moss/[0.06]"
            : "border-sky/40 bg-sky/[0.05]"
        }`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p
              className={`font-mono text-[0.62rem] uppercase tracking-[0.2em] ${
                sendPilot?.connected && sendPilot.webhookConfigured
                  ? "text-moss"
                  : "text-sky"
              }`}
            >
              {sendPilot?.connected && sendPilot.webhookConfigured ? "✓" : "◇"}{" "}
              SendPilot LinkedIn CRM
            </p>
            <p className="mt-2 text-sm leading-6 text-bone">
              Give each salesperson their own private SendPilot connection. LiveCoach keeps
              the canonical lead, assignment, approval and history. SendPilot executes the
              LinkedIn sequence and reports messages, connections, status changes and replies.
            </p>
            <p className="mt-2 text-xs leading-5 text-moss">
              LiveCoach can add one explicitly approved prospect to an existing running
              SendPilot campaign. It cannot start campaigns, change their sequence, send a
              direct ad hoc message, connect, like or post through the API.
            </p>
            {sendPilotLoaded && sendPilot ? (
              <p className="mt-3 font-mono text-[0.56rem] uppercase leading-5 text-muted">
                {sendPilot.connected
                  ? `${sendPilot.senderName || "LinkedIn account"} · key ending ${sendPilot.apiKeyLastFour || "unknown"}`
                  : "SendPilot is not connected"}
                {sendPilot.webhookConfigured ? " · automatic CRM events active" : " · webhook not yet active"}
                {sendPilot.lastBackfillAt
                  ? ` · last 14-day import ${new Date(sendPilot.lastBackfillAt).toLocaleString("en-GB")}`
                  : ""}
                {sendPilot.lastWebhookAt
                  ? ` · last CRM event ${new Date(sendPilot.lastWebhookAt).toLocaleString("en-GB")}`
                  : ""}
                {sendPilot.importedMessageCount
                  ? ` · ${sendPilot.importedMessageCount} imported`
                  : ""}
                {sendPilot.reviewCount ? ` · ${sendPilot.reviewCount} need review` : ""}
                {sendPilot.mappedCampaignCount
                  ? ` · ${sendPilot.mappedCampaignCount} campaign${sendPilot.mappedCampaignCount === 1 ? "" : "s"} mapped`
                  : ""}
                {sendPilot.activeLeadCount
                  ? ` · ${sendPilot.activeLeadCount} LinkedIn leads tracked`
                  : ""}
              </p>
            ) : !sendPilotLoaded ? (
              <p className="mt-3 font-mono text-[0.56rem] uppercase text-muted">
                Checking SendPilot status…
              </p>
            ) : null}
            {sendPilot?.lastError ? (
              <p className="mt-2 text-xs leading-5 text-rust">
                Last SendPilot operation did not complete. {sendPilot.lastError}
              </p>
            ) : null}
            {sendPilotNote ? (
              <p aria-live="polite" className="mt-2 text-xs leading-5 text-moss">
                {sendPilotNote}
              </p>
            ) : null}
            {sendPilotError ? (
              <p role="alert" className="mt-2 text-xs leading-5 text-rust">
                {sendPilotError}
              </p>
            ) : null}
          </div>

          {sendPilot?.connected ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runSendPilotInitialBackfill()}
                disabled={!!sendPilotBusy}
                className="min-h-10 rounded-full border border-sky/55 bg-sky/10 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-sky disabled:opacity-40"
              >
                {sendPilotBusy === "backfill" ? "Syncing…" : "Sync SendPilot now"}
              </button>
              <button
                type="button"
                onClick={() => void disconnectSendPilotAccount()}
                disabled={!!sendPilotBusy}
                className="min-h-10 rounded-full border border-rust/50 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-rust disabled:opacity-40"
              >
                {sendPilotBusy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ) : null}
        </div>

        {sendPilotLoaded && !sendPilot ? (
          <p className="mt-4 rounded-lg border border-rust/45 bg-rust/[0.07] p-3 text-xs leading-5 text-rust">
            LiveCoach could not load the SendPilot connection status. Reload this page before
            trying to connect it.
          </p>
        ) : sendPilot && !sendPilot.configured ? (
          <p className="mt-4 rounded-lg border border-rust/45 bg-rust/[0.07] p-3 text-xs leading-5 text-rust">
            The deployment encryption secret must be configured before a SendPilot API key
            can be stored.
          </p>
        ) : !sendPilot?.connected ? (
          <div className="mt-4 rounded-lg border border-edge bg-ink/35 p-3">
            <label className="block text-xs font-semibold text-bone" htmlFor="sendpilot-api-key">
              SendPilot API key
            </label>
            <p className="mt-1 text-xs leading-5 text-muted">
              Create a workspace key in SendPilot under Integrations and API Keys. It is
              encrypted before storage and is never returned to this page.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                id="sendpilot-api-key"
                type="password"
                autoComplete="off"
                value={sendPilotApiKey}
                onChange={(event) => setSendPilotApiKey(event.target.value)}
                placeholder="Paste API key"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-edge bg-ink px-3 font-mono text-xs text-bone outline-none"
              />
              <button
                type="button"
                onClick={() => void connectSendPilotAccount()}
                disabled={!!sendPilotBusy || !sendPilot?.configured}
                className="min-h-11 rounded-lg border border-sky/55 bg-sky/10 px-4 font-mono text-[0.56rem] uppercase text-sky disabled:opacity-40"
              >
                {sendPilotBusy === "connect" ? "Connecting…" : "Connect SendPilot"}
              </button>
            </div>
          </div>
        ) : !sendPilot.webhookConfigured ? (
          <div className="mt-4 rounded-lg border border-amber/45 bg-amber/[0.06] p-3">
            <p className="text-xs font-semibold text-bone">Finish automatic CRM event capture</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5 text-muted marker:text-amber">
              <li>In SendPilot, open Integrations and Webhooks, then add a webhook.</li>
              <li>Use the HTTPS URL below and select reply.received, message.sent, connection_request.sent, connection_request.accepted and lead.updated.</li>
              <li>Create it, then paste the one-time webhook secret below.</li>
            </ol>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={sendPilot.webhookUrl || ""}
                aria-label="SendPilot webhook URL"
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-edge bg-ink px-3 font-mono text-xs text-bone outline-none"
              />
              <button
                type="button"
                onClick={() => void copySendPilotWebhookUrl()}
                className="min-h-11 rounded-lg border border-sky/50 bg-sky/10 px-4 font-mono text-[0.56rem] uppercase text-sky"
              >
                Copy URL
              </button>
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="password"
                autoComplete="off"
                value={sendPilotWebhookSecret}
                onChange={(event) => setSendPilotWebhookSecret(event.target.value)}
                placeholder="Paste webhook secret"
                aria-label="SendPilot webhook secret"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-edge bg-ink px-3 font-mono text-xs text-bone outline-none"
              />
              <button
                type="button"
                onClick={() => void saveSendPilotWebhook()}
                disabled={!!sendPilotBusy}
                className="min-h-11 rounded-lg border border-moss/50 bg-moss/10 px-4 font-mono text-[0.56rem] uppercase text-moss disabled:opacity-40"
              >
                {sendPilotBusy === "webhook" ? "Saving…" : "Save webhook secret"}
              </button>
            </div>
          </div>
        ) : null}

        {sendPilot?.connected && sendPilot.webhookConfigured ? (
          <p className="mt-4 rounded-lg border border-sky/35 bg-sky/[0.05] p-3 text-xs leading-5 text-muted">
            Replies and activity arrive through the webhook as they happen. A twice-daily
            inbound-only safety sync repairs missed events and rechecks exact CRM matches.
            It cannot enrol a lead, start a sequence or send a message.
          </p>
        ) : null}

        {sendPilot?.leadReviews?.length ? (
          <div className="mt-4 rounded-lg border border-amber/45 bg-amber/[0.06] p-3">
            <p className="text-xs font-semibold text-bone">
              SendPilot leads waiting for an exact CRM match
            </p>
            <p className="mt-1 text-xs leading-5 text-muted">
              These were not imported as new people. Correct the email, LinkedIn URL or
              salesperson assignment in the CRM, then run the 14 day import again. Dismiss
              only when the lead should stay outside LiveCoach.
            </p>
            <ul className="mt-3 space-y-2">
              {sendPilot.leadReviews.map((review) => {
                const name = [review.first_name, review.last_name]
                  .filter(Boolean)
                  .join(" ") || "Unnamed SendPilot lead";
                return (
                  <li
                    key={review.id}
                    className="flex flex-col gap-2 rounded-lg border border-edge bg-ink/40 p-3 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-bone">
                        {name}
                        {review.job_title ? `, ${review.job_title}` : ""}
                        {review.company_name ? ` at ${review.company_name}` : ""}
                      </p>
                      <p className="mt-1 font-mono text-[0.52rem] uppercase leading-5 text-amber">
                        {review.review_reason.replace(/_/g, " ")}
                        {review.sendpilot_campaign_name
                          ? ` · ${review.sendpilot_campaign_name}`
                          : ""}
                        {review.external_status ? ` · ${review.external_status}` : ""}
                      </p>
                      <p className="mt-1 break-all text-xs leading-5 text-muted">
                        {review.email || "No email in SendPilot"}
                        {review.linkedin_url ? (
                          <>
                            {" · "}
                            <a
                              href={review.linkedin_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky hover:text-amber hover:underline"
                            >
                              LinkedIn profile ↗
                            </a>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void dismissSendPilotReview(review.id)}
                      disabled={!!sendPilotMappingBusy}
                      className="min-h-9 shrink-0 rounded-full border border-edge px-3 font-mono text-[0.52rem] uppercase text-muted hover:text-rust disabled:opacity-40"
                    >
                      {sendPilotMappingBusy === review.id ? "Dismissing…" : "Dismiss"}
                    </button>
                  </li>
                );
              })}
            </ul>
            {sendPilot.leadReviewCount > sendPilot.leadReviews.length ? (
              <p className="mt-2 text-xs text-muted">
                Showing the newest {sendPilot.leadReviews.length} of {sendPilot.leadReviewCount}.
              </p>
            ) : null}
          </div>
        ) : null}

        {sendPilot?.connected && sendPilot.webhookConfigured ? (
          <div className="mt-4 rounded-lg border border-moss/40 bg-moss/[0.05] p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-bone">Map LiveCoach campaigns to SendPilot</p>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
                  This mapping is private to this salesperson. A prospect is added only after
                  they confirm that exact LinkedIn handoff in Outreach. SendPilot then owns
                  delivery while LiveCoach receives the resulting activity.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  void crmFetch<SendPilotCampaignConfiguration>(
                    "/api/crm/sendpilot/campaigns"
                  )
                    .then((configuration) => {
                      setSendPilotCampaigns(configuration);
                      setSendPilotNote("SendPilot campaigns refreshed.");
                    })
                    .catch((error: any) =>
                      setSendPilotError(
                        error?.message || "SendPilot campaigns could not be refreshed."
                      )
                    )
                }
                disabled={!!sendPilotMappingBusy}
                className="min-h-10 shrink-0 rounded-full border border-moss/50 bg-moss/10 px-4 font-mono text-[0.56rem] uppercase text-moss disabled:opacity-40"
              >
                Refresh campaigns
              </button>
            </div>
            {sendPilotCampaigns?.livecoachCampaigns?.length ? (
              <div className="mt-3 space-y-2">
                {sendPilotCampaigns.livecoachCampaigns.map((campaign) => {
                  const mapping = sendPilotCampaigns.mappings.find(
                    (candidate) => candidate.livecoach_campaign_id === campaign.id
                  );
                  return (
                    <label
                      key={campaign.id}
                      className="grid gap-2 rounded-lg border border-edge bg-ink/35 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,1fr)] sm:items-center"
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-bone">{campaign.name}</strong>
                        <span className="mt-0.5 block font-mono text-[0.5rem] uppercase text-muted">
                          LiveCoach {campaign.status} · max {campaign.daily_limit} handoffs daily
                        </span>
                      </span>
                      <select
                        aria-label={`SendPilot campaign for ${campaign.name}`}
                        value={mapping?.active ? mapping.sendpilot_campaign_id : ""}
                        onChange={(event) =>
                          void saveSendPilotCampaignLink(campaign.id, event.target.value)
                        }
                        disabled={!!sendPilotMappingBusy || campaign.status !== "active"}
                        className="min-h-11 w-full rounded-lg border border-edge bg-ink px-3 text-xs text-bone outline-none disabled:opacity-45"
                      >
                        <option value="">Do not hand off to SendPilot</option>
                        {(sendPilotCampaigns.campaigns || []).map((remote) => (
                          <option
                            key={remote.id}
                            value={remote.id}
                            disabled={remote.status !== "started"}
                          >
                            {remote.name} · {remote.status}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-edge bg-ink/30 p-3 text-xs leading-5 text-muted">
                No LiveCoach campaigns are available to map. Refresh after creating or sharing
                an outreach campaign.
              </p>
            )}
            <p className="mt-3 text-xs leading-5 text-amber">
              A paused or draft SendPilot campaign cannot receive LiveCoach leads. LiveCoach
              also rechecks assignment, replies, suppressions, CRM relationship and the 30 day
              campaign pause immediately before each handoff.
            </p>
          </div>
        ) : null}
      </div>

      <div
        id="linkedin-inbox"
        className={`mb-5 rounded-xl border p-5 ${
          linkedinInbox?.active
            ? "border-moss/45 bg-moss/[0.06]"
            : "border-amber/40 bg-amber/[0.05]"
        }`}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p
              className={`font-mono text-[0.62rem] uppercase tracking-[0.2em] ${
                linkedinInbox?.active ? "text-moss" : "text-amber"
              }`}
            >
              {linkedinInbox?.active ? "✓" : "◇"} Fallback local LinkedIn capture
            </p>
            <p className="mt-2 text-sm leading-6 text-bone">
              Keep this as a manual fallback if SendPilot is unavailable. It pulls recent
              inbound messages without giving LiveCoach your LinkedIn password or session
              cookies.
            </p>
            <p className="mt-2 text-xs leading-5 text-moss">
              The first sync and every later sync are limited to the previous 14 days.
              Anything older is rejected by LiveCoach.
            </p>
            <p className="mt-2 text-xs leading-5 text-muted">
              This is separate from LinkedIn&apos;s approved API connection. It runs only when
              you press Sync in your own signed-in Chrome tab. It cannot send messages,
              connect, like or post. LinkedIn explicitly says browser extensions that scrape
              or automate its website violate its User Agreement and can lead to account
              restriction. Opening a conversation can also mark it as read. Read LinkedIn&apos;s{" "}
              <a
                href="https://www.linkedin.com/help/linkedin/answer/a1341387"
                target="_blank"
                rel="noreferrer"
                className="text-rust underline decoration-rust/50 underline-offset-2"
              >
                prohibited software guidance
              </a>
              .
            </p>
            <div className="mt-3 grid gap-2 text-xs leading-5 text-muted sm:grid-cols-3">
              <div className="rounded-lg border border-edge bg-ink/35 p-3">
                <strong className="block text-bone">Hard limit</strong>
                Up to {linkedinInbox?.maxConversations || 10} recent conversations per run
                and 500 new messages per 24 hours.
              </div>
              <div className="rounded-lg border border-edge bg-ink/35 p-3">
                <strong className="block text-bone">Clean matching</strong>
                Exact LinkedIn identity matches only. No fuzzy company creation.
              </div>
              <div className="rounded-lg border border-edge bg-ink/35 p-3">
                <strong className="block text-bone">Fail closed</strong>
                The capture stops if LinkedIn shows a challenge or changes the expected layout.
              </div>
            </div>
            {linkedinInboxLoaded && linkedinInbox ? (
              <p className="mt-3 font-mono text-[0.56rem] uppercase leading-5 text-muted">
                {linkedinInbox.active
                  ? `Active key ending ${linkedinInbox.tokenLastFour || "unknown"} · ${linkedinInbox.browserBound ? "bound to this Chrome connector" : "not yet used"}`
                  : "No active local connector key"}
                {linkedinInbox.lastSuccessAt
                  ? ` · last sync ${new Date(linkedinInbox.lastSuccessAt).toLocaleString("en-GB")}`
                  : ""}
                {linkedinInbox.importedMessageCount
                  ? ` · ${linkedinInbox.importedMessageCount} imported`
                  : ""}
                {linkedinInbox.reviewCount
                  ? ` · ${linkedinInbox.reviewCount} need review`
                  : ""}
              </p>
            ) : !linkedinInboxLoaded ? (
              <p className="mt-3 font-mono text-[0.56rem] uppercase text-muted">
                Checking connector status…
              </p>
            ) : null}
            {linkedinInbox?.lastError ? (
              <p className="mt-2 text-xs leading-5 text-rust">
                Last sync did not complete. {linkedinInbox.lastError}
              </p>
            ) : null}
            {linkedinInboxNote ? (
              <p aria-live="polite" className="mt-2 text-xs leading-5 text-moss">
                {linkedinInboxNote}
              </p>
            ) : null}
            {linkedinInboxError ? (
              <p role="alert" className="mt-2 text-xs leading-5 text-rust">
                {linkedinInboxError}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <a
              href="/downloads/livecoach-linkedin-inbox-connector.zip"
              download
              className="inline-flex min-h-10 items-center rounded-full border border-sky/55 bg-sky/10 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-sky transition hover:bg-sky/20"
            >
              Download connector
            </a>
            <button
              type="button"
              onClick={() => void createLinkedInInboxKey(!!linkedinInbox?.active)}
              disabled={linkedinInboxBusy || !linkedinInboxLoaded}
              className="min-h-10 rounded-full border border-amber/60 bg-amber/15 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
            >
              {linkedinInboxBusy
                ? "Saving…"
                : linkedinInbox?.active
                  ? "Replace key"
                  : "Create inbox key"}
            </button>
            {linkedinInbox?.active ? (
              <button
                type="button"
                onClick={() => void revokeLinkedInInboxKey()}
                disabled={linkedinInboxBusy}
                className="min-h-10 rounded-full border border-rust/50 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-rust transition hover:bg-rust/10 disabled:opacity-40"
              >
                Revoke
              </button>
            ) : null}
          </div>
        </div>

        {linkedinInboxToken ? (
          <div className="mt-4 rounded-lg border border-amber/45 bg-ink/50 p-3">
            <p className="text-xs leading-5 text-amber">
              Copy this key now. LiveCoach stores only its hash and cannot show it again.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={linkedinInboxToken}
                aria-label="LinkedIn inbox connector key"
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-edge bg-ink px-3 font-mono text-xs text-bone outline-none"
              />
              <button
                type="button"
                onClick={() => void copyLinkedInInboxKey()}
                className="min-h-11 rounded-lg border border-moss/50 bg-moss/10 px-4 font-mono text-[0.56rem] uppercase text-moss"
              >
                Copy key
              </button>
            </div>
          </div>
        ) : null}

        <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs leading-5 text-muted marker:text-amber">
          <li>Download and unzip the connector, then load the folder in Chrome extensions.</li>
          <li>Create a one-time inbox key here and paste it into the connector.</li>
          <li>Open your main LinkedIn Messaging inbox, then press Sync recent messages.</li>
          <li>Review unmatched people in Sales Desk. Their contact is saved without inventing a company.</li>
        </ol>
      </div>

      <div className="rounded-xl border border-amber/40 bg-amber/[0.05] p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber">
            {"◆"} Your brain{" "}
            <span className="text-muted">- context the AI uses everywhere</span>
          </p>
          <div className="flex items-center gap-3">
            {savedAt && !saveErr && (
              <span className="font-mono text-[0.56rem] uppercase tracking-wider text-sage">
                ✓ saved to database {savedAt}
              </span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-full border border-amber/60 bg-amber/15 px-5 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
            >
              {saving ? "saving…" : "save"}
            </button>
          </div>
        </div>
        {saveErr && (
          <p className="mb-2 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 font-mono text-[0.62rem] leading-relaxed text-rust">
            {saveErr}
          </p>
        )}
        <p className="mb-3 font-mono text-[0.6rem] leading-relaxed text-muted">
          Who you are, your company, your products, how you sell, your goals.
          This is fed into every AI pass - the assistant, building a client from
          context, post-call profiles, your day read, and live-call coaching -
          so it always knows what you actually do. Keep it in your own words.
        </p>
        <textarea
          value={knowledge}
          onChange={(e) => {
            touchedRef.current = true;
            setKnowledge(e.target.value);
          }}
          rows={20}
          placeholder={
            loaded
              ? "Tell the AI about you and your business…"
              : "loading…"
          }
          className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-4 py-3 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60"
        />
      </div>

      {/* OBJECTION STANCES - the honest, grounded product truth used to build
          call battlecards and coach objection-handling live. Kept separate from
          the brain so it stays a clean, reviewable source of what you do and do
          not claim. Saved by the same Save button up top. */}
      <div className="mt-5 rounded-xl border border-rust/40 bg-rust/[0.05] p-5">
        <p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-rust">
          {"⚑"} Objection stances{" "}
          <span className="text-muted">- your honest answers to the hard questions</span>
        </p>
        <p className="mb-3 font-mono text-[0.6rem] leading-relaxed text-muted">
          The real truth about what your product does and does not do, and where
          you are genuinely weak. This grounds the objection-handling in your
          battlecards and the live prepared responses, so the AI never invents an
          audit, a number or a claim you cannot stand behind. Where a line says
          CONFIRM, fill in the real answer or leave it flagged so it stays honest.
          Saved with the Save button at the top.
        </p>
        <textarea
          value={objectionStances}
          onChange={(e) => {
            objTouchedRef.current = true;
            setObjectionStances(e.target.value);
          }}
          rows={16}
          placeholder={
            loaded
              ? "The objections that come up, and your honest, grounded answer to each…"
              : "loading…"
          }
          className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-4 py-3 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-rust/60"
        />
      </div>

      {/* LESSONS LIBRARY - the skills layer (negotiation, psychology, strategy)
          the AI applies. Paste a transcript/article and it distils the durable
          lessons. */}
      <div className="mt-5 rounded-xl border border-sky/40 bg-sky/[0.05] p-5">
        <p className="mb-1 font-mono text-[0.62rem] uppercase tracking-[0.2em] text-sky">
          {"✦"} Lessons library{" "}
          <span className="text-muted">- teach it negotiation, psychology, strategy</span>
        </p>
        <p className="mb-3 font-mono text-[0.6rem] leading-relaxed text-muted">
          Paste a video transcript or article, pick the topic, and it distils
          the durable, reusable lessons. The AI then applies the right ones when
          coaching calls, reading people, and planning your next move. (Tip:
          YouTube → “Show transcript” → copy → paste here.)
        </p>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <select
            value={lTopic}
            onChange={(e) => setLTopic(e.target.value)}
            className="rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider text-bone outline-none focus:border-sky/60"
          >
            {TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            value={lYt}
            onChange={(e) => setLYt(e.target.value)}
            placeholder="Paste a YouTube link to fetch automatically…"
            className="min-w-[220px] flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.7rem] text-bone outline-none placeholder:text-muted/50 focus:border-sky/60"
          />
          <button
            type="button"
            onClick={distilYt}
            disabled={distilling}
            className="rounded-full border border-sky/60 bg-sky/15 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
          >
            {distilling ? "fetching…" : "fetch from youtube"}
          </button>
        </div>
        <p className="mb-2 font-mono text-[0.56rem] uppercase tracking-wider text-muted">
          or paste a transcript / article below
        </p>
        <input
          value={lSource}
          onChange={(e) => setLSource(e.target.value)}
          placeholder="Source link (optional)"
          className="mb-2 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-mono text-[0.7rem] text-bone outline-none placeholder:text-muted/50 focus:border-sky/60"
        />
        <textarea
          value={lContent}
          onChange={(e) => setLContent(e.target.value)}
          rows={6}
          placeholder="Paste the transcript or article text here…"
          className="w-full resize-y rounded-lg border border-edge bg-ink/60 px-4 py-3 font-sans text-sm leading-relaxed text-bone outline-none transition placeholder:text-muted/50 focus:border-sky/60"
        />
        {lErr && (
          <p className="mt-1.5 font-mono text-[0.6rem] text-rust">{lErr}</p>
        )}
        <button
          type="button"
          onClick={distil}
          disabled={distilling}
          className="mt-2 rounded-full border border-sky/60 bg-sky/15 px-5 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40"
        >
          {distilling ? "distilling…" : "distil & save"}
        </button>

        {lessons.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2">
            {lessons.map((l) => (
              <li
                key={l.id}
                className="rounded-lg border border-edge bg-ink/40 px-4 py-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.56rem] uppercase tracking-wider text-sky">
                    {l.topic}
                    {l.title ? ` · ${l.title}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteLesson(l.id)}
                    aria-label="delete lesson"
                    className="font-mono text-[0.7rem] text-muted transition hover:text-rust"
                  >
                    ✕
                  </button>
                </div>
                <p className="whitespace-pre-wrap font-sans text-[0.82rem] leading-relaxed text-bone/85">
                  {l.content}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NavMenu />
    </main>
  );
}
