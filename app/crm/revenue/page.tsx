"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import { crmConfirmationError, crmFetch, getCached } from "@/lib/crm";
import MatrixRain from "@/components/MatrixRain";
import PipelineWorkspace from "@/components/crm/PipelineWorkspace";
import OutlookIntelligencePanel, { type SignalHealth } from "@/components/crm/OutlookIntelligencePanel";
import MetricDrilldown from "@/components/crm/MetricDrilldown";
import { opportunityMatchesOwner } from "@/lib/opportunity-owner-filter";
import { outreachProspectHref } from "@/lib/crm-navigation";

type Pipeline = Record<string, any>;
type Opportunity = Record<string, any> & {
  id: string;
  company: string;
  title: string;
  value: number;
  probability: number;
  pipeline_stage: string;
  forecast_category: string;
  opportunity_type: "revenue" | "investment" | "internal" | "strategic";
  expected_close_at: string | null;
  next_action: string | null;
  next_action_due_at: string | null;
  next_action_owner: "us" | "buyer" | "joint";
  weightedValue: number;
  risks: { code: string; label: string; severity: "high" | "medium" }[];
  nextAction: string;
  deal_intent: string | null;
  deal_intent_as_of: string | null;
  deal_intent_source: "human" | "system";
  deal_intent_override: boolean;
  clearDealIntentOverride?: boolean;
  win_outlook: "not_assessed" | "at_risk" | "possible" | "likely" | "highly_likely" | "won";
  win_outlook_confidence: number | null;
  win_outlook_reasons: string[];
  win_outlook_questions: string[];
  engagement_motion: string | null;
  active_contact_method: string | null;
  assigned_to_user_id: string | null;
};

const input = "min-h-11 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-bone outline-none focus:border-amber/60";
const button = "min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-amber disabled:opacity-40";
const gbp = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0, notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard" }).format(value || 0);
const pct = (value: number) => `${Math.round((value || 0) * 10) / 10}%`;
const dateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Europe/London",
    }).format(new Date(value))
  : "Not recorded";
const typeLabels: Record<Opportunity["opportunity_type"], string> = {
  revenue: "Customer revenue",
  investment: "Investment",
  internal: "Internal project",
  strategic: "Strategic idea",
};

const REVENUE_VIEWS = new Set([
  "all",
  "raw",
  "weighted",
  "best_case",
  "commit",
  "coverage",
  "overdue",
  "meetings",
  "at_risk",
  "stalled",
  "strategic",
  "internal",
  "investment",
]);

function parseRevenueView(value: string | null): string {
  if (!value) return "all";
  if (value.startsWith("stage-") && value.length > 6)
    return `stage:${value.slice(6)}`;
  return REVENUE_VIEWS.has(value) ? value : "all";
}

function revenueViewQuery(value: string): string {
  return value.startsWith("stage:") ? `stage-${value.slice(6)}` : value;
}

function editableOpportunityRows(next: Pipeline | null): Opportunity[] {
  if (!next) return [];
  return [...(next.opportunities || []), ...(next.excludedOpportunities || [])].map(
    (row: Opportunity) => ({
      ...row,
      // Put the deterministic suggestion into editable state. Pressing Save
      // deal therefore confirms exactly what the user can see.
      next_action: row.next_action ?? row.nextAction ?? "",
    })
  );
}

export default function RevenuePage() {
  const cachedRevenue = useMemo(
    () => getCached<Pipeline>("/api/crm/revenue") || null,
    []
  );
  const [data, setData] = useState<Pipeline | null>(cachedRevenue);
  const [rows, setRows] = useState<Opportunity[]>(editableOpportunityRows(cachedRevenue));
  const [target, setTarget] = useState(cachedRevenue?.goal?.target || 2_000_000);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState("all");

  const load = useCallback(async () => {
    try {
      const next = await crmFetch<Pipeline>("/api/crm/revenue");
      setData(next);
      setRows(editableOpportunityRows(next));
      setTarget(next.goal?.target || 2_000_000);
    } catch (e: any) {
      setError(e.message || "Could not load the revenue pipeline");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const syncView = () => {
      const next = parseRevenueView(new URLSearchParams(window.location.search).get("view"));
      setDrilldown(next);
    };
    syncView();
    window.addEventListener("popstate", syncView);
    return () => window.removeEventListener("popstate", syncView);
  }, []);

  const chooseDrilldown = useCallback((next: string, target: "pipeline" | "excluded" = "pipeline") => {
    setDrilldown(next);
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("view");
    else url.searchParams.set("view", revenueViewQuery(next));
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
    window.requestAnimationFrame(() => {
      document.getElementById(target === "pipeline" ? "pipeline-records" : "excluded-records")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  const updateRow = (id: string, patch: Partial<Opportunity>) => setRows((all) => all.map((row) => row.id === id ? { ...row, ...patch } : row));
  const changeType = (row: Opportunity, opportunity_type: Opportunity["opportunity_type"]) => updateRow(row.id, {
    opportunity_type,
    forecast_category: opportunity_type === "revenue"
      ? (row.forecast_category === "omitted" ? "pipeline" : row.forecast_category)
      : "omitted",
  });
  const saveOpportunity = async (row: Opportunity) => {
    setBusy(`opp:${row.id}`); setError(""); setNotice("");
    try {
      const { opportunity: saved } = await crmFetch<{ opportunity: Opportunity }>(`/api/crm/opportunities/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          value: Number(row.value) || null,
          pipelineStage: row.pipeline_stage,
          probability: Number(row.probability) || 0,
          forecastCategory: row.forecast_category,
          opportunityType: row.opportunity_type,
          expectedCloseAt: row.expected_close_at || null,
          nextAction: row.next_action || null,
          nextActionDueAt: row.next_action_due_at ? row.next_action_due_at.slice(0, 10) : null,
          nextActionOwner: row.next_action_owner || "us",
          dealIntent: row.deal_intent || null,
          clearDealIntentOverride: row.clearDealIntentOverride === true,
          winOutlook: row.win_outlook || "not_assessed",
          winOutlookConfidence: row.win_outlook_confidence,
          winOutlookReasons: row.win_outlook_reasons || [],
          winOutlookQuestions: row.win_outlook_questions || [],
          engagementMotion: row.engagement_motion || null,
          activeContactMethod: row.active_contact_method || null,
          assignedToUserId: row.assigned_to_user_id || null,
          sourceType: "human",
          sourceChannel: "pipeline_dashboard",
          rationale: "Confirmed from the pipeline dashboard",
        }),
      });
      if (!saved?.id)
        throw crmConfirmationError({
          url: `/api/crm/opportunities/${row.id}`,
          method: "PATCH",
          reason: "LiveCoach did not return the saved forecast",
        });
      setNotice(`${row.company} forecast saved.`);
      await load();
      // Keep the exact confirmed row authoritative even if the aggregate read
      // briefly reaches an older database snapshot.
      setRows((all) => all.map((item) => item.id === saved.id ? {
        ...item,
        ...saved,
        company: item.company,
        risks: item.risks,
        nextAction: saved.next_action || item.nextAction,
        weightedValue: (Number(saved.value) || 0) * (Number(saved.probability) || 0) / 100,
      } : item));
    } catch (e: any) { setError(e.message || "That opportunity did not save"); }
    finally { setBusy(""); }
  };

  const dismissOpportunity = async (row: Opportunity) => {
    setBusy(`dismiss:${row.id}`); setError(""); setNotice("");
    try {
      const { opportunity } = await crmFetch<{ opportunity: Opportunity & { status: string } }>(`/api/crm/opportunities/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "dismissed",
          sourceType: "human",
          sourceChannel: "pipeline_dashboard",
          rationale: "Removed from the active pipeline by the user",
          evidence: { preservedHistory: true },
        }),
      });
      if (opportunity?.status !== "dismissed")
        throw crmConfirmationError({
          url: `/api/crm/opportunities/${row.id}`,
          method: "PATCH",
          reason: "LiveCoach did not confirm that the opportunity left the active pipeline",
        });
      setNotice(`${row.title} was removed from the active pipeline. Its client and history are still saved.`);
      await load();
    } catch (e: any) {
      setError(e.message || "That deal could not be removed from the pipeline");
    } finally {
      setBusy("");
    }
  };

  const saveTarget = async () => {
    setBusy("target"); setError(""); setNotice("");
    try {
      if (!Number.isFinite(target) || target < 1_000) throw new Error("Enter a revenue target of at least £1,000");
      const result = await crmFetch<{ target: number }>("/api/crm/revenue", { method: "PATCH", body: JSON.stringify({ target }) });
      if (result.target !== target)
        throw crmConfirmationError({
          url: "/api/crm/revenue",
          method: "PATCH",
          reason: "LiveCoach returned a different revenue target from the one saved",
        });
      setNotice("Revenue target saved.");
      await load();
      setTarget(result.target);
      setData((current) => current ? { ...current, goal: { ...(current.goal || {}), target: result.target } } : current);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  };

  const wonProgress = data?.goal?.target ? Math.min(100, (data.goal.wonYtd / data.goal.target) * 100) : 0;
  const activeOwnerFilter = ownerFilter || (data?.canManageAssignments ? "all" : "mine");
  const revenueRows = useMemo(
    () => rows.filter((row) => row.opportunity_type === "revenue"),
    [rows]
  );
  const visibleRevenueRows = useMemo(
    () => revenueRows.filter((row) =>
      opportunityMatchesOwner(row, activeOwnerFilter, data?.currentUser || "")
    ),
    [activeOwnerFilter, data?.currentUser, revenueRows]
  );
  const excludedRows = useMemo(
    () => rows.filter((row) =>
      row.opportunity_type !== "revenue" &&
      opportunityMatchesOwner(row, activeOwnerFilter, data?.currentUser || "")
    ),
    [activeOwnerFilter, data?.currentUser, rows]
  );
  const visibleKpis = useMemo(() => {
    const rawPipeline = visibleRevenueRows.reduce(
      (sum, row) => sum + (Number(row.value) || 0),
      0
    );
    const weightedPipeline = visibleRevenueRows.reduce(
      (sum, row) => sum + (Number(row.weightedValue) || 0),
      0
    );
    const commit = visibleRevenueRows
      .filter((row) => row.forecast_category === "commit")
      .reduce((sum, row) => sum + (Number(row.value) || 0), 0);
    const bestCase = visibleRevenueRows
      .filter((row) => ["commit", "best_case"].includes(row.forecast_category))
      .reduce((sum, row) => sum + (Number(row.value) || 0), 0);
    const gap = Number(data?.goal?.gap) || 0;
    return {
      rawPipeline,
      weightedPipeline,
      commit,
      bestCase,
      coverage: gap ? rawPipeline / gap : 0,
    };
  }, [data?.goal?.gap, visibleRevenueRows]);
  const visibleClassification = useMemo(() => ({
    revenue: visibleRevenueRows.length,
    investment: excludedRows.filter((row) => row.opportunity_type === "investment").length,
    internal: excludedRows.filter((row) => row.opportunity_type === "internal").length,
    strategic: excludedRows.filter((row) => row.opportunity_type === "strategic").length,
  }), [excludedRows, visibleRevenueRows.length]);
  const excludedDrilldown = ["strategic", "internal", "investment"].includes(drilldown)
    ? drilldown as Opportunity["opportunity_type"]
    : null;
  const shownExcludedRows = excludedDrilldown
    ? excludedRows.filter((row) => row.opportunity_type === excludedDrilldown)
    : excludedRows;
  const pipelineFocus = excludedDrilldown ? "all" : drilldown;

  return (
    <main className="relative z-10 mx-auto max-w-[1220px] px-3 py-5 sm:px-5 sm:py-9">
      <NavMenu />
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-edge pb-4">
        <div>
          <h1 className="font-display text-[1.55rem] tracking-tight text-bone"><span className="italic text-amber">Revenue</span> command centre</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">One truthful forecast from opportunities, next commitments, calls, calendar and outreach conversions.</p>
        </div>
        <Link href="/crm" className="shrink-0 rounded-full border border-edge px-3 py-2 font-mono text-[0.6rem] uppercase text-muted">◂ CRM</Link>
      </header>

      {notice ? <p className="mb-3 rounded-lg border border-moss/40 bg-moss/10 px-3 py-2 text-sm text-moss">{notice}</p> : null}
      {error ? <p className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p> : null}
      {!data ? <MatrixRain size="panel" messages={["loading the live pipeline", "checking revenue priorities"]} /> : null}

      {data ? <>
        <section className="mb-4 rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[0.58rem] uppercase tracking-wider text-amber">Annual revenue target</p>
              <p className="mt-1 font-display text-3xl text-bone">{gbp(data.goal.target)}</p>
              <p className="mt-1 text-sm text-muted">{gbp(data.goal.wonYtd)} won this year · {gbp(data.goal.gap)} still to close</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <input aria-label="Annual revenue target" type="number" min="1000" step="1000" value={Number.isNaN(target) ? "" : target} onChange={(e) => setTarget(e.target.value === "" ? Number.NaN : Number(e.target.value))} className={`${input} sm:w-44`} />
              <button onClick={saveTarget} disabled={!!busy || !Number.isFinite(target)} className={button}>{busy === "target" ? "Saving…" : "Save target"}</button>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink"><div className="h-full rounded-full bg-moss" style={{ width: `${wonProgress}%` }} /></div>
          <div className="mt-2 flex justify-between font-mono text-[0.55rem] uppercase text-muted"><span>{pct(wonProgress)} achieved</span><span>{gbp(data.goal.requiredPerMonth)}/month needed</span></div>
        </section>

        <section className="mb-4 rounded-xl border border-moss/35 bg-moss/[0.07] p-4">
          <h2 className="font-display text-lg text-bone">The forecast now counts sales only</h2>
          <p className="mt-1 text-sm leading-6 text-muted">The original 16 records mixed customer deals with fundraising, internal work and future routes. Nothing was deleted, but only genuine customer revenue is included in the figures below.</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Customer revenue", visibleClassification.revenue, "raw", "pipeline"],
              ["Strategic ideas", visibleClassification.strategic, "strategic", "excluded"],
              ["Internal projects", visibleClassification.internal, "internal", "excluded"],
              ["Investment", visibleClassification.investment, "investment", "excluded"],
            ].map(([label, value, view, target]) => (
              <MetricDrilldown
                key={String(label)}
                label={String(label)}
                value={value}
                note="Open the records behind this number"
                compact
                active={drilldown === view}
                onClick={() => chooseDrilldown(String(view), target as "pipeline" | "excluded")}
              />
            ))}
          </div>
        </section>

        <section className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
          {[
            ["Raw pipeline", visibleKpis.rawPipeline, "Customer sales only", "raw"],
            ["Weighted", visibleKpis.weightedPipeline, "Value × probability", "weighted"],
            ["Best case", visibleKpis.bestCase, "Best case + commit", "best_case"],
            ["Commit", visibleKpis.commit, "Deals you expect", "commit"],
            ["Coverage", `${Math.round(visibleKpis.coverage * 10) / 10}×`, "Pipeline ÷ target gap", "coverage"],
          ].map(([label, value, note, view]) => (
            <MetricDrilldown
              key={String(label)}
              label={String(label)}
              value={typeof value === "number" ? gbp(value) : value}
              note={note}
              compact
              active={drilldown === view}
              onClick={() => chooseDrilldown(String(view))}
            />
          ))}
        </section>

        <OutlookIntelligencePanel health={data.signalHealth as SignalHealth} />

        {data.recentOutreach?.length ? (
          <section id="recent-outreach" className="mb-4 scroll-mt-24 rounded-xl border border-sky/35 bg-panel p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-[0.53rem] uppercase tracking-wider text-sky">Linked outreach activity</p>
                <h2 className="mt-1 font-display text-lg text-bone">Your newest prospect emails</h2>
                <p className="mt-1 text-sm leading-6 text-muted">These stay visible beside the pipeline without inflating the revenue forecast before a real opportunity exists.</p>
              </div>
              <Link href="/crm/outreach?tab=prospects&sort=activity" className={`${button} inline-flex items-center justify-center`}>
                Open latest activity
              </Link>
            </div>
            <div className="mt-3 divide-y divide-edge">
              {data.recentOutreach.slice(0, 5).map((message: any) => {
                const prospectName = `${message.prospect?.first_name || ""} ${message.prospect?.last_name || ""}`.trim();
                const activityAt = message.sent_at || message.scheduled_at || message.updated_at;
                const outreachHref = outreachProspectHref(message.prospect) || "/crm/outreach?tab=prospects&sort=activity";
                return (
                  <article key={message.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_1.3fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <Link href={outreachHref} className="block truncate text-sm font-semibold text-bone transition hover:text-amber">
                        {prospectName || message.prospect?.email || "Prospect"}
                      </Link>
                      <span className="block truncate text-xs text-muted">{message.prospect?.company_name || "Company not recorded"}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-bone/85">{message.subject}</p>
                      <span className="font-mono text-[0.48rem] uppercase text-muted">{message.message_source === "brain_direct" ? "Brain email" : "Campaign email"}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="font-mono text-[0.49rem] uppercase text-muted">{dateTime(activityAt)}</span>
                      <span className={`rounded-full border px-2 py-1 font-mono text-[0.49rem] uppercase ${message.status === "sent" ? "border-moss/45 bg-moss/10 text-moss" : "border-sky/45 bg-sky/10 text-sky"}`}>
                        {message.status === "sent" ? "Sent" : message.status === "sending" ? "Sending" : "Queued"}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <div id="pipeline-records" className="scroll-mt-20">
          <PipelineWorkspace
            rows={revenueRows as any}
            stageDefinitions={data.stageDefinitions}
            team={data.team || []}
            currentUser={data.currentUser || ""}
            canManageAssignments={data.canManageAssignments === true}
            ownerFilter={activeOwnerFilter}
            onOwnerFilterChange={setOwnerFilter}
            busy={busy}
            onChange={updateRow as any}
            onSave={saveOpportunity as any}
            onDismiss={dismissOpportunity as any}
            focus={pipelineFocus}
            onFocusChange={(next) => chooseDrilldown(next)}
          />
        </div>

        {excludedRows.length ? <section id="excluded-records" className="mt-4 scroll-mt-20 rounded-xl border border-edge bg-panel p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-display text-lg text-bone">Kept outside the revenue forecast</h2><p className="mt-1 text-sm leading-6 text-muted">These records are still available as useful CRM context. Change the classification if any should become a real customer deal.</p></div>{excludedDrilldown ? <button type="button" onClick={() => chooseDrilldown("all", "excluded")} className="min-h-9 rounded-lg border border-edge px-3 font-mono text-[0.5rem] uppercase text-muted hover:border-amber/50 hover:text-amber">Show every classification</button> : null}</div>
          {excludedDrilldown ? <p className="mb-3 rounded-lg border border-amber/35 bg-amber/[0.06] px-3 py-2 text-sm text-bone">Showing {shownExcludedRows.length} {typeLabels[excludedDrilldown].toLowerCase()} records behind the selected number.</p> : null}
          <div className="space-y-2">{shownExcludedRows.map((row) => <article key={row.id} className="rounded-lg border border-edge bg-ink/30 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><strong className="text-bone">{row.company}</strong><p className="mt-0.5 text-sm text-muted">{row.title}</p>{row.value ? <p className="mt-1 text-xs text-amber">Recorded value {gbp(row.value)}, excluded from revenue</p> : null}</div><div className="flex w-full gap-2 sm:w-auto"><select aria-label={`Classification for ${row.title}`} className={`${input} sm:w-44`} value={row.opportunity_type} onChange={(e) => changeType(row, e.target.value as Opportunity["opportunity_type"])}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button onClick={() => saveOpportunity(row)} disabled={!!busy} className={`${button} shrink-0`}>{busy === `opp:${row.id}` ? "Saving…" : "Save"}</button></div></div>
          </article>)}</div>
        </section> : null}
      </> : null}
    </main>
  );
}
