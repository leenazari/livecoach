"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MatrixRain from "@/components/MatrixRain";
import { crmFetch } from "@/lib/crm";

type PrepareStatus = "queued" | "researching" | "done" | "error";

type Recommendation = {
  action?: "contact_today" | "hold" | "skip";
  label?: string;
  score?: number;
  confidence?: string;
  reasons?: string[];
  risks?: string[];
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
  message?: {
    id: string;
    status: string;
    subject?: string;
    scheduled_at?: string | null;
  } | null;
  lastSentMessage?: {
    id?: string;
    subject?: string;
    sent_at?: string | null;
  } | null;
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

export default function OutreachTodayLane({
  onQueueCount,
}: {
  onQueueCount?: (count: number) => void;
}) {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [sender, setSender] = useState<QueueResponse["sender"]>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [visible, setVisible] = useState(10);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [prepareJobs, setPrepareJobs] = useState<Record<string, PrepareStatus>>({});
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
                    ) : (
                      <Link
                        href={
                          row.status === "replied"
                            ? "/crm/outreach?tab=replies"
                            : "/crm/outreach"
                        }
                        className={
                          hasBeenSent(row)
                            ? "inline-flex min-h-10 items-center justify-center rounded-lg border border-moss/60 bg-moss/20 px-3 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-moss"
                            : primary
                        }
                      >
                        {row.status === "replied"
                          ? "Handle reply"
                          : hasBeenSent(row)
                            ? "✓ View sent email"
                            : "Review exact draft"} ↗
                      </Link>
                    )}
                  </div>
                </div>
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
