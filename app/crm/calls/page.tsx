"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";

type CallState = "scored" | "summarising" | "failed" | "unrecorded";

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
  state?: CallState;
  session_id?: string | null;
  error?: string | null;
};

const stateOf = (c: Call): CallState =>
  c.state || (c.scored === false ? "unrecorded" : "scored");

// Scored call -> its scorecard. A call that happened but was never recorded ->
// the quick "log a call" recap for that client. A captured call that is still
// summarising, or whose summary failed, has no page yet, so it stays in the
// list showing its state and a retry rather than leading nowhere.
const hrefFor = (c: Call): string | null => {
  const s = stateOf(c);
  if (s === "scored") return `/crm/calls/${c.id}`;
  if (s === "unrecorded")
    return `/crm/log-call${
      c.company_id
        ? `?company=${c.company_id}&companyName=${encodeURIComponent(
            c.company || ""
          )}`
        : ""
    }`;
  return null;
};

export default function CallsPage() {
  // Seed from cache so a revisit shows the list instantly (no spinner blink).
  const cached = getCached<{ calls: Call[] }>("/api/crm/calls");
  const [calls, setCalls] = useState<Call[]>(cached?.calls || []);
  const [loading, setLoading] = useState(!cached);
  const [q, setQ] = useState("");
  const [assigningId, setAssigningId] = useState("");
  const [retrying, setRetrying] = useState("");

  const load = () =>
    crmFetch<{ calls: Call[] }>("/api/crm/calls")
      .then((d) => setCalls(d.calls || []))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  // Poll gently while anything is still summarising so it fills in by itself.
  useEffect(() => {
    if (!calls.some((c) => stateOf(c) === "summarising")) return;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [calls]);

  const assign = async (
    callId: string,
    c: { id: string; name: string } | null
  ) => {
    setAssigningId("");
    setCalls((prev) =>
      prev.map((x) =>
        x.id === callId
          ? { ...x, company_id: c?.id || null, company: c?.name || null }
          : x
      )
    );
    try {
      await crmFetch(`/api/crm/calls/${encodeURIComponent(callId)}/assign`, {
        method: "POST",
        body: JSON.stringify({ companyId: c?.id || null }),
      });
    } catch {
      load();
    }
  };

  const retry = async (c: Call) => {
    if (!c.session_id) return;
    setRetrying(c.id);
    try {
      await crmFetch("/api/interview/retry-summary", {
        method: "POST",
        body: JSON.stringify({ sessionId: c.session_id }),
      });
    } catch {
      /* the sweep keeps trying either way */
    }
    setRetrying("");
    load();
  };

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
  const broken = calls.filter((c) => stateOf(c) === "failed").length;

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

      {broken > 0 && (
        <div className="mb-3 rounded-lg border border-rust/40 bg-rust/10 px-3 py-2 font-mono text-[0.62rem] text-rust">
          {broken} call{broken === 1 ? "" : "s"} captured but not summarised. The
          transcript is safe, hit retry to rebuild the scorecard.
        </div>
      )}

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
            Calls appear here as soon as they are captured, before the summary
            has even finished.
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
          {shown.map((c) => {
            const st = stateOf(c);
            const href = hrefFor(c);
            return (
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
                  {c.company ? (
                    c.company
                  ) : assigningId === c.id ? (
                    <CompanyLinkPicker
                      value={null}
                      onChange={(v) => assign(c.id, v)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAssigningId(c.id)}
                      className="rounded-full border border-rust/50 bg-rust/10 px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider text-rust transition hover:bg-rust/20"
                      title="attach this call to a client"
                    >
                      attach ▸
                    </button>
                  )}
                </span>
                <span className="font-mono text-[0.62rem] text-muted">
                  {fmtDate(c.created_at)}
                  {st === "summarising" && (
                    <span className="ml-1.5 text-sky/80">· summarising…</span>
                  )}
                  {st === "failed" && (
                    <span className="ml-1.5 text-rust">· summary failed</span>
                  )}
                  {st === "unrecorded" && (
                    <span className="ml-1.5 text-amber/80">· not recorded</span>
                  )}
                </span>
                <span className="text-right font-mono text-[0.66rem] text-sage">
                  {st === "scored" ? gbp(c.cost) : "—"}
                </span>
                <span className="text-right">
                  {st === "failed" ? (
                    <button
                      type="button"
                      onClick={() => retry(c)}
                      disabled={retrying === c.id}
                      className="rounded-full border border-amber/50 bg-amber/10 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:opacity-50"
                      title={c.error || "rebuild this summary now"}
                    >
                      {retrying === c.id ? "retrying…" : "retry ↻"}
                    </button>
                  ) : href ? (
                    <Link
                      href={href}
                      className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
                    >
                      {st === "unrecorded" ? "log ↗" : "view ↗"}
                    </Link>
                  ) : (
                    <span className="font-mono text-[0.56rem] uppercase tracking-wider text-muted">
                      working…
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <NavMenu />
    </main>
  );
}
