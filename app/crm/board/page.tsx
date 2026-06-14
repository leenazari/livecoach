"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { crmFetch, type Company } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";
import GlobalAssistant from "@/components/crm/GlobalAssistant";

type Tab = "tasks" | "drafts" | "opportunities" | "clients";
const TABS: { key: Tab; label: string }[] = [
  { key: "tasks", label: "Tasks to do" },
  { key: "drafts", label: "Drafts" },
  { key: "opportunities", label: "Opportunities" },
  { key: "clients", label: "Clients" },
];

export default function BoardPage() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [tasks, setTasks] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [opps, setOpps] = useState<any[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState("");
  const [newName, setNewName] = useState("");

  // Initial tab from ?tab= (read from location to avoid a Suspense boundary).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "drafts" || t === "opportunities" || t === "clients" || t === "tasks") {
      setTab(t);
    }
  }, []);

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    try {
      if (which === "tasks") {
        const d = await crmFetch<any>("/api/crm/dashboard");
        setTasks(d.tasks || []);
      } else if (which === "drafts") {
        const d = await crmFetch<any>("/api/crm/drafts");
        setDrafts(d.drafts || []);
      } else if (which === "opportunities") {
        const d = await crmFetch<any>("/api/crm/opportunities?status=open");
        setOpps(d.opportunities || []);
      } else {
        const d = await crmFetch<{ companies: Company[] }>("/api/crm/companies");
        setCompanies(d.companies || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  const copyDraft = async (d: any) => {
    try {
      await navigator.clipboard.writeText(
        `Subject: ${d.draft_subject || ""}\n\n${d.draft_body || ""}`
      );
      setCopiedId(d.id);
      setTimeout(() => setCopiedId(""), 1500);
    } catch {
      /* ignore */
    }
  };
  const setDraftStatus = (id: string, status: string) => {
    setDrafts((p) => p.map((x) => (x.id === id ? { ...x, status } : x)));
    crmFetch(`/api/crm/follow-ups/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch(() => {});
  };
  const setOppStatus = (id: string, status: string) => {
    setOpps((p) => p.filter((x) => x.id !== id));
    crmFetch(`/api/crm/opportunities/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch(() => {});
  };
  const createCompany = async () => {
    if (!newName.trim()) return;
    try {
      const { company } = await crmFetch<{ company: Company }>("/api/crm/companies", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      setCompanies((p) => [company, ...p]);
      setNewName("");
    } catch {
      /* ignore */
    }
  };
  const deleteCompany = async (id: string, name: string) => {
    if (!confirm(`Delete ${name} and all its contacts and history?`)) return;
    setCompanies((p) => p.filter((c) => c.id !== id));
    crmFetch(`/api/crm/companies/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const shown = companies.filter((c) =>
    q.trim() ? c.name.toLowerCase().includes(q.trim().toLowerCase()) : true
  );

  return (
    <main className="relative z-10 mx-auto max-w-[1000px] px-5 py-10">
      <header className="mb-5 flex items-center justify-between gap-3 border-b border-edge pb-3">
        <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
          <span className="italic text-amber">Live</span>Coach{" "}
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted">
            / {TABS.find((t) => t.key === tab)?.label}
          </span>
        </h1>
        <Link
          href="/crm"
          className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          ◂ dashboard
        </Link>
      </header>

      <nav className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3.5 py-1.5 font-mono text-[0.62rem] uppercase tracking-wider transition ${
              tab === t.key
                ? "border border-amber/60 bg-amber/15 text-amber"
                : "border border-edge text-muted hover:text-bone"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <p className="font-mono text-sm text-muted">loading…</p>
      ) : tab === "tasks" ? (
        <ul className="flex flex-col rounded-xl border border-edge bg-panel/40 p-4">
          {tasks.length === 0 && (
            <li className="font-mono text-[0.66rem] text-muted">Nothing on your plate. Nice.</li>
          )}
          {tasks.map((t, i) => (
            <li key={i} className="flex items-start gap-2.5 border-b border-edge/40 py-2.5 last:border-none">
              <span className="mt-1 h-3 w-3 shrink-0 rounded border border-muted" />
              <span className="flex-1 font-sans text-[0.86rem] leading-snug text-bone">
                {t.text}{" "}
                <Link href={`/crm/${t.companyId}`} className="font-mono text-[0.6rem] text-sky hover:text-amber">
                  · {t.company}
                </Link>
                {t.note && <span className="ml-1 font-mono text-[0.56rem] text-muted">· {t.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : tab === "drafts" ? (
        <div className="flex flex-col gap-3">
          {drafts.length === 0 && (
            <p className="font-mono text-[0.66rem] text-muted">No drafts waiting.</p>
          )}
          {drafts.map((d) => (
            <div
              key={d.id}
              className={`rounded-xl border border-edge bg-panel/40 p-4 ${d.status === "sent" ? "opacity-60" : ""}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="font-sans text-[0.9rem] font-medium text-bone">
                  {d.draft_subject || "(no subject)"}
                </p>
                <Link href={`/crm/${d.company_id}`} className="font-mono text-[0.6rem] text-sky hover:text-amber">
                  {d.company}
                </Link>
              </div>
              <p className="whitespace-pre-wrap font-sans text-[0.82rem] leading-relaxed text-bone/80">
                {d.draft_body}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={() => copyDraft(d)} className="rounded-full border border-amber/50 bg-amber/10 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-amber hover:bg-amber/20">
                  {copiedId === d.id ? "copied" : "copy"}
                </button>
                {d.status !== "sent" && (
                  <button type="button" onClick={() => setDraftStatus(d.id, "sent")} className="rounded-full border border-sage/50 bg-sage/10 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-sage hover:bg-sage/20">
                    mark sent
                  </button>
                )}
                <button type="button" onClick={() => setDraftStatus(d.id, "dismissed")} className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted hover:text-rust">
                  dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : tab === "opportunities" ? (
        <ul className="flex flex-col gap-2">
          {opps.length === 0 && (
            <li className="font-mono text-[0.66rem] text-muted">No open opportunities.</li>
          )}
          {opps.map((o) => (
            <li key={o.id} className="flex items-start justify-between gap-3 rounded-xl border border-edge bg-panel/40 px-4 py-3">
              <div className="min-w-0">
                <p className="font-sans text-[0.9rem] text-bone">
                  {o.title}
                  {typeof o.value === "number" && (
                    <span className="ml-2 font-mono text-[0.62rem] text-sage">~£{Number(o.value).toLocaleString()}</span>
                  )}
                </p>
                {o.detail && <p className="mt-0.5 font-sans text-[0.8rem] text-bone/70">{o.detail}</p>}
                <Link href={`/crm/${o.company_id}`} className="font-mono text-[0.58rem] text-sky hover:text-amber">
                  {o.company}
                </Link>
              </div>
              <select
                value={o.status}
                onChange={(e) => setOppStatus(o.id, e.target.value)}
                className="shrink-0 rounded-md border border-edge bg-ink/60 px-2 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-bone outline-none focus:border-amber/60"
              >
                <option value="open">open</option>
                <option value="won">won</option>
                <option value="lost">lost</option>
                <option value="dismissed">dismissed</option>
              </select>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createCompany()}
              placeholder="New client name"
              className="flex-1 rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
            />
            <button type="button" onClick={createCompany} disabled={!newName.trim()} className="rounded-full border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber hover:bg-amber/25 disabled:opacity-40">
              add
            </button>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients…"
            className="w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none focus:border-amber/60"
          />
          <ul className="flex flex-col gap-2">
            {shown.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-panel/40 px-4 py-3">
                <Link href={`/crm/${c.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-sans text-[0.95rem] text-bone">{c.name}</p>
                  <p className="truncate font-mono text-[0.58rem] uppercase tracking-wider text-muted">
                    {[c.sector, c.stage].filter(Boolean).join(" · ") || "no details yet"}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => deleteCompany(c.id, c.name)}
                  title="delete client"
                  className="shrink-0 rounded px-2 py-1 font-mono text-[0.8rem] text-muted transition hover:text-rust"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <GlobalAssistant />
      <NavMenu />
    </main>
  );
}
