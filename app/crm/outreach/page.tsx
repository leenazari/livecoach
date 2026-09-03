"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import CanonicalRecordLink from "@/components/crm/CanonicalRecordLink";
import CampaignCtaEditor from "@/components/crm/CampaignCtaEditor";
import ProspectCtaSelector from "@/components/crm/ProspectCtaSelector";
import RevenueToday from "@/components/crm/RevenueToday";
import MatrixRain from "@/components/MatrixRain";
import { crmConfirmationError, crmFetch, getCached } from "@/lib/crm";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import { prepareOutreachVoiceScriptForReview } from "@/lib/outreach-voice-policy";
import { outreachProspectHref } from "@/lib/crm-navigation";
import {
  officialResearchSources,
  verifiedCompanyResearchEvidence,
  verifiedJobResearchEvidence,
} from "@/lib/job-research-sources";
import {
  outreachSequenceValidationError,
  type OutreachSequenceStep,
} from "@/lib/outreach-sequence";
import {
  explainOutreachCampaignSelection,
  filterOutreachQueueByCampaign,
  OUTREACH_QUEUE_ALL_CAMPAIGNS,
  outreachQueueCampaignCounts,
} from "@/lib/outreach-campaign-queue-copy";
import {
  OUTREACH_DAILY_HARD_LIMIT,
  OUTREACH_DEFAULT_DAILY_LIMIT,
  clampOutreachDailyLimit,
} from "@/lib/outreach-limits";
import { OVERNIGHT_RESEARCH_INVENTORY_LIMIT } from "@/lib/outreach-overnight-preparation";
import type { OutreachCampaignCtaConfig } from "@/lib/outreach-demo-reply-cta";

const CampaignSequenceBuilder = dynamic(
  () => import("@/components/crm/CampaignSequenceBuilder"),
  { ssr: false, loading: () => <MatrixRain size="inline" messages={["loading sequence builder"]} /> }
);
const ProspectManualCall = dynamic(
  () => import("@/components/crm/ProspectManualCall"),
  { ssr: false, loading: () => <MatrixRain size="inline" messages={["loading call logger"]} /> }
);
const ProspectFollowUpReminder = dynamic(
  () => import("@/components/crm/ProspectFollowUpReminder"),
  { ssr: false, loading: () => <MatrixRain size="inline" messages={["loading reminder"]} /> }
);
const TaskComposer = dynamic(
  () => import("@/components/crm/TaskComposer"),
  { ssr: false, loading: () => <MatrixRain size="inline" messages={["loading task form"]} /> }
);
const OutreachReadiness = dynamic(
  () => import("@/components/crm/OutreachReadiness"),
  { ssr: false, loading: () => <MatrixRain size="inline" messages={["loading safety checks"]} /> }
);
const OutreachVoiceNoteEditor = dynamic(
  () => import("@/components/crm/OutreachVoiceNoteEditor"),
  { ssr: false, loading: () => <MatrixRain size="inline" messages={["loading voice note"]} /> }
);
const StagedOutreachImports = dynamic(
  () => import("@/components/crm/StagedOutreachImports"),
  { ssr: false, loading: () => <MatrixRain size="inline" messages={["loading clean importer"]} /> }
);

type Tab = "queue" | "prospects" | "signals" | "activity" | "replies" | "campaign" | "intelligence" | "safety";
type Priority = "high" | "medium" | "low";
type ProspectSort = "name" | "company" | "priority" | "status" | "activity";
type RecommendationAction = "contact_today" | "hold" | "skip";
type Recommendation = { action: RecommendationAction; label: string; score: number; confidence: "high" | "medium" | "low"; reasons: string[]; risks: string[] };
type Prospect = Record<string, any> & {
  id: string;
  crm_company_id?: string | null;
  email: string;
  company_name: string;
  company_domain?: string;
  website?: string;
  priority: Priority;
  priority_score: number;
  has_research?: boolean;
  recommendation: Recommendation;
};
type QueueRow = Record<string, any> & { id: string; prospect: Prospect; campaign: Record<string, any>; message: Record<string, any> | null; recommendation: Recommendation };
type SequenceStep = OutreachSequenceStep;
type Campaign = Record<string, any> & { id: string; name: string; goal: string; audience: string; offer_angle: string; status: string; daily_limit: number; sequence: SequenceStep[]; cta_config?: OutreachCampaignCtaConfig };
type CampaignEditorView = "setup" | "sequence" | "results";
type CampaignStats = {
  enrolled: number;
  contacted: number;
  emailsSent: number;
  linkedinSent: number;
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
type ResearchJobSnapshot = {
  id: string;
  prospectId: string;
  enrolmentId: string;
  messageId: string | null;
  stepNumber: number;
  kind: "full_draft" | "voice_script";
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  error: string | null;
  updatedAt: string;
};
type ResearchJobsResponse = {
  jobs: ResearchJobSnapshot[];
  accepted?: number;
  errors?: { prospectId: string; error: string }[];
  skipped?: { prospectId: string; reason: string }[];
  revision: string;
};
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
  follow_up_due: "border-amber/55 bg-amber/10 text-amber",
  new_contact: "border-sky/50 bg-sky/10 text-sky",
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
const PROSPECT_PAGE_SIZE = 60;
const OUTREACH_URLS = {
  queue: "/api/crm/outreach/queue",
  campaigns: "/api/crm/outreach/campaigns",
  campaignStats: "/api/crm/outreach/campaigns?stats=1",
  metricsSummary: "/api/crm/outreach/metrics?summary=1",
  metrics: "/api/crm/outreach/metrics",
  prospects: "/api/crm/outreach",
  researchJobs: "/api/crm/outreach/research-jobs",
  suppressions: "/api/crm/outreach/suppressions",
} as const;

function outreachStage(prospect: Prospect): { key: string; label: string } {
  if (prospect.status === "suppressed") return { key: "suppressed", label: "Removed" };
  if (prospect.last_reply_at)
    return {
      key: prospect.reply_category === "interested" ? "interested" : "replied",
      label: prospect.reply_category === "interested" ? "Interested" : "Replied",
    };
  const sendpilot = prospect.outreach?.sendpilot;
  if (["submitting", "pending_confirmation", "queued"].includes(sendpilot?.syncStatus)) {
    return { key: "queued", label: "SendPilot queued" };
  }
  if (sendpilot?.syncStatus === "active") {
    return { key: "contacted", label: "SendPilot active" };
  }
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
  return prospect.status === "imported" &&
    outreachStage(prospect).key === "not_started" &&
    !prospect.last_researched_at &&
    !prospect.last_contacted_at &&
    !prospect.last_reply_at &&
    !prospect.has_research &&
    !prospect.outreach?.latestMessage &&
    !prospect.outreach?.enrolment;
}

function queueWaveRank(row: QueueRow): number {
  return row.queueKind === "follow_up" || Boolean(row.lastSentMessage) ? 1 : 0;
}

function queueRowNeedsVoiceScript(row: QueueRow): boolean {
  return Boolean(
    row.message &&
      ["draft", "failed"].includes(row.message.status) &&
      !String(row.message.voice_script || "").trim()
  );
}

function queueRowNeedsPreparation(row: QueueRow): boolean {
  if (!row.prospect?.id) return false;
  if (queueRowNeedsVoiceScript(row)) return true;
  return Boolean(
    !row.message &&
      row.status === "queued" &&
      (row.sequenceStep?.channel || "email") === "email"
  );
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

function sendPilotExecutionLabel(execution: any) {
  const labels: Record<string, string> = {
    submitting: "Submitting to SendPilot",
    pending_confirmation: "Awaiting SendPilot confirmation",
    queued: "Queued in SendPilot",
    active: "Running in SendPilot",
    replied: "Reply captured",
    completed: "SendPilot sequence completed",
    suppressed: "Stopped in SendPilot",
    failed: "Retry SendPilot handoff",
  };
  return labels[String(execution?.syncStatus || "")] || "Tracked in SendPilot";
}

function sendPilotActivityLabel(kind: string, metadata: any) {
  const labels: Record<string, string> = {
    linkedin_enrolled: "Added to SendPilot",
    linkedin_connection_sent: "Connection request sent",
    linkedin_connection_accepted: "Connection accepted",
    linkedin_message_sent: "LinkedIn message sent",
    meeting_booked: "Meeting booked through SendPilot",
    sendpilot_status: `SendPilot ${String(metadata?.newStatus || "status").replace(/_/g, " ")}`,
    failed: "SendPilot action failed",
  };
  return labels[kind] || "SendPilot activity";
}

function replyCategoryLabel(category?: string | null) {
  const labels: Record<string, string> = {
    interested: "Interested",
    objection: "Objection",
    later: "Follow up later",
    referral: "Referral",
    unsubscribe: "Do not contact",
    irrelevant: "Not relevant",
    unclassified: "Needs review",
  };
  return labels[String(category || "unclassified")] || "Needs review";
}

function replyCategoryTone(category?: string | null) {
  if (category === "interested" || category === "referral")
    return "border-moss/50 bg-moss/10 text-moss";
  if (category === "objection" || category === "later")
    return "border-amber/50 bg-amber/10 text-amber";
  if (category === "unsubscribe")
    return "border-rust/50 bg-rust/10 text-rust";
  return "border-edge bg-ink/40 text-muted";
}

function replyNextMove(reply: Record<string, any>) {
  const person = [reply.first_name, reply.last_name].filter(Boolean).join(" ");
  const subject = person || reply.company_name || "this prospect";
  if (reply.reply_category === "interested")
    return `Reply while the interest is warm and agree a short meeting with ${subject}.`;
  if (reply.reply_category === "referral")
    return `Thank ${subject}, confirm the recommended contact and ask for a direct introduction.`;
  if (reply.reply_category === "objection")
    return `Acknowledge the exact concern, answer only with saved evidence and ask one low friction question.`;
  if (reply.reply_category === "later") {
    const returnDate = reply.replyEvidence?.returnDate;
    return returnDate
      ? `Set one reminder for ${returnDate}. The outreach sequence is already paused.`
      : "Agree one specific follow up date. The outreach sequence is already paused.";
  }
  if (reply.reply_category === "unsubscribe")
    return "No further sales contact. The address is suppressed and the sequence is stopped.";
  if (reply.reply_category === "irrelevant")
    return "Close this outcome unless the reply identifies a better contact.";
  return "Read the exact reply and choose whether to respond, follow up later or close it.";
}

function replyDeliveryBadge(reply: Record<string, any>) {
  if (reply.deliveryState === "failed")
    return {
      label: "Delivery failed",
      style: "border-rust/55 bg-rust/10 text-rust",
    };
  if (reply.slaBreached)
    return {
      label: "Unanswered over 2 hours",
      style: "border-rust/55 bg-rust/10 text-rust",
    };
  if (reply.deliveryState === "queued")
    return {
      label: "Queued, awaiting delivery",
      style: "border-sky/55 bg-sky/10 text-sky",
    };
  if (reply.deliveryState === "sending")
    return {
      label: "Sending now",
      style: "border-sky/55 bg-sky/10 text-sky",
    };
  if (reply.attentionOpen)
    return {
      label: "Action needed",
      style: "border-amber/50 bg-amber/10 text-amber",
    };
  return {
    label: reply.deliveryState === "sent" ? "Reply delivered" : "Reviewed",
    style: "border-moss/40 bg-moss/10 text-moss",
  };
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

function ResearchEvidenceLinks({
  research,
  sources,
  prospect,
}: {
  research: Record<string, any>;
  sources: Array<{ url?: unknown; title?: unknown }>;
  prospect: Prospect;
}) {
  const companyEvidence = verifiedCompanyResearchEvidence(
    research,
    sources,
    prospect
  );
  const evidence = verifiedJobResearchEvidence(research, sources, prospect);
  const shown = new Set([
    companyEvidence.companyOverviewUrl,
    evidence.jobBoardUrl,
    ...evidence.jobSignals.map((signal) => signal.sourceUrl),
  ].filter(Boolean));
  const otherSources = officialResearchSources(sources, prospect)
    .filter((source) => !shown.has(String(source.url || "")))
    .slice(0, 4);
  if (
    !companyEvidence.companyOverviewUrl &&
    !evidence.jobBoardUrl &&
    !evidence.jobSignals.length &&
    !otherSources.length
  ) {
    return null;
  }
  return (
    <div className="mt-3 space-y-3 border-t border-edge pt-3">
      {companyEvidence.companyOverview ? (
        <div className="rounded-lg border border-sky/30 bg-sky/[0.04] px-3 py-2">
          <p className="font-mono text-[0.53rem] uppercase text-sky">Business overview</p>
          <p className="mt-1 text-xs leading-5 text-bone/80">
            {companyEvidence.companyOverview}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {companyEvidence.companyOverviewUrl ? (
          <a
            href={companyEvidence.companyOverviewUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center rounded-lg border border-sky/45 bg-sky/10 px-3 py-2 font-mono text-[0.5rem] uppercase tracking-wider text-sky hover:bg-sky/20"
          >
            Open company overview ↗
          </a>
        ) : null}
        {evidence.jobBoardUrl ? (
          <a
            href={evidence.jobBoardUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center rounded-lg border border-amber/45 bg-amber/10 px-3 py-2 font-mono text-[0.5rem] uppercase tracking-wider text-amber hover:bg-amber/20"
          >
            Open company job board ↗
          </a>
        ) : null}
      </div>
      {evidence.jobSignals.length ? (
        <div>
          <p className="font-mono text-[0.53rem] uppercase text-muted">Verified vacancies</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {evidence.jobSignals.map((signal) => {
              const detail = [signal.location, signal.compensation, signal.recency]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={`${signal.role}:${signal.sourceUrl}`} className="rounded-lg border border-edge bg-panel/45 px-3 py-2">
                  <a href={signal.sourceUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-amber hover:underline">
                    {signal.role} ↗
                  </a>
                  {detail ? <p className="mt-1 text-[0.68rem] text-muted">{detail}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {otherSources.length ? (
        <div className="flex flex-wrap gap-2">
          {otherSources.map((source) => (
            <a key={String(source.url)} href={String(source.url)} target="_blank" rel="noreferrer" className="text-xs text-sky hover:underline">
              {String(source.title || "Official evidence")} ↗
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RecommendationCard({ recommendation, compact = false, actionLabel }: { recommendation: Recommendation; compact?: boolean; actionLabel?: string }) {
  if (!recommendation) return null;
  return <div className="mt-3 rounded-lg border border-edge bg-ink/35 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={`rounded-full border px-2.5 py-1 font-mono text-[0.55rem] uppercase tracking-wider ${recommendationPill[recommendation.action]}`}>{actionLabel || recommendation.label}</span>
      <span className="font-mono text-[0.56rem] uppercase text-muted"><strong className="text-bone">{recommendation.score}/100 fit</strong> · {recommendation.confidence} data confidence</span>
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
    linkedinSent: 0,
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
    ["LinkedIn", values.linkedinSent],
    ["Replies", values.replies],
    ["Interested", values.interested],
    ["Meetings", values.meetings],
  ] as const;
  return <div className="mb-4 rounded-xl border border-edge bg-ink/35 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-mono text-[0.54rem] uppercase tracking-wider text-sky">Your results only</p>
      <p className="font-mono text-[0.5rem] uppercase text-muted">{values.replyRate}% reply rate · {values.meetingRate}% meeting rate</p>
    </div>
    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-7">
      {items.map(([label, value]) => <div key={label} className="rounded-lg border border-edge/80 bg-panel/65 px-2 py-2 text-center"><strong className="block font-display text-lg text-bone">{value}</strong><span className="font-mono text-[0.44rem] uppercase text-muted">{label}</span></div>)}
    </div>
  </div>;
}

const campaignStatusTone: Record<string, string> = {
  active: "border-moss/50 bg-moss/10 text-moss",
  draft: "border-amber/50 bg-amber/10 text-amber",
  paused: "border-edge bg-ink/45 text-muted",
  completed: "border-sky/45 bg-sky/10 text-sky",
};

function campaignCardTone(status: string, current: boolean) {
  if (current) return "border-moss/60 bg-moss/[0.035]";
  if (status === "active") return "border-moss/35 bg-panel";
  if (status === "draft") return "border-amber/35 bg-panel";
  if (status === "completed") return "border-sky/35 bg-panel";
  return "border-edge bg-panel";
}

export default function OutreachPage() {
  const {
    queue: cachedQueue,
    campaigns: cachedCampaigns,
    campaignStats: cachedCampaignStats,
    summary: cachedSummary,
    metrics: cachedMetrics,
    prospects: cachedProspects,
    suppressions: cachedSuppressions,
  } = useMemo(() => ({
    queue: getCached<any>(OUTREACH_URLS.queue),
    campaigns: getCached<any>(OUTREACH_URLS.campaigns),
    campaignStats: getCached<any>(OUTREACH_URLS.campaignStats),
    summary: getCached<any>(OUTREACH_URLS.metricsSummary),
    metrics: getCached<any>(OUTREACH_URLS.metrics),
    prospects: getCached<any>(OUTREACH_URLS.prospects),
    suppressions: getCached<any>(OUTREACH_URLS.suppressions),
  }), []);
  const [tab, setTab] = useState<Tab>("queue");
  const [prospects, setProspects] = useState<Prospect[]>(cachedProspects?.prospects || []);
  const [queue, setQueue] = useState<QueueRow[]>(cachedQueue?.queue || []);
  const [sender, setSender] = useState<{
    userId: string;
    workspaceId: string;
    senderName: string;
    senderEmail: string;
    provider: "google" | "microsoft";
    mailboxEmail: string;
  } | null>(cachedQueue?.sender || null);
  const [team, setTeam] = useState<TeamMember[]>(cachedProspects?.team || []);
  const [currentUser, setCurrentUser] = useState(cachedProspects?.currentUser || "");
  const [canManageAssignments, setCanManageAssignments] = useState(cachedProspects?.canManageAssignments === true);
  const [canStageImports, setCanStageImports] = useState(cachedProspects?.canStageImports === true);
  const [campaigns, setCampaigns] = useState<Campaign[]>(cachedCampaigns?.campaigns || []);
  const [campaignStats, setCampaignStats] = useState<Record<string, CampaignStats>>(
    cachedCampaignStats?.campaignStats || cachedCampaigns?.campaignStats || {}
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState(
    cachedCampaigns?.selectedCampaignId || cachedQueue?.selectedCampaignId || ""
  );
  const [expandedCampaignId, setExpandedCampaignId] = useState("");
  const [campaignEditorView, setCampaignEditorView] = useState<CampaignEditorView>("setup");
  const [canEditCampaignContent, setCanEditCampaignContent] = useState(
    cachedCampaigns?.canEditCampaignContent === true
  );
  const [canManageCampaigns, setCanManageCampaigns] = useState(cachedCampaigns?.canManageCampaigns === true);
  const [metrics, setMetrics] = useState<any>(cachedMetrics?.metrics || cachedSummary?.metrics || {});
  const [replies, setReplies] = useState<any[]>(cachedMetrics?.replies || []);
  const [sentHistory, setSentHistory] = useState<any[]>(cachedMetrics?.sentHistory || []);
  const [sendPilotActivity, setSendPilotActivity] = useState<any[]>(cachedMetrics?.sendPilotActivity || []);
  const [manualCalls, setManualCalls] = useState<any[]>(cachedMetrics?.manualCalls || []);
  const [variants, setVariants] = useState<any[]>(cachedMetrics?.variants || []);
  const [performance, setPerformance] = useState<any[]>(cachedMetrics?.performance || []);
  const [learnings, setLearnings] = useState<any[]>(cachedMetrics?.learnings || []);
  const [suppressions, setSuppressions] = useState<any[]>(cachedSuppressions?.suppressions || []);
  const [engagementInput, setEngagementInput] = useState("");
  const [engagementDraft, setEngagementDraft] = useState<EngagementDraft | null>(null);
  const [engagementComment, setEngagementComment] = useState("");
  const [loading, setLoading] = useState(!(cachedQueue && cachedCampaigns));
  const [tabLoading, setTabLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [generatingVoiceMessageId, setGeneratingVoiceMessageId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [prepareJobs, setPrepareJobs] = useState<Record<string, PrepareStatus>>({});
  const [prepareJobCounts, setPrepareJobCounts] = useState({
    queued: 0,
    researching: 0,
    completed: 0,
    failed: 0,
    total: 0,
  });
  const [ctaBlockedIds, setCtaBlockedIds] = useState<string[]>([]);
  const [ctaRefreshRequiredProspectIds, setCtaRefreshRequiredProspectIds] =
    useState<string[]>([]);
  const prepareJobsRef = useRef<Record<string, PrepareStatus>>({});
  const queueRef = useRef<QueueRow[]>(queue);
  const prepareRevisionRef = useRef("");
  const prepareResumeAttemptedRef = useRef(false);
  const prepareWasActiveRef = useRef(false);
  queueRef.current = queue;
  const ownerFilterInitialisedRef = useRef(Boolean(cachedProspects));
  const initialQueueFillAttemptedRef = useRef(false);
  const [q, setQ] = useState("");
  const [focusedProspectId, setFocusedProspectId] = useState("");
  const [focusedReplyId, setFocusedReplyId] = useState("");
  const [priority, setPriority] = useState<"all" | Priority>("all");
  const [stageFilter, setStageFilter] = useState("active");
  const [prospectSort, setProspectSort] = useState<ProspectSort>("priority");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [recommendationFilter, setRecommendationFilter] = useState<"all" | RecommendationAction>("all");
  const [prospectCampaignId, setProspectCampaignId] = useState("all");
  const [queueCampaignFilterId, setQueueCampaignFilterId] = useState(
    OUTREACH_QUEUE_ALL_CAMPAIGNS
  );
  const [ownerFilter, setOwnerFilter] = useState(
    cachedProspects
      ? cachedProspects.canManageAssignments === true
        ? "all"
        : "available"
      : "all"
  );
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [blockTarget, setBlockTarget] = useState("");
  const [removalProspectId, setRemovalProspectId] = useState("");
  const [manualCallProspectId, setManualCallProspectId] = useState("");
  const [followUpProspectId, setFollowUpProspectId] = useState("");
  const [taskProspectId, setTaskProspectId] = useState("");
  const [draftEdits, setDraftEdits] = useState<Record<string, { subject: string; body_text: string; voice_script: string }>>({});
  const [handoverReviews, setHandoverReviews] = useState<Record<string, HandoverPreview>>({});
  const [visibleProspectLimit, setVisibleProspectLimit] = useState(PROSPECT_PAGE_SIZE);
  const loadedResourcesRef = useRef({
    prospects: Boolean(cachedProspects),
    metrics: Boolean(cachedMetrics),
    campaignStats: Boolean(cachedCampaignStats || cachedCampaigns?.campaignStats),
    suppressions: Boolean(cachedSuppressions),
  });

  const loadCore = useCallback(async () => {
    const metricsRequest = crmFetch<any>(OUTREACH_URLS.metricsSummary)
      .then((data) => setMetrics(data.metrics || {}))
      .catch(() => {
        // The working queue is still useful if the small count strip cannot
        // refresh. A later tab or manual refresh will retry it.
      });
    try {
      const [qd, c] = await Promise.all([
        crmFetch<any>(OUTREACH_URLS.queue),
        crmFetch<any>(OUTREACH_URLS.campaigns),
      ]);
      const selectedId = c.selectedCampaignId || qd.selectedCampaignId || "";
      const selectedCampaign = (c.campaigns || []).find(
        (campaign: Campaign) => campaign.id === selectedId && campaign.status === "active"
      ) || (c.campaigns || []).find(
        (campaign: Campaign) => campaign.status === "active"
      );
      let nextQueue = qd.queue || [];
      setQueue(nextQueue);
      setSender(qd.sender || null);
      setCampaigns(c.campaigns || []);
      if (c.campaignStats) setCampaignStats(c.campaignStats);
      setSelectedCampaignId(selectedId);
      setCanEditCampaignContent(c.canEditCampaignContent === true);
      setCanManageCampaigns(c.canManageCampaigns === true);
      setLoading(false);
      // Queue selection is free. Fill the user's working day on first entry so
      // they do not have to understand or find a separate top-up control.
      if (
        !initialQueueFillAttemptedRef.current &&
        selectedCampaign &&
        nextQueue.length < clampOutreachDailyLimit(selectedCampaign.daily_limit)
      ) {
        initialQueueFillAttemptedRef.current = true;
        void crmFetch<any>(OUTREACH_URLS.queue, {
            method: "POST",
            body: JSON.stringify({
              campaignId: selectedCampaign.id,
              limit: clampOutreachDailyLimit(selectedCampaign.daily_limit),
            }),
          })
          .then((filled) => setQueue(filled.queue || nextQueue))
          .catch(() => {
            // Keep the valid existing queue visible. The manual top-up control
            // remains available with the precise server error if it is needed.
          });
      }
      await metricsRequest;
    } catch (e: any) { setError(e.message || "Could not load outreach"); }
    finally { setLoading(false); }
  }, []);

  const loadCampaignStats = useCallback(async () => {
    const data = await crmFetch<any>(OUTREACH_URLS.campaignStats);
    setCampaignStats(data.campaignStats || {});
    loadedResourcesRef.current.campaignStats = true;
  }, []);

  const loadProspects = useCallback(async () => {
    const data = await crmFetch<any>(OUTREACH_URLS.prospects);
    setProspects(data.prospects || []);
    setTeam(data.team || []);
    setCurrentUser(data.currentUser || "");
    setCanManageAssignments(data.canManageAssignments === true);
    setCanStageImports(data.canStageImports === true);
    if (!ownerFilterInitialisedRef.current) {
      // A salesperson's useful default is work they can act on now. Include
      // their own prospects and the unassigned shared pool, but never another
      // salesperson's assigned records. Managers retain the whole-team view.
      setOwnerFilter(data.canManageAssignments === true ? "all" : "available");
      ownerFilterInitialisedRef.current = true;
    }
    loadedResourcesRef.current.prospects = true;
  }, []);

  const loadMetrics = useCallback(async () => {
    const data = await crmFetch<any>(OUTREACH_URLS.metrics);
    setMetrics(data.metrics || {});
    setReplies(data.replies || []);
    setSentHistory(data.sentHistory || []);
    setSendPilotActivity(data.sendPilotActivity || []);
    setManualCalls(data.manualCalls || []);
    setVariants(data.variants || []);
    setPerformance(data.performance || []);
    setLearnings(data.learnings || []);
    loadedResourcesRef.current.metrics = true;
  }, []);

  const loadSuppressions = useCallback(async () => {
    const data = await crmFetch<any>(OUTREACH_URLS.suppressions);
    setSuppressions(data.suppressions || []);
    loadedResourcesRef.current.suppressions = true;
  }, []);

  const updatePrepareJob = useCallback((prospectId: string, status: PrepareStatus) => {
    setPrepareJobs((current) => {
      const next = { ...current, [prospectId]: status };
      prepareJobsRef.current = next;
      return next;
    });
  }, []);

  const applyResearchJobResponse = useCallback((payload: ResearchJobsResponse) => {
    const currentQueue = queueRef.current;
    const next: Record<string, PrepareStatus> = {};
    const failedErrors: Record<string, string> = {};
    const latestJobs: ResearchJobSnapshot[] = [];
    for (const job of payload.jobs || []) {
      const queueRow = currentQueue.find(
        (row) => row.prospect?.id === job.prospectId
      );
      if (
        queueRow &&
        (queueRow.id !== job.enrolmentId ||
          Number(queueRow.current_step) !== Number(job.stepNumber))
      ) {
        continue;
      }
      if (
        !queueRow &&
        job.status !== "queued" &&
        job.status !== "running"
      ) {
        continue;
      }
      if (next[job.prospectId]) continue;
      next[job.prospectId] =
        job.status === "running"
          ? "researching"
          : job.status === "completed"
          ? "done"
          : job.status === "failed"
          ? "error"
          : "queued";
      latestJobs.push(job);
      if (job.status === "failed" && job.error) {
        failedErrors[job.prospectId] = job.error;
      }
    }
    prepareJobsRef.current = next;
    setPrepareJobs(next);
    const counts = {
      queued: latestJobs.filter((job) => job.status === "queued").length,
      researching: latestJobs.filter((job) => job.status === "running").length,
      completed: latestJobs.filter((job) => job.status === "completed").length,
      failed: latestJobs.filter((job) => job.status === "failed").length,
      total: latestJobs.length,
    };
    setPrepareJobCounts(counts);
    setRowErrors((current) => {
      const updated = { ...current };
      for (const job of latestJobs) {
        if (job.status === "completed") updated[job.prospectId] = "";
      }
      return { ...updated, ...failedErrors };
    });
    return counts;
  }, []);

  const syncResearchJobs = useCallback(async (silent = true) => {
    try {
      const payload = await crmFetch<ResearchJobsResponse>(
        OUTREACH_URLS.researchJobs
      );
      const previousRevision = prepareRevisionRef.current;
      prepareRevisionRef.current = payload.revision || previousRevision;
      const counts = applyResearchJobResponse(payload);
      const active = counts.queued + counts.researching > 0;
      if (previousRevision && payload.revision !== previousRevision) {
        await Promise.all([
          loadCore(),
          loadedResourcesRef.current.prospects
            ? loadProspects()
            : Promise.resolve(),
        ]);
      }
      if (prepareWasActiveRef.current && !active) {
        setNotice(
          counts.failed
            ? `${counts.completed} research drafts completed. ${counts.failed} stopped with a clear blocker below.`
            : "Research and drafting completed. The drafts are ready to review in Today."
        );
      }
      prepareWasActiveRef.current = active;
      return counts;
    } catch (caught: any) {
      if (!silent) {
        setError(
          caught?.message ||
            "Research progress could not be loaded. Refresh Today to try again."
        );
      }
      return null;
    }
  }, [applyResearchJobResponse, loadCore, loadProspects]);

  const enqueuePrepareBatch = useCallback(async (
    prospectIds: string[],
    quiet = false
  ) => {
    const uniqueIds = [...new Set(prospectIds.filter(Boolean))].slice(0, 50);
    if (!uniqueIds.length) return null;
    for (const prospectId of uniqueIds) {
      updatePrepareJob(prospectId, "adding");
      setRowErrors((current) => ({ ...current, [prospectId]: "" }));
    }
    setError("");
    if (!quiet) setNotice("");
    try {
      const payload = await crmFetch<ResearchJobsResponse>(
        OUTREACH_URLS.researchJobs,
        {
          method: "POST",
          body: JSON.stringify({ prospectIds: uniqueIds }),
        }
      );
      prepareRevisionRef.current = payload.revision || "";
      const counts = applyResearchJobResponse(payload);
      prepareWasActiveRef.current = counts.queued + counts.researching > 0;
      const requestErrors = payload.errors || [];
      if (requestErrors.length) {
        setRowErrors((current) => ({
          ...current,
          ...Object.fromEntries(
            requestErrors.map((item) => [item.prospectId, item.error])
          ),
        }));
        setError(
          requestErrors.length === 1
            ? requestErrors[0].error
            : `${requestErrors.length} people could not be queued. Each affected card explains the blocker.`
        );
      }
      if (!quiet || uniqueIds.length > 1) {
        const accepted = Number(payload.accepted || 0);
        setNotice(
          accepted
            ? `${accepted} ${accepted === 1 ? "person is" : "people are"} saved in the server research queue. Two will run at a time and the work will continue if you leave this page.`
            : payload.skipped?.length
            ? "Those drafts are already ready to review."
            : "No research work was added. Check the blocker shown below."
        );
      }
      return payload;
    } catch (caught: any) {
      const message =
        caught?.message ||
        "Research could not be queued. Refresh Today and try once more.";
      for (const prospectId of uniqueIds) {
        updatePrepareJob(prospectId, "error");
        setRowErrors((current) => ({ ...current, [prospectId]: message }));
      }
      setError(message);
      return null;
    }
  }, [applyResearchJobResponse, updatePrepareJob]);

  const enqueuePrepare = useCallback(
    (prospectId: string, quiet = false) => {
      const current = prepareJobsRef.current[prospectId];
      if (["adding", "queued", "researching"].includes(current || "")) {
        return Promise.resolve(null);
      }
      return enqueuePrepareBatch([prospectId], quiet);
    },
    [enqueuePrepareBatch]
  );

  // The database is the queue source of truth. A page reload only reconnects
  // the progress display and nudges the worker, while the minute recovery cron
  // keeps processing even when no browser is open.
  useEffect(() => {
    let cancelled = false;
    void syncResearchJobs(false).then((counts) => {
      if (
        cancelled ||
        !counts ||
        prepareResumeAttemptedRef.current ||
        counts.queued + counts.researching === 0
      ) {
        return;
      }
      prepareResumeAttemptedRef.current = true;
      void crmFetch<ResearchJobsResponse>(OUTREACH_URLS.researchJobs, {
        method: "POST",
        body: JSON.stringify({ resume: true }),
      })
        .then(applyResearchJobResponse)
        .catch(() => {
          // The recovery cron owns the fallback. Polling below will continue to
          // show the durable state without inventing a completion.
        });
    });
    return () => {
      cancelled = true;
    };
  }, [applyResearchJobResponse, syncResearchJobs]);

  useEffect(() => {
    if (!prepareJobCounts.queued && !prepareJobCounts.researching) return;
    const timer = window.setInterval(() => {
      void syncResearchJobs(true);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [prepareJobCounts.queued, prepareJobCounts.researching, syncResearchJobs]);

  useEffect(() => { loadCore(); }, [loadCore]);
  useEffect(() => {
    const syncFromLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("tab");
      setTab(tabs.some((item) => item.key === requested) ? requested as Tab : "queue");
      setQ(params.get("q") || "");
      const requestedProspect = params.get("prospect") || "";
      setFocusedProspectId(requestedProspect);
      if (requestedProspect) setTab("prospects");
      const requestedReply = params.get("reply") || "";
      setFocusedReplyId(requestedReply);
      if (requestedReply) setTab("replies");
      if (params.get("sort") === "activity") {
        setProspectSort("activity");
        setSortDirection("desc");
      }
    };
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);
  useEffect(() => {
    let alive = true;
    const requests: Promise<void>[] = [];
    let requiresBlockingLoader = false;
    if (
      tab === "prospects" &&
      (!loadedResourcesRef.current.prospects || !getCached(OUTREACH_URLS.prospects))
    ) {
      requiresBlockingLoader ||= !loadedResourcesRef.current.prospects;
      requests.push(loadProspects());
    }
    if (
      tab === "safety" &&
      (!loadedResourcesRef.current.suppressions || !getCached(OUTREACH_URLS.suppressions))
    ) {
      requiresBlockingLoader ||= !loadedResourcesRef.current.suppressions;
      requests.push(loadSuppressions());
    }
    if (
      tab === "campaign" &&
      (!loadedResourcesRef.current.campaignStats || !getCached(OUTREACH_URLS.campaignStats))
    ) {
      requiresBlockingLoader ||= !loadedResourcesRef.current.campaignStats;
      requests.push(loadCampaignStats());
    }
    if (
      (tab === "campaign" || tab === "intelligence" || tab === "activity" || tab === "replies") &&
      (!loadedResourcesRef.current.metrics || !getCached(OUTREACH_URLS.metrics))
    ) {
      requiresBlockingLoader ||= !loadedResourcesRef.current.metrics;
      requests.push(loadMetrics());
    }
    if (!requests.length) {
      setTabLoading(false);
      return;
    }
    setTabLoading(requiresBlockingLoader);
    Promise.all(requests)
      .catch((e: any) => alive && setError(e.message || "Could not load this section"))
      .finally(() => alive && setTabLoading(false));
    return () => { alive = false; };
  }, [tab, loadCampaignStats, loadMetrics, loadProspects, loadSuppressions]);
  useEffect(() => {
    if (loading) return;
    const prefetch = () => {
      const requests: Promise<void>[] = [];
      if (!loadedResourcesRef.current.prospects || !getCached(OUTREACH_URLS.prospects))
        requests.push(loadProspects());
      if (!loadedResourcesRef.current.metrics || !getCached(OUTREACH_URLS.metrics))
        requests.push(loadMetrics());
      if (!loadedResourcesRef.current.campaignStats || !getCached(OUTREACH_URLS.campaignStats))
        requests.push(loadCampaignStats());
      void Promise.allSettled(requests);
    };
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(prefetch, { timeout: 1800 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(prefetch, 700);
    return () => window.clearTimeout(handle);
  }, [loadCampaignStats, loadMetrics, loadProspects, loading]);
  useEffect(() => {
    const next: Record<string, { subject: string; body_text: string; voice_script: string }> = {};
    for (const row of queue) if (row.message) {
      const reviewableVoiceScript =
        ["draft", "failed"].includes(row.message.status) &&
        row.message.voice_script
          ? prepareOutreachVoiceScriptForReview({
              script: row.message.voice_script,
              recipientFirstName: row.prospect?.first_name,
              senderName: sender?.senderName || "",
            })
          : row.message.voice_script || "";
      next[row.message.id] = {
        subject: row.message.subject || "",
        body_text: row.message.body_text || "",
        voice_script: reviewableVoiceScript,
      };
    }
    for (const reply of replies) if (reply.bookingDraft) next[reply.bookingDraft.id] = { subject: reply.bookingDraft.subject || "", body_text: reply.bookingDraft.body_text || "", voice_script: reply.bookingDraft.voice_script || "" };
    setDraftEdits(next);
  }, [queue, replies, sender?.senderName]);
  useEffect(() => {
    if (!expandedCampaignId) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        document.getElementById(`campaign-card-${expandedCampaignId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [expandedCampaignId]);

  const orderedCampaigns = useMemo(
    () => campaigns.slice().sort((left, right) => {
      if (left.id === selectedCampaignId) return -1;
      if (right.id === selectedCampaignId) return 1;
      return new Date(right.updated_at || right.created_at || 0).getTime() -
        new Date(left.updated_at || left.created_at || 0).getTime();
    }),
    [campaigns, selectedCampaignId]
  );
  const displayedReplies = useMemo(
    () =>
      replies
        .slice()
        .sort((left, right) => {
          if (left.id === focusedReplyId) return -1;
          if (right.id === focusedReplyId) return 1;
          if (left.slaBreached !== right.slaBreached)
            return left.slaBreached ? -1 : 1;
          if ((left.deliveryState === "failed") !== (right.deliveryState === "failed"))
            return left.deliveryState === "failed" ? -1 : 1;
          if (left.attentionOpen !== right.attentionOpen)
            return left.attentionOpen ? -1 : 1;
          return (
            new Date(right.last_reply_at || 0).getTime() -
            new Date(left.last_reply_at || 0).getTime()
          );
        }),
    [focusedReplyId, replies]
  );
  const activeCampaign = orderedCampaigns.find(
    (campaign) => campaign.id === selectedCampaignId
  ) || orderedCampaigns.find((campaign) => campaign.status === "active");
  const canEditActiveCampaignContent = Boolean(
    activeCampaign &&
    canEditCampaignContent &&
    (canManageCampaigns || activeCampaign.visibility === "team")
  );
  const dailyQueueLimit = clampOutreachDailyLimit(activeCampaign?.daily_limit);
  const queueCampaigns = useMemo(
    () => outreachQueueCampaignCounts(queue),
    [queue]
  );
  const campaignSelectionExplanation = explainOutreachCampaignSelection({
    selectedCampaignName: activeCampaign?.name,
    selectedCampaignId: activeCampaign?.id,
    queueCampaigns,
    queueLength: queue.length,
    dailyLimit: dailyQueueLimit,
  });
  const selectableCampaigns = orderedCampaigns.filter(
    (campaign) => campaign.status === "active"
  );
  const startCampaignTutorial = () => {
    const campaignId = selectedCampaignId || orderedCampaigns[0]?.id || "";
    if (campaignId) {
      setCampaignEditorView("setup");
      setExpandedCampaignId(campaignId);
    }
    window.dispatchEvent(new CustomEvent("lc:start-sales-tutorial", {
      detail: { stepId: "campaign" },
    }));
  };
  const selectTab = (next: Tab) => {
    setTab(next);
    setFocusedProspectId("");
    setFocusedReplyId("");
    const url = new URL(window.location.href);
    url.searchParams.delete("prospect");
    url.searchParams.delete("reply");
    if (next === "queue") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };
  const openOutreachMetric = (next: Tab, sectionId?: string) => {
    selectTab(next);
    if (!sectionId) return;
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  };
  const clearProspectFocus = () => {
    setFocusedProspectId("");
    const url = new URL(window.location.href);
    url.searchParams.delete("prospect");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  };
  const openProspectFromThisPage = (
    prospect: Prospect | null | undefined,
    event: { preventDefault: () => void }
  ) => {
    if (!prospect?.id) return;
    event.preventDefault();
    if (focusedProspectId === prospect.id && tab === "prospects") return;
    setFocusedProspectId(prospect.id);
    setTab("prospects");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "prospects");
    url.searchParams.set("prospect", prospect.id);
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
  };
  useEffect(() => {
    if (tab !== "prospects" || !focusedProspectId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`prospect-${focusedProspectId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedProspectId, prospects.length, tab]);
  useEffect(() => {
    if (tab !== "replies" || !focusedReplyId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`reply-${focusedReplyId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedReplyId, replies.length, tab]);
  const setMessage = (id: string, patch: Partial<{ subject: string; body_text: string; voice_script: string }>) => {
    const styled = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, removeDashesFromProse(value)])
    ) as Partial<{ subject: string; body_text: string; voice_script: string }>;
    setDraftEdits((all) => ({ ...all, [id]: { subject: all[id]?.subject || "", body_text: all[id]?.body_text || "", voice_script: all[id]?.voice_script || "", ...styled } }));
  };

  const hasApprovableEmail = (row: QueueRow): boolean => {
    const message = row.message;
    if (!message || !["draft", "failed"].includes(message.status)) return false;
    const visible = draftEdits[message.id];
    return Boolean(
      String(visible?.subject ?? message.subject ?? "").trim() &&
      String(visible?.body_text ?? message.body_text ?? "").trim()
    );
  };

  const buildQueue = async () => {
    setBusy("queue"); setError(""); setNotice("");
    try {
      const data = await crmFetch<any>("/api/crm/outreach/queue", {
        method: "POST",
        body: JSON.stringify({
          campaignId: activeCampaign?.id || null,
          limit: clampOutreachDailyLimit(activeCampaign?.daily_limit),
        }),
      });
      setQueue(data.queue || []);
      const held = data.selection?.held || 0;
      const skipped = data.selection?.skipped || 0;
      const firstTouches = data.selection?.firstTouches || 0;
      const followUps = data.selection?.followUps || 0;
      const addedSummary = firstTouches
        ? `${firstTouches} new ${firstTouches === 1 ? "contact" : "contacts"} added first${followUps ? `, followed by ${followUps} due follow ${followUps === 1 ? "up" : "ups"} in spare slots` : ""}`
        : followUps
          ? `${followUps} due follow ${followUps === 1 ? "up" : "ups"} added because no eligible step one contacts remained`
          : "No new contacts were added";
      setNotice(`${addedSummary}. ${held} held for stronger evidence${skipped ? ` and ${skipped} skipped` : ""}.`);
      await loadCore();
    }
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
      setQueueCampaignFilterId(result.selectedCampaignId);
      const filled = await crmFetch<any>(OUTREACH_URLS.queue, {
        method: "POST",
        body: JSON.stringify({
          campaignId: result.selectedCampaignId,
          limit: clampOutreachDailyLimit(result.campaign.daily_limit),
        }),
      });
      const nextQueue = filled.queue || [];
      setQueue(nextQueue);
      setNotice(
        `${result.campaign.name} is selected for new queue spaces. ${explainOutreachCampaignSelection({
          selectedCampaignName: result.campaign.name,
          selectedCampaignId: result.campaign.id,
          queueCampaigns: outreachQueueCampaignCounts(nextQueue),
          queueLength: nextQueue.length,
          dailyLimit: clampOutreachDailyLimit(result.campaign.daily_limit),
        })} Your teammates keep their own selections.`
      );
      await Promise.all([
        loadCore(),
        tab === "prospects" ? loadProspects() : Promise.resolve(),
      ]);
    } catch (e: any) {
      setError(e.message || "The campaign could not be selected");
    } finally {
      setBusy("");
    }
  };
  const prepare = (prospectId: string) => enqueuePrepare(prospectId);
  const createVoiceScript = (
    _messageId: string,
    prospectId: string,
    quiet = false
  ) => enqueuePrepare(prospectId, quiet);
  const saveDraft = async (messageId: string) => {
    setBusy(`save:${messageId}`); setError("");
    try {
      const { message } = await crmFetch<{ message: Record<string, any> }>(`/api/crm/outreach/messages/${messageId}`, { method: "PATCH", body: JSON.stringify(draftEdits[messageId]) });
      if (!message?.id)
        throw crmConfirmationError({
          url: `/api/crm/outreach/messages/${messageId}`,
          method: "PATCH",
          reason: "LiveCoach did not return the saved outreach draft",
        });
      setQueue((all) => all.map((row) => row.message?.id === messageId ? { ...row, message: { ...row.message, ...message } } : row));
      setReplies((all) => all.map((reply) => reply.bookingDraft?.id === messageId ? { ...reply, bookingDraft: { ...reply.bookingDraft, ...message } } : reply));
      setDraftEdits((all) => ({ ...all, [messageId]: { subject: message.subject || "", body_text: message.body_text || "", voice_script: message.voice_script || "" } }));
      setNotice("Draft saved.");
    }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const generateVoiceNote = async (messageId: string) => {
    if (generatingVoiceMessageId) return;
    const visible = draftEdits[messageId];
    if (
      !visible?.subject?.trim() ||
      !visible?.body_text?.trim() ||
      !visible?.voice_script?.trim()
    ) {
      setError("Review the email and voice script before creating audio");
      return;
    }
    setGeneratingVoiceMessageId(messageId); setError(""); setNotice("");
    try {
      const approved = await crmFetch<{ message: Record<string, any> }>(
        `/api/crm/outreach/messages/${messageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            ...visible,
            approve_voice_script: true,
          }),
        }
      );
      if (!approved.message?.voice_script_approved_at)
        throw crmConfirmationError({
          url: `/api/crm/outreach/messages/${messageId}`,
          method: "PATCH",
          reason: "LiveCoach did not confirm approval of the exact voice script",
        });
      setQueue((all) => all.map((row) => row.message?.id === messageId
        ? { ...row, message: { ...row.message, ...approved.message } }
        : row));
      setDraftEdits((all) => ({
        ...all,
        [messageId]: {
          subject: approved.message.subject || visible.subject,
          body_text: approved.message.body_text || visible.body_text,
          voice_script: approved.message.voice_script || visible.voice_script,
        },
      }));
      const result = await crmFetch<{ message: Record<string, any>; reused: boolean }>(
        `/api/crm/outreach/messages/${messageId}/voice`,
        { method: "POST", body: "{}" }
      );
      if (result.message?.voice_status !== "ready")
        throw crmConfirmationError({
          url: `/api/crm/outreach/messages/${messageId}/voice`,
          method: "POST",
          reason: "LiveCoach did not confirm that the voice preview is ready",
        });
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
      setGeneratingVoiceMessageId("");
    }
  };
  const send = async (messageId: string) => {
    setBusy(`send:${messageId}`); setError("");
    try {
      const result = await crmFetch<any>(`/api/crm/outreach/messages/${messageId}/send`, { method: "POST", body: "{}" });
      setNotice(`Queued safely for ${formatActivityDate(result.scheduledAt)}. Approved emails send five minutes apart.`);
      await Promise.all([
        loadCore(),
        tab === "replies" ? loadMetrics() : Promise.resolve(),
      ]);
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
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
        throw crmConfirmationError({
          url: `/api/crm/outreach/messages/${messageId}`,
          method: "PATCH",
          reason: "LiveCoach did not confirm approval of the exact visible draft",
        });
      const result = await crmFetch<any>(
        `/api/crm/outreach/messages/${messageId}/send`,
        { method: "POST", body: "{}" }
      );
      setNotice(
        `Exact email approved and queued for ${formatActivityDate(result.scheduledAt)}. It will send automatically from ${sender?.senderEmail || "your connected mailbox"}. A ready voice note is included, while an unfinished one never delays the email.`
      );
      await Promise.all([loadCore(), tab === "replies" ? loadMetrics() : Promise.resolve()]);
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
    } catch (e: any) {
      setError(e.message || "The email was not queued");
    } finally {
      setBusy("");
    }
  };
  const prepareAllRemaining = async () => {
    const preparable = filterOutreachQueueByCampaign(
      queue,
      queueCampaignFilterId
    ).filter(queueRowNeedsPreparation)
      .filter((row) => !ctaBlockedIds.includes(row.id));
    const firstTouches = preparable.filter((row) => queueWaveRank(row) === 0);
    const activeWave = firstTouches.length ? firstTouches : preparable;
    const selectedRows = activeWave.filter(
      (row) =>
        !["queued", "researching", "done"].includes(
          prepareJobsRef.current[row.prospect.id] || ""
        )
    );
    const ids = selectedRows.map((row) => row.prospect.id);
    if (!ids.length) {
      setNotice("Every eligible person in today's queue is already prepared or in progress.");
      return;
    }
    const voiceRepairs = selectedRows.filter(queueRowNeedsVoiceScript).length;
    const newDrafts = ids.length - voiceRepairs;
    setNotice(`${ids.length} ${firstTouches.length ? "step one drafts" : "follow ups"} are being saved to the research queue. ${newDrafts} need a new email and voice script. ${voiceRepairs} existing drafts need their missing voice script restored.`);
    await enqueuePrepareBatch(ids, true);
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
  const sendToSendPilot = async (row: QueueRow) => {
    const prospect = row.prospect;
    const campaignName = row.sendpilot?.campaignName || "the mapped SendPilot campaign";
    const personName = [prospect?.first_name, prospect?.last_name]
      .filter(Boolean)
      .join(" ") || prospect?.email || "this prospect";
    if (
      !window.confirm(
        `Add ${personName} to ${campaignName}? SendPilot will begin that campaign's LinkedIn sequence. LiveCoach will keep the lead and activity history.`
      )
    ) {
      return;
    }
    setBusy(`sendpilot:${row.id}`);
    setRowErrors((all) => ({ ...all, [prospect.id]: "" }));
    setNotice("");
    try {
      const result = await crmFetch<any>(
        `/api/crm/outreach/${prospect.id}/sendpilot`,
        {
          method: "POST",
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            enrolmentId: row.id,
            confirmed: true,
          }),
        }
      );
      setNotice(
        result.alreadySubmitted
          ? `${personName} is already recorded in SendPilot. No duplicate was created.`
          : `${personName} was approved and handed to ${campaignName}. LiveCoach will now track the LinkedIn sequence and any reply.`
      );
      await Promise.all([loadCore(), loadProspects()]);
    } catch (caught: any) {
      setRowErrors((all) => ({
        ...all,
        [prospect.id]: caught?.message || "The SendPilot handoff did not complete",
      }));
      await loadCore();
    } finally {
      setBusy("");
    }
  };
  const approveAllPrepared = async () => {
    const readyDrafts = filterOutreachQueueByCampaign(
      queue,
      queueCampaignFilterId
    ).filter(hasApprovableEmail)
      .filter(
        (row) => !ctaRefreshRequiredProspectIds.includes(row.prospect.id)
      );
    const firstTouchDrafts = readyDrafts.filter(
      (row) => queueWaveRank(row) === 0
    );
    const drafts = firstTouchDrafts.length ? firstTouchDrafts : readyDrafts;
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
          throw crmConfirmationError({
            url: `/api/crm/outreach/messages/${messageId}`,
            method: "PATCH",
            reason: "LiveCoach did not confirm approval of one exact visible draft",
          });
        const queued = await crmFetch<any>(
          `/api/crm/outreach/messages/${messageId}/send`,
          { method: "POST", body: "{}" }
        );
        lastScheduledAt = queued.scheduledAt || lastScheduledAt;
      }
      setNotice(`${drafts.length} reviewed emails approved and queued five minutes apart${lastScheduledAt ? `. The last is scheduled for ${formatActivityDate(lastScheduledAt)}` : ""}. Ready voice notes are included, while unfinished ones do not delay delivery.`);
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
      if (!message?.id || message.subject !== draftEdits[messageId]?.subject?.trim() || message.body_text !== draftEdits[messageId]?.body_text?.trim())
        throw crmConfirmationError({
          url: `/api/crm/outreach/messages/${messageId}`,
          method: "PATCH",
          reason: "LiveCoach returned a different rehearsal draft from the one visible",
        });
      setQueue((all) => all.map((row) => row.message?.id === messageId ? { ...row, message: { ...row.message, ...message } } : row));
      const result = await crmFetch<{
        ok: boolean;
        accepted: boolean;
        sentTo: string;
        from: string;
        provider: "google" | "microsoft";
        deliveryLocation: "sent_or_all_mail" | "inbox_or_sent";
        voiceIncluded: boolean;
        campaignChanged: boolean;
      }>(`/api/crm/outreach/messages/${messageId}/rehearse`, { method: "POST", body: "{}" });
      if (!result.ok || !result.accepted || (sender?.mailboxEmail && result.sentTo !== sender.mailboxEmail) || result.campaignChanged !== false)
        throw crmConfirmationError({
          url: `/api/crm/outreach/messages/${messageId}/rehearse`,
          method: "POST",
          reason: "LiveCoach did not confirm safe delivery of the rehearsal",
        });
      setNotice(
        result.provider === "google" && result.deliveryLocation === "sent_or_all_mail"
          ? `Gmail accepted the rehearsal from ${result.from} to ${result.sentTo}. ${result.voiceIncluded ? "The ready voice note is included." : "No generated voice note was included."} Because this is the same Gmail account, look in Sent or All Mail rather than waiting for a new Inbox message. No prospect was contacted and campaign results did not change.`
          : `The mailbox accepted the rehearsal from ${result.from} to ${result.sentTo}. ${result.voiceIncluded ? "The ready voice note is included." : "No generated voice note was included."} Check Inbox or Sent. No prospect was contacted and campaign results did not change.`
      );
    }
    catch (e: any) { setError(e.message); } finally { setBusy(""); }
  };
  const updatePriority = async (id: string, value: Priority) => {
    const previous = prospects.find((prospect) => prospect.id === id);
    setProspects((all) => all.map((p) => p.id === id ? { ...p, priority: value } : p));
    try {
      const { prospect } = await crmFetch<{ prospect: Prospect }>(`/api/crm/outreach/${id}`, { method: "PATCH", body: JSON.stringify({ priority: value }) });
      if (prospect?.priority !== value)
        throw crmConfirmationError({
          url: `/api/crm/outreach/${id}`,
          method: "PATCH",
          reason: "LiveCoach returned a different prospect priority from the one selected",
        });
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
      if (!prospect?.id || prospect.assigned_to_user_id !== nextAssignee)
        throw crmConfirmationError({
          url: `/api/crm/outreach/${id}`,
          method: "PATCH",
          reason: "LiveCoach did not confirm the selected prospect assignment",
        });
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
      if (canManageCampaigns && (!Number.isFinite(campaign.daily_limit) || campaign.daily_limit < 1 || campaign.daily_limit > OUTREACH_DAILY_HARD_LIMIT)) throw new Error(`Daily maximum must be between 1 and ${OUTREACH_DAILY_HARD_LIMIT}`);
      const sequenceError = outreachSequenceValidationError(campaign.sequence || []);
      if (sequenceError) throw new Error(sequenceError);
      const { campaign: saved } = await crmFetch<{ campaign: Campaign }>(`/api/crm/outreach/campaigns/${campaign.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          goal: campaign.goal,
          audience: campaign.audience,
          offer_angle: campaign.offer_angle,
          cta_config: campaign.cta_config,
          sequence: campaign.sequence,
          voice: campaign.voice,
          banned_phrases: campaign.banned_phrases,
          booking_cta_mode: campaign.booking_cta_mode,
          ...(canManageCampaigns ? {
            name: campaign.name,
            status: campaign.status,
            daily_limit: campaign.daily_limit,
          } : {}),
        }),
      });
      if (!saved?.id)
        throw crmConfirmationError({
          url: `/api/crm/outreach/campaigns/${campaign.id}`,
          method: "PATCH",
          reason: "LiveCoach did not return the saved campaign settings",
        });
      setCampaigns((all) => all.map((item) => item.id === saved.id ? { ...item, ...saved } : item));
      setNotice(canManageCampaigns ? "Campaign settings saved." : "Shared campaign content saved for the team.");
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
  const markReplyHandled = async (prospectId: string) => {
    setBusy(`resolve-reply:${prospectId}`); setError(""); setNotice("");
    try {
      const result = await crmFetch<{ ok: boolean }>(
        `/api/crm/outreach/replies/${prospectId}/resolve`,
        { method: "POST", body: "{}" }
      );
      if (!result.ok)
        throw crmConfirmationError({
          url: `/api/crm/outreach/replies/${prospectId}/resolve`,
          method: "POST",
          reason: "LiveCoach did not confirm that the reply was reviewed",
        });
      setReplies((all) =>
        all.map((reply) =>
          reply.id === prospectId ? { ...reply, attentionOpen: false } : reply
        )
      );
      setNotice("Reply marked reviewed. Its source history remains available here.");
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
      window.dispatchEvent(new CustomEvent("lc:notifications-updated"));
    } catch (e: any) {
      setError(e.message || "The reply could not be marked reviewed");
    } finally {
      setBusy("");
    }
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
      limit: clampOutreachDailyLimit(targetCampaign.daily_limit),
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
      await loadCore();
      await enqueuePrepare(prospect.id);
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
      if (!result.draft?.comment || result.savedToBrain !== false)
        throw crmConfirmationError({
          url: "/api/crm/outreach/engage",
          method: "POST",
          reason: "LiveCoach did not confirm a private comment draft that stays outside Brain",
        });
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
      if (focusedProspectId) return prospect.id === focusedProspectId;
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
  }, [currentUser, focusedProspectId, needle, ownerFilter, priority, prospectCampaignId, prospectSort, prospects, recommendationFilter, sortDirection, stageFilter]);
  useEffect(() => {
    setVisibleProspectLimit(PROSPECT_PAGE_SIZE);
  }, [focusedProspectId, needle, ownerFilter, priority, prospectCampaignId, prospectSort, recommendationFilter, sortDirection, stageFilter]);
  const shownPage = useMemo(
    () => focusedProspectId ? shown : shown.slice(0, visibleProspectLimit),
    [focusedProspectId, shown, visibleProspectLimit]
  );

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
    { label: "My prospects", value: metrics.prospects || 0, colour: "bg-sky", tab: "prospects" as Tab },
    { label: "Emails sent", value: metrics.sent || 0, colour: "bg-amber", tab: "activity" as Tab, sectionId: "recent-email-activity" },
    { label: "Replies", value: metrics.replies || 0, colour: "bg-bone", tab: "replies" as Tab },
    { label: "Interested", value: metrics.positiveReplies || 0, colour: "bg-moss", tab: "replies" as Tab },
    { label: "Meetings", value: metrics.meetings || 0, colour: "bg-moss", tab: "replies" as Tab },
  ];
  const researchingCount = prepareJobCounts.researching;
  const queuedResearchCount = prepareJobCounts.queued;
  const visibleQueue = useMemo(
    () => filterOutreachQueueByCampaign(queue, queueCampaignFilterId),
    [queue, queueCampaignFilterId]
  );
  const queueCampaignFilterName =
    queueCampaignFilterId === OUTREACH_QUEUE_ALL_CAMPAIGNS
      ? "All campaigns"
      : queueCampaigns.find((campaign) => campaign.id === queueCampaignFilterId)
          ?.name ||
        campaigns.find((campaign) => campaign.id === queueCampaignFilterId)
          ?.name ||
        "Selected campaign";
  // Keep today's untouched work at the top. Sent prospects remain visible as
  // the audit trail, but rotate beneath every person who still needs action.
  // The API's priority order is preserved inside both groups.
  const orderedQueue = useMemo(
    () =>
      visibleQueue
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
            queueWaveRank(a.row) - queueWaveRank(b.row) ||
            Number(needsAction(b.row)) - Number(needsAction(a.row)) ||
            a.originalIndex - b.originalIndex
          );
        })
        .map(({ row }) => row),
    [visibleQueue]
  );
  const preparableEmailRows = visibleQueue.filter(
    (row) =>
      queueRowNeedsPreparation(row) && !ctaBlockedIds.includes(row.id)
  );
  const firstTouchEmailRows = preparableEmailRows.filter(
    (row) => queueWaveRank(row) === 0
  );
  const activePreparationRows = (
    firstTouchEmailRows.length ? firstTouchEmailRows : preparableEmailRows
  );
  const remainingToPrepare = activePreparationRows.length;
  const missingVoiceScriptCount = activePreparationRows.filter(
    queueRowNeedsVoiceScript
  ).length;
  const newEmailDraftCount = remainingToPrepare - missingVoiceScriptCount;
  const newContactCount = visibleQueue.filter(
    (row) => row.queueKind !== "follow_up"
  ).length;
  const followUpDueCount = visibleQueue.filter(
    (row) =>
      row.queueKind === "follow_up" &&
      row.status === "queued" &&
      Number(row.current_step) > 1 &&
      row.sequenceStepDue !== false
  ).length;
  const manualStepsDue = visibleQueue.filter(
    (row) =>
      !row.message &&
      row.sequenceStepDue !== false &&
      (row.sequenceStep?.channel || "email") !== "email" &&
      !["completed", "paused", "replied", "booked", "suppressed"].includes(
        row.status
      )
  ).length;
  const approvalReadyRows = visibleQueue.filter(
    (row) =>
      hasApprovableEmail(row) &&
      !ctaRefreshRequiredProspectIds.includes(row.prospect.id)
  );
  const firstTouchApprovalRows = approvalReadyRows.filter(
    (row) => queueWaveRank(row) === 0
  );
  const preparedToApprove = (
    firstTouchApprovalRows.length ? firstTouchApprovalRows : approvalReadyRows
  ).length;
  const scheduledToSend = visibleQueue.filter(
    (row) => row.message?.status === "approved" && row.message?.scheduled_at
  ).length;

  return (
    <main className="relative z-10 mx-auto max-w-[1180px] px-3 py-5 sm:px-5 sm:py-9">
      <NavMenu />
      <header className="mb-4 flex items-start justify-between gap-3 border-b border-edge pb-4">
        <div><h1 className="font-display text-[1.55rem] tracking-tight text-bone"><span className="italic text-amber">Interviewa</span> outreach</h1><p className="mt-1 font-mono text-[0.57rem] uppercase tracking-wider text-muted">Approval mode · from {sender?.senderEmail || "your connected mailbox"} · maximum {OUTREACH_DAILY_HARD_LIMIT}/day</p></div>
        <Link href="/crm" className="shrink-0 rounded-full border border-edge px-3 py-2 font-mono text-[0.6rem] uppercase text-muted">◂ CRM</Link>
      </header>

      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[{ label: "Today's queue", value: queue.length, tab: "queue" as Tab }, { label: "Sent today", value: metrics.sentToday || 0, tab: "activity" as Tab }, { label: "Awaiting approval", value: queue.filter((r) => r.message?.status === "draft").length, tab: "queue" as Tab }, { label: "Unanswered replies", value: metrics.unansweredReplies || 0, tab: "replies" as Tab }].map((item) => <button type="button" onClick={() => selectTab(item.tab)} key={item.label} className={`rounded-xl border bg-panel p-3 text-left transition hover:border-amber/55 ${item.label === "Unanswered replies" && metrics.overdueReplies ? "border-rust/55" : "border-edge"}`}><strong className={`block font-display text-2xl ${item.label === "Unanswered replies" && metrics.overdueReplies ? "text-rust" : "text-bone"}`}>{item.value}</strong><span className="font-mono text-[0.55rem] uppercase tracking-wider text-muted">{item.label} ↘</span></button>)}
      </section>

      <nav aria-label="Outreach sections" className="sticky top-0 z-40 mb-4 -mx-3 flex overflow-x-auto border-y border-edge bg-ink/95 px-3 shadow-[0_10px_25px_rgba(0,0,0,0.32)] backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
        {tabs.map((item) => <button key={item.key} onClick={() => selectTab(item.key)} className={`min-h-12 shrink-0 border-b-2 px-3 font-mono text-[0.6rem] uppercase tracking-wider ${tab === item.key ? "border-amber text-amber" : "border-transparent text-muted"}`}><span className="mr-1.5">{item.icon}</span>{item.label}</button>)}
      </nav>

      {notice ? <p className="mb-3 rounded-lg border border-moss/40 bg-moss/10 px-3 py-2 text-sm text-moss">{notice}</p> : null}
      {error ? <p className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p> : null}
      {researchingCount || queuedResearchCount ? <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky/45 bg-sky/[0.08] px-3 py-2 text-sm text-sky" role="status" aria-live="polite"><span className="h-2 w-2 animate-pulse rounded-full bg-sky" /><strong>{researchingCount} researching</strong>{queuedResearchCount ? <span>· {queuedResearchCount} waiting</span> : null}{prepareJobCounts.completed ? <span>· {prepareJobCounts.completed} completed</span> : null}{prepareJobCounts.failed ? <span className="text-rust">· {prepareJobCounts.failed} blocked</span> : null}<span className="text-bone/65">Saved on the server. You can leave this page and it will continue.</span></div> : null}
      {loading ? <MatrixRain size="panel" messages={["loading outreach", "checking today's queue", "refreshing campaign activity"]} /> : null}
      {!loading && tabLoading ? <MatrixRain size="compact" messages={["loading this outreach view"]} /> : null}

      {!loading && !tabLoading && tab === "queue" ? <section data-sales-tour="outreach-queue">
        <RevenueToday />
        <div className="mb-4 rounded-xl border border-moss/35 bg-moss/[0.06] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-2xl">
              <p className="font-mono text-[0.55rem] uppercase tracking-wider text-moss">Campaign to add next</p>
              <h2 className="mt-1 font-display text-lg text-bone">{activeCampaign?.name || "No active campaign"}</h2>
              <p className="mt-1 text-sm leading-6 text-bone/75">{campaignSelectionExplanation}</p>
              {queueCampaigns.length ? (
                <div className="mt-2 flex flex-wrap gap-2" aria-label="Today's contacts by campaign">
                  {queueCampaigns.map((campaign) => (
                    <span key={campaign.id} className="rounded-full border border-edge bg-ink/35 px-2 py-1 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                      Today · {campaign.count} · {campaign.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {selectableCampaigns.length ? <label className="w-full sm:w-72"><span className="mb-1 block font-mono text-[0.52rem] uppercase tracking-wider text-muted">Choose campaign to add next</span><select aria-label="Choose campaign to add next" className={`${input} min-h-11`} value={activeCampaign?.id || ""} onChange={(event) => void selectActiveCampaign(event.target.value)} disabled={!!busy}>{selectableCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><span className="mt-1 block text-xs leading-5 text-muted">After it saves, the list below switches to that campaign too. Existing contacts stay where they are.</span></label> : <button type="button" onClick={() => selectTab("campaign")} className={button}>Review campaigns</button>}
          </div>
        </div>
        <div className="mb-4 rounded-xl border border-edge bg-panel p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-display text-lg text-bone">Today’s assigned contacts</h2>
              <p className="mt-1 text-sm text-muted">Each person keeps the campaign shown on their card. Filtering only changes what you can see and action. It never moves or rewrites anyone already queued. Email drafts still require approval.</p>
              <p className="mt-2 font-mono text-[0.56rem] uppercase tracking-wider text-muted">Showing {visibleQueue.length} of {queue.length} · {newContactCount} new contacts · {followUpDueCount} follow ups due · {newEmailDraftCount} new emails to prepare · {missingVoiceScriptCount} optional voice scripts to prepare · {manualStepsDue} LinkedIn or phone actions · {preparedToApprove} ready to approve · {scheduledToSend} scheduled</p>
            </div>
            <div className="grid w-full gap-2 sm:w-72">
              <label>
                <span className="mb-1 block font-mono text-[0.52rem] uppercase tracking-wider text-sky">Show campaign</span>
                <select
                  aria-label="Filter today's queue by campaign"
                  className={`${input} min-h-11`}
                  value={queueCampaignFilterId}
                  onChange={(event) => setQueueCampaignFilterId(event.target.value)}
                >
                  <option value={OUTREACH_QUEUE_ALL_CAMPAIGNS}>All campaigns ({queue.length})</option>
                  {queueCampaignFilterId !== OUTREACH_QUEUE_ALL_CAMPAIGNS && !queueCampaigns.some((campaign) => campaign.id === queueCampaignFilterId) ? <option value={queueCampaignFilterId}>{queueCampaignFilterName} (0)</option> : null}
                  {queueCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.count})</option>)}
                </select>
                <span className="mt-1 block text-xs leading-5 text-sky">Updates this list immediately. No Search button is needed.</span>
              </label>
              <button onClick={buildQueue} disabled={!!busy || queue.length >= dailyQueueLimit} className={button}>{busy === "queue" ? "Ranking…" : queue.length >= dailyQueueLimit ? "Today’s queue is full" : queue.length ? `Choose ${Math.max(0, dailyQueueLimit - queue.length)} more from ${activeCampaign?.name || "selected campaign"}` : `Choose today's contacts from ${activeCampaign?.name || "selected campaign"}`}</button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button onClick={prepareAllRemaining} disabled={!!busy || !remainingToPrepare} className={button}>{remainingToPrepare ? `Research + draft current wave (${remainingToPrepare})` : "Current wave prepared"}</button>
            <button onClick={approveAllPrepared} disabled={!!busy || !preparedToApprove} className={primary}>{busy === "approve-all" ? "Approving and queueing…" : preparedToApprove ? `Approve current wave & queue (${preparedToApprove})` : "No drafts awaiting approval"}</button>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">Choosing contacts is free and starts no research. Research + draft current wave prepares the email and optional voice script, but never generates paid audio or contacts anyone. Bulk approval applies only to the exact emails already shown below.</p>
          <p className="mt-2 text-xs leading-5 text-sky">Overnight preparation keeps a maximum of {OVERNIGHT_RESEARCH_INVENTORY_LIMIT} unused researched leads per salesperson. Saved research and missing script repairs are reused before any new lead is researched.</p>
        </div>
        <div className="space-y-3">{orderedQueue.map((row, index) => { const p = row.prospect; const m = row.message; const lastSent = row.lastSentMessage; const isFollowUp = row.queueKind === "follow_up" || Boolean(lastSent); const followUpDue = isFollowUp && row.status === "queued" && Number(row.current_step) > 1 && row.sequenceStepDue !== false; const sequenceStep = row.sequenceStep as SequenceStep | null; const channel = sequenceStep?.channel || "email"; const manual = channel !== "email"; const manualDue = manual && row.sequenceStepDue !== false && !["completed", "paused", "replied", "booked", "suppressed"].includes(row.status); const needsVoiceScript = queueRowNeedsVoiceScript(row); const canPrepare = !manual && queueRowNeedsPreparation(row); const prepareStatus = prepareJobs[p.id]; const preparePending = prepareStatus === "queued" || prepareStatus === "researching" || prepareStatus === "done"; const ctaBlocked = ctaBlockedIds.includes(row.id); const ctaRefreshRequired = ctaRefreshRequiredProspectIds.includes(p.id); const canEditCta = !manual && (canPrepare || ["draft", "failed"].includes(m?.status)); const displayStatus = manualDue ? channel : followUpDue && !m ? "follow_up_due" : m?.status === "approved" && m?.scheduled_at ? "scheduled" : m?.status || (lastSent ? "sent" : row.status || "queued"); const displayStatusLabel = displayStatus === "sent" ? "✓ sent" : displayStatus === "follow_up_due" ? "Follow up due" : displayStatus; const edit = m ? draftEdits[m.id] || { subject: m.subject, body_text: m.body_text, voice_script: m.voice_script || "" } : null; return <article key={row.id} style={{ contentVisibility: "auto" }} className={`rounded-xl border bg-panel p-4 ${isFollowUp ? "border-amber/45" : "border-edge"}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`font-mono text-[0.55rem] uppercase ${isFollowUp ? "text-amber" : "text-sky"}`}>#{index + 1} · {followUpDue ? "follow up due" : isFollowUp ? "previously contacted" : "new contact"} · step {row.current_step}{sequenceStep ? ` · ${sequenceStep.purpose}` : ""}</p>
              <CanonicalRecordLink href={outreachProspectHref(p)} onNavigate={(event) => openProspectFromThisPage(p, event)} className="mt-1 block min-h-11 min-w-0 py-1" ariaLabel={`Open ${`${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email || "prospect"}`}>
                <h3 className="font-display text-lg text-bone">{p.first_name} {p.last_name}</h3>
                <p className="text-sm text-bone/80">{p.job_title} · {p.company_name}</p>
              </CanonicalRecordLink>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-sky/45 bg-sky/10 px-2 py-0.5 font-mono text-[0.54rem] uppercase text-sky">Campaign · {row.campaign?.name || "Not recorded"}</span>
                <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.54rem] uppercase ${pill[p.priority]}`}>manual priority {p.priority}</span>
                <span className={`rounded-full border px-2 py-0.5 font-mono text-[0.54rem] uppercase ${pill[displayStatus] || (manual ? "border-sky/50 bg-sky/10 text-sky" : "border-edge text-muted")}`}>{displayStatusLabel}</span>
              </div>
              {isFollowUp && lastSent?.sent_at ? <div className="mt-3 rounded-lg border border-amber/35 bg-amber/[0.06] px-3 py-2 text-xs leading-5 text-bone/80"><strong className="text-amber">Earlier email sent {formatActivityDate(lastSent.sent_at)}</strong>{lastSent.subject ? <span> · “{lastSent.subject}”</span> : null}<span className="block text-muted">{followUpDue ? "This is a scheduled follow up, not a new prospect." : "This contact has previous outreach history."}</span></div> : null}
              {!m && row.next_action_at && row.sequenceStepDue === false ? <p className="mt-2 text-xs text-muted">Next step becomes ready {formatActivityDate(row.next_action_at)}.</p> : null}
            </div>
            {canPrepare ? (
              <button onClick={() => needsVoiceScript && m?.id ? void createVoiceScript(m.id, p.id) : prepare(p.id)} disabled={preparePending || ctaBlocked} className={`${primary} w-full sm:w-auto`}>
                {prepareStatus === "adding" ? "Saving to queue…" : prepareStatus === "researching" ? needsVoiceScript ? "Creating voice script…" : "Researching in background…" : prepareStatus === "queued" ? "Queued on server" : prepareStatus === "done" ? needsVoiceScript ? "Voice script ready" : "Draft ready" : needsVoiceScript ? "Create voice script" : isFollowUp ? `Prepare step ${row.current_step} follow up` : "Research + write email + voice script"}
              </button>
            ) : manual && channel === "linkedin" ? (
              <div className="grid w-full gap-2 sm:w-auto sm:min-w-[25rem] sm:grid-cols-2">
                <a href={linkedinTarget(p)} target="_blank" rel="noreferrer" className={`${button} inline-flex items-center justify-center border-sky/45 text-sky`}>
                  Open LinkedIn ↗
                </a>
                {row.sendpilot?.execution && row.sendpilot.execution.syncStatus !== "failed" ? (
                  <span className="inline-flex min-h-11 items-center justify-center rounded-lg border border-moss/50 bg-moss/10 px-4 text-center font-mono text-[0.58rem] uppercase text-moss">
                    ✓ {sendPilotExecutionLabel(row.sendpilot.execution)}
                  </span>
                ) : row.sendpilot?.connected && row.sendpilot?.webhookConfigured && row.sendpilot?.mapped ? (
                  <button
                    type="button"
                    onClick={() => sendToSendPilot(row)}
                    disabled={!!busy || !manualDue}
                    className={primary}
                  >
                    {busy === `sendpilot:${row.id}`
                      ? "Handing to SendPilot…"
                      : row.sendpilot?.execution?.syncStatus === "failed"
                        ? "Retry SendPilot handoff"
                        : `Approve for ${row.sendpilot.campaignName || "SendPilot"}`}
                  </button>
                ) : (
                  <Link href="/settings#sendpilot-inbox" className={`${button} inline-flex items-center justify-center border-amber/50 text-amber`}>
                    Set up SendPilot
                  </Link>
                )}
                {!row.sendpilot?.execution ? (
                  <button
                    type="button"
                    onClick={() => completeManualSequenceStep(row)}
                    disabled={!!busy || !manualDue}
                    className={`${button} sm:col-span-2`}
                  >
                    {busy === `sequence-action:${row.id}`
                      ? "Saving…"
                      : manualDue
                        ? `Mark ${sequenceActionLabel(sequenceStep?.actionType)} done manually`
                        : `Due ${formatActivityDate(row.next_action_at)}`}
                  </button>
                ) : null}
              </div>
            ) : manual && channel === "phone" ? (
              <button type="button" onClick={() => { setFollowUpProspectId(""); setManualCallProspectId(p.id); }} disabled={!!busy || !manualDue} className={`${primary} w-full sm:w-auto`}>
                {manualDue ? "Call and log outcome" : `Due ${formatActivityDate(row.next_action_at)}`}
              </button>
            ) : !m && lastSent ? (
              <button onClick={() => selectTab("activity")} className="min-h-11 w-full rounded-lg border border-moss bg-moss px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-ink transition hover:bg-moss/85 sm:w-auto">
                ✓ Sent · view email
              </button>
            ) : null}
          </div>
          {canEditCta ? <div className="mt-3"><ProspectCtaSelector enrolmentId={row.id} value={row.cta_config} campaignValue={row.campaign?.cta_config} disabled={preparePending || Boolean(m?.scheduled_at)} hasEditableDraft={Boolean(m && ["draft", "failed"].includes(m.status))} onBlockingChange={(blocked) => setCtaBlockedIds((current) => blocked ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} onSaved={(ctaConfig, result) => { setQueue((current) => current.map((item) => item.id === row.id ? { ...item, cta_config: ctaConfig } : item)); setCtaRefreshRequiredProspectIds((current) => result.draftNeedsRefresh ? [...new Set([...current, p.id])] : current.filter((id) => id !== p.id)); }} /></div> : null}
          {ctaRefreshRequired ? <p className="mt-2 rounded-lg border border-amber/45 bg-amber/10 px-3 py-2 text-xs leading-5 text-amber">The action changed. Refresh the draft before approval so the email and voice script use the same next step.</p> : null}
          {manual && sequenceStep?.guidance ? <p className="mt-3 rounded-lg border border-sky/35 bg-sky/[0.05] px-3 py-2 text-xs leading-5 text-sky">{sequenceStep.guidance}</p> : null}
          {manual && channel === "phone" && manualCallProspectId === p.id ? <div className="mt-3"><ProspectManualCall prospect={p} campaignId={row.campaign_id} onCancel={() => setManualCallProspectId("")} onSaved={async () => { setManualCallProspectId(""); setNotice("Call saved. The sequence now follows the outcome you logged."); await Promise.all([loadCore(), loadMetrics()]); }} /></div> : null}
          {rowErrors[p.id] ? <p className="mt-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm leading-5 text-rust">{rowErrors[p.id]}</p> : null}
          <RecommendationCard recommendation={row.recommendation || p.recommendation} compact actionLabel={followUpDue ? "Follow up today" : undefined} />
          {row.research ? <details className="mt-4 rounded-lg border border-edge bg-ink/30 p-3"><summary className="cursor-pointer font-mono text-[0.6rem] uppercase tracking-wider text-amber">Why this message {m?.quality_score ? `· quality ${m.quality_score}/100` : ""}</summary><p className="mt-2 text-sm leading-6 text-bone/80">{m?.strategy?.reasoning || row.research.summary}</p><div className="mt-2 flex flex-wrap gap-1.5">{row.research.fitDecision ? <span className="rounded-full border border-moss/40 bg-moss/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase text-moss">{row.research.fitDecision}</span> : null}{row.research.commercialPath ? <span className="rounded-full border border-sky/40 bg-sky/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase text-sky">{row.research.commercialPath}</span> : null}{row.research.volumeAssessment ? <span className="rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[0.5rem] uppercase text-amber">{row.research.volumeAssessment} vacancy volume</span> : null}{row.research.freshness ? <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.5rem] uppercase text-muted">{row.research.freshness}</span> : null}</div><p className="mt-2 text-xs text-muted"><strong className="text-bone">Chosen angle:</strong> {m?.strategy?.angle || row.research.bestAngle}</p>{row.research.volumeReason ? <p className="mt-2 text-xs text-muted"><strong className="text-bone">Volume evidence:</strong> {row.research.volumeReason}</p> : null}{row.research.activeJobs?.length && !row.research.jobSignals?.length ? <div className="mt-2"><p className="font-mono text-[0.53rem] uppercase text-muted">Current jobs found</p><ul className="mt-1 space-y-1 text-xs text-bone/75">{row.research.activeJobs.map((job: string) => <li key={job}>• {job}</li>)}</ul></div> : null}{m?.strategy?.evidenceUsed?.length ? <div className="mt-2"><p className="font-mono text-[0.53rem] uppercase text-muted">Evidence actually used</p><ul className="mt-1 space-y-1 text-xs text-bone/75">{m.strategy.evidenceUsed.map((fact: string) => <li key={fact}>• {fact}</li>)}</ul></div> : null}<ResearchEvidenceLinks research={row.research} sources={row.research_sources || []} prospect={p} /></details> : null}
          {m && edit ? (
            <div className="mt-4 space-y-3 border-t border-edge pt-4">
              <div className="rounded-lg border border-edge bg-ink/40 px-3 py-2 font-mono text-[0.58rem] text-muted">
                From: <span className="text-bone">{sender?.senderName || "Your account"} &lt;{m.from_email || sender?.senderEmail || "connected mailbox"}&gt;</span> · To: {p.email}
              </div>
              <label className="block">
                <span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Subject</span>
                <input className={input} value={edit.subject} onChange={(e) => setMessage(m.id, { subject: e.target.value })} disabled={["sending", "sent"].includes(m.status) || Boolean(m.scheduled_at)} />
              </label>
              <label className="block">
                <span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Email</span>
                <textarea className={`${input} min-h-44 resize-y leading-6`} value={edit.body_text} onChange={(e) => setMessage(m.id, { body_text: e.target.value })} disabled={["sending", "sent"].includes(m.status) || Boolean(m.scheduled_at)} />
              </label>
              <OutreachVoiceNoteEditor message={m} script={edit.voice_script} disabled={Boolean(m.scheduled_at) || ctaRefreshRequired} generating={generatingVoiceMessageId === m.id} onScriptChange={(value) => setMessage(m.id, { voice_script: value })} onGenerate={() => void generateVoiceNote(m.id)} />
              {!["sending", "sent"].includes(m.status) && !m.scheduled_at ? (
                <div className="rounded-lg border border-sky/35 bg-sky/[0.06] p-3">
                  <p className="text-xs leading-5 text-bone/75">Test the real email appearance safely. The exact saved body and any ready voice note go only to <strong className="text-bone">{sender?.mailboxEmail || "your connected mailbox"}</strong>. The prospect, sequence, daily allowance and results stay untouched.</p>
                  {sender?.provider === "google" ? <p className="mt-2 text-xs leading-5 text-sky">Gmail keeps a rehearsal sent back to the same account under Sent or All Mail. It may not create a new Inbox message.</p> : null}
                  <button onClick={() => rehearse(m.id)} disabled={!!busy || ctaRefreshRequired} className={`${button} mt-2 w-full border-sky/45 text-sky sm:w-auto`}>{busy === `rehearse:${m.id}` ? "Sending rehearsal…" : "Send rehearsal to me"}</button>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button onClick={() => prepare(p.id)} disabled={!!busy || prepareStatus === "queued" || prepareStatus === "researching" || ctaBlocked || ["sending", "sent"].includes(m.status) || Boolean(m.scheduled_at)} className={button}>{prepareStatus === "queued" || prepareStatus === "researching" ? "Refreshing draft…" : "Refresh draft"}</button>
                <button onClick={() => saveDraft(m.id)} disabled={!!busy || ["sending", "sent"].includes(m.status) || Boolean(m.scheduled_at)} className={button}>Save changes</button>
                {m.status === "draft" || m.status === "failed" ? <button onClick={() => approveAndSend(m.id)} disabled={!!busy || ctaRefreshRequired} className={primary}>{busy === `approve-send:${m.id}` ? "Approving and queueing…" : "Approve & queue"}</button> : null}
                {m.status === "approved" && !m.scheduled_at ? <button onClick={() => send(m.id)} disabled={!!busy} className={primary}>{busy === `send:${m.id}` ? "Queueing…" : "Queue approved email"}</button> : null}
                {m.status === "approved" && m.scheduled_at ? <span className="self-center rounded-lg border border-sky bg-sky px-3 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-ink">✓ Queued for {formatActivityDate(m.scheduled_at)}</span> : null}
                {m.status === "sending" ? <span className="self-center rounded-lg border border-sky/60 bg-sky/10 px-3 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-sky">Sending now</span> : null}
                {m.status === "sent" ? <span className="self-center font-mono text-xs uppercase text-moss">✓ Sent safely</span> : null}
              </div>
              <p className="text-right text-xs text-muted">The email can be queued without a voice note. Any ready, unchanged voice note is included automatically. Optional CTA advice never blocks this button. Safety issues still do.</p>
            </div>
          ) : null}
        </article>; })}{!visibleQueue.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">{queue.length && queueCampaignFilterId !== OUTREACH_QUEUE_ALL_CAMPAIGNS ? <><p>No {queueCampaignFilterName} contacts are in today’s queue. This filter has not moved or removed anyone.</p><button type="button" onClick={() => setQueueCampaignFilterId(OUTREACH_QUEUE_ALL_CAMPAIGNS)} className={`${button} mt-3`}>Show all campaigns</button></> : "The morning queue can be selected and prepared automatically, or you can build it now. Nothing is approved or contacted automatically."}</div> : null}</div>
      </section> : null}

      {!loading && !tabLoading && tab === "prospects" ? <section data-sales-tour="prospect-pool">
        {focusedProspectId ? <div className="mb-3 flex flex-col gap-2 rounded-xl border border-sky/45 bg-sky/[0.07] p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[0.54rem] uppercase tracking-wider text-sky">Opened from linked activity</p><p className="mt-1 text-sm text-bone/80">Showing the exact prospect record. Its email, history and actions remain together here.</p></div><button type="button" onClick={clearProspectFocus} className={`${button} shrink-0`}>Back to all prospects</button></div> : null}
        {canStageImports ? <StagedOutreachImports team={team} onApplied={loadProspects} /> : null}
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
          <p className="mt-2 text-xs text-muted">Displaying {shownPage.length} of {shown.length} matching prospects, from {prospects.length} loaded. All campaigns is the combined priority list and every prospect keeps the campaign badge shown on its row. Fit scoring uses no AI tokens. Research only starts when you press Prepare draft.</p>
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
          <div className="divide-y divide-edge">{shownPage.map((prospect) => {
            const stage = outreachStage(prospect);
            const isBrainDirect = prospect.outreach?.latestMessage?.message_source === "brain_direct";
            const latestManualCall = prospect.source_metadata?.latest_manual_call;
            const mcpContextNotes = Array.isArray(prospect.source_metadata?.chatgpt_mcp?.context_notes)
              ? prospect.source_metadata.chatgpt_mcp.context_notes
              : [];
            const latestMcpContext = String(mcpContextNotes[mcpContextNotes.length - 1]?.text || "").trim();
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
            return <article id={`prospect-${prospect.id}`} key={prospect.id} style={{ contentVisibility: "auto" }} className={`grid gap-3 p-3 sm:grid-cols-[1.1fr_1.2fr_.65fr_.8fr_.85fr_.9fr_auto] sm:items-center ${focusedProspectId === prospect.id ? "bg-sky/[0.06] shadow-[inset_3px_0_0_rgba(126,190,211,0.75)]" : ""}`}>
              <CanonicalRecordLink href={outreachProspectHref(prospect)} onNavigate={(event) => openProspectFromThisPage(prospect, event)} className="block min-h-11 min-w-0 py-1" ariaLabel={`Open ${`${prospect.first_name || ""} ${prospect.last_name || ""}`.trim() || prospect.email || "prospect"}`}><h3 className="truncate font-display text-base text-bone">{prospect.first_name} {prospect.last_name}</h3><p className="truncate text-xs text-amber">{prospect.email}</p></CanonicalRecordLink>
              <div className="min-w-0"><CanonicalRecordLink href={outreachProspectHref(prospect)} onNavigate={(event) => openProspectFromThisPage(prospect, event)} className="block min-h-10 min-w-0 py-1" ariaLabel={`Open ${prospect.company_name || "prospect company"}`}><p className="truncate text-sm text-bone/85">{prospect.company_name}</p><p className="truncate text-xs text-muted">{prospect.job_title || "Role not saved"}</p></CanonicalRecordLink><div className="mt-1 flex flex-wrap gap-1">{isBrainDirect ? <span className="rounded-full border border-amber/45 bg-amber/10 px-2 py-0.5 font-mono text-[0.46rem] uppercase text-amber">Brain email</span> : null}{mcpContextNotes.length ? <span className="rounded-full border border-moss/45 bg-moss/10 px-2 py-0.5 font-mono text-[0.46rem] uppercase text-moss">ChatGPT context</span> : null}{membershipCampaigns.map((campaign) => <span key={campaign.id} className="rounded-full border border-sky/45 bg-sky/10 px-2 py-0.5 font-mono text-[0.46rem] uppercase text-sky">{campaign.name}</span>)}</div>{latestMcpContext ? <p className="mt-1 line-clamp-2 text-[0.66rem] leading-4 text-moss/85">{latestMcpContext}</p> : null}</div>
              <label><span className="mb-1 block font-mono text-[0.48rem] uppercase text-muted sm:hidden">Priority</span><select aria-label={`Priority for ${prospect.first_name} ${prospect.last_name}`} value={prospect.priority} onChange={(event) => updatePriority(prospect.id, event.target.value as Priority)} className="min-h-10 w-full rounded-lg border border-edge bg-ink px-2 text-xs text-bone"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
              <div><span className="mb-1 block font-mono text-[0.48rem] uppercase text-muted sm:hidden">Outreach</span><div className="flex flex-wrap gap-1"><span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[0.5rem] uppercase ${pill[stage.key] || "border-edge text-muted"}`}>{stage.key === "sent" || stage.key === "interested" ? "✓ " : ""}{stage.label}</span>{prospect.outreach?.sentCount && stage.key !== "sent" ? <span className="inline-flex rounded-full border border-moss/50 bg-moss/10 px-2 py-1 font-mono text-[0.5rem] uppercase text-moss">✓ {prospect.outreach.sentCount} sent</span> : null}</div>{prospect.outreach?.latestSentMessage?.subject ? <p className="mt-1 line-clamp-1 text-[0.68rem] text-muted">{prospect.outreach.latestSentMessage.subject}</p> : null}</div>
              <div><span className="mb-1 block font-mono text-[0.48rem] uppercase text-muted sm:hidden">Last activity</span><p className="text-xs text-bone/80">{formatActivityDate(lastActivity)}</p>{latestManualCall ? <p className="mt-1 line-clamp-2 text-[0.65rem] text-sky">☎ {latestManualCall.interpretation?.summary || latestManualCall.notePreview || "Manual call logged"}</p> : null}{prospect.next_action_at || prospect.outreach?.enrolment?.next_action_at ? <p className="mt-1 text-[0.65rem] text-amber">Next {formatActivityDate(prospect.next_action_at || prospect.outreach.enrolment.next_action_at)}</p> : null}</div>
              <div><span className="mb-1 block font-mono text-[0.48rem] uppercase text-muted sm:hidden">Owner</span>{canManageAssignments ? <select aria-label={`Owner for ${prospect.first_name} ${prospect.last_name}`} value={prospect.assigned_to_user_id || ""} onChange={(event) => updateAssignment(prospect.id, event.target.value)} className="min-h-10 w-full rounded-lg border border-edge bg-ink px-2 text-xs text-bone"><option value="">Unassigned</option>{team.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select> : <span className={`inline-flex rounded-full border px-2 py-1 font-mono text-[0.49rem] uppercase ${prospect.assigned_to_user_id === currentUser ? "border-moss/45 bg-moss/10 text-moss" : "border-edge text-muted"}`}>{prospect.assigned_to_user_id === currentUser ? "Mine" : assignedMember?.name || "Unassigned"}</span>}</div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {!isMine ? canClaim ? <button type="button" onClick={() => updateAssignment(prospect.id, currentUser)} disabled={!!busy} className={`${button} min-h-10 px-3`}>Claim</button> : <span className="inline-flex min-h-10 items-center rounded-lg border border-edge px-3 font-mono text-[0.5rem] uppercase text-muted">Assigned to {assignedMember?.name || "another user"}</span> : isBrainDirect && stage.key !== "suppressed" ? <button type="button" onClick={() => selectTab("activity")} className={`${primary} min-h-10 px-3`}>{pendingStatus === "sent" ? "View sent email" : pendingStatus === "sending" ? "View sending email" : "View queued email"}</button> : !campaignReady && stage.key !== "suppressed" ? <span className="inline-flex min-h-10 items-center rounded-lg border border-amber/45 bg-amber/10 px-3 font-mono text-[0.5rem] uppercase text-amber">{membershipCampaigns[0]?.name || "Campaign"} is not active</span> : canPrepare ? <button type="button" onClick={() => prepareFromProspects(prospect)} disabled={preparePending} className={`${primary} min-h-10 px-3`}>{prepareStatus === "adding" ? "Adding…" : prepareStatus === "researching" ? "Researching…" : prepareStatus === "queued" ? "Queued" : prepareStatus === "done" ? "Draft ready" : "Queue research"}</button> : ["draft", "approved"].includes(stage.key) ? <button type="button" onClick={() => openProspectWork(prospect)} disabled={!!busy} className={`${primary} min-h-10 px-3`}>{busy === `prospect-open:${prospect.id}` ? "Opening…" : pendingStatus === "approved" ? "Review to send" : "Review draft"}</button> : stage.key !== "suppressed" ? <button type="button" onClick={() => selectTab(openTab)} className={`${button} min-h-10 px-3`}>{openTab === "replies" ? "View reply" : "View history"}</button> : null}
                {isMine && stage.key !== "suppressed" ? (
                  <details className="relative">
                    <summary className={`${button} flex min-h-10 cursor-pointer list-none items-center px-3 [&::-webkit-details-marker]:hidden`}>
                      Actions ▾
                    </summary>
                    <div className="absolute right-0 z-30 mt-1 grid min-w-52 gap-1 rounded-lg border border-edge bg-panel p-2 shadow-xl">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          setRemovalProspectId("");
                          setFollowUpProspectId("");
                          setTaskProspectId("");
                          setManualCallProspectId(prospect.id);
                        }}
                        className="min-h-10 rounded-md px-3 text-left font-mono text-[0.55rem] uppercase text-sky hover:bg-sky/10"
                      >
                        ☎ Log call
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          setRemovalProspectId("");
                          setManualCallProspectId("");
                          setTaskProspectId("");
                          setFollowUpProspectId(prospect.id);
                        }}
                        className="min-h-10 rounded-md px-3 text-left font-mono text-[0.55rem] uppercase text-amber hover:bg-amber/10"
                      >
                        ◷ Log follow-up reminder
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          setRemovalProspectId("");
                          setManualCallProspectId("");
                          setFollowUpProspectId("");
                          setTaskProspectId(prospect.id);
                        }}
                        className="min-h-10 rounded-md px-3 text-left font-mono text-[0.55rem] uppercase text-moss hover:bg-moss/10"
                      >
                        ✓ Log a task
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          setManualCallProspectId("");
                          setFollowUpProspectId("");
                          setTaskProspectId("");
                          setRemovalProspectId((current) =>
                            current === prospect.id ? "" : prospect.id
                          );
                        }}
                        className="min-h-10 rounded-md px-3 text-left font-mono text-[0.55rem] uppercase text-rust hover:bg-rust/10"
                      >
                        Remove from outreach
                      </button>
                    </div>
                  </details>
                ) : null}
              </div>
              {removalProspectId === prospect.id ? <div className="rounded-lg border border-rust/40 bg-rust/[0.07] p-3 sm:col-span-7"><p className="text-sm text-bone/80">Keep the history, but stop future outreach to:</p><div className="mt-2 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={() => removeFromOutreach(prospect, "person")} disabled={!!busy} className={`${button} border-rust/50 text-rust`}>This person only</button>{prospect.company_domain ? <button type="button" onClick={() => removeFromOutreach(prospect, "company")} disabled={!!busy} className={`${button} border-rust/50 text-rust`}>Everyone at {prospect.company_name}</button> : null}<button type="button" onClick={() => setRemovalProspectId("")} className={button}>Cancel</button></div></div> : null}
              {manualCallProspectId === prospect.id ? <div className="sm:col-span-7"><ProspectManualCall prospect={prospect} campaignId={workCampaign?.id || savedCampaignId || null} onCancel={() => setManualCallProspectId("")} onSaved={async () => { setManualCallProspectId(""); setNotice("Call saved. The next action is already in your work queue while the concise read finishes in the background."); await Promise.all([loadProspects(), loadCore(), loadMetrics()]); }} /></div> : null}
              {followUpProspectId === prospect.id ? <div className="sm:col-span-7"><ProspectFollowUpReminder prospect={prospect} onCancel={() => setFollowUpProspectId("")} onSaved={async (result) => { setFollowUpProspectId(""); setNotice(result.rescheduled ? "Follow-up reminder updated. The new date and time now apply in Today, To-dos and Calls." : "Follow-up reminder saved. It is now in Today, To-dos and Calls."); }} /></div> : null}
              {taskProspectId === prospect.id ? (
                <div className="sm:col-span-7">
                  <TaskComposer
                    key={prospect.id}
                    initiallyOpen
                    fixedCompany={
                      prospect.crm_company_id
                        ? {
                            id: prospect.crm_company_id,
                            name: prospect.company_name || "Linked CRM client",
                          }
                        : null
                    }
                    prospect={{
                      id: prospect.id,
                      name: [prospect.first_name, prospect.last_name]
                        .filter(Boolean)
                        .join(" "),
                      companyName: prospect.company_name || null,
                    }}
                    defaultText={`Follow up with ${
                      [prospect.first_name, prospect.last_name]
                        .filter(Boolean)
                        .join(" ") ||
                      prospect.company_name ||
                      "this prospect"
                    }`}
                    onCancel={() => setTaskProspectId("")}
                    onSaved={async (result) => {
                      setTaskProspectId("");
                      setNotice(
                        result.created
                          ? prospect.crm_company_id && !result.task.company_id
                            ? "Task saved to your own list with the prospect context. The old CRM client link was not available to your account, so it was left safely unlinked."
                            : "Task saved. It is now in your own Today and To-dos lists."
                          : "That open task already existed, so it was not duplicated."
                      );
                    }}
                  />
                </div>
              ) : null}
              <details className="sm:col-span-7"><summary className="cursor-pointer font-mono text-[0.5rem] uppercase tracking-wider text-muted">Why this fit score · {prospect.recommendation?.score || 0}/100</summary><RecommendationCard recommendation={prospect.recommendation} compact /></details>
            </article>;
          })}{!shown.length ? <div className="p-8 text-center text-sm text-muted">No prospects match these filters.</div> : null}</div>
          {!focusedProspectId && shownPage.length < shown.length ? <div className="border-t border-edge p-3 text-center"><button type="button" onClick={() => setVisibleProspectLimit((current) => current + PROSPECT_PAGE_SIZE)} className={button}>Load next {Math.min(PROSPECT_PAGE_SIZE, shown.length - shownPage.length)} · {shown.length - shownPage.length} remaining</button></div> : null}
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-display text-lg text-bone">Your outreach progress</h2><p className="mt-1 text-sm text-muted">Email and SendPilot LinkedIn activity from this signed in salesperson, including replies and meetings. Opens are deliberately not tracked.</p></div><button type="button" onClick={() => loadMetrics()} className={button}>Refresh progress</button></div>
          <div className="mt-4 space-y-3">{funnel.map((item, index) => {
            const previous = index === 0 ? item.value : funnel[index - 1].value;
            const percentage = index === 0 ? 100 : previous ? Math.round((item.value / previous) * 100) : 0;
            return <button type="button" key={item.label} onClick={() => openOutreachMetric(item.tab, item.sectionId)} className="grid min-h-11 w-full grid-cols-[6.5rem_1fr_3rem] items-center gap-3 rounded-lg px-2 text-left transition hover:bg-ink/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70"><span className="font-mono text-[0.52rem] uppercase text-muted">{item.label} ↘</span><div className="h-2.5 overflow-hidden rounded-full bg-ink"><div className={`h-full rounded-full ${item.colour}`} style={{ width: `${item.value ? Math.max(4, percentage) : 0}%` }} /></div><strong className="text-right font-display text-lg text-bone">{item.value}</strong></button>;
          })}</div>
          <div className="mt-4 grid grid-cols-3 gap-2"><button type="button" onClick={() => openOutreachMetric("replies")} className="rounded-lg border border-edge bg-ink/35 p-3 text-left transition hover:border-amber/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70"><strong className="block font-display text-xl text-bone">{metrics.sent ? Math.round(((metrics.replies || 0) / metrics.sent) * 100) : 0}%</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Reply rate ↘</span></button><button type="button" onClick={() => openOutreachMetric("replies")} className="rounded-lg border border-edge bg-ink/35 p-3 text-left transition hover:border-amber/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70"><strong className="block font-display text-xl text-bone">{metrics.replies ? Math.round(((metrics.positiveReplies || 0) / metrics.replies) * 100) : 0}%</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Positive replies ↘</span></button><button type="button" onClick={() => openOutreachMetric("replies")} className="rounded-lg border border-edge bg-ink/35 p-3 text-left transition hover:border-amber/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70"><strong className="block font-display text-xl text-bone">{metrics.sent ? Math.round(((metrics.meetings || 0) / metrics.sent) * 100) : 0}%</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Meeting rate ↘</span></button></div>
        </div>

        <div className="rounded-xl border border-moss/35 bg-panel p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="font-display text-lg text-bone">SendPilot LinkedIn activity</h2><p className="mt-1 text-sm text-muted">Verified campaign handoffs, sent messages, connection milestones and status changes for your own SendPilot account.</p></div>
            <span className="rounded-full border border-moss/50 bg-moss/10 px-3 py-1 font-mono text-[0.52rem] uppercase text-moss">{metrics.linkedinSent || 0} actions sent</span>
          </div>
          <div className="mt-3 divide-y divide-edge">
            {sendPilotActivity.map((activity) => (
              <details key={activity.id} className="py-3">
                <summary className="grid cursor-pointer list-none gap-2 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center">
                  <CanonicalRecordLink href={outreachProspectHref(activity.prospect)} onNavigate={(event) => openProspectFromThisPage(activity.prospect, event)} stopPropagation className="block min-h-11 min-w-0 py-1" ariaLabel={`Open ${activity.prospect ? `${activity.prospect.first_name || ""} ${activity.prospect.last_name || ""}`.trim() : "prospect"}`}>
                    <strong className="block truncate text-sm text-bone">{activity.prospect ? `${activity.prospect.first_name || ""} ${activity.prospect.last_name || ""}`.trim() : "Unknown prospect"}</strong>
                    <span className="block truncate text-xs text-muted">{activity.prospect?.company_name || activity.prospect?.email || "Prospect record unavailable"}</span>
                  </CanonicalRecordLink>
                  <span className="font-mono text-[0.52rem] uppercase text-moss">{sendPilotActivityLabel(activity.kind, activity.metadata)}</span>
                  <span className="font-mono text-[0.5rem] uppercase text-muted">{formatActivityDate(activity.created_at)}</span>
                </summary>
                <div className="mt-2 rounded-lg border border-edge bg-ink/40 p-3 text-sm leading-6 text-bone/80">
                  {activity.metadata?.message ? <p className="whitespace-pre-wrap">{activity.metadata.message}</p> : activity.metadata?.note ? <p className="whitespace-pre-wrap">{activity.metadata.note}</p> : <p>{activity.metadata?.newStatus ? `SendPilot changed the lead from ${activity.metadata.previousStatus || "its previous state"} to ${activity.metadata.newStatus}.` : "The verified SendPilot event is stored in this prospect's CRM history."}</p>}
                  <p className="mt-2 font-mono text-[0.5rem] uppercase text-muted">Campaign {activity.metadata?.sendpilotCampaignName || activity.metadata?.sendpilotCampaignId || "SendPilot"}</p>
                </div>
              </details>
            ))}
            {!sendPilotActivity.length ? <p className="py-6 text-center text-sm text-muted">No SendPilot campaign activity has reached LiveCoach yet.</p> : null}
          </div>
        </div>

        <div className="rounded-xl border border-sky/35 bg-panel p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-display text-lg text-bone">Manual call activity</h2><p className="mt-1 text-sm text-muted">Calls logged by this signed in salesperson only. Notes stay attached to the assigned prospect and feed the next action.</p></div><span className="rounded-full border border-sky/45 bg-sky/10 px-3 py-1 font-mono text-[0.52rem] uppercase text-sky">{metrics.callsToday || 0} today</span></div>
          <div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-lg border border-edge bg-ink/35 p-3"><strong className="block font-display text-xl text-bone">{metrics.calls || 0}</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Calls logged</span></div><div className="rounded-lg border border-edge bg-ink/35 p-3"><strong className="block font-display text-xl text-bone">{metrics.calls ? Math.round(((metrics.connectedCalls || 0) / metrics.calls) * 100) : 0}%</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Connected</span></div><div className="rounded-lg border border-edge bg-ink/35 p-3"><strong className="block font-display text-xl text-bone">{metrics.callMeetings || 0}</strong><span className="font-mono text-[0.48rem] uppercase text-muted">Meetings booked</span></div></div>
          <div className="mt-3 divide-y divide-edge">{manualCalls.map((call) => <details key={call.id} className="py-3"><summary className="grid cursor-pointer list-none gap-2 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center"><CanonicalRecordLink href={outreachProspectHref(call.prospect)} onNavigate={(event) => openProspectFromThisPage(call.prospect, event)} stopPropagation className="block min-h-11 min-w-0 py-1" ariaLabel={`Open ${call.prospect ? `${call.prospect.first_name || ""} ${call.prospect.last_name || ""}`.trim() : "prospect"}`}><strong className="block truncate text-sm text-bone">{call.prospect ? `${call.prospect.first_name || ""} ${call.prospect.last_name || ""}`.trim() : "Unknown prospect"}</strong><span className="block truncate text-xs text-muted">{call.prospect?.company_name || call.prospect?.email || "Prospect record unavailable"}</span></CanonicalRecordLink><span className="font-mono text-[0.52rem] uppercase text-sky">{String(call.metadata?.outcome || "call").replace(/_/g, " ")}</span><span className="font-mono text-[0.5rem] uppercase text-muted">{formatActivityDate(call.created_at)}</span></summary><div className="mt-2 rounded-lg border border-edge bg-ink/40 p-3"><p className="text-sm leading-6 text-bone/80">{call.metadata?.note || "No call note was saved"}</p>{call.metadata?.humanNextAction ? <p className="mt-2 text-sm text-amber">Next · {call.metadata.humanNextAction}</p> : null}</div></details>)}{!manualCalls.length ? <p className="py-6 text-center text-sm text-muted">No manual calls logged yet.</p> : null}</div>
        </div>

        <div id="recent-email-activity" className="scroll-mt-24 rounded-xl border border-edge bg-panel p-4"><div className="flex items-end justify-between gap-3"><div><h2 className="font-display text-lg text-bone">Recent email activity</h2><p className="mt-1 text-sm text-muted">Approved, queued and sent emails from this signed in account, newest activity first.</p></div><span className="rounded-full border border-moss/50 bg-moss/10 px-2 py-1 font-mono text-[0.52rem] uppercase text-moss">{metrics.sent || 0} sent</span></div>
          <div className="mt-3 divide-y divide-edge">{sentHistory.map((message) => { const statusLabel = message.status === "sent" ? "Sent" : message.status === "sending" ? "Sending" : "Queued"; const statusTone = message.status === "sent" ? "border-moss/50 bg-moss/10 text-moss" : "border-sky/50 bg-sky/10 text-sky"; const activityAt = message.sent_at || message.scheduled_at || message.updated_at; return <details key={message.id} className="group py-3"><summary className="grid cursor-pointer list-none gap-2 sm:grid-cols-[1.1fr_1.2fr_auto] sm:items-center"><CanonicalRecordLink href={outreachProspectHref(message.prospect)} onNavigate={(event) => openProspectFromThisPage(message.prospect, event)} stopPropagation className="block min-h-11 min-w-0 py-1" ariaLabel={`Open ${message.prospect ? `${message.prospect.first_name || ""} ${message.prospect.last_name || ""}`.trim() : "prospect"}`}><strong className="block truncate text-sm text-bone">{message.prospect ? `${message.prospect.first_name || ""} ${message.prospect.last_name || ""}`.trim() : "Unknown prospect"}</strong><span className="block truncate text-xs text-muted">{message.prospect?.company_name || message.prospect?.email || "Prospect record unavailable"}</span></CanonicalRecordLink><span className="truncate text-sm text-bone/80">{message.subject}</span><div className="flex items-center justify-between gap-3 sm:justify-end"><span className="font-mono text-[0.5rem] uppercase text-muted">{formatActivityDate(activityAt)}</span><span className={`rounded-full border px-2 py-1 font-mono text-[0.49rem] uppercase ${statusTone}`}>{message.status === "sent" ? "✓ " : ""}{statusLabel}</span></div></summary><div className="mt-3 rounded-lg border border-edge bg-ink/40 p-3"><p className="font-mono text-[0.52rem] uppercase text-muted">From {message.from_email || "connected mailbox"} · {message.message_source === "brain_direct" ? "Brain email" : `step ${message.step_number}`}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-bone/80">{message.body_text}</p>{message.prospect?.last_reply_at ? <button type="button" onClick={() => selectTab("replies")} className={`${button} mt-3 border-moss/45 text-moss`}>View reply</button> : null}</div></details>; })}{!sentHistory.length ? <div className="py-8 text-center text-sm text-muted">No approved or sent prospect emails yet.</div> : null}</div>
        </div>
      </section> : null}

      {!loading && !tabLoading && tab === "campaign" ? <section data-sales-tour="campaign-setup" className="space-y-4">
        <div className="rounded-2xl border border-amber/40 bg-amber/[0.045] p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><p className="font-mono text-[0.55rem] uppercase tracking-wider text-amber">Campaign control</p><h2 className="mt-1 font-display text-xl text-bone">One campaign, three clear views</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted">A campaign defines who you are contacting and why. Its sequence defines the order of contact. Results show what happened. Open only the part you need.</p></div>
            <button type="button" onClick={startCampaignTutorial} className="min-h-11 shrink-0 rounded-lg border border-sage/50 bg-sage/10 px-4 font-mono text-[0.56rem] uppercase tracking-wider text-sage hover:bg-sage/15">? Campaign tutorial</button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-amber/35 bg-amber/[0.06] p-3"><span className="font-mono text-[0.5rem] uppercase text-amber">1 · Setup</span><p className="mt-1 text-sm text-bone/80">Audience, goal and offer</p></div>
            <div className="rounded-xl border border-sky/35 bg-sky/[0.06] p-3"><span className="font-mono text-[0.5rem] uppercase text-sky">2 · Sequence</span><p className="mt-1 text-sm text-bone/80">Email, phone and LinkedIn order</p></div>
            <div className="rounded-xl border border-moss/35 bg-moss/[0.06] p-3"><span className="font-mono text-[0.5rem] uppercase text-moss">3 · Results</span><p className="mt-1 text-sm text-bone/80">Contacts, replies and meetings</p></div>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-edge bg-panel px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-display text-lg text-bone">Your campaigns</h2><p className="mt-1 text-sm text-muted">Selected for new spaces means this campaign supplies only new contacts added to available Today spaces. It never moves contacts already queued. Active means the team can use it.</p></div>
          <span className="self-start rounded-full border border-edge px-3 py-1 font-mono text-[0.52rem] uppercase text-muted sm:self-auto">{orderedCampaigns.length} total</span>
        </div>

        {orderedCampaigns.map((campaign) => {
          const isCurrent = campaign.id === selectedCampaignId;
          const personalStats = campaignStats[campaign.id];
          const sequenceCount = campaign.sequence?.length || 0;
          const canEditThisCampaign =
            canEditCampaignContent &&
            (canManageCampaigns || campaign.visibility === "team");
          return <details id={`campaign-card-${campaign.id}`} key={campaign.id} open={expandedCampaignId === campaign.id} onToggle={(event) => {
            const isOpen = event.currentTarget.open;
            if (isOpen) setCampaignEditorView("setup");
            setExpandedCampaignId((current) => isOpen ? campaign.id : current === campaign.id ? "" : current);
          }} className={`group scroll-mt-24 overflow-hidden rounded-2xl border-2 shadow-[0_10px_30px_rgba(0,0,0,0.16)] ${campaignCardTone(campaign.status, isCurrent)}`}>
            <summary className="cursor-pointer list-none px-4 py-4 [&::-webkit-details-marker]:hidden sm:px-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-amber/40 bg-amber/10 font-display text-lg text-amber">↗</span>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[0.48rem] uppercase tracking-wider text-amber">Campaign</span>{isCurrent ? <span className="rounded-full border border-moss/50 bg-moss/10 px-2 py-0.5 font-mono text-[0.48rem] uppercase text-moss">Selected for new spaces</span> : null}<span className={`rounded-full border px-2 py-0.5 font-mono text-[0.48rem] uppercase ${campaignStatusTone[campaign.status] || campaignStatusTone.paused}`}>{campaign.status}</span></div><h3 className="mt-1 truncate font-display text-lg text-bone">{campaign.name}</h3><p className="mt-1 line-clamp-2 text-sm text-bone/70">{campaign.goal || "No goal saved yet"}</p></div>
                <span className="shrink-0 rounded-lg border border-edge px-3 py-2 font-mono text-[0.52rem] uppercase text-amber"><span className="group-open:hidden">Open</span><span className="hidden group-open:inline">Close</span> <span className="group-open:hidden">▾</span><span className="hidden group-open:inline">▴</span></span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:max-w-lg"><div className="rounded-lg border border-amber/25 bg-amber/[0.05] px-2 py-2"><strong className="block font-display text-lg text-bone">{campaign.daily_limit}</strong><span className="font-mono text-[0.43rem] uppercase text-muted">Daily maximum</span></div><div className="rounded-lg border border-sky/25 bg-sky/[0.05] px-2 py-2"><strong className="block font-display text-lg text-bone">{sequenceCount}</strong><span className="font-mono text-[0.43rem] uppercase text-muted">Sequence steps</span></div><div className="rounded-lg border border-moss/25 bg-moss/[0.05] px-2 py-2"><strong className="block font-display text-lg text-bone">{personalStats?.contacted || 0}</strong><span className="font-mono text-[0.43rem] uppercase text-muted">Contacted by you</span></div></div>
            </summary>

            <div className="border-t border-edge bg-ink/20 p-3 sm:p-4">
              <div role="tablist" aria-label={`${campaign.name} campaign sections`} className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-edge bg-ink/45 p-1.5">
                <button type="button" role="tab" aria-selected={campaignEditorView === "setup"} onClick={() => setCampaignEditorView("setup")} className={`min-h-11 rounded-lg border px-2 font-mono text-[0.52rem] uppercase transition ${campaignEditorView === "setup" ? "border-amber/55 bg-amber/15 text-amber" : "border-transparent text-muted hover:text-bone"}`}>1 Setup</button>
                <button type="button" role="tab" data-sales-tour="campaign-sequence" aria-selected={campaignEditorView === "sequence"} onClick={() => setCampaignEditorView("sequence")} className={`min-h-11 rounded-lg border px-2 font-mono text-[0.52rem] uppercase transition ${campaignEditorView === "sequence" ? "border-sky/55 bg-sky/15 text-sky" : "border-transparent text-muted hover:text-bone"}`}>2 Sequence · {sequenceCount}</button>
                <button type="button" role="tab" aria-selected={campaignEditorView === "results"} onClick={() => setCampaignEditorView("results")} className={`min-h-11 rounded-lg border px-2 font-mono text-[0.52rem] uppercase transition ${campaignEditorView === "results" ? "border-moss/55 bg-moss/15 text-moss" : "border-transparent text-muted hover:text-bone"}`}>3 Results</button>
              </div>

              {campaignEditorView === "setup" ? <div role="tabpanel" className="rounded-xl border border-amber/35 bg-amber/[0.035] p-4">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-mono text-[0.52rem] uppercase text-amber">Campaign setup</p><h4 className="mt-1 font-display text-lg text-bone">Who is this for and why should they care?</h4></div>{!canManageCampaigns && canEditThisCampaign ? <span className="self-start rounded-full border border-moss/45 bg-moss/10 px-3 py-1 font-mono text-[0.5rem] uppercase text-moss">Shared · copy editable</span> : !canEditThisCampaign ? <span className="self-start rounded-full border border-edge px-3 py-1 font-mono text-[0.5rem] uppercase text-muted">View only</span> : null}</div>
                <fieldset disabled={!canEditThisCampaign} className="grid gap-3">
                  <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Campaign goal</span><input className={input} value={campaign.goal} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, goal: e.target.value } : c))} /></label>
                  <div className="grid gap-3 lg:grid-cols-2"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Target audience</span><textarea className={`${input} min-h-28`} value={campaign.audience} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, audience: e.target.value } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Interviewa reason to respond</span><textarea className={`${input} min-h-28`} value={campaign.offer_angle} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, offer_angle: e.target.value } : c))} /></label></div>
                  <CampaignCtaEditor
                    value={campaign.cta_config}
                    disabled={!canEditThisCampaign}
                    onChange={(ctaConfig) =>
                      setCampaigns((all) =>
                        all.map((item) =>
                          item.id === campaign.id
                            ? { ...item, cta_config: ctaConfig }
                            : item
                        )
                      )
                    }
                  />
                </fieldset>
                <fieldset disabled={!canManageCampaigns} className="mt-3 grid gap-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Daily maximum</span><input type="number" min="1" max={OUTREACH_DAILY_HARD_LIMIT} className={input} value={Number.isNaN(campaign.daily_limit) ? "" : campaign.daily_limit} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, daily_limit: e.target.value === "" ? Number.NaN : clampOutreachDailyLimit(e.target.value, OUTREACH_DEFAULT_DAILY_LIMIT) } : c))} /></label><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Campaign status</span><select className={`${input} min-h-11`} value={campaign.status} onChange={(e) => setCampaigns((all) => all.map((c) => c.id === campaign.id ? { ...c, status: e.target.value } : c))}><option value="active">Active and available</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="completed">Completed</option></select></label></div>
                </fieldset>
                {!canManageCampaigns && canEditThisCampaign ? <p className="mt-3 rounded-lg border border-edge bg-ink/35 px-3 py-2 text-xs leading-5 text-muted">Your copy and sequence edits update this shared team campaign. Only Lee or a manager can change its status or daily maximum.</p> : null}
                {canEditThisCampaign ? <div className="mt-4 flex flex-col-reverse gap-2 border-t border-amber/20 pt-4 sm:flex-row sm:justify-end">{!isCurrent && campaign.status === "active" ? <button type="button" onClick={() => void selectActiveCampaign(campaign.id)} disabled={!!busy} className={button}>{busy === "select-campaign" ? "Switching…" : "Use for my Today queue"}</button> : null}<button type="button" onClick={() => saveCampaign(campaign)} disabled={!!busy} className={primary}>{busy === `campaign:${campaign.id}` ? "Saving…" : canManageCampaigns ? "Save campaign setup" : "Save shared campaign copy"}</button></div> : null}
              </div> : null}

              {campaignEditorView === "sequence" ? <div role="tabpanel"><CampaignSequenceBuilder
                campaignId={campaign.id}
                sequence={campaign.sequence || []}
                disabled={!canEditThisCampaign}
                saving={busy === `campaign:${campaign.id}`}
                onChange={(sequence) => setCampaigns((all) => all.map((item) => item.id === campaign.id ? { ...item, sequence } : item))}
                onSave={() => saveCampaign(campaign)}
              /></div> : null}

              {campaignEditorView === "results" ? <div role="tabpanel" className="rounded-xl border border-moss/35 bg-moss/[0.035] p-4"><div className="mb-3"><p className="font-mono text-[0.52rem] uppercase text-moss">Your results</p><h4 className="mt-1 font-display text-lg text-bone">What this campaign has produced for you</h4><p className="mt-1 text-sm text-muted">These figures are personal to your signed in account, even when the campaign is shared with the team.</p></div><CampaignResultStrip stats={personalStats} /></div> : null}
            </div>
          </details>;
        })}
        {!orderedCampaigns.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">No campaigns have been created yet. Ask the Brain to create one and it will begin with a single email step.</div> : null}

        {variants.length ? <details className="group rounded-xl border border-edge bg-panel">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden"><div><h2 className="font-display text-base text-bone">Advanced subject learning</h2><p className="mt-0.5 text-xs text-muted">Optional results across your sent outreach. This is not needed to set up a campaign.</p></div><span className="font-mono text-[0.55rem] uppercase text-muted"><span className="group-open:hidden">Open ▾</span><span className="hidden group-open:inline">Close ▴</span></span></summary>
          <div className="grid grid-cols-1 gap-2 border-t border-edge p-3 sm:grid-cols-2">{variants.map((row) => <div key={row.variant} className="rounded-xl border border-edge bg-ink/35 p-3"><p className="font-mono text-[0.56rem] uppercase text-muted">Subject variant {row.variant}</p><strong className="mt-1 block font-display text-xl text-bone">{row.replyRate}% replies</strong><span className="text-xs text-muted">{row.replies} replies from {row.sent} sent</span></div>)}</div>
        </details> : null}
      </section> : null}

      {!loading && !tabLoading && tab === "intelligence" && activeCampaign ? <section className="space-y-4">
        <fieldset disabled={!canEditActiveCampaignContent} className="contents">
        <div className="rounded-xl border border-amber/40 bg-amber/[0.06] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="font-display text-lg text-bone">Message intelligence</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Set the campaign writing tone and guardrails once. The salesperson&apos;s audio voice always comes from My Sales Setup and cannot be changed by a campaign. For every person, Terra must show the evidence, chosen angle and quality score before you approve the exact words.</p></div>{canEditActiveCampaignContent ? <button onClick={() => saveCampaign(activeCampaign)} disabled={!!busy} className={primary}>{busy === `campaign:${activeCampaign.id}` ? "Saving…" : "Save intelligence"}</button> : <span className="rounded-full border border-edge px-3 py-1 font-mono text-[0.52rem] uppercase text-muted">View only</span>}</div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Campaign writing tone</span><select className={input} value={activeCampaign.voice?.tone || "warm, commercially curious and concise"} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, voice: { ...(campaign.voice || {}), tone: e.target.value } } : campaign))}><option value="warm, commercially curious and concise">Warm, commercially curious</option><option value="direct, credible and concise">Direct and credible</option><option value="peer-to-peer founder, thoughtful and natural">Founder to founder</option><option value="consultative, challenging and evidence-led">Consultative challenger</option></select></label>
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Campaign writing style</span><input className={input} value={activeCampaign.voice?.style || "founder-to-founder, plain English and respectful"} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, voice: { ...(campaign.voice || {}), style: e.target.value } } : campaign))} /></label>
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Coaching rules, one per line</span><textarea className={`${input} min-h-36 leading-6`} value={(activeCampaign.voice?.rules || []).join("\n")} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, voice: { ...(campaign.voice || {}), rules: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) } } : campaign))} /></label>
            <label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Never say, one per line</span><textarea className={`${input} min-h-36 leading-6`} value={(activeCampaign.banned_phrases || []).join("\n")} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, banned_phrases: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean) } : campaign))} /></label>
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-panel p-4">
          <h2 className="font-display text-lg text-bone">Personal calendar handoff</h2><p className="mt-1 text-sm leading-6 text-muted">The campaign controls when a calendar can appear. The link itself always belongs to the salesperson doing the communication and the exact draft still needs approval.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_13rem]"><div className="rounded-lg border border-edge bg-ink/35 p-3"><span className="block font-mono text-[0.55rem] uppercase text-muted">Booking link source</span><p className="mt-2 text-sm leading-6 text-bone/80">Managed separately for each salesperson in My Sales Setup. Campaign and teammate links are never substituted.</p><Link href="/settings/sales-profile" className="mt-2 inline-block font-mono text-[0.54rem] uppercase tracking-wider text-amber underline underline-offset-4">Open My Sales Setup →</Link></div><label><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">When to include</span><select className={input} value={activeCampaign.booking_cta_mode || "interested_reply"} onChange={(e) => setCampaigns((all) => all.map((campaign) => campaign.id === activeCampaign.id ? { ...campaign, booking_cta_mode: e.target.value } : campaign))}><option value="interested_reply">Only after interest</option><option value="final_step">Final sequence email</option><option value="always">Every email</option><option value="never">Never</option></select></label></div>
          <p className="mt-3 rounded-lg border border-moss/35 bg-moss/[0.07] px-3 py-2 text-sm text-moss">When a prospect books, Calendar Sync links the meeting and seeds the call intent with the research, sent email and reply. Deal value and probability stay blank until a real conversation supports them.</p>
        </div>
        </fieldset>

        <div className="rounded-xl border border-edge bg-panel p-4"><h2 className="font-display text-lg text-bone">Conversion learning</h2><p className="mt-1 text-sm leading-6 text-muted">We measure positive replies and booked meetings, not vanity opens. A pattern is not fed back into new drafts until it has at least 10 sends and meaningful conversion evidence.</p>
          {learnings.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{learnings.map((learning) => <div key={learning.id} className="rounded-lg border border-edge bg-ink/30 p-3"><div className="flex items-center justify-between gap-2"><span className="font-mono text-[0.55rem] uppercase text-amber">{learning.dimension} · {learning.label}</span><span className={`rounded-full border px-2 py-0.5 font-mono text-[0.49rem] uppercase ${learning.status === "promoted" ? "border-moss/50 text-moss" : "border-edge text-muted"}`}>{learning.status}</span></div><p className="mt-2 text-sm leading-6 text-bone/80">{learning.insight}</p><p className="mt-1 text-xs text-muted">{learning.confidence} confidence</p></div>)}</div> : <div className="mt-3 rounded-lg border border-dashed border-edge p-5 text-center text-sm text-muted">No result is being called a “winner” yet. The system will wait for real sends, positive replies and meetings.</div>}
          {performance.length ? <div className="mt-4"><p className="mb-2 font-mono text-[0.54rem] uppercase text-muted">Early observations</p><div className="flex gap-2 overflow-x-auto pb-1">{performance.slice(0, 8).map((row) => <div key={`${row.dimension}:${row.label}`} className="min-w-52 rounded-lg border border-edge bg-ink/30 p-3"><span className="font-mono text-[0.52rem] uppercase text-muted">{row.dimension}</span><strong className="mt-1 block truncate text-sm text-bone">{row.label}</strong><p className="mt-1 text-xs text-muted">{row.positiveRate}% positive · {row.meetings} meetings · {row.sent} sent</p></div>)}</div></div> : null}
        </div>
      </section> : null}

      {!loading && !tabLoading && tab === "replies" ? <section data-sales-tour="reply-handover">
        <div className={`mb-4 flex flex-col gap-2 rounded-xl border bg-panel p-4 sm:flex-row sm:items-center sm:justify-between ${metrics.overdueReplies ? "border-rust/55" : "border-edge"}`}><div><h2 className="font-display text-lg text-bone">Reply inbox</h2><p className="mt-1 text-sm text-muted">Email and SendPilot replies meet here. Every reply stops the sequence. A queued reply stays open until the provider confirms delivery.</p>{metrics.overdueReplies ? <p className="mt-2 font-mono text-[0.55rem] uppercase text-rust">{metrics.overdueReplies} interested {metrics.overdueReplies === 1 ? "reply has" : "replies have"} waited over 2 hours</p> : null}</div><button onClick={checkReplies} disabled={!!busy} className={primary}>{busy === "replies" ? "Checking email…" : "Check email replies"}</button></div>
        {focusedReplyId ? <div className="mb-3 flex flex-col gap-2 rounded-xl border border-moss/50 bg-moss/[0.08] p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[0.52rem] uppercase tracking-wider text-moss">Reply to close</p><p className="mt-1 text-sm text-bone/80">The exact reply that brought you here is first. Read it, decide the next move and clear its alert without losing the history.</p></div><button type="button" onClick={() => { setFocusedReplyId(""); const url = new URL(window.location.href); url.searchParams.delete("reply"); window.history.replaceState({}, "", `${url.pathname}${url.search}`); }} className={button}>Show all replies</button></div> : null}
        <div className="space-y-2">{displayedReplies.map((reply) => { const draft = reply.bookingDraft; const edit = draft ? draftEdits[draft.id] || { subject: draft.subject, body_text: draft.body_text } : null; const handover = handoverReviews[reply.id]; const isFocusedReply = focusedReplyId === reply.id; const canScheduleFollowUp = ["later", "objection", "referral", "unclassified"].includes(reply.reply_category || "unclassified"); const deliveryBadge = replyDeliveryBadge(reply); return <article id={`reply-${reply.id}`} key={reply.id} className={`rounded-xl border bg-panel p-4 ${isFocusedReply ? "border-moss/65 shadow-[inset_3px_0_0_rgba(112,177,125,0.8)]" : reply.slaBreached || reply.deliveryState === "failed" ? "border-rust/50" : "border-edge"}`}>
          <div className="flex flex-wrap items-start justify-between gap-2"><CanonicalRecordLink href={outreachProspectHref(reply)} onNavigate={(event) => openProspectFromThisPage(reply, event)} className="block min-h-11 min-w-0 py-1" ariaLabel={`Open ${`${reply.first_name || ""} ${reply.last_name || ""}`.trim() || reply.email || "prospect"}`}><h3 className="font-display text-lg text-bone">{reply.first_name} {reply.last_name}</h3><p className="text-sm text-bone/80">{reply.company_name}</p></CanonicalRecordLink><div className="flex flex-wrap gap-2"><span className="rounded-full border border-sky/50 px-2 py-1 font-mono text-[0.55rem] uppercase text-sky">{reply.replyChannel === "linkedin" ? "LinkedIn" : "Email"}</span>{reply.campaign?.name ? <span className="rounded-full border border-edge px-2 py-1 font-mono text-[0.55rem] uppercase text-muted">{reply.campaign.name}</span> : null}<span className={`rounded-full border px-2 py-1 font-mono text-[0.55rem] uppercase ${replyCategoryTone(reply.reply_category)}`}>{replyCategoryLabel(reply.reply_category)}</span><span className={`rounded-full border px-2 py-1 font-mono text-[0.55rem] uppercase ${deliveryBadge.style}`}>{deliveryBadge.label}</span></div></div>
          <p className="mt-3 text-sm leading-6 text-bone/80">{reply.reply_summary}</p>
          {reply.deliveryState === "failed" ? <div className="mt-3 rounded-lg border border-rust/55 bg-rust/10 px-3 py-2 text-sm text-rust" role="alert">The connected mailbox did not accept this reply. {reply.deliveryError || "Review the saved draft and try again."}</div> : null}
          {reply.last_reply_text ? <div className="mt-3 rounded-lg border border-moss/35 bg-moss/[0.04] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-[0.5rem] uppercase tracking-wider text-moss">Their exact reply</p><span className="font-mono text-[0.48rem] uppercase text-muted">{formatActivityDate(reply.last_reply_at)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-bone/90">{reply.last_reply_text}</p></div> : <div className="mt-3 rounded-lg border border-amber/35 bg-amber/[0.04] p-3 text-sm text-amber">The reply was detected, but its exact text is unavailable. Check the connected mailbox before responding.</div>}
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
            <div className="rounded-lg border border-amber/35 bg-amber/[0.04] p-3"><p className="font-mono text-[0.5rem] uppercase tracking-wider text-amber">Recommended next move</p><p className="mt-2 text-sm leading-6 text-bone/85">{replyNextMove(reply)}</p></div>
            <details className="rounded-lg border border-edge bg-ink/35 p-3" open={isFocusedReply}><summary className="cursor-pointer font-mono text-[0.5rem] uppercase tracking-wider text-sky">Campaign and previous message</summary>{reply.campaign?.name ? <p className="mt-3 text-xs text-muted">Campaign · <span className="text-bone">{reply.campaign.name}</span></p> : null}{reply.previousMessage ? <div className="mt-2 text-sm leading-6 text-bone/80"><p className="font-medium text-bone">{reply.previousMessage.subject || "Previous outreach email"}</p><p className="mt-2 whitespace-pre-wrap">{reply.previousMessage.bodyText || "The previous message body is unavailable."}</p><p className="mt-2 font-mono text-[0.46rem] uppercase text-muted">Sent {formatActivityDate(reply.previousMessage.sentAt)}</p></div> : <p className="mt-3 text-xs leading-5 text-muted">The previous sent message is not stored in this mailbox history. The exact inbound reply remains above.</p>}</details>
          </div>
          {reply.reply_category === "interested" ? <div className="mt-3 rounded-lg border border-edge bg-ink/35 p-3">
            {reply.crmCompany ? <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[0.55rem] uppercase text-moss">✓ CRM handover complete</p><p className="mt-1 text-sm text-bone/80">Linked to {reply.crmCompany.name}{reply.bookedMeeting ? " · meeting booked" : " · sequence stopped"}</p></div><Link href={`/crm/${reply.crmCompany.id}`} className={`${button} inline-flex items-center justify-center`}>Open client</Link></div> : <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-[0.55rem] uppercase text-amber">CRM match needs approval</p><p className="mt-1 text-sm text-muted">No client record will be guessed or duplicated.</p></div><button onClick={() => reviewHandover(reply.id)} disabled={!!busy} className={button}>{busy === `handover-check:${reply.id}` ? "Checking…" : handover ? "Refresh choices" : "Review match"}</button></div>
              {handover ? <div className="mt-3 border-t border-edge pt-3"><p className="text-sm text-bone/80">{handover.reason}</p>{handover.candidates.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{handover.candidates.map((candidate) => <button key={candidate.id} onClick={() => completeHandover(reply.id, candidate.id)} disabled={!!busy} className={`${button} text-left normal-case tracking-normal`}><strong className="block text-bone">Link to {candidate.name}</strong><span className="text-xs text-muted">{candidate.domain || "No domain saved"}</span></button>)}</div> : null}<button onClick={() => completeHandover(reply.id)} disabled={!!busy} className={`${primary} mt-2 w-full sm:w-auto`}>{busy === `handover-save:${reply.id}` ? "Saving…" : `Create new ${reply.company_name} profile`}</button></div> : null}
            </div>}
          </div> : null}
          {reply.reply_category === "interested" && reply.replyChannel === "email" && !draft ? <button onClick={() => prepareBookingReply(reply.id)} disabled={!!busy} className={`${primary} mt-3 w-full sm:w-auto`}>{busy === `booking:${reply.id}` ? "Drafting…" : "Prepare booking reply"}</button> : null}
          {draft && edit ? <div className="mt-4 space-y-3 border-t border-edge pt-4"><div className="rounded-lg border border-moss/35 bg-moss/[0.06] px-3 py-2 text-sm text-moss">Review the exact words and calendar link. Once approved, the reply joins the same paced send queue.</div><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Reply subject</span><input className={input} value={edit.subject} onChange={(e) => setMessage(draft.id, { subject: e.target.value })} disabled={["sending", "sent"].includes(draft.status) || Boolean(draft.scheduled_at)} /></label><label className="block"><span className="mb-1 block font-mono text-[0.55rem] uppercase text-muted">Reply</span><textarea className={`${input} min-h-40 resize-y leading-6`} value={edit.body_text} onChange={(e) => setMessage(draft.id, { body_text: e.target.value })} disabled={["sending", "sent"].includes(draft.status) || Boolean(draft.scheduled_at)} /></label><div className="flex flex-col gap-2 sm:flex-row sm:justify-end"><button onClick={() => saveDraft(draft.id)} disabled={!!busy || ["sending", "sent"].includes(draft.status) || Boolean(draft.scheduled_at)} className={button}>Save changes</button>{draft.status === "draft" || draft.status === "failed" ? <button onClick={() => approveAndSend(draft.id)} disabled={!!busy} className={primary}>{busy === `approve-send:${draft.id}` ? "Approving and queueing…" : "Approve & queue reply"}</button> : null}{draft.status === "approved" && !draft.scheduled_at ? <button onClick={() => send(draft.id)} disabled={!!busy} className={primary}>{busy === `send:${draft.id}` ? "Queueing…" : "Queue booking reply"}</button> : null}{draft.status === "approved" && draft.scheduled_at ? <span className="self-center rounded-lg border border-sky bg-sky px-3 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-ink">✓ Queued for {formatActivityDate(draft.scheduled_at)}</span> : null}{draft.status === "sending" ? <span className="self-center rounded-lg border border-sky/60 bg-sky/10 px-3 py-2 font-mono text-[0.6rem] uppercase tracking-wider text-sky">Sending now</span> : null}{draft.status === "sent" ? <span className="self-center font-mono text-xs uppercase text-moss">✓ Booking link sent</span> : null}</div></div> : null}
          {followUpProspectId === reply.id ? <div className="mt-3"><ProspectFollowUpReminder prospect={reply} onCancel={() => setFollowUpProspectId("")} onSaved={async (result) => { setFollowUpProspectId(""); setNotice(result.rescheduled ? "Follow up rescheduled. The reply alert is cleared and the new time is in Today." : "Follow up saved. The reply alert is cleared and the new time is in Today."); await loadMetrics(); window.dispatchEvent(new CustomEvent("lc:notifications-updated")); }} /></div> : null}
          <div className="mt-3 flex flex-col gap-2 border-t border-edge pt-3 sm:flex-row sm:flex-wrap sm:items-center">
            {canScheduleFollowUp && followUpProspectId !== reply.id ? <button type="button" onClick={() => setFollowUpProspectId(reply.id)} disabled={!!busy} className={button}>Set dated follow up</button> : null}
            {reply.attentionOpen ? <button type="button" onClick={() => void markReplyHandled(reply.id)} disabled={!!busy} className={button}>{busy === `resolve-reply:${reply.id}` ? "Saving…" : reply.reply_category === "unsubscribe" || reply.reply_category === "irrelevant" ? "Mark reviewed and close" : "I handled this elsewhere"}</button> : null}
            <span className="text-xs leading-5 text-muted">The original reply and campaign history are never deleted.</span>
          </div>
          {reply.replyChannel === "linkedin" ? <a href={linkedinTarget(reply)} target="_blank" rel="noreferrer" className="mt-3 inline-block font-mono text-xs text-sky">Reply in LinkedIn or SendPilot ↗</a> : <a href={`mailto:${reply.email}`} className="mt-3 inline-block font-mono text-xs text-amber">Open in email ↗</a>}
        </article>; })}{!replies.length ? <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-muted">No replies detected yet.</div> : null}</div>
      </section> : null}

      {!loading && !tabLoading && tab === "safety" ? <section className="space-y-4"><OutreachReadiness /><div className="rounded-xl border border-moss/40 bg-moss/10 p-4"><h2 className="font-display text-lg text-bone">Safety rules are active</h2><ul className="mt-3 space-y-2 text-sm text-bone/80"><li>• Email requires approval of the exact draft. SendPilot requires confirmation of the exact person and mapped campaign.</li><li>• Every email uses the assigned sender’s own connected mailbox and verified sending address{sender?.senderEmail ? `, currently ${sender.senderEmail}` : ""}.</li><li>• Maximum {OUTREACH_DAILY_HARD_LIMIT} sends or SendPilot handoffs per sender per London calendar day.</li><li>• New CRM leads can enter outreach. Engaged, dormant and unclassified CRM relationships remain blocked.</li><li>• Replies and blocked addresses stop outreach.</li><li>• Exact email addresses are checked across the whole team, including duplicate CRM records.</li><li>• The same email address cannot be active in two campaigns or receive two messages on the same day.</li><li>• Different people at the same company remain available for outreach.</li><li>• A 30 day pause applies before moving a contacted email address to another campaign. Manager overrides require a saved reason.</li><li>• The database checks every send or handoff again immediately before it leaves.</li><li>• No tracking pixels or hidden open tracking.</li></ul></div><div className="rounded-xl border border-edge bg-panel p-4"><h2 className="font-display text-lg text-bone">Do not contact list</h2><p className="mt-1 text-sm text-muted">Block a person’s email or an entire company domain. You can restore access without losing history.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className={input} value={blockTarget} onChange={(e) => setBlockTarget(e.target.value)} placeholder="person@company.com or company.com" /><button onClick={addSuppression} disabled={!!busy || !blockTarget.trim()} className={primary}>Block</button></div><div className="mt-4 space-y-2">{suppressions.map((item) => <div key={item.target} className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink/30 px-3 py-2"><div className="min-w-0"><p className="truncate text-sm text-bone">{item.target}</p><p className="text-xs text-muted">{item.reason}</p></div><div className="flex items-center gap-2"><span className="font-mono text-[0.54rem] uppercase text-muted">{item.kind}</span><button type="button" onClick={() => restoreSuppression(item.target)} disabled={!!busy} className="min-h-9 rounded-lg border border-edge px-2 font-mono text-[0.5rem] uppercase text-bone hover:border-amber/60 hover:text-amber disabled:opacity-40">{busy === `restore:${item.target}` ? "Restoring…" : "Restore"}</button></div></div>)}</div></div></section> : null}
    </main>
  );
}
