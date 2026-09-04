"use client";

import { useEffect, useRef, useState } from "react";

import { crmConfirmationError, crmFetch } from "@/lib/crm";
import {
  foldDictationEvent,
  stabiliseLiveDictationPreview,
} from "@/lib/dictation";

type Recipient = {
  email: string;
  name: string;
  source: "inbound" | "prospect" | "contact";
};

type Draft = {
  id: string;
  source_thread_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  draft_subject: string;
  draft_body: string;
  intent: string;
  status: string;
  last_error: string | null;
  sent_at: string | null;
};

type Workspace = {
  ok: boolean;
  recipients: Recipient[];
  selectedRecipientEmail: string | null;
  draft: Draft | null;
  capabilities: {
    mailboxConnected: boolean;
    rehearsalReady: boolean;
    mailboxEmail: string | null;
    provider: "google" | "microsoft" | null;
  };
};

const field =
  "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-bone outline-none placeholder:text-muted/55 focus:border-sky/60 disabled:opacity-55";
const secondaryButton =
  "min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:border-sky/45 hover:text-sky disabled:cursor-wait disabled:opacity-40";

export default function TaskEmailComposer({
  taskId,
  taskText,
  onClose,
  onSent,
}: {
  taskId: string;
  taskText: string;
  onClose: () => void;
  onSent: (draft: Draft) => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"" | "draft" | "save" | "send">("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [intent, setIntent] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [mailboxConnected, setMailboxConnected] = useState(false);
  const [sendReady, setSendReady] = useState(false);
  const [mailboxEmail, setMailboxEmail] = useState("");
  const [provider, setProvider] = useState<"google" | "microsoft" | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const recognitionRef = useRef<any>(null);
  const keepListeningRef = useRef(false);
  const intentRef = useRef("");
  const dictationBaseRef = useRef("");
  const dictationPreviewRef = useRef("");
  const draftLocked = Boolean(
    draft && ["approving", "handed_off", "sending", "sent"].includes(draft.status)
  );
  const sourceReply = Boolean(draft?.source_thread_id);

  useEffect(() => {
    intentRef.current = intent;
  }, [intent]);

  const applyDraft = (next: Draft | null) => {
    setDraft(next);
    setSubject(next?.draft_subject || "");
    setBody(next?.draft_body || "");
    if (next?.intent) setIntent(next.intent);
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void crmFetch<Workspace>(`/api/crm/tasks/${taskId}/email`)
      .then((result) => {
        if (!alive) return;
        setRecipients(result.recipients || []);
        setRecipientEmail(result.selectedRecipientEmail || "");
        setMailboxConnected(result.capabilities?.mailboxConnected === true);
        setSendReady(result.capabilities?.rehearsalReady === true);
        setMailboxEmail(result.capabilities?.mailboxEmail || "");
        setProvider(result.capabilities?.provider || null);
        applyDraft(result.draft || null);
      })
      .catch((reason: any) => {
        if (alive) setError(reason?.message || "This email task could not be opened.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  useEffect(
    () => () => {
      keepListeningRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {
        // Recognition may already have ended.
      }
    },
    []
  );

  const stopVoice = () => {
    keepListeningRef.current = false;
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    try {
      recognition?.stop();
    } catch {
      // Recognition may already have ended.
    }
  };

  const startVoice = () => {
    const SpeechRecognition =
      (window as any).webkitSpeechRecognition ||
      (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice input needs Chrome, Edge, or another Chromium browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-GB";
    recognition.interimResults = true;
    recognition.continuous = true;
    dictationBaseRef.current = intentRef.current.trim()
      ? `${intentRef.current.trim()} `
      : "";
    dictationPreviewRef.current = intentRef.current.trim();
    let committed = "";
    recognition.onresult = (event: any) => {
      const folded = foldDictationEvent(committed, event.results);
      committed = folded.committed;
      let hasNewFinal = false;
      for (let index = 0; index < (event.results?.length || 0); index += 1) {
        if (event.results[index]?.isFinal) hasNewFinal = true;
      }
      const combined = `${dictationBaseRef.current}${folded.text}`.trim();
      const stable = stabiliseLiveDictationPreview(
        dictationPreviewRef.current,
        combined,
        hasNewFinal
      );
      dictationPreviewRef.current = stable;
      setIntent(stable);
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      if (keepListeningRef.current) {
        window.setTimeout(() => {
          if (keepListeningRef.current && !recognitionRef.current) startVoice();
        }, 100);
      } else {
        setListening(false);
      }
    };
    recognition.onerror = (event: any) => {
      if (event?.error === "aborted" || event?.error === "no-speech") return;
      keepListeningRef.current = false;
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
      setError("I could not hear that clearly. Tap the microphone and try again.");
    };
    recognitionRef.current = recognition;
    keepListeningRef.current = true;
    setListening(true);
    setError("");
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      keepListeningRef.current = false;
      setListening(false);
      setError("The microphone could not start. Tap it once more to try again.");
    }
  };

  const toggleVoice = () => {
    if (listening || recognitionRef.current) stopVoice();
    else startVoice();
  };

  const optimise = async () => {
    if (working || draftLocked) return;
    if (!recipientEmail) {
      setError(
        recipients.length
          ? "Choose who should receive this email."
          : "Add an exact email address to this client or prospect first."
      );
      return;
    }
    if (intent.trim().length < 3) {
      setError("Say or type what you want the email to achieve.");
      return;
    }
    stopVoice();
    setWorking("draft");
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean; draft: Draft }>(
        `/api/crm/tasks/${taskId}/email`,
        {
          method: "POST",
          body: JSON.stringify({
            recipient_email: recipientEmail,
            intent: intent.trim(),
          }),
        }
      );
      if (!result.ok || !result.draft?.id) {
        throw crmConfirmationError({
          url: `/api/crm/tasks/${taskId}/email`,
          method: "POST",
          reason: "LiveCoach did not confirm the optimised email",
        });
      }
      applyDraft(result.draft);
      setNotice("Draft ready. Check the exact recipient, subject, and wording before sending.");
    } catch (reason: any) {
      setError(reason?.message || "This task email could not be optimised.");
    } finally {
      setWorking("");
    }
  };

  const save = async (): Promise<Draft | null> => {
    if (!draft?.id) return null;
    if (draftLocked) {
      setError(
        draft.status === "sent"
          ? "This email has already been sent."
          : "This email is already being actioned. Refresh the task before changing it."
      );
      return null;
    }
    const exactSubject = subject.trim();
    const exactBody = body.trim();
    if (!exactSubject || !exactBody) {
      setError("Check that both the subject and email body are complete.");
      return null;
    }
    const result = await crmFetch<{ ok: boolean; draft: Draft }>(
      `/api/crm/email-assistant/drafts/${draft.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ subject: exactSubject, body: exactBody }),
      }
    );
    if (!result.ok || !result.draft?.id) {
      throw crmConfirmationError({
        url: `/api/crm/email-assistant/drafts/${draft.id}`,
        method: "PATCH",
        reason: "LiveCoach did not confirm the edited email",
      });
    }
    applyDraft(result.draft);
    return result.draft;
  };

  const saveOnly = async () => {
    if (working) return;
    setWorking("save");
    setError("");
    setNotice("");
    try {
      const saved = await save();
      if (saved) setNotice("Draft saved. Nothing has been sent.");
    } catch (reason: any) {
      setError(reason?.message || "The task email did not save.");
    } finally {
      setWorking("");
    }
  };

  const approveAndSend = async () => {
    if (working || !draft?.id) return;
    setWorking("send");
    setError("");
    setNotice("");
    try {
      const saved = await save();
      if (!saved) return;
      const result = await crmFetch<{
        ok: boolean;
        draft: Draft;
        alreadySent: boolean;
      }>(`/api/crm/email-assistant/drafts/${saved.id}/send`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!result.ok || result.draft?.status !== "sent") {
        throw crmConfirmationError({
          url: `/api/crm/email-assistant/drafts/${saved.id}/send`,
          method: "POST",
          reason: "The mailbox did not confirm this email as sent",
        });
      }
      applyDraft(result.draft);
      await onSent(result.draft);
    } catch (reason: any) {
      setError(reason?.message || "This email was not sent.");
    } finally {
      setWorking("");
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-sky/40 bg-sky/[0.045] p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.54rem] uppercase tracking-[0.15em] text-sky">
            Speak the email intent
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            Say what you want to communicate. LiveCoach will shape it in your saved email tone. You review the exact email before anything is sent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            stopVoice();
            onClose();
          }}
          disabled={Boolean(working)}
          className={secondaryButton}
        >
          Close
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-muted">Opening the private email workspace…</p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(12rem,.65fr)_minmax(0,1.35fr)]">
            <label>
              <span className="mb-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                Send to
              </span>
              <select
                value={recipientEmail}
                onChange={(event) => {
                  setRecipientEmail(event.target.value);
                  setError("");
                }}
                disabled={Boolean(draft) || Boolean(working)}
                className={field}
              >
                <option value="">
                  {recipients.length ? "Choose the exact person" : "No saved email found"}
                </option>
                {recipients.map((recipient) => (
                  <option key={recipient.email} value={recipient.email}>
                    {recipient.name} · {recipient.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                What do you want to say or achieve
              </span>
              <div className="flex items-stretch gap-2">
                <textarea
                  value={intent}
                  onChange={(event) => {
                    setIntent(event.target.value);
                    setError("");
                  }}
                  rows={listening ? 4 : 3}
                  maxLength={1_000}
                  disabled={draftLocked}
                  placeholder={
                    listening
                      ? "Listening… speak naturally"
                      : "For example, thank her for the update, answer the question, and suggest a call next Tuesday"
                  }
                  className={`${field} resize-y leading-5 ${listening ? "border-rust/65" : ""}`}
                />
                <button
                  type="button"
                  onClick={toggleVoice}
                  disabled={Boolean(working) || draftLocked}
                  aria-label={listening ? "Stop email intent dictation" : "Speak email intent"}
                  aria-pressed={listening}
                  className={`flex min-w-12 items-center justify-center rounded-lg border px-3 font-mono text-[0.55rem] uppercase transition disabled:opacity-40 ${
                    listening
                      ? "border-rust bg-rust/15 text-rust"
                      : "border-sky/50 bg-sky/10 text-sky hover:bg-sky/20"
                  }`}
                >
                  <span aria-hidden="true">{listening ? "■" : "🎤"}</span>
                  <span className="ml-2 hidden sm:inline">
                    {listening ? "Stop" : "Speak"}
                  </span>
                </button>
              </div>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {mailboxConnected
                ? `${provider === "microsoft" ? "Microsoft" : "Google"} mailbox · ${mailboxEmail}`
                : "Connect your own mailbox in Settings before drafting"}
            </p>
            <button
              type="button"
              onClick={() => void optimise()}
              disabled={
                Boolean(working) ||
                draftLocked ||
                !mailboxConnected ||
                recipients.length === 0
              }
              className="min-h-10 rounded-lg border border-sky/55 bg-sky/10 px-4 font-mono text-[0.55rem] uppercase tracking-wider text-sky transition hover:bg-sky/20 disabled:cursor-wait disabled:opacity-40"
            >
              {working === "draft"
                ? "Optimising…"
                : draft
                  ? "Optimise again"
                  : "Optimise email"}
            </button>
          </div>

          {draft ? (
            <div className="mt-4 rounded-xl border border-edge bg-ink/45 p-3">
              <div className="grid gap-3">
                <label>
                  <span className="mb-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                    Subject
                  </span>
                  <input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    maxLength={240}
                    disabled={Boolean(working) || draftLocked || sourceReply}
                    className={field}
                  />
                  {sourceReply ? (
                    <span className="mt-1 block text-[0.68rem] leading-5 text-muted">
                      The subject stays fixed so Gmail or Outlook keeps this reply in the original conversation.
                    </span>
                  ) : null}
                </label>
                <label>
                  <span className="mb-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                    Email
                  </span>
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={9}
                    maxLength={10_000}
                    disabled={Boolean(working) || draftLocked}
                    className={`${field} resize-y leading-6`}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-xl text-xs leading-5 text-muted">
                  {draft.status === "sent"
                    ? "Sent from your connected mailbox. The task is complete everywhere."
                    : draftLocked
                      ? "This email is already being actioned. Refresh the task before doing anything else."
                      : sendReady
                        ? `Approve and send delivers this exact version now from ${mailboxEmail}. It then completes the task everywhere.`
                        : "Reconnect your mailbox with email send permission before approving this draft."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveOnly()}
                    disabled={Boolean(working) || draftLocked}
                    className={secondaryButton}
                  >
                    {working === "save" ? "Saving…" : "Save draft"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void approveAndSend()}
                    disabled={Boolean(working) || !sendReady || draftLocked}
                    className="min-h-10 rounded-lg border border-sage/60 bg-sage/15 px-4 font-mono text-[0.55rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 disabled:cursor-wait disabled:opacity-40"
                  >
                    {working === "send" ? "Sending…" : "Approve and send"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}

      {notice ? (
        <p role="status" className="mt-3 rounded-lg border border-sage/35 bg-sage/10 px-3 py-2 text-sm text-sage">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm leading-6 text-rust">
          {error}
        </p>
      ) : null}
      {!loading && recipients.length === 0 && !error ? (
        <p role="alert" className="mt-3 rounded-lg border border-amber/45 bg-amber/10 px-3 py-2 text-sm leading-6 text-amber">
          No exact email address is saved for this task. Add the person’s email to the client or assigned prospect, then reopen the task.
        </p>
      ) : null}
      <p className="mt-3 font-mono text-[0.48rem] uppercase tracking-wider text-muted">
        One task · one exact recipient · one explicit send approval
      </p>
      <span className="sr-only">Task email for {taskText}</span>
    </div>
  );
}
