"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MatrixRain from "@/components/MatrixRain";
import { crmFetch } from "@/lib/crm";
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
  signals?: string[];
  activeJobs?: string[];
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
};

type QueueRow = {
  id: string;
  status: string;
  current_step?: number;
  prospect: {
    id: string;
    first_name?: string;
    last_name?: string;
    job_title?: string;
    company_name?: string;
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
  selection?: { held?: number; skipped?: number };
  sender?: {
    senderName?: string;
    senderEmail?: string;
    provider?: "google" | "microsoft";
  } | null;
};

const PREPARE_QUEUE_KEY = "livecoach:sales-today-prepare-queue:v1";
const MAX_CONCURRENT_RESEARCH = 2;

type DraftEdit = { subject: string; body: string };
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
  if (row.message?.status === "sent" || row.lastSentMessage)
    return { label: "Sent", style: "border-moss/45 bg-moss/10 text-moss" };
  if (["replied", "booked"].includes(row.status))
    return { label: row.status === "booked" ? "Meeting booked" : "Replied", style: "border-moss/45 bg-moss/10 text-moss" };
  return { label: "Not prepared", style: "border-edge bg-ink/40 text-muted" };
};

const hasBeenSent = (row: QueueRow) =>
  row.message?.status === "sent" || Boolean(row.lastSentMessage);

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
  const subject = item.title
    .replace(/^Review CRM handover for\s+/i, "")
    .replace(/\s+replied positively$/i, "")
    .trim();
  return {
    text: `Follow up with ${subject || item.company || "the prospect"} about their positive outreach reply`,
    dueAt: londonDateInput(1),
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
  const [visible, setVisible] = useState(10);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [prepareJobs, setPrepareJobs] = useState<Record<string, PrepareStatus>>({});
  const [expandedId, setExpandedId] = useState("");
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftEdit>>({});
  const [savingMessageId, setSavingMessageId] = useState("");
  const [replyActions, setReplyActions] = useState<Record<string, ReplyAction>>({});
  const [savingReplyId, setSavingReplyId] = useState("");
  const [handledReplyIds, setHandledReplyIds] = useState<string[]>([]);
  const prepareJobsRef = useRef<Record<string, PrepareStatus>>({});
  const pendingRef = useRef<string[]>([]);
  const activeRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await crmFetch<QueueResponse>("/api/crm/outreach/queue");
      const nextQueue = data.queue || [];
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
      setNotice(
        added
          ? `${added} suitable ${added === 1 ? "person was" : "people were"} added. No research or email was sent.`
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
      setDraftEdits((current) =>
        current[message.id]
          ? current
          : {
              ...current,
              [message.id]: {
                subject: message.subject || "",
                body: message.body_text || "",
              },
            }
      );
    }
    setExpandedId((current) => (current === row.id ? "" : row.id));
    setError("");
  };

  const updateDraft = (messageId: string, change: Partial<DraftEdit>) => {
    setDraftEdits((current) => ({
      ...current,
      [messageId]: {
        subject: current[messageId]?.subject || "",
        body: current[messageId]?.body || "",
        ...change,
      },
    }));
  };

  const saveDraft = async (message: OutreachMessage, approveAndQueue = false) => {
    if (savingMessageId) return;
    const edit = draftEdits[message.id] || {
      subject: message.subject || "",
      body: message.body_text || "",
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

  const saveReplyAction = async (item: WorkInboxItem) => {
    if (savingReplyId) return;
    const action = replyActionFor(item);
    if (!action.text.trim() || !action.dueAt) {
      setError("Add the next action and its due date first.");
      return;
    }
    setSavingReplyId(item.sourceId);
    setError("");
    setNotice("");
    try {
      await crmFetch(`/api/crm/outreach/${item.sourceId}/next-action`, {
        method: "POST",
        body: JSON.stringify(action),
      });
      setHandledReplyIds((current) => [...new Set([...current, item.sourceId])]);
      setNotice("Positive reply turned into a dated CRM next step.");
      window.dispatchEvent(
        new CustomEvent("lc:tasks-updated", {
          detail: { source: "sales-today-reply" },
        })
      );
    } catch (err: any) {
      setError(err?.message || "That next action could not be saved.");
    } finally {
      setSavingReplyId("");
    }
  };

  const orderedQueue = useMemo(
    () =>
      queue
        .map((row, index) => ({ row, index }))
        .sort(
          (a, b) =>
            Number(hasBeenSent(a.row)) - Number(hasBeenSent(b.row)) ||
            a.index - b.index
        )
        .map(({ row }) => row),
    [queue]
  );

  const unprepared = queue.filter(
    (row) => !row.message && row.status === "queued"
  );
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
  const actionableReplies = replyItems.filter(
    (item) =>
      item.kind === "reply" && !handledReplyIds.includes(item.sourceId)
  );

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
            <p className="font-mono text-[0.52rem] uppercase tracking-[0.18em] text-amber">
              Today's outreach
            </p>
            <h2 className="mt-1 font-display text-xl text-bone">
              Prepare, review, then move on
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              Filling the queue only ranks eligible contacts. AI cost starts only when you press Prepare. Every email still waits for exact review and approval.
            </p>
          </div>
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
          <Link href="/crm/outreach?tab=prospects" className={button}>
            Prospect database ↗
          </Link>
          <Link href="/crm/outreach?tab=campaign" className={button}>
            Campaign setup ↗
          </Link>
        </div>
        <p className="mt-2 text-[0.68rem] leading-5 text-muted">
          {sender?.senderEmail
            ? `Connected sender · ${sender.senderEmail}`
            : "Connect a mailbox in Settings before preparing or sending outreach."}
        </p>
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

      {actionableReplies.length ? (
        <section
          className="rounded-xl border border-moss/45 bg-moss/[0.06] p-3 sm:p-4"
          aria-labelledby="positive-replies-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[0.5rem] uppercase tracking-wider text-moss">
                Buyer replies
              </p>
              <h3 id="positive-replies-heading" className="mt-1 font-display text-lg text-bone">
                Convert interest into a dated next step
              </h3>
            </div>
            <span className="rounded-full border border-moss/45 px-2 py-1 font-mono text-[0.48rem] uppercase text-moss">
              {actionableReplies.length} to handle
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {actionableReplies.map((item) => {
              const action = replyActionFor(item);
              return (
                <article
                  id={`reply-${item.sourceId}`}
                  key={item.id}
                  className="rounded-lg border border-edge bg-ink/35 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm text-bone">{item.title}</h4>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {item.detail || "Positive reply received"}
                      </p>
                    </div>
                    <span className="font-mono text-[0.48rem] uppercase text-moss">
                      {formatHistoryDate(item.createdAt)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
                    <label className="min-w-0">
                      <span className="sr-only">Next action</span>
                      <input
                        value={action.text}
                        onChange={(event) =>
                          updateReplyAction(item, { text: event.target.value })
                        }
                        className="min-h-11 w-full rounded-lg border border-edge bg-panel px-3 text-sm text-bone outline-none focus:border-moss/60"
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
                        className="min-h-11 w-full rounded-lg border border-edge bg-panel px-3 text-sm text-bone outline-none focus:border-moss/60"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveReplyAction(item)}
                      disabled={savingReplyId === item.sourceId}
                      className="min-h-11 rounded-lg border border-moss/55 bg-moss/10 px-3 font-mono text-[0.52rem] uppercase tracking-wider text-moss disabled:opacity-40"
                    >
                      {savingReplyId === item.sourceId ? "Saving…" : "Save next step"}
                    </button>
                  </div>
                  <p className="mt-2 text-[0.68rem] leading-5 text-muted">
                    This creates one pinned CRM task. It does not create a duplicate client or opportunity.
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {orderedQueue.length ? (
        <ol className="space-y-2">
          {orderedQueue.slice(0, visible).map((row, index) => {
            const status = rowState(row);
            const job = prepareJobs[row.prospect.id];
            const name =
              `${row.prospect.first_name || ""} ${row.prospect.last_name || ""}`.trim() ||
              row.prospect.email ||
              "Unnamed prospect";
            const recommendation = row.recommendation;
            const canPrepare = !row.message && row.status === "queued";
            const displayMessage = displayMessageFor(row);
            const edit = displayMessage
              ? draftEdits[displayMessage.id] || {
                  subject: displayMessage.subject || "",
                  body: displayMessage.body_text || "",
                }
              : null;
            const editableMessage = Boolean(
              displayMessage &&
                ["draft", "failed", "approved"].includes(displayMessage.status)
            );
            const research = row.savedResearch || {};
            const hasResearch = Boolean(
              research.summary ||
                research.bestAngle ||
                research.personalisationFact ||
                research.signals?.length ||
                research.activeJobs?.length ||
                research.likelyNeeds?.length
            );

            return (
              <li
                key={row.id}
                className="rounded-xl border border-edge bg-panel/45 p-3 sm:p-4"
                style={{ contentVisibility: "auto", containIntrinsicSize: "0 150px" }}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                        #{index + 1} · step {row.current_step || 1}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-[0.48rem] uppercase tracking-wider ${status.style}`}
                      >
                        {status.label}
                      </span>
                    </div>
                    <h3 className="mt-2 text-[0.95rem] text-bone">{name}</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      {row.prospect.job_title || "Role not saved"}
                      {row.prospect.company_name ? ` · ${row.prospect.company_name}` : ""}
                    </p>
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
                    ) : row.status === "replied" ? (
                      <a href={`#reply-${row.prospect.id}`} className={primary}>
                        Handle reply
                      </a>
                    ) : null}
                  </div>
                </div>

                {expandedId === row.id ? (
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
                            <div className="flex flex-wrap gap-2">
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
                                  Boolean(displayMessage.scheduled_at)
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
                              Approval covers the exact words above. Delivery uses the existing spaced send queue and daily limit.
                            </p>
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
                            {research.personalisationFact ? (
                              <p><strong className="text-bone">Relevant fact. </strong>{research.personalisationFact}</p>
                            ) : null}
                            {research.bestAngle ? (
                              <p><strong className="text-bone">Best angle. </strong>{research.bestAngle}</p>
                            ) : null}
                            {[...(research.signals || []), ...(research.activeJobs || []), ...(research.likelyNeeds || [])].length ? (
                              <ul className="space-y-1 border-l border-sky/25 pl-3 text-muted">
                                {[...(research.signals || []), ...(research.activeJobs || []), ...(research.likelyNeeds || [])]
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
      ) : (
        <div className="rounded-xl border border-edge bg-panel/45 px-4 py-10 text-center">
          <p className="font-display text-xl text-bone">No outreach is queued yet.</p>
          <p className="mt-1 text-sm text-muted">
            Fill today's queue to rank eligible contacts. This does not research or send anything.
          </p>
        </div>
      )}

      {orderedQueue.length > visible ? (
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
