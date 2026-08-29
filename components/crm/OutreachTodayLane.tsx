"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MatrixRain from "@/components/MatrixRain";
import CanonicalRecordLink from "@/components/crm/CanonicalRecordLink";
import OutreachVoiceNoteEditor from "@/components/crm/OutreachVoiceNoteEditor";
import { crmFetch } from "@/lib/crm";
import { outreachProspectHref } from "@/lib/crm-navigation";
import { prepareOutreachVoiceScriptForReview } from "@/lib/outreach-voice-policy";
import type { WorkInboxItem } from "@/lib/work-inbox";

type PrepareStatus = "queued" | "researching" | "done" | "error";

type Recommendation = {
  action?: "contact_today" | "hold" | "skip";
  label?: string;
  score?: number;
  confidence?: string;
  reasons?: string[];
  risks?: string[];
};

type SavedResearch = {
  summary?: string;
  companyOverview?: string;
  companyOverviewUrl?: string | null;
  signals?: string[];
  activeJobs?: string[];
  jobBoardUrl?: string | null;
  jobSignals?: Array<{
    role: string;
    location?: string;
    compensation?: string;
    recency?: string;
    sourceUrl: string;
  }>;
  likelyNeeds?: string[];
  bestAngle?: string;
  personalisationFact?: string;
  fitDecision?: string;
  confidence?: string;
  generatedAt?: string | null;
};

type OutreachMessage = {
  id: string;
  status: string;
  step_number?: number;
  from_email?: string;
  subject?: string;
  body_text?: string;
  approved_at?: string | null;
  scheduled_at?: string | null;
  sent_at?: string | null;
  updated_at?: string | null;
  error?: string | null;
  voice_script?: string | null;
  voice_status?: string | null;
  voice_audio_path?: string | null;
  voice_public_token?: string | null;
  voice_estimated_seconds?: number | null;
  voice_generated_at?: string | null;
  voice_error?: string | null;
  voice_script_approved_at?: string | null;
  voice_script_approved_by?: string | null;
  voice_script_approved_hash?: string | null;
};

type QueueRow = {
  id: string;
  status: string;
  current_step?: number;
  queueKind?: "new_contact" | "follow_up";
  prospect: {
    id: string;
    crm_company_id?: string | null;
    first_name?: string;
    last_name?: string;
    job_title?: string;
    company_name?: string;
    company_domain?: string;
    website?: string;
    email?: string;
  };
  campaign?: { name?: string; daily_limit?: number };
  message?: OutreachMessage | null;
  lastSentMessage?: OutreachMessage | null;
  messageHistory?: OutreachMessage[];
  savedResearch?: SavedResearch;
  researchSourceCount?: number;
  recommendation?: Recommendation;
};

type QueueResponse = {
  queue?: QueueRow[];
  added?: number;
  selection?: {
    held?: number;
    skipped?: number;
    firstTouches?: number;
    followUps?: number;
  };
  sender?: {
    senderName?: string;
    senderEmail?: string;
    mailboxEmail?: string;
    provider?: "google" | "microsoft";
  } | null;
};

const PREPARE_QUEUE_KEY = "livecoach:sales-today-prepare-queue:v1";
const MAX_CONCURRENT_RESEARCH = 2;
const DAILY_QUEUE_TARGET = 20;

const safeExternalUrl = (value: unknown) => {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
};

type DraftEdit = { subject: string; body: string; voiceScript: string };
type ReplyAction = { text: string; dueAt: string };

const button =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-edge px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:border-amber/55 hover:text-amber disabled:cursor-not-allowed disabled:opacity-40";
const primary =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-amber/55 bg-amber/10 px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-not-allowed disabled:opacity-40";

const rowState = (row: QueueRow) => {
  if (row.message?.status === "approved" && row.message.scheduled_at)
    return { label: "Scheduled", style: "border-sky/45 bg-sky/10 text-sky" };
  if (row.message?.status === "approved")
    return { label: "Approved", style: "border-moss/45 bg-moss/10 text-moss" };
  if (row.message && ["draft", "failed"].includes(row.message.status))
    return { label: "Draft ready", style: "border-amber/45 bg-amber/10 text-amber" };
  if (!row.message && row.status === "queued" && Number(row.current_step) > 1)
    return { label: "Follow up due", style: "border-amber/45 bg-amber/10 text-amber" };
  if (row.message?.status === "sent" || row.lastSentMessage)
    return { label: "Sent", style: "border-moss/45 bg-moss/10 text-moss" };
  if (["replied", "booked"].includes(row.status))
    return { label: row.status === "booked" ? "Meeting booked" : "Replied", style: "border-moss/45 bg-moss/10 text-moss" };
  return { label: "Not prepared", style: "border-edge bg-ink/40 text-muted" };
};

const hasBeenSent = (row: QueueRow) =>
  row.message?.status === "sent" || Boolean(row.lastSentMessage);

const isActionableQueueRow = (row: QueueRow) => {
  if (["replied", "booked"].includes(row.status)) return false;
  if (row.message?.status === "approved" && row.message.scheduled_at) return false;
  if (row.message?.status === "sent") return false;
  return Boolean(
    (!row.message && row.status === "queued") ||
      (row.message && ["draft", "failed", "approved"].includes(row.message.status))
  );
};

const queueActionRank = (row: QueueRow) => {
  if (row.message && ["draft", "failed"].includes(row.message.status)) return 0;
  if (row.message?.status === "approved" && !row.message.scheduled_at) return 1;
  if (!row.message && row.status === "queued") return 2;
  if (row.message?.status === "approved" && row.message.scheduled_at) return 3;
  if (hasBeenSent(row)) return 5;
  return 4;
};

const queueWaveRank = (row: QueueRow) =>
  row.queueKind === "follow_up" || hasBeenSent(row) ? 1 : 0;

const displayMessageFor = (row: QueueRow) =>
  row.message && row.message.status !== "cancelled"
    ? row.message
    : row.lastSentMessage || row.messageHistory?.[0] || row.message || null;

const formatHistoryDate = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const deliveryStageFor = (message: OutreachMessage) => {
  if (message.status === "sent") return 3;
  if (message.scheduled_at) return 2;
  if (message.status === "approved") return 1;
  return 0;
};

const londonDateInput = (daysFromNow = 1) => {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const replyActionDefault = (item: WorkInboxItem): ReplyAction => {
  const subject =
    item.outreach?.person ||
    item.title
      .replace(/^Review CRM handover for\s+/i, "")
      .replace(/^Reply to\s+/i, "")
      .replace(/\s+replied positively$/i, "")
      .trim();
  return {
    text: `Confirm the next meeting step with ${subject || item.company || "the prospect"} following their positive reply`,
    dueAt: londonDateInput(1),
  };
};

const replyMessageFromItem = (item: WorkInboxItem): OutreachMessage | null => {
  const context = item.outreach;
  if (!context?.messageId) return null;
  return {
    id: context.messageId,
    status: context.messageStatus || "draft",
    step_number: 10,
    subject: context.draftSubject || "",
    body_text: context.draftBody || "",
    updated_at: item.createdAt,
  };
};

const replyAge = (value?: string | null) => {
  if (!value) return { label: "Reply time unavailable", urgent: false };
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0)
    return { label: "Just replied", urgent: false };
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60)
    return { label: `Waiting ${minutes} min`, urgent: false };
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return {
      label: `Waiting ${hours} hr${hours === 1 ? "" : "s"}`,
      urgent: hours >= 2,
    };
  const days = Math.floor(hours / 24);
  return {
    label: `Waiting ${days} day${days === 1 ? "" : "s"}`,
    urgent: true,
  };
};

export default function OutreachTodayLane({
  onQueueCount,
  replyItems = [],
}: {
  onQueueCount?: (count: number) => void;
  replyItems?: WorkInboxItem[];
}) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [sender, setSender] = useState<QueueResponse["sender"]>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [visible, setVisible] = useState(20);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [prepareJobs, setPrepareJobs] = useState<Record<string, PrepareStatus>>({});
  const [expandedId, setExpandedId] = useState("");
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftEdit>>({});
  const [savingMessageId, setSavingMessageId] = useState("");
  const [rehearsingMessageId, setRehearsingMessageId] = useState("");
  const [generatingVoiceMessageId, setGeneratingVoiceMessageId] = useState("");
  const [showFullQueue, setShowFullQueue] = useState(false);
  const [focusedRowId, setFocusedRowId] = useState("");
  const [deferredRowIds, setDeferredRowIds] = useState<string[]>([]);
  const [replyActions, setReplyActions] = useState<Record<string, ReplyAction>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, OutreachMessage>>({});
  const [preparingReplyId, setPreparingReplyId] = useState("");
  const [handledReplyIds, setHandledReplyIds] = useState<string[]>([]);
  const prepareJobsRef = useRef<Record<string, PrepareStatus>>({});
  const pendingRef = useRef<string[]>([]);
  const activeRef = useRef<Set<string>>(new Set());
  const initialQueueFillAttemptedRef = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await crmFetch<QueueResponse>("/api/crm/outreach/queue");
      let nextQueue = data.queue || [];
      // Entering Sales Today should supply the full free-to-rank worklist. It
      // does not research, draft, approve or send anything automatically.
      if (
        !quiet &&
        !initialQueueFillAttemptedRef.current &&
        nextQueue.length < DAILY_QUEUE_TARGET
      ) {
        initialQueueFillAttemptedRef.current = true;
        try {
          const filled = await crmFetch<QueueResponse>("/api/crm/outreach/queue", {
            method: "POST",
            body: JSON.stringify({ limit: DAILY_QUEUE_TARGET }),
          });
          nextQueue = filled.queue || nextQueue;
        } catch {
          // Preserve the existing queue. The visible Fill queue control still
          // gives the user an explicit retry with the server's error message.
        }
      }
      setQueue(nextQueue);
      setSender(data.sender || null);
      onQueueCount?.(nextQueue.length);
      setError("");
      return nextQueue;
    } catch (err: any) {
      setError(err?.message || "Today's outreach queue could not be loaded.");
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [onQueueCount]);

  const updatePrepareJob = useCallback((prospectId: string, status: PrepareStatus) => {
    setPrepareJobs((current) => {
      const next = { ...current, [prospectId]: status };
      prepareJobsRef.current = next;
      const pending = Object.entries(next)
        .filter(([, value]) => value === "queued")
        .map(([id]) => id);
      window.localStorage.setItem(PREPARE_QUEUE_KEY, JSON.stringify(pending));
      return next;
    });
  }, []);

  const runPrepareQueue = useCallback(() => {
    while (
      activeRef.current.size < MAX_CONCURRENT_RESEARCH &&
      pendingRef.current.length
    ) {
      const prospectId = pendingRef.current.shift();
      if (!prospectId || activeRef.current.has(prospectId)) continue;
      activeRef.current.add(prospectId);
      updatePrepareJob(prospectId, "researching");

      void crmFetch(`/api/crm/outreach/${prospectId}/prepare`, {
        method: "POST",
        body: "{}",
      })
        .then(() => {
          updatePrepareJob(prospectId, "done");
          setNotice("Research and draft completed. Review the exact email before anything is sent.");
          window.dispatchEvent(
            new CustomEvent("lc:tasks-updated", {
              detail: { source: "sales-today-outreach" },
            })
          );
        })
        .catch((err: any) => {
          updatePrepareJob(prospectId, "error");
          setError(err?.message || "That research and draft could not be prepared.");
        })
        .finally(() => {
          activeRef.current.delete(prospectId);
          void load(true).finally(runPrepareQueue);
        });
    }
  }, [load, updatePrepareJob]);

  const enqueuePrepare = useCallback((prospectId: string) => {
    const current = prepareJobsRef.current[prospectId];
    if (current === "queued" || current === "researching") return;
    pendingRef.current.push(prospectId);
    updatePrepareJob(prospectId, "queued");
    setError("");
    setNotice("Added to the research queue. Keep working while it prepares in the background.");
    queueMicrotask(runPrepareQueue);
  }, [runPrepareQueue, updatePrepareJob]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PREPARE_QUEUE_KEY) || "[]");
      if (!Array.isArray(saved)) return;
      for (const prospectId of saved.filter((value) => typeof value === "string")) {
        if (pendingRef.current.includes(prospectId)) continue;
        pendingRef.current.push(prospectId);
        prepareJobsRef.current[prospectId] = "queued";
      }
      if (pendingRef.current.length) {
        setPrepareJobs({ ...prepareJobsRef.current });
        queueMicrotask(runPrepareQueue);
      }
    } catch {
      window.localStorage.removeItem(PREPARE_QUEUE_KEY);
    }
  }, [runPrepareQueue]);

  const buildQueue = async () => {
    if (building) return;
    setBuilding(true);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<QueueResponse>("/api/crm/outreach/queue", {
        method: "POST",
        body: "{}",
      });
      const nextQueue = result.queue || [];
      setQueue(nextQueue);
      onQueueCount?.(nextQueue.length);
      const added = result.added || 0;
      const held = result.selection?.held || 0;
      const firstTouches = result.selection?.firstTouches || 0;
      const followUps = result.selection?.followUps || 0;
      const addedSummary = firstTouches
        ? `${firstTouches} new ${firstTouches === 1 ? "contact" : "contacts"} added first${followUps ? `, then ${followUps} follow ${followUps === 1 ? "up" : "ups"} from spare capacity` : ""}`
        : followUps
          ? `${followUps} follow ${followUps === 1 ? "up" : "ups"} added because no eligible step one contacts remained`
          : `${added} suitable ${added === 1 ? "person was" : "people were"} added`;
      setNotice(
        added
          ? `${addedSummary}. No research or email was sent.`
          : held
            ? "No one new was added. Lower confidence or protected contacts remain safely held."
            : "Today's queue is already filled with the strongest eligible contacts."
      );
    } catch (err: any) {
      setError(err?.message || "Today's outreach queue could not be filled.");
    } finally {
      setBuilding(false);
    }
  };

  const openMessage = (row: QueueRow) => {
    const message = displayMessageFor(row);
    if (message) {
      const reviewableVoiceScript =
        ["draft", "failed"].includes(message.status) && message.voice_script
          ? prepareOutreachVoiceScriptForReview({
              script: message.voice_script,
              recipientFirstName: row.prospect.first_name,
              senderName: sender?.senderName || "",
            })
          : message.voice_script || "";
      setDraftEdits((current) =>
        current[message.id]
          ? current
          : {
              ...current,
              [message.id]: {
                subject: message.subject || "",
                body: message.body_text || "",
                voiceScript: reviewableVoiceScript,
              },
            }
      );
    }
    setExpandedId((current) => (current === row.id ? "" : row.id));
    setError("");
  };

  const updateDraft = (
    messageId: string,
    change: Partial<DraftEdit>,
    fallback?: OutreachMessage
  ) => {
    setDraftEdits((current) => ({
      ...current,
      [messageId]: {
        subject: current[messageId]?.subject ?? fallback?.subject ?? "",
        body: current[messageId]?.body ?? fallback?.body_text ?? "",
        voiceScript:
          current[messageId]?.voiceScript ?? fallback?.voice_script ?? "",
        ...change,
      },
    }));
  };

  const saveDraft = async (message: OutreachMessage, approveAndQueue = false) => {
    if (savingMessageId) return;
    const edit = draftEdits[message.id] || {
      subject: message.subject || "",
      body: message.body_text || "",
      voiceScript: message.voice_script || "",
    };
    if (!edit.subject.trim() || !edit.body.trim()) {
      setError("Add both the subject and email before saving.");
      return;
    }
    setSavingMessageId(message.id);
    setError("");
    setNotice("");
    try {
      const saved = await crmFetch<{ message: OutreachMessage }>(
        `/api/crm/outreach/messages/${message.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            subject: edit.subject,
            body_text: edit.body,
            voice_script: edit.voiceScript,
            ...(approveAndQueue ? { status: "approved" } : {}),
          }),
        }
      );
      if (approveAndQueue) {
        if (saved.message?.status !== "approved")
          throw new Error("The exact draft was not approved");
        await crmFetch(`/api/crm/outreach/messages/${message.id}/send`, {
          method: "POST",
          body: "{}",
        });
        setNotice("Exact email approved and added to the spaced send queue.");
        setFocusedRowId("");
        setExpandedId("");
      } else {
        setNotice("Draft changes saved. Nothing has been sent.");
      }
      await load(true);
      window.dispatchEvent(
        new CustomEvent("lc:tasks-updated", {
          detail: { source: "sales-today-outreach" },
        })
      );
    } catch (err: any) {
      setError(err?.message || "That email could not be saved.");
    } finally {
      setSavingMessageId("");
    }
  };

  const generateVoiceNote = async (message: OutreachMessage) => {
    if (savingMessageId || generatingVoiceMessageId) return;
    const edit = draftEdits[message.id] || {
      subject: message.subject || "",
      body: message.body_text || "",
      voiceScript: message.voice_script || "",
    };
    if (!edit.subject.trim() || !edit.body.trim() || !edit.voiceScript.trim()) {
      setError("Review the email and voice script before creating audio.");
      return;
    }
    setGeneratingVoiceMessageId(message.id);
    setError("");
    setNotice("");
    try {
      const approved = await crmFetch<{ message: OutreachMessage }>(
        `/api/crm/outreach/messages/${message.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            subject: edit.subject,
            body_text: edit.body,
            voice_script: edit.voiceScript,
            approve_voice_script: true,
          }),
        }
      );
      if (!approved.message?.voice_script_approved_at)
        throw new Error("The exact voice script was not confirmed");
      const generated = await crmFetch<{
        message: OutreachMessage;
        reused: boolean;
      }>(`/api/crm/outreach/messages/${message.id}/voice`, {
        method: "POST",
        body: "{}",
      });
      if (generated.message?.voice_status !== "ready")
        throw new Error("The voice preview was not confirmed");
      setNotice(
        generated.reused
          ? "The existing personal voice note is ready to preview."
          : "Personal voice note created once and ready to preview."
      );
      await load(true);
    } catch (err: any) {
      setError(err?.message || "The personal voice note could not be created.");
      await load(true);
    } finally {
      setGeneratingVoiceMessageId("");
    }
  };

  const rehearseDraft = async (message: OutreachMessage) => {
    if (savingMessageId || rehearsingMessageId) return;
    const edit = draftEdits[message.id] || {
      subject: message.subject || "",
      body: message.body_text || "",
      voiceScript: message.voice_script || "",
    };
    if (!edit.subject.trim() || !edit.body.trim()) {
      setError("Add both the subject and email before sending a rehearsal.");
      return;
    }
    setRehearsingMessageId(message.id);
    setError("");
    setNotice("");
    try {
      const saved = await crmFetch<{ message: OutreachMessage }>(
        `/api/crm/outreach/messages/${message.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            subject: edit.subject,
            body_text: edit.body,
            voice_script: edit.voiceScript,
          }),
        }
      );
      if (
        !saved.message?.id ||
        saved.message.subject !== edit.subject.trim() ||
        saved.message.body_text !== edit.body.trim()
      )
        throw new Error("The exact visible draft was not saved for rehearsal");
      const result = await crmFetch<{
        ok: boolean;
        accepted: boolean;
        sentTo: string;
        from: string;
        provider: "google" | "microsoft";
        deliveryLocation: "sent_or_all_mail" | "inbox_or_sent";
        campaignChanged: boolean;
      }>(`/api/crm/outreach/messages/${message.id}/rehearse`, {
        method: "POST",
        body: "{}",
      });
      if (
        !result.ok ||
        !result.accepted ||
        (sender?.mailboxEmail && result.sentTo !== sender.mailboxEmail) ||
        result.campaignChanged !== false
      )
        throw new Error("The safe rehearsal was not confirmed");
      setNotice(
        result.provider === "google"
          ? "Gmail accepted the rehearsal. Find it in Sent or All Mail. The prospect and campaign were untouched."
          : "Microsoft accepted the rehearsal. Check Inbox or Sent. The prospect and campaign were untouched."
      );
      await load(true);
    } catch (err: any) {
      setError(err?.message || "That rehearsal could not be sent.");
    } finally {
      setRehearsingMessageId("");
    }
  };

  const replyActionFor = (item: WorkInboxItem) =>
    replyActions[item.sourceId] || replyActionDefault(item);

  const updateReplyAction = (
    item: WorkInboxItem,
    change: Partial<ReplyAction>
  ) => {
    setReplyActions((current) => ({
      ...current,
      [item.sourceId]: { ...replyActionFor(item), ...change },
    }));
  };

  const replyDraftFor = (item: WorkInboxItem) =>
    replyDrafts[item.sourceId] || replyMessageFromItem(item);

  const prepareBookingReply = async (item: WorkInboxItem) => {
    if (preparingReplyId || savingMessageId) return;
    setPreparingReplyId(item.sourceId);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{ message: OutreachMessage }>(
        `/api/crm/outreach/replies/${item.sourceId}/draft`,
        {
          method: "POST",
          body: "{}",
        }
      );
      if (!result.message?.id)
        throw new Error("The booking reply was not saved");
      setReplyDrafts((current) => ({
        ...current,
        [item.sourceId]: result.message,
      }));
      setDraftEdits((current) => ({
        ...current,
        [result.message.id]: {
          subject: result.message.subject || "",
          body: result.message.body_text || "",
          voiceScript: result.message.voice_script || "",
        },
      }));
      setNotice("Booking reply prepared. Review the exact words before approving it.");
      window.dispatchEvent(
        new CustomEvent("lc:tasks-updated", {
          detail: { source: "sales-today-reply-draft" },
        })
      );
    } catch (err: any) {
      setError(err?.message || "That booking reply could not be prepared.");
    } finally {
      setPreparingReplyId("");
    }
  };

  const saveReplyDraft = async (
    item: WorkInboxItem,
    approveAndQueue = false
  ) => {
    const message = replyDraftFor(item);
    if (!message || savingMessageId || preparingReplyId) return;
    const edit = draftEdits[message.id] || {
      subject: message.subject || "",
      body: message.body_text || "",
      voiceScript: message.voice_script || "",
    };
    if (!edit.subject.trim() || !edit.body.trim()) {
      setError("Add both the subject and email before saving.");
      return;
    }
    const action = replyActionFor(item);
    if (approveAndQueue && (!action.text.trim() || !action.dueAt)) {
      setError("Add the next action and its due date before approving the reply.");
      return;
    }
    setSavingMessageId(message.id);
    setError("");
    setNotice("");
    try {
      const saved = await crmFetch<{ message: OutreachMessage }>(
        `/api/crm/outreach/messages/${message.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            subject: edit.subject,
            body_text: edit.body,
            ...(approveAndQueue ? { status: "approved" } : {}),
          }),
        }
      );
      setReplyDrafts((current) => ({
        ...current,
        [item.sourceId]: saved.message,
      }));
      if (!approveAndQueue) {
        setNotice("Reply changes saved. Nothing has been sent.");
        return;
      }
      if (saved.message?.status !== "approved")
        throw new Error("The exact reply was not approved");

      await crmFetch(`/api/crm/outreach/${item.sourceId}/next-action`, {
        method: "POST",
        body: JSON.stringify(action),
      });
      const queued = await crmFetch<{
        queued: boolean;
        scheduledAt?: string | null;
      }>(`/api/crm/outreach/messages/${message.id}/send`, {
        method: "POST",
        body: "{}",
      });
      if (!queued.queued) throw new Error("The send queue was not confirmed");
      setReplyDrafts((current) => ({
        ...current,
        [item.sourceId]: {
          ...saved.message,
          scheduled_at: queued.scheduledAt || null,
        },
      }));
      setHandledReplyIds((current) => [...new Set([...current, item.sourceId])]);
      setNotice(
        "Reply approved and safely queued. The dated CRM next step is saved and the next action is ready."
      );
      await load(true);
      window.dispatchEvent(
        new CustomEvent("lc:tasks-updated", {
          detail: { source: "sales-today-reply-queued" },
        })
      );
    } catch (err: any) {
      setError(
        err?.message ||
          "That reply could not be approved and queued. Nothing unconfirmed was sent."
      );
    } finally {
      setSavingMessageId("");
    }
  };

  const orderedQueue = useMemo(
    () =>
      queue
        .map((row, index) => ({ row, index }))
        .sort(
          (a, b) =>
            queueWaveRank(a.row) - queueWaveRank(b.row) ||
            queueActionRank(a.row) - queueActionRank(b.row) ||
            a.index - b.index
        )
        .map(({ row }) => row),
    [queue]
  );

  const deferredRowSet = useMemo(
    () => new Set(deferredRowIds),
    [deferredRowIds]
  );
  const actionableQueue = useMemo(
    () =>
      orderedQueue.filter(
        (row) => isActionableQueueRow(row) && !deferredRowSet.has(row.id)
      ),
    [deferredRowSet, orderedQueue]
  );
  const focusedRow =
    actionableQueue.find((row) => row.id === focusedRowId) ||
    actionableQueue[0] ||
    null;
  const rowsToRender = showFullQueue
    ? orderedQueue.slice(0, visible)
    : focusedRow
      ? [focusedRow]
      : [];
  const upNextRows = focusedRow
    ? actionableQueue.filter((row) => row.id !== focusedRow.id).slice(0, 5)
    : [];

  const allUnprepared = queue.filter(
    (row) => !row.message && row.status === "queued"
  );
  const firstTouchUnprepared = allUnprepared.filter(
    (row) => queueWaveRank(row) === 0
  );
  const unprepared = firstTouchUnprepared.length
    ? firstTouchUnprepared
    : allUnprepared;
  const drafts = queue.filter(
    (row) => row.message && ["draft", "failed"].includes(row.message.status)
  ).length;
  const scheduled = queue.filter(
    (row) => row.message?.status === "approved" && row.message.scheduled_at
  ).length;
  const sent = queue.filter(hasBeenSent).length;
  const researching = Object.values(prepareJobs).filter(
    (status) => status === "researching"
  ).length;
  const queuedResearch = Object.values(prepareJobs).filter(
    (status) => status === "queued"
  ).length;
  const dailyLimit = Number(queue[0]?.campaign?.daily_limit || 20);
  const approvedOrSent = Math.min(dailyLimit, scheduled + sent);
  const dailyProgress = Math.round(
    (approvedOrSent / Math.max(1, dailyLimit)) * 100
  );
  const actionableReplies = useMemo(
    () =>
      replyItems
        .filter(
          (item) =>
            item.kind === "reply" && !handledReplyIds.includes(item.sourceId)
        )
        .sort(
          (a, b) =>
            (new Date(a.outreach?.lastReplyAt || a.createdAt || 0).getTime() ||
              0) -
            (new Date(b.outreach?.lastReplyAt || b.createdAt || 0).getTime() ||
              0)
        ),
    [handledReplyIds, replyItems]
  );
  const focusedReply = actionableReplies[0] || null;
  const nextReplies = actionableReplies.slice(1, 4);

  if (loading) {
    return (
      <MatrixRain
        size="panel"
        messages={["loading today's outreach", "checking protected contacts"]}
      />
    );
  }

  return (
    <section className="space-y-3" aria-label="Today's outreach">
      <div className="rounded-xl border border-amber/35 bg-amber/[0.06] p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <p className="font-mono text-[0.52rem] uppercase tracking-[0.18em] text-amber">Step one first</p>
            <h2 className="mt-1 font-display text-xl text-bone">
              Your outreach Sales Desk
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Work through every eligible new contact before returning to scheduled follow ups. As soon as one action is queued, the next prospect opens while delivery continues safely in the background.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowFullQueue((current) => !current)}
              aria-pressed={showFullQueue}
              className={button}
            >
              {showFullQueue ? "Return to one prospect" : `View full queue · ${queue.length}`}
            </button>
            <button
              type="button"
              onClick={() => void buildQueue()}
              disabled={building || queue.length >= dailyLimit}
              className={primary}
            >
              {building
                ? "Ranking eligible contacts…"
                : queue.length
                  ? `Fill queue to ${dailyLimit}`
                  : "Fill today's queue"}
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-full bg-edge/70" aria-label={`${approvedOrSent} of ${dailyLimit} approved or sent`}>
          <div
            className="h-2 rounded-full bg-gradient-to-r from-amber to-moss transition-[width] duration-500"
            style={{ width: `${dailyProgress}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[0.48rem] uppercase tracking-wider text-muted">
          <span>{approvedOrSent} of {dailyLimit} approved or sent</span>
          <span>{actionableReplies.length + actionableQueue.length} actions remaining</span>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-2 border-t border-edge/60 pt-3 text-center">
          {[
            { label: "Prepare", value: unprepared.length, colour: "text-amber" },
            { label: "Review", value: drafts, colour: "text-sky" },
            { label: "Scheduled", value: scheduled, colour: "text-bone" },
            { label: "Sent", value: sent, colour: "text-moss" },
          ].map((item) => (
            <div key={item.label}>
              <strong className={`block font-display text-xl ${item.colour}`}>
                {item.value}
              </strong>
              <span className="font-mono text-[0.44rem] uppercase text-muted">
                {item.label}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {unprepared.length ? (
            <button
              type="button"
              onClick={() => unprepared.forEach((row) => enqueuePrepare(row.prospect.id))}
              className={button}
            >
              Prepare all with AI · {unprepared.length}
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-[0.68rem] leading-5 text-muted">
          {sender?.senderEmail
            ? `Connected sender · ${sender.senderEmail}`
            : "Connect a mailbox in Settings before preparing or sending outreach."}
        </p>
        <p className="mt-1 text-[0.68rem] leading-5 text-muted">
          Sent contacts rotate to the bottom automatically, so the next unsent prospect stays in front of you.
        </p>
        <details className="mt-3 border-t border-edge/60 pt-3">
          <summary className="cursor-pointer font-mono text-[0.49rem] uppercase tracking-wider text-muted">Manage campaign and prospect database</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href="/crm/outreach?tab=prospects" className={button}>Prospect database ↗</Link>
            <Link href="/crm/outreach?tab=campaign" className={button}>Campaign setup ↗</Link>
          </div>
        </details>
      </div>

      {researching || queuedResearch ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-sky/40 bg-sky/[0.07] px-3 py-2 text-xs text-sky"
          role="status"
          aria-live="polite"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky" />
          <strong>{researching} researching</strong>
          {queuedResearch ? <span>· {queuedResearch} waiting</span> : null}
          <span className="text-bone/65">The rest of the CRM remains usable.</span>
        </div>
      ) : null}

      {notice ? (
        <p className="rounded-lg border border-moss/35 bg-moss/10 px-3 py-2 text-sm text-moss">
          ✓ {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm text-rust"
        >
          {error}
        </p>
      ) : null}

      {focusedReply ? (
        <section
          className="rounded-xl border border-moss/45 bg-moss/[0.06] p-3 sm:p-4"
          aria-labelledby="positive-replies-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[0.5rem] uppercase tracking-wider text-moss">
                First action · buyer reply
              </p>
              <h3 id="positive-replies-heading" className="mt-1 font-display text-lg text-bone">
                Reply and secure the meeting
              </h3>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
                Read what they said, check your previous email, approve the exact reply and save the dated next step in one flow.
              </p>
            </div>
            <span className="rounded-full border border-moss/45 px-2 py-1 font-mono text-[0.48rem] uppercase text-moss">
              {actionableReplies.length} to handle
            </span>
          </div>
          {(() => {
            const item = focusedReply;
            const context = item.outreach;
            const action = replyActionFor(item);
            const draft = replyDraftFor(item);
            const edit = draft
              ? draftEdits[draft.id] || {
                  subject: draft.subject || "",
                  body: draft.body_text || "",
                  voiceScript: draft.voice_script || "",
                }
              : null;
            const age = replyAge(context?.lastReplyAt || item.createdAt);
            const busy =
              preparingReplyId === item.sourceId ||
              Boolean(draft && savingMessageId === draft.id) ||
              Boolean(draft && rehearsingMessageId === draft.id);
            return (
              <article
                id={`reply-${item.sourceId}`}
                key={item.id}
                className="mt-3 rounded-lg border border-edge bg-ink/35 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CanonicalRecordLink href={item.href} className="block min-h-11 py-1" ariaLabel={`Open ${context?.person || item.company || "prospect"}`}>
                      <h4 className="text-sm text-bone">{item.title}</h4>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {[context?.jobTitle, item.company, context?.email]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </CanonicalRecordLink>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-1 font-mono text-[0.48rem] uppercase ${
                      age.urgent
                        ? "border-rust/55 bg-rust/10 text-rust"
                        : "border-moss/45 bg-moss/10 text-moss"
                    }`}
                  >
                    {age.urgent ? "Respond now · " : ""}{age.label}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <section className="rounded-lg border border-moss/35 bg-moss/[0.05] p-3">
                    <p className="font-mono text-[0.48rem] uppercase tracking-wider text-moss">
                      Their reply
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-bone">
                      {context?.replyText || context?.replySummary || item.detail || "The stored reply text is unavailable."}
                    </p>
                    <p className="mt-2 font-mono text-[0.46rem] uppercase text-muted">
                      Received {formatHistoryDate(context?.lastReplyAt || item.createdAt)}
                    </p>
                  </section>

                  <details className="rounded-lg border border-edge bg-panel/45 p-3">
                    <summary className="cursor-pointer font-mono text-[0.48rem] uppercase tracking-wider text-sky">
                      Your previous email
                    </summary>
                    {context?.previousSubject || context?.previousBody ? (
                      <div className="mt-3 text-sm leading-6 text-bone/80">
                        <p className="font-medium text-bone">
                          {context.previousSubject || "Previous email"}
                        </p>
                        <p className="mt-2 whitespace-pre-wrap">
                          {context.previousBody || "The previous email body is unavailable."}
                        </p>
                        {context.previousSentAt ? (
                          <p className="mt-2 font-mono text-[0.46rem] uppercase text-muted">
                            Sent {formatHistoryDate(context.previousSentAt)}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-muted">
                        The earlier email is not in the current stored history. The buyer reply is still available above.
                      </p>
                    )}
                  </details>
                </div>

                {!draft ? (
                  <div className="mt-3 rounded-lg border border-amber/35 bg-amber/[0.05] p-3">
                    <p className="text-xs leading-5 text-muted">
                      Prepare a short booking reply from this saved context. It will remain a draft until you approve the exact words.
                    </p>
                    <button
                      type="button"
                      onClick={() => void prepareBookingReply(item)}
                      disabled={busy}
                      className={`${primary} mt-3`}
                    >
                      {preparingReplyId === item.sourceId
                        ? "Preparing booking reply…"
                        : "Prepare booking reply"}
                    </button>
                  </div>
                ) : edit ? (
                  <section className="mt-3 rounded-lg border border-amber/35 bg-amber/[0.04] p-3" aria-label="Exact booking reply">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-[0.48rem] uppercase tracking-wider text-amber">
                        Exact reply awaiting approval
                      </p>
                      <span className="rounded-full border border-edge px-2 py-1 font-mono text-[0.45rem] uppercase text-muted">
                        {draft.status}
                      </span>
                    </div>
                    <label className="mt-3 block">
                      <span className="font-mono text-[0.46rem] uppercase text-muted">Subject</span>
                      <input
                        value={edit.subject}
                        onChange={(event) =>
                          updateDraft(
                            draft.id,
                            { subject: event.target.value },
                            draft
                          )
                        }
                        className="mt-1 min-h-11 w-full rounded-lg border border-edge bg-panel px-3 text-sm text-bone outline-none focus:border-amber/60"
                      />
                    </label>
                    <label className="mt-2 block">
                      <span className="font-mono text-[0.46rem] uppercase text-muted">Email</span>
                      <textarea
                        rows={8}
                        value={edit.body}
                        onChange={(event) =>
                          updateDraft(
                            draft.id,
                            { body: event.target.value },
                            draft
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm leading-6 text-bone outline-none focus:border-amber/60"
                      />
                    </label>
                  </section>
                ) : null}

                <section className="mt-3 rounded-lg border border-sky/30 bg-sky/[0.04] p-3" aria-label="Dated next action">
                  <p className="font-mono text-[0.48rem] uppercase tracking-wider text-sky">
                    CRM next action
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <label className="min-w-0">
                      <span className="sr-only">Next action</span>
                      <input
                        value={action.text}
                        onChange={(event) =>
                          updateReplyAction(item, { text: event.target.value })
                        }
                        className="min-h-11 w-full rounded-lg border border-edge bg-panel px-3 text-sm text-bone outline-none focus:border-sky/60"
                      />
                    </label>
                    <label>
                      <span className="sr-only">Due date</span>
                      <input
                        type="date"
                        value={action.dueAt}
                        onChange={(event) =>
                          updateReplyAction(item, { dueAt: event.target.value })
                        }
                        className="min-h-11 w-full rounded-lg border border-edge bg-panel px-3 text-sm text-bone outline-none focus:border-sky/60"
                      />
                    </label>
                  </div>
                </section>

                {draft ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void rehearseDraft(draft)}
                      disabled={busy || Boolean(draft.scheduled_at)}
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-sky/45 bg-sky/[0.06] px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-sky disabled:opacity-40"
                    >
                      {rehearsingMessageId === draft.id
                        ? "Sending test…"
                        : "Send test to me"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveReplyDraft(item)}
                      disabled={busy}
                      className={button}
                    >
                      {savingMessageId === draft.id ? "Saving…" : "Save changes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveReplyDraft(item, true)}
                      disabled={busy || Boolean(draft.scheduled_at)}
                      className={primary}
                    >
                      {draft.scheduled_at
                        ? "✓ Reply queued"
                        : savingMessageId === draft.id
                          ? "Approving…"
                          : "Approve reply + queue"}
                    </button>
                  </div>
                ) : null}
                <p className="mt-2 text-[0.68rem] leading-5 text-muted">
                  Approval covers the exact words shown. The reply uses the existing five minute sender spacing, reply safety checks and daily limit. One pinned CRM task is created without duplicating the client or deal.
                </p>
              </article>
            );
          })()}

          {nextReplies.length ? (
            <div className="mt-3 border-t border-edge/60 pt-3">
              <p className="font-mono text-[0.47rem] uppercase tracking-wider text-muted">
                Up next replies
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {nextReplies.map((item) => (
                  <CanonicalRecordLink
                    key={item.id}
                    href={item.href}
                    className="inline-flex min-h-11 items-center rounded-full border border-edge bg-ink/35 px-3 py-1 text-xs text-bone/75"
                  >
                    {item.outreach?.person || item.company || "Prospect"} · {replyAge(item.outreach?.lastReplyAt || item.createdAt).label}
                  </CanonicalRecordLink>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {rowsToRender.length ? (
        <ol className="space-y-2">
          {rowsToRender.map((row, index) => {
            const status = rowState(row);
            const job = prepareJobs[row.prospect.id];
            const isFocus = !showFullQueue && row.id === focusedRow?.id;
            const rowOpen = isFocus || expandedId === row.id;
            const name =
              `${row.prospect.first_name || ""} ${row.prospect.last_name || ""}`.trim() ||
              row.prospect.email ||
              "Unnamed prospect";
            const recommendation = row.recommendation;
            const canPrepare = !row.message && row.status === "queued";
            const followUpNeedsDraft =
              canPrepare && Number(row.current_step || 1) > 1;
            const displayMessage = followUpNeedsDraft
              ? null
              : displayMessageFor(row);
            const edit = displayMessage
              ? draftEdits[displayMessage.id] || {
                  subject: displayMessage.subject || "",
                  body: displayMessage.body_text || "",
                  voiceScript: displayMessage.voice_script || "",
                }
              : null;
            const editableMessage = Boolean(
              displayMessage &&
                ["draft", "failed", "approved"].includes(displayMessage.status)
            );
            const research = row.savedResearch || {};
            const hasResearch = Boolean(
              research.summary ||
                research.companyOverview ||
                research.companyOverviewUrl ||
                research.bestAngle ||
                research.personalisationFact ||
                research.signals?.length ||
                research.activeJobs?.length ||
                research.jobBoardUrl ||
                research.jobSignals?.length ||
                research.likelyNeeds?.length
            );
            const researchPoints = [
              ...(research.signals || []),
              ...(research.jobSignals?.length ? [] : research.activeJobs || []),
              ...(research.likelyNeeds || []),
            ];

            return (
              <li
                key={row.id}
                className={`rounded-xl border bg-panel/45 p-3 sm:p-4 ${
                  isFocus
                    ? "border-amber/60 shadow-[0_0_0_1px_rgba(217,161,75,0.09)]"
                    : "border-edge"
                }`}
                style={{ contentVisibility: "auto", containIntrinsicSize: "0 150px" }}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isFocus ? (
                        <span className="rounded-full border border-amber/50 bg-amber/10 px-2 py-0.5 font-mono text-[0.48rem] uppercase tracking-wider text-amber">
                          Do this next
                        </span>
                      ) : (
                        <span className="font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                          #{index + 1} · step {row.current_step || 1}
                        </span>
                      )}
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-[0.48rem] uppercase tracking-wider ${status.style}`}
                      >
                        {status.label}
                      </span>
                      {row.campaign?.name ? (
                        <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.46rem] uppercase tracking-wider text-muted">
                          {row.campaign.name}
                        </span>
                      ) : null}
                    </div>
                    <CanonicalRecordLink href={outreachProspectHref(row.prospect)} className="mt-1 block min-h-11 min-w-0 py-1" ariaLabel={`Open ${name}`}>
                      <h3 className="text-[0.95rem] text-bone">{name}</h3>
                      <p className="mt-0.5 text-xs text-muted">
                        {row.prospect.job_title || "Role not saved"}
                        {row.prospect.company_name ? ` · ${row.prospect.company_name}` : ""}
                      </p>
                    </CanonicalRecordLink>
                    {row.message?.subject || row.lastSentMessage?.subject ? (
                      <p className="mt-2 line-clamp-1 text-xs text-bone/75">
                        {row.message?.subject || row.lastSentMessage?.subject}
                      </p>
                    ) : null}
                    {recommendation ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer font-mono text-[0.49rem] uppercase tracking-wider text-sky">
                          Why this person · {recommendation.score || 0}/100
                        </summary>
                        <ul className="mt-2 space-y-1 border-l border-edge pl-3 text-xs leading-5 text-muted">
                          {(recommendation.reasons || []).slice(0, 3).map((reason) => (
                            <li key={reason}>• {reason}</li>
                          ))}
                          {(recommendation.risks || []).slice(0, 2).map((risk) => (
                            <li key={risk} className="text-amber/85">! {risk}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-52 sm:justify-end">
                    {canPrepare ? (
                      <button
                        type="button"
                        onClick={() => enqueuePrepare(row.prospect.id)}
                        disabled={job === "queued" || job === "researching"}
                        className={primary}
                      >
                        {job === "researching"
                          ? "Researching…"
                          : job === "queued"
                            ? "Queued"
                            : job === "error"
                              ? "Retry prepare"
                              : "Prepare research + draft"}
                      </button>
                    ) : displayMessage ? (
                      isFocus ? (
                        <span className="inline-flex min-h-10 items-center rounded-lg border border-amber/45 bg-amber/10 px-3 font-mono text-[0.52rem] uppercase tracking-wider text-amber">
                          Review the exact email below ↓
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openMessage(row)}
                          aria-expanded={expandedId === row.id}
                          className={
                            hasBeenSent(row)
                              ? "inline-flex min-h-10 items-center justify-center rounded-lg border border-moss/60 bg-moss/20 px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-moss"
                              : primary
                          }
                        >
                          {hasBeenSent(row)
                              ? "✓ View sent email"
                              : "Review exact draft"}
                        </button>
                      )
                    ) : row.status === "replied" ? (
                      <a href={`#reply-${row.prospect.id}`} className={primary}>
                        Handle reply
                      </a>
                    ) : null}
                    {isFocus ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDeferredRowIds((current) => [...new Set([...current, row.id])]);
                          setFocusedRowId("");
                          setNotice("Moved aside for this session. Nothing was deleted or changed.");
                        }}
                        className={button}
                      >
                        Later this session
                      </button>
                    ) : null}
                  </div>
                </div>

                {rowOpen && displayMessage ? (
                  <div className="mt-4 grid gap-3 border-t border-edge pt-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)]">
                    <section aria-label="Exact email" className="rounded-lg border border-edge bg-ink/35 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-mono text-[0.49rem] uppercase tracking-wider text-amber">
                            Exact email
                          </p>
                          <p className="mt-1 text-xs text-muted">
                            From {displayMessage?.from_email || sender?.senderEmail || "connected mailbox"}
                          </p>
                        </div>
                        <span className="rounded-full border border-edge px-2 py-1 font-mono text-[0.46rem] uppercase text-muted">
                          {displayMessage?.status || "not prepared"}
                        </span>
                      </div>

                      {displayMessage ? (
                        <div className="mt-3 grid grid-cols-4 gap-1" aria-label="Email delivery progress">
                          {["Draft", "Approved", "Queued", "Sent"].map((label, stage) => {
                            const complete = deliveryStageFor(displayMessage) >= stage;
                            return (
                              <div key={label} className="min-w-0 text-center">
                                <span
                                  className={`mx-auto block h-1.5 rounded-full ${
                                    complete ? "bg-moss" : "bg-edge"
                                  }`}
                                />
                                <span className={`mt-1 block truncate font-mono text-[0.42rem] uppercase ${
                                  complete ? "text-moss" : "text-muted"
                                }`}>
                                  {label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}

                      {displayMessage && edit ? (
                        editableMessage ? (
                          <div className="mt-3 space-y-2">
                            <label className="block">
                              <span className="font-mono text-[0.48rem] uppercase text-muted">Subject</span>
                              <input
                                value={edit.subject}
                                onChange={(event) =>
                                  updateDraft(displayMessage.id, {
                                    subject: event.target.value,
                                  })
                                }
                                className="mt-1 min-h-11 w-full rounded-lg border border-edge bg-panel px-3 text-sm text-bone outline-none focus:border-amber/60"
                              />
                            </label>
                            <label className="block">
                              <span className="font-mono text-[0.48rem] uppercase text-muted">Email</span>
                              <textarea
                                rows={10}
                                value={edit.body}
                                onChange={(event) =>
                                  updateDraft(displayMessage.id, {
                                    body: event.target.value,
                                  })
                                }
                                className="mt-1 w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm leading-6 text-bone outline-none focus:border-amber/60"
                              />
                            </label>
                            <OutreachVoiceNoteEditor
                              message={displayMessage}
                              script={edit.voiceScript}
                              disabled={
                                Boolean(displayMessage.scheduled_at) ||
                                displayMessage.status === "approved"
                              }
                              generating={
                                generatingVoiceMessageId === displayMessage.id
                              }
                              onScriptChange={(value) =>
                                updateDraft(displayMessage.id, {
                                  voiceScript: value,
                                })
                              }
                              onGenerate={() =>
                                void generateVoiceNote(displayMessage)
                              }
                            />
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void rehearseDraft(displayMessage)}
                                disabled={
                                  savingMessageId === displayMessage.id ||
                                  rehearsingMessageId === displayMessage.id ||
                                  Boolean(displayMessage.scheduled_at)
                                }
                                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-sky/45 bg-sky/[0.06] px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-sky disabled:opacity-40"
                              >
                                {rehearsingMessageId === displayMessage.id
                                  ? "Sending test…"
                                  : "Send test to me"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveDraft(displayMessage)}
                                disabled={savingMessageId === displayMessage.id}
                                className={button}
                              >
                                {savingMessageId === displayMessage.id ? "Saving…" : "Save changes"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveDraft(displayMessage, true)}
                                disabled={
                                  savingMessageId === displayMessage.id ||
                                  Boolean(displayMessage.scheduled_at) ||
                                  Boolean(edit.voiceScript) &&
                                    (displayMessage.voice_status !== "ready" ||
                                      edit.voiceScript.trim() !==
                                        String(displayMessage.voice_script || "").trim())
                                }
                                className={primary}
                              >
                                {displayMessage.scheduled_at
                                  ? "✓ Queued safely"
                                  : savingMessageId === displayMessage.id
                                    ? "Approving…"
                                    : "Approve and queue"}
                              </button>
                            </div>
                            <p className="text-[0.68rem] leading-5 text-muted">
                              Approval covers the exact email and ready voice note above. Delivery uses the existing spaced send queue and daily limit.
                            </p>
                            {sender?.provider === "google" ? (
                              <p className="text-[0.68rem] leading-5 text-sky">
                                Gmail self tests normally appear in Sent or All Mail. The test never changes campaign results or contacts the prospect.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-3 rounded-lg border border-moss/30 bg-moss/[0.05] p-3">
                            <p className="text-sm text-bone">{displayMessage.subject}</p>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-bone/80">
                              {displayMessage.body_text}
                            </p>
                            <p className="mt-3 font-mono text-[0.48rem] uppercase text-moss">
                              {displayMessage.sent_at
                                ? `Sent ${formatHistoryDate(displayMessage.sent_at)}`
                                : displayMessage.status}
                            </p>
                          </div>
                        )
                      ) : (
                        <p className="mt-3 text-sm text-muted">No email has been prepared yet.</p>
                      )}
                    </section>

                    <aside className="space-y-3" aria-label="Saved sales context">
                      <details open className="rounded-lg border border-sky/35 bg-sky/[0.05] p-3">
                        <summary className="cursor-pointer font-mono text-[0.49rem] uppercase tracking-wider text-sky">
                          Saved research · {row.researchSourceCount || 0} sources
                        </summary>
                        {hasResearch ? (
                          <div className="mt-3 space-y-3 text-xs leading-5 text-bone/80">
                            {research.summary ? <p>{research.summary}</p> : null}
                            {research.companyOverview ? (
                              <p>
                                <strong className="text-bone">Business overview. </strong>
                                {research.companyOverview}
                              </p>
                            ) : null}
                            {research.personalisationFact ? (
                              <p><strong className="text-bone">Relevant fact. </strong>{research.personalisationFact}</p>
                            ) : null}
                            {research.bestAngle ? (
                              <p><strong className="text-bone">Best angle. </strong>{research.bestAngle}</p>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              {safeExternalUrl(research.companyOverviewUrl) ? (
                                <a
                                  href={safeExternalUrl(research.companyOverviewUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex min-h-9 items-center rounded-lg border border-sky/45 bg-sky/10 px-3 py-2 font-mono text-[0.5rem] uppercase tracking-wider text-sky hover:bg-sky/20"
                                >
                                  Open company overview ↗
                                </a>
                              ) : null}
                              {safeExternalUrl(research.jobBoardUrl) ? (
                                <a
                                  href={safeExternalUrl(research.jobBoardUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex min-h-9 items-center rounded-lg border border-amber/45 bg-amber/10 px-3 py-2 font-mono text-[0.5rem] uppercase tracking-wider text-amber hover:bg-amber/20"
                                >
                                  Open company job board ↗
                                </a>
                              ) : null}
                            </div>
                            {research.jobSignals?.length ? (
                              <div>
                                <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">
                                  Verified vacancies
                                </p>
                                <ul className="mt-2 space-y-2">
                                  {research.jobSignals.map((job) => {
                                    const href = safeExternalUrl(job.sourceUrl);
                                    const detail = [job.location, job.compensation, job.recency]
                                      .filter(Boolean)
                                      .join(" · ");
                                    return href ? (
                                      <li key={`${job.role}:${href}`} className="rounded-lg border border-edge bg-ink/35 px-3 py-2">
                                        <a href={href} target="_blank" rel="noreferrer" className="font-medium text-amber hover:underline">
                                          {job.role} ↗
                                        </a>
                                        {detail ? <p className="mt-1 text-[0.68rem] text-muted">{detail}</p> : null}
                                      </li>
                                    ) : null;
                                  })}
                                </ul>
                              </div>
                            ) : null}
                            {researchPoints.length ? (
                              <ul className="space-y-1 border-l border-sky/25 pl-3 text-muted">
                                {researchPoints
                                  .slice(0, 6)
                                  .map((point, pointIndex) => (
                                    <li key={`${pointIndex}:${point}`}>• {point}</li>
                                  ))}
                              </ul>
                            ) : null}
                            {research.fitDecision || research.confidence ? (
                              <p className="font-mono text-[0.48rem] uppercase text-sky">
                                {[research.fitDecision, research.confidence]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-3 text-xs leading-5 text-muted">
                            No research has been saved for this person yet.
                          </p>
                        )}
                      </details>

                      <details className="rounded-lg border border-edge bg-ink/35 p-3">
                        <summary className="cursor-pointer font-mono text-[0.49rem] uppercase tracking-wider text-muted">
                          Contact history · {row.messageHistory?.length || 0}
                        </summary>
                        {row.messageHistory?.length ? (
                          <ol className="mt-3 space-y-2">
                            {row.messageHistory.map((history) => (
                              <li key={history.id} className="rounded border border-edge/70 p-2 text-xs">
                                <div className="flex flex-wrap justify-between gap-2 text-muted">
                                  <span>Step {history.step_number || 1} · {history.status}</span>
                                  <span>{formatHistoryDate(history.sent_at || history.updated_at)}</span>
                                </div>
                                <p className="mt-1 text-bone/85">{history.subject || "No subject"}</p>
                                {history.body_text ? (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-sky">Read email</summary>
                                    <p className="mt-2 whitespace-pre-wrap leading-5 text-muted">
                                      {history.body_text}
                                    </p>
                                  </details>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="mt-3 text-xs text-muted">No email history yet.</p>
                        )}
                      </details>
                    </aside>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : queue.length ? (
        <div className="rounded-xl border border-moss/40 bg-moss/[0.06] px-4 py-10 text-center">
          <p className="font-display text-xl text-bone">
            {deferredRowIds.length
              ? "Everything else is moved aside for this session."
              : "Today's outreach actions are handled."}
          </p>
          <p className="mt-1 text-sm text-muted">
            Scheduled emails will continue sending safely in the background.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-edge bg-panel/45 px-4 py-10 text-center">
          <p className="font-display text-xl text-bone">No outreach is queued yet.</p>
          <p className="mt-1 text-sm text-muted">
            Fill today's queue to rank eligible contacts. This does not research or send anything.
          </p>
        </div>
      )}

      {!showFullQueue && upNextRows.length ? (
        <section className="rounded-xl border border-edge bg-panel/35 p-3" aria-labelledby="sales-desk-up-next">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-mono text-[0.49rem] uppercase tracking-wider text-muted">Up next</p>
              <h3 id="sales-desk-up-next" className="mt-1 text-sm text-bone">
                Keep moving without leaving this screen
              </h3>
            </div>
            <span className="font-mono text-[0.48rem] uppercase text-muted">
              {Math.max(0, actionableQueue.length - 1)} after this
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {upNextRows.map((row) => {
              const name =
                `${row.prospect.first_name || ""} ${row.prospect.last_name || ""}`.trim() ||
                row.prospect.email ||
                "Unnamed prospect";
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setFocusedRowId(row.id)}
                  className="min-h-12 rounded-lg border border-edge bg-ink/35 px-3 py-2 text-left transition hover:border-amber/45"
                >
                  <span className="block truncate text-sm text-bone">{name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[0.46rem] uppercase text-muted">
                    {rowState(row).label} · {row.prospect.company_name || "Company not saved"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {deferredRowIds.length ? (
        <button
          type="button"
          onClick={() => {
            setDeferredRowIds([]);
            setFocusedRowId("");
            setNotice("Moved aside prospects are back in this session.");
          }}
          className={`${button} w-full`}
        >
          Bring back {deferredRowIds.length} moved aside
        </button>
      ) : null}

      {showFullQueue && orderedQueue.length > visible ? (
        <button
          type="button"
          onClick={() => setVisible((count) => count + 10)}
          className={`${button} w-full`}
        >
          Show 10 more · {orderedQueue.length - visible} remaining
        </button>
      ) : null}
    </section>
  );
}
