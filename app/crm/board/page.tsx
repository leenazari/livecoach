"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { crmFetch, type Company } from "@/lib/crm";
import NavMenu from "@/components/crm/NavMenu";
import TaskList from "@/components/crm/TaskList";
import OpportunityClosePlan, {
  type ClosePlan,
} from "@/components/crm/OpportunityClosePlan";
import ClientPortfolio, {
  type ClientPortfolioRow,
  type ClientPortfolioTotals,
} from "@/components/crm/ClientPortfolio";

type Tab = "tasks" | "drafts" | "opportunities" | "clients";
const TABS: { key: Tab; label: string }[] = [
  { key: "tasks", label: "Tasks to do" },
  { key: "drafts", label: "Drafts" },
  { key: "opportunities", label: "Opportunities" },
  { key: "clients", label: "Clients" },
];

function BoardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("tasks");
  const [drafts, setDrafts] = useState<any[]>([]);
  const [emailTasks, setEmailTasks] = useState<any[]>([]);
  const [opps, setOpps] = useState<any[]>([]);
  const [companies, setCompanies] = useState<ClientPortfolioRow[]>([]);
  const [clientTotals, setClientTotals] = useState<ClientPortfolioTotals>({
    all: 0,
    red: 0,
    amber: 0,
    green: 0,
    grey: 0,
    opportunities: 0,
  });
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState("");
  const [newName, setNewName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [openOpportunity, setOpenOpportunity] = useState("");
  const [savingClientId, setSavingClientId] = useState("");

  // Follow the ?tab= param. Using useSearchParams means this re-runs when the
  // query changes (e.g. clicking Drafts in the side menu while already on the
  // board), not only on first mount - that was the "drafts won't load" bug.
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "drafts" || t === "opportunities" || t === "clients" || t === "tasks") {
      setTab(t as Tab);
    }
  }, [searchParams]);

  const switchTab = (next: Tab) => {
    setTab(next);
    router.replace(`/crm/board?tab=${next}`, { scroll: false });
  };

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    setSaveError("");
    try {
      if (which === "tasks") {
        // TaskList owns this request and its optimistic persistence. Avoid a
        // second dashboard fetch for data this page never renders itself.
      } else if (which === "drafts") {
        // Drafts = emails already written (follow_ups, ready to send) PLUS the
        // email next steps that still need drafting (ready to be drafted).
        const [d, t] = await Promise.all([
          crmFetch<any>("/api/crm/drafts"),
          crmFetch<any>("/api/crm/tasks"),
        ]);
        setDrafts(d.drafts || []);
        setEmailTasks(
          (t.tasks || []).filter(
            (x: any) => x.link_kind === "email" && x.status === "open"
          )
        );
      } else if (which === "opportunities") {
        const d = await crmFetch<any>("/api/crm/opportunities?status=open");
        setOpps(d.opportunities || []);
      } else {
        const d = await crmFetch<{
          clients: ClientPortfolioRow[];
          totals: ClientPortfolioTotals;
        }>("/api/crm/clients/portfolio");
        setCompanies(d.clients || []);
        setClientTotals(d.totals || {
          all: 0,
          red: 0,
          amber: 0,
          green: 0,
          grey: 0,
          opportunities: 0,
        });
      }
    } catch (error: any) {
      setSaveError(error?.message || "That section could not be loaded. Please try again.");
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
    } catch (error: any) {
      setSaveError(error?.message || "That client could not be created. Please try again.");
    }
  };
  // An "email to draft" task -> open the assistant to write it.
  const draftEmail = (t: any) =>
    window.dispatchEvent(
      new CustomEvent("lc:draft-email", {
        detail: { companyId: t.company_id, companyName: t.company, text: t.text },
      })
    );
  const setDraftStatus = async (id: string, status: string) => {
    // Dismissing removes it from view (and it won't come back - the drafts feed
    // only returns status='draft'). Other statuses (e.g. sent) stay, dimmed.
    const previous = drafts;
    setSaveError("");
    setDrafts((p) =>
      status === "dismissed"
        ? p.filter((x) => x.id !== id)
        : p.map((x) => (x.id === id ? { ...x, status } : x))
    );
    try {
      await crmFetch(`/api/crm/follow-ups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    } catch {
      setDrafts(previous);
      setSaveError("That draft change did not save. Please try again.");
    }
  };
  // Dismiss an "email to draft" task - removes it from the whole pipeline.
  const dismissTask = async (id: string) => {
    const previous = emailTasks;
    setSaveError("");
    setEmailTasks((p) => p.filter((x) => x.id !== id));
    try {
      await crmFetch(`/api/crm/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "dismissed" }),
      });
    } catch {
      setEmailTasks(previous);
      setSaveError("That task was not removed. Please try again.");
    }
  };
  const setOppStatus = async (id: string, status: string) => {
    const previous = opps;
    setSaveError("");
    setOpps((p) => p.filter((x) => x.id !== id));
    try {
      await crmFetch(`/api/crm/opportunities/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    } catch {
      setOpps(previous);
      setSaveError("That opportunity change did not save. Please try again.");
    }
  };
  const createCompany = async () => {
    if (!newName.trim()) return;
    try {
      await crmFetch<{ company: Company }>("/api/crm/companies", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim() }),
      });
      setNewName("");
      await load("clients");
    } catch {
      /* ignore */
    }
  };
  const deleteCompany = async (id: string, name: string) => {
    if (!confirm(`Delete ${name} and all its contacts and history?`)) return;
    const previous = companies;
    const previousTotals = clientTotals;
    setSaveError("");
    const deleted = previous.find((row) => row.id === id);
    setCompanies((p) => p.filter((c) => c.id !== id));
    setClientTotals((totals) => ({
      ...totals,
      all: Math.max(0, totals.all - 1),
      red: Math.max(0, totals.red - (deleted?.health === "red" ? 1 : 0)),
      amber: Math.max(0, totals.amber - (deleted?.health === "amber" ? 1 : 0)),
      green: Math.max(0, totals.green - (deleted?.health === "green" ? 1 : 0)),
      grey: Math.max(0, totals.grey - (deleted?.health === "grey" ? 1 : 0)),
      opportunities: Math.max(0, totals.opportunities - (deleted?.opportunity ? 1 : 0)),
    }));
    try {
      await crmFetch(`/api/crm/companies/${id}`, { method: "DELETE" });
    } catch {
      setCompanies(previous);
      setClientTotals(previousTotals);
      setSaveError("That client was not deleted. Please try again.");
    }
  };
  const setCompanyStage = async (id: string, stage: string) => {
    const previous = companies;
    const requestedStage = stage || null;
    setSavingClientId(id);
    setSaveError("");
    setCompanies((rows) =>
      rows.map((row) =>
        row.id === id ? { ...row, relationshipStage: requestedStage } : row
      )
    );
    try {
      const { company } = await crmFetch<{ company: Company }>(
        `/api/crm/companies/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ stage }),
        }
      );
      const savedStage = company.stage || null;
      if (savedStage !== requestedStage) {
        throw new Error("The database returned a different relationship stage");
      }
      // The PATCH response is the authoritative database row. Do not
      // immediately reload the whole portfolio: a slower/stale portfolio read
      // can otherwise repaint the old stage a moment after this confirmed save.
      setCompanies((rows) =>
        rows.map((row) =>
          row.id === id ? { ...row, relationshipStage: savedStage } : row
        )
      );
    } catch {
      setCompanies(previous);
      setSaveError("That relationship stage did not save. Please try again.");
    } finally {
      setSavingClientId("");
    }
  };

  return (
    <main
      className={`relative z-10 mx-auto px-3 py-6 sm:px-5 sm:py-10 ${
        tab === "clients" ? "max-w-[1440px]" : "max-w-[1000px]"
      }`}
    >
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
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
      {saveError ? (
        <p className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 font-sans text-[0.8rem] text-rust">
          {saveError}
        </p>
      ) : null}

      <nav className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
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

      {loading && tab !== "tasks" ? (
        <p className="font-mono text-sm text-muted">loading…</p>
      ) : tab === "tasks" ? (
        <div className="rounded-xl border border-edge bg-panel/40 p-4">
          {/* Tick to complete, click ticked to remove, click text to start. */}
          <TaskList showCompany emptyText="Nothing on your plate. Nice." />
        </div>
      ) : tab === "drafts" ? (
        <div className="flex flex-col gap-3">
          {/* EMAILS TO DRAFT - email next steps you haven't written yet. */}
          {emailTasks.length > 0 && (
            <div className="rounded-xl border border-sky/40 bg-sky/[0.06] p-4">
              <p className="mb-2.5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
                ✉ Emails to draft{" "}
                <span className="text-muted">({emailTasks.length})</span>
              </p>
              <ul className="flex flex-col">
                {emailTasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2.5 border-b border-edge/40 py-2 last:border-none"
                  >
                    <span className="flex-1 font-sans text-[0.84rem] text-bone">
                      {t.text}
                      {t.company && (
                        <span className="ml-1.5 font-mono text-[0.58rem] text-sky">
                          · {t.company}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => draftEmail(t)}
                      className="shrink-0 rounded-full border border-sky/50 bg-sky/10 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/20"
                    >
                      draft it
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissTask(t.id)}
                      title="dismiss - removes it everywhere"
                      aria-label="dismiss"
                      className="shrink-0 font-mono text-[0.8rem] text-muted transition hover:text-rust"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {emailTasks.length > 0 && (
            <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-amber">
              Ready to send
            </p>
          )}
          {drafts.length === 0 && (
            <p className="font-mono text-[0.66rem] text-muted">
              No written drafts yet. After a call, a ready-to-send draft lands
              here.
            </p>
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
            <li key={o.id} className="rounded-xl border border-edge bg-panel/40 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setOpenOpportunity((id) => (id === o.id ? "" : o.id))}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="font-sans text-[0.9rem] text-bone">
                    <span className="mr-1.5 font-mono text-[0.65rem] text-muted">
                      {openOpportunity === o.id ? "▾" : "▸"}
                    </span>
                    {o.title}
                    {o.value != null && Number(o.value) > 0 && (
                      <span className="ml-2 font-mono text-[0.62rem] text-sage">£{Number(o.value).toLocaleString()}</span>
                    )}
                  </p>
                  {o.detail && <p className="mt-0.5 font-sans text-[0.8rem] text-bone/70">{o.detail}</p>}
                  <span className="font-mono text-[0.58rem] text-sky">{o.company}</span>
                </button>
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
              </div>
              {Array.isArray(o.alerts) && o.alerts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {o.alerts.slice(0, 4).map((alert: any) => (
                    <span
                      key={alert.code}
                      className={`rounded-full border px-2 py-0.5 font-mono text-[0.52rem] uppercase tracking-wider ${
                        alert.priority === 1
                          ? "border-rust/55 bg-rust/10 text-rust"
                          : "border-amber/45 bg-amber/10 text-amber"
                      }`}
                    >
                      {alert.priority === 1 ? "▲ " : ""}{alert.label}
                    </span>
                  ))}
                </div>
              )}
              {openOpportunity === o.id && (
                <>
                  <OpportunityClosePlan
                    opportunityId={o.id}
                    initialPlan={o.close_plan}
                    onSaved={(closePlan: ClosePlan) =>
                      setOpps((items) =>
                        items.map((item) =>
                          item.id === o.id
                            ? { ...item, close_plan: closePlan }
                            : item
                        )
                      )
                    }
                  />
                  <div className="mt-2 text-right">
                    <Link
                      href={`/crm/${o.company_id}`}
                      className="font-mono text-[0.54rem] uppercase tracking-wider text-sky hover:text-amber"
                    >
                      open full client record ↗
                    </Link>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <ClientPortfolio
          clients={companies}
          totals={clientTotals}
          newName={newName}
          setNewName={setNewName}
          onCreate={createCompany}
          onDelete={deleteCompany}
          onStageChange={setCompanyStage}
          savingId={savingClientId}
        />
      )}
      <NavMenu />
    </main>
  );
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function BoardPage() {
  return (
    <Suspense fallback={null}>
      <BoardInner />
    </Suspense>
  );
}
