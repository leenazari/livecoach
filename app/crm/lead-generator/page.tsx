"use client";

import { useEffect, useState } from "react";

import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";
import type { LeadCostEstimate, SampleLead } from "@/lib/lead-generator-contract";
import {
  formatUsd,
  parseLeadCampaign,
  parseLeadFilters,
  safePublicUrl,
  streamLabel,
  type LeadStream,
} from "@/lib/lead-generator-rules";

const button =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-edge bg-panel px-3 text-sm font-medium hover:border-amber/60 disabled:cursor-not-allowed disabled:opacity-40";
const field = "min-h-10 w-full rounded-lg border border-edge bg-panel px-3 text-sm outline-none focus:border-amber";

type Decision = {
  id: string;
  step: string;
  outcome: string;
  reason: string;
  spendUsd: number | null;
  createdAt: string;
};
type Campaign = {
  id: string;
  name: string;
  status: "active" | "paused" | "unknown";
  stream: string;
  daysToRun: number;
  dailyLeadTarget: number;
  monthlyBudgetUsd: number | null;
  filters: {
    sector: string;
    city: string;
    minRating: number | null;
    minReviews: number | null;
    maxReviews: number | null;
    mustHaveWebsite: boolean;
  } | null;
  recentDecisions: Decision[];
  recentSpendUsd: number;
};
type Access = { allowed: boolean; role?: string; cleanseEnabled?: boolean };

const blank = {
  sector: "",
  city: "",
  minRating: "",
  minReviews: "",
  maxReviews: "",
  mustHaveWebsite: true,
};

const when = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function LeadGeneratorPage() {
  const [access, setAccess] = useState<Access | null>(null);
  const [filters, setFilters] = useState(blank);
  const [name, setName] = useState("");
  const [days, setDays] = useState("14");
  const [daily, setDaily] = useState("15");
  const [budget, setBudget] = useState("");
  const [stream, setStream] = useState<LeadStream>("sarah_mailer");
  const [editing, setEditing] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<LeadCostEstimate | null>(null);
  const [estimateKey, setEstimateKey] = useState("");
  const [sample, setSample] = useState<SampleLead[]>([]);
  const [sampleCost, setSampleCost] = useState<number | null | undefined>(undefined);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [cleanseRuns, setCleanseRuns] = useState<Decision[]>([]);
  const [decisionsUnavailable, setDecisionsUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const draft = {
    name,
    daysToRun: Number(days),
    dailyLeadTarget: Number(daily),
    monthlyBudgetUsd: budget.trim() ? Number(budget) : null,
    stream,
    filters: {
      sector: filters.sector,
      city: filters.city,
      minRating: filters.minRating === "" ? null : Number(filters.minRating),
      minReviews: filters.minReviews === "" ? null : Number(filters.minReviews),
      maxReviews: filters.maxReviews === "" ? null : Number(filters.maxReviews),
      mustHaveWebsite: filters.mustHaveWebsite,
    },
  };
  const filterCheck = parseLeadFilters(draft.filters);
  const campaignCheck = parseLeadCampaign(draft);
  const estimateSignature = filterCheck.ok
    ? JSON.stringify({
        filters: filterCheck.filters,
        daysToRun: campaignCheck.ok ? campaignCheck.campaign.daysToRun : null,
        dailyLeadTarget: campaignCheck.ok ? campaignCheck.campaign.dailyLeadTarget : null,
      })
    : "";

  useEffect(() => {
    let active = true;
    void crmFetch<Access>("/api/crm/lead-generator/access")
      .then((value) => {
        if (active) setAccess(value);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Lead generator could not be opened.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadCampaigns() {
    const list = await crmFetch<{
      campaigns: Campaign[];
      cleanseRuns: Decision[];
      decisionsUnavailable: boolean;
    }>("/api/crm/lead-generator/campaigns");
    setCampaigns(list.campaigns);
    setCleanseRuns(list.cleanseRuns);
    setDecisionsUnavailable(list.decisionsUnavailable);
  }

  useEffect(() => {
    if (!access?.allowed) return;
    let active = true;
    void loadCampaigns().catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Campaigns could not load.");
    });
    return () => {
      active = false;
    };
  }, [access?.allowed]);

  useEffect(() => {
    if (!access?.allowed || !estimateSignature) {
      setEstimate(null);
      setEstimateKey("");
      return;
    }
    const signature = estimateSignature;
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      const parsed = JSON.parse(signature) as {
        filters: {
          sector: string;
          city: string;
          minRating: number | null;
          minReviews: number | null;
          maxReviews: number | null;
          mustHaveWebsite: boolean;
        };
        daysToRun: number | null;
        dailyLeadTarget: number | null;
      };
      for (const [key, value] of Object.entries(parsed.filters)) {
        if (value != null && value !== "") params.set(key, String(value));
      }
      if (parsed.daysToRun) params.set("daysToRun", String(parsed.daysToRun));
      if (parsed.dailyLeadTarget) params.set("dailyLeadTarget", String(parsed.dailyLeadTarget));
      void crmFetch<LeadCostEstimate>(`/api/crm/lead-generator/cost-estimate?${params}`)
        .then((value) => {
          if (!active) return;
          setEstimate(value);
          setEstimateKey(signature);
        })
        .catch((reason) => {
          if (!active) return;
          setEstimate(null);
          setEstimateKey("");
          setError(reason instanceof Error ? reason.message : "The cost could not be loaded.");
        });
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [access?.allowed, estimateSignature]);

  async function runSample() {
    if (!filterCheck.ok) {
      setError(filterCheck.message);
      return;
    }
    setBusy("sample");
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{ leads: SampleLead[]; sampleCostUsd: number | null }>(
        "/api/crm/lead-generator/sample",
        { method: "POST", body: JSON.stringify(filterCheck.filters) }
      );
      setSample(result.leads);
      setSampleCost(result.sampleCostUsd);
      setNotice(
        result.sampleCostUsd == null
          ? "Sample returned. The mailer did not include a sample cost."
          : `Sample returned. This sample cost ${formatUsd(result.sampleCostUsd)}.`
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sample could not be confirmed.");
    } finally {
      setBusy("");
    }
  }

  async function saveCampaign() {
    if (!campaignCheck.ok) {
      setError(campaignCheck.message);
      return;
    }
    if (estimateKey !== estimateSignature || !estimate) {
      setError("Wait for the cost estimate before saving. Nothing was saved.");
      return;
    }
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const path = editing
        ? `/api/crm/lead-generator/campaigns/${editing}`
        : "/api/crm/lead-generator/campaigns";
      await crmFetch(path, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(editing ? { action: "save", ...campaignCheck.campaign } : campaignCheck.campaign),
      });
      const wasEditing = editing;
      setEditing(null);
      setNotice(wasEditing ? "Campaign updated." : "Campaign saved. It is active.");
      try {
        await loadCampaigns();
      } catch (reason) {
        setError(reason instanceof Error
          ? `The campaign was saved. The list could not be refreshed. ${reason.message}`
          : "The campaign was saved. Refresh the page before saving another.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The campaign could not be confirmed.");
    } finally {
      setBusy("");
    }
  }

  async function setStatus(id: string, action: "pause" | "resume") {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      await crmFetch(`/api/crm/lead-generator/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      setNotice(action === "pause" ? "Campaign paused." : "Campaign active again.");
      try {
        await loadCampaigns();
      } catch (reason) {
        setError(reason instanceof Error
          ? `The status was saved. The list could not be refreshed. ${reason.message}`
          : "The status was saved. Refresh the page before changing it again.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The campaign status could not be confirmed.");
    } finally {
      setBusy("");
    }
  }

  function edit(campaign: Campaign) {
    setEditing(campaign.id);
    setName(campaign.name);
    setDays(String(campaign.daysToRun || ""));
    setDaily(String(campaign.dailyLeadTarget || ""));
    setBudget(campaign.monthlyBudgetUsd == null ? "" : String(campaign.monthlyBudgetUsd));
    setStream(campaign.stream === "reps" ? "reps" : "sarah_mailer");
    if (campaign.filters) {
      setFilters({
        sector: campaign.filters.sector,
        city: campaign.filters.city,
        minRating: campaign.filters.minRating == null ? "" : String(campaign.filters.minRating),
        minReviews: campaign.filters.minReviews == null ? "" : String(campaign.filters.minReviews),
        maxReviews: campaign.filters.maxReviews == null ? "" : String(campaign.filters.maxReviews),
        mustHaveWebsite: campaign.filters.mustHaveWebsite,
      });
    }
    setNotice(campaign.filters ? `Editing ${campaign.name}.` : `Editing ${campaign.name}. Enter the filters again before you save.`);
  }

  return (
    <>
      <NavMenu />
      <main className="mx-auto max-w-[1800px] px-4 pb-32 pt-7 sm:px-7">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber">LiveCoach / Lead bank</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Lead generator</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Sample a search, check the cost, then save a campaign. Apify stays on the mailer. This page does not call it.
          </p>
        </header>
        {error && <p role="alert" className="mt-5 rounded-lg border border-rust/30 bg-rust/10 p-3 text-sm text-rust">{error}</p>}
        {notice && <p role="status" className="mt-4 text-sm text-sage">{notice}</p>}
        {access?.allowed ? (
          <>
            <p className="mt-4 text-sm text-muted">
              {access?.cleanseEnabled
                ? "Nightly checks are on. They run at about 02:00 UK time."
                : "Nightly checks are off until an owner turns on the server switch."}
            </p>
            <section className="mt-6 grid gap-6 lg:grid-cols-[22rem_1fr]">
              <form className="rounded-xl border border-edge bg-panel p-4" onSubmit={(event) => event.preventDefault()}>
                <h2 className="text-sm font-semibold">Search</h2>
                <label className="mt-3 block text-xs text-muted">Sector or search term
                  <input className={`${field} mt-1`} value={filters.sector} maxLength={120} onChange={(event) => setFilters({ ...filters, sector: event.target.value })} />
                </label>
                <label className="mt-3 block text-xs text-muted">City or area
                  <input className={`${field} mt-1`} value={filters.city} maxLength={120} onChange={(event) => setFilters({ ...filters, city: event.target.value })} />
                </label>
                <label className="mt-3 block text-xs text-muted">Minimum Google rating
                  <input className={`${field} mt-1`} inputMode="decimal" value={filters.minRating} onChange={(event) => setFilters({ ...filters, minRating: event.target.value })} placeholder="Blank for no minimum" />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-muted">Minimum reviews
                    <input className={`${field} mt-1`} inputMode="numeric" value={filters.minReviews} onChange={(event) => setFilters({ ...filters, minReviews: event.target.value })} />
                  </label>
                  <label className="text-xs text-muted">Maximum reviews
                    <input className={`${field} mt-1`} inputMode="numeric" value={filters.maxReviews} onChange={(event) => setFilters({ ...filters, maxReviews: event.target.value })} />
                  </label>
                </div>
                <label className="mt-4 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={filters.mustHaveWebsite} onChange={(event) => setFilters({ ...filters, mustHaveWebsite: event.target.checked })} />
                  Must have a website
                </label>
                <fieldset className="mt-4 space-y-2" disabled>
                  <legend className="text-xs text-muted">Coming soon</legend>
                  {["Opening hours", "Category tags", "Phone number present"].map((label) => (
                    <label key={label} className="flex items-center gap-2 text-sm text-muted">
                      <input type="checkbox" disabled />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <div className="mt-4 rounded-lg border border-edge p-3 text-sm">
                  <h3 className="font-semibold">Cost</h3>
                  {!filterCheck.ok ? <p className="mt-2 text-muted">{filterCheck.message}</p> : estimate && estimateKey === estimateSignature ? (
                    <dl className="mt-2 space-y-1">
                      <div className="flex justify-between gap-3"><dt>This search</dt><dd>{formatUsd(estimate.filterUsd)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Per lead</dt><dd>{formatUsd(estimate.perLeadUsd)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Per day</dt><dd>{formatUsd(estimate.perDayUsd)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Per month</dt><dd>{formatUsd(estimate.perMonthUsd)}</dd></div>
                    </dl>
                  ) : <p className="mt-2 text-muted">Checking the cost…</p>}
                  {estimate?.notes && <p className="mt-2 text-xs text-muted">{estimate.notes}</p>}
                </div>
                <button type="button" className={`${button} mt-4 w-full`} disabled={!filterCheck.ok || busy === "sample"} onClick={() => void runSample()}>
                  {busy === "sample" ? "Running sample…" : "Run sample"}
                </button>
                <h2 className="mt-6 text-sm font-semibold">{editing ? "Edit campaign" : "Save as campaign"}</h2>
                <label className="mt-3 block text-xs text-muted">Name
                  <input className={`${field} mt-1`} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-muted">Days to run
                    <input className={`${field} mt-1`} inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
                  </label>
                  <label className="text-xs text-muted">Daily lead target
                    <input className={`${field} mt-1`} inputMode="numeric" value={daily} onChange={(event) => setDaily(event.target.value)} />
                  </label>
                </div>
                <label className="mt-3 block text-xs text-muted">Monthly budget USD, optional
                  <input className={`${field} mt-1`} inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} />
                </label>
                <label className="mt-3 block text-xs text-muted">Stream
                  <select className={`${field} mt-1`} value={stream} onChange={(event) => setStream(event.target.value as LeadStream)}>
                    <option value="sarah_mailer">Sarah mailer</option>
                    <option value="reps">Reps</option>
                  </select>
                </label>
                <p className="mt-2 text-xs text-muted">Up to 90 days and 200 leads a day. Saving stores the campaign. It does not run another sample.</p>
                {estimate && campaignCheck.ok && estimate.perMonthUsd != null && campaignCheck.campaign.monthlyBudgetUsd != null && estimate.perMonthUsd > campaignCheck.campaign.monthlyBudgetUsd && (
                  <p className="mt-2 text-xs text-amber">The estimated month is above this budget. You can still save, or lower the daily target.</p>
                )}
                <div className="mt-4 flex gap-2">
                  <button type="button" className={`${button} border-amber/40 text-amber`} disabled={!campaignCheck.ok || estimateKey !== estimateSignature || !estimate || busy === "save"} onClick={() => void saveCampaign()}>
                    {busy === "save" ? "Saving…" : editing ? "Save changes" : "Save as campaign"}
                  </button>
                  {editing && <button type="button" className={button} onClick={() => { setEditing(null); setNotice("Edit cancelled. The campaign was not changed."); }}>Cancel</button>}
                </div>
              </form>
              <div className="min-w-0">
                <section className="overflow-hidden rounded-xl border border-edge bg-panel">
                  <div className="border-b border-edge px-4 py-3">
                    <h2 className="text-sm font-semibold">Sample leads <span className="font-normal text-muted">{sample.length || ""}</span></h2>
                    {sampleCost !== undefined && <p className="mt-1 text-xs text-muted">Sample cost {formatUsd(sampleCost ?? null)}</p>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-muted">
                        <tr>{["Company", "Website", "Sector", "City", "Rating", "Reviews", "Phone", "Email", "Contact"].map((title) => <th key={title} className="border-b border-edge px-3 py-3 font-medium">{title}</th>)}</tr>
                      </thead>
                      <tbody>
                        {sample.length ? sample.map((lead, index) => {
                          const website = safePublicUrl(lead.website);
                          return (
                            <tr key={`${lead.company}-${index}`} className="border-b border-edge align-top">
                              <td className="px-3 py-3 font-medium">{lead.company || "Unnamed"}</td>
                              <td className="px-3 py-3">{website ? <a className="text-amber" href={website}>{lead.website}</a> : lead.website || "None"}</td>
                              <td className="px-3 py-3">{lead.sector}</td>
                              <td className="px-3 py-3">{[lead.city, lead.area].filter(Boolean).join(", ")}</td>
                              <td className="px-3 py-3">{lead.rating ?? ""}</td>
                              <td className="px-3 py-3">{lead.reviews ?? ""}</td>
                              <td className="px-3 py-3">{lead.phone}</td>
                              <td className="px-3 py-3">{lead.email}</td>
                              <td className="px-3 py-3">{lead.contactName}</td>
                            </tr>
                          );
                        }) : <tr><td colSpan={9} className="px-4 py-10 text-sm text-muted">Run a sample to see about 10 leads and the actual sample cost.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="mt-6 space-y-4">
                  <h2 className="text-sm font-semibold">Campaigns</h2>
                  {decisionsUnavailable && <p className="text-sm text-muted">Campaigns are listed. Recent decisions could not be loaded. No campaigns were changed.</p>}
                  {campaigns.length ? campaigns.map((campaign) => (
                    <article key={campaign.id} className="rounded-xl border border-edge bg-panel p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{campaign.name}</h3>
                          <p className="mt-1 text-xs text-muted">{streamLabel(campaign.stream)} · {campaign.status === "active" ? "Active" : campaign.status === "paused" ? "Paused" : "Status unknown"} · {campaign.dailyLeadTarget} a day for {campaign.daysToRun} days · Budget {formatUsd(campaign.monthlyBudgetUsd)}</p>
                          <p className="mt-1 text-xs text-muted">Spend in the decisions below: {formatUsd(campaign.recentSpendUsd)}</p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" className={button} onClick={() => edit(campaign)}>Edit</button>
                          {campaign.status !== "unknown" && (
                            <button type="button" className={button} disabled={busy === campaign.id} onClick={() => void setStatus(campaign.id, campaign.status === "paused" ? "resume" : "pause")}>
                              {campaign.status === "paused" ? "Resume" : "Pause"}
                            </button>
                          )}
                        </div>
                      </div>
                      {campaign.recentDecisions.length ? (
                        <ul className="mt-3 space-y-2 text-sm">
                          {campaign.recentDecisions.map((decision) => (
                            <li key={decision.id} className="rounded-lg border border-edge px-3 py-2">
                              <span className="text-xs text-muted">{when(decision.createdAt)} · {decision.step || "Decision"} · {decision.outcome}</span>
                              <p>{decision.reason || "No reason recorded."}</p>
                              <p className="text-xs text-muted">Spend {formatUsd(decision.spendUsd)}</p>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-3 text-sm text-muted">No decisions recorded for this campaign yet.</p>}
                    </article>
                  )) : <p className="text-sm text-muted">No campaigns yet. Run a sample and save one when the cost looks right.</p>}
                </section>
                <section className="mt-6 rounded-xl border border-edge bg-panel p-4">
                  <h2 className="text-sm font-semibold">Nightly cleanse</h2>
                  <p className="mt-1 text-xs text-muted">Read only. These rows are the bank checks logged as cleanse.</p>
                  {cleanseRuns.length ? (
                    <ul className="mt-3 space-y-2 text-sm">
                      {cleanseRuns.map((run) => (
                        <li key={run.id}>
                          {when(run.createdAt)} · {run.outcome || "Recorded"} · {run.reason} · Spend {formatUsd(run.spendUsd)}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-3 text-sm text-muted">No cleanse runs recorded yet.</p>}
                </section>
              </div>
            </section>
          </>
        ) : access ? (
          <section className="mt-8 rounded-xl border border-edge bg-panel p-8">
            <h2 className="text-lg font-semibold">This area is restricted</h2>
            <p className="mt-2 text-sm text-muted">Lead generator is for an active workspace owner or manager.</p>
          </section>
        ) : !error ? <p className="mt-8 text-sm text-muted">Checking access…</p> : null}
      </main>
    </>
  );
}
