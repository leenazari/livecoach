"use client";

import { useCallback, useEffect, useState } from "react";
import NavMenu from "@/components/crm/NavMenu";

type DocumentJob = {
  id: string;
  title: string;
  documentType: string;
  status: string;
  progress: number;
  stageLabel: string;
  fileName?: string | null;
  error?: string | null;
  costGbp?: number | null;
  createdAt: string;
  completedAt?: string | null;
  downloadUrl?: string | null;
};

export default function DocumentsPage() {
  const [jobs, setJobs] = useState<DocumentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/crm/documents", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Could not load documents");
      setJobs(Array.isArray(body.jobs) ? body.jobs : []);
    } finally {
      setLoading(false);
    }
  }, []);
  const hasActive = jobs.some((job) =>
    ["queued", "processing", "quality_check"].includes(job.status)
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [hasActive, load]);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("lc:document-jobs-updated", load);
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("lc:document-jobs-updated", load);
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  const retry = async (id: string) => {
    await fetch(`/api/crm/documents/${id}/retry`, { method: "POST" });
    await load();
  };

  return (
    <main className="min-h-screen bg-ink px-4 pb-24 pt-8 text-bone sm:px-7 sm:pb-12">
      <NavMenu />
      <div className="mx-auto max-w-6xl">
        <div className="mb-7">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber">
            Brain Document Studio
          </p>
          <h1 className="mt-2 font-display text-3xl text-bone sm:text-4xl">Your documents</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Ask Brain to create a plan, proposal, agreement, handbook, report or brief. It continues in the background while you use the CRM.
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-edge bg-panel p-6 text-sm text-muted">Loading documents…</div>
        ) : jobs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-edge bg-panel/60 p-8 text-center">
            <p className="text-bone">No documents have been created yet.</p>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("lc:open-brain"))}
              className="mt-4 rounded-full border border-amber/50 bg-amber/10 px-5 py-3 font-mono text-[0.62rem] uppercase tracking-wider text-amber"
            >
              Ask Brain to create one
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const active = ["queued", "processing", "quality_check"].includes(job.status);
              return (
                <article key={job.id} className="rounded-2xl border border-edge bg-panel p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-edge px-2.5 py-1 font-mono text-[0.55rem] uppercase tracking-wider text-muted">
                          {job.documentType}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 font-mono text-[0.55rem] uppercase tracking-wider ${job.status === "complete" ? "bg-mint/10 text-mint" : job.status === "failed" ? "bg-rust/10 text-rust" : "bg-amber/10 text-amber"}`}>
                          {job.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <h2 className="mt-3 text-lg text-bone">{job.title}</h2>
                      <p className="mt-1 text-xs text-muted">
                        {new Date(job.createdAt).toLocaleString("en-GB", {
                          timeZone: "Europe/London",
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {job.costGbp != null ? `  ·  £${job.costGbp.toFixed(3)} AI cost` : ""}
                      </p>
                      <p className="mt-2 text-sm text-muted">{job.stageLabel}</p>
                      {active && (
                        <div className="mt-3 h-1.5 max-w-md overflow-hidden rounded-full bg-edge">
                          <div className="h-full rounded-full bg-amber transition-[width] duration-500" style={{ width: `${Math.max(4, job.progress || 0)}%` }} />
                        </div>
                      )}
                      {job.error && <p className="mt-2 text-sm text-rust">{job.error}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {job.status === "complete" && (
                        <a href={job.downloadUrl || `/api/crm/documents/${job.id}/download`} className="rounded-full border border-mint/50 bg-mint/10 px-4 py-3 text-center font-mono text-[0.62rem] uppercase tracking-wider text-mint">
                          Download Word
                        </a>
                      )}
                      {job.status === "failed" && (
                        <button type="button" onClick={() => retry(job.id)} className="rounded-full border border-amber/50 px-4 py-3 font-mono text-[0.62rem] uppercase tracking-wider text-amber">
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
