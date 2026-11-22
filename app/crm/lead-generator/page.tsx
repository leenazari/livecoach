"use client";

import { useEffect, useState } from "react";

import NavMenu from "@/components/crm/NavMenu";
import { crmFetch } from "@/lib/crm";
import {
  leadsAtListPrice,
  listPriceDailyUsd,
  listPriceMonthlyUsd,
  type LeadCostEstimate,
  type SampleResult,
} from "@/lib/lead-generator-contract";
import {
  WEEKDAYS,
  campaignCodeFromName,
  formatUsd,
  notAppliedLabel,
  parseLeadCampaign,
  parseLeadFilters,
  safePublicUrl,
  streamLabel,
  weekdayLabel,
  type LeadStream,
  type RepOwner,
} from "@/lib/lead-generator-rules";

const button =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-edge bg-panel px-3 text-sm font-medium hover:border-amber/60 disabled:cursor-not-allowed disabled:opacity-40";
const field = "min-h-10 w-full rounded-lg border border-edge bg-panel px-3 text-sm outline-none focus:border-amber";
const REPS: RepOwner[] = ["Lee", "Kamm", "Sharon"];

type Decision = {
  id: string;
  step: string;
  campaign: string;
  countBefore: number;
  countAfter: number;
  apifyCostUsd: number;
  modelCostUsd: number;
  reason: string;
  createdAt: string;
};
type Campaign = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  stream: string;
  daysToRun: number[];
  dailyTarget: number;
  monthlyBudgetUsd: number;
  totalLeadTarget: number | null;
  maxSpendUsd: number | null;
  endDate: string | null;
  completedAt: string | null;
  completedReason: string;
  notes: string;
  ownerSplit: { owner: string; daily: number }[];
  filters: {
    search_term: string;
    sector: string;
    city: string;
    area: string;
    min_rating: number | null;
    min_reviews: number | null;
    max_reviews: number | null;
    must_have_website: boolean;
    phone_present: boolean;
  } | null;
  recentDecisions: Decision[];
  recentSpendUsd: number;
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

const blankOwners = () => ({ Lee: "15", Kamm: "15", Sharon: "15" });

function progressLine(campaign: Campaign, estimate: LeadCostEstimate | null) {
  const row = estimate?.campaigns.find((item) => item.code === campaign.code);
  const leads = campaign.totalLeadTarget == null
    ? row?.leadsProduced == null ? "No lead total" : `${row.leadsProduced} leads produced, no total set`
    : row?.leadsProduced == null ? `Lead progress not loaded of ${campaign.totalLeadTarget}` : `${row.leadsProduced} of ${campaign.totalLeadTarget} leads`;
  const spend = campaign.maxSpendUsd == null
    ? row?.spendToDateUsd == null ? "No maximum spend" : `${formatUsd(row.spendToDateUsd)} spent, no maximum`
    : row?.spendToDateUsd == null ? `Spend not loaded of ${formatUsd(campaign.maxSpendUsd)}` : `${formatUsd(row.spendToDateUsd)} of ${formatUsd(campaign.maxSpendUsd)}`;
  return `${leads}. ${spend}.`;
}

export default function LeadGeneratorPage() {
  const [access, setAccess] = useState<{ allowed: boolean; cleanseEnabled?: boolean } | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sector, setSector] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [minRating, setMinRating] = useState("");
  const [minReviews, setMinReviews] = useState("");
  const [maxReviews, setMaxReviews] = useState("");
  const [mustHaveWebsite, setMustHaveWebsite] = useState(true);
  const [phonePresent, setPhonePresent] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [dailyTarget, setDailyTarget] = useState("45");
  const [monthlyBudget, setMonthlyBudget] = useState("0");
  const [totalLeads, setTotalLeads] = useState("");
  const [maxSpend, setMaxSpend] = useState("");
  const [endDate, setEndDate] = useState("");
  const [stream, setStream] = useState<LeadStream>("sarah_mailer");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [owners, setOwners] = useState(blankOwners);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState("");
  const [estimate, setEstimate] = useState<LeadCostEstimate | null>(null);
  const [sample, setSample] = useState<SampleResult | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [cleanseRuns, setCleanseRuns] = useState<Decision[]>([]);
  const [decisionsUnavailable, setDecisionsUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const filters = {
    search_term: searchTerm,
    sector,
    city,
    area,
    min_rating: minRating === "" ? null : Number(minRating),
    min_reviews: minReviews === "" ? null : Number(minReviews),
    max_reviews: maxReviews === "" ? null : Number(maxReviews),
    must_have_website: mustHaveWebsite,
    opening_hours: null,
    category_tags: [],
    phone_present: phonePresent,
  };
  const ownerSplit = REPS.map((owner) => ({ owner, daily: owners[owner] === "" ? 0 : Number(owners[owner]) }));
  const draft = {
    code: editingCode || campaignCodeFromName(name),
    name,
    notes,
    daysToRun: weekdays,
    dailyTarget: Number(dailyTarget),
    monthlyBudgetUsd: monthlyBudget === "" ? 0 : Number(monthlyBudget),
    totalLeadTarget: totalLeads === "" ? null : Number(totalLeads),
    maxSpendUsd: maxSpend === "" ? null : Number(maxSpend),
    endDate: endDate || null,
    stream,
    active: true,
    ownerSplit: stream === "reps" ? ownerSplit : [],
    filters,
  };
  const filterCheck = parseLeadFilters(filters);
  const campaignCheck = parseLeadCampaign(draft, editingCode || undefined);
  const listDay = estimate
    ? listPriceDailyUsd(
        Number(dailyTarget),
        estimate.listPrices.placeWithFiltersUsd ?? Number.NaN,
        estimate.listPrices.linkedinEmailUsd ?? Number.NaN
      )
    : null;
  const listMonth = listDay == null ? null : listPriceMonthlyUsd(listDay, weekdays.length);
  const leadsForSpend = estimate && maxSpend !== ""
    ? leadsAtListPrice(Number(maxSpend), estimate.listPrices.placeWithFiltersUsd ?? Number.NaN, estimate.listPrices.linkedinEmailUsd ?? Number.NaN)
    : null;
  const savedEstimate = estimate?.campaigns.find((row) => row.code === editingCode);

  useEffect(() => {
    let active = true;
    void crmFetch<{ allowed: boolean; cleanseEnabled?: boolean }>("/api/crm/lead-generator/access")
      .then((value) => { if (active) setAccess(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Lead generator could not be opened."); });
    return () => { active = false; };
  }, []);

  async function loadCampaigns() {
    const list = await crmFetch<{ campaigns: Campaign[]; cleanseRuns: Decision[]; decisionsUnavailable: boolean }>(
      "/api/crm/lead-generator/campaigns"
    );
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
    void crmFetch<LeadCostEstimate>("/api/crm/lead-generator/cost-estimate")
      .then((value) => { if (active) setEstimate(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "The cost could not be loaded."); });
    return () => { active = false; };
  }, [access?.allowed]);

  function toggleDay(day: number) {
    setWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort((a, b) => a - b));
  }

  async function runSample() {
    if (!filterCheck.ok) {
      setError(filterCheck.message);
      return;
    }
    setBusy("sample");
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<SampleResult>("/api/crm/lead-generator/sample", {
        method: "POST",
        body: JSON.stringify(editingCode ? { campaign: editingCode, filters: filterCheck.filters } : filterCheck.filters),
      });
      setSample(result);
      if (result.blocked) {
        setNotice("");
        setError(result.reason || "The mailer blocked this sample before it ran.");
      } else {
        setNotice(`Sample returned. Cost ${formatUsd(result.apifyCostUsd)}${result.costBasis === "actual" ? " actual" : result.costBasis === "list" ? " at list prices" : ""}.`);
      }
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
    if (!estimate) {
      setError("Wait for the cost estimate before saving. Nothing was saved.");
      return;
    }
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const path = editingId ? `/api/crm/lead-generator/campaigns/${editingId}` : "/api/crm/lead-generator/campaigns";
      await crmFetch(path, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(editingId ? { action: "save", ...campaignCheck.campaign } : campaignCheck.campaign),
      });
      const wasEditing = Boolean(editingId);
      setEditingId(null);
      setEditingCode("");
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

  async function setActive(id: string, active: boolean) {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      await crmFetch(`/api/crm/lead-generator/campaigns/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: active ? "resume" : "pause" }),
      });
      setNotice(active ? "Campaign active again." : "Campaign paused.");
      try {
        await loadCampaigns();
      } catch (reason) {
        setError(reason instanceof Error
          ? `The active flag was saved. The list could not be refreshed. ${reason.message}`
          : "The active flag was saved. Refresh the page before changing it again.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The campaign could not be confirmed.");
    } finally {
      setBusy("");
    }
  }

  function edit(campaign: Campaign) {
    setEditingId(campaign.id);
    setEditingCode(campaign.code);
    setName(campaign.name);
    setNotes(campaign.notes);
    setDailyTarget(String(campaign.dailyTarget));
    setMonthlyBudget(String(campaign.monthlyBudgetUsd));
    setTotalLeads(campaign.totalLeadTarget == null ? "" : String(campaign.totalLeadTarget));
    setMaxSpend(campaign.maxSpendUsd == null ? "" : String(campaign.maxSpendUsd));
    setEndDate(campaign.endDate || "");
    setStream(campaign.stream === "reps" ? "reps" : "sarah_mailer");
    setWeekdays(campaign.daysToRun.length ? campaign.daysToRun : [1, 2, 3, 4, 5, 6, 7]);
    const next = blankOwners();
    for (const owner of REPS) next[owner] = "0";
    for (const row of campaign.ownerSplit) {
      if (row.owner === "Lee" || row.owner === "Kamm" || row.owner === "Sharon") next[row.owner] = String(row.daily);
    }
    setOwners(next);
    if (campaign.filters) {
      setSearchTerm(campaign.filters.search_term);
      setSector(campaign.filters.sector);
      setCity(campaign.filters.city);
      setArea(campaign.filters.area);
      setMinRating(campaign.filters.min_rating == null ? "" : String(campaign.filters.min_rating));
      setMinReviews(campaign.filters.min_reviews == null ? "" : String(campaign.filters.min_reviews));
      setMaxReviews(campaign.filters.max_reviews == null ? "" : String(campaign.filters.max_reviews));
      setMustHaveWebsite(campaign.filters.must_have_website);
      setPhonePresent(campaign.filters.phone_present);
    }
    setNotice(`Editing ${campaign.name}. Code ${campaign.code}.`);
  }

  return (
    <>
      <NavMenu />
      <main className="mx-auto max-w-[1800px] px-4 pb-32 pt-7 sm:px-7">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-amber">LiveCoach / Lead bank</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Lead generator</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">Sample a search, check the cost, then save a campaign. Apify stays on the mailer. This page does not call it.</p>
        </header>
        {error && <p role="alert" className="mt-5 rounded-lg border border-rust/30 bg-rust/10 p-3 text-sm text-rust">{error}</p>}
        {notice && <p role="status" className="mt-4 text-sm text-sage">{notice}</p>}
        {access?.allowed ? (
          <>
            <p className="mt-4 text-sm text-muted">
              {access.cleanseEnabled
                ? "Nightly checks are on. They run at about 02:00 UK time."
                : "Nightly checks are off until an owner turns on the server switch."}
            </p>
            <section className="mt-6 grid gap-6 lg:grid-cols-[22rem_1fr]">
              <form className="rounded-xl border border-edge bg-panel p-4" onSubmit={(event) => event.preventDefault()}>
                <h2 className="text-sm font-semibold">Search</h2>
                <label className="mt-3 block text-xs text-muted">Search term
                  <input className={`${field} mt-1`} value={searchTerm} maxLength={160} onChange={(event) => setSearchTerm(event.target.value)} />
                </label>
                <label className="mt-3 block text-xs text-muted">Sector
                  <input className={`${field} mt-1`} value={sector} maxLength={160} onChange={(event) => setSector(event.target.value)} />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-muted">City
                    <input className={`${field} mt-1`} value={city} maxLength={160} onChange={(event) => setCity(event.target.value)} />
                  </label>
                  <label className="text-xs text-muted">Area
                    <input className={`${field} mt-1`} value={area} maxLength={160} onChange={(event) => setArea(event.target.value)} />
                  </label>
                </div>
                <p className="mt-2 text-xs text-muted">Leave the search blank to use the rotating UK list.</p>
                <label className="mt-3 block text-xs text-muted">Minimum Google rating
                  <input className={`${field} mt-1`} inputMode="decimal" value={minRating} onChange={(event) => setMinRating(event.target.value)} placeholder="Blank uses the mailer default" />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-muted">Minimum reviews
                    <input className={`${field} mt-1`} inputMode="numeric" value={minReviews} onChange={(event) => setMinReviews(event.target.value)} />
                  </label>
                  <label className="text-xs text-muted">Maximum reviews
                    <input className={`${field} mt-1`} inputMode="numeric" value={maxReviews} onChange={(event) => setMaxReviews(event.target.value)} />
                  </label>
                </div>
                <label className="mt-4 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={mustHaveWebsite} onChange={(event) => setMustHaveWebsite(event.target.checked)} />
                  Must have a website
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={phonePresent} onChange={(event) => setPhonePresent(event.target.checked)} />
                  Phone number present
                </label>
                <fieldset className="mt-4 space-y-2" disabled>
                  <legend className="text-xs text-muted">Coming soon</legend>
                  {["Opening hours", "Category tags"].map((label) => (
                    <label key={label} className="flex items-center gap-2 text-sm text-muted">
                      <input type="checkbox" disabled />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <div className="mt-4 rounded-lg border border-edge p-3 text-sm">
                  <h3 className="font-semibold">Cost</h3>
                  {!estimate ? <p className="mt-2 text-muted">Checking the cost…</p> : (
                    <dl className="mt-2 space-y-1">
                      <div className="flex justify-between gap-3"><dt>Basis</dt><dd>{estimate.basis === "actual" ? "Actual" : estimate.basis === "list" ? "List price" : "Not returned"}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Days of data</dt><dd>{estimate.daysOfData ?? "Not returned"}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Sample of 20 places</dt><dd>{formatUsd(estimate.sample20PlacesUsd)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Per qualified lead</dt><dd>{formatUsd(estimate.usdPerQualified)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>This form per day</dt><dd>{formatUsd(listDay)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>This form per month</dt><dd>{formatUsd(listMonth)}</dd></div>
                    </dl>
                  )}
                  <p className="mt-2 text-xs text-muted">This form per day and per month is an estimate at list prices. Per day is the daily target times 10 places, plus one email lookup per lead. Per month is that day cost times the ticked weekdays times 4.33. Saved campaigns use the mailer figure.</p>
                  {savedEstimate && <p className="mt-2 text-xs text-muted">Saved {savedEstimate.code} per day: {formatUsd(savedEstimate.estimatedUsd)}.</p>}
                </div>
                <button type="button" className={`${button} mt-4 w-full`} disabled={!filterCheck.ok || busy === "sample"} onClick={() => void runSample()}>
                  {busy === "sample" ? "Running sample…" : "Run sample"}
                </button>
                <h2 className="mt-6 text-sm font-semibold">{editingId ? "Edit campaign" : "Save as campaign"}</h2>
                <p className="mt-2 text-xs text-muted">Runs every morning until it reaches the total, the maximum spend, or the end date, whichever comes first.</p>
                <label className="mt-3 block text-xs text-muted">Maximum spend (USD), recommended
                  <input className={`${field} mt-1`} inputMode="decimal" value={maxSpend} onChange={(event) => setMaxSpend(event.target.value)} placeholder="Leave blank for no lifetime cap" />
                </label>
                {maxSpend !== "" && <p className="mt-1 text-xs text-muted">At list prices this spend covers about {leadsForSpend == null ? "an unknown number of" : leadsForSpend} leads.</p>}
                <label className="mt-3 block text-xs text-muted">Total leads wanted
                  <input className={`${field} mt-1`} inputMode="numeric" value={totalLeads} onChange={(event) => setTotalLeads(event.target.value)} placeholder="Leave blank for no lead total" />
                </label>
                <label className="mt-3 block text-xs text-muted">End date, optional
                  <input className={`${field} mt-1`} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                </label>
                <label className="mt-3 block text-xs text-muted">Name
                  <input className={`${field} mt-1`} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                </label>
                <p className="mt-2 text-xs text-muted">Code {editingCode || campaignCodeFromName(name) || "not ready"}. A new code comes from the name and stays fixed after saving.</p>
                <label className="mt-3 block text-xs text-muted">Daily target
                  <input className={`${field} mt-1`} inputMode="numeric" value={dailyTarget} onChange={(event) => setDailyTarget(event.target.value)} />
                </label>
                <label className="mt-3 block text-xs text-muted">Monthly budget USD
                  <input className={`${field} mt-1`} inputMode="decimal" value={monthlyBudget} onChange={(event) => setMonthlyBudget(event.target.value)} />
                </label>
                <fieldset className="mt-3">
                  <legend className="text-xs text-muted">Weekdays</legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {WEEKDAYS.map((day) => (
                      <label key={day.value} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={weekdays.includes(day.value)} onChange={() => toggleDay(day.value)} />
                        {day.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="mt-3 block text-xs text-muted">Stream
                  <select className={`${field} mt-1`} value={stream} onChange={(event) => setStream(event.target.value as LeadStream)}>
                    <option value="sarah_mailer">Sarah mailer</option>
                    <option value="reps">Reps</option>
                  </select>
                </label>
                {stream === "reps" && (
                  <fieldset className="mt-3">
                    <legend className="text-xs text-muted">Daily split. Nikhara is never an owner.</legend>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {REPS.map((owner) => (
                        <label key={owner} className="text-xs text-muted">{owner}
                          <input className={`${field} mt-1`} inputMode="numeric" value={owners[owner]} onChange={(event) => setOwners({ ...owners, [owner]: event.target.value })} />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                <label className="mt-3 block text-xs text-muted">Notes
                  <textarea className={`${field} mt-1 py-2`} rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
                </label>
                <p className="mt-2 text-xs text-muted">Criteria set local-owners-no-chat, version 1, campaign C1. Saving does not run another sample.</p>
                <div className="mt-4 flex gap-2">
                  <button type="button" className={`${button} border-amber/40 text-amber`} disabled={!campaignCheck.ok || !estimate || busy === "save"} onClick={() => void saveCampaign()}>
                    {busy === "save" ? "Saving…" : editingId ? "Save changes" : "Save as campaign"}
                  </button>
                  {editingId && <button type="button" className={button} onClick={() => { setEditingId(null); setEditingCode(""); setNotice("Edit cancelled. The campaign was not changed."); }}>Cancel</button>}
                </div>
              </form>
              <div className="min-w-0">
                <section className="overflow-hidden rounded-xl border border-edge bg-panel">
                  <div className="border-b border-edge px-4 py-3">
                    <h2 className="text-sm font-semibold">Sample leads <span className="font-normal text-muted">{sample?.leads.length ?? ""}</span></h2>
                    {sample?.blocked && <p className="mt-1 text-sm text-rust">Blocked. {sample.reason || "The mailer did not run this sample."}</p>}
                    {sample && !sample.blocked && <p className="mt-1 text-xs text-muted">Cost {formatUsd(sample.apifyCostUsd)}{sample.costBasis ? ` · ${sample.costBasis}` : ""}</p>}
                    {sample && sample.notApplied.length > 0 && <p className="mt-1 text-xs text-muted">Not applied: {sample.notApplied.map(notAppliedLabel).join(", ")}.</p>}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-muted">
                        <tr>{["Company", "Website", "Domain", "City", "Rating", "Reviews", "Phone"].map((title) => <th key={title} className="border-b border-edge px-3 py-3 font-medium">{title}</th>)}</tr>
                      </thead>
                      <tbody>
                        {sample?.leads.length ? sample.leads.map((lead, index) => {
                          const website = safePublicUrl(lead.website);
                          return (
                            <tr key={`${lead.domain || lead.company}-${index}`} className="border-b border-edge align-top">
                              <td className="px-3 py-3 font-medium">{lead.company || "Unnamed"}</td>
                              <td className="px-3 py-3">{website ? <a className="text-amber" href={website}>{lead.website}</a> : lead.website || "None"}</td>
                              <td className="px-3 py-3">{lead.domain}</td>
                              <td className="px-3 py-3">{lead.city}</td>
                              <td className="px-3 py-3">{lead.rating ?? ""}</td>
                              <td className="px-3 py-3">{lead.reviews ?? ""}</td>
                              <td className="px-3 py-3">{lead.phone}</td>
                            </tr>
                          );
                        }) : <tr><td colSpan={7} className="px-4 py-10 text-sm text-muted">Run a sample to see up to 20 places, whether it was blocked, and what was not applied.</td></tr>}
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
                          <p className="mt-1 text-xs text-muted">{campaign.code} · {streamLabel(campaign.stream)} · {campaign.completedAt ? "Completed" : campaign.active ? "Active" : "Inactive"} · {campaign.dailyTarget} a day · {campaign.daysToRun.map(weekdayLabel).filter(Boolean).join(", ") || "No weekdays"} · Budget {formatUsd(campaign.monthlyBudgetUsd)}</p>
                          <p className="mt-1 text-xs text-muted">{progressLine(campaign, estimate)}</p>
                          {campaign.completedAt && <p className="mt-1 text-xs text-sage">Completed. {campaign.completedReason || "No reason recorded."}</p>}
                          <p className="mt-1 text-xs text-muted">Spend in the decisions below: {formatUsd(campaign.recentSpendUsd)}</p>
                          {campaign.stream === "reps" && <p className="mt-1 text-xs text-muted">{campaign.ownerSplit.map((row) => `${row.owner} ${row.daily}`).join(", ") || "No rep split"}</p>}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" className={button} onClick={() => edit(campaign)}>Edit</button>
                          <button type="button" className={button} disabled={busy === campaign.id} onClick={() => void setActive(campaign.id, !campaign.active)}>
                            {campaign.active ? "Pause" : "Resume"}
                          </button>
                        </div>
                      </div>
                      {campaign.recentDecisions.length ? (
                        <ul className="mt-3 space-y-2 text-sm">
                          {campaign.recentDecisions.map((decision) => (
                            <li key={decision.id} className="rounded-lg border border-edge px-3 py-2">
                              <span className="text-xs text-muted">{when(decision.createdAt)} · {decision.step || "Decision"} · before {decision.countBefore}, after {decision.countAfter}</span>
                              <p>{decision.reason || "No reason recorded."}</p>
                              <p className="text-xs text-muted">Apify {formatUsd(decision.apifyCostUsd)} · Model {formatUsd(decision.modelCostUsd)}</p>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-3 text-sm text-muted">No decisions recorded for this campaign yet.</p>}
                    </article>
                  )) : <p className="text-sm text-muted">No campaigns yet. Run a sample and save one when the cost looks right.</p>}
                </section>
                <section className="mt-6 rounded-xl border border-edge bg-panel p-4">
                  <h2 className="text-sm font-semibold">Nightly cleanse</h2>
                  <p className="mt-1 text-xs text-muted">Read only. These rows are logged with campaign cleanse.</p>
                  {cleanseRuns.length ? (
                    <ul className="mt-3 space-y-2 text-sm">
                      {cleanseRuns.map((run) => (
                        <li key={run.id}>{when(run.createdAt)} · before {run.countBefore}, after {run.countAfter} · {run.reason} · Model {formatUsd(run.modelCostUsd)}</li>
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
