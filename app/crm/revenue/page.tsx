"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";
import MatrixRain from "@/components/MatrixRain";
import PipelineWorkspace from "@/components/crm/PipelineWorkspace";
import OutlookIntelligencePanel, { type SignalHealth } from "@/components/crm/OutlookIntelligencePanel";

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
  win_outlook: "not_assessed" | "at_risk" | "possible" | "likely" | "highly_likely" | "won";
  win_outlook_confidence: number | null;
  win_outlook_reasons: string[];
  win_outlook_questions: string[];
  engagement_motion: string | null;
  active_contact_method: string | null;
};

const input = "min-h-11 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-bone outline-none focus:border-amber/60";
const button = "min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.61rem] uppercase tracking-wider text-amber disabled:opacity-40";
const gbp = (value: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0, notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard" }).format(value || 0);
const pct = (value: number) => `${Math.round((value || 0) * 10) / 10}%`;
const typeLabels: Record<Opportunity["opportunity_type"], string> = {
  revenue: "Customer revenue",
  investment: "Investment",
  internal: "Internal project",
  strategic: "Strategic idea",
};

export default function RevenuePage() {
  const [data, setData] = useState<Pipeline | null>(null);
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [target, setTarget] = useState(2_000_000);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await crmFetch<Pipeline>("/api/crm/revenue");
      setData(next);
      setRows(
        [...(next.opportunities || []), ...(next.excludedOpportunities || [])].map(
          (row: Opportunity) => ({
            ...row,
            // Put the deterministic suggestion into editable state. Pressing
            // Save deal therefore confirms exactly what the user can see.
            next_action: row.next_action ?? row.nextAction ?? "",
          })
        )
      );
      setTarget(next.goal?.target || 2_000_000);
    } catch (e: any) {
      setError(e.message || "Could not load the revenue pipeline");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
          winOutlook: row.win_outlook || "not_assessed",
          winOutlookConfidence: row.win_outlook_confidence,
          winOutlookReasons: row.win_outlook_reasons || [],
          winOutlookQuestions: row.win_outlook_questions || [],
          engagementMotion: row.engagement_motion || null,
          activeContactMethod: row.active_contact_method || null,
          sourceType: "human",
          sourceChannel: "pipeline_dashboard",
          rationale: "Confirmed from the pipeline dashboard",
        }),
      });
      if (!saved?.id) throw new Error("Forecast was not confirmed");
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

  const saveTarget = async () => {
    setBusy("target"); setError(""); setNotice("");
    try {
      if (!Number.isFinite(target) || target < 1_000) throw new Error("Enter a revenue target of at least £1,000");
      const result = await crmFetch<{ target: number }>("/api/crm/revenue", { method: "PATCH", body: JSON.stringify({ target }) });
      if (result.target !== target) throw new Error("Revenue target was not confirmed");
      setNotice("Revenue target saved.");
      await load();
      setTarget(result.target);
      setData((current) => current ? { ...current, goal: { ...(current.goal || {}), target: result.target } } : current);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  };

  const wonProgress = data?.goal?.target ? Math.min(100, (data.goal.wonYtd / data.goal.target) * 100) : 0;
  const revenueRows = rows.filter((row) => row.opportunity_type === "revenue");
  const excludedRows = rows.filter((row) => row.opportunity_type !== "revenue");

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
              ["Customer revenue", data.classification.revenue],
              ["Strategic ideas", data.classification.strategic],
              ["Internal projects", data.classification.internal],
              ["Investment", data.classification.investment],
            ].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-edge bg-ink/30 p-3"><strong className="block font-display text-xl text-bone">{value}</strong><span className="font-mono text-[0.52rem] uppercase text-muted">{label}</span></div>)}
          </div>
        </section>

        <section className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
          {[
            ["Raw pipeline", data.kpis.rawPipeline, "Customer sales only"],
            ["Weighted", data.kpis.weightedPipeline, "Value × probability"],
            ["Best case", data.kpis.bestCase, "Best case + commit"],
            ["Commit", data.kpis.commit, "Deals you expect"],
            ["Coverage", `${Math.round(data.kpis.coverage * 10) / 10}×`, "Pipeline ÷ target gap"],
          ].map(([label, value, note]) => <div key={String(label)} className="rounded-xl border border-edge bg-panel p-3"><p className="font-mono text-[0.53rem] uppercase tracking-wider text-muted">{label}</p><strong className="mt-1 block font-display text-xl text-bone">{typeof value === "number" ? gbp(value) : value}</strong><span className="text-[0.69rem] text-muted">{note}</span></div>)}
        </section>

        <OutlookIntelligencePanel health={data.signalHealth as SignalHealth} />

        <PipelineWorkspace
          rows={revenueRows as any}
          stageDefinitions={data.stageDefinitions}
          busy={busy}
          onChange={updateRow as any}
          onSave={saveOpportunity as any}
        />

        {excludedRows.length ? <section className="mt-4 rounded-xl border border-edge bg-panel p-4">
          <div className="mb-3"><h2 className="font-display text-lg text-bone">Kept outside the revenue forecast</h2><p className="mt-1 text-sm leading-6 text-muted">These records are still available as useful CRM context. Change the classification if any should become a real customer deal.</p></div>
          <div className="space-y-2">{excludedRows.map((row) => <article key={row.id} className="rounded-lg border border-edge bg-ink/30 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><strong className="text-bone">{row.company}</strong><p className="mt-0.5 text-sm text-muted">{row.title}</p>{row.value ? <p className="mt-1 text-xs text-amber">Recorded value {gbp(row.value)}, excluded from revenue</p> : null}</div><div className="flex w-full gap-2 sm:w-auto"><select aria-label={`Classification for ${row.title}`} className={`${input} sm:w-44`} value={row.opportunity_type} onChange={(e) => changeType(row, e.target.value as Opportunity["opportunity_type"])}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button onClick={() => saveOpportunity(row)} disabled={!!busy} className={`${button} shrink-0`}>{busy === `opp:${row.id}` ? "Saving…" : "Save"}</button></div></div>
          </article>)}</div>
        </section> : null}
      </> : null}
    </main>
  );
}
