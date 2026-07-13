"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";

type Call = {
  id: string;
  candidate: string | null;
  role: string | null;
  company: string | null;
  company_id?: string | null;
  created_at: string;
  cost: number | string | null;
  ref: string | null;
  scored?: boolean;
};

// Scored call -> its scorecard; a call that happened but was never summarised
// -> the quick "log a call" recap for that client, so nothing is a dead end.
const hrefFor = (c: Call) =>
  c.scored === false
    ? `/crm/log-call${
        c.company_id
          ? `?company=${c.company_id}&companyName=${encodeURIComponent(
              c.company || ""
            )}`
          : ""
      }`
    : `/crm/calls/${c.id}`;

export default function CallsPage() {
  // Seed from cache so a revisit shows the list instantly (no spinner blink).
  const cached = getCached<{ calls: Call[] }>("/api/crm/calls");
  const [calls, setCalls] = useState<Call[]>(cached?.calls || []);
  const [loading, setLoading] = useState(!cached);
  const [q, setQ] = useState("");

  useEffect(() => {
    crmFetch<{ calls: Call[] }>("/api/crm/calls")
      .then((d) => setCalls(d.calls || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };
  const gbp = (n: number | string | null) => {
    // numeric columns arrive as strings from supabase - coerce before format.
    const v = n == null ? NaN : Number(n);
    return Number.isFinite(v)
      ? `£${v.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "—";
  };

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? calls.filter(
        (c) =>
          (c.candidate || "").toLowerCase().includes(needle) ||
          (c.company || "").toLowerCase().includes(needle)
      )
    : calls;

  return (
    <main className="relative z-10 mx-auto max-w-[1000px] px-5 py-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.55rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / calls
          </span>
        </h1>
        <Link
          href="/crm"
          className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ dashboard
        </Link>
      </header>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or company…"
        className="mb-4 w-full rounded-lg border border-edge bg-ink/40 px-3 py-2 font-mono text-[0.7rem] text-bone placeholder:text-muted focus:border-amber/50 focus:outline-none"
      />

      {loading ? (
        <p className="font-mono text-[0.66rem] text-muted">Loading calls…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge p-8 text-center">
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-bone">
            No calls yet
          </p>
          <p className="mt-1.5 font-mono text-[0.62rem] leading-relaxed text-muted">
            Calls appear here once you finish and summarise them.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-edge">
          {/* header row */}
          <div className="grid grid-cols-[1.4fr_1.2fr_1fr_0.6fr_auto] gap-3 border-b border-edge bg-panel/60 px-4 py-2.5 font-mono text-[0.54rem] uppercase tracking-wider text-muted">
            <span>Name</span>
            <span>Company</span>
            <span>Date / time</span>
            <span className="text-right">Cost</span>
            <span className="text-right">View</span>
          </div>
          {shown.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-[1.4fr_1.2fr_1fr_0.6fr_auto] items-center gap-3 border-b border-edge/40 px-4 py-3 last:border-none hover:bg-bone/[0.03]"
            >
              <span className="truncate font-sans text-[0.84rem] text-bone">
                {c.ref && (
                  <span className="mr-1.5 font-mono text-[0.56rem] uppercase tracking-wider text-muted">
                    {c.ref}
                  </span>
                )}
                {c.candidate || "Untitled call"}
              </span>
              <span className="truncate font-mono text-[0.66rem] text-sky">
                {c.company || "—"}
              </span>
              <span className="font-mono text-[0.62rem] text-muted">
                {fmtDate(c.created_at)}
                {c.scored === false && (
                  <span className="ml-1.5 text-amber/80">· not summarised</span>
                )}
              </span>
              <span className="text-right font-mono text-[0.66rem] text-sage">
                {c.scored === false ? "—" : gbp(c.cost)}
              </span>
              <span className="text-right">
                <Link
                  href={hrefFor(c)}
                  className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
                >
                  {c.scored === false ? "log ↗" : "view ↗"}
                </Link>
              </span>
            </div>
          ))}
        </div>
      )}

      <NavMenu />
    </main>
  );
}
