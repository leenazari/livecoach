"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DocumentJob = {
  id: string;
  title: string;
  documentType: string;
  status: "queued" | "processing" | "quality_check" | "complete" | "failed";
  progress: number;
  stageLabel: string;
  fileName?: string | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
  downloadUrl?: string | null;
};

const activeStatuses = new Set(["queued", "processing", "quality_check"]);

export default function DocumentJobTray() {
  const [jobs, setJobs] = useState<DocumentJob[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/crm/documents", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Could not load documents");
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
    } catch {
      // The document queue must never interfere with the rest of the CRM.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = () => {
      setCollapsed(false);
      load();
    };
    window.addEventListener("lc:document-jobs-updated", refresh);
    return () => {
      window.removeEventListener("lc:document-jobs-updated", refresh);
    };
  }, [load]);

  const hasActive = jobs.some((job) => activeStatuses.has(job.status));
  useEffect(() => {
    if (!hasActive) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 2500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hasActive, load]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  const shown = useMemo(() => {
    const active = jobs.filter((job) => activeStatuses.has(job.status));
    const failed = jobs.filter((job) => job.status === "failed").slice(0, 2);
    const recentReady = jobs
      .filter(
        (job) =>
          job.status === "complete" &&
          Date.now() - new Date(job.completedAt || job.createdAt).getTime() < 24 * 60 * 60 * 1000
      )
      .slice(0, 2);
    return [...active, ...failed, ...recentReady]
      .filter((job, index, all) => all.findIndex((item) => item.id === job.id) === index)
      .slice(0, 4);
  }, [jobs]);

  const retry = async (job: DocumentJob) => {
    await fetch(`/api/crm/documents/${job.id}/retry`, { method: "POST" });
    setCollapsed(false);
    await load();
  };

  if (loading || shown.length === 0) return null;
  if (collapsed)
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-20 right-3 z-[45] rounded-full border border-amber/50 bg-panel px-4 py-3 font-mono text-[0.62rem] uppercase tracking-wider text-amber shadow-2xl sm:bottom-4 sm:right-4"
      >
        {hasActive ? "Document creating" : "Document ready"}
      </button>
    );

  return (
    <aside
      aria-live="polite"
      aria-label="Background document jobs"
      className="fixed bottom-20 left-3 right-3 z-[45] max-h-[46vh] overflow-auto rounded-2xl border border-edge bg-panel/95 p-3 shadow-2xl backdrop-blur sm:bottom-4 sm:left-auto sm:right-4 sm:w-[24rem]"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[0.61rem] uppercase tracking-[0.16em] text-amber">
            Brain Document Studio
          </p>
          <p className="mt-1 text-xs text-muted">The rest of the CRM remains available.</p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-edge text-muted hover:border-amber/50 hover:text-amber"
          aria-label="Minimise document progress"
        >
          −
        </button>
      </div>
      <div className="space-y-2">
        {shown.map((job) => (
          <div key={job.id} className="rounded-xl border border-edge bg-ink/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-bone">{job.title}</p>
                <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-wider text-muted">
                  {job.stageLabel || job.status.replace(/_/g, " ")}
                </p>
              </div>
              {job.status === "complete" ? (
                <a
                  href={job.downloadUrl || `/api/crm/documents/${job.id}/download`}
                  className="shrink-0 rounded-full border border-mint/50 bg-mint/10 px-3 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-mint"
                >
                  Download Word
                </a>
              ) : job.status === "failed" ? (
                <button
                  type="button"
                  onClick={() => retry(job)}
                  className="shrink-0 rounded-full border border-amber/50 px-3 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-amber"
                >
                  Retry
                </button>
              ) : (
                <span className="shrink-0 font-mono text-[0.62rem] text-amber">
                  {Math.max(0, Math.min(100, Number(job.progress) || 0))}%
                </span>
              )}
            </div>
            {activeStatuses.has(job.status) && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-edge">
                <div
                  className="h-full rounded-full bg-amber transition-[width] duration-500"
                  style={{ width: `${Math.max(4, Math.min(100, Number(job.progress) || 0))}%` }}
                />
              </div>
            )}
            {job.status === "failed" && job.error && (
              <p className="mt-2 text-xs leading-relaxed text-rust">{job.error}</p>
            )}
          </div>
        ))}
      </div>
      <Link
        href="/crm/documents"
        className="mt-3 block text-center font-mono text-[0.58rem] uppercase tracking-wider text-muted hover:text-amber"
      >
        View all documents
      </Link>
    </aside>
  );
}
