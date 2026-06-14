"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, type Company } from "@/lib/crm";

export default function CrmPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [newName, setNewName] = useState("");
  const [newSector, setNewSector] = useState("");
  const [creating, setCreating] = useState(false);
  const [dash, setDash] = useState<{
    kpis: { tasks: number; drafts: number; openOppValue: number; openOppCount: number };
    tasks: { text: string; company: string; companyId: string; kind: string; note?: string }[];
    dayRead: string;
  } | null>(null);

  useEffect(() => {
    crmFetch<any>("/api/crm/dashboard")
      .then((d) => setDash(d))
      .catch(() => {});
  }, []);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setErr("");
    try {
      const { companies } = await crmFetch<{ companies: Company[] }>(
        `/api/crm/companies${query ? `?q=${encodeURIComponent(query)}` : ""}`
      );
      setCompanies(companies);
    } catch (e: any) {
      setErr(e.message || "could not load companies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setErr("");
    try {
      const { company } = await crmFetch<{ company: Company }>(
        "/api/crm/companies",
        {
          method: "POST",
          body: JSON.stringify({
            name: newName.trim(),
            sector: newSector.trim() || undefined,
          }),
        }
      );
      setCompanies((prev) => [company, ...prev]);
      setNewName("");
      setNewSector("");
    } catch (e: any) {
      setErr(e.message || "could not create the company");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="relative z-10 mx-auto max-w-[1100px] px-5 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.55rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / clients
          </span>
        </h1>
        <Link
          href="/call"
          className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ back to a call
        </Link>
      </header>

      {/* DASHBOARD - everything on your plate, across all clients. */}
      {dash && (dash.tasks.length > 0 || dash.kpis.openOppCount > 0) && (
        <div className="mb-6">
          {dash.dayRead && (
            <div className="mb-3 rounded-xl border border-sky/40 bg-sky/[0.06] p-4">
              <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-sky">
                {"▣"} Your day
              </p>
              <p className="font-sans text-sm leading-relaxed text-bone/85">
                {dash.dayRead}
              </p>
            </div>
          )}
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-edge bg-ink/40 px-3 py-2.5">
              <div className="font-sans text-[1.1rem] text-bone">{dash.kpis.tasks}</div>
              <div className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">tasks to do</div>
            </div>
            <div className="rounded-lg border border-edge bg-ink/40 px-3 py-2.5">
              <div className="font-sans text-[1.1rem] text-bone">{dash.kpis.drafts}</div>
              <div className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">drafts to send</div>
            </div>
            <div className="rounded-lg border border-edge bg-ink/40 px-3 py-2.5">
              <div className="font-sans text-[1.1rem] text-sage">
                {dash.kpis.openOppValue > 0
                  ? `£${Number(dash.kpis.openOppValue).toLocaleString()}`
                  : dash.kpis.openOppCount}
              </div>
              <div className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">open opportunities</div>
            </div>
          </div>
          {dash.tasks.length > 0 && (
            <div className="rounded-xl border border-edge bg-panel/40 p-4">
              <p className="mb-2.5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
                {"→"} Do next
              </p>
              <ul className="flex flex-col">
                {dash.tasks.map((t, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 border-b border-edge/40 py-2 last:border-none"
                  >
                    <span className="mt-1 h-3 w-3 shrink-0 rounded border border-muted" />
                    <span className="flex-1 font-sans text-[0.84rem] leading-snug text-bone">
                      {t.text}{" "}
                      <Link
                        href={`/crm/${t.companyId}`}
                        className="font-mono text-[0.6rem] text-sky transition hover:text-amber"
                      >
                        · {t.company}
                      </Link>
                      {t.note && (
                        <span
                          className={`ml-1 font-mono text-[0.56rem] ${
                            t.kind === "draft" ? "text-sage" : "text-muted"
                          }`}
                        >
                          · {t.note}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-edge bg-panel/50 p-4 sm:flex-row sm:items-end">
        <div className="flex-1">
          <span className="mb-1 block font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted">
            New company
          </span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Company name"
              className="flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
            />
            <input
              value={newSector}
              onChange={(e) => setNewSector(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Sector (optional)"
              className="rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60 sm:w-48"
            />
            <button
              type="button"
              onClick={create}
              disabled={creating || !newName.trim()}
              className="rounded-full border border-amber/60 bg-amber/15 px-5 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
            >
              {creating ? "adding…" : "add"}
            </button>
          </div>
        </div>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search companies…"
        className="mb-4 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
      />

      {err && <p className="mb-3 font-mono text-[0.66rem] text-rust">{err}</p>}

      {loading ? (
        <p className="font-mono text-sm text-muted">loading…</p>
      ) : companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge p-8 text-center">
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-bone">
            No companies yet
          </p>
          <p className="mt-1.5 font-mono text-[0.62rem] text-muted">
            Add your first one above. Every call you run can then attach to a
            company and build its history.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {companies.map((c) => (
            <li key={c.id}>
              <Link
                href={`/crm/${c.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-panel/40 px-4 py-3 transition hover:border-amber/40 hover:bg-panel/70"
              >
                <div className="min-w-0">
                  <p className="truncate font-sans text-[0.95rem] text-bone">
                    {c.name}
                  </p>
                  <p className="truncate font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                    {[c.sector, c.stage, c.domain].filter(Boolean).join(" · ") ||
                      "no details yet"}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[0.7rem] text-muted">
                  ▸
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
