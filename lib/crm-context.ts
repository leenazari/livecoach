import { supabaseAdmin } from "@/lib/supabase";
import { londonDayBounds } from "@/lib/outreach";
import { isPrepEligibleCalendarEvent } from "@/lib/calendar-events";
import { getRequestScope } from "@/lib/request-scope";
import {
  brainSharedClientIds,
  isLimitedBrainScope,
  partitionBrainOutreach,
  personalOutreachSenderId,
} from "@/lib/brain-sales-scope";
import {
  compactOutreachResearchFacts,
  rankNamedOutreachProspects,
} from "@/lib/brain-outreach-reference";
import {
  listVisibleClientGrants,
  loadSafeSharedCompanies,
  loadSafeSharedCompany,
} from "@/lib/team-client-sharing";
import { resolveOutreachCampaignSelection } from "@/lib/outreach-campaign-selection";

// Gathers EVERYTHING we know about one client into a single grounding string:
// profile, recent call scorecards (incl. focus scores), open opportunities,
// follow-up drafts, contacts, custom fields, and the company-scoped context
// store (notes / links / documents). Used by the client assistant, and (the
// context items) by the call planner's auto-attach.
export async function gatherClientContext(
  companyId: string,
  options: { includeUpcomingIntents?: boolean } = {}
): Promise<string> {
  const cut = (s: any, n: number) =>
    typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : "";
  const requestScope = getRequestScope();

  // Resolve access before loading any related record. This prevents a shared
  // client lookup from even fetching the original owner's private contacts,
  // calls, calendar, notes, documents or email context with the service role.
  const { data: visibleCompany, error: companyError } = await supabaseAdmin
    .from("companies")
    .select(
      "id, owner_id, name, sector, stage, profile, attributes, notes, email_context"
    )
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) throw companyError;

  let company: any =
    visibleCompany &&
    (!requestScope || visibleCompany.owner_id === requestScope.userId)
      ? visibleCompany
      : null;
  let sharedSalesAccess = false;
  if (!company && requestScope) {
    const { data: share, error: shareError } = await supabaseAdmin
      .from("team_client_shares")
      .select("id")
      .eq("workspace_id", requestScope.workspaceId)
      .eq("company_id", companyId)
      .eq("status", "active")
      .maybeSingle();
    if (shareError) throw shareError;
    if (share) {
      company = await loadSafeSharedCompany(companyId, requestScope.workspaceId);
      sharedSalesAccess = !!company;
    }
  }
  if (!company) return "";

  if (sharedSalesAccess && requestScope) {
    const { data: assignedOpportunities, error: assignedOpportunitiesError } =
      await supabaseAdmin
        .from("opportunities")
        .select(
          "title, deal_intent, deal_intent_as_of, deal_intent_source, deal_intent_override, value, status, opportunity_type, pipeline_stage, win_outlook, win_outlook_confidence, win_outlook_reasons, win_outlook_questions, win_outlook_override, engagement_motion, active_contact_method, next_action, next_action_due_at, assigned_to_user_id"
        )
        .eq("company_id", companyId)
        .eq("status", "open")
        .eq("assigned_to_user_id", requestScope.userId)
        .order("created_at", { ascending: false })
        .limit(20);
    if (assignedOpportunitiesError) throw assignedOpportunitiesError;

    const opportunities = assignedOpportunities || [];
    const lines = [
      "ACCESS BOUNDARY: this client was explicitly shared with the team. Sharing permits only this safe high-level lookup. The original owner's contacts, calls, transcripts, calendar, mailbox context, notes, documents and Brain history were not loaded. Opportunity details appear only when the opportunity is assigned to this account.",
      "",
      `CLIENT: ${company.name}`,
      `Sector: ${company.sector?.trim() || "not set"}`,
      `Stage: ${company.stage?.trim() || "not set"}`,
      `Assigned opportunity records: ${
        opportunities.length
          ? opportunities
              .map(
                (opportunity: any) =>
                  `[${opportunity.opportunity_type || "revenue"}] ${opportunity.title}. Lifecycle ${opportunity.pipeline_stage || opportunity.status || "not set"}. Win outlook ${opportunity.win_outlook || "not assessed"}${opportunity.win_outlook_confidence == null ? "" : ` at ${opportunity.win_outlook_confidence}% confidence`}${opportunity.win_outlook_override ? " (human override)" : ""}.${opportunity.value ? ` Value ~£${opportunity.value}.` : " Value not set."}${opportunity.deal_intent ? ` Intent${opportunity.deal_intent_override ? " (human override)" : ""}: ${cut(opportunity.deal_intent, 320)}.` : ""}${Array.isArray(opportunity.win_outlook_reasons) && opportunity.win_outlook_reasons.length ? ` Evidence: ${opportunity.win_outlook_reasons.slice(0, 3).join(" | ")}.` : ""}${Array.isArray(opportunity.win_outlook_questions) && opportunity.win_outlook_questions.length ? ` Ask next: ${opportunity.win_outlook_questions.slice(0, 3).join(" | ")}.` : ""}${opportunity.next_action ? ` Next: ${cut(opportunity.next_action, 220)}${opportunity.next_action_due_at ? ` due ${String(opportunity.next_action_due_at).slice(0, 10)}` : ""}.` : ""}${opportunity.engagement_motion ? ` Motion ${String(opportunity.engagement_motion).replace(/_/g, " ")}.` : ""}${opportunity.active_contact_method ? ` Contact via ${String(opportunity.active_contact_method).replace(/_/g, " ")}.` : ""}`
              )
              .join("; ")
          : "none assigned to this account"
      }`,
    ];
    return lines.join("\n");
  }

  const [
    contactsRes,
    summariesRes,
    oppsRes,
    fuRes,
    ctxRes,
    departmentsRes,
    workstreamsRes,
    workstreamContactsRes,
  ] = await Promise.all([
      supabaseAdmin
        .from("contacts")
        .select("id, department_id, name, role, email, attributes")
        .eq("company_id", companyId)
        .limit(20),
      supabaseAdmin
        .from("interview_summaries")
        .select("candidate, created_at, summary, workstream_id")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(6),
      supabaseAdmin
        .from("opportunities")
        .select("title, detail, deal_intent, deal_intent_as_of, deal_intent_source, deal_intent_override, value, status, opportunity_type, pipeline_stage, win_outlook, win_outlook_confidence, win_outlook_reasons, win_outlook_questions, win_outlook_override, engagement_motion, active_contact_method, next_action, next_action_due_at, workstream_id, assigned_to_user_id")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("follow_ups")
        .select("draft_subject, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabaseAdmin
        .from("client_context")
        .select("kind, title, url, content, created_at, workstream_id, metadata")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabaseAdmin
        .from("departments")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
      supabaseAdmin
        .from("workstreams")
        .select("id, department_id, name, kind, status, purpose")
        .eq("company_id", companyId)
        .order("status", { ascending: true })
        .order("name", { ascending: true }),
      supabaseAdmin
        .from("workstream_contacts")
        .select("workstream_id, contact_id")
        .eq("company_id", companyId),
  ]);

  // Upcoming calls for this client, synced from the calendar, so the assistant
  // can answer "when's our next call" / "what's coming up" from the CRM's copy.
  let upcomingRowsQuery = supabaseAdmin
    .from("upcoming_calls")
    .select("title, scheduled_at, meeting_url, intent, prepped, workstream_id")
    .eq("company_id", companyId)
    .gte("scheduled_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(10);
  if (requestScope && requestScope.role !== "owner") {
    upcomingRowsQuery = upcomingRowsQuery.eq(
      "owner_id",
      requestScope.userId
    );
  }
  const { data: upcomingRows } = await upcomingRowsQuery;

  // Pre-compute every field so we can render it as a value OR an explicit
  // "not set". Absent fields are what tempt the model to invent (e.g. a budget),
  // so we never leave one silently missing - we say it isn't recorded.
  const profile = (company.profile || {}) as any;
  const attrs = (company.attributes || {}) as any;
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== "" && v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("; ");
  const contacts = contactsRes.data || [];
  const opps = (oppsRes.data || []).filter(
    (o: any) =>
      o.status === "open" &&
      (!requestScope ||
        requestScope.role === "owner" ||
        o.assigned_to_user_id === requestScope.userId)
  );
  const drafts = (fuRes.data || []).filter((f: any) => f.status === "draft");
  const summaries = summariesRes.data || [];
  const ctx = ctxRes.data || [];
  const departments = departmentsRes.data || [];
  const workstreams = workstreamsRes.data || [];
  const workstreamContacts = workstreamContactsRes.data || [];
  const hasMultipleActiveWorkstreams =
    workstreams.filter((thread: any) => thread.status === "active").length > 1;
  const workstreamName = new Map<string, string>(
    workstreams.map((thread: any) => [thread.id, thread.name])
  );
  const departmentName = new Map<string, string>(
    departments.map((department: any) => [department.id, department.name])
  );

  const hasNotes = !!(company.notes && String(company.notes).trim());
  const isThin =
    !hasNotes &&
    !profile.brief &&
    !attrStr &&
    contacts.length === 0 &&
    opps.length === 0 &&
    drafts.length === 0 &&
    summaries.length === 0 &&
    ctx.length === 0;

  const lines: string[] = [];

  if (isThin) {
    lines.push(
      `RECORD STATUS: this client's record is almost empty - only the name "${company.name}" has been entered. There is NO budget, deal value, stage, call history, contact, opportunity or next step on file. Do not infer or state any of these. Tell the user the record is thin and suggest what to capture first (link a call, set a stage, add a contact or a note).`,
      ""
    );
  }

  lines.push(`CLIENT: ${company.name}`);
  lines.push(`Sector: ${company.sector?.trim() || "not set"}`);
  lines.push(`Stage: ${company.stage?.trim() || "not set"}`);
  lines.push(`Notes: ${hasNotes ? String(company.notes).trim() : "none recorded"}`);
  const emailCtx = (company as any).email_context;
  if (!hasMultipleActiveWorkstreams && emailCtx && String(emailCtx).trim()) {
    lines.push(
      "",
      "EMAIL CONTEXT (the email thread and relationship so far - this is where the relationship is actually happening right now, so weigh it heavily when judging the intent, the plan and the next steps):",
      String(emailCtx).trim(),
      ""
    );
  } else if (hasMultipleActiveWorkstreams) {
    lines.push(
      "",
      "COMPANY EMAIL CONTEXT: hidden because this company has multiple active workstreams. Use the named contact's workstream memory instead.",
      ""
    );
  }
  const briefText = Array.isArray(profile.brief)
    ? profile.brief
        .filter((b: any) => typeof b === "string" && b.trim())
        .map((b: string) => `- ${b.trim()}`)
        .join("\n")
    : typeof profile.brief === "string"
    ? profile.brief
    : "";
  lines.push(
    `Background / what we know:${
      briefText ? `\n${briefText}` : " nothing recorded yet"
    }`
  );

  // BATTLE PLAN, if one has been built - so the suggested intent and the
  // assistant reason from the pre-call strategy (the objections, the fit, the
  // questions, the outcome), instead of it being a separate unused artifact.
  const bc = (profile as any).battlecard;
  if (!hasMultipleActiveWorkstreams && bc && typeof bc === "object") {
    const arr = (v: any): string[] =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [];
    const bl: string[] = [
      "",
      "BATTLE PLAN (the pre-call strategy already built for this client - weigh it when shaping the intent, focus and next steps):",
    ];
    if (bc.oneLiner) bl.push(`Read: ${bc.oneLiner}`);
    const strong = arr(bc.fit?.strong);
    const weak = arr(bc.fit?.weak);
    if (strong.length) bl.push(`Where we fit: ${strong.join("; ")}`);
    if (weak.length) bl.push(`Where we do not fit (do not oversell): ${weak.join("; ")}`);
    const objs = Array.isArray(bc.objections) ? bc.objections : [];
    if (objs.length) {
      bl.push("Objections to be ready for:");
      for (const o of objs.slice(0, 8)) {
        if (o && o.objection)
          bl.push(`- ${o.objection}${o.response ? ` -> ${o.response}` : ""}`);
      }
    }
    const qs = arr(bc.questionsToAsk);
    if (qs.length) bl.push(`Questions to ask: ${qs.slice(0, 6).join("; ")}`);
    if (bc.nextStep) bl.push(`Outcome to drive toward: ${bc.nextStep}`);
    lines.push(...bl);
  }
  lines.push(
    `Recorded fields (budget, value, owner, priority, etc.): ${
      attrStr || "none set - no budget or deal value has been entered for this client"
    }`
  );
  if (workstreams.length) {
    lines.push(
      "",
      "RELATIONSHIP STRUCTURE. Treat every workstream as a separate memory boundary. Never move facts, actions or call history between them unless the record explicitly links them:"
    );
    for (const thread of workstreams as any[]) {
      const people = workstreamContacts
        .filter((link: any) => link.workstream_id === thread.id)
        .map((link: any) => contacts.find((contact: any) => contact.id === link.contact_id)?.name)
        .filter(Boolean);
      lines.push(
        `- ${departmentName.get(thread.department_id) || "No department"} > ${thread.name} [${thread.kind}, ${thread.status}]${thread.purpose ? `: ${thread.purpose}` : ""}${people.length ? ` | people: ${people.join(", ")}` : ""}`
      );
    }
  }
  lines.push(
    `Contacts: ${
      contacts.length
        ? contacts
            .map((c: any) => {
              const stakeholder = c.attributes || {};
              const buyingRole = String(
                stakeholder.stakeholderRole || ""
              ).replace(/_/g, " ");
              const commercial = [
                buyingRole && buyingRole !== "unknown" ? buyingRole : "",
                stakeholder.stakeholderInfluence
                  ? `${stakeholder.stakeholderInfluence} influence`
                  : "",
                stakeholder.stakeholderEngagement || "",
              ].filter(Boolean);
              return `${c.name}${c.role ? ` (${c.role})` : ""}${
                commercial.length ? ` [${commercial.join(", ")}]` : ""
              }`;
            })
            .join(", ")
        : "none recorded"
    }`
  );
  lines.push(
    `Open CRM opportunity records: ${
      opps.length
        ? opps
            .map(
              (o: any) =>
                `[${o.workstream_id ? workstreamName.get(o.workstream_id) || "workstream" : "company-wide"}] [${o.opportunity_type || "revenue"}] ${o.title}. Lifecycle ${o.pipeline_stage || o.status || "not set"}. Win outlook ${o.win_outlook || "not assessed"}${o.win_outlook_confidence == null ? "" : ` at ${o.win_outlook_confidence}% confidence`}${o.win_outlook_override ? " (human override)" : ""}.${o.value ? ` Value ~£${o.value}.` : " Value not set."}${o.deal_intent ? ` Intent${o.deal_intent_override ? " (human override)" : ""}: ${cut(o.deal_intent, 320)}.` : ""}${Array.isArray(o.win_outlook_reasons) && o.win_outlook_reasons.length ? ` Evidence: ${o.win_outlook_reasons.slice(0, 3).join(" | ")}.` : ""}${Array.isArray(o.win_outlook_questions) && o.win_outlook_questions.length ? ` Ask next: ${o.win_outlook_questions.slice(0, 3).join(" | ")}.` : ""}${o.next_action ? ` Next: ${cut(o.next_action, 220)}${o.next_action_due_at ? ` due ${String(o.next_action_due_at).slice(0, 10)}` : ""}.` : ""}${o.engagement_motion ? ` Motion ${String(o.engagement_motion).replace(/_/g, " ")}.` : ""}${o.active_contact_method ? ` Contact via ${String(o.active_contact_method).replace(/_/g, " ")}.` : ""}${o.detail ? ` Context: ${cut(o.detail, 320)}` : ""}`
            )
            .join("; ")
        : "none recorded - no deal value or budget on file"
    }`
  );
  lines.push(
    `Follow-up drafts waiting: ${
      drafts.length
        ? drafts.map((f: any) => f.draft_subject || "(untitled)").join("; ")
        : "none"
    }`
  );

  const upcoming = upcomingRows || [];
  if (upcoming.length) {
    const nowMs = Date.now();
    lines.push("", "CALLS (from the synced calendar, UK time):");
    for (const u of upcoming as any[]) {
      const ms = u.scheduled_at ? new Date(u.scheduled_at).getTime() : null;
      const past = ms != null && ms < nowMs;
      const when = u.scheduled_at
        ? new Date(u.scheduled_at).toLocaleString("en-GB", {
            timeZone: "Europe/London",
            weekday: "short",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "no time set";
      lines.push(
        `- ${when}${past ? " [ALREADY PASSED]" : ""}: ${u.title || "call"}${
          u.prepped ? " [prepped]" : ""
        }${u.workstream_id ? ` [workstream: ${workstreamName.get(u.workstream_id) || "unknown"}]` : " [company-wide]"}${
          options.includeUpcomingIntents !== false && u.intent
            ? ` - ${cut(u.intent, 160)}`
            : ""
        }${
          u.meeting_url ? ` (join link: ${u.meeting_url})` : ""
        }`
      );
    }
  } else {
    lines.push("Upcoming calls (synced calendar): none scheduled with this client");
  }

  if (summaries.length) {
    lines.push("", "PAST CALLS (most recent first):");
    for (const row of summaries as any[]) {
      const s = row.summary || {};
      const date = row.created_at
        ? new Date(row.created_at).toISOString().slice(0, 10)
        : "";
      const comps = Array.isArray(s.competencies)
        ? s.competencies
            .map((c: any) => `${c.name} ${c.score}/5`)
            .slice(0, 8)
            .join(", ")
        : "";
      const outstanding = [
        ...(Array.isArray(s.myNextActions) ? s.myNextActions : []),
        ...(Array.isArray(s.suggestedNextActions) ? s.suggestedNextActions : []),
      ]
        .slice(0, 4)
        .join("; ");
      let line = `- ${date} [${row.workstream_id ? `workstream: ${workstreamName.get(row.workstream_id) || "unknown"}` : "company-wide"}]: ${cut(s.headline, 140)} ${cut(s.overview, 260)}`;
      if (comps) line += ` [focus scores: ${comps}]`;
      if (outstanding) line += ` [outstanding for us: ${cut(outstanding, 220)}]`;
      lines.push(line);
    }
  } else {
    lines.push("Past calls: none recorded");
  }

  if (ctx.length) {
    lines.push("", "EXTRA CONTEXT YOU ADDED (notes / links / documents):");
    for (const c of ctx as any[]) {
      const head = c.title || (c.kind === "link" ? c.url : c.kind);
      const replyFacts =
        c.kind === "email_reply"
          ? [
              c.metadata?.receivedAt ? `received ${c.metadata.receivedAt}` : "",
              c.metadata?.replyType === "out_of_office" ? "out of office" : "reply",
              c.metadata?.returnDate ? `return date ${c.metadata.returnDate}` : "",
            ]
              .filter(Boolean)
              .join(", ")
          : "";
      lines.push(`- [${c.workstream_id ? `workstream: ${workstreamName.get(c.workstream_id) || "unknown"}` : "company-wide"}] [${c.kind}] ${head}${replyFacts ? ` [${replyFacts}]` : ""}: ${cut(c.content || c.url || "", 600)}`);
    }
  } else {
    lines.push("Extra context (notes / links / documents): none added");
  }

  return lines.join("\n");
}

// Everything across ALL clients, for the global assistant: each client with its
// profile, open opportunities, waiting drafts and outstanding tasks. Lets the
// assistant answer "show Alan's to-do" (it resolves the name) or "my to-do"
// (across everyone) without the user picking a client first.
export async function gatherGlobalContext(
  message = "",
  now = new Date()
): Promise<string> {
  const cut = (s: any, n: number) =>
    typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : "";
  const asksForSchedule =
    /\b(schedule|calendar|what(?:'s| is) on|calls? (?:today|tomorrow)|meetings? (?:today|tomorrow))\b/i.test(
      message
    );

  const requestScope = getRequestScope();
  let companiesQuery = supabaseAdmin
    .from("companies")
    .select("id, owner_id, name, sector, stage, profile")
    .limit(500);
  let draftsQuery = supabaseAdmin
    .from("follow_ups")
    .select("company_id")
    .eq("status", "draft")
    .limit(500);
  let opportunitiesQuery = supabaseAdmin
    .from("opportunities")
    .select("company_id, value, opportunity_type")
    .eq("status", "open")
    .eq("opportunity_type", "revenue")
    .limit(500);
  let tasksQuery = supabaseAdmin
    .from("tasks")
    .select("id, company_id, owner_id, text, kind, payload")
    .eq("status", "open")
    .limit(1000);
  let callsQuery = supabaseAdmin
    .from("interview_summaries")
    .select("company_id, created_at")
    .not("company_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (requestScope && requestScope.role !== "owner") {
    companiesQuery = companiesQuery.eq("owner_id", requestScope.userId);
    draftsQuery = draftsQuery.eq("owner_id", requestScope.userId);
    opportunitiesQuery = opportunitiesQuery.or(
      `owner_id.eq.${requestScope.userId},assigned_to_user_id.eq.${requestScope.userId}`
    );
    tasksQuery = tasksQuery.eq("owner_id", requestScope.userId);
    callsQuery = callsQuery.eq("owner_id", requestScope.userId);
  }
  const [companiesRes, draftsRes, oppsRes, tasksRes, callsRes] =
    await Promise.all([
      companiesQuery,
      draftsQuery,
      opportunitiesQuery,
      tasksQuery,
      callsQuery,
    ]);

  const ownedCompanies = (companiesRes.data || []).filter(
    (company: any) =>
      !requestScope || company.owner_id === requestScope.userId
  );
  let companies: any[] = [...ownedCompanies];
  if (requestScope) {
    const grants = await listVisibleClientGrants(requestScope.workspaceId);
    const sharedIds = brainSharedClientIds(grants, requestScope);
    const ownedIds = new Set(ownedCompanies.map((company: any) => company.id));
    const sharedCompanies = await loadSafeSharedCompanies(
      sharedIds.filter((id) => !ownedIds.has(id)),
      requestScope.workspaceId
    );
    companies = [...companies, ...sharedCompanies];
  }
  if (companies.length === 0) {
    return requestScope && requestScope.role !== "owner"
      ? "RESTRICTED CRM SCOPE: No client profiles are owned by or explicitly shared with this member yet. Outreach prospects are separate from client profiles. Do not describe another person's clients, prospects, replies or tasks as this member's work, even if they ask by name."
      : "The user has no clients in their CRM yet.";
  }

  // Compact per-client tallies. We keep this to ONE line per client so the
  // prompt stays small as the book of clients grows - the assistant pulls a
  // client's FULL detail separately (gatherClientContext) when the user names
  // one, so naming a client still gets depth (detail on demand).
  const draftCount = new Map<string, number>();
  for (const d of draftsRes.data || []) {
    if (!d.company_id) continue;
    draftCount.set(d.company_id, (draftCount.get(d.company_id) || 0) + 1);
  }
  const oppCount = new Map<string, number>();
  const oppValue = new Map<string, number>();
  for (const o of oppsRes.data || []) {
    if (!o.company_id) continue;
    oppCount.set(o.company_id, (oppCount.get(o.company_id) || 0) + 1);
    oppValue.set(
      o.company_id,
      (oppValue.get(o.company_id) || 0) + (Number(o.value) || 0)
    );
  }
  const taskCount = new Map<string, number>();
  for (const t of tasksRes.data || []) {
    if (!t.company_id) continue;
    taskCount.set(t.company_id, (taskCount.get(t.company_id) || 0) + 1);
  }
  // Most recent call per company (rows arrive newest-first, so first wins).
  const lastCall = new Map<string, string>();
  for (const s of callsRes.data || []) {
    if (!s.company_id || lastCall.has(s.company_id)) continue;
    lastCall.set(s.company_id, s.created_at as string);
  }
  const shortDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      });
    } catch {
      return "";
    }
  };

  const lines: string[] = asksForSchedule
    ? [
        "SCHEDULE LOOKUP - the client pipeline roll-up is deliberately omitted because it is not needed for this answer.",
      ]
    : [
        "YOUR CLIENTS AND PIPELINE - the most actionable clients, one compact line each. The named-client memory above is authoritative for a specific person. This roll-up is for prioritisation without loading every full record.",
        "",
      ];
  const activityScore = (c: any) =>
    (oppCount.get(c.id) || 0) * 20 +
    (taskCount.get(c.id) || 0) * 8 +
    (draftCount.get(c.id) || 0) * 5 +
    (lastCall.has(c.id) ? 3 : 0);
  const digestClients = [...(companies as any[])]
    .sort((a, b) => activityScore(b) - activityScore(a) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 100);
  if (!asksForSchedule)
    lines.push(`Showing ${digestClients.length} of ${companies.length} clients, ranked by open opportunity, action, draft and recent-call activity.`);
  const companyNameById = new Map(
    companies.map((company: any) => [String(company.id), String(company.name || "Client")])
  );
  const opportunityClarifications = (tasksRes.data || [])
    .filter(
      (task: any) =>
        (!requestScope || task.owner_id === requestScope.userId) &&
        task.kind === "opportunity_clarification" &&
        task.payload?.clarificationType === "opportunity_scope"
    )
    .slice(0, 5);
  if (!asksForSchedule && opportunityClarifications.length) {
    lines.push(
      "",
      "PENDING PIPELINE CONFIRMATIONS. The pipeline was left unchanged. Ask the user whether each item is the same deal, a separate workstream, or not an opportunity. Never choose for them."
    );
    for (const task of opportunityClarifications) {
      lines.push(
        `• confirmation ${task.id} · ${companyNameById.get(String(task.company_id)) || "Client"} · saved deal: ${cut(task.payload.existingTitle, 100)} · new evidence: ${cut(task.payload.proposedTitle, 100)}`
      );
    }
    lines.push("");
  }
  for (const c of asksForSchedule ? [] : digestClients) {
    const head = `• ${c.name}${
      c.stage || c.sector
        ? ` (${[c.stage, c.sector].filter(Boolean).join(", ")})`
        : ""
    }`;
    const bits: string[] = [];
    const oc = oppCount.get(c.id) || 0;
    const ov = oppValue.get(c.id) || 0;
    if (oc) bits.push(`${oc} open opp${oc > 1 ? "s" : ""}${ov ? ` ~£${ov}` : ""}`);
    const tc = taskCount.get(c.id) || 0;
    if (tc) bits.push(`${tc} open to-do${tc > 1 ? "s" : ""}`);
    const dc = draftCount.get(c.id) || 0;
    if (dc) bits.push(`${dc} draft${dc > 1 ? "s" : ""} waiting`);
    const lc = lastCall.get(c.id);
    bits.push(lc ? `last contact ${shortDate(lc)}` : "no calls logged");
    const rawBrief = (c.profile || {}).brief;
    const brief = Array.isArray(rawBrief)
      ? rawBrief.find((b: any) => typeof b === "string" && b.trim()) || ""
      : typeof rawBrief === "string"
      ? rawBrief
      : "";
    let line = `${head} - ${bits.join(", ")}`;
    if (brief) line += `. ${cut(brief, 90)}`;
    else if (!oc && !tc && !dc && !lc)
      line += ". no details recorded yet - thin record, do not infer any";
    lines.push(line);
  }

  // Upcoming calls across everyone, synced from the calendar, so "what's on my
  // calendar" / "what's next" works without picking a client first.
  let upcomingQuery = supabaseAdmin
    .from("upcoming_calls")
    .select("id, company_id, title, scheduled_at, prepped, meeting_url")
    .gte("scheduled_at", new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(40);
  if (requestScope && requestScope.role !== "owner") {
    upcomingQuery = upcomingQuery.eq("owner_id", requestScope.userId);
  }
  const { data: upAll } = await upcomingQuery;
  const allEligible = (upAll || []).filter((call: any) =>
    isPrepEligibleCalendarEvent(call)
  );
  const todayKey = londonDateKey(now);
  const localHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .find((part) => part.type === "hour")?.value || "0"
  );
  const requestedDateKey = /\btomorrow\b/i.test(message)
    ? localHour < 2
      ? todayKey
      : nextDateKey(todayKey)
    : /\btoday\b/i.test(message)
    ? todayKey
    : "";
  const up = requestedDateKey
    ? allEligible.filter(
        (call: any) =>
          call.scheduled_at &&
          londonDateKey(new Date(call.scheduled_at)) === requestedDateKey
      )
    : allEligible;
  if (up.length || asksForSchedule) {
    const nowMs = now.getTime();
    const nameById = new Map<string, string>();
    for (const c of companies as any[]) nameById.set(c.id, c.name);
    const asksForJoinLink =
      /\b(join|meeting link|teams link|google meet|meet link|zoom link)\b/i.test(
        message
      );
    const requestedDateNote = requestedDateKey
      ? /\btomorrow\b/i.test(message) && localHour < 2
        ? ` The requested day is exactly ${requestedDateKey}. Before 02:00 UK time, this user's \"tomorrow\" means the upcoming morning on the same UK calendar date.`
        : ` The requested day is exactly ${requestedDateKey}.`
      : "";
    lines.push(
      "",
      `YOUR CALLS (synced from the calendar, UK time, soonest first.${requestedDateNote} Always include each time. Use the supplied prep page for clickable schedule titles. Do not expose or link the video meeting URL unless the user explicitly asks for the join link):`
    );
    if (!up.length) lines.push("• No eligible calls are scheduled for that requested day.");
    for (const u of up as any[]) {
      const ms = u.scheduled_at ? new Date(u.scheduled_at).getTime() : null;
      const past = ms != null && ms < nowMs;
      const when = u.scheduled_at
        ? new Date(u.scheduled_at).toLocaleString("en-GB", {
            timeZone: "Europe/London",
            weekday: "short",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "no time set";
      const who = u.company_id ? nameById.get(u.company_id) || "" : "";
      const prepUrl = u.company_id
        ? `/call?company=${encodeURIComponent(u.company_id)}&upcoming=${encodeURIComponent(u.id)}`
        : `/call?upcoming=${encodeURIComponent(u.id)}`;
      lines.push(
        `• ${when}${past ? " [ALREADY PASSED]" : ""}: ${u.title || "call"}${
          who ? ` (${who})` : ""
        }${u.prepped ? " [prepped]" : ""} - prep page: ${prepUrl}${
          asksForJoinLink && u.meeting_url
            ? ` - requested join link: ${u.meeting_url}`
            : ""
        }`
      );
    }
  }

  return lines.join("\n");
}

// Saved call preparation is deliberately NOT part of the normal global Brain
// prompt. A full focus, question set and playbook for every future meeting
// would be expensive and usually irrelevant. When the user explicitly asks
// about a call's questions, focus, intent or plan, retrieve only the best
// matching upcoming call and only the requested parts of its saved prep.
const CALL_PREP_TOPIC =
  /\b(question|questions|focus|intent|agenda|prep|preparation|playbook|battle\s*plan|game\s*plan|call\s*plan|talking\s*points?|what\s+(?:should|do)\s+i\s+ask|what\s+(?:should|do)\s+i\s+cover)\b/i;

const CALL_MATCH_STOP = new Set([
  "about", "after", "again", "agenda", "ask", "battle", "before", "call",
  "cover", "focus", "game", "have", "intent", "interviewa", "meeting",
  "plan", "playbook", "prep", "preparation", "question", "questions",
  "should", "talking", "today", "tomorrow", "what", "when", "with",
]);

const normalCallText = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const londonDateKey = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const nextDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
};

const callClock = (value: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return { hour: parts.hour, minute: parts.minute };
};

const requestedClock = (message: string) => {
  const value = message.toLowerCase();
  const withMinutes = value.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/);
  const hourOnly = value.match(/\b(\d{1,2})\s*(am|pm)\b/);
  const match = withMinutes || hourOnly;
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = withMinutes ? Number(match[2]) : 0;
  const suffix = withMinutes ? match[3] : match[2];
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return { hour, minute, twelveHour: !suffix };
};

export function callPrepRequested(message: string): boolean {
  return CALL_PREP_TOPIC.test(String(message || ""));
}

export function scoreUpcomingCallForMessage(
  call: any,
  message: string,
  companyName = "",
  now = new Date()
): number {
  const needle = normalCallText(message);
  if (!needle) return 0;
  const prep = call?.prep && typeof call.prep === "object" ? call.prep : {};
  const attendees = Array.isArray(call?.attendees) ? call.attendees : [];
  const haystack = normalCallText([
    call?.title,
    call?.intent,
    prep?.candidate,
    prep?.brief,
    companyName,
    ...attendees.map((attendee: any) => `${attendee?.name || ""} ${attendee?.email || ""}`),
  ].join(" "));
  const messageTokens = needle
    .split(" ")
    .filter((token) => token.length >= 3 && !CALL_MATCH_STOP.has(token));
  const callTokens = new Set(
    haystack
      .split(" ")
      .filter((token) => token.length >= 3 && !CALL_MATCH_STOP.has(token))
  );

  let score = 0;
  for (const token of messageTokens) {
    if (callTokens.has(token)) score += token.length >= 5 ? 6 : 4;
  }

  const callDate = call?.scheduled_at
    ? londonDateKey(new Date(call.scheduled_at))
    : "";
  const today = londonDateKey(now);
  if (/\btomorrow\b/i.test(message))
    score += callDate === nextDateKey(today) ? 18 : -8;
  else if (/\btoday\b/i.test(message))
    score += callDate === today ? 18 : -8;

  const askedTime = requestedClock(message);
  if (askedTime && call?.scheduled_at) {
    const actual = callClock(call.scheduled_at);
    const hourMatches = askedTime.twelveHour
      ? actual.hour % 12 === askedTime.hour % 12
      : actual.hour === askedTime.hour;
    score += hourMatches && actual.minute === askedTime.minute ? 18 : -5;
  }
  return score;
}

const compactPrepText = (value: unknown, max: number) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
};

export async function gatherUpcomingCallPrepContext(
  message: string
): Promise<string> {
  if (!callPrepRequested(message)) return "";

  const now = new Date();
  const requestScope = getRequestScope();
  let callsQuery = supabaseAdmin
    .from("upcoming_calls")
    .select("id, company_id, title, scheduled_at, intent, prepped, prep, attendees")
    .gte("scheduled_at", new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString())
    .lte("scheduled_at", new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(60);
  if (requestScope && requestScope.role !== "owner") {
    callsQuery = callsQuery.eq("owner_id", requestScope.userId);
  }
  const { data: calls, error } = await callsQuery;
  const prepCalls = (calls || []).filter((call: any) =>
    isPrepEligibleCalendarEvent(call)
  );
  if (error || !prepCalls.length) return "";

  const companyIds = [...new Set(prepCalls.map((call: any) => call.company_id).filter(Boolean))];
  const companyNames = new Map<string, string>();
  if (companyIds.length) {
    const { data: companies } = await supabaseAdmin
      .from("companies")
      .select("id, name")
      .in("id", companyIds);
    for (const company of companies || [])
      companyNames.set(company.id, company.name || "");
  }

  const ranked = (prepCalls as any[])
    .map((call) => ({
      call,
      score: scoreUpcomingCallForMessage(
        call,
        message,
        companyNames.get(call.company_id) || "",
        now
      ),
    }))
    .sort((a, b) => b.score - a.score || new Date(a.call.scheduled_at).getTime() - new Date(b.call.scheduled_at).getTime());
  const best = ranked[0]?.score || 0;
  if (best < 4) return "";
  const matches = ranked.filter((row) => row.score >= best - 3).slice(0, 2);

  const wantsQuestions = /\b(question|questions|what\s+(?:should|do)\s+i\s+ask)\b/i.test(message);
  const wantsPlan = /\b(prep|preparation|playbook|battle\s*plan|game\s*plan|call\s*plan|agenda|talking\s*points?)\b/i.test(message);
  const wantsIntent = /\bintent\b/i.test(message);
  const lines = [
    "ON-DEMAND SAVED CALL PREP (loaded only because the user asked about a specific meeting; use this as the authoritative source):",
  ];

  for (const { call } of matches) {
    const prep = call.prep && typeof call.prep === "object" ? call.prep : null;
    const when = new Date(call.scheduled_at).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push("", `CALL: ${when}, ${call.title || "Untitled call"}`);
    if (call.intent)
      lines.push(`Intent: ${compactPrepText(call.intent, wantsIntent || wantsPlan ? 1200 : 700)}`);
    if (!prep) {
      lines.push("Saved focus and plan: not built yet.");
      continue;
    }
    const focus = Array.isArray(prep.selectedComps)
      ? prep.selectedComps.filter((item: any) => typeof item === "string" && item.trim()).slice(0, 10)
      : [];
    if (focus.length) {
      lines.push("Ranked focus:");
      for (const item of focus) lines.push(`- ${compactPrepText(item, 180)}`);
    }
    const questions = Array.isArray(prep.openingQuestions)
      ? prep.openingQuestions.slice(0, 8)
      : [];
    if ((wantsQuestions || wantsPlan) && questions.length) {
      lines.push("Saved opening questions:");
      for (const item of questions) {
        const text = typeof item === "string" ? item : item?.text || item?.q || "";
        const why = typeof item === "object" ? item?.why || "" : "";
        if (text)
          lines.push(`- ${compactPrepText(text, 260)}${why ? ` (Why: ${compactPrepText(why, 150)})` : ""}`);
      }
    }
    if (wantsPlan) {
      if (prep.character) lines.push(`Approach: ${compactPrepText(prep.character, 500)}`);
      const playbook = Array.isArray(prep.playbook) ? prep.playbook.slice(0, 8) : [];
      if (playbook.length) {
        lines.push("Saved battle plan:");
        for (const item of playbook) {
          if (item?.label || item?.detail)
            lines.push(`- ${compactPrepText(item?.label, 100)}: ${compactPrepText(item?.detail, 300)}`);
        }
      }
      const goals = Array.isArray(prep.goals) ? prep.goals.slice(0, 8) : [];
      if (goals.length) {
        lines.push("Desired outcomes:");
        for (const item of goals) {
          const text = typeof item === "string" ? item : item?.text || "";
          if (text) lines.push(`- ${compactPrepText(text, 220)}`);
        }
      }
      const privateNotes = Array.isArray(prep.privateNotes) ? prep.privateNotes.slice(0, 5) : [];
      if (privateNotes.length) {
        lines.push("Private reminders:");
        for (const item of privateNotes) lines.push(`- ${compactPrepText(item, 220)}`);
      }
    }
  }
  return lines.join("\n");
}

// Find the client(s) the user NAMED in their message, so the assistant can pull
// their FULL detail on demand instead of dumping every client's full record into
// every prompt. Matches the whole name, or a distinctive word from it (length
// >= 4, minus generic words), on word boundaries. Conservative cap of 3 so a
// vague question never drags in half the book.
const NAME_STOP = new Set([
  "university","college","of","the","and","referrals","city","group","ltd",
  "school","global","limited","inc",
]);
export async function findCompaniesNamedIn(
  message: string
): Promise<{ id: string; name: string }[]> {
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const m = ` ${norm(message)} `;
  if (m.trim().length < 2) return [];
  const requestScope = getRequestScope();
  let companiesQuery = supabaseAdmin
    .from("companies")
    .select("id, owner_id, name, profile")
    .limit(500);
  if (requestScope && requestScope.role !== "owner") {
    companiesQuery = companiesQuery.eq("owner_id", requestScope.userId);
  }
  const { data } = await companiesQuery;
  const ownedCompanies = (data || []).filter(
    (company: any) =>
      !requestScope || company.owner_id === requestScope.userId
  );
  let visibleCompanies: any[] = [...ownedCompanies];
  if (requestScope) {
    const grants = await listVisibleClientGrants(requestScope.workspaceId);
    const sharedIds = brainSharedClientIds(grants, requestScope);
    const ownedIds = new Set(ownedCompanies.map((company: any) => company.id));
    const sharedCompanies = await loadSafeSharedCompanies(
      sharedIds.filter((id) => !ownedIds.has(id)),
      requestScope.workspaceId
    );
    visibleCompanies = [...visibleCompanies, ...sharedCompanies];
  }
  const out: { id: string; name: string }[] = [];
  for (const c of visibleCompanies) {
    const full = norm(c.name);
    let matched = full.length >= 4 && m.includes(` ${full} `);
    if (!matched) {
      const toks = full
        .split(" ")
        .filter((t) => t.length >= 4 && !NAME_STOP.has(t));
      for (const t of toks) {
        if (m.includes(` ${t} `)) {
          matched = true;
          break;
        }
      }
    }
    // Learned aliases (e.g. "elaine" -> Alain). A saved mispronunciation resolves
    // to the right client with no prompt.
    if (!matched) {
      const aliases = Array.isArray((c.profile || {}).aliases)
        ? (c.profile as any).aliases
        : [];
      for (const a of aliases) {
        const na = norm(String(a || ""));
        if (na.length >= 2 && m.includes(` ${na} `)) {
          matched = true;
          break;
        }
      }
    }
    if (matched) out.push({ id: c.id, name: c.name });
    if (out.length >= 3) break;
  }
  return out;
}

// Resolve a named PERSON to one active relationship thread. This is deliberately
// conservative: if the same person belongs to two active workstreams, Brain is
// given neither and must ask which relationship the user means.
export async function findWorkstreamsNamedIn(message: string): Promise<
  {
    companyId: string;
    companyName: string;
    workstreamId: string;
    workstreamName: string;
    departmentName: string | null;
    contactName: string;
  }[]
> {
  const normal = (value: unknown) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const words = new Set(normal(message).split(" ").filter(Boolean));
  const contactStop = new Set([
    "the",
    "and",
    "for",
    "from",
    "with",
    "that",
    "this",
    "what",
    "when",
    "where",
    "who",
    "why",
    "how",
    "call",
    "email",
    "client",
  ]);
  const contactAliases: Record<string, string> = {
    tim: "timothy",
    dan: "daniel",
    dani: "daniela",
    matt: "matthew",
    mike: "michael",
    steve: "steven",
    chris: "christopher",
    liz: "elizabeth",
  };
  if (!words.size) return [];
  const requestScope = getRequestScope();
  let contactsQuery = supabaseAdmin
    .from("contacts")
    .select("id, company_id, name")
    .limit(500);
  if (requestScope && requestScope.role !== "owner") {
    contactsQuery = contactsQuery.eq("owner_id", requestScope.userId);
  }
  const { data: contacts } = await contactsQuery;
  const matched = (contacts || []).filter((contact: any) => {
    const full = normal(contact.name);
    if (!full) return false;
    if (` ${normal(message)} `.includes(` ${full} `)) return true;
    const first = full.split(" ")[0] || "";
    return [...words].some(
      (word) =>
        word.length >= 3 &&
        !contactStop.has(word) &&
        (word === first || contactAliases[word] === first)
    );
  });
  if (!matched.length) return [];

  const contactIds = matched.map((contact: any) => contact.id);
  const { data: links } = await supabaseAdmin
    .from("workstream_contacts")
    .select("contact_id, workstream_id")
    .in("contact_id", contactIds);
  const workstreamIds = Array.from(
    new Set((links || []).map((link: any) => String(link.workstream_id)))
  );
  if (!workstreamIds.length) return [];
  const { data: threads } = await supabaseAdmin
    .from("workstreams")
    .select("id, company_id, department_id, name, status")
    .eq("status", "active")
    .in("id", workstreamIds);
  const companyIds = Array.from(
    new Set((threads || []).map((thread: any) => String(thread.company_id)))
  );
  const departmentIds = Array.from(
    new Set(
      (threads || [])
        .map((thread: any) => thread.department_id)
        .filter(Boolean)
        .map(String)
    )
  );
  const [{ data: companies }, { data: departments }] = await Promise.all([
    supabaseAdmin.from("companies").select("id, name").in("id", companyIds),
    departmentIds.length
      ? supabaseAdmin.from("departments").select("id, name").in("id", departmentIds)
      : Promise.resolve({ data: [] }),
  ]);
  const companyName = new Map(
    (companies || []).map((company: any) => [company.id, company.name])
  );
  const departmentName = new Map(
    (departments || []).map((department: any) => [department.id, department.name])
  );
  const out: {
    companyId: string;
    companyName: string;
    workstreamId: string;
    workstreamName: string;
    departmentName: string | null;
    contactName: string;
  }[] = [];
  for (const contact of matched as any[]) {
    const contactThreadIds = (links || [])
      .filter((link: any) => link.contact_id === contact.id)
      .map((link: any) => link.workstream_id);
    const contactThreads = (threads || []).filter((thread: any) =>
      contactThreadIds.includes(thread.id)
    );
    if (contactThreads.length !== 1) continue;
    const thread: any = contactThreads[0];
    if (out.some((item) => item.workstreamId === thread.id)) continue;
    out.push({
      companyId: thread.company_id,
      companyName: companyName.get(thread.company_id) || "Unknown company",
      workstreamId: thread.id,
      workstreamName: thread.name,
      departmentName: thread.department_id
        ? departmentName.get(thread.department_id) || null
        : null,
      contactName: contact.name,
    });
    if (out.length >= 3) break;
  }
  return out;
}

// Give the Brain live outreach awareness without putting the contact database,
// full email bodies or research JSON into every model request. The normal block
// is one compact roll-up. Deeper breakdowns and a few recent replies are added
// only for an outreach/priority question, while explicitly named prospects are
// included on demand.
export async function gatherOutreachContext(
  message: string,
  options: { detailed?: boolean } = {}
): Promise<string> {
  const cut = (value: unknown, max: number) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  };
  const requestScope = getRequestScope();
  const limitedScope = isLimitedBrainScope(requestScope);
  const senderUserId = personalOutreachSenderId(requestScope);
  const { start, end } = londonDayBounds();
  let learningsQuery: any = options.detailed
    ? supabaseAdmin
        .from("outreach_learnings")
        .select("dimension,label,insight,confidence,positive_reply_count,meeting_count")
        .eq("status", "promoted")
        .order("meeting_count", { ascending: false })
        .order("positive_reply_count", { ascending: false })
        .limit(5)
    : Promise.resolve({ data: [] as any[] });
  let sentQuery = supabaseAdmin
    .from("outreach_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", start)
    .lt("sent_at", end);
  let approvedQuery = supabaseAdmin
    .from("outreach_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved");
  let prospectsQuery = supabaseAdmin
    .from("outreach_prospects")
    .select("id,first_name,last_name,company_name,email,job_title,priority,status,reply_category,reply_summary,last_reply_at,assigned_to_user_id")
    .limit(1000);
  if (requestScope) {
    learningsQuery = options.detailed
      ? learningsQuery.eq("workspace_id", requestScope.workspaceId)
      : learningsQuery;
    sentQuery = sentQuery.eq("workspace_id", requestScope.workspaceId);
    approvedQuery = approvedQuery.eq("workspace_id", requestScope.workspaceId);
    prospectsQuery = prospectsQuery.eq("workspace_id", requestScope.workspaceId);
  }
  if (senderUserId) {
    sentQuery = sentQuery.eq("sender_user_id", senderUserId);
    approvedQuery = approvedQuery.eq("sender_user_id", senderUserId);
    prospectsQuery = prospectsQuery.eq(
      "assigned_to_user_id",
      senderUserId
    );
  }
  const claimableQuery = limitedScope
    ? supabaseAdmin
        .from("outreach_prospects")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", requestScope!.workspaceId)
        .is("assigned_to_user_id", null)
    : Promise.resolve({ count: 0 });

  const campaignPromise = requestScope
    ? resolveOutreachCampaignSelection(
        requestScope.userId,
        requestScope.workspaceId
      )
    : supabaseAdmin
        .from("outreach_campaigns")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()
        .then((result) => ({ campaign: result.data }));
  const [
    campaignSelection,
    prospectsRes,
    sentRes,
    approvedRes,
    claimableRes,
    learningsRes,
  ] =
    await Promise.all([
      campaignPromise,
      prospectsQuery,
      sentQuery,
      approvedQuery,
      claimableQuery,
      learningsQuery,
    ]);

  const allVisibleProspects = (prospectsRes.data || []) as any[];
  const partition = partitionBrainOutreach(
    allVisibleProspects,
    requestScope
  );
  const prospects = partition.actionable;
  const campaign = campaignSelection.campaign as any;
  const priority = { high: 0, medium: 0, low: 0 };
  const status = new Map<string, number>();
  for (const prospect of prospects) {
    const p = String(prospect.priority || "").toLowerCase();
    if (p === "high" || p === "medium" || p === "low") priority[p]++;
    const s = String(prospect.status || "not set");
    status.set(s, (status.get(s) || 0) + 1);
  }
  const replies = prospects.filter((p) => p.last_reply_at);
  const positive = replies.filter((p) => p.reply_category === "interested").length;
  const sentToday = sentRes.count || 0;
  const approved = approvedRes.count || 0;
  const dailyLimit = Math.min(20, Math.max(1, Number(campaign?.daily_limit) || 20));
  const lines = limitedScope
    ? [
        `PERSONAL OUTREACH QUEUE (only work assigned to this member, no teammate reply details loaded): ${prospects.length} assigned prospects, ${priority.high} high priority, ${sentToday}/${dailyLimit} sent by this member today, ${approved} approved for this member, ${replies.length} replies (${positive} interested).`,
        `WORKSPACE AVAILABILITY (context only, not this member's work): ${claimableRes.count || 0} unassigned prospects can be claimed in Outreach. Other people's assigned prospects and reply details were not loaded and must not be recommended as this member's next actions.`,
      ]
    : [
        `OUTREACH SNAPSHOT (compact live roll-up, no full emails or research loaded): ${prospects.length} prospects, ${priority.high} high priority, ${sentToday}/${dailyLimit} sent today, ${approved} approved, ${replies.length} replies (${positive} interested). Active campaign: ${campaign?.name || "none"}.`,
      ];

  if (limitedScope && campaign?.name) {
    lines.push(
      `Workspace campaign context: ${campaign.name}. A shared campaign name does not make another person's prospects actionable for this member.`
    );
  }

  // Resolve identity from the compact assigned prospect rows first. Only when
  // the user actually names a prospect do we fetch saved research for those
  // few same-name candidates. This keeps normal Brain turns cheap and avoids
  // loading hundreds of research objects merely to build the queue roll-up.
  const identityCandidates = rankNamedOutreachProspects(message, prospects, 25);
  let named = identityCandidates.slice(0, 3);
  if (identityCandidates.length) {
    let namedResearchQuery = supabaseAdmin
      .from("outreach_prospects")
      .select("id,research,last_researched_at")
      .in(
        "id",
        identityCandidates.map((prospect) => prospect.id)
      );
    if (requestScope) {
      namedResearchQuery = namedResearchQuery.eq(
        "workspace_id",
        requestScope.workspaceId
      );
    }
    if (senderUserId) {
      namedResearchQuery = namedResearchQuery.eq(
        "assigned_to_user_id",
        senderUserId
      );
    }
    const { data: namedResearch } = await namedResearchQuery;
    const researchById = new Map(
      (namedResearch || []).map((row: any) => [row.id, row])
    );
    const enrichedCandidates = identityCandidates.map((prospect: any) => ({
      ...prospect,
      ...(researchById.get(prospect.id) || {}),
    }));
    named = rankNamedOutreachProspects(message, enrichedCandidates, 3);
  }

  // Named evidence must precede generic roll-ups so the defensive prompt cap
  // can never trim away the answer to the user's specific follow-up.
  if (named.length) {
    lines.push(
      "NAMED OUTREACH REFERENCE CANDIDATES. These are ranked by exact identity and overlap between the user's referenced fact and research already saved for this account. If one candidate uniquely contains that fact, answer with that person's full name and the saved source detail. Ask only when the evidence remains genuinely tied: " +
        named
          .map((p) => {
            const researchFacts = compactOutreachResearchFacts(p.research)
              .map((fact) => cut(fact, 260));
            return `${cut(`${p.first_name || ""} ${p.last_name || ""}`, 50)} at ${cut(p.company_name, 60)}, ${cut(p.job_title, 60) || "role not recorded"}, ${p.priority || "priority not set"}, status ${p.status || "not set"}${p.reply_summary ? `, last reply: ${cut(p.reply_summary, 200)}` : ""}. ${
              researchFacts.length
                ? `Saved research: ${researchFacts.join(" | ")}`
                : "No saved research evidence."
            }`;
          })
          .join(" | ")
    );
  }

  if (options.detailed) {
    const statusSummary = [...status.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, count]) => `${label} ${count}`)
      .join(", ");
    lines.push(
      `Priorities: high ${priority.high}, medium ${priority.medium}, low ${priority.low}. Statuses: ${statusSummary || "none"}.`
    );
    const recent = [...replies]
      .sort((a, b) => new Date(b.last_reply_at).getTime() - new Date(a.last_reply_at).getTime())
      .slice(0, 5);
    if (recent.length) {
      lines.push(
        "Recent replies: " +
          recent
            .map((p) => `${cut(`${p.first_name || ""} ${p.last_name || ""}`, 50)} at ${cut(p.company_name, 60)} [${p.reply_category || "unclassified"}]: ${cut(p.reply_summary, 180) || "no summary"}`)
            .join(" | ")
      );
    }
    const learnings = ((learningsRes as any).data || []) as any[];
    if (learnings.length) {
      lines.push(
        "Promoted outreach learnings: " +
          learnings.map((l) => `${cut(l.dimension, 24)} ${cut(l.label, 60)}: ${cut(l.insight, 160)}`).join(" | ")
      );
    }
  }

  // Defensive prompt budget cap even if future labels or summaries grow.
  return lines.join("\n").slice(0, 3_500);
}
