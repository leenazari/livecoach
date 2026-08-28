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
    gmailIssue?: GmailIssue;
  } | null>(null);
  const [gcalNote, setGcalNote] = useState("");
  const [microsoft, setMicrosoft] = useState<{
    status: "ok" | "missing" | "disconnected";
    email: string | null;
    mailRead: boolean;
    mailSend: boolean;
    calendar: boolean;
    configured: boolean;
  } | null>(null);
  const [microsoftNote, setMicrosoftNote] = useState("");
  const [linkedin, setLinkedin] = useState<LinkedInStatus | null>(null);
  const [linkedinNote, setLinkedinNote] = useState("");
  const [linkedinDisconnecting, setLinkedinDisconnecting] = useState(false);
  const [linkedinDisconnectConfirm, setLinkedinDisconnectConfirm] = useState(false);
  const [linkedinDisconnectError, setLinkedinDisconnectError] = useState("");
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
    crmFetch<{ connected: boolean; email: string | null; configured: boolean; gmail?: "ok" | "missing" | "disconnected"; gmailSend?: boolean; gmailIssue?: GmailIssue }>(
      "/api/auth/google/status"
    )
      .then((d) => setGcal(d))
      .catch(() => {});
    crmFetch<{
      status: "ok" | "missing" | "disconnected";
      email: string | null;
      mailRead: boolean;
      mailSend: boolean;
      calendar: boolean;
      configured: boolean;
    }>("/api/auth/microsoft/status")
      .then((d) => setMicrosoft(d))
      .catch(() => {});
    crmFetch<LinkedInStatus>("/api/auth/linkedin/status")
      .then((d) => setLinkedin(d))
      .catch(() => {});
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
            : gcal.connected
              ? "border-sage/45 bg-sage/[0.06]"
              : "border-rust/50 bg-rust/[0.07]"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p
              className={`font-mono text-[0.62rem] uppercase tracking-[0.2em] ${
                gcal === null
                  ? "text-muted"
                  : gcal.connected
                    ? "text-sage"
                    : "text-rust"
              }`}
            >
              {gcal === null
                ? "◷"
                : gcal.connected
                  ? "✓"
                  : "!"} Google connection
            </p>
            <p className="mt-1 font-mono text-[0.6rem] leading-relaxed text-muted">
              {gcal === null
                ? "Checking the live connection…"
                : gcal.connected
                ? `Connected${
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
              <span className="rounded-full border border-sage/55 bg-sage/10 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-sage">
                ● Google connected
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
            : microsoft.status === "ok"
              ? "border-sky/45 bg-sky/[0.06]"
              : microsoft.status === "missing"
                ? "border-amber/45 bg-amber/[0.06]"
                : "border-edge bg-panel/40"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className={`font-mono text-[0.62rem] uppercase tracking-[0.2em] ${microsoft?.status === "ok" ? "text-sky" : microsoft?.status === "missing" ? "text-amber" : "text-muted"}`}>
              {microsoft === null ? "◷" : microsoft.status === "ok" ? "✓" : microsoft.status === "missing" ? "!" : "○"} Microsoft connection
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {microsoft === null
                ? "Checking the live connection…"
                : microsoft.status === "ok"
                  ? `Connected${microsoft.email ? ` as ${microsoft.email}` : ""}. Outlook email and Microsoft Calendar belong only to this LiveCoach account.`
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
              <span className={`rounded-full border px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider ${microsoft.status === "ok" ? "border-sky/55 bg-sky/10 text-sky" : "border-amber/55 bg-amber/10 text-amber"}`}>
                {microsoft.status === "ok" ? "● Microsoft connected" : "! Microsoft needs attention"}
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
              LiveCoach does not scrape LinkedIn. Messages and connection requests remain manual. Connecting never gives another salesperson access to this account and never publishes anything automatically.
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
