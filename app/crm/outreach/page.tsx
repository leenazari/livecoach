"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";

type Priority = "high" | "medium" | "low";
type Prospect = {
  id: string; email: string; first_name: string | null; last_name: string | null;
  job_title: string | null; company_name: string; website: string | null;
  employee_range: string | null; industry: string | null; phone: string | null;
  person_linkedin_url: string | null; company_linkedin_url: string | null;
  company_house_url: string | null; priority: Priority; priority_score: number;
  priority_reason: string | null; status: string;
};

const priorityClass: Record<Priority, string> = {
  high: "border-rust/50 bg-rust/10 text-rust",
  medium: "border-amber/50 bg-amber/10 text-amber",
  low: "border-edge bg-ink/40 text-muted",
};

export default function OutreachPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Priority>("all");
  const [error, setError] = useState("");

  useEffect(() => {
    crmFetch<{ prospects: Prospect[] }>("/api/crm/outreach")
      .then((d) => setProspects(d.prospects || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => ({
    all: prospects.length,
    high: prospects.filter((p) => p.priority === "high").length,
    medium: prospects.filter((p) => p.priority === "medium").length,
    low: prospects.filter((p) => p.priority === "low").length,
  }), [prospects]);
  const needle = q.trim().toLowerCase();
  const shown = prospects.filter((p) =>
    (filter === "all" || p.priority === filter) &&
    (!needle || `${p.first_name || ""} ${p.last_name || ""} ${p.company_name} ${p.job_title || ""} ${p.email}`.toLowerCase().includes(needle))
  );

  const setPriority = async (id: string, priority: Priority) => {
    const previous = prospects;
    setProspects((rows) => rows.map((p) => p.id === id ? { ...p, priority } : p));
    try {
      await crmFetch(`/api/crm/outreach/${id}`, { method: "PATCH", body: JSON.stringify({ priority }) });
    } catch (e: any) {
      setProspects(previous);
      setError(e.message || "That priority did not save.");
    }
  };

  return (
    <main className="relative z-10 mx-auto max-w-[1180px] px-4 py-8 sm:px-5 sm:py-10">
      <NavMenu />
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <div>
          <h1 className="font-display text-[1.55rem] tracking-tight text-bone"><span className="italic text-amber">Outreach</span> prospects</h1>
          <p className="mt-1 font-mono text-[0.6rem] uppercase tracking-wider text-muted">Imported only · no research or emails sent</p>
        </div>
        <Link href="/crm" className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted hover:border-amber/50 hover:text-amber">◂ dashboard</Link>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["all", "high", "medium", "low"] as const).map((key) => (
          <button key={key} onClick={() => setFilter(key)} className={`rounded-xl border p-3 text-left ${filter === key ? "border-amber bg-amber/10" : "border-edge bg-panel"}`}>
            <span className="block font-display text-2xl text-bone">{counts[key]}</span>
            <span className="font-mono text-[0.58rem] uppercase tracking-wider text-muted">{key === "all" ? "All prospects" : `${key} priority`}</span>
          </button>
        ))}
      </section>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person, company, role or email…" className="mb-4 w-full rounded-lg border border-edge bg-ink/40 px-3 py-3 font-mono text-[0.7rem] text-bone placeholder:text-muted focus:border-amber/50 focus:outline-none" />
      {error && <p className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p>}
      {loading ? <p className="font-mono text-xs text-muted">Loading prospects…</p> : (
        <div className="space-y-2">
          {shown.map((p) => (
            <article key={p.id} className="rounded-xl border border-edge bg-panel p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-lg text-bone">{p.first_name} {p.last_name}</h2>
                    <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.55rem] uppercase ${priorityClass[p.priority]}`}>{p.priority}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-bone/80">{p.job_title || "Role not supplied"} · {p.company_name}</p>
                  <p className="mt-1 text-xs text-muted">{p.employee_range || "Size unknown"} employees · {p.industry || "Sector unknown"}</p>
                  <p className="mt-2 text-xs text-muted">{p.priority_reason}</p>
                  <div className="mt-3 flex flex-wrap gap-3 font-mono text-[0.62rem]">
                    <a className="text-amber hover:underline" href={`mailto:${p.email}`}>{p.email}</a>
                    {p.person_linkedin_url && <a className="text-bone hover:text-amber" href={p.person_linkedin_url} target="_blank" rel="noreferrer">Person LinkedIn ↗</a>}
                    {p.company_linkedin_url && <a className="text-bone hover:text-amber" href={p.company_linkedin_url} target="_blank" rel="noreferrer">Company LinkedIn ↗</a>}
                    {p.website && <a className="text-bone hover:text-amber" href={p.website} target="_blank" rel="noreferrer">Website ↗</a>}
                  </div>
                </div>
                <label className="flex shrink-0 items-center gap-2 font-mono text-[0.58rem] uppercase tracking-wider text-muted">
                  Priority
                  <select value={p.priority} onChange={(e) => setPriority(p.id, e.target.value as Priority)} className="rounded-lg border border-edge bg-ink px-2 py-2 text-bone">
                    <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </label>
              </div>
            </article>
          ))}
          {!shown.length && <p className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">No prospects match that filter.</p>}
        </div>
      )}
    </main>
  );
}
