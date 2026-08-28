"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import CampaignSequenceBuilder from "@/components/crm/CampaignSequenceBuilder";
import ProspectManualCall from "@/components/crm/ProspectManualCall";
import RevenueToday from "@/components/crm/RevenueToday";
import OutreachReadiness from "@/components/crm/OutreachReadiness";
import OutreachVoiceNoteEditor from "@/components/crm/OutreachVoiceNoteEditor";
import MatrixRain from "@/components/MatrixRain";
import { crmFetch } from "@/lib/crm";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import {
  outreachSequenceValidationError,
  type OutreachSequenceStep,
} from "@/lib/outreach-sequence";

type Tab = "queue" | "prospects" | "signals" | "activity" | "replies" | "campaign" | "intelligence" | "safety";
type Priority = "high" | "medium" | "low";
type ProspectSort = "name" | "company" | "priority" | "status" | "activity";
type RecommendationAction = "contact_today" | "hold" | "skip";
type Recommendation = { action: RecommendationAction; label: string; score: number; confidence: "high" | "medium" | "low"; reasons: string[]; risks: string[] };
type Prospect = Record<string, any> & { id: string; email: string; company_name: string; priority: Priority; priority_score: number; recommendation: Recommendation };
type QueueRow = Record<string, any> & { id: string; prospect: Prospect; campaign: Record<string, any>; message: Record<string, any> | null; recommendation: Recommendation };
type SequenceStep = OutreachSequenceStep;
type Campaign = Record<string, any> & { id: string; name: string; goal: string; audience: string; offer_angle: string; status: string; daily_limit: number; sequence: SequenceStep[] };
type CampaignStats = {
  enrolled: number;
  contacted: number;
  emailsSent: number;
  replies: number;
  interested: number;
  meetings: number;
  replyRate: number;
  meetingRate: number;
};
type EngagementDraft = {
  authorName: string;
  postSummary: string;
  angle: string;
  evidence: string[];
  comment: string;
  sourceUrl: string | null;
};
type HandoverPreview = {
  companyId: string | null;
  companyName: string | null;
  candidates: { id: string; name: string; domain: string | null }[];
  canCreateSafely: boolean;
  needsReview: boolean;
  reason: string;
};
type PrepareStatus = "adding" | "queued" | "researching" | "done" | "error";
type TeamMember = {
  userId: string;
  role: string;
  name: string;
  senderName: string | null;
  senderEmail: string | null;
};

const tabs: { key: Tab; label: string; icon: string }[] = [
  { key: "queue", label: "Today", icon: "☀" },
  { key: "prospects", label: "Prospects", icon: "◎" },
  { key: "signals", label: "Engage", icon: "⌁" },
  { key: "activity", label: "Activity", icon: "▥" },
  { key: "replies", label: "Replies", icon: "✉" },
  { key: "campaign", label: "Campaign", icon: "↗" },
  { key: "intelligence", label: "Intelligence", icon: "◆" },
  { key: "safety", label: "Safety", icon: "⊘" },
];

const pill: Record<string, string> = {
  high: "border-rust/50 bg-rust/10 text-rust",
  medium: "border-amber/50 bg-amber/10 text-amber",
  low: "border-edge bg-ink/40 text-muted",
  approved: "border-moss/50 bg-moss/10 text-moss",
  scheduled: "border-sky/50 bg-sky/10 text-sky",
  sent: "border-moss/50 bg-moss/10 text-moss",
  drafted: "border-amber/50 bg-amber/10 text-amber",
  draft: "border-amber/50 bg-amber/10 text-amber",
  queued: "border-sky/50 bg-sky/10 text-sky",
  contacted: "border-moss/50 bg-moss/10 text-moss",
  replied: "border-moss/50 bg-moss/10 text-moss",
  interested: "border-moss/50 bg-moss/10 text-moss",
  warm: "border-amber/60 bg-amber/15 text-amber",
  suppressed: "border-rust/50 bg-rust/10 text-rust",
  not_started: "border-edge bg-ink/40 text-muted",
};

const recommendationPill: Record<RecommendationAction, string> = {
  contact_today: "border-moss/50 bg-moss/10 text-moss",
  hold: "border-amber/50 bg-amber/10 text-amber",
  skip: "border-rust/50 bg-rust/10 text-rust",
};

const button = "min-h-11 rounded-lg border border-edge px-3 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber disabled:cursor-not-allowed disabled:opacity-40";
const primary = "min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40";
const input = "w-full rounded-lg border border-edge bg-ink/50 px-3 py-2.5 text-sm text-bone placeholder:text-muted focus:border-amber/60 focus:outline-none";
const PREPARE_QUEUE_KEY = "livecoach:outreach-prepare-queue:v1";
const MAX_CONCURRENT_RESEARCH = 2;

function outreachStage(prospect: Prospect): { key: string; label: string } {
  if (prospect.status === "suppressed") return { key: "suppressed", label: "Removed" };
  if (prospect.last_reply_at)
    return {
      key: prospect.reply_category === "interested" ? "interested" : "replied",
      label: prospect.reply_category === "interested" ? "Interested" : "Replied",
    };
  const latest = prospect.outreach?.latestMessage;
  const sentCount = Number(prospect.outreach?.sentCount || 0);
  if (latest?.status === "sending")
    return { key: "scheduled", label: "Sending" };
  if (latest?.status === "approved" && latest?.scheduled_at)
    return { key: "scheduled", label: "Scheduled" };
  if (latest?.status === "approved")
    return { key: "approved", label: sentCount ? "Follow up approved" : "Approved" };
  if (["draft", "failed"].includes(latest?.status))
    return { key: "draft", label: sentCount ? "Follow up draft" : "Draft ready" };
  if (prospect.source_metadata?.warm_lead && !sentCount)
    return { key: "warm", label: "Warm lead" };
  if (sentCount || prospect.status === "contacted")
    return { key: "sent", label: sentCount > 1 ? `${sentCount} sent` : "Sent" };
  if (prospect.outreach?.enrolment?.status === "queued" || prospect.status === "queued")
    return { key: "queued", label: "Queued" };
  return { key: "not_started", label: "Not started" };
}

function isUntouchedProspect(prospect: Prospect): boolean {
  const research = prospect.research;
  const hasResearch = research != null && (
    Array.isArray(research)
      ? research.length > 0
      : typeof research === "object"
        ? Object.keys(research).length > 0
        : String(research).trim().length > 0
  );
  return prospect.status === "imported" &&
    outreachStage(prospect).key === "not_started" &&
    !prospect.last_researched_at &&
    !prospect.last_contacted_at &&
    !prospect.last_reply_at &&
    !hasResearch &&
    !prospect.outreach?.latestMessage &&
    !prospect.outreach?.enrolment;
}

function formatActivityDate(value?: string | null) {
  if (!value) return "No activity";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function sequenceActionLabel(actionType?: string | null) {
  const labels: Record<string, string> = {
    linkedin_view: "View profile",
    linkedin_like: "Like relevant post",
    linkedin_connect: "Send connection request",
    linkedin_message: "Send LinkedIn message",
    manual_call: "Make phone call",
  };
  return labels[actionType || ""] || "Complete manual step";
}

function linkedinTarget(prospect: Prospect) {
  const saved = String(prospect.person_linkedin_url || "").trim();
  if (/^https:\/\/(www\.)?linkedin\.com\//i.test(saved)) return saved;
  const keywords = [
    prospect.first_name,
    prospect.last_name,
    prospect.company_name,
  ].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

function RecommendationCard({ recommendation, compact = false }: { recommendation: Recommendation; compact?: boolean }) {
  if (!recommendation) return null;
  return <div className="mt-3 rounded-lg border border-edge bg-ink/35 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={`rounded-full border px-2.5 py-1 font-mono text-[0.55rem] uppercase tracking-wider ${recommendationPill[recommendation.action]}`}>{recommendation.label}</span>
      <span className="font-mono text-[0.56rem] uppercase text-muted"><strong className="text-bone">{recommendation.score}/100</strong> · {recommendation.confidence} confidence</span>
    </div>
    <ul className="mt-2 space-y-1 text-xs leading-5 text-bone/75">
      {recommendation.reasons.slice(0, compact ? 2 : 4).map((reason) => <li key={reason} className="flex gap-2"><span className="text-moss">+</span><span>{reason}</span></li>)}
      {recommendation.risks.slice(0, compact ? 1 : 3).map((risk) => <li key={risk} className="flex gap-2"><span className="text-amber">!</span><span>{risk}</span></li>)}
    </ul>
  </div>;
}

function CampaignResultStrip({ stats }: { stats?: CampaignStats }) {
  const values = stats || {
    enrolled: 0,
    contacted: 0,
    emailsSent: 0,
    replies: 0,
    interested: 0,
    meetings: 0,
    replyRate: 0,
    meetingRate: 0,
  };
  const items = [
    ["Assigned", values.enrolled],
    ["Contacted", values.contacted],
    ["Emails", values.emailsSent],
    ["Replies", values.replies],
    ["Interested", values.interested],
    ["Meetings", values.meetings],
  ] as const;
  return <div className="mb-4 rounded-xl border border-edge bg-ink/35 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-mono text-[0.54rem] uppercase tracking-wider text-sky">Your results only</p>
      <p className="font-mono text-[0.5rem] uppercase text-muted">{values.replyRate}% reply rate · {values.meetingRate}% meeting rate</p>
    </div>
    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
      {items.map(([label, value]) => <div key={label} className="rounded-lg border border-edge/80 bg-panel/65 px-2 py-2 text-center"><strong className="block font-display text-lg text-bone">{value}</strong><span className="font-mono text-[0.44rem] uppercase text-muted">{label}</span></div>)}
    </div>
  </div>;
}

export default function OutreachPage() {
  const [tab, setTab] = useState<Tab>("queue");
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [sender, setSender] = useState<{
    senderName: string;
    senderEmail: string;
    provider: "google" | "microsoft";
    mailboxEmail: string;
  } | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [currentUser, setCurrentUser] = useState("");
  const [canManageAssignments, setCanManageAssignments] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignStats, setCampaignStats] = useState<Record<string, CampaignStats>>({});
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [expandedCampaignId, setExpandedCampaignId] = useState("");
  const [canManageCampaigns, setCanManageCampaigns] = useState(false);
  const [metrics, setMetrics] = useState<any>({});
  const [replies, setReplies] = useState<any[]>([]);
  const [sentHistory, setSentHistory] = useState<any[]>([]);
  const [manualCalls, setManualCalls] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [performance, setPerformance] = useState<any[]>([]);
  const [learnings, setLearnings] = useState<any[]>([]);
  const [suppressions, setSuppressions] = useState<any[]>([]);
  const [engagementInput, setEngagementInput] = useState("");
  const [engagementDraft, setEngagementDraft] = useState<EngagementDraft | null>(null);
  const [engagementComment, setEngagementComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [prepareJobs, setPrepareJobs] = useState<Record<string, PrepareStatus>>({});
  const prepareJobsRef = useRef<Record<string, PrepareStatus>>({});
  const prepareQueueRef = useRef<string[]>([]);
  const activePrepareRef = useRef<Set<string>>(new Set());
  const ownerFilterInitialisedRef = useRef(false);
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [stageFilter, setStageFilter] = useState("active");
  const [prospectSort, setProspectSort] = useState<ProspectSort>("priority");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [recommendationFilter, setRecommendationFilter] = useState<"all" | RecommendationAction>("all");
  const [prospectCampaignId, setProspectCampaignId] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [blockTarget, setBlockTarget] = useState("");
  const [removalProspectId, setRemovalProspectId] = useState("");
  const [manualCallProspectId, setManualCallProspectId] = useState("");
  const [draftEdits, setDraftEdits] = useState<Record<string, { subject: string; body_text: string; voice_script: string }>>({});
  const [handoverReviews, setHandoverReviews] = useState<Record<string, HandoverPreview>>({});

  const loadCore = useCallback(async () => {
    try {
      const [qd, c, m] = await Promise.all([
        crmFetch<any>("/api/crm/outreach/queue"),
        crmFetch<any>("/api/crm/outreach/campaigns"),
        crmFetch<any>("/api/crm/outreach/metrics?summary=1"),
      ]);
      setQueue(qd.queue || []);
      setSender(qd.sender || null);
      setCampaigns(c.campaigns || []);
      if (c.campaignStats) setCampaignStats(c.campaignStats);
      setSelectedCampaignId(
        c.selectedCampaignId || qd.selectedCampaignId || ""
      );
      setCanManageCampaigns(c.canManageCampaigns === true);
      setMetrics(m.metrics || {});
    } catch (e: any) { setError(e.message || "Could not load outreach"); }
    finally { setLoading(false); }
  }, []);

  const loadCampaignStats = useCallback(async () => {
    const data = await crmFetch<any>("/api/crm/outreach/campaigns?stats=1");
    setCampaignStats(data.campaignStats || {});
  }, []);

  const loadProspects = useCallback(async () => {
    const data = await crmFetch<any>("/api/crm/outreach");
    setProspects(data.prospects || []);
    setTeam(data.team || []);
    setCurrentUser(data.currentUser || "");
    setCanManageAssignments(data.canManageAssignments === true);
    if (!ownerFilterInitialisedRef.current) {
      // A salesperson's useful default is work they can act on now. Include
      // their own prospects and the unassigned shared pool, but never another
      // salesperson's assigned records. Managers retain the whole-team view.
      setOwnerFilter(data.canManageAssignments === true ? "all" : "available");
      ownerFilterInitialisedRef.current = true;
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    const data = await crmFetch<any>("/api/crm/outreach/metrics");
    setMetrics(data.metrics || {});
    setReplies(data.replies || []);
    setSentHistory(data.sentHistory || []);
    setManualCalls(data.manualCalls || []);
    setVariants(data.variants || []);
    setPerformance(data.performance || []);
    setLearnings(data.learnings || []);
  }, []);

  const loadSuppressions = useCallback(async () => {
    const data = await crmFetch<any>("/api/crm/outreach/suppressions");
    setSuppressions(data.suppressions || []);
  }, []);

  const updatePrepareJob = useCallback((prospectId: string, status: PrepareStatus) => {
    setPrepareJobs((current) => {
      const next = { ...current, [prospectId]: status };
      prepareJobsRef.current = next;
      const pending = Object.entries(next)
        // A running request keeps completing after an in-app navigation. Only
        // work that has not started is resumed, preventing duplicate AI spend.
        .filter(([, value]) => value === "queued")
        .map(([id]) => id);
      window.localStorage.setItem(PREPARE_QUEUE_KEY, JSON.stringify(pending));
      return next;
    });
  }, []);

  const runPrepareQueue = useCallback(() => {
    while (
      activePrepareRef.current.size < MAX_CONCURRENT_RESEARCH &&
      prepareQueueRef.current.length
    ) {
      const prospectId = prepareQueueRef.current.shift();
      if (!prospectId || activePrepareRef.current.has(prospectId)) continue;
      activePrepareRef.current.add(prospectId);
      updatePrepareJob(prospectId, "researching");
      setRowErrors((all) => ({ ...all, [prospectId]: "" }));

      void crmFetch<any>(`/api/crm/outreach/${prospectId}/prepare`, {
        method: "POST",
        body: "{}",
      })
        .then((result) => {
          updatePrepareJob(prospectId, "done");
          setNotice(
            result.formatRepaired
              ? "A queued research draft completed after an automatic format repair. Review it carefully before sending."
              : result.needsExtraReview
              ? "A queued draft is ready but its quality score is lower than usual. Review it carefully before sending."
              : "Research and draft completed in the background. It is ready to review in Today."
          );
        })
        .catch((e: any) => {
          const message = e.message || "The research draft could not be prepared";
          updatePrepareJob(prospectId, "error");
          setRowErrors((all) => ({ ...all, [prospectId]: message }));
          setError(message);
        })
        .finally(() => {
          activePrepareRef.current.delete(prospectId);
          void Promise.all([loadCore(), loadProspects()]).finally(() => {
            runPrepareQueue();
          });
        });
    }
  }, [loadCore, loadProspects, updatePrepareJob]);

  const enqueuePrepare = useCallback(
    (prospectId: string) => {
      const current = prepareJobsRef.current[prospectId];
      if (current === "queued" || current === "researching") return;
      prepareQueueRef.current.push(prospectId);
      updatePrepareJob(prospectId, "queued");
      setError("");
      setNotice("Added to the research queue. You can prepare another prospect now.");
      queueMicrotask(runPrepareQueue);
    },
    [runPrepareQueue, updatePrepareJob]
  );

  // Resume any unfinished research after a refresh. The prepare endpoint is
  // idempotent, so an interrupted item is safe to run again and cannot send.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PREPARE_QUEUE_KEY) || "[]");
      if (!Array.isArray(saved)) return;
      for (const prospectId of saved.filter((value) => typeof value === "string")) {
        if (prepareQueueRef.current.includes(prospectId)) continue;
        prepareQueueRef.current.push(prospectId);
        prepareJobsRef.current[prospectId] = "queued";
      }
      if (prepareQueueRef.current.length) {
        setPrepareJobs({ ...prepareJobsRef.current });
        queueMicrotask(runPrepareQueue);
      }
    } catch {
      window.localStorage.removeItem(PREPARE_QUEUE_KEY);
    }
  }, [runPrepareQueue]);

  useEffect(() => { loadCore(); }, [loadCore]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab");
    if (tabs.some((item) => item.key === requested)) setTab(requested as Tab);
    const requestedSearch = params.get("q");
    if (requestedSearch) setQ(requestedSearch);
    if (params.get("sort") === "activity") {
      setProspectSort("activity");
      setSortDirection("desc");
    }
  }, []);
  useEffect(() => {
    let alive = true;
    const requests: Promise<void>[] = [];
    if (tab === "prospects") requests.push(loadProspects());
    if (tab === "safety") requests.push(loadSuppressions());
    if (tab === "campaign") requests.push(loadCampaignStats());
    if (tab === "campaign" || tab === "intelligence" || tab === "activity" || tab === "replies")
      requests.push(loadMetrics());
    if (!requests.length) return;
    setTabLoading(true);
    Promise.all(requests)
      .catch((e: any) => alive && setError(e.message || "Could not load this section"))
      .finally(() => alive && setTabLoading(false));
    return () => { alive = false; };
  }, [tab, loadCampaignStats, loadMetrics, loadProspects, loadSuppressions]);
  useEffect(() => {
    const next: Record<string, { subject: string; body_text: string; voice_script: string }> = {};
    for (const row of queue) if (row.message) next[row.message.id] = { subject: row.message.subject || "", body_text: row.message.body_text || "", voice_script: row.message.voice_script || "" };
    for (const reply of replies) if (reply.bookingDraft) next[reply.bookingDraft.id] = { subject: reply.bookingDraft.subject || "", body_text: reply.bookingDraft.body_text || "", voice_script: reply.bookingDraft.voice_script || "" };
    setDraftEdits(next);
  }, [queue, replies]);
  useEffect(() => {
    if (selectedCampaignId) setExpandedCampaignId(selectedCampaignId);
  }, [selectedCampaignId]);

  const orderedCampaigns = useMemo(
    () => campaigns.slice().sort((left, right) => {
      if (left.id === selectedCampaignId) return -1;
      if (right.id === selectedCampaignId) return 1;
      return new Date(right.updated_at || right.created_at || 0).getTime() -
        new Date(left.updated_at || left.created_at || 0).getTime();
    }),
    [campaigns, selectedCampaignId]
  );
  const activeCampaign = orderedCampaigns.find(
    (campaign) => campaign.id === selectedCampaignId
  ) || orderedCampaigns.find((campaign) => campaign.status === "active");
  const activeCampaignQueueCount = activeCampaign
    ? queue.filter((row) => row.campaign?.id === activeCampaign.id).length
    : 0;
  const selectableCampaigns = orderedCampaigns.filter(
    (campaign) => campaign.status === "active"
  );
  const selectTab = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "queue") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };
  const setMessage = (id: string, patch: Partial<{ subject: string; body_text: string; voice_script: string }>) => {
    const styled = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, removeDashesFromProse(value)])
    ) as Partial<{ subject: string; body_text: string; voice_script: string }>;
    setDraftEdits((all) => ({ ...all, [id]: { subject: all[id]?.subject || "", body_text: all[id]?.body_text || "", voice_script: all[id]?.voice_script || "", ...styled } }));
  };

  const buildQueue = async () => {
    setBusy("queue"); setError(""); setNotice("");
    try { const data = await crmFetch<any>("/api/crm/outreach/queue", { method: "POST", body: JSON.stringify({ limit: activeCampaign?.daily_limit || 20 }) }); setQueue(data.queue || []); const held = data.selection?.held || 0; const skipped = data.selection?.skipped || 0; setNotice(`${data.added || 0} best-fit people added. ${held} held for stronger evidence${skipped ? ` and ${skipped} skipped` : ""}.`); await loadCore(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const selectActiveCampaign = async (campaignId: string) => {
    if (!campaignId || campaignId === selectedCampaignId) return;
    setBusy("select-campaign"); setError(""); setNotice("");
    try {
      const result = await crmFetch<{ selectedCampaignId: string; campaign: Campaign }>(
        "/api/crm/outreach/campaigns/select",
        { method: "POST", body: JSON.stringify({ campaignId }) }
      );
      setSelectedCampaignId(result.selectedCampaignId);
      setQueue([]);
      setNotice(`${result.campaign.name} is now your campaign. Your teammates keep their own selections.`);
      await Promise.all([loadCore(), tab === "prospects" ? loadProspects() : Promise.resolve()]);
    } catch (e: any) {
      setError(e.message || "The campaign could not be selected");
    } finally {
      setBusy("");
    }
  };
  const prepare = (prospectId: string) => enqueuePrepare(prospectId);
  const saveDraft = async (messageId: string) => {
    setBusy(`save:${messageId}`); setError("");
    try {
      const { message } = await crmFetch<{ message: Record<string, any> }>(`/api/crm/outreach/messages/${messageId}`, { method: "PATCH", body: JSON.stringify(draftEdits[messageId]) });
      if (!message?.id) throw new Error("Draft was not confirmed");
      setQueue((all) => all.map((row) => row.message?.id === messageId ? { ...row, message: { ...row.message, ...message } } : row));
      setReplies((all) => all.map((reply) => reply.bookingDraft?.id === messageId ? { ...reply, bookingDraft: { ...reply.bookingDraft, ...message } } : reply));
      setDraftEdits((all) => ({ ...all, [messageId]: { subject: message.subject || "", body_text: message.body_text || "", voice_script: message.voice_script || "" } }));
      setNotice("Draft saved.");
    }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const generateVoiceNote = async (messageId: string) => {
    const visible = draftEdits[messageId];
    if (!visible?.subject?.trim() || !visible?.body_text?.trim()) {
      setError("Save the email and voice pitch before creating audio");
      return;
    }
    setBusy(`voice:${messageId}`); setError(""); setNotice("");
    try {
      const { message: saved } = await crmFetch<{ message: Record<string, any> }>(
        `/api/crm/outreach/messages/${messageId}`,
        { method: "PATCH", body: JSON.stringify(visible) }
      );
      if (!saved?.id) throw new Error("The voice pitch was not saved");
      const result = await crmFetch<{ message: Record<string, any>; reused: boolean }>(
        `/api/crm/outreach/messages/${messageId}/voice`,
        { method: "POST", body: "{}" }
      );
      if (result.message?.voice_status !== "ready")
        throw new Error("The voice preview was not confirmed");
      setQueue((all) => all.map((row) => row.message?.id === messageId
        ? { ...row, message: { ...row.message, ...result.message } }
        : row));
      setDraftEdits((all) => ({
        ...all,
        [messageId]: {
          subject: result.message.subject || visible.subject,
          body_text: result.message.body_text || visible.body_text,
          voice_script: result.message.voice_script || visible.voice_script,
        },
      }));
      setNotice(result.reused
        ? "The existing personal voice note is ready to preview."
        : "Personal voice note created once and ready to preview.");
      await loadCore();
    } catch (e: any) {
      setError(e.message || "The personal voice note could not be created");
      await loadCore();
    } finally {
      setBusy("");
    }
  };
  const send = async (messageId: string) => {
    setBusy(`send:${messageId}`); setError("");
    try {
      const result = await crmFetch<any>(`/api/crm/outreach/messages/${messageId}/send`, { method: "POST", body: "{}" });
      setNotice(`Queued safely for ${formatActivityDate(result.scheduledAt)}. Approved emails send five minutes apart.`);
      await loadCore();
    }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const approveAndSend = async (messageId: string) => {
    setBusy(`approve-send:${messageId}`); setError(""); setNotice("");
    try {
      const visible = draftEdits[messageId];
      if (!visible?.subject?.trim() || !visible?.body_text?.trim())
        throw new Error("Add a subject and email before sending");
      const { message } = await crmFetch<{ message: Record<string, any> }>(
        `/api/crm/outreach/messages/${messageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...visible, status: "approved" }),
        }
      );
      if (!message?.id || message.status !== "approved")
        throw new Error("The exact visible draft was not approved");
      const result = await crmFetch<any>(
        `/api/crm/outreach/messages/${messageId}/send`,
        { method: "POST", body: "{}" }
      );
      setNotice(
        `Exact draft approved and queued for ${formatActivityDate(result.scheduledAt)}. It will send automatically from ${sender?.senderEmail || "your connected mailbox"}.`
      );
      await Promise.all([loadCore(), tab === "replies" ? loadMetrics() : Promise.resolve()]);
    } catch (e: any) {
      setError(e.message || "The email was not queued");
    } finally {
      setBusy("");
    }
  };
  const prepareAllRemaining = () => {
    const ids = queue
      .filter(
        (row) =>
          !row.message &&
          row.status === "queued" &&
          (row.sequenceStep?.channel || "email") === "email" &&
          row.prospect?.id
      )
      .map((row) => row.prospect.id)
      .filter((id) => !["queued", "researching", "done"].includes(prepareJobsRef.current[id] || ""));
    if (!ids.length) {
      setNotice("Every eligible person in today's queue is already prepared or in progress.");
      return;
    }
    for (const id of ids) enqueuePrepare(id);
    setNotice(`${ids.length} prospects added to the research queue. Two will prepare at a time while you keep reviewing.`);
  };
  const completeManualSequenceStep = async (row: QueueRow) => {
    const step = row.sequenceStep;
    if (!step || step.channel !== "linkedin" || !step.actionType) return;
    const prospectId = row.prospect?.id;
    setBusy(`sequence-action:${row.id}`);
    setRowErrors((all) => ({ ...all, [prospectId]: "" }));
    setNotice("");
    try {
      const result = await crmFetch<any>(
        `/api/crm/outreach/${prospectId}/sequence-action`,
        {
          method: "POST",
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            enrolmentId: row.id,
            actionType: step.actionType,
          }),
        }
      );
      setNotice(
        result.nextStep
          ? `Manual ${step.channel} step saved. The next step is due ${formatActivityDate(result.enrolment?.next_action_at)}.`
          : "Manual step saved. This sequence is complete."
      );
      await loadCore();
    } catch (caught: any) {
      setRowErrors((all) => ({
        ...all,
        [prospectId]: caught?.message || "The manual step did not save",
      }));
      await loadCore();
    } finally {
      setBusy("");
    }
  };
  const approveAllPrepared = async () => {
    const drafts = queue.filter(
      (row) =>
        row.message &&
        ["draft", "failed"].includes(row.message.status) &&
        (!row.message.voice_script || row.message.voice_status === "ready")
    );
    if (!drafts.length) {
      setNotice("There are no prepared drafts waiting for approval.");
      return;
    }
    setBusy("approve-all"); setError(""); setNotice("");
    try {
      let lastScheduledAt = "";
      for (const row of drafts) {
        const currentMessage = row.message;
        if (!currentMessage) continue;
        const messageId = currentMessage.id;
        const visible = draftEdits[messageId];
        if (!visible?.subject?.trim() || !visible?.body_text?.trim())
          throw new Error(`The draft for ${row.prospect?.first_name || "this prospect"} is incomplete`);
        const { message } = await crmFetch<{ message: Record<string, any> }>(
          `/api/crm/outreach/messages/${messageId}`,
          { method: "PATCH", body: JSON.stringify({ ...visible, status: "approved" }) }
        );
        if (!message?.id || message.status !== "approved")
          throw new Error("One of the exact visible drafts was not confirmed as approved");
        const queued = await crmFetch<any>(
          `/api/crm/outreach/messages/${messageId}/send`,
          { method: "POST", body: "{}" }
        );
        lastScheduledAt = queued.scheduledAt || lastScheduledAt;
      }
      setNotice(`${drafts.length} reviewed drafts approved and queued five minutes apart${lastScheduledAt ? `. The last is scheduled for ${formatActivityDate(lastScheduledAt)}` : ""}.`);
      await loadCore();
    } catch (e: any) {
      setError(e.message || "The prepared drafts could not all be queued");
      await loadCore();
    } finally {
      setBusy("");
    }
  };
  const rehearse = async (messageId: string) => {
    const rehearsalRecipient = sender?.mailboxEmail || "your connected mailbox";
    if (!confirm(`Send this exact draft only to ${rehearsalRecipient} as a rehearsal? The prospect will not be contacted and campaign results will not change.`)) return;
    setBusy(`rehearse:${messageId}`); setError(""); setNotice("");
    try {
      // Save the words currently visible in the editor first. Otherwise an
      // unsaved edit could make the rehearsal differ from what Lee reviewed.
      const { message } = await crmFetch<{ message: Record<string, any> }>(`/api/crm/outreach/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify(draftEdits[messageId] || {}),
      });
      if (!message?.id || message.subject !== draftEdits[messageId]?.subject?.trim() || message.body_text !== draftEdits[messageId]?.body_text?.trim()) throw new Error("Save the visible draft before rehearsing it");
      setQueue((all) => all.map((row) => row.message?.id === messageId ? { ...row, message: { ...row.message, ...message } } : row));
      const result = await crmFetch<{
        ok: boolean;
        accepted: boolean;
        sentTo: string;
        from: string;
        provider: "google" | "microsoft";
        deliveryLocation: "sent_or_all_mail" | "inbox_or_sent";
        campaignChanged: boolean;
      }>(`/api/crm/outreach/messages/${messageId}/rehearse`, { method: "POST", body: "{}" });
      if (!result.ok || !result.accepted || (sender?.mailboxEmail && result.sentTo !== sender.mailboxEmail) || result.campaignChanged !== false) throw new Error("The safe rehearsal was not confirmed");
      setNotice(
        result.provider === "google" && result.deliveryLocation === "sent_or_all_mail"
          ? `Gmail accepted the rehearsal from ${result.from} to ${result.sentTo}. Because this is the same Gmail account, look in Sent or All Mail rather than waiting for a new Inbox message. No prospect was contacted and campaign results did not change.`
          : `The mailbox accepted the rehearsal from ${result.from} to ${result.sentTo}. Check Inbox or Sent. No prospect was contacted and campaign results did not change.`
      );
    }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const updatePriority = async (id: string, value: Priority) => {
    const previous = prospects.find((prospect) => prospect.id === id);
    setProspects((all) => all.map((p) => p.id === id ? { ...p, priority: value } : p));
    try {
      const { prospect } = await crmFetch<{ prospect: Prospect }>(`/api/crm/outreach/${id}`, { method: "PATCH", body: JSON.stringify({ priority: value }) });
      if (prospect?.priority !== value) throw new Error("Priority was not confirmed");
      setProspects((all) => all.map((item) => item.id === id ? { ...item, ...prospect } : item));
    }
    catch (e: any) {
      if (previous) setProspects((all) => all.map((item) => item.id === id ? previous : item));
      setError(e.message);
    }
  };
  const updateAssignment = async (id: string, assignedToUserId: string) => {
    const previous = prospects.find((prospect) => prospect.id === id);
    const nextAssignee = assignedToUserId || null;
    setProspects((all) => all.map((prospect) => prospect.id === id ? { ...prospect, assigned_to_user_id: nextAssignee } : prospect));
    try {
      const { prospect } = await crmFetch<{ prospect: Prospect }>(`/api/crm/outreach/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ assignedToUserId: nextAssignee }),
      });
      if (!prospect?.id || prospect.assigned_to_user_id !== nextAssignee) throw new Error("Assignment was not confirmed");
      setProspects((all) => all.map((item) => item.id === id ? { ...item, ...prospect } : item));
      const member = team.find((item) => item.userId === nextAssignee);
      setNotice(nextAssignee ? `Prospect assigned to ${member?.name || "the selected team member"}.` : "Prospect released from its current owner.");
    } catch (e: any) {
      if (previous) setProspects((all) => all.map((item) => item.id === id ? previous : item));
      setError(e.message || "The assignment was not saved");
    }
  };
  const bulkAssignVisible = async (prospectIds: string[]) => {
    if (!bulkAssignee || !prospectIds.length) return;
    const member = team.find((item) => item.userId === bulkAssignee);
    const memberName = member?.name || "the selected team member";
    if (!window.confirm(`Assign ${prospectIds.length} untouched prospects to ${memberName}? This changes ownership only. It will not research or email anyone.`)) return;
    setBusy("bulk-assign"); setError(""); setNotice("");
    try {
      const result = await crmFetch<{
        requested: number;
        assigned: number;
        skipped: number;
      }>("/api/crm/outreach/assign", {
        method: "POST",
        body: JSON.stringify({
          assignedToUserId: bulkAssignee,
          prospectIds,
        }),
      });
      await loadProspects();
      setNotice(
        result.skipped
          ? `${result.assigned} untouched prospects assigned to ${memberName}. ${result.skipped} were safely skipped because they had activity, research, or were no longer eligible.`
          : `${result.assigned} untouched prospects assigned to ${memberName}. Nothing was researched or emailed.`
      );
    } catch (e: any) {
      setError(e.message || "The filtered prospects could not be assigned");
      await loadProspects();
    } finally {
      setBusy("");
    }
  };
  const saveCampaign = async (campaign: Campaign) => {
    setBusy(`campaign:${campaign.id}`); setError("");
    try {
      if (!Number.isFinite(campaign.daily_limit) || campaign.daily_limit < 1 || campaign.daily_limit > 20) throw new Error("Daily maximum must be between 1 and 20");
      const sequenceError = outreachSequenceValidationError(campaign.sequence || []);
      if (sequenceError) throw new Error(sequenceError);
      const { campaign: saved } = await crmFetch<{ campaign: Campaign }>(`/api/crm/outreach/campaigns/${campaign.id}`, { method: "PATCH", body: JSON.stringify(campaign) });
      if (!saved?.id) throw new Error("Campaign was not confirmed");
      setCampaigns((all) => all.map((item) => item.id === saved.id ? { ...item, ...saved } : item));
      setNotice("Campaign settings saved.");
    }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const checkReplies = async () => {
    setBusy("replies"); setError("");
    try { const result = await crmFetch<any>("/api/crm/outreach/replies", { method: "POST", body: "{}" }); setNotice(`Checked ${result.checked} recent contacts and found ${result.replies} new replies.`); await loadMetrics(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const prepareBookingReply = async (prospectId: string) => {
    setBusy(`booking:${prospectId}`); setError(""); setNotice("");
    try { await crmFetch(`/api/crm/outreach/replies/${prospectId}/draft`, { method: "POST", body: "{}" }); setNotice("Booking reply ready. Review and approve the exact wording before sending."); await loadMetrics(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const reviewHandover = async (prospectId: string) => {
    setBusy(`handover-check:${prospectId}`); setError(""); setNotice("");
    try {
      const { handover } = await crmFetch<{ handover: HandoverPreview }>(`/api/crm/outreach/${prospectId}/handover`);
      setHandoverReviews((all) => ({ ...all, [prospectId]: handover }));
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const completeHandover = async (prospectId: string, companyId?: string) => {
    setBusy(`handover-save:${prospectId}`); setError(""); setNotice("");
    try {
      const result = await crmFetch<{ companyId: string }>(`/api/crm/outreach/${prospectId}/handover`, {
        method: "POST",
        body: JSON.stringify(companyId ? { companyId } : { createNew: true }),
      });
      setNotice("CRM handover complete. The client profile and call context are now linked.");
      setHandoverReviews((all) => { const next = { ...all }; delete next[prospectId]; return next; });
      await loadMetrics();
      if (result.companyId) window.history.replaceState({}, "", "/crm/outreach?tab=replies");
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const addSuppression = async () => {
    if (!blockTarget.trim()) return;
    setBusy("block"); setError("");
    try { await crmFetch("/api/crm/outreach/suppressions", { method: "POST", body: JSON.stringify({ target: blockTarget }) }); setBlockTarget(""); setNotice("Added to the do-not-contact list."); await loadSuppressions(); }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const restoreSuppression = async (target: string) => {
    if (!confirm(`Allow outreach to ${target} again? Existing sent history will remain.`)) return;
    setBusy(`restore:${target}`); setError(""); setNotice("");
    try {
      const result = await crmFetch<{ restoredProspects?: number }>("/api/crm/outreach/suppressions", {
        method: "DELETE",
        body: JSON.stringify({ target }),
      });
      await Promise.all([loadSuppressions(), loadProspects()]);
      setNotice(`${target} can be considered for outreach again. ${result.restoredProspects || 0} prospect records were restored.`);
    } catch (e: any) {
      setError(e.message || "The block could not be removed");
    } finally {
      setBusy("");
    }
  };

  const addProspectToTeamQueue = async (prospect: Prospect) => {
    const campaignIds = prospect.outreach?.campaignIds || [];
    const savedCampaignId = prospect.outreach?.enrolment?.campaign_id;
    const prospectCampaign = campaigns.find(
      (campaign) =>
        campaign.status === "active" && campaign.id === savedCampaignId
    ) || campaigns.find(
      (campaign) =>
        campaign.status === "active" && campaignIds.includes(campaign.id)
    );
    if (campaignIds.length && !prospectCampaign) {
      throw new Error("This prospect's campaign is not active");
    }
    const targetCampaign = prospectCampaign || activeCampaign;
    if (!targetCampaign) throw new Error("Choose an active campaign first");
    const payload = {
      prospectId: prospect.id,
      campaignId: targetCampaign.id,
      limit: targetCampaign.daily_limit || 20,
    };
    try {
      return await crmFetch("/api/crm/outreach/queue", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (error: any) {
      const needsManagerOverride = String(error?.message || "").includes(
        "within the last 30 days"
      );
      if (!needsManagerOverride || !canManageAssignments) throw error;
      if (!window.confirm(
        "This email address was contacted through another campaign within the last 30 days. Override the safety pause and record why?"
      )) throw new Error("The 30 day campaign safety pause remains in place");
      const reason = window.prompt(
        "Why is contacting this email address again appropriate? This reason is saved in the outreach history."
      )?.trim();
      if (!reason) throw new Error("No override was made");
      if (reason.length < 10) throw new Error("Give a clearer override reason before continuing");
      return crmFetch("/api/crm/outreach/queue", {
        method: "POST",
        body: JSON.stringify({ ...payload, cooldownOverrideReason: reason }),
      });
    }
  };

  const prepareFromProspects = async (prospect: Prospect) => {
    const existingJob = prepareJobsRef.current[prospect.id];
    if (existingJob === "adding" || existingJob === "queued" || existingJob === "researching") return;
    updatePrepareJob(prospect.id, "adding");
    setError(""); setNotice("");
    try {
      if (!queue.some((row) => row.prospect?.id === prospect.id && row.status === "queued"))
        await addProspectToTeamQueue(prospect);
      enqueuePrepare(prospect.id);
    } catch (e: any) {
      updatePrepareJob(prospect.id, "error");
      setError(e.message || "This prospect could not be prepared");
    }
  };

  const openProspectWork = async (prospect: Prospect) => {
    setBusy(`prospect-open:${prospect.id}`); setError(""); setNotice("");
    try {
      if (!queue.some((row) => row.prospect?.id === prospect.id))
        await addProspectToTeamQueue(prospect);
      await loadCore();
      selectTab("queue");
      setNotice("Draft opened in Today. Review the exact wording before approval or sending.");
    } catch (e: any) {
      setError(e.message || "This draft could not be opened in Today");
    } finally {
      setBusy("");
    }
  };

  const removeFromOutreach = async (prospect: Prospect, scope: "person" | "company") => {
    const target = scope === "company" ? prospect.company_domain : prospect.email;
    if (!target) {
      setError("There is no saved company domain to block");
      return;
    }
    const label = scope === "company" ? prospect.company_name : `${prospect.first_name || ""} ${prospect.last_name || ""}`.trim();
    if (!confirm(`Remove ${label} from outreach? This stops future emails but keeps the existing history.`)) return;
    setBusy(`remove:${prospect.id}`); setError(""); setNotice("");
    try {
      const result = await crmFetch<{ affectedProspects?: number }>("/api/crm/outreach/suppressions", {
        method: "POST",
        body: JSON.stringify({
          target,
          reason: scope === "company" ? "Company removed from outreach" : "Person removed from outreach",
        }),
      });
      setRemovalProspectId("");
      await Promise.all([loadProspects(), loadCore()]);
      setNotice(
        scope === "company"
          ? `${prospect.company_name} is blocked from future outreach. ${result.affectedProspects || 0} saved prospect records were removed from active outreach.`
          : `${label} is removed from active outreach and cannot be emailed by a campaign.`
      );
    } catch (e: any) {
      setError(e.message || "The removal was not saved");
    } finally {
      setBusy("");
    }
  };

  const createEngagementComment = async () => {
    setBusy("engage-create"); setError(""); setNotice("");
    try {
      const result = await crmFetch<{ draft: EngagementDraft; savedToBrain: boolean }>("/api/crm/outreach/engage", {
        method: "POST",
        body: JSON.stringify({ source: engagementInput }),
      });
      if (!result.draft?.comment || result.savedToBrain !== false) throw new Error("The private comment draft was not confirmed");
      setEngagementDraft(result.draft);
      setEngagementComment(result.draft.comment);
      setNotice("Comment ready below. It has not been posted and nothing was saved to Brain.");
      requestAnimationFrame(() => document.getElementById("linkedin-comment-result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e: any) {
      setError(e.message || "This LinkedIn comment could not be prepared");
    } finally {
      setBusy("");
    }
  };

  const copyEngagementComment = async () => {
    try {
      if (!engagementComment.trim()) throw new Error("There is no comment to copy");
      await navigator.clipboard.writeText(engagementComment.trim());
      setNotice("Comment copied. Paste it into LinkedIn when you are happy with it.");
    } catch {
      setError("Your browser blocked copying. Select the comment and copy it manually.");
    }
  };

  const startAnotherEngagement = () => {
    setEngagementInput("");
    setEngagementDraft(null);
    setEngagementComment("");
    setNotice("");
    setError("");
  };

  const changeProspectSort = (next: ProspectSort) => {
    if (prospectSort === next) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else {
      setProspectSort(next);
      setSortDirection(next === "name" || next === "company" ? "asc" : "desc");
    }
  };

  const needle = useDeferredValue(q).trim().toLowerCase();
  const shown = useMemo(() => {
    const priorityRank: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
    const activityTime = (prospect: Prospect) => new Date(
      prospect.last_reply_at ||
      prospect.source_metadata?.latest_manual_call?.occurredAt ||
      prospect.outreach?.latestSentMessage?.sent_at ||
      prospect.outreach?.latestMessage?.updated_at ||
      prospect.updated_at ||
      0
    ).getTime();
    const rows = prospects.filter((prospect) => {
      const stage = outreachStage(prospect).key;
      const stageMatches = stageFilter === "all" || (stageFilter === "active" ? stage !== "suppressed" : stage === stageFilter);
      return stageMatches &&
        (prospectCampaignId === "all" || prospect.outreach?.campaignIds?.includes(prospectCampaignId)) &&
        (ownerFilter === "all" ||
          (ownerFilter === "available" &&
            (!prospect.assigned_to_user_id ||
              prospect.assigned_to_user_id === currentUser)) ||
          (ownerFilter === "mine" && prospect.assigned_to_user_id === currentUser) ||
          (ownerFilter === "unassigned" && !prospect.assigned_to_user_id) ||
          prospect.assigned_to_user_id === ownerFilter) &&
        (priority === "all" || prospect.priority === priority) &&
        (recommendationFilter === "all" || prospect.recommendation?.action === recommendationFilter) &&
        (!needle || `${prospect.first_name || ""} ${prospect.last_name || ""} ${prospect.company_name} ${prospect.job_title || ""} ${prospect.email}`.toLowerCase().includes(needle));
    });
    rows.sort((left, right) => {
      let compared = 0;
      if (prospectSort === "name") compared = `${left.first_name || ""} ${left.last_name || ""}`.localeCompare(`${right.first_name || ""} ${right.last_name || ""}`);
      else if (prospectSort === "company") compared = String(left.company_name || "").localeCompare(String(right.company_name || ""));
      else if (prospectSort === "priority") compared =
        priorityRank[left.priority] - priorityRank[right.priority] ||
        Number(left.priority_score || 0) - Number(right.priority_score || 0) ||
        Number(left.recommendation?.score || 0) - Number(right.recommendation?.score || 0);
      else if (prospectSort === "status") compared = outreachStage(left).label.localeCompare(outreachStage(right).label);
      else compared = activityTime(left) - activityTime(right);
      return sortDirection === "asc" ? compared : -compared;
    });
    return rows;
  }, [currentUser, needle, ownerFilter, priority, prospectCampaignId, prospectSort, prospects, recommendationFilter, sortDirection, stageFilter]);

  const bulkEligible = useMemo(
    () => shown.filter(
      (prospect) =>
        isUntouchedProspect(prospect) &&
        prospect.assigned_to_user_id !== bulkAssignee
    ),
    [bulkAssignee, shown]
  );

  const engagementSource = engagementInput.trim();
  const engagementReady = engagementSource.length >= 25 && !/^https?:\/\/\S+$/i.test(engagementSource);

  const funnel = [
    { label: "My prospects", value: metrics.prospects || 0, colour: "bg-sky" },
    { label: "Emails sent", value: metrics.sent || 0, colour: "bg-amber" },
    { label: "Replies", value: metrics.replies || 0, colour: "bg-bone" },
    { label: "Interested", value: metrics.positiveReplies || 0, colour: "bg-moss" },
    { label: "Meetings", value: metrics.meetings || 0, colour: "bg-moss" },
  ];
  const researchingCount = Object.values(prepareJobs).filter(
    (status) => status === "researching"
  ).length;
  const queuedResearchCount = Object.values(prepareJobs).filter(
    (status) => status === "queued" || status === "adding"
  ).length;
  // Keep today's untouched work at the top. Sent prospects remain visible as
  // the audit trail, but rotate beneath every person who still needs action.
  // The API's priority order is preserved inside both groups.
  const orderedQueue = useMemo(
    () =>
      queue
        .map((row, originalIndex) => ({ row, originalIndex }))
        .sort((a, b) => {
          const needsAction = (item: QueueRow) => {
            if (item.sequenceStepDue === false) return false;
            if (
              item.message &&
              ["draft", "failed"].includes(item.message.status)
            ) return true;
            return (
              !item.message &&
              item.status === "queued" &&
              !["completed", "paused", "replied", "booked", "suppressed"].includes(
                item.status
              )
            );
          };
          return (
            Number(needsAction(b.row)) - Number(needsAction(a.row)) ||
            a.originalIndex - b.originalIndex
          );
        })
        .map(({ row }) => row),
    [queue]
  );
  const remainingToPrepare = queue.filter(
    (row) =>
      !row.message &&
      row.status === "queued" &&
      (row.sequenceStep?.channel || "email") === "email"
  ).length;
  const manualStepsDue = queue.filter(
    (row) =>
      !row.message &&
      row.sequenceStepDue !== false &&
      (row.sequenceStep?.channel || "email") !== "email" &&
      !["completed", "paused", "replied", "booked", "suppressed"].includes(
        row.status
      )
  ).length;
  const preparedToApprove = queue.filter(
    (row) =>
      row.message &&
      ["draft", "failed"].includes(row.message.status) &&
      (!row.message.voice_script || row.message.voice_status === "ready")
  ).length;
  const scheduledToSend = queue.filter(
    (row) => row.message?.status === "approved" && row.message?.scheduled_at
  ).length;

  return (
    <main className="relative z-10 mx-auto max-w-[1180px] px-3 py-5 sm:px-5 sm:py-9">
      <NavMenu />
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-edge pb-4">
        <div><h1 className="font-display text-[1.55rem] tracking-tight text-bone"><span className="italic text-amber">Interviewa</span> outreach</h1><p className="mt-1 font-mono text-[0.57rem] uppercase tracking-wider text-muted">Approval mode · from {sender?.senderEmail || "your connected mailbox"} · maximum 20/day</p></div>
        <Link href="/crm" className="shrink-0 rounded-full border border-edge px-3 py-2 font-mono text-[0.6rem] uppercase text-muted">◂ CRM</Link>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[{ label: "Today's queue", value: queue.length, tab: "queue" as Tab }, { label: "Sent today", value: metrics.sentToday || 0, tab: "activity" as Tab }, { label: "Awaiting approval", value: queue.filter((r) => r.message?.status === "draft").length, tab: "queue" as Tab }, { label: "Positive replies", value: metrics.positiveReplies || 0, tab: "replies" as Tab }].map((item) => <button type="button" onClick={() => selectTab(item.tab)} key={item.label} className="rounded-xl border border-edge bg-panel p-3 text-left transition hover:border-amber/55"><strong className="block font-display text-2xl text-bone">{item.value}</strong><span className="font-mono text-[0.55rem] uppercase tracking-wider text-muted">{item.label} ↘</span></button>)}
      </section>

      <nav aria-label="Outreach sections" className="sticky top-0 z-40 mb-4 -mx-3 flex overflow-x-auto border-y border-edge bg-ink/95 px-3 shadow-[0_10px_25px_rgba(0,0,0,0.32)] backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        {tabs.map((item) => <button key={item.key} onClick={() => selectTab(item.key)} className={`min-h-12 shrink-0 border-b-2 px-3 font-mono text-[0.6rem] uppercase tracking-wider ${tab === item.key ? "border-amber text-amber" : "border-transparent text-muted"}`}><span className="mr-1.5">{item.icon}</span>{item.label}</button>)}
      </nav>

      {notice ? <p className="mb-3 rounded-lg border border-moss/40 bg-moss/10 px-3 py-2 text-sm text-moss">{notice}</p> : null}
      {error ? <p className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p> : null}
      {researchingCount || queuedResearchCount ? <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky/45 bg-sky/[0.08] px-3 py-2 text-sm text-sky" role="status" aria-live="polite"><span className="h-2 w-2 animate-pulse rounded-full bg-sky" /><strong>{researchingCount} researching</strong>{queuedResearchCount ? <span>· {queuedResearchCount} waiting</span> : null}<span className="text-bone/65">You can keep working or add more prospects.</span></div> : null}
      {loading ? <MatrixRain size="panel" messages={["loading outreach", "checking today's queue", "refreshing campaign activity"]} /> : null}
      {!loading && tabLoading ? <MatrixRain size="compact" messages={["loading this outreach view"]} /> : null}

      {!loading && !tabLoading && tab === "queue" ? <section data-sales-tour="outreach-queue">
        <RevenueToday />
        <div className="mb-4 rounded-xl border border-moss/35 bg-moss/[0.06] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[0.55rem] uppercase tracking-wider text-moss">Campaign to top up</p><h2 className="mt-1 font-display text-lg text-bone">{activeCampaign?.name || "No active campaign"}</h2><p className="mt-1 text-sm text-muted">This choice controls Rank + build only. The combined list below keeps queued work from every campaign together.</p></div>{selectableCampaigns.length ? <label className="w-full sm:w-72"><span className="sr-only">Choose your active campaign</span><select aria-label="Choose your active campaign" className={`${input} min-h-11`} value={activeCampaign?.id || ""} onChange={(event) => void selectActiveCampaign(event.target.value)} disabled={!!busy}>{selectableCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label> : <button type="button" onClick={() => selectTab("campaign")} className={button}>Review campaigns</button>}</div></div>
        <div className="mb-4 rounded-xl border border-edge bg-panel p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-display text-lg text-bone">Today’s combined queue</h2><p className="mt-1 text-sm text-muted">Work email, LinkedIn and phone steps in one order. LiveCoach automates only approved email delivery. Every social or phone action stays under your control.</p><p className="mt-2 font-mono text-[0.56rem] uppercase tracking-wider text-muted">{remainingToPrepare} emails to prepare · {manualStepsDue} manual actions · {preparedToApprove} awaiting approval · {scheduledToSend} scheduled</p></div><button onClick={buildQueue} disabled={!!busy || activeCampaignQueueCount >= (activeCampaign?.daily_limit || 20)} className={button}>{busy === "queue" ? "Ranking…" : activeCampaignQueueCount ? `Top up ${activeCampaign?.name || "campaign"} to ${activeCampaign?.daily_limit || 20}` : "Rank + build for this campaign"}</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><button onClick={prepareAllRemaining} disabled={!!busy || !remainingToPrepare} className={button}>{remainingToPrepare ? `Prepare all email steps (${remainingToPrepare})` : "All email research prepared"}</button><button onClick={approveAllPrepared} disabled={!!busy || !preparedToApprove} className={primary}>{busy === "approve-all" ? "Approving and queueing…" : preparedToApprove ? `Approve all prepared & queue (${preparedToApprove})` : "No drafts awaiting approval"}</button></div><p className="mt-2 text-xs leading-5 text-muted">Bulk approval applies only to the exact email drafts already shown below. Manual actions must be confirmed one at a time.</p></div>
        <div className="space-y-3">{orderedQueue.map((row, index) => { const p = row.prospect; const m = row.message; const lastSent = row.lastSentMessage; const sequenceStep = row.sequenceStep as SequenceStep | null; const channel = sequenceStep?.channel || "email"; const manual = channel !== "email"; const manualDue = manual && row.sequenceStepDue !== false && !["completed", "paused", "replied", "booked", "suppressed"].includes(row.status); const canPrepare = !manual && !m && row.status === "queued"; const prepareStatus = prepareJobs[p.id]; const preparePending = prepareStatus === "queued" || prepareStatus === "researching" || prepareStatus === "done"; const displayStatus = manualDue ? channel : m?.status === "approved" && m?.scheduled_at ? "scheduled" : m?.status || (lastSent ? "sent" : row.status || "queued"); const edit = m ? draftEdits[m.id] || { subject: m.subject, body_text: m.body_text, voice_script: m.voice_script || "" } : null; return <article key={row.id} style={{ contentVisibility: "auto" }} className="rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-[0.55rem] uppercase text-muted">#{index + 1} · step {row.current_step}{sequenceStep ? ` · ${sequenceStep.purpose}` : ""}</p>
              <h3 className="mt-1 font-display text-lg text-bone">{p.first_name} {p.last_name}</h3>
              <p className="text-sm text-bone/80">{p.job_title} · {p.company_name}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.54rem] uppercase ${pill[p.priority]}`}>{p.priority}</span>
                <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.54rem] uppercase ${pill[displayStatus] || (manual ? "border-sky/50 bg-sky/10 text-sky" : "border-edge text-muted")}`}>{displayStatus === "sent" ? "✓ sent" : displayStatus}</span>
              </div>
              {!m && row.next_action_at && row.sequenceStepDue === false ? <p className="mt-2 text-xs text-muted">Next step becomes ready {formatActivityDate(row.next_action_at)}.</p> : null}
            </div>
            {canPrepare ? <button onClick={() => prepare(p.id)} disabled={preparePending} className={`${primary} w-full sm:w-auto`}>{prepareStatus === "researching" ? "Researching in background…" : prepareStatus === "queued" ? "Queued" : prepareStatus === "done" ? "Draft ready" : Number(row.current_step) > 1 ? "Queue follow up draft" : "Queue research + draft"}</button> : manual && channel === "linkedin" ? <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2"><a href={linkedinTarget(p)} target="_blank" rel="noreferrer" className={`${button} inline-flex items-center justify-center border-sky/45 text-sky`}>Open LinkedIn ↗</a><button type="button" onClick={() => completeManualSequenceStep(row)} disabled={!!busy || !manualDue} className={primary}>{busy === `sequence-action:${row.id}` ? "Saving…" : manualDue ? `Mark ${sequenceActionLabel(sequenceStep?.actionType)} done` : `Due ${formatActivityDate(row.next_action_at)}`}</button></div> : manual && channel === "phone" ? <button type="button" onClick={() => setManualCallProspectId(p.id)} disabled={!!busy || !manualDue} className={`${primary} w-full sm:w-auto`}>{manualDue ? "Call and log outcome" : `Due ${formatActivityDate(row.next_action_at)}`}</button> : !m && lastSent ? <button onClick={() => selectTab("activity")} className="min-h-11 w-full rounded-lg border border-moss bg-moss px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-ink transition hover:bg-moss/85 sm:w-auto">✓ Sent · view email</button> : null}
          </div>
          {manual && sequenceStep?.guidance ? <p className="mt-3 rounded-lg border border-sky/35 bg-sky/[0.05] px-3 py-2 text-xs leading-5 text-sky">{sequenceStep.guidance}</p> : null}
          {manual && channel === "phone" && manualCallProspectId === p.id ? <div className="mt-3"><ProspectManualCall prospect={p} campaignId={row.campaign_id} onCancel={() => setManualCallProspectId("")} onSaved={async () => { setManualCallProspectId(""); setNotice("Call saved. The sequence now follows the outcome you logged."); await Promise.all([loadCore(), loadMetrics()]); }} /></div> : null}
          {rowErrors[p.id] ? <p className="mt-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm leading-5 text-rust">{rowErrors[p.id]}</p> : null}
          <RecommendationCard recommendation={row.recommendation || p.recommendation} compact />
          {row.research ? <details className="mt-4 rounded-lg border border-edge bg-ink/30 p-3"><summary className="cursor-pointer font-mono text-[0.6rem] uppercase tracking-wider text-amber">Why this message {m?.quality_score ? `· quality ${m.quality_score}/100` : ""}</summary><p className="mt-2 text-sm leading-6 text-bone/80">{m?.strategy?.reasoning || row.research.summary}</p><div className="mt-2 flex flex-wrap gap-1.5">{row.research.fitDecision ? <span className="rounded-full border border-moss/40 bg-moss/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase text-moss">{row.research.fitDecision}</span> : null}{row.research.commercialPath ? <span className="rounded-full border border-sky/40 bg-sky/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase text-sky">{row.research.commercialPath}</span> : null}{row.research.volumeAssessment ? <span className="rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase text-amber">{row.research.volumeAssessment} vacancy volume</span> : null}{row.research.freshness ? <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.5rem] uppercase text-muted">{row.research.freshness}</span> : null}</div><p className="mt-2 text-xs text-muted"><strong className="text-bone">Chosen angle:</strong> {m?.strategy?.angle || row.research.bestAngle}</p>{row.research.volumeReason ? <p className="mt-2 text-xs text-muted"><strong className="text-bone">Volume evidence:</strong> {row.research.volumeReason}</p> : null}{row.research.activeJobs?.length ? <div className="mt-2"><p className="font-mono text-[0.53rem] uppercase text-muted">Current jobs found</p><ul className="mt-1 space-y-1 text-xs text-bone/75">{row.research.activeJobs.map((job: string) => <li key={job}>• {job}</li>)}</ul></div> : null}{m?.strategy?.evidenceUsed?.length ? <div className="mt-2"><p className="font-mono text-[0.53rem] uppercase text-muted">Evidence actually used</p><ul className="mt-1 space-y-1 text-xs text-bone/75">{m.strategy.evidenceUsed.map((fact: string) => <li key={fact}>• {fact}</li>)}</ul></div> : null}{(row.research_sources || []).length ? <div className="mt-2 flex flex-wrap gap-2">{row.research_sources.slice(0, 4).map((source: any) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="text-xs text-amber hover:underline">{source.title || "Source"} ↗</a>)}</div> : null}</details> : null}
          {m && edit ? <div className="mt-4 space-y-3 border-t border-edge pt-4"><div className="rounded-lg border border-edge bg-ink/40 px-3 py-2 font-mono text-[0.58rem] text-muted">From: <span className="text-bone">{sender?.senderName || "Your account"} &lt;{m.from_email || sender?.senderEmail || "connected mailbox"}&gt;</span> · To: {p.email}</div><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Subject</span><input className={input} value={edit.subject} onChange={(e) => setMessage(m.id, { subject: e.target.value })} disabled={["sending", "sent"].includes(m.status) || Boolean(m.scheduled_at)} /></label><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Email</span><textarea className={`${input} min-h-44 resize-y leading-6`} value={edit.body_text} onChange={(e) => setMessage(m.id, { body_text: e.target.value })} disabled={["sending", "sent"].includes(m.status) || Boolean(m.scheduled_at)} /></label><OutreachVoiceNoteEditor message={m} script={edit.voice_script} disabled={Boolean(m.scheduled_at)} generating={busy === `voice:${m.id}`} onScriptChange={(value) => setMessage(m.id, { voice_script: value })} onGenerate={() => void generateVoiceNote(m.id)} />{!["sending", "sent"].includes(m.status) && !m.scheduled_at ? <div className="rounded-lg border border-sky/35 bg-sky/[0.06] p-3"><p className="text-xs leading-5 text-bone/75">Test the real email appearance safely. The exact saved body and ready voice note go only to <strong className="text-bone">{sender?.mailboxEmail || "your connected mailbox"}</strong>. The prospect, sequence, daily allowance and results stay untouched.</p>{sender?.provider === "google" ? <p className="mt-2 text-xs leading-5 text-sky">Gmail keeps a rehearsal sent back to the same account under Sent or All Mail. It may not create a new Inbox message.</p> : null}<button onClick={() => rehearse(m.id)} disabled={!!busy} className={`${button} mt-2 w-full border-sky/45 text-sky sm:w-auto`}>{busy === `rehearse:${m.id}` ? "Sending rehearsal…" : "Send rehearsal to me"}</button></div> : null}<div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><button onClick={() => saveDraft(m.id)} disabled={!!busy || ["sending", "sent"].includes(m.status) || Boolean(m.scheduled_at)} className={button}>Save changes</button>{m.status === "draft" || m.status === "failed" ? <button onClick={() => approveAndSend(m.id)} disabled={!!busy || Boolean(edit.voice_script) && (m.voice_status !== "ready" || edit.voice_script.trim() !== String(m.voice_script || "").trim())} className={primary}>{busy === `approve-send:${m.id}` ? "Approving and queueing…" : "Approve & queue"}</button> : null}{m.status === "approved" && !m.scheduled_at ? <button onClick={() => send(m.id)} disabled={!!busy} className={primary}>{busy === `send:${m.id}` ? "Queueing…" : "Queue approved email"}</button> : null}{m.status === "approved" && m.scheduled_at ? <span className="self-center rounded-lg border border-sky bg-sky px-3 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-ink">✓ Queued for {formatActivityDate(m.scheduled_at)}</span> : null}{m.status === "sending" ? <span className="self-center rounded-lg border border-sky/60 bg-sky/10 px-3 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-sky">Sending now</span> : null}{m.status === "sent" ? <span className="self-center font-mono text-xs uppercase text-moss">✓ Sent safely</span> : null}</div><p className="text-right text-xs text-muted">Approved emails and their ready voice notes send automatically five minutes apart. There is no second confirmation pop-up.</p></div> : null}
        </article>; })}{!queue.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">The morning queue can be selected automatically, or you can build it now. Nobody is researched or contacted until you act.</div> : null}</div>
      </section> : null}

      {!loading && !tabLoading && tab === "prospects" ? <section data-sales-tour="prospect-pool">
        <div className="mb-3 rounded-xl border border-edge bg-panel p-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_repeat(6,minmax(0,9rem))]">
            <input className={input} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search person, company, role or email…" />
            <select aria-label="Campaign filter" value={prospectCampaignId} onChange={(event) => setProspectCampaignId(event.target.value)} className={input}><option value="all">All campaigns</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
            <select aria-label="Outreach status filter" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} className={input}>
              <option value="active">Active prospects</option><option value="all">All including removed</option><option value="warm">Warm leads</option><option value="not_started">Not started</option><option value="queued">Queued</option><option value="draft">Draft ready</option><option value="approved">Approved</option><option value="scheduled">Scheduled</option><option value="sent">Sent</option><option value="replied">Replied</option><option value="interested">Interested</option><option value="suppressed">Removed</option>
            </select>
            <select aria-label="Manual priority filter" value={priority} onChange={(event) => setPriority(event.target.value as "all" | Priority)} className={input}><option value="all">All priorities</option><option value="high">High priority</option><option value="medium">Medium priority</option><option value="low">Low priority</option></select>
            <select aria-label="Fit recommendation filter" value={recommendationFilter} onChange={(event) => setRecommendationFilter(event.target.value as "all" | RecommendationAction)} className={input}><option value="all">All fit scores</option><option value="contact_today">Contact today</option><option value="hold">Hold</option><option value="skip">Skip</option></select>
            <select aria-label="Owner filter" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className={input}><option value="available">Mine and available</option><option value="mine">My prospects</option><option value="unassigned">Unassigned</option>{canManageAssignments ? <><option value="all">All owners</option>{team.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}</> : null}</select>
            <select
              aria-label="Sort prospects"
              value={`${prospectSort}:${sortDirection}`}
              onChange={(event) => {
                const [nextSort, nextDirection] = event.target.value.split(":");
                setProspectSort(nextSort as ProspectSort);
                setSortDirection(nextDirection as "asc" | "desc");
              }}
              className={input}
            >
              <option value="priority:desc">Highest priority</option>
              <option value="activity:desc">Latest activity</option>
              <option value="activity:asc">Oldest activity</option>
              <option value="name:asc">Name A to Z</option>
              <option value="name:desc">Name Z to A</option>
              <option value="company:asc">Company A to Z</option>
              <option value="status:asc">Outreach status</option>
            </select>
          </div>
          <p className="mt-2 text-xs text-muted">Showing {shown.length} of {prospects.length}. All campaigns is the combined priority list and every prospect keeps the campaign badge shown on their row. Fit scoring uses no AI tokens. Research only starts when you press Prepare draft.</p>
        </div>

        {canManageAssignments ? <div className="mb-3 rounded-xl border border-sky/40 bg-sky/[0.06] p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="font-display text-base text-bone">Share untouched prospects</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Uses the filters above. Anyone already researched, queued, drafted, contacted, replied, removed, or previously enrolled is automatically protected and skipped.</p></div>
            <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto]">
              <select aria-label="Team member for bulk assignment" value={bulkAssignee} onChange={(event) => setBulkAssignee(event.target.value)} className={input}><option value="">Choose team member</option>{team.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select>
              <button type="button" onClick={() => bulkAssignVisible(bulkEligible.map((prospect) => prospect.id))} disabled={!!busy || !bulkAssignee || !bulkEligible.length} className={`${primary} whitespace-nowrap`}>{busy === "bulk-assign" ? "Assigning safely…" : `Assign filtered (${bulkEligible.length})`}</button>
            </div>
          </div>
          <p className="mt-2 font-mono text-[0.52rem] uppercase tracking-wider text-sky">Assignment only · no research · no emails · every change is audited</p>
        </div> : null}

        <div className="overflow-hidden rounded-xl border border-edge bg-panel">
          <div className="hidden grid-cols-[1.1fr_1.2fr_.65fr_.8fr_.85fr_.9fr_auto] gap-3 border-b border-edge bg-ink/45 px-3 py-2 sm:grid">
            {([
              ["name", "Prospect"], ["company", "Company"], ["priority", "Priority"], ["status", "Outreach"], ["activity", "Last activity"],
            ] as [ProspectSort, string][]).map(([key, label]) => <button type="button" key={key} onClick={() => changeProspectSort(key)} className="text-left font-mono text-[0.52rem] uppercase tracking-wider text-muted hover:text-amber">{label}{prospectSort === key ? sortDirection === "asc" ? " ↑" : " ↓" : ""}</button>)}
            <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">Owner</span>
            <span className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">Action</span>
          </div>
          <div className="divide-y divide-edge">{shown.map((prospect) => {
            const stage = outreachStage(prospect);
            const isBrainDirect = prospect.outreach?.latestMessage?.message_source === "brain_direct";
            const latestManualCall = prospect.source_metadata?.latest_manual_call;
            const lastActivity = prospect.last_reply_at || latestManualCall?.occurredAt || prospect.outreach?.latestSentMessage?.sent_at || prospect.outreach?.latestMessage?.updated_at || prospect.updated_at;
            const pendingStatus = prospect.outreach?.latestMessage?.status;
            const prepareStatus = prepareJobs[prospect.id];
            const preparePending = prepareStatus === "adding" || prepareStatus === "queued" || prepareStatus === "researching" || prepareStatus === "done";
            const openTab: Tab = prospect.last_reply_at ? "replies" : prospect.outreach?.latestMessage ? "activity" : "queue";
            const membershipIds = prospect.outreach?.campaignIds || [];
            const membershipCampaigns = campaigns.filter((campaign) => membershipIds.includes(campaign.id));
            const savedCampaignId = prospect.outreach?.enrolment?.campaign_id;
            const workCampaign = campaigns.find((campaign) => campaign.status === "active" && campaign.id === savedCampaignId) || membershipCampaigns.find((campaign) => campaign.status === "active") || (!membershipIds.length ? activeCampaign : null);
            const campaignReady = Boolean(workCampaign);
            const isMine = prospect.assigned_to_user_id === currentUser;
            const canClaim = !prospect.assigned_to_user_id && !canManageAssignments;
            const canPrepare = isMine && campaignReady && (stage.key === "not_started" || stage.key === "queued");
            const assignedMember = team.find((member) => member.userId === prospect.assigned_to_user_id);
            return <article key={prospect.id} style={{ contentVisibility: "auto" }} className="grid gap-3 p-3 sm:grid-cols-[1.1fr_1.2fr_.65fr_.8fr_.85fr_.9fr_auto] sm:items-center">
              <div className="min-w-0"><h3 className="truncate font-display text-base text-bone">{prospect.first_name} {prospect.last_name}</h3><p className="truncate text-xs text-amber">{prospect.email}</p></div>
              <div className="min-w-0"><p className="truncate text-sm text-bone/85">{prospect.company_name}</p><p className="truncate text-xs text-muted">{prospect.job_title || "Role not saved"}</p><div className="mt-1 flex flex-wrap gap-1">{isBrainDirect ? <span className="rounded-full border border-amber/45 bg-amber/10 px-2 py-0.5 font-mono text-[0.46rem] uppercase text-amber">Brain email</span> : null}{membershipCampaigns.map((campaign) => <span key={campaign.id} className="rounded-full border border-sky/45 bg-sky/10 px-2 py-0.5 font-mono text-[0.46rem] uppercase text-sky">{campaign.name}</span>)}</div></div>
              <label><span className="mb-1 block font-mono text-[0.48rem] uppercase text-muted sm:hidden">Priority</span><select aria-label={`Priority for ${prospect.first_name} ${prospect.last_name}`} value={prospect.priority} onChange={(event) => updatePriority(prospect.id, event.target.value as Priority)} className="min-h-10 w-full rounded-lg border border-edge bg-ink px-2 text-xs text-bone"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              <div><span className="mb-1 block font-mono text-[0.48rem] uppercase text-muted sm:hidden">Outreach</span><div className="flex flex-wrap gap-1"><span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[0.5rem] uppercase ${pill[stage.key] || "border-edge text-muted"}`}>{stage.key === "sent" || stage.key === "interested" ? "✓ " : ""}{stage.label}</span>{prospect.outreach?.sentCount && stage.key !== "sent" ? <span className="inline-flex rounded-full border border-moss/50 bg-moss/10 px-2 py-1 font-mono text-[0.5rem] uppercase text-moss">✓ {prospect.outreach.sentCount} sent</span> : null}</div>{prospect.outreach?.latestSentMessage?.subject ? <p className="mt-1 line-clamp-1 text-[0.68rem] text-muted">{prospect.outreach.latestSentMessage.subject}</p> : null}</div>
              <div><span className="mb-1 block font-mono text-[0.48rem] uppercase text-muted sm:hidden">Last activity</span><p className="text-xs text-bone/80">{formatActivityDate(lastActivity)}</p>{latestManualCall ? <p className="mt-1 line-clamp-2 text-[0.65rem] text-sky">☎ {latestManualCall.interpretation?.summary || latestManualCall.notePreview || "Manual call logged"}</p> : null}{prospect.next_action_at || prospect.outreach?.enrolment?.next_action_at ? <p className="mt-1 text-[0.65rem] text-amber">Next {formatActivityDate(prospect.next_action_at || prospect.outreach.enrolment.next_action_at)}</p> : null}</div>
              <div><span className="mb-1 block font-mono text-[0.48rem] uppercase text-muted sm:hidden">Owner</span>{canManageAssignments ? <select aria-label={`Owner for ${prospect.first_name} ${prospect.last_name}`} value={prospect.assigned_to_user_id || ""} onChange={(event) => updateAssignment(prospect.id, event.target.value)} className="min-h-10 w-full rounded-lg border border-edge bg-ink px-2 text-xs text-bone"><option value="">Unassigned</option>{team.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select> : <span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[0.49rem] uppercase ${prospect.assigned_to_user_id === currentUser ? "border-moss/45 bg-moss/10 text-moss" : "border-edge text-muted"}`}>{prospect.assigned_to_user_id === currentUser ? "Mine" : assignedMember?.name || "Unassigned"}</span>}</div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {!isMine ? canClaim ? <button type="button" onClick={() => updateAssignment(prospect.id, currentUser)} disabled={!!busy} className={`${button} min-h-10 px-3`}>Claim</button> : <span className="inline-flex min-h-10 items-center rounded-lg border border-edge px-3 font-mono text-[0.5rem] uppercase text-muted">Assigned to {assignedMember?.name || "another user"}</span> : isBrainDirect && stage.key !== "suppressed" ? <button type="button" onClick={() => selectTab("activity")} className={`${primary} min-h-10 px-3`}>{pendingStatus === "sent" ? "View sent email" : pendingStatus === "sending" ? "View sending email" : "View queued email"}</button> : !campaignReady && stage.key !== "suppressed" ? <span className="inline-flex min-h-10 items-center rounded-lg border border-amber/45 bg-amber/10 px-3 font-mono text-[0.5rem] uppercase text-amber">{membershipCampaigns[0]?.name || "Campaign"} is not active</span> : canPrepare ? <button type="button" onClick={() => prepareFromProspects(prospect)} disabled={preparePending} className={`${primary} min-h-10 px-3`}>{prepareStatus === "adding" ? "Adding…" : prepareStatus === "researching" ? "Researching…" : prepareStatus === "queued" ? "Queued" : prepareStatus === "done" ? "Draft ready" : "Queue research"}</button> : ["draft", "approved"].includes(stage.key) ? <button type="button" onClick={() => openProspectWork(prospect)} disabled={!!busy} className={`${primary} min-h-10 px-3`}>{busy === `prospect-open:${prospect.id}` ? "Opening…" : pendingStatus === "approved" ? "Review to send" : "Review draft"}</button> : stage.key !== "suppressed" ? <button type="button" onClick={() => selectTab(openTab)} className={`${button} min-h-10 px-3`}>{openTab === "replies" ? "View reply" : "View history"}</button> : null}
                {isMine && stage.key !== "suppressed" ? <details className="relative"><summary className={`${button} flex min-h-10 cursor-pointer list-none items-center px-3 [&::-webkit-details-marker]:hidden`}>Actions ▾</summary><div className="absolute right-0 z-30 mt-1 grid min-w-44 gap-1 rounded-lg border border-edge bg-panel p-2 shadow-xl"><button type="button" onClick={() => { setRemovalProspectId(""); setManualCallProspectId(prospect.id); }} className="min-h-10 rounded-md px-3 text-left font-mono text-[0.55rem] uppercase text-sky hover:bg-sky/10">☎ Log call</button><button type="button" onClick={() => { setManualCallProspectId(""); setRemovalProspectId((current) => current === prospect.id ? "" : prospect.id); }} className="min-h-10 rounded-md px-3 text-left font-mono text-[0.55rem] uppercase text-rust hover:bg-rust/10">Remove from outreach</button></div></details> : null}
              </div>
              {removalProspectId === prospect.id ? <div className="rounded-lg border border-rust/40 bg-rust/[0.07] p-3 sm:col-span-7"><p className="text-sm text-bone/80">Keep the history, but stop future outreach to:</p><div className="mt-2 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => removeFromOutreach(prospect, "person")} disabled={!!busy} className={`${button} border-rust/50 text-rust`}>This person only</button>{prospect.company_domain ? <button type="button" onClick={() => removeFromOutreach(prospect, "company")} disabled={!!busy} className={`${button} border-rust/50 text-rust`}>Everyone at {prospect.company_name}</button> : null}<button type="button" onClick={() => setRemovalProspectId("")} className={button}>Cancel</button></div></div> : null}
              {manualCallProspectId === prospect.id ? <div className="sm:col-span-7"><ProspectManualCall prospect={prospect} campaignId={workCampaign?.id || savedCampaignId || null} onCancel={() => setManualCallProspectId("")} onSaved={async () => { setManualCallProspectId(""); setNotice("Call saved. The next action is already in your work queue while the concise read finishes in the background."); await Promise.all([loadProspects(), loadCore(), loadMetrics()]); }} /></div> : null}
              <details className="sm:col-span-7"><summary className="cursor-pointer font-mono text-[0.5rem] uppercase tracking-wider text-muted">Why this fit score · {prospect.recommendation?.score || 0}/100</summary><RecommendationCard recommendation={prospect.recommendation} compact /></details>
            </article>;
          })}{!shown.length ? <div className="p-8 text-center text-sm text-muted">No prospects match these filters.</div> : null}</div>
        </div>
      </section> : null}

      {!loading && !tabLoading && tab === "signals" ? <section className="space-y-4">
        <div className="rounded-xl border border-amber/40 bg-amber/[0.06] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div><h2 className="font-display text-lg text-bone">LinkedIn engagement writer</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-muted">Paste the words from a LinkedIn post. LiveCoach writes in the signed-in salesperson's own saved voice and creates interest without forcing a sales pitch.</p></div>
            <span className="rounded-full border border-moss/45 bg-moss/10 px-3 py-1 font-mono text-[0.52rem] uppercase text-moss">Manual safe mode</span>
          </div>
          <div className="mt-3 rounded-lg border border-moss/35 bg-moss/[0.06] p-3 text-xs leading-5 text-bone/75"><strong className="text-moss">No LinkedIn scraping.</strong> LiveCoach only reads the words you paste. A connected LinkedIn identity stays private to the signed-in salesperson. Messages, connection requests and this comment remain manual.</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Paste the post words</span><textarea className={`${input} min-h-44 resize-y leading-6`} value={engagementInput} onChange={(event) => setEngagementInput(event.target.value)} placeholder="Copy the post text from LinkedIn and paste it here." /><span className="mt-1 block text-xs text-muted">A link on its own is deliberately rejected. This avoids automated LinkedIn access and gives you a more accurate comment.</span></label>
            <div className="grid content-start gap-3">
              <div className="rounded-lg border border-edge bg-ink/35 p-3 text-xs leading-5 text-bone/75"><strong className="text-bone">How it writes:</strong> it responds to the real point, adds one useful commercial thought and only mentions Interviewa when the connection feels natural.</div>
              <div className="rounded-lg border border-sky/35 bg-sky/[0.06] p-3 text-xs leading-5 text-bone/75"><strong className="text-sky">You stay in control:</strong> nothing is posted automatically. The post and comment are not stored in Brain or added to the CRM.</div>
              <button type="button" onClick={createEngagementComment} disabled={!!busy || !engagementReady} className={`${primary} w-full`}>{busy === "engage-create" ? "Reading post and writing…" : "Create comment"}</button>
            </div>
          </div>
        </div>

        {engagementDraft ? <article id="linkedin-comment-result" className="scroll-mt-24 rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-display text-lg text-bone">Comment for {engagementDraft.authorName || "this post"}</h2><p className="mt-1 text-sm text-muted">Edit the wording if you want, then copy it into LinkedIn.</p></div><span className="rounded-full border border-sky/45 bg-sky/10 px-3 py-1 font-mono text-[0.52rem] uppercase text-sky">Not saved</span></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2"><div className="rounded-lg border border-edge bg-ink/35 p-3"><p className="font-mono text-[0.52rem] uppercase text-amber">Post understood</p><p className="mt-2 text-sm leading-6 text-bone/80">{engagementDraft.postSummary}</p></div><div className="rounded-lg border border-edge bg-ink/35 p-3"><p className="font-mono text-[0.52rem] uppercase text-amber">Chosen angle</p><p className="mt-2 text-sm leading-6 text-bone/80">{engagementDraft.angle}</p></div></div>
          {engagementDraft.evidence.length ? <details className="mt-3 rounded-lg border border-edge bg-ink/25 p-3"><summary className="cursor-pointer font-mono text-[0.52rem] uppercase text-muted">What the writer grounded it in</summary><ul className="mt-2 space-y-1.5 text-sm leading-5 text-bone/75">{engagementDraft.evidence.map((fact) => <li key={fact}>• {fact}</li>)}</ul></details> : null}
          <label className="mt-4 block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Your comment</span><textarea className={`${input} min-h-36 resize-y leading-6`} value={engagementComment} onChange={(event) => setEngagementComment(removeDashesFromProse(event.target.value))} /></label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-muted">Nothing has been posted. Copying leaves the final LinkedIn action with you.</p><div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={startAnotherEngagement} disabled={!!busy} className={button}>Start another</button>{engagementDraft.sourceUrl ? <a href={engagementDraft.sourceUrl} target="_blank" rel="noreferrer" className={`${button} text-center`}>Open original post</a> : null}<button type="button" onClick={copyEngagementComment} disabled={!!busy || !engagementComment.trim()} className={primary}>Copy comment</button></div></div>
        </article> : <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm leading-6 text-muted">Paste a post above to create a comment. Nothing is retained after you leave this page.</div>}
      </section> : null}

      {!loading && !tabLoading && tab === "activity" ? <section className="space-y-4">
        <div className="rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-display text-lg text-bone">Your outreach progress</h2><p className="mt-1 text-sm text-muted">Only emails sent from your account, your replies and your meetings. Opens are deliberately not tracked.</p></div><button type="button" onClick={() => loadMetrics()} className={button}>Refresh progress</button></div>
          <div className="mt-4 space-y-3">{funnel.map((item, index) => {
            const previous = index === 0 ? item.value : funnel[index - 1].value;
            const percentage = index === 0 ? 100 : previous ? Math.round((item.value / previous) * 100) : 0;
            return <div key={item.label} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-3"><span className="font-mono text-[0.52rem] uppercase text-muted">{item.label}</span><div className="h-2.5 overflow-hidden rounded-full bg-ink"><div className={`h-full rounded-full ${item.colour}`} style={{ width: `${item.value ? Math.max(4, percentage) : 0}%` }} /></div><strong className="text-right font-display text-lg text-bone">{item.value}</strong></div>;
          })}</div>
          <div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-lg border border-edge bg-ink/35 p-3"><strong className="block font-display text-xl text-bone">{metrics.sent ? Math.round(((metrics.replies || 0) / metrics.sent) * 100) : 0}%</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Reply rate</span></div><div className="rounded-lg border border-edge bg-ink/35 p-3"><strong className="block font-display text-xl text-bone">{metrics.replies ? Math.round(((metrics.positiveReplies || 0) / metrics.replies) * 100) : 0}%</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Positive replies</span></div><div className="rounded-lg border border-edge bg-ink/35 p-3"><strong className="block font-display text-xl text-bone">{metrics.sent ? Math.round(((metrics.meetings || 0) / metrics.sent) * 100) : 0}%</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Meeting rate</span></div></div>
        </div>

        <div className="rounded-xl border border-sky/35 bg-panel p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-display text-lg text-bone">Manual call activity</h2><p className="mt-1 text-sm text-muted">Calls logged by this signed in salesperson only. Notes stay attached to the assigned prospect and feed the next action.</p></div><span className="rounded-full border border-sky/45 bg-sky/10 px-3 py-1 font-mono text-[0.52rem] uppercase text-sky">{metrics.callsToday || 0} today</span></div>
          <div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-lg border border-edge bg-ink/35 p-3"><strong className="block font-display text-xl text-bone">{metrics.calls || 0}</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Calls logged</span></div><div className="rounded-lg border border-edge bg-ink/35 p-3"><strong className="block font-display text-xl text-bone">{metrics.calls ? Math.round(((metrics.connectedCalls || 0) / metrics.calls) * 100) : 0}%</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Connected</span></div><div className="rounded-lg border border-edge bg-ink/35 p-3"><strong className="block font-display text-xl text-bone">{metrics.callMeetings || 0}</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Meetings booked</span></div></div>
          <div className="mt-3 divide-y divide-edge">{manualCalls.map((call) => <details key={call.id} className="py-3"><summary className="grid cursor-pointer list-none gap-2 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center"><div className="min-w-0"><strong className="block truncate text-sm text-bone">{call.prospect ? `${call.prospect.first_name || ""} ${call.prospect.last_name || ""}`.trim() : "Unknown prospect"}</strong><span className="block truncate text-xs text-muted">{call.prospect?.company_name || call.prospect?.email || "Prospect record unavailable"}</span></div><span className="font-mono text-[0.52rem] uppercase text-sky">{String(call.metadata?.outcome || "call").replace(/_/g, " ")}</span><span className="font-mono text-[0.5rem] uppercase text-muted">{formatActivityDate(call.created_at)}</span></summary><div className="mt-2 rounded-lg border border-edge bg-ink/40 p-3"><p className="text-sm leading-6 text-bone/80">{call.metadata?.note || "No call note was saved"}</p>{call.metadata?.humanNextAction ? <p className="mt-2 text-sm text-amber">Next · {call.metadata.humanNextAction}</p> : null}</div></details>)}{!manualCalls.length ? <p className="py-6 text-center text-sm text-muted">No manual calls logged yet.</p> : null}</div>
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4"><div className="flex items-end justify-between gap-3"><div><h2 className="font-display text-lg text-bone">Recent email activity</h2><p className="mt-1 text-sm text-muted">Approved, queued and sent emails from this signed in account, newest activity first.</p></div><span className="rounded-full border border-moss/50 bg-moss/10 px-2 py-1 font-mono text-[0.52rem] uppercase text-moss">{metrics.sent || 0} sent</span></div>
          <div className="mt-3 divide-y divide-edge">{sentHistory.map((message) => { const statusLabel = message.status === "sent" ? "Sent" : message.status === "sending" ? "Sending" : "Queued"; const statusTone = message.status === "sent" ? "border-moss/50 bg-moss/10 text-moss" : "border-sky/50 bg-sky/10 text-sky"; const activityAt = message.sent_at || message.scheduled_at || message.updated_at; return <details key={message.id} className="group py-3"><summary className="grid cursor-pointer list-none gap-2 sm:grid-cols-[1.1fr_1.2fr_auto] sm:items-center"><div className="min-w-0"><strong className="block truncate text-sm text-bone">{message.prospect ? `${message.prospect.first_name || ""} ${message.prospect.last_name || ""}`.trim() : "Unknown prospect"}</strong><span className="block truncate text-xs text-muted">{message.prospect?.company_name || message.prospect?.email || "Prospect record unavailable"}</span></div><span className="truncate text-sm text-bone/80">{message.subject}</span><div className="flex items-center justify-between gap-3 sm:justify-end"><span className="font-mono text-[0.5rem] uppercase text-muted">{formatActivityDate(activityAt)}</span><span className={`rounded-full border px-2 py-1 font-mono text-[0.49rem] uppercase ${statusTone}`}>{message.status === "sent" ? "✓ " : ""}{statusLabel}</span></div></summary><div className="mt-3 rounded-lg border border-edge bg-ink/40 p-3"><p className="font-mono text-[0.52rem] uppercase text-muted">From {message.from_email || "connected mailbox"} · {message.message_source === "brain_direct" ? "Brain email" : `step ${message.step_number}`}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-bone/80">{message.body_text}</p>{message.prospect?.last_reply_at ? <button type="button" onClick={() => selectTab("replies")} className={`${button} mt-3 border-moss/45 text-moss`}>View reply</button> : null}</div></details>; })}{!sentHistory.length ? <div className="py-8 text-center text-sm text-muted">No approved or sent prospect emails yet.</div> : null}</div>
        </div>
      </section> : null}

      {!loading && !tabLoading && tab === "campaign" ? <section data-sales-tour="campaign-setup" className="space-y-3">
        {variants.length ? <details className="group rounded-xl border border-edge bg-panel">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <div><h2 className="font-display text-base text-bone">Subject performance</h2><p className="mt-0.5 text-xs text-muted">Open only when you want to compare tested subject lines.</p></div>
            <span className="font-mono text-[0.55rem] uppercase text-amber"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span> · {variants.length}</span>
          </summary>
          <div className="grid grid-cols-1 gap-2 border-t border-edge p-3 sm:grid-cols-2">{variants.map((row) => <div key={row.variant} className="rounded-xl border border-edge bg-ink/35 p-3"><p className="font-mono text-[0.56rem] uppercase text-muted">Subject variant {row.variant}</p><strong className="mt-1 block font-display text-xl text-bone">{row.replyRate}% replies</strong><span className="text-xs text-muted">{row.replies} replies from {row.sent} sent</span></div>)}</div>
        </details> : null}

        <div className="flex flex-col gap-2 rounded-xl border border-edge bg-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-display text-lg text-bone">Campaigns</h2><p className="mt-1 text-sm text-muted">Your current campaign stays first. Everything else is newest first and collapsed until you need it.</p></div>
          <span className="self-start rounded-full border border-edge px-3 py-1 font-mono text-[0.52rem] uppercase text-muted sm:self-auto">{orderedCampaigns.length} total</span>
        </div>

        {orderedCampaigns.map((campaign) => {
          const isCurrent = campaign.id === selectedCampaignId;
          const personalStats = campaignStats[campaign.id];
          return <details key={campaign.id} open={expandedCampaignId === campaign.id} onToggle={(event) => {
            const isOpen = event.currentTarget.open;
            setExpandedCampaignId((current) => isOpen ? campaign.id : current === campaign.id ? "" : current);
          }} className={`group overflow-hidden rounded-xl border bg-panel ${isCurrent ? "border-moss/50" : "border-edge"}`}>
            <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-display text-lg text-bone">{campaign.name}</h3>{isCurrent ? <span className="rounded-full border border-moss/50 bg-moss/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase text-moss">Current</span> : null}<span className={`rounded-full border px-2 py-0.5 font-mono text-[0.5rem] uppercase ${campaign.status === "active" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{campaign.status}</span></div><p className="mt-1 truncate text-sm text-bone/70">{campaign.goal || "No goal saved yet"}</p></div>
                <span className="shrink-0 font-mono text-[0.55rem] uppercase text-amber"><span className="group-open:hidden">Open ▾</span><span className="hidden group-open:inline">Close ▴</span></span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[0.5rem] uppercase text-muted"><span>Updated {formatActivityDate(campaign.updated_at || campaign.created_at)}</span><span>·</span><span>{personalStats?.contacted || 0} contacted</span><span>·</span><span>{personalStats?.replies || 0} replies</span><span>·</span><span>{personalStats?.meetings || 0} meetings</span></div>
            </summary>

            <div className="border-t border-edge p-4">
              <CampaignResultStrip stats={personalStats} />
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted">Edit only this campaign. The collapsed campaigns remain untouched.</p>{canManageCampaigns ? <button onClick={() => saveCampaign(campaign)} disabled={!!busy} className={primary}>{busy === `campaign:${campaign.id}` ? "Saving…" : "Save campaign"}</button> : <span className="rounded-full border border-edge px-3 py-1 font-mono text-[0.52rem] uppercase text-muted">Shared · view only</span>}</div>
              <fieldset disabled={!canManageCampaigns} className="contents">
                <div className="grid gap-3"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Goal</span><input className={input} value={campaign.goal} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, goal: e.target.value } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Audience</span><textarea className={`${input} min-h-20`} value={campaign.audience} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, audience: e.target.value } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Interviewa angle</span><textarea className={`${input} min-h-24`} value={campaign.offer_angle} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, offer_angle: e.target.value } : c))} /></label><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Daily maximum</span><input type="number" min="1" max="20" className={input} value={Number.isNaN(campaign.daily_limit) ? "" : campaign.daily_limit} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, daily_limit: e.target.value === "" ? Number.NaN : Math.min(20, Number(e.target.value)) } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Status</span><select className={`${input} min-h-11`} value={campaign.status} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, status: e.target.value } : c))}><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option></select></label></div></div>
                <CampaignSequenceBuilder
                  campaignId={campaign.id}
                  sequence={campaign.sequence || []}
                  disabled={!canManageCampaigns}
                  saving={busy === `campaign:${campaign.id}`}
                  onChange={(sequence) =>
                    setCampaigns((all) =>
                      all.map((item) =>
                        item.id === campaign.id ? { ...item, sequence } : item
                      )
                    )
                  }
                  onSave={() => saveCampaign(campaign)}
                />
              </fieldset>
            </div>
          </details>;
        })}
        {!orderedCampaigns.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">No campaigns have been created yet.</div> : null}
      </section> : null}

      {!loading && !tabLoading && tab === "intelligence" && activeCampaign ? <section className="space-y-4">
        <fieldset disabled={!canManageCampaigns} className="contents">
        <div className="rounded-xl border border-amber/40 bg-amber/[0.06] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-display text-lg text-bone">Message intelligence</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Set the voice and guardrails once. For every person, Terra must show the evidence, chosen angle and quality score before you approve the exact words.</p></div>{canManageCampaigns ? <button onClick={() => saveCampaign(activeCampaign)} disabled={!!busy} className={primary}>{busy === `campaign:${activeCampaign.id}` ? "Saving…" : "Save intelligence"}</button> : <span className="rounded-full border border-edge px-3 py-1 font-mono text-[0.52rem] uppercase text-muted">Shared · view only</span>}</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Tone</span><select className={input} value={activeCampaign.voice?.tone || "warm, commercially curious and concise"} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, voice: { ...(campaign.voice || {}), tone: e.target.value } } : campaign))}><option value="warm, commercially curious and concise">Warm, commercially curious</option><option value="direct, credible and concise">Direct and credible</option><option value="peer-to-peer founder, thoughtful and natural">Founder to founder</option><option value="consultative, challenging and evidence-led">Consultative challenger</option></select></label>
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Writing style</span><input className={input} value={activeCampaign.voice?.style || "founder-to-founder, plain English and respectful"} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, voice: { ...(campaign.voice || {}), style: e.target.value } } : campaign))} /></label>
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Coaching rules, one per line</span><textarea className={`${input} min-h-36 leading-6`} value={(activeCampaign.voice?.rules || []).join("\n")} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, voice: { ...(campaign.voice || {}), rules: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) } } : campaign))} /></label>
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Never say, one per line</span><textarea className={`${input} min-h-36 leading-6`} value={(activeCampaign.banned_phrases || []).join("\n")} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, banned_phrases: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) } : campaign))} /></label>
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4">
          <h2 className="font-display text-lg text-bone">AI13 calendar handoff</h2><p className="mt-1 text-sm leading-6 text-muted">The safest default is to earn interest first. A positive reply gets a draft containing your booking link, which still needs your approval.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_13rem]"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Booking link</span><input className={input} placeholder="https://calendar.google.com/calendar/appointments/…" value={activeCampaign.booking_url || ""} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, booking_url: e.target.value } : campaign))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">When to include</span><select className={input} value={activeCampaign.booking_cta_mode || "interested_reply"} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, booking_cta_mode: e.target.value } : campaign))}><option value="interested_reply">Only after interest</option><option value="final_step">Final sequence email</option><option value="always">Every email</option><option value="never">Never</option></select></label></div>
          <p className="mt-3 rounded-lg border border-moss/35 bg-moss/[0.07] px-3 py-2 text-sm text-moss">When a prospect books, Calendar Sync links the meeting and seeds the call intent with the research, sent email and reply. Deal value and probability stay blank until a real conversation supports them.</p>
        </div>
        </fieldset>

        <div className="rounded-xl border border-edge bg-panel p-4"><h2 className="font-display text-lg text-bone">Conversion learning</h2><p className="mt-1 text-sm leading-6 text-muted">We measure positive replies and booked meetings, not vanity opens. A pattern is not fed back into new drafts until it has at least 10 sends and meaningful conversion evidence.</p>
          {learnings.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{learnings.map((learning) => <div key={learning.id} className="rounded-lg border border-edge bg-ink/30 p-3"><div className="flex items-center justify-between gap-2"><span className="font-mono text-[0.55rem] uppercase text-amber">{learning.dimension} · {learning.label}</span><span className={`rounded-full border px-2 py-0.5 font-mono text-[0.49rem] uppercase ${learning.status === "promoted" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{learning.status}</span></div><p className="mt-2 text-sm leading-6 text-bone/80">{learning.insight}</p><p className="mt-1 text-xs text-muted">{learning.confidence} confidence</p></div>)}</div> : <div className="mt-3 rounded-lg border border-dashed border-edge p-5 text-center text-sm text-muted">No result is being called a “winner” yet. The system will wait for real sends, positive replies and meetings.</div>}
          {performance.length ? <div className="mt-4"><p className="mb-2 font-mono text-[0.54rem] uppercase text-muted">Early observations</p><div className="flex gap-2 overflow-x-auto pb-1">{performance.slice(0, 8).map((row) => <div key={`${row.dimension}:${row.label}`} className="min-w-52 rounded-lg border border-edge bg-ink/30 p-3"><span className="font-mono text-[0.52rem] uppercase text-muted">{row.dimension}</span><strong className="mt-1 block truncate text-sm text-bone">{row.label}</strong><p className="mt-1 text-xs text-muted">{row.positiveRate}% positive · {row.meetings} meetings · {row.sent} sent</p></div>)}</div></div> : null}
        </div>
      </section> : null}

      {!loading && !tabLoading && tab === "replies" ? <section data-sales-tour="reply-handover">
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-edge bg-panel p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-display text-lg text-bone">Reply inbox</h2><p className="mt-1 text-sm text-muted">Every reply stops the sequence. Interested people are linked safely to the CRM, while deal value waits until a real conversation.</p></div><button onClick={checkReplies} disabled={!!busy} className={primary}>{busy === "replies" ? "Checking email…" : "Check replies now"}</button></div>
        <div className="space-y-2">{replies.map((reply) => { const draft = reply.bookingDraft; const edit = draft ? draftEdits[draft.id] || { subject: draft.subject, body_text: draft.body_text } : null; const handover = handoverReviews[reply.id]; return <article key={reply.id} className="rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-display text-lg text-bone">{reply.first_name} {reply.last_name}</h3><p className="text-sm text-bone/80">{reply.company_name}</p></div><span className={`rounded-full border px-2 py-1 font-mono text-[0.55rem] uppercase ${reply.reply_category === "interested" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{reply.reply_category}</span></div>
          <p className="mt-3 text-sm leading-6 text-bone/80">{reply.reply_summary}</p>
          {reply.reply_category === "interested" ? <div className="mt-3 rounded-lg border border-edge bg-ink/35 p-3">
            {reply.crmCompany ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[0.55rem] uppercase text-moss">✓ CRM handover complete</p><p className="mt-1 text-sm text-bone/80">Linked to {reply.crmCompany.name}{reply.bookedMeeting ? " · meeting booked" : " · sequence stopped"}</p></div><Link href={`/crm/${reply.crmCompany.id}`} className={`${button} inline-flex items-center justify-center`}>Open client</Link></div> : <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[0.55rem] uppercase text-amber">CRM match needs approval</p><p className="mt-1 text-sm text-muted">No client record will be guessed or duplicated.</p></div><button onClick={() => reviewHandover(reply.id)} disabled={!!busy} className={button}>{busy === `handover-check:${reply.id}` ? "Checking…" : handover ? "Refresh choices" : "Review match"}</button></div>
              {handover ? <div className="mt-3 border-t border-edge pt-3"><p className="text-sm text-bone/80">{handover.reason}</p>{handover.candidates.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{handover.candidates.map((candidate) => <button key={candidate.id} onClick={() => completeHandover(reply.id, candidate.id)} disabled={!!busy} className={`${button} text-left normal-case tracking-normal`}><strong className="block text-bone">Link to {candidate.name}</strong><span className="text-xs text-muted">{candidate.domain || "No domain saved"}</span></button>)}</div> : null}<button onClick={() => completeHandover(reply.id)} disabled={!!busy} className={`${primary} mt-2 w-full sm:w-auto`}>{busy === `handover-save:${reply.id}` ? "Saving…" : `Create new ${reply.company_name} profile`}</button></div> : null}
            </div>}
          </div> : null}
          {reply.reply_category === "interested" && !draft ? <button onClick={() => prepareBookingReply(reply.id)} disabled={!!busy} className={`${primary} mt-3 w-full sm:w-auto`}>{busy === `booking:${reply.id}` ? "Drafting…" : "Prepare booking reply"}</button> : null}
          {draft && edit ? <div className="mt-4 space-y-3 border-t border-edge pt-4"><div className="rounded-lg border border-moss/35 bg-moss/[0.06] px-3 py-2 text-sm text-moss">Review the exact words and calendar link. Once approved, the reply joins the same paced send queue.</div><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Reply subject</span><input className={input} value={edit.subject} onChange={(e) => setMessage(draft.id, { subject: e.target.value })} disabled={["sending", "sent"].includes(draft.status) || Boolean(draft.scheduled_at)} /></label><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Reply</span><textarea className={`${input} min-h-40 resize-y leading-6`} value={edit.body_text} onChange={(e) => setMessage(draft.id, { body_text: e.target.value })} disabled={["sending", "sent"].includes(draft.status) || Boolean(draft.scheduled_at)} /></label><div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><button onClick={() => saveDraft(draft.id)} disabled={!!busy || ["sending", "sent"].includes(draft.status) || Boolean(draft.scheduled_at)} className={button}>Save changes</button>{draft.status === "draft" || draft.status === "failed" ? <button onClick={() => approveAndSend(draft.id)} disabled={!!busy} className={primary}>{busy === `approve-send:${draft.id}` ? "Approving and queueing…" : "Approve & queue reply"}</button> : null}{draft.status === "approved" && !draft.scheduled_at ? <button onClick={() => send(draft.id)} disabled={!!busy} className={primary}>{busy === `send:${draft.id}` ? "Queueing…" : "Queue booking reply"}</button> : null}{draft.status === "approved" && draft.scheduled_at ? <span className="self-center rounded-lg border border-sky bg-sky px-3 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-ink">✓ Queued for {formatActivityDate(draft.scheduled_at)}</span> : null}{draft.status === "sending" ? <span className="self-center rounded-lg border border-sky/60 bg-sky/10 px-3 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-sky">Sending now</span> : null}{draft.status === "sent" ? <span className="self-center font-mono text-xs uppercase text-moss">✓ Booking link sent</span> : null}</div></div> : null}
          <a href={`mailto:${reply.email}`} className="mt-3 inline-block font-mono text-xs text-amber">Open in email ↗</a>
        </article>; })}{!replies.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">No replies detected yet.</div> : null}</div>
      </section> : null}

      {!loading && !tabLoading && tab === "safety" ? <section className="space-y-4"><OutreachReadiness /><div className="rounded-xl border border-moss/40 bg-moss/10 p-4"><h2 className="font-display text-lg text-bone">Safety rules are active</h2><ul className="mt-3 space-y-2 text-sm text-bone/80"><li>• Nothing sends without approval of that exact draft.</li><li>• Every email uses the assigned sender’s own connected mailbox and verified sending address{sender?.senderEmail ? `, currently ${sender.senderEmail}` : ""}.</li><li>• Maximum 20 sends per sender per London calendar day.</li><li>• New CRM leads can enter outreach. Engaged, dormant and unclassified CRM relationships remain blocked.</li><li>• Replies and blocked addresses stop outreach.</li><li>• Exact email addresses are checked across the whole team, including duplicate CRM records.</li><li>• The same email address cannot be active in two campaigns or receive two messages on the same day.</li><li>• Different people at the same company remain available for outreach.</li><li>• A 30 day pause applies before moving a contacted email address to another campaign. Manager overrides require a saved reason.</li><li>• The database checks every send again immediately before it leaves.</li><li>• No tracking pixels or hidden open tracking.</li></ul></div><div className="rounded-xl border border-edge bg-panel p-4"><h2 className="font-display text-lg text-bone">Do not contact list</h2><p className="mt-1 text-sm text-muted">Block a person’s email or an entire company domain. You can restore access without losing history.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className={input} value={blockTarget} onChange={(e) => setBlockTarget(e.target.value)} placeholder="person@company.com or company.com" /><button onClick={addSuppression} disabled={!!busy || !blockTarget.trim()} className={primary}>Block</button></div><div className="mt-4 space-y-2">{suppressions.map((item) => <div key={item.target} className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink/30 px-3 py-2"><div className="min-w-0"><p className="truncate text-sm text-bone">{item.target}</p><p className="text-xs text-muted">{item.reason}</p></div><div className="flex items-center gap-2"><span className="font-mono text-[0.54rem] uppercase text-muted">{item.kind}</span><button type="button" onClick={() => restoreSuppression(item.target)} disabled={!!busy} className="min-h-9 rounded-lg border border-edge px-2 font-mono text-[0.5rem] uppercase text-bone hover:border-amber/60 hover:text-amber disabled:opacity-40">{busy === `restore:${item.target}` ? "Restoring…" : "Restore"}</button></div></div>)}</div></div></section> : null}
    </main>
  );
}
