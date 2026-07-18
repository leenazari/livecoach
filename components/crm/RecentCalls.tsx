"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";

type CallState = "scored" | "summarising" | "failed" | "unrecorded";

type Call = {
  id: string;
  candidate: string | null;
  company_id: string | null;
  company: string | null;
  created_at: string;
  scored?: boolean;
  state?: CallState;
  session_id?: string | null;
  error?: string | null;
};

const stateOf = (c: Call): CallState =>
  c.state || (c.scored === false ? "unrecorded" : "scored");

// A scored call opens its scorecard. A call that happened but was never
// recorded opens the quick "log a call" recap for that client (with the client
// pre-filled where we know it). A captured call still summarising, or one whose
// summary failed, has no scorecard page yet, so it stays put and shows its own
// state and a retry instead of leading nowhere.
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

// Recent calls on the dashboard, so a call is never lost.
//
// NOTHING IS INVISIBLE. Every captured call appears the moment it is recorded,
// carrying its own state: summarising, summary failed (with a retry), or done.
// A call with no client is tagged "unassigned" with a one-click type-ahead
// picker to attach it to the right client whenever you get to it. Attaching
// links the scorecard AND the call event, and works even before a summary
// exists (see /api/crm/calls/[id]/assign).
export default function RecentCalls() {
  const seed = getCached<{ calls: Call[] }>("/api/crm/calls")?.calls;
  const [calls, setCalls] = useState<Call[]>(() => (seed || []).slice(0, 8));
  const [loaded, setLoaded] = useState<boolean>(() => !!seed);
  const [assigningId, setAssigningId] = useState<string>("");
  const [retrying, setRetrying] = useState<string>("");

  const load = () => {
    crmFetch<{ calls: Call[] }>("/api/crm/calls")
      .then((d) => {
        setCalls((d.calls || []).slice(0, 8));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  };
  useEffect(() => {
    load();
    // Live-update: a freshly summarised call (incl. the safety-net sweep)
    // appears without a manual reload, on broadcast and on tab focus.
    const onRefresh = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden")
        return;
      load();
    };
    window.addEventListener("lc:tasks-updated", onRefresh);
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      window.removeEventListener("lc:tasks-updated", onRefresh);
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, []);

  // A call still summarising will finish on its own, so poll gently while any
  // are in flight rather than making the user reload to find out.
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
    // Optimistic update so it moves out of "unassigned" immediately.
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
      load(); // revert to truth if it failed
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
      /* the sweep will keep trying either way */
    }
    setRetrying("");
    load();
  };

  const fmt = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  if (loaded && calls.length === 0) return null;
  const unassigned = calls.filter((c) => !c.company_id).length;
  const broken = calls.filter((c) => stateOf(c) === "failed").length;

  return (
    <div className="mb-3 rounded-xl border border-edge bg-panel/40 p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"☎"} Recent calls
          {broken ? (
            <span className="ml-2 rounded-full border border-rust/50 bg-rust/10 px-2 py-0.5 text-[0.5rem] text-rust">
              {broken} need a retry
            </span>
          ) : null}
          {unassigned ? (
            <span className="ml-2 rounded-full border border-rust/50 bg-rust/10 px-2 py-0.5 text-[0.5rem] text-rust">
              {unassigned} unassigned
            </span>
          ) : null}
        </p>
        <Link
          href="/crm/calls"
          className="font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-amber"
        >
          see all ↗
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-edge/50">
        {calls.map((c) => {
          const st = stateOf(c);
          const href = hrefFor(c);
          const label = (
            <>
              <span className="block truncate font-sans text-[0.86rem] text-bone">
                {c.candidate || "Call"}
              </span>
              <span className="font-mono text-[0.53rem] uppercase tracking-wider text-muted">
                {fmt(c.created_at)}
                {st === "summarising" && (
                  <span className="ml-2 text-sky/80">summarising…</span>
                )}
                {st === "failed" && (
                  <span className="ml-2 text-rust">summary failed</span>
                )}
                {st === "unrecorded" && (
                  <span className="ml-2 text-amber/80">not recorded · log it</span>
                )}
              </span>
            </>
          );
          return (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              {href ? (
                <Link href={href} className="min-w-0 flex-1">
                  {label}
                </Link>
              ) : (
                <div className="min-w-0 flex-1">{label}</div>
              )}
              <div className="flex shrink-0 items-center gap-1.5">
                {st === "failed" && (
                  <button
                    type="button"
                    onClick={() => retry(c)}
                    disabled={retrying === c.id}
                    className="rounded-full border border-amber/50 bg-amber/10 px-2.5 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:opacity-50"
                    title={c.error || "rebuild this summary now"}
                  >
                    {retrying === c.id ? "retrying…" : "retry"}
                  </button>
                )}
                {c.company_id ? (
                  <Link
                    href={`/crm/${c.company_id}`}
                    className="rounded-full border border-sky/40 bg-sky/10 px-2.5 py-1 font-mono text-[0.56rem] text-sky transition hover:bg-sky/20"
                  >
                    {c.company || "client"}
                  </Link>
                ) : assigningId === c.id ? (
                  <CompanyLinkPicker value={null} onChange={(v) => assign(c.id, v)} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAssigningId(c.id)}
                    className="rounded-full border border-rust/50 bg-rust/10 px-2.5 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-rust transition hover:bg-rust/20"
                    title="attach this call to a client"
                  >
                    unassigned · attach
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
