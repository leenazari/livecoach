"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  crmFetch,
  type Company,
  type Contact,
  type Department,
  type FieldDefinition,
  type Workstream,
  type WorkstreamContact,
} from "@/lib/crm";
import CustomFieldEditor from "@/components/crm/CustomFieldEditor";
import AddFieldForm from "@/components/crm/AddFieldForm";
import ClientContext from "@/components/crm/ClientContext";
import NavMenu from "@/components/crm/NavMenu";
import MatrixRain from "@/components/MatrixRain";
import TaskList from "@/components/crm/TaskList";
import QuickClientUpdate, {
  type QuickUpdateItem,
} from "@/components/crm/QuickClientUpdate";
import StakeholderMap from "@/components/crm/StakeholderMap";
import RelationshipStructure from "@/components/crm/RelationshipStructure";
import {
  isRelationshipStageOption,
  RELATIONSHIP_STAGE_OPTIONS,
} from "@/lib/relationship-stages";
import { capitaliseSentenceStarts } from "@/lib/text";

const inputCls =
  "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60";
const labelCls =
  "mb-1 block font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted";

type TimelineItem = {
  id: string;
  type:
    | "call"
    | "email"
    | "commitment"
    | "task"
    | "opportunity"
    | "note"
    | "follow_up"
    | "meeting"
    | "outreach";
  at: string;
  title: string;
  detail?: string;
  status?: string;
  meta?: string;
  href?: string;
  future?: boolean;
};

type ClientAccess = {
  mode: "owner" | "shared_sales";
  shared: boolean;
  canManageSharing: boolean;
  assignedToUserId: string;
  canEdit: boolean;
  privateSourcesHidden: boolean;
};

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolveTaskId = searchParams.get("completeTask") || "";

  const [company, setCompany] = useState<Company | null>(null);
  const [access, setAccess] = useState<ClientAccess | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [workstreams, setWorkstreams] = useState<Workstream[]>([]);
  const [workstreamContacts, setWorkstreamContacts] = useState<
    WorkstreamContact[]
  >([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [opps, setOpps] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [timelineFilter, setTimelineFilter] = useState("all");
  const [copiedId, setCopiedId] = useState<string>("");
  const [attrs, setAttrs] = useState<Record<string, any>>({});
  const [core, setCore] = useState({
    name: "",
    sector: "",
    stage: "",
    website: "",
    domain: "",
    notes: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [synthing, setSynthing] = useState(false);
  const [err, setErr] = useState("");
  const [savedAt, setSavedAt] = useState("");
  // Which data tab is showing below the always-visible AI intelligence.
  const [tab, setTab] = useState<
    "timeline" | "details" | "notes" | "calls" | "pipeline"
  >(
    "timeline"
  );

  // New-contact form.
  const [cName, setCName] = useState("");
  const [cRole, setCRole] = useState("");
  const [cEmail, setCEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      // Field seeding is idempotent, but it used to hold every client request
      // behind an extra round trip. Start independent client data immediately;
      // only the field-definition read needs to wait for the seed.
      const fieldsPromise = crmFetch(`/api/crm/fields/seed`, { method: "POST" })
        .catch(() => {})
        .then(() =>
          crmFetch<{ fields: FieldDefinition[] }>(
            `/api/crm/fields?entity=company`
          )
        );
      const [companyResponse, { fields }, { calls }, pipeline, timelineData] =
        await Promise.all([
        crmFetch<
          | {
              company: Company;
              contacts: Contact[];
              departments: Department[];
              workstreams: Workstream[];
              workstreamContacts: WorkstreamContact[];
              access: ClientAccess;
            }
          | { redirectTo: string }
        >(
          `/api/crm/companies/${id}`
        ),
        fieldsPromise,
        crmFetch<{ calls: any[] }>(`/api/crm/companies/${id}/calls`).catch(
          () => ({ calls: [] as any[] })
        ),
        crmFetch<{ opportunities: any[]; followUps: any[] }>(
          `/api/crm/companies/${id}/pipeline`
        ).catch(() => ({ opportunities: [] as any[], followUps: [] as any[] })),
        crmFetch<{ items: TimelineItem[] }>(
          `/api/crm/companies/${id}/timeline`
        ).catch(() => ({ items: [] as TimelineItem[] })),
      ]);
      if ("redirectTo" in companyResponse) {
        router.replace(`/crm/${companyResponse.redirectTo}`);
        return;
      }
      const {
        company,
        contacts,
        departments,
        workstreams,
        workstreamContacts,
        access,
      } = companyResponse;
      setCompany(company);
      setAccess(access);
      setContacts(contacts);
      setDepartments(departments || []);
      setWorkstreams(workstreams || []);
      setWorkstreamContacts(workstreamContacts || []);
      setFields(fields);
      setCalls(calls || []);
      setOpps(pipeline.opportunities || []);
      setFollowUps(pipeline.followUps || []);
      setTimeline(timelineData.items || []);
      setAttrs(company.attributes || {});
      setCore({
        name: company.name || "",
        sector: company.sector || "",
        stage: company.stage || "",
        website: company.website || "",
        domain: company.domain || "",
        notes: company.notes || "",
      });
    } catch (e: any) {
      setErr(e.message || "could not load this company");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const { company } = await crmFetch<{ company: Company }>(
        `/api/crm/companies/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...core, attributes: attrs }),
        }
      );
      setCompany(company);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e: any) {
      setErr(e.message || "could not save");
    } finally {
      setSaving(false);
    }
  };

  // Build this client's intelligence (brief, playbook, next steps,
  // opportunities) from everything we know - calls, notes, pulled emails.
  const synth = async () => {
    setSynthing(true);
    setErr("");
    try {
      await crmFetch(`/api/crm/companies/${id}/synthesize`, { method: "POST" });
      await load();
    } catch (e: any) {
      setErr(e.message || "could not build from context");
    } finally {
      setSynthing(false);
    }
  };

  const addContact = async () => {
    if (!cName.trim()) return;
    try {
      const { contact } = await crmFetch<{ contact: Contact }>(
        `/api/crm/contacts`,
        {
          method: "POST",
          body: JSON.stringify({
            company_id: id,
            name: cName.trim(),
            role: cRole.trim() || undefined,
            email: cEmail.trim() || undefined,
          }),
        }
      );
      setContacts((prev) => [...prev, contact]);
      setCName("");
      setCRole("");
      setCEmail("");
    } catch (e: any) {
      setErr(e.message || "could not add the contact");
    }
  };

  const deleteContact = async (contactId: string) => {
    try {
      await crmFetch(`/api/crm/contacts/${contactId}`, { method: "DELETE" });
      setContacts((prev) => prev.filter((c) => c.id !== contactId));
    } catch (e: any) {
      setErr(e.message || "could not delete the contact");
    }
  };

  // Break a contact out into their own client record (they stay here too), then
  // jump to the new record so you can set them up (e.g. as an investor).
  const breakOutContact = async (contactId: string) => {
    try {
      const { companyId } = await crmFetch<{ companyId: string }>(
        `/api/crm/contacts/${contactId}`,
        { method: "POST" }
      );
      if (companyId) window.location.href = `/crm/${companyId}`;
    } catch (e: any) {
      setErr(e.message || "could not break out the contact");
    }
  };

  const deleteCompany = async () => {
    if (!confirm("Delete this company and all its contacts?")) return;
    try {
      await crmFetch(`/api/crm/companies/${id}`, { method: "DELETE" });
      router.push("/crm");
    } catch (e: any) {
      setErr(e.message || "could not delete the company");
    }
  };

  const setOppStatus = async (oppId: string, status: string) => {
    const previous = opps;
    setOpps((prev) =>
      prev.map((o) => (o.id === oppId ? { ...o, status } : o))
    );
    try {
      const { opportunity } = await crmFetch<{
        opportunity: { id: string; status: string };
      }>(`/api/crm/opportunities/${oppId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (opportunity?.status !== status) throw new Error("status not confirmed");
      setOpps((prev) =>
        prev.map((opportunityRow) =>
          opportunityRow.id === oppId
            ? { ...opportunityRow, ...opportunity }
            : opportunityRow
        )
      );
    } catch (e: any) {
      setOpps(previous);
      setErr(e?.message || "opportunity change did not save");
    }
  };

  const setFollowUpStatus = async (fuId: string, status: string) => {
    const previous = followUps;
    setFollowUps((prev) =>
      prev.map((f) => (f.id === fuId ? { ...f, status } : f))
    );
    try {
      const { followUp } = await crmFetch<{
        followUp: { id: string; status: string };
      }>(`/api/crm/follow-ups/${fuId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (followUp?.status !== status) throw new Error("status not confirmed");
      setFollowUps((prev) =>
        prev.map((followUpRow) =>
          followUpRow.id === fuId ? { ...followUpRow, ...followUp } : followUpRow
        )
      );
    } catch (e: any) {
      setFollowUps(previous);
      setErr(e?.message || "follow-up change did not save");
    }
  };

  const copyDraft = async (fu: any) => {
    const text = `Subject: ${fu.draft_subject || ""}\n\n${fu.draft_body || ""}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(fu.id);
      setTimeout(() => setCopiedId(""), 1500);
    } catch {
      /* clipboard blocked - ignore */
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-[1000px] px-5 py-10">
        <MatrixRain size="panel" messages={["loading client profile", "linking the latest activity"]} />
      </main>
    );
  }

  if (!company) {
    return (
      <main className="mx-auto max-w-[1000px] px-5 py-10">
        <p className="font-mono text-sm text-rust">{err || "not found"}</p>
        <Link
          href="/crm/board?tab=clients"
          className="mt-3 inline-block font-mono text-[0.66rem] uppercase tracking-wider text-amber"
        >
          ◂ all companies
        </Link>
      </main>
    );
  }

  // Stats for the clickable top row.
  const focusScores = calls.flatMap((c: any) =>
    Array.isArray(c?.summary?.competencies)
      ? c.summary.competencies
          .map((x: any) => Number(x.score))
          .filter((n: number) => !Number.isNaN(n))
      : []
  );
  const avgFocus = focusScores.length
    ? focusScores.reduce((a: number, b: number) => a + b, 0) / focusScores.length
    : null;

  // Focus scores over time: calls come newest-first, so the first focus we meet
  // is the main one from the latest call (newest at top), and each focus's
  // entries run newest -> oldest.
  const focusOrder: string[] = [];
  const focusData: Record<string, { date: string; score: number }[]> = {};
  calls.forEach((c: any) => {
    const date = c?.created_at
      ? new Date(c.created_at).toLocaleDateString()
      : "";
    (Array.isArray(c?.summary?.competencies) ? c.summary.competencies : []).forEach(
      (comp: any) => {
        const name = String(comp?.name || "").trim();
        const score = Number(comp?.score);
        if (!name || Number.isNaN(score)) return;
        if (!focusData[name]) {
          focusData[name] = [];
          focusOrder.push(name);
        }
        focusData[name].push({ date, score });
      }
    );
  });
  const priorityOpportunity = opps.find(
    (o: any) =>
      o.status === "open" && (o.opportunity_type || "revenue") === "revenue"
  );
  const commercialMemory =
    company.commercial_memory && typeof company.commercial_memory === "object"
      ? (company.commercial_memory as any)
      : {};
  const memoryAction = Array.isArray(commercialMemory.openActions)
    ? commercialMemory.openActions.find((action: any) => action?.text)
    : null;
  const playbookAction = Array.isArray((company.profile as any)?.playbook)
    ? (company.profile as any).playbook.find(
        (action: any) => typeof action === "string" && action.trim()
      )
    : "";
  const priorityAction = String(
    priorityOpportunity?.next_action || memoryAction?.text || playbookAction || ""
  ).trim();
  const priorityDueAt =
    priorityOpportunity?.next_action_due_at || memoryAction?.dueAt || null;
  const priorityDueMs = priorityDueAt
    ? new Date(priorityDueAt).getTime()
    : null;
  const priorityOverdue =
    priorityDueMs != null && Number.isFinite(priorityDueMs) && priorityDueMs < Date.now();
  const primaryContact =
    contacts.find(
      (contact) => contact.attributes?.stakeholderRole === "decision_maker"
    ) ||
    contacts.find(
      (contact) => contact.attributes?.stakeholderRole === "champion"
    ) ||
    contacts.find((contact) => contact.email) ||
    contacts[0] ||
    null;
  const nextMeeting = timeline.find(
    (item) => item.future && item.type === "meeting"
  );
  const latestActivity = timeline.find((item) => !item.future) || null;
  const lastCallMemory =
    commercialMemory.lastCall && typeof commercialMemory.lastCall === "object"
      ? commercialMemory.lastCall
      : {};
  const buyingSignals = Array.isArray(lastCallMemory.buyingSignals)
    ? lastCallMemory.buyingSignals.slice(0, 3)
    : [];
  const blockers = Array.isArray(lastCallMemory.objections)
    ? lastCallMemory.objections.slice(0, 3)
    : [];
  const primaryBuyingRole = String(
    primaryContact?.attributes?.stakeholderRole || ""
  ).replace(/_/g, " ");
  const gbp = (n: number) =>
    `£${Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const scrollToId = (anchorId: string) => {
    if (typeof document !== "undefined") {
      document
        .getElementById(anchorId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  // Switch the data tab and scroll the tab strip into view (used by the stats).
  const goTab = (
    t: "timeline" | "details" | "notes" | "calls" | "pipeline"
  ) => {
    setTab(t);
    scrollToId("sec-tabs");
  };
  const addQuickUpdateToTimeline = (item: QuickUpdateItem) => {
    const update: TimelineItem = {
      id: `context:${item.id}`,
      type: "note",
      at: item.created_at,
      title: item.title || "Client update",
      detail: item.content || undefined,
      meta: "logged now",
    };
    setTimeline((current) => {
      const firstPast = current.findIndex((timelineItem) => !timelineItem.future);
      if (firstPast < 0) return [...current, update];
      return [
        ...current.slice(0, firstPast),
        update,
        ...current.slice(firstPast),
      ];
    });
  };
  const updateContact = (saved: Contact) => {
    setContacts((current) =>
      current.map((contact) => (contact.id === saved.id ? saved : contact))
    );
  };

  const statCls =
    "cursor-pointer rounded-lg border border-edge bg-ink/40 px-3 py-2.5 text-left transition hover:border-amber/50";

  return (
    <main className="relative z-10 mx-auto max-w-[1000px] px-3 py-5 sm:px-5 sm:py-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3 sm:mb-6">
        <div className="flex items-baseline gap-3">
          <Link
            href="/crm/board?tab=clients"
            className="font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:text-amber"
          >
            ◂ clients
          </Link>
          <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
            {company.name}
          </h1>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {savedAt && (
            <span className="font-mono text-[0.58rem] uppercase tracking-wider text-sage">
              saved {savedAt}
            </span>
          )}
          {!company.is_confidential ? (
            <Link
              href={`/crm/chat?shareType=company&shareId=${id}&shareLabel=${encodeURIComponent(
                company.name
              )}`}
              title="Share a safe client card into a private team conversation. Calls, notes, transcripts, mailbox context and Brain memory stay private."
              className="min-h-10 flex-1 rounded-full border border-sky/55 bg-sky/10 px-3 py-2 text-center font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/20 sm:flex-none sm:px-4 sm:text-[0.62rem]"
            >
              ◫ share in chat
            </Link>
          ) : null}
          {access?.canEdit ? (
            <>
              <Link
                href={`/crm/log-call?company=${id}&companyName=${encodeURIComponent(
                  company.name
                )}`}
                title="Log a call you already had (no prep, no plan) - just record what happened and it lands in this client's history"
                className="min-h-10 flex-1 rounded-full border border-sage/60 bg-sage/15 px-3 py-2 text-center font-mono text-[0.58rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 sm:flex-none sm:px-4 sm:text-[0.62rem]"
              >
                ＋ log a call
              </Link>
              <Link
                href={`/call?company=${id}&companyName=${encodeURIComponent(
                  company.name
                )}`}
                title="Open the call workspace to review intent, research, build focus and start the next call"
                className="min-h-10 flex-1 rounded-full border border-amber/60 bg-amber/15 px-3 py-2 text-center font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 sm:flex-none sm:px-4 sm:text-[0.62rem]"
              >
                ✶ prepare next call
              </Link>
            </>
          ) : null}
          {access?.mode !== "shared_sales" ? (
            <button
              type="button"
              onClick={synth}
              disabled={synthing}
              title="Build this client's summary, playbook, next steps and opportunities from everything we know (calls, notes, emails)"
              className="min-h-10 flex-1 rounded-full border border-sky/60 bg-sky/15 px-3 py-2 font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/25 disabled:opacity-40 sm:flex-none sm:px-4 sm:text-[0.62rem]"
            >
              {synthing ? "building…" : "↻ build from context"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={saving || !access?.canEdit}
            className="min-h-10 flex-1 rounded-full border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40 sm:flex-none sm:px-5 sm:text-[0.62rem]"
          >
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </header>

      {err && <p className="mb-3 font-mono text-[0.66rem] text-rust">{err}</p>}

      {access?.mode === "shared_sales" ? (
        <section className="mb-3 rounded-xl border border-sage/45 bg-sage/[0.07] p-4">
          <p className="font-mono text-[0.58rem] uppercase tracking-wider text-sage">Shared sales record</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {access.canEdit
              ? "This client is assigned to you. You can work with the client basics and team opportunity."
              : "This client belongs to another salesperson, so it is view only for you."} The original owner's calls, transcripts, mailbox context, notes, documents and Brain memory are not available to this account.
          </p>
        </section>
      ) : null}

      <section
        className={`mb-3 rounded-xl border p-4 ${
          priorityOverdue
            ? "border-rust/55 bg-rust/[0.08]"
            : "border-amber/50 bg-amber/[0.07]"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p
              className={`font-mono text-[0.58rem] uppercase tracking-[0.2em] ${
                priorityOverdue ? "text-rust" : "text-amber"
              }`}
            >
              {priorityOverdue ? "▲" : "→"} Priority now
            </p>
            <p className="mt-1.5 font-sans text-[0.98rem] font-medium leading-snug text-bone">
              {priorityAction ||
                "Confirm the next relationship or commercial commitment."}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {priorityDueAt ? (
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider ${
                    priorityOverdue
                      ? "border-rust/45 bg-rust/10 text-rust"
                      : "border-edge text-muted"
                  }`}
                >
                  {priorityOverdue ? "overdue · " : "due · "}
                  {new Date(priorityDueAt).toLocaleString("en-GB", {
                    timeZone: "Europe/London",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </span>
              ) : null}
              {priorityOpportunity ? (
                <span className="rounded-full border border-sage/35 bg-sage/[0.07] px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider text-sage">
                  {priorityOpportunity.pipeline_stage || "discovery"} · {Number(priorityOpportunity.probability) || 0}%
                </span>
              ) : null}
            </div>
          </div>
          {access?.canEdit ? <div className="flex w-full gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => scrollToId("sec-quick-update")}
              className="min-h-10 flex-1 rounded-full border border-sky/45 bg-sky/[0.08] px-3 py-1.5 font-mono text-[0.52rem] uppercase tracking-wider text-sky transition hover:bg-sky/15 sm:flex-none"
            >
              Log update ↓
            </button>
            <button
              type="button"
              onClick={() => scrollToId("sec-tasks")}
              className="min-h-10 flex-1 rounded-full border border-amber/50 bg-amber/10 px-3 py-1.5 font-mono text-[0.52rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 sm:flex-none"
            >
              Next steps ↓
            </button>
          </div> : null}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-edge/50 pt-3 lg:grid-cols-5">
          <button type="button" onClick={() => goTab("details")} className={statCls}>
            <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">Relationship</p>
            <p className="mt-0.5 truncate font-sans text-[0.76rem] text-bone/85">
              {company.stage || "Stage not set"}
            </p>
          </button>
          <button type="button" onClick={() => goTab("details")} className={statCls}>
            <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">Key stakeholder</p>
            <p className="mt-0.5 truncate font-sans text-[0.76rem] text-bone/85">
              {primaryContact?.name || "Not recorded"}
            </p>
            {primaryBuyingRole || primaryContact?.role ? (
              <p className="truncate font-sans text-[0.64rem] capitalize text-muted">
                {primaryBuyingRole || primaryContact?.role}
              </p>
            ) : null}
          </button>
          <button type="button" onClick={() => goTab("pipeline")} className={statCls}>
            <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">Deal position</p>
            <p className="mt-0.5 truncate font-sans text-[0.76rem] text-bone/85">
              {priorityOpportunity
                ? `${String(priorityOpportunity.pipeline_stage || "discovery").replace(/_/g, " ")} · ${Number(priorityOpportunity.probability) || 0}%`
                : "No revenue deal yet"}
            </p>
            {priorityOpportunity?.value ? (
              <p className="truncate font-sans text-[0.64rem] text-sage">
                {gbp(Number(priorityOpportunity.value))}
              </p>
            ) : null}
          </button>
          <button type="button" onClick={() => goTab("timeline")} className={statCls}>
            <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">Latest activity</p>
            <p className="mt-0.5 truncate font-sans text-[0.76rem] text-bone/85">
              {latestActivity?.title || "No activity recorded"}
            </p>
            {latestActivity?.at ? (
              <p className="truncate font-sans text-[0.64rem] text-muted">
                {new Date(latestActivity.at).toLocaleString("en-GB", {
                    timeZone: "Europe/London",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })
                }
              </p>
            ) : null}
          </button>
          <button type="button" onClick={() => goTab("timeline")} className={statCls}>
            <p className="font-mono text-[0.48rem] uppercase tracking-wider text-muted">Next meeting</p>
            <p className={`mt-0.5 truncate font-sans text-[0.76rem] ${nextMeeting ? "text-sage" : "text-muted"}`}>
              {nextMeeting
                ? new Date(nextMeeting.at).toLocaleString("en-GB", {
                    timeZone: "Europe/London",
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })
                : "Not booked"}
            </p>
          </button>
        </div>
      </section>

      {access?.canEdit ? <div id="sec-quick-update" className="scroll-mt-4">
        <QuickClientUpdate
          companyId={id}
          companyName={company.name}
          onSaved={addQuickUpdateToTimeline}
          onApplied={load}
          initialIntelligence={
            (company.profile as any)?.activity_intelligence?.latest || null
          }
          sharedSalesAccess={access?.mode === "shared_sales"}
          resolveTaskId={resolveTaskId}
          onTaskResolved={() =>
            router.replace(`/crm/${id}#sec-quick-update`, { scroll: false })
          }
        />
      </div> : null}

      {/* Actionable work stays above the longer intelligence and history. */}
      {access?.canEdit ? <div id="sec-tasks" className="mb-3 rounded-xl border border-sage/35 bg-sage/[0.045] p-4">
        <p className="mb-2.5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sage">
          {"→"} Next steps{" "}
          <span className="text-muted">- what to do for {company.name}</span>
        </p>
        <TaskList
          companyId={id}
          emptyText="No next steps yet. Log an update above or build from context."
        />
      </div> : null}

      {buyingSignals.length || blockers.length ? (
        <section className="mb-3 grid gap-2 sm:grid-cols-2">
          {buyingSignals.length ? (
            <div className="rounded-xl border border-sage/35 bg-sage/[0.05] p-3.5">
              <p className="font-mono text-[0.54rem] uppercase tracking-[0.16em] text-sage">◆ Buying signals</p>
              <ul className="mt-1.5 space-y-1">
                {buyingSignals.map((signal: string, index: number) => (
                  <li key={`${signal}:${index}`} className="font-sans text-[0.76rem] leading-snug text-bone/80">• {capitaliseSentenceStarts(signal)}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {blockers.length ? (
            <div className="rounded-xl border border-rust/35 bg-rust/[0.05] p-3.5">
              <p className="font-mono text-[0.54rem] uppercase tracking-[0.16em] text-rust">▲ Blockers to resolve</p>
              <ul className="mt-1.5 space-y-1">
                {blockers.map((blocker: string, index: number) => (
                  <li key={`${blocker}:${index}`} className="font-sans text-[0.76rem] leading-snug text-bone/80">• {capitaliseSentenceStarts(blocker)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {access?.mode !== "shared_sales" ? (
        <>
          <RelationshipStructure
            companyId={id}
            contacts={contacts}
            departments={departments}
            workstreams={workstreams}
            links={workstreamContacts}
            onContactSaved={updateContact}
            onLinksSaved={setWorkstreamContacts}
            onStructureSaved={load}
          />

          <StakeholderMap contacts={contacts} onSaved={updateContact} />
        </>
      ) : null}

      {(() => {
        const raw = (company.profile as any)?.brief;
        const items: string[] = Array.isArray(raw)
          ? raw.filter((b: any) => typeof b === "string" && b.trim())
          : [];
        const para =
          !items.length && typeof raw === "string" && raw.trim()
            ? raw.trim()
            : "";
        if (!items.length && !para) return null;
        return (
          <div className="mb-3 rounded-xl border border-sky/40 bg-sky/[0.06] p-4">
            <p className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
              {"◆"} What we know{" "}
              <span className="text-muted">- learned from your calls and context</span>
            </p>
            {items.length ? (
              <ul className="flex flex-col gap-1.5">
                {items.map((b, i) => (
                  <li
                    key={i}
                    className="flex gap-2.5 font-sans text-sm leading-snug text-bone/85"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-sky/70" />
                    <span>{capitaliseSentenceStarts(b)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-sans text-sm leading-relaxed text-bone/85">
                {capitaliseSentenceStarts(para)}
              </p>
            )}
          </div>
        );
      })()}

      {/* PLAYBOOK - the main play to move this client toward the outcome you
          want. AI-built from the history, refreshed after each call. */}
      {company.profile &&
        typeof company.profile === "object" &&
        Array.isArray((company.profile as any).playbook) &&
        (company.profile as any).playbook.length > 0 && (
          <div className="mb-5 rounded-xl border border-amber/40 bg-amber/[0.06] p-4">
            <p className="mb-2.5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
              {"▸"} Playbook{" "}
              <span className="text-muted">
                - the main play to move {company.name} forward
              </span>
            </p>
            <ul className="flex flex-col gap-2">
              {((company.profile as any).playbook as string[]).map((p, i) => (
                <li
                  key={i}
                  className="flex gap-2.5 font-sans text-sm leading-snug text-bone/90"
                >
                  <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-amber/20 font-mono text-[0.6rem] text-amber">
                    {i + 1}
                  </span>
                  <span>{capitaliseSentenceStarts(p)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

      {/* DATA TABS - the AI intelligence above stays put; the raw client data
          lives in these tabs so the page isn't one long scroll. */}
      <div
        id="sec-tabs"
        className="mb-4 flex flex-wrap gap-1 border-b border-edge"
      >
        {(
          [
            ["timeline", "Timeline"],
            ["calls", "Focus"],
            ["notes", "Notes & docs"],
            ["pipeline", "Pipeline"],
            ["details", "Details"],
          ] as const
        ).filter(
          ([key]) =>
            access?.mode !== "shared_sales" ||
            (key !== "calls" && key !== "notes")
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3.5 py-2 font-mono text-[0.6rem] uppercase tracking-wider transition ${
              tab === k
                ? "border-amber text-amber"
                : "border-transparent text-muted hover:text-bone"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "timeline" && (
        <section className="mt-2 rounded-xl border border-edge bg-panel/40 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
                Relationship timeline
              </p>
              <p className="mt-1 font-sans text-[0.78rem] text-bone/65">
                Calls, emails, promises, notes and opportunities in one history.
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                ["all", "All"],
                ["calls", "Calls"],
                ["emails", "Emails"],
                ["outreach", "Outreach"],
                ["actions", "Promises"],
                ["opportunities", "Opportunities"],
                ["notes", "Notes"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTimelineFilter(key)}
                  className={`rounded-full border px-2.5 py-1 font-mono text-[0.52rem] uppercase tracking-wider transition ${
                    timelineFilter === key
                      ? "border-amber/60 bg-amber/15 text-amber"
                      : "border-edge text-muted hover:text-bone"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {(() => {
            const allowed: Record<string, TimelineItem["type"][]> = {
              calls: ["call", "meeting"],
              emails: ["email", "follow_up"],
              outreach: ["outreach"],
              actions: ["commitment", "task"],
              opportunities: ["opportunity"],
              notes: ["note"],
            };
            const visible =
              timelineFilter === "all"
                ? timeline
                : timeline.filter((item) =>
                    (allowed[timelineFilter] || []).includes(item.type)
                  );
            const meta: Record<
              TimelineItem["type"],
              { icon: string; label: string; tone: string }
            > = {
              meeting: { icon: "◷", label: "Upcoming", tone: "text-amber" },
              call: { icon: "◉", label: "Call", tone: "text-sage" },
              email: { icon: "✉", label: "Email", tone: "text-sky" },
              follow_up: { icon: "↗", label: "Follow-up", tone: "text-sky" },
              outreach: { icon: "◎", label: "Outreach", tone: "text-moss" },
              commitment: { icon: "✓", label: "Promise", tone: "text-rust" },
              task: { icon: "→", label: "Action", tone: "text-bone" },
              opportunity: { icon: "◆", label: "Opportunity", tone: "text-amber" },
              note: { icon: "✎", label: "Note", tone: "text-muted" },
            };
            if (!visible.length)
              return (
                <p className="font-mono text-[0.6rem] text-muted">
                  Nothing in this part of the relationship yet.
                </p>
              );
            return (
              <ol className="relative ml-2 border-l border-edge/80">
                {visible.map((item) => {
                  const m = meta[item.type];
                  const when = new Date(item.at).toLocaleString("en-GB", {
                    timeZone: "Europe/London",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const external = item.href?.startsWith("http");
                  const body = (
                    <div
                      className={`rounded-lg border px-3.5 py-3 transition ${
                        item.future
                          ? "border-amber/45 bg-amber/[0.06]"
                          : "border-edge bg-ink/35"
                      } ${item.href ? "hover:border-amber/50" : ""}`}
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <span className={`font-mono text-[0.54rem] uppercase tracking-wider ${m.tone}`}>
                          {m.label}
                        </span>
                        <span className="font-mono text-[0.52rem] text-muted">
                          {when}
                        </span>
                      </div>
                      <p className="font-sans text-[0.87rem] leading-snug text-bone">
                        {capitaliseSentenceStarts(item.title)}
                      </p>
                      {item.detail && (
                        <p className="mt-1 font-sans text-[0.78rem] leading-relaxed text-bone/65">
                          {capitaliseSentenceStarts(item.detail)}
                        </p>
                      )}
                      {(item.meta || item.status) && (
                        <p className={`mt-1.5 font-mono text-[0.51rem] uppercase tracking-wider ${
                          item.meta === "overdue" ? "text-rust" : "text-muted"
                        }`}>
                          {[item.meta, item.status && item.status !== item.meta ? item.status : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  );
                  return (
                    <li key={item.id} className="relative mb-2.5 pl-6 last:mb-0">
                      <span className={`absolute -left-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border border-edge bg-ink font-mono text-[0.62rem] ${m.tone}`}>
                        {m.icon}
                      </span>
                      {item.href ? (
                        external ? (
                          <a href={item.href} target="_blank" rel="noreferrer" className="block">
                            {body}
                          </a>
                        ) : (
                          <Link href={item.href} className="block">{body}</Link>
                        )
                      ) : body}
                    </li>
                  );
                })}
              </ol>
            );
          })()}
        </section>
      )}

      {tab === "details" && (
      <div className="grid gap-5 lg:grid-cols-2">
        {/* CORE + CUSTOM FIELDS */}
        <section id="sec-fields" className="flex flex-col gap-4">
          <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
              Details
            </p>
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className={labelCls}>Name</span>
                <input
                  value={core.name}
                  disabled={!access?.canEdit}
                  onChange={(e) => setCore({ ...core, name: e.target.value })}
                  className={inputCls}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={labelCls}>Sector</span>
                  <input
                    value={core.sector}
                    disabled={!access?.canEdit}
                    onChange={(e) =>
                      setCore({ ...core, sector: e.target.value })
                    }
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>Stage</span>
                  <select
                    value={core.stage}
                    disabled={!access?.canEdit}
                    onChange={(e) => setCore({ ...core, stage: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Set stage…</option>
                    {core.stage && !isRelationshipStageOption(core.stage) ? (
                      <option value={core.stage}>{core.stage}</option>
                    ) : null}
                    {RELATIONSHIP_STAGE_OPTIONS.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={labelCls}>Website</span>
                  <input
                    value={core.website}
                    disabled={!access?.canEdit}
                    onChange={(e) =>
                      setCore({ ...core, website: e.target.value })
                    }
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>Domain</span>
                  <input
                    value={core.domain}
                    disabled={!access?.canEdit}
                    onChange={(e) =>
                      setCore({ ...core, domain: e.target.value })
                    }
                    className={inputCls}
                  />
                </label>
              </div>
              {access?.mode !== "shared_sales" ? (
                <label className="block">
                  <span className={labelCls}>Notes</span>
                  <textarea
                    value={core.notes}
                    onChange={(e) => setCore({ ...core, notes: e.target.value })}
                    rows={4}
                    className={`${inputCls} resize-y`}
                  />
                </label>
              ) : null}
            </div>
          </div>

          {access?.mode !== "shared_sales" ? <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
                Custom fields
              </p>
              <AddFieldForm
                entity="company"
                onAdded={(f) => setFields((prev) => [...prev, f])}
              />
            </div>
            {fields.length === 0 ? (
              <p className="font-mono text-[0.6rem] text-muted">
                Add any field you want to track on every company - net worth,
                deal size, renewal date. No migration, it just appears.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {fields.map((f) => (
                  <CustomFieldEditor
                    key={f.id}
                    field={f}
                    value={attrs[f.key]}
                    onChange={(v) => setAttrs((p) => ({ ...p, [f.key]: v }))}
                  />
                ))}
              </div>
            )}
          </div> : null}
        </section>

        {/* CONTACTS */}
        <section className="flex flex-col gap-4">
          {access?.mode === "shared_sales" ? (
            <div className="rounded-xl border border-sage/35 bg-sage/[0.05] p-4 text-sm leading-relaxed text-muted">
              Private contacts and relationship threads are hidden. Use the assigned outreach prospect or add your own activity after you begin working this account.
            </div>
          ) : <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
              Contacts{" "}
              <span className="text-muted">({contacts.length})</span>
            </p>

            <div className="mb-3 flex flex-col gap-2">
              {contacts.length === 0 && (
                <p className="font-mono text-[0.6rem] text-muted">
                  No people yet. Add who you speak with at this company.
                </p>
              )}
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-sans text-sm text-bone">
                      {c.name}
                    </p>
                    <p className="truncate font-mono text-[0.58rem] uppercase tracking-wider text-muted">
                      {[c.role, c.email].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      href={`/crm/chat?shareType=contact&shareId=${c.id}&shareLabel=${encodeURIComponent(
                        c.name
                      )}`}
                      title="Share this contact's safe card into a private team conversation"
                      className="rounded px-2 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:text-amber"
                    >
                      ◫ chat
                    </Link>
                    <button
                      type="button"
                      onClick={() => breakOutContact(c.id)}
                      title="Break this person out into their own client record (e.g. as an investor). They stay on this company too."
                      className="rounded px-2 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-muted transition hover:text-sky"
                    >
                      {"↗"} own record
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteContact(c.id)}
                      title="remove contact"
                      className="rounded px-2 py-1 font-mono text-[0.7rem] text-muted transition hover:text-rust"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 border-t border-edge/60 pt-3">
              <span className={labelCls}>Add a contact</span>
              <input
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                placeholder="Name"
                className={inputCls}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={cRole}
                  onChange={(e) => setCRole(e.target.value)}
                  placeholder="Role"
                  className={inputCls}
                />
                <input
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                  placeholder="Email"
                  className={inputCls}
                />
              </div>
              <button
                type="button"
                onClick={addContact}
                disabled={!cName.trim()}
                className="self-start rounded-full border border-sage/60 bg-sage/15 px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 disabled:opacity-40"
              >
                + add contact
              </button>
            </div>
          </div>}

          {access?.mode !== "shared_sales" ? (
            <button
              type="button"
              onClick={deleteCompany}
              className="self-start rounded-full border border-rust/50 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-rust/80 transition hover:bg-rust/10 hover:text-rust"
            >
              delete company
            </button>
          ) : null}
        </section>
      </div>
      )}

      {/* CLIENT CONTEXT - notes / links / docs that feed the plan + assistant. */}
      {tab === "notes" && (
        <div>
          <ClientContext companyId={id} />
        </div>
      )}

      {tab === "calls" && (
        <section className="mt-2 rounded-xl border border-edge bg-panel/40 p-4">
          <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
            Focus scores over time{" "}
            <span className="text-muted">- main focus first, newest at top</span>
          </p>
          {focusOrder.length === 0 ? (
            <p className="font-mono text-[0.6rem] text-muted">
              No focus scores yet. They appear once a call linked to this client
              is scored.
            </p>
          ) : (
            <ul className="flex flex-col">
              {focusOrder.map((name) => {
                const entries = focusData[name];
                const latest = entries[0];
                const prior = entries.slice(1);
                const tone =
                  latest.score >= 4
                    ? "bg-sage/20 text-sage"
                    : latest.score <= 2
                    ? "bg-rust/20 text-rust"
                    : "bg-amber/20 text-amber";
                return (
                  <li
                    key={name}
                    className="flex items-center gap-3 border-b border-edge/40 py-2 last:border-none"
                  >
                    <span className="flex-1 font-sans text-[0.85rem] text-bone">
                      {name}
                      {prior.length > 0 && (
                        <span className="ml-2 font-mono text-[0.56rem] text-muted">
                          · also{" "}
                          {prior.map((e) => `${e.date} (${e.score})`).join(", ")}
                        </span>
                      )}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-mono text-[0.62rem] ${tone}`}
                    >
                      {latest.score}
                    </span>
                    <span className="w-16 text-right font-mono text-[0.56rem] text-muted">
                      {latest.date}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "pipeline" && (
      <>
      {/* OPPORTUNITIES - AI-surfaced from calls. */}
      <section
        id="sec-opps"
        className="mt-5 rounded-xl border border-edge bg-panel/40 p-4"
      >
        <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          Opportunities{" "}
          <span className="text-muted">
            ({opps.filter((o) => o.status === "open").length} open)
          </span>
        </p>
        {opps.length === 0 ? (
          <p className="font-mono text-[0.6rem] text-muted">
            Opportunities the AI spots in your calls land here. Link a call to
            this client and run it.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {opps.map((o) => (
              <li
                key={o.id}
                className={`rounded-lg border border-edge bg-ink/40 px-4 py-3 ${
                  o.status !== "open" ? "opacity-55" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-sans text-[0.9rem] text-bone">
                      {capitaliseSentenceStarts(o.title)}
                      {typeof o.value === "number" && (
                        <span className="ml-2 font-mono text-[0.62rem] text-sage">
                          ~£{Number(o.value).toLocaleString()}
                        </span>
                      )}
                    </p>
                    {o.detail && (
                      <p className="mt-0.5 font-sans text-[0.8rem] leading-snug text-bone/70">
                        {capitaliseSentenceStarts(o.detail)}
                      </p>
                    )}
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* FOLLOW-UP DRAFTS - AI-written, you review and send yourself. */}
      <section className="mt-5 rounded-xl border border-edge bg-panel/40 p-4">
        <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          Follow-up drafts{" "}
          <span className="text-muted">- review &amp; send yourself</span>
        </p>
        {followUps.filter((f) => f.status !== "dismissed").length === 0 ? (
          <p className="font-mono text-[0.6rem] text-muted">
            After a linked call, a ready-to-send draft email appears here for you
            to review.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {followUps
              .filter((f) => f.status !== "dismissed")
              .map((f) => (
                <li
                  key={f.id}
                  className={`rounded-lg border border-edge bg-ink/40 p-3.5 ${
                    f.status === "sent" ? "opacity-60" : ""
                  }`}
                >
                  <p className="mb-1 font-sans text-[0.86rem] font-medium text-bone">
                    {f.draft_subject || "(no subject)"}
                    {f.status === "sent" && (
                      <span className="ml-2 font-mono text-[0.56rem] uppercase tracking-wider text-sage">
                        sent
                      </span>
                    )}
                  </p>
                  <p className="whitespace-pre-wrap font-sans text-[0.82rem] leading-relaxed text-bone/80">
                    {f.draft_body}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyDraft(f)}
                      className="rounded-full border border-amber/50 bg-amber/10 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
                    >
                      {copiedId === f.id ? "copied" : "copy"}
                    </button>
                    {f.status !== "sent" && (
                      <button
                        type="button"
                        onClick={() => setFollowUpStatus(f.id, "sent")}
                        className="rounded-full border border-sage/50 bg-sage/10 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-sage transition hover:bg-sage/20"
                      >
                        mark sent
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFollowUpStatus(f.id, "dismissed")}
                      className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-rust"
                    >
                      dismiss
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
      </>
      )}

      {/* CALL HISTORY - kept with the Focus tab so Timeline does not duplicate it. */}
      {tab === "calls" && (
      <section className="mt-5 rounded-xl border border-edge bg-panel/40 p-4">
        <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          Call history <span className="text-muted">({calls.length})</span>
        </p>
        {calls.length === 0 ? (
          <p className="font-mono text-[0.6rem] text-muted">
            No calls linked yet. On the call screen, set this company in the
            “Client” bar before you go live and the scorecard lands here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {calls.map((c) => {
              const overview =
                c?.summary && typeof c.summary.overview === "string"
                  ? c.summary.overview
                  : "";
              const score =
                c?.summary &&
                (typeof c.summary.score === "number"
                  ? c.summary.score
                  : typeof c.summary.overallScore === "number"
                  ? c.summary.overallScore
                  : null);
              const date = c?.created_at
                ? new Date(c.created_at).toLocaleDateString()
                : "";
              return (
                <li
                  key={c.id}
                  className="rounded-lg border border-edge bg-ink/40 px-4 py-3 transition hover:border-amber/50"
                >
                  <Link
                    href={`/crm/calls/${c.id}`}
                    className="block"
                  >
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                        {date}
                        {c.candidate ? ` · ${c.candidate}` : ""}
                      </span>
                      <span className="flex items-center gap-2">
                        {c.cost != null && Number.isFinite(Number(c.cost)) && (
                          <span className="font-mono text-[0.62rem] text-bone/70">
                            {gbp(Number(c.cost))}
                          </span>
                        )}
                        {score !== null && (
                          <span className="font-mono text-[0.62rem] text-sage">
                            {Math.round(score)}%
                          </span>
                        )}
                        <span className="font-mono text-[0.56rem] uppercase tracking-wider text-sky">view ↗</span>
                      </span>
                    </div>
                    {overview && (
                      <p className="font-sans text-[0.82rem] leading-snug text-bone/80">
                        {capitaliseSentenceStarts(
                          overview.length > 240
                            ? overview.slice(0, 240) + "…"
                            : overview
                        )}
                      </p>
                    )}
                  </Link>
                  {c.hasTranscript ? (
                    <a
                      href={`/api/crm/calls/${encodeURIComponent(c.id)}/transcript`}
                      download
                      className="mt-2 inline-flex rounded-full border border-sage/45 bg-sage/10 px-3 py-1 font-mono text-[0.54rem] uppercase tracking-wider text-sage transition hover:bg-sage/20"
                    >
                      Download transcript ↓
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      )}

      <NavMenu />
    </main>
  );
}
