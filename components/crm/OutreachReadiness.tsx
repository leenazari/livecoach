"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";

type Status = "pass" | "warn" | "fail";
type Check = {
  id: string;
  label: string;
  detail: string;
  status: Status;
  href?: string;
  action?: string;
};
type Readiness = {
  status: "ready" | "attention" | "blocked";
  canLaunch: boolean;
  failures: number;
  warnings: number;
  checks: Check[];
};

const colours: Record<Status, string> = {
  pass: "border-moss/45 bg-moss/[0.07] text-moss",
  warn: "border-amber/45 bg-amber/[0.07] text-amber",
  fail: "border-rust/50 bg-rust/[0.08] text-rust",
};

export default function OutreachReadiness() {
  const [data, setData] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await crmFetch<Readiness>("/api/crm/outreach/readiness"));
      setError("");
    } catch {
      setError("The launch check could not refresh.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="mb-4 rounded-2xl border border-edge bg-panel p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
            Launch readiness
          </p>
          <h2 className="mt-1 font-display text-xl text-bone">
            {loading
              ? "Checking the outreach system…"
              : data?.status === "ready"
                ? "Ready for a controlled first batch"
                : data?.status === "attention"
                  ? "Ready, with a final warning to review"
                  : "Fix the red items before sending"}
          </h2>
          <p className="mt-1 text-sm leading-5 text-muted">
            Deterministic checks only—no research, AI tokens or emails are triggered here.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="min-h-11 shrink-0 rounded-lg border border-edge px-3 font-mono text-[0.57rem] uppercase tracking-wider text-muted hover:border-amber/60 hover:text-amber disabled:opacity-40"
        >
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">
          {error}
        </p>
      ) : null}

      {data ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.checks.map((check) => (
            <article key={check.id} className={`rounded-xl border p-3 ${colours[check.status]}`}>
              <div className="flex items-center gap-2">
                <span aria-hidden="true">●</span>
                <h3 className="font-mono text-[0.56rem] uppercase tracking-wider">
                  {check.label}
                </h3>
              </div>
              <p className="mt-2 text-xs leading-5 text-bone/75">{check.detail}</p>
              {check.href && check.action ? (
                <Link
                  href={check.href}
                  className="mt-2 inline-block font-mono text-[0.53rem] uppercase tracking-wider underline underline-offset-4"
                >
                  {check.action} →
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
