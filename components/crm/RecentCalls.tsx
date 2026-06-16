"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached } from "@/lib/crm";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";

type Call = {
  id: string;
  candidate: string | null;
  company_id: string | null;
  company: string | null;
  created_at: string;
};

// Recent calls on the dashboard, so a call is never lost. Any call with no
// client is tagged "Unassigned" with a one-click type-ahead picker to assign it
// to the right client whenever you get to it. Assigning links both the
// scorecard and the call event (see /api/crm/calls/[id]/assign).
export default function RecentCalls() {
  const seed = getCached<{ calls: Call[] }>("/api/crm/calls")?.calls;
  const [calls, setCalls] = useState<Call[]>(() => (seed || []).slice(0, 8));
  const [loaded, setLoaded] = useState<boolean>(() => !!seed);
  const [assigningId, setAssigningId] = useState<string>("");

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
  }, []);

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
      await crmFetch(`/api/crm/calls/${callId}/assign`, {
        method: "POST",
        body: JSON.stringify({ companyId: c?.id || null }),
      });
    } catch {
      load(); // revert to truth if it failed
    }
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

  return (
    <div className="mb-3 rounded-xl border border-edge bg-panel/40 p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          {"☎"} Recent calls
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
        {calls.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <Link href={`/crm/calls/${c.id}`} className="min-w-0 flex-1">
              <span className="block truncate font-sans text-[0.86rem] text-bone">
                {c.candidate || "Call"}
              </span>
              <span className="font-mono text-[0.53rem] uppercase tracking-wider text-muted">
                {fmt(c.created_at)}
              </span>
            </Link>
            {c.company_id ? (
              <Link
                href={`/crm/${c.company_id}`}
                className="shrink-0 rounded-full border border-sky/40 bg-sky/10 px-2.5 py-1 font-mono text-[0.56rem] text-sky transition hover:bg-sky/20"
              >
                {c.company || "client"}
              </Link>
            ) : assigningId === c.id ? (
              <div className="shrink-0">
                <CompanyLinkPicker value={null} onChange={(v) => assign(c.id, v)} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAssigningId(c.id)}
                className="shrink-0 rounded-full border border-rust/50 bg-rust/10 px-2.5 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-rust transition hover:bg-rust/20"
                title="assign this call to a client"
              >
                unassigned · assign
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
