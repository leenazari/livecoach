import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  openai,
  OPENAI_MODEL_LIVE,
  OPENAI_MODEL_BRAIN,
} from "@/lib/openai";
import {
  gatherClientContext,
  gatherGlobalContext,
  gatherUpcomingCallPrepContext,
  gatherOutreachContext,
  findCompaniesNamedIn,
  findWorkstreamsNamedIn,
} from "@/lib/crm-context";
import { getCommercialMemoryBlock } from "@/lib/commercial-memory";
import {
  workspaceContextBlock,
  getLessonsBlock,
  getBrainQuestions,
  getRelevantPitchingLessons,
} from "@/lib/workspace";
import { logModelUsage } from "@/lib/usage";
import { RELATIONSHIP_STAGE_BY_KEY } from "@/lib/relationship-stages";
import { resolveExistingCompany } from "@/lib/company-resolver";
import {
  callTranscriptRequested,
  gatherCallTranscriptContext,
} from "@/lib/call-transcript-context";
import {
  actionWasAlreadyProposed,
  brainActionSignature,
  sameBrainAction,
  type BrainActionSignature,
} from "@/lib/brain-action-signatures";
import { documentBrainContext } from "@/lib/document-context";
import { getSalesProfileContextBlock } from "@/lib/sales-profile";
import { getRequestScope } from "@/lib/request-scope";
import { loadVisibleOpportunities } from "@/lib/opportunity-access";
import {
  exactVisibleContactNamesIn,
  loadBrainIdentityDirectory,
} from "@/lib/brain-self-identity";
import {
  resolveBrainKnownNames,
  type BrainKnownIdentity,
  type BrainKnownNameResolution,
} from "@/lib/brain-self-name";

export const runtime = "nodejs";
export const maxDuration = 40;

// The CRM assistant. With a companyId it's grounded in that ONE client; without
// one it's GLOBAL - it knows every client + your whole pipeline, so you can just
// talk ("show Alan's to-do", "what's my to-do list", "which deal is closest").
// Always explains its reasoning. Drafts on request. Stores the thread (global
// thread = company_id null).
// Resolve a proposed write action's target by NAME/TITLE (never an id the model
// guessed) to a real record, and return a ready-to-fire request the CLIENT runs
// only after the user taps Confirm. Nothing here writes to the database.
function likeTerm(s: string): string {
  return String(s || "").replace(/[%_]/g, "").trim().slice(0, 60);
}
async function findCalls(title: string): Promise<any[]> {
  const term = likeTerm(title);
  if (!term) return [];
  const requestScope = getRequestScope();
  let query = supabaseAdmin
    .from("upcoming_calls")
    .select("id, title, scheduled_at, intent")
    .ilike("title", `%${term}%`)
    .gte("scheduled_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(4);
  if (requestScope && requestScope.role !== "owner") {
    query = query.eq("owner_id", requestScope.userId);
  }
  const { data } = await query;
  return Array.isArray(data) ? data : [];
}
function callWhen(iso: string): string {
  if (!iso) return "no time set";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "no time set";
  }
}
async function findCompany(name: string) {
  const term = likeTerm(name);
  if (!term) return null;
  const company = await resolveExistingCompany(
    { name: term },
    {
      select: "id,name,domain,website,profile,owner_id",
      allowDistinctivePartial: true,
    }
  );
  const requestScope = getRequestScope();
  if (
    company &&
    requestScope &&
    requestScope.role !== "owner" &&
    company.owner_id !== requestScope.userId
  ) {
    return null;
  }
  return company;
}
async function findCompanyById(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const requestScope = getRequestScope();
  let query = supabaseAdmin
    .from("companies")
    .select("id, name")
    .eq("id", id);
  if (requestScope && requestScope.role !== "owner") {
    query = query.eq("owner_id", requestScope.userId);
  }
  const { data } = await query.maybeSingle();
  return data || null;
}
async function findTasks(
  text: string,
  companyId?: string | null,
  statuses: string[] = ["open"]
): Promise<any[]> {
  const term = likeTerm(text);
  if (!term) return [];
  let query = supabaseAdmin
    .from("tasks")
    .select("id, text, due_at, payload, company_id, link_kind")
    .in("status", statuses)
    .ilike("text", `%${term}%`);
  const requestScope = getRequestScope();
  if (requestScope && requestScope.role !== "owner") {
    query = query.eq("owner_id", requestScope.userId);
  }
  if (companyId) query = query.eq("company_id", companyId);
  const { data } = await query.limit(4);
  return data || [];
}
async function findOpenTasks(text: string, companyId?: string | null): Promise<any[]> {
  return findTasks(text, companyId, ["open"]);
}
async function findOpenTask(text: string) {
  const tasks = await findOpenTasks(text);
  return tasks[0] || null;
}
async function findContacts(name: string, companyId: string): Promise<any[]> {
  const term = likeTerm(name);
  if (!term || !companyId) return [];
  const requestScope = getRequestScope();
  let query = supabaseAdmin
    .from("contacts")
    .select("id, name, role, email, attributes")
    .eq("company_id", companyId)
    .ilike("name", `%${term}%`)
    .limit(4);
  if (requestScope && requestScope.role !== "owner") {
    query = query.eq("owner_id", requestScope.userId);
  }
  const { data } = await query;
  return data || [];
}
async function findDraft(subject: string) {
  const term = likeTerm(subject);
  if (!term) return null;
  const requestScope = getRequestScope();
  let query = supabaseAdmin
    .from("follow_ups")
    .select("id, draft_subject")
    .eq("status", "draft")
    .ilike("draft_subject", `%${term}%`)
    .limit(1);
  if (requestScope && requestScope.role !== "owner") {
    query = query.eq("owner_id", requestScope.userId);
  }
  const { data } = await query;
  return data && data[0] ? data[0] : null;
}
async function findCampaign(name: string) {
  const term = likeTerm(name);
  const wantsActive =
    !term || ["active", "current", "active campaign", "current campaign"].includes(term.toLowerCase());
  let q = supabaseAdmin
    .from("outreach_campaigns")
    .select("id, name, status")
    .order("created_at", { ascending: false })
    .limit(1);
  if (wantsActive) q = q.eq("status", "active");
  else q = q.ilike("name", `%${term}%`);
  const { data } = await q;
  return data && data[0] ? data[0] : null;
}
async function findOpportunities(title: string, client: string): Promise<any[]> {
  const company = client ? await findCompany(client) : null;
  const term = likeTerm(title);
  const requestScope = getRequestScope();
  if (!requestScope || (!company && !term)) return [];
  const rows = await loadVisibleOpportunities<any>(requestScope, {
    select:
      "id,title,company_id,status,pipeline_stage,assigned_to_user_id,workspace_id,owner_id,visibility,opportunity_type,updated_at",
    companyId: company?.id,
    orderBy: "updated_at",
    ascending: false,
    limit: 100,
  });
  return rows
    .filter((row: any) =>
      !term || String(row.title || "").toLowerCase().includes(term.toLowerCase())
    )
    .slice(0, 4)
    .map((row: any) => ({
      ...row,
      companyName: company?.name || "client",
    }));
}

function opportunityPatch(item: any): Record<string, any> {
  const patch: Record<string, any> = {};
  const stages = ["new", "discovery", "qualified", "proposal", "negotiation", "verbal", "won", "lost"];
  const forecasts = ["pipeline", "best_case", "commit", "omitted"];
  const statuses = ["open", "won", "lost", "dismissed"];
  const owners = ["us", "buyer", "joint"];
  const types = ["revenue", "investment", "internal", "strategic"];
  const outlooks = ["not_assessed", "at_risk", "possible", "likely", "highly_likely", "won"];
  const motions = ["cold_outreach_campaign", "personal_relationship_led", "existing_customer_expansion", "inbound_enquiry", "partner_referral"];
  const contactMethods = ["automated_email", "personal_email", "phone", "video_call", "linkedin", "event", "in_person", "other"];
  if (stages.includes(item.pipelineStage)) patch.pipelineStage = item.pipelineStage;
  if (forecasts.includes(item.forecastCategory)) patch.forecastCategory = item.forecastCategory;
  if (statuses.includes(item.status)) patch.status = item.status;
  if (owners.includes(item.nextActionOwner)) patch.nextActionOwner = item.nextActionOwner;
  if (types.includes(item.opportunityType)) patch.opportunityType = item.opportunityType;
  if (typeof item.probability === "number" && item.probability >= 0 && item.probability <= 100)
    patch.probability = Math.round(item.probability);
  if (typeof item.value === "number" && item.value >= 0) patch.value = item.value;
  if (item.value === null) patch.value = null;
  if (typeof item.nextAction === "string") patch.nextAction = item.nextAction.trim().slice(0, 500);
  if (typeof item.nextActionDueAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.nextActionDueAt))
    patch.nextActionDueAt = item.nextActionDueAt;
  if (typeof item.expectedCloseAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.expectedCloseAt))
    patch.expectedCloseAt = item.expectedCloseAt;
  if (typeof item.detail === "string") patch.detail = item.detail.trim().slice(0, 1000);
  if (typeof item.title === "string" && item.title.trim())
    patch.title = item.title.trim().slice(0, 240);
  if (typeof item.outcomeReason === "string")
    patch.outcomeReason = item.outcomeReason.trim().slice(0, 1000);
  if (typeof item.dealIntent === "string")
    patch.dealIntent = item.dealIntent.trim().slice(0, 1500);
  if (outlooks.includes(item.winOutlook)) patch.winOutlook = item.winOutlook;
  if (
    typeof item.winOutlookConfidence === "number" &&
    item.winOutlookConfidence >= 0 && item.winOutlookConfidence <= 100
  ) patch.winOutlookConfidence = Math.round(item.winOutlookConfidence);
  if (Array.isArray(item.winOutlookReasons))
    patch.winOutlookReasons = item.winOutlookReasons
      .filter((value: any) => typeof value === "string" && value.trim())
      .slice(0, 8);
  if (Array.isArray(item.winOutlookQuestions))
    patch.winOutlookQuestions = item.winOutlookQuestions
      .filter((value: any) => typeof value === "string" && value.trim())
      .slice(0, 6);
  if (motions.includes(item.engagementMotion)) patch.engagementMotion = item.engagementMotion;
  if (contactMethods.includes(item.activeContactMethod)) patch.activeContactMethod = item.activeContactMethod;
  patch.sourceType = "human";
  patch.sourceChannel = "brain";
  patch.rationale = typeof item.rationale === "string" && item.rationale.trim()
    ? item.rationale.trim().slice(0, 1000)
    : "Confirmed Brain action";
  return patch;
}

function opportunityChangeLabel(patch: Record<string, any>): string {
  const bits: string[] = [];
  if (patch.title) bits.push(`title "${patch.title}"`);
  if (patch.pipelineStage) bits.push(`stage ${patch.pipelineStage}`);
  if (patch.probability != null) bits.push(`probability ${patch.probability}%`);
  if (patch.forecastCategory) bits.push(`forecast ${patch.forecastCategory.replace("_", " ")}`);
  if (patch.nextAction) bits.push(`next action "${patch.nextAction}"`);
  if (patch.nextActionDueAt) bits.push(`due ${patch.nextActionDueAt}`);
  if (patch.expectedCloseAt) bits.push(`expected close ${patch.expectedCloseAt}`);
  if (patch.value != null) bits.push(`value £${patch.value}`);
  if (patch.status) bits.push(`status ${patch.status}`);
  if (patch.opportunityType) bits.push(`type ${patch.opportunityType}`);
  if (patch.outcomeReason) bits.push(`outcome reason "${patch.outcomeReason}"`);
  if (patch.dealIntent) bits.push(`intent "${patch.dealIntent}"`);
  if (patch.winOutlook) bits.push(`win outlook ${patch.winOutlook.replace(/_/g, " ")}`);
  if (patch.engagementMotion) bits.push(`engagement ${patch.engagementMotion.replace(/_/g, " ")}`);
  if (patch.activeContactMethod) bits.push(`contact via ${patch.activeContactMethod.replace(/_/g, " ")}`);
  return bits.slice(0, 4).join(", ");
}
// Build the ready-to-fire request for a call-targeting action against ONE call.
function callExec(call: any, type: string, x: any) {
  if (type === "set_meeting_link")
    return { endpoint: `/api/crm/upcoming/${call.id}`, method: "PATCH", body: { meetingUrl: x.url } };
  if (type === "set_intent")
    return { endpoint: `/api/crm/upcoming/${call.id}`, method: "PATCH", body: { intent: x.intent } };
  if (type === "add_intent") {
    // Append to the call's existing focus rather than overwriting it. If the
    // note is already there (the user is just re-confirming, or it was added
    // before) leave it untouched, so confirming can never duplicate the text.
    const cur = typeof call.intent === "string" ? call.intent.trim() : "";
    const note = String(x.note || "").trim();
    const already = !!note && cur.toLowerCase().includes(note.toLowerCase());
    const next = already ? cur : cur ? `${cur} ${note}` : note;
    return { endpoint: `/api/crm/upcoming/${call.id}`, method: "PATCH", body: { intent: next } };
  }
  if (type === "link_call")
    return { endpoint: `/api/crm/upcoming/${call.id}`, method: "PATCH", body: { companyId: x.companyId } };
  // cancel_call
  return { endpoint: `/api/crm/upcoming/${call.id}/cancel`, method: "POST", body: { reason: x.reason } };
}
function actionVerb(type: string): string {
  return type === "set_meeting_link"
    ? "attach the link to"
    : type === "set_intent"
    ? "set the intent on"
    : type === "add_intent"
    ? "add to the focus for"
    : type === "link_call"
    ? "link"
    : "remove";
}

async function resolveActions(items: any[], defaultCompanyId: string | null = null): Promise<any[]> {
  const out: any[] = [];
  const callTypes = ["set_meeting_link", "set_intent", "add_intent", "link_call", "cancel_call"];
  for (const it of Array.isArray(items) ? items : []) {
    if (out.length >= 6) break;
    if (!it || typeof it.type !== "string") continue;
    const key = Math.random().toString(36).slice(2);

    if (callTypes.includes(it.type)) {
      const calls = await findCalls(String(it.call || ""));
      if (!calls.length) continue;
      // Gather the extras each action needs; skip if a required one is missing.
      const x: any = {};
      let detail = "";
      if (it.type === "set_meeting_link") {
        const url = typeof it.url === "string" ? it.url.trim() : "";
        if (!url) continue;
        x.url = url;
        detail = `: ${url}`;
      } else if (it.type === "set_intent") {
        x.intent = typeof it.intent === "string" ? it.intent.trim() : "";
        detail = x.intent ? `: ${x.intent}` : " (clear it)";
      } else if (it.type === "add_intent") {
        x.note =
          typeof it.note === "string"
            ? it.note.trim()
            : typeof it.intent === "string"
            ? it.intent.trim()
            : "";
        if (!x.note) continue;
        detail = `: ${x.note}`;
      } else if (it.type === "link_call") {
        const company = await findCompany(String(it.client || ""));
        if (!company) continue;
        x.companyId = company.id;
        detail = ` to ${company.name}`;
      } else if (it.type === "cancel_call") {
        x.reason = typeof it.reason === "string" ? it.reason.trim() : "";
        detail = x.reason ? ` (reason: ${x.reason})` : " (off the calendar)";
      }
      const verb = actionVerb(it.type);
      if (calls.length === 1) {
        const ex = callExec(calls[0], it.type, x);
        out.push({
          key,
          type: it.type,
          label: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} "${calls[0].title}"${detail}`,
          endpoint: ex.endpoint,
          method: ex.method,
          body: ex.body,
        });
      } else {
        // Ambiguous - more than one matching call. Ask the user which one
        // rather than guessing (the "which Joydeep call?" case).
        out.push({
          key,
          type: it.type,
          label: `More than one call matches. Which one should I ${verb}${detail}?`,
          choices: calls.slice(0, 4).map((c: any) => {
            const ex = callExec(c, it.type, x);
            return {
              label: `${c.title || "call"} - ${callWhen(c.scheduled_at)}`,
              endpoint: ex.endpoint,
              method: ex.method,
              body: ex.body,
            };
          }),
        });
      }
      continue;
    }

    if (it.type === "create_client") {
      const name = (typeof it.name === "string" ? it.name : it.client || "")
        .toString()
        .trim();
      if (!name) continue;
      // Don't duplicate someone already in the pipeline.
      const existing = await findCompany(name);
      if (existing) continue;
      const brief =
        typeof it.brief === "string"
          ? it.brief.trim()
          : typeof it.background === "string"
          ? it.background.trim()
          : "";
      out.push({
        key,
        type: it.type,
        label: `Create a profile for "${name}"`,
        endpoint: `/api/crm/companies`,
        method: "POST",
        body: brief ? { name, notes: brief } : { name },
      });
      continue;
    }

    if (it.type === "update_client") {
      const named = it.client ? await findCompany(String(it.client)) : null;
      const company = named || (!it.client && defaultCompanyId
        ? await findCompanyById(defaultCompanyId)
        : null);
      if (!company) continue;
      const patch: Record<string, string | boolean | null> = {};
      if (typeof it.stage === "string") {
        const stage = RELATIONSHIP_STAGE_BY_KEY.get(it.stage.trim().toLowerCase());
        if (stage) patch.stage = stage;
      }
      for (const field of ["sector", "website", "domain"] as const) {
        if (typeof it[field] === "string" && it[field].trim())
          patch[field] = it[field].trim().slice(0, 240);
      }
      if (typeof it.name === "string" && it.name.trim())
        patch.name = it.name.trim().slice(0, 240);
      if (typeof it.notes === "string" || it.notes === null)
        patch.notes = typeof it.notes === "string" ? it.notes.trim().slice(0, 4000) || null : null;
      if (typeof it.emailContext === "string" || it.emailContext === null)
        patch.email_context =
          typeof it.emailContext === "string"
            ? it.emailContext.trim().slice(0, 6000) || null
            : null;
      if (it.removeFromPipeline === true) {
        patch.removeFromPipeline = true;
        patch.sourceType = "human";
        patch.sourceChannel = "brain_confirmed_client_update";
        patch.rationale =
          typeof it.rationale === "string" && it.rationale.trim()
            ? it.rationale.trim().slice(0, 1000)
            : "User confirmed this relationship is not an active sales prospect";
      }
      if (!Object.keys(patch).length) continue;
      out.push({
        key,
        type: it.type,
        label: `Update ${company.name}: ${Object.entries(patch)
          .map(([field, value]) => `${field} "${value}"`)
          .join(", ")}`,
        endpoint: `/api/crm/companies/${company.id}`,
        method: "PATCH",
        body: patch,
      });
      continue;
    }

    if (it.type === "upsert_stakeholder") {
      const person = String(it.person || it.name || "").trim();
      const named = it.client ? await findCompany(String(it.client)) : null;
      const company = named || (!it.client && defaultCompanyId
        ? await findCompanyById(defaultCompanyId)
        : null);
      if (!person || !company) continue;
      const buyingRoles = new Set([
        "decision_maker",
        "champion",
        "user",
        "influencer",
        "blocker",
        "unknown",
      ]);
      const influences = new Set(["high", "medium", "low"]);
      const engagements = new Set(["warm", "neutral", "cold"]);
      const stakeholderPatch: Record<string, string> = {};
      if (buyingRoles.has(it.buyingRole))
        stakeholderPatch.stakeholderRole = it.buyingRole;
      if (influences.has(it.influence))
        stakeholderPatch.stakeholderInfluence = it.influence;
      if (engagements.has(it.engagement))
        stakeholderPatch.stakeholderEngagement = it.engagement;
      const jobTitle = typeof it.jobTitle === "string" ? it.jobTitle.trim().slice(0, 160) : "";
      const email = typeof it.email === "string" ? it.email.trim().slice(0, 240) : "";
      if (!Object.keys(stakeholderPatch).length && !jobTitle && !email) continue;

      let contacts = await findContacts(person, company.id);
      const exact = contacts.filter(
        (contact) => String(contact.name).trim().toLowerCase() === person.toLowerCase()
      );
      if (exact.length === 1) contacts = exact;
      const roleLabel = stakeholderPatch.stakeholderRole
        ? stakeholderPatch.stakeholderRole.replace(/_/g, " ")
        : "stakeholder details";
      const updateFor = (contact: any) => ({
        label: `${contact.name} at ${company.name}`,
        endpoint: `/api/crm/contacts/${contact.id}`,
        method: "PATCH",
        body: {
          ...(jobTitle ? { role: jobTitle } : {}),
          ...(email ? { email } : {}),
          attributes: { ...(contact.attributes || {}), ...stakeholderPatch },
        },
      });

      if (contacts.length === 1) {
        const exec = updateFor(contacts[0]);
        out.push({
          key,
          type: it.type,
          label: stakeholderPatch.stakeholderRole
            ? `Set ${exec.label} as ${roleLabel}`
            : `Update stakeholder details for ${exec.label}`,
          endpoint: exec.endpoint,
          method: exec.method,
          body: exec.body,
        });
      } else if (contacts.length > 1) {
        out.push({
          key,
          type: it.type,
          label: `Which ${person} at ${company.name} should I set as ${roleLabel}?`,
          choices: contacts.map(updateFor),
        });
      } else {
        out.push({
          key,
          type: it.type,
          label: `Add ${person} to ${company.name} as ${roleLabel}`,
          endpoint: "/api/crm/contacts",
          method: "POST",
          body: {
            company_id: company.id,
            name: person,
            ...(jobTitle ? { role: jobTitle } : {}),
            ...(email ? { email } : {}),
            attributes: stakeholderPatch,
          },
        });
      }
      continue;
    }

    if (it.type === "update_contact") {
      const person = String(it.person || "").trim();
      const named = it.client ? await findCompany(String(it.client)) : null;
      const company = named || (!it.client && defaultCompanyId
        ? await findCompanyById(defaultCompanyId)
        : null);
      if (!person || !company) continue;
      const contacts = await findContacts(person, company.id);
      const patch: Record<string, string | null> = {};
      if (typeof it.newName === "string" && it.newName.trim())
        patch.name = it.newName.trim().slice(0, 240);
      for (const field of ["role", "email", "sector", "notes"] as const) {
        if (typeof it[field] === "string" || it[field] === null)
          patch[field] =
            typeof it[field] === "string"
              ? it[field].trim().slice(0, field === "notes" ? 4000 : 240) || null
              : null;
      }
      if (!contacts.length || !Object.keys(patch).length) continue;
      const updateFor = (contact: any) => ({
        label: `${contact.name} at ${company.name}`,
        endpoint: `/api/crm/contacts/${contact.id}`,
        method: "PATCH",
        body: patch,
      });
      if (contacts.length === 1) {
        const exec = updateFor(contacts[0]);
        out.push({
          key,
          type: it.type,
          label: `Edit contact ${exec.label}: ${Object.keys(patch).join(", ")}`,
          endpoint: exec.endpoint,
          method: exec.method,
          body: exec.body,
        });
      } else {
        out.push({
          key,
          type: it.type,
          label: `Which ${person} at ${company.name} should I edit?`,
          choices: contacts.map(updateFor),
        });
      }
      continue;
    }

    if (it.type === "log_client_update") {
      const content = typeof it.content === "string" ? it.content.trim() : "";
      if (!content) continue;
      const company = it.client ? await findCompany(String(it.client)) : null;
      // A named but unresolved client must never fall back to the profile that
      // happens to be open. That could silently attach a phone note to the
      // wrong relationship. The model can instead ask the user to clarify.
      if (it.client && !company) continue;
      const companyId = company?.id || (!it.client ? defaultCompanyId : null);
      if (!companyId) continue;
      const channel = ["phone", "text", "voice", "note"].includes(it.channel)
        ? it.channel
        : "note";
      const titleByChannel: Record<string, string> = {
        phone: "Phone call",
        text: "Text message",
        voice: "Voice note",
        note: "General note",
      };
      out.push({
        key,
        type: it.type,
        label: `Log and apply ${titleByChannel[channel].toLowerCase()} intelligence for ${company?.name || "this client"}: ${content.slice(0, 180)}`,
        endpoint: `/api/crm/companies/${companyId}/activity`,
        method: "POST",
        body: {
          channel,
          content: content.slice(0, 2000),
          autoApply: true,
        },
      });
      continue;
    }

    if (it.type === "create_document") {
      const title = typeof it.title === "string" ? it.title.trim().slice(0, 220) : "";
      const instructions =
        typeof it.instructions === "string"
          ? it.instructions.trim().slice(0, 6000)
          : "";
      if (!title || !instructions) continue;

      const namedCompany = it.client ? await findCompany(String(it.client)) : null;
      if (it.client && !namedCompany) continue;
      let companyId = namedCompany?.id || (!it.client ? defaultCompanyId : null);
      let taskId: string | null = null;
      const sourceTask =
        typeof it.sourceTask === "string" ? it.sourceTask.trim().slice(0, 500) : "";
      if (sourceTask) {
        let tasks = await findOpenTasks(sourceTask, companyId);
        const exact = tasks.filter(
          (task) =>
            String(task.text || "").trim().toLowerCase() === sourceTask.toLowerCase()
        );
        if (exact.length === 1) tasks = exact;
        if (tasks.length !== 1) continue;
        taskId = tasks[0].id;
        if (!companyId && tasks[0].company_id) companyId = tasks[0].company_id;
        if (
          companyId &&
          tasks[0].company_id &&
          tasks[0].company_id !== companyId
        )
          continue;
      }
      const allowedDocumentTypes = new Set([
        "plan",
        "agreement",
        "handbook",
        "proposal",
        "report",
        "brief",
        "other",
      ]);
      const documentType = allowedDocumentTypes.has(it.documentType)
        ? it.documentType
        : "other";
      out.push({
        key,
        type: it.type,
        label: `Create Word document "${title}" in the background`,
        endpoint: "/api/crm/documents",
        method: "POST",
        body: {
          title,
          instructions,
          documentType,
          companyId,
          taskId,
          idempotencyKey: `brain-${key}`,
        },
      });
      continue;
    }

    if (it.type === "create_task") {
      const text = typeof it.text === "string" ? it.text.trim() : "";
      if (!text) continue;
      const company = it.client ? await findCompany(String(it.client)) : null;
      out.push({
        key,
        type: it.type,
        label: `Add to-do: "${text.slice(0, 500)}"${company ? ` for ${company.name}` : ""}`,
        endpoint: "/api/crm/tasks",
        method: "POST",
        body: {
          companyId: company?.id || defaultCompanyId,
          text: text.slice(0, 500),
          action: ["email", "call", "task"].includes(it.action) ? it.action : "task",
          dueAt:
            typeof it.dueAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(it.dueAt)
              ? it.dueAt
              : null,
          pinned: it.pinned === true,
        },
      });
      continue;
    }

    if (it.type === "update_task") {
      const query = String(it.item || it.task || "").trim();
      const namedCompany = it.client ? await findCompany(String(it.client)) : null;
      if (it.client && !namedCompany) continue;
      const taskCompanyId = namedCompany?.id || (!it.client ? defaultCompanyId : null);
      const tasks = await findTasks(
        query,
        taskCompanyId,
        it.status === "open" ? ["done", "dismissed", "open"] : ["open"]
      );
      if (!tasks.length) continue;
      const patchFor = (task: any) => {
        const patch: Record<string, any> = {};
        if (it.status === "done" || it.status === "open") patch.status = it.status;
        if (typeof it.newText === "string" && it.newText.trim())
          patch.text = it.newText.trim().slice(0, 500);
        if (typeof it.dueAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(it.dueAt))
          patch.dueAt = it.dueAt.slice(0, 10);
        else if (it.dueAt === null) patch.dueAt = null;
        if (typeof it.pinned === "boolean")
          patch.payload = { ...(task.payload || {}), pinned: it.pinned };
        if (["email", "call", "task"].includes(it.action))
          patch.action = it.action;
        return patch;
      };
      const describe = (task: any) => {
        const patch = patchFor(task);
        const changes: string[] = [];
        if (patch.status === "done") changes.push("mark done");
        if (patch.status === "open") changes.push("re-open");
        if (patch.text) changes.push(`rename to "${patch.text}"`);
        if ("dueAt" in patch) changes.push(patch.dueAt ? `due ${patch.dueAt}` : "clear deadline");
        if (patch.payload) changes.push(patch.payload.pinned ? "pin" : "unpin");
        if (patch.action) changes.push(`change action to ${patch.action}`);
        return changes.join(", ");
      };
      const executable = tasks
        .map((task) => ({ task, patch: patchFor(task) }))
        .filter(({ patch }) => Object.keys(patch).length > 0);
      if (!executable.length) continue;
      if (executable.length === 1) {
        const { task, patch } = executable[0];
        out.push({
          key,
          type: it.type,
          label: `Update to-do "${task.text}": ${describe(task)}`,
          endpoint: `/api/crm/tasks/${task.id}`,
          method: "PATCH",
          body: patch,
        });
      } else {
        out.push({
          key,
          type: it.type,
          label: `Which to-do should I ${describe(executable[0].task)}?`,
          choices: executable.map(({ task, patch }) => ({
            label: task.text,
            endpoint: `/api/crm/tasks/${task.id}`,
            method: "PATCH",
            body: patch,
          })),
        });
      }
      continue;
    }

    if (it.type === "create_campaign") {
      const name = typeof it.name === "string" ? it.name.trim() : "";
      const goal = typeof it.goal === "string" ? it.goal.trim() : "";
      const audience = typeof it.audience === "string" ? it.audience.trim() : "";
      const offerAngle = typeof it.offerAngle === "string" ? it.offerAngle.trim() : "";
      if (!name || !goal || !audience || !offerAngle || (await findCampaign(name))) continue;
      out.push({
        key,
        type: it.type,
        label: `Create draft outreach campaign "${name}" for ${audience.slice(0, 100)}`,
        endpoint: "/api/crm/outreach/campaigns",
        method: "POST",
        body: {
          name,
          goal,
          audience,
          offer_angle: offerAngle,
          daily_limit: Math.min(20, Math.max(1, Number(it.dailyLimit) || 20)),
        },
      });
      continue;
    }

    if (it.type === "update_campaign") {
      const campaign = await findCampaign(String(it.campaign || it.name || ""));
      if (!campaign) continue;
      const patch: Record<string, any> = {};
      if (typeof it.goal === "string" && it.goal.trim()) patch.goal = it.goal.trim();
      if (typeof it.audience === "string" && it.audience.trim()) patch.audience = it.audience.trim();
      if (typeof it.offerAngle === "string" && it.offerAngle.trim()) patch.offer_angle = it.offerAngle.trim();
      if (it.dailyLimit != null) patch.daily_limit = Math.min(20, Math.max(1, Number(it.dailyLimit) || 20));
      if (["draft", "active", "paused", "completed"].includes(it.status)) patch.status = it.status;
      if (it.voice && typeof it.voice === "object") patch.voice = it.voice;
      if (Array.isArray(it.bannedPhrases)) patch.banned_phrases = it.bannedPhrases;
      if (typeof it.bookingUrl === "string") patch.booking_url = it.bookingUrl;
      if (["interested_reply", "final_step", "always", "never"].includes(it.bookingCtaMode))
        patch.booking_cta_mode = it.bookingCtaMode;
      if (Array.isArray(it.sequence)) patch.sequence = it.sequence;
      if (!Object.keys(patch).length) continue;
      const summaryFields = Object.keys(patch).map((field) => field.replace(/_/g, " "));
      out.push({
        key,
        type: it.type,
        label: `Update campaign "${campaign.name}": ${summaryFields.join(", ")}`,
        endpoint: `/api/crm/outreach/campaigns/${campaign.id}`,
        method: "PATCH",
        body: patch,
      });
      continue;
    }

    if (it.type === "build_outreach_queue") {
      const campaign = await findCampaign("");
      if (!campaign || campaign.status !== "active") continue;
      const limit = Math.min(20, Math.max(1, Number(it.limit) || 20));
      out.push({
        key,
        type: it.type,
        label: `Select up to ${limit} best-fit prospects for today's review queue, no research or sending`,
        endpoint: "/api/crm/outreach/queue",
        method: "POST",
        body: { limit },
      });
      continue;
    }

    if (it.type === "update_opportunity") {
      const opportunities = await findOpportunities(
        String(it.opportunity || it.title || ""),
        String(it.client || "")
      );
      const patch = opportunityPatch(it);
      if (!opportunities.length || !Object.keys(patch).length) continue;
      const detail = opportunityChangeLabel(patch);
      if (opportunities.length === 1) {
        out.push({
          key,
          type: it.type,
          label: `Update "${opportunities[0].title}": ${detail}`,
          endpoint: `/api/crm/opportunities/${opportunities[0].id}`,
          method: "PATCH",
          body: patch,
        });
      } else {
        out.push({
          key,
          type: it.type,
          label: `Which opportunity should I update: ${detail}?`,
          choices: opportunities.map((opportunity) => ({
            label: `${opportunity.title} (${opportunity.companyName})`,
            endpoint: `/api/crm/opportunities/${opportunity.id}`,
            method: "PATCH",
            body: patch,
          })),
        });
      }
      continue;
    }

    if (it.type === "pull_emails") {
      // Pull the recent email thread with a person and build / refresh their
      // client from it. The client fires this endpoint on confirm; the route
      // reads the connected mailbox server-side and creates or updates the company + contact.
      const person = (
        typeof it.person === "string"
          ? it.person
          : typeof it.name === "string"
          ? it.name
          : typeof it.client === "string"
          ? it.client
          : ""
      ).trim();
      const em = typeof it.email === "string" ? it.email.trim() : "";
      if (!person && !em) continue;
      out.push({
        key,
        type: it.type,
        label: `Pull ${person || em}'s emails and build their client profile`,
        endpoint: `/api/crm/email-pull`,
        method: "POST",
        body: em ? { email: em } : { name: person },
      });
      continue;
    }

    if (it.type === "remember") {
      const note = typeof it.note === "string" ? it.note.trim() : "";
      if (note)
        out.push({
          key,
          type: it.type,
          label: `Remember this: ${note}`,
          endpoint: `/api/crm/brain/remember`,
          method: "POST",
          body: { note },
        });
      continue;
    }

    if (it.type === "correct") {
      const client = (typeof it.client === "string" ? it.client : "").trim();
      const correction = (
        typeof it.correction === "string" ? it.correction : ""
      ).trim();
      if (!correction) continue;
      const company = await findCompany(client);
      if (!company) continue;
      out.push({
        key,
        type: it.type,
        label: `Correct ${company.name}'s record: ${correction}`,
        endpoint: `/api/crm/companies/${company.id}/correct`,
        method: "POST",
        body: { correction },
      });
      continue;
    }

    if (it.type === "dismiss") {
      if (it.kind === "draft") {
        const d = await findDraft(String(it.item || ""));
        if (d)
          out.push({
            key,
            type: it.type,
            label: `Dismiss draft: "${d.draft_subject || "(no subject)"}"`,
            endpoint: `/api/crm/follow-ups/${d.id}`,
            method: "PATCH",
            body: { status: "dismissed" },
          });
      } else {
        const t = await findOpenTask(String(it.item || ""));
        if (t)
          out.push({
            key,
            type: it.type,
            label: `Dismiss to-do: "${t.text}"`,
            endpoint: `/api/crm/tasks/${t.id}`,
            method: "PATCH",
            body: { status: "dismissed" },
          });
      }
    }
  }
  const excludedFromBatch = new Set(["cancel_call", "dismiss", "pull_emails"]);
  return out.map((action) => ({
    ...action,
    batchSafe: !excludedFromBatch.has(action.type) && !action.choices,
  }));
}

const requestedActionLabel = (item: any) => {
  const type = String(item?.type || "CRM change").replace(/_/g, " ");
  const target = [
    item?.item,
    item?.task,
    item?.client,
    item?.call,
    item?.person,
    item?.campaign,
    item?.opportunity,
    item?.name,
    item?.title,
    item?.sourceTask,
    item?.text,
  ].find((value) => typeof value === "string" && value.trim());
  return target ? `${type}: ${String(target).trim().slice(0, 180)}` : type;
};

// The resolver used to silently omit an action when a named task, client, call
// or draft could not be identified. That looked as though Brain had done the
// work. Keep every unresolved request in the visible plan as an explicit red
// "Not completed" result instead.
function flagUnresolvedActions(requested: any[], resolved: any[]): any[] {
  const remaining = new Map<string, number>();
  for (const action of resolved) {
    const type = String(action?.type || "");
    remaining.set(type, (remaining.get(type) || 0) + 1);
  }
  const unresolved: any[] = [];
  for (const item of requested) {
    const type = String(item?.type || "");
    const count = remaining.get(type) || 0;
    if (count > 0) {
      remaining.set(type, count - 1);
      continue;
    }
    unresolved.push({
      key: `not-done-${Math.random().toString(36).slice(2)}`,
      type: type || "unknown",
      label: requestedActionLabel(item),
      unavailable: true,
      batchSafe: false,
      failureReason:
        "Brain could not safely identify the exact record or a required edit value was missing. No change was made.",
    });
  }
  return unresolved;
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, focusCompanyId, message, screenContext: rawScreen } = await req.json();
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
    const rawMessage = message.trim();
    let knownIdentities: BrainKnownIdentity[] = [];
    let nameResolution: BrainKnownNameResolution = {
      resolvedMessage: rawMessage,
      matches: [],
    };
    try {
      knownIdentities = await loadBrainIdentityDirectory();
      const preliminary = resolveBrainKnownNames(rawMessage, knownIdentities);
      if (preliminary.matches.length) {
        // A real, accessible contact with that exact name always wins. If the
        // protection lookup fails, fail closed and leave the request untouched.
        const protectedNames = await exactVisibleContactNamesIn(rawMessage);
        nameResolution = resolveBrainKnownNames(
          rawMessage,
          knownIdentities,
          protectedNames
        );
      } else {
        nameResolution = preliminary;
      }
    } catch (error: any) {
      console.warn(
        "Brain self-name resolution unavailable",
        error?.message || error
      );
    }
    const contextMessage = nameResolution.resolvedMessage;
    const allowedSections = new Set([
      "dashboard",
      "client",
      "outreach",
      "revenue",
      "work_board",
      "client_portfolio",
      "opportunities",
      "drafts",
      "tasks",
      "work_inbox",
      "documents",
      "call_coach",
      "calls",
      "prep",
      "live_call",
    ]);
    const screenContext = {
      section: allowedSections.has(rawScreen?.section) ? rawScreen.section : "dashboard",
      label:
        typeof rawScreen?.label === "string"
          ? rawScreen.label.replace(/[^a-z0-9 _-]/gi, "").trim().slice(0, 40) || "CRM dashboard"
          : "CRM dashboard",
      path:
        typeof rawScreen?.path === "string" && /^\/(crm|call)(\/|$)/.test(rawScreen.path)
          ? rawScreen.path.slice(0, 100)
          : "/crm",
    };
    const wantsTranscript = callTranscriptRequested(contextMessage);
    const wantsDeepHistory =
      !wantsTranscript &&
      /\b(full history|all calls|previous calls|older calls|past conversations|detailed history|every scorecard|source history|source documents?|uploaded documents?|detailed notes?|email thread|what did .* say)\b/i.test(
        contextMessage
      );
    // Lightweight timing so we can SEE where a reply spends its time (context
    // gather vs model) and whether prompt caching is hitting, before optimising
    // further. Logged once per reply as "assistant-timing {...}".
    const reqStart = Date.now();
    const isGlobal = typeof companyId !== "string" || !companyId;

    // On a client page we lead with that client, but still load the wider
    // pipeline so the user can range onto anyone or anything (the assistant is
    // their co-founder, not a single-client bot).
    // The client to LEAD with (the page the user is on) - from focusCompanyId
    // (persistent layout assistant) or companyId (legacy/call-screen scoping).
    // The conversation thread itself stays global unless companyId is set.
    const focus =
      typeof focusCompanyId === "string" && focusCompanyId
        ? focusCompanyId
        : typeof companyId === "string" && companyId
        ? companyId
        : null;
    // Recent thread for continuity. Global thread = rows with company_id null.
    let histQ = supabaseAdmin
      .from("assistant_messages")
      .select("role, content, action_sigs")
      .lt("created_at", new Date(reqStart).toISOString())
      .order("created_at", { ascending: false })
      .limit(10);
    histQ = isGlobal
      ? histQ.is("company_id", null)
      : histQ.eq("company_id", companyId);

    const gatherContext = async (): Promise<string | null> => {
      // DETAIL ON DEMAND. Pull FULL context for the client the user is on
      // (focus) and for any client they NAME in the message, but only a one-line
      // digest for everyone else. Keeps the prompt small as the book of clients
      // grows, without losing depth on whoever the question is actually about.
      const [named, namedWorkstreams] = await Promise.all([
        findCompaniesNamedIn(contextMessage),
        findWorkstreamsNamedIn(contextMessage),
      ]);
      const scopedCompanyIds = new Set(
        namedWorkstreams.map((thread) => thread.companyId)
      );
      const detailIds: string[] = [];
      if (focus && !scopedCompanyIds.has(focus)) detailIds.push(focus);
      for (const n of named) {
        if (
          !scopedCompanyIds.has(n.id) &&
          !detailIds.includes(n.id) &&
          detailIds.length < 3
        )
          detailIds.push(n.id);
      }
      const wantsOutreachDetail =
        /\b(outreach|prospect|campaign|cold email|sequence|reply|replies|linkedin|send today|approved|priority|priorities|what.*next)\b/i.test(contextMessage);
      const [digest, outreach, callPrep, callTranscript, documentContext, ...details] = await Promise.all([
        gatherGlobalContext(contextMessage),
        gatherOutreachContext(contextMessage, { detailed: wantsOutreachDetail }),
        gatherUpcomingCallPrepContext(contextMessage),
        gatherCallTranscriptContext(contextMessage, {
          screenPath: screenContext.path,
          focusCompanyId: focus,
        }),
        documentBrainContext(contextMessage),
        ...namedWorkstreams.map(async (thread) => {
          const memory = await getCommercialMemoryBlock(
            thread.companyId,
            thread.workstreamId
          );
          return [
            `NAMED RELATIONSHIP: ${thread.companyName} > ${
              thread.departmentName || "No department"
            } > ${thread.workstreamName} > ${thread.contactName}`,
            "This is an isolated workstream. Do not borrow calls, actions or email context from another workstream at the same company.",
            memory,
          ]
            .filter(Boolean)
            .join("\n");
        }),
        ...detailIds.map((id) =>
          wantsDeepHistory ? gatherClientContext(id) : getCommercialMemoryBlock(id)
        ),
      ]);
      const detailBlocks = (details as (string | null)[]).filter(
        (d): d is string => !!d && d.trim().length > 0
      );
      const wider = [callTranscript, callPrep, documentContext, digest, outreach]
        .filter(Boolean)
        .join("\n\n==========\n\n");
      if (!detailBlocks.length) return wider || null;
      const label = focus
        ? "FOCUSED / NAMED CLIENTS - full detail. Lead here when the question is about them:"
        : "NAMED CLIENTS - full detail on the client(s) the user mentioned:";
      return `${label}\n\n${detailBlocks.join(
        "\n\n----------\n\n"
      )}\n\n==========\n\nTHE WIDER PIPELINE AND OUTREACH - compact by default; full client or prospect detail comes up when needed:\n\n${wider}`;
    };

    // Everything the model needs, fetched in PARALLEL instead of one-after-
    // another. These were sequential DB round-trips that slowed every reply.
    const wantsPitchLessons =
      /\b(pitch|pitching|playbook|sales script|sell|selling|demo|discovery question|objection|closing question|buyer language)\b/i.test(contextMessage);
    // Save the turn before model generation starts. Previously both messages
    // were inserted only after the full streamed reply completed, so closing
    // or navigating away from the Brain could lose the user's request and the
    // whole draft. The placeholder is replaced as the answer streams.
    const persistedTurn = supabaseAdmin
      .from("assistant_messages")
      .insert([
        {
          company_id: isGlobal ? null : companyId,
          role: "user",
          content: rawMessage,
        },
        {
          company_id: isGlobal ? null : companyId,
          role: "assistant",
          content: "Reply in progress. If this remains after reopening, ask the Brain to continue.",
          action_sigs: [],
        },
      ])
      .select("id, role");
    const [
      context,
      histRes,
      biz,
      salesProfile,
      lessons,
      pitchLessons,
      brainQuestions,
      persistedRes,
    ] = await Promise.all([
      gatherContext(),
      histQ,
      workspaceContextBlock(),
      getSalesProfileContextBlock(),
      getLessonsBlock(["negotiation", "strategy", "psychology"]),
      wantsPitchLessons
        ? getRelevantPitchingLessons(contextMessage)
        : Promise.resolve(""),
      getBrainQuestions(),
      persistedTurn,
    ]);
    if ((persistedRes as any)?.error) throw (persistedRes as any).error;
    const persistedAssistantId = ((persistedRes as any)?.data || []).find(
      (row: any) => row.role === "assistant"
    )?.id as string | undefined;
    if (!persistedAssistantId)
      throw new Error("the Brain could not safely save this conversation");
    const ctxMs = Date.now() - reqStart; // time to gather all grounding context
    if (!context) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }
    const history = (histRes as any)?.data;
    // Signatures of actions already proposed earlier in this thread, so we never
    // re-offer the same one (the model can't see its own past proposals).
    const priorSigs: BrainActionSignature[] = [];
    const receiptOutcomes: BrainActionSignature[] = [];
    for (const m of (history || []) as any[]) {
      if (Array.isArray(m?.action_sigs))
        for (const signature of m.action_sigs) {
          if (!signature?.type) continue;
          if (signature.outcome) {
            receiptOutcomes.push(signature);
            if (signature.outcome === "completed") priorSigs.push(signature);
          } else if (
            !receiptOutcomes.some((receipt) =>
              sameBrainAction(signature, receipt)
            )
          ) {
            priorSigs.push(signature);
          }
        }
    }
    const priorTurns: { role: "user" | "assistant"; content: string }[] = (
      history || []
    )
      .reverse()
      .map((m: any) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as
          | "user"
          | "assistant",
        // Conversation continuity matters, but old long plans should not be
        // paid for on every turn. The full thread stays saved in Supabase.
        content: String(m.content).slice(-1400),
      }));

    const requestScope = getRequestScope();
    const accessBoundary =
      requestScope?.role === "owner"
        ? `You are assisting the verified workspace owner. This is the only role allowed the full Brain view across the owner's private records and the shared workspace.`
        : `You are assisting a restricted workspace member. Only the verified workspace owner has the full Brain view. Use this member's own private records and the safe high-level context of clients the owner has explicitly shared with the team. Shared client access is lookup access only. It does not reveal the owner's private notes, email, calls, transcripts, calendar, documents, Brain history or opportunity details assigned to somebody else. Only recommend or action opportunities, outreach prospects and work assigned to this member. Never reveal or search an unshared client or another person's private records, even if the member names them or directly asks. Team campaign names and non-sensitive aggregate learnings may be used only as shared context. Treat unassigned outreach prospects only as available to claim. If permitted records do not contain the answer, say this account does not have access and ask the owner to share or assign the record.`;
    const scope = isGlobal
      ? `${accessBoundary}\n\nYou are the user's overall CRM assistant. You know the clients and pipeline this verified account is permitted to access below. They might ask about one client ("what do I do next with Alaine"), or across their permitted work ("what's my to-do list", "which deal is closest to closing"). When they name a client, match it to the closest permitted one in the context even if the spelling is slightly off. Never imply that inaccessible or unassigned records belong to them.`
      : `${accessBoundary}\n\nYou are the user's strategic co-founder and CRM assistant. They are currently on ONE client's page, so by default answer about that client (the FOCUSED CLIENT below) and help move that relationship forward. But you are NOT limited to them - the user may bring up another permitted client, a fresh idea, their week, or anything at all, and you should help with whatever they raise, drawing only on the permitted pipeline below. Whatever the topic, help them plan, prep and take action without crossing the account boundary.`;
    const qBlock = brainQuestions
      ? `\n\nTHINGS YOU ARE TRYING TO LEARN (open questions about the user's business that would make you sharper). When it fits naturally, when the user asks what you need, or when you are brainstorming, raise one or two of these - never the whole list and never force them. When the user answers, weave it into your reply and treat it as fact from then on:\n${brainQuestions}`
      : "";
    const signedInIdentity = knownIdentities.find(
      (identity) => identity.relationship === "signed_in_user"
    );
    const ownerIdentity = knownIdentities.find(
      (identity) => identity.relationship === "workspace_owner"
    );
    const identityBlock = signedInIdentity?.canonicalName
      ? `\n\nKNOWN ACCOUNT IDENTITIES\n- Signed-in user: ${signedInIdentity.canonicalName}. First-person references such as I, me and my mean this signed-in user only.${
          ownerIdentity?.canonicalName
            ? `\n- Workspace owner: ${ownerIdentity.canonicalName}. This identity does not grant access to the owner's private records.`
            : ""
        }${
          nameResolution.matches.length
            ? `\n- Voice recognition rendered ${nameResolution.matches
                .map(
                  (match) =>
                    `"${match.heard}" as ${match.canonicalName}`
                )
                .join(", ")}. Retrieval used the canonical name or names. Use those canonical names in the answer.`
            : ""
        }\nIdentity correction changes no access rights and never opens another account's private records.`
      : "";
    const system: any[] = [
      {
        type: "text",
        text: `${biz}${salesProfile}${lessons}${pitchLessons}${scope}${qBlock}${identityBlock}

GROUND EVERYTHING in the context provided below. This is the hardest rule and it overrides being helpful.
- Never state a specific number, money amount, budget, deal value, date, deadline, percentage, stage, name or commitment unless it appears literally in the context. Do not estimate, assume, or infer a figure that isn't written there. If you catch yourself about to put a number in a sentence, check it is actually in the context first.
- If a piece of information is missing (no budget, no stage, no value, no next step recorded), say it is not recorded yet. Do NOT fill the gap with a plausible-sounding guess. "You haven't logged a budget for them" is a good answer. Inventing "a $200k budget" is a serious error.
- When a client's record is thin or empty, say so directly and tell the user what to capture first (link a call, set a stage, note the next step). Do not pad a near-empty record into multiple confident options or a detailed plan built on assumptions. A short honest answer beats a long invented one.
- If you are unsure whether something is in the context, treat it as not there and say so.

MATCH THE REQUEST - this is important. Answer exactly what was asked and NO MORE. If the user makes a simple or operational request (add a to-do, set a reminder, a quick lookup, a yes or no, attach a link, dismiss something), respond in one or two lines, and if you need a detail to do it, ask the SINGLE question. Do NOT volunteer a priorities list, a week plan, a deal-by-deal briefing, or strategic advice they did not ask for. For "I need to add something to my to-do list" the right reply is simply "Sure, what is it?" - not a summary of their week. Save the bigger thinking for when they actually ask for advice, a plan, or what to prioritise. Over-answering a small request is a mistake.

DO NOT REPEAT YOURSELF - this is critical. You can see the whole conversation. NEVER restate a plan, a list, or advice you have already given in this thread. When the user adds a small fact, a name, or a correction (for example "Ajith Kumar is the director", "Joydeep was not sick"), acknowledge it in ONE short line and add ONLY what genuinely changes as a result - do NOT regenerate the earlier plan with the new detail swapped in. If the new detail doesn't materially change your earlier advice, say that in a sentence and stop (e.g. "Got it, I'll address it to Ajith - everything else we said still stands."). Re-delivering a long answer the user has already read wastes their time and is a serious mistake. Build on what's been said, never repeat it.

CONTINUE, DON'T RESTART: if the user says "repeat", "continue", "carry on", "go on", "finish that" or "you cut off", do NOT begin your previous answer again from the top. Pick up exactly where the last reply ended and give only the part that was missing. A brief "Picking up where I left off," then the rest is fine. Never re-read text they already heard.

ANSWER THE NEW QUESTION, NEVER RECAP YOUR LAST ANSWER FIRST. This is critical and gets noticed when you fail it. Open every reply by directly addressing what the user JUST asked. Do NOT lead with a restatement or summary of your previous answer or of what you just did (no "I've added that...", "As I said...", "The most important thing is still..."). They already read your last reply, repeating it back is exactly what frustrates them. If the new message is a fresh question, drop the previous topic completely and answer the new one in your first sentence. If they ask a follow-up (for example "what would the pitch be"), ANSWER that exact thing, do not restate your earlier answer instead of answering. One short transition word is the most you may spend before the substance.

EXPLAIN THE WHY. When the user DOES ask for advice or a next step, work the reasoning into your sentences so they learn the thinking, not just the instruction. Say what in the history makes it the right move. Do this in plain prose, not under a "Why:" label.

BE CONCRETE: real steps, who to contact, roughly when, what to say. When you suggest an order, explain it in a sentence.

HOW TO WRITE (this matters a lot - the user finds over-formatted answers robotic):
- Write the way a sharp colleague talks. Short paragraphs of plain sentences. Usually two to four short paragraphs is plenty.
- Do NOT use markdown formatting. No "#" or "##" headings. No "**bold**". No markdown tables.
- Avoid bullet-point and numbered lists unless the user explicitly asks for a list. Prefer flowing sentences. If you genuinely must list a few items, keep it to plain short lines with no bold.
- Never write words in all-caps for emphasis (no "TODAY", "NOW"). Don't shout.
- Never use em-dashes or semicolons. Use commas and full stops instead.
- Lead with the single most useful thing. Cut filler and preamble. Don't pad to sound thorough.

VOICE INPUT AND NAMES: the user usually talks to you by voice, so the transcript can mishear words, especially names. When a word is close to a person, client or company name that appears in the context (for example "Elaine", "Elon" or "a lane" for "Alain", "Joy deep" for "Joydeep", "Manny" vs "Danny"), treat it as that known name and use the correct spelling in your reply and in anything you draft. When the context makes the intended name obvious, just use it - do not stop to ask which name they meant.

DRAFTS - ONLY WHEN ASKED (this keeps replies fast): do NOT write a full email or message unless the user EXPLICITLY asks you to draft, write, or send one. For a normal question, answer concisely and, if a draft would help, OFFER it in a single line ("want me to draft that email?") rather than writing it. Writing a long draft nobody asked for is slow and wasteful. When they DO ask for a SHORT SENDABLE EMAIL OR MESSAGE, put ONLY that sendable text between these exact marker lines:
---DRAFT---
<the sendable text only - for an email include a "Subject:" line then the body>
---END DRAFT---
Keep your commentary and reasoning OUTSIDE the markers. The text inside the markers can be plain and clean since it is what gets sent.

FINISHED BUSINESS DOCUMENTS: when the user explicitly asks you to produce, create or write a finished plan, agreement, handbook, proposal, report, brief or Word document, do not write the long document inside the chat and do not turn the request into a new to-do. Propose create_document immediately. The request is saved first, then the document is created in the background while the user continues using the CRM. Use the exact matching open document-related to-do as sourceTask when DOCUMENT STUDIO ON DEMAND supplies it. Link a client only when the exact client is clear. Give the job a useful finished title and put all grounded scope, outcome and format requirements in instructions. Missing facts are flagged in the document rather than invented. Agreements and handbooks remain working drafts when material terms are missing.

TO-DOS: when the user asks you to arrange, remember, chase, follow up, add, draft, prep, or otherwise CREATE actions to do later, propose each as a to-do. It is shown in the visible action plan and is only created after approval. In ADDITION to your normal prose reply, put ONLY a JSON array between these exact markers:
---TASKS---
[{"text":"short imperative to-do","action":"email|call|task","dueAt":"YYYY-MM-DD","pinned":true}]
---END TASKS---
Use "action" = "email" for anything to write or send, "call" to prep or schedule a call, "task" for anything else. Set "dueAt" to the deadline DATE when the user gives one, working out the real date from today's date in the context (e.g. "by Friday" becomes that Friday's YYYY-MM-DD, "by end of month" the last day of this month). Set "pinned" to true when the user says to keep it at the top, make it top priority, do it first, or that it is urgent. OMIT dueAt and pinned when the user did not give a deadline or priority. Only propose to-dos the user actually wants tracked, and do not repeat ones already outstanding in the context. Keep these markers out of your prose, and still answer naturally.

CALENDAR AND SAVED PREP: the user's upcoming calls, synced from their calendar, are in the context below. For a schedule or call list, always include the time and make the full time plus call title clickable to its supplied prep page using exactly [time, call title](/supplied/prep/path). This is the one permitted Markdown pattern. Never link the client name separately inside a schedule item. Never show raw URLs, never say a prep page is unavailable when a prep page is supplied, and never link straight to Google Meet, Teams or Zoom unless the user explicitly asks for the join link. If the context specifies the exact requested date, obey it, including the user's before 02:00 definition of "tomorrow". Flag overlapping meetings prominently. When they ask about a particular call's questions, focus, intent or battle plan, use the ON-DEMAND SAVED CALL PREP block when present. That block is the authoritative saved plan and was fetched specifically for this question, so never say you cannot see it. If the block says the plan is not built, say that plainly. You cannot edit their Google calendar itself, but you CAN, with their confirmation, attach or change the meeting link, set or clear the intent, or link a call to a client on the in-app call record (see ACTIONS). If they tell you a call moved or was cancelled, note it or add a to-do, and remind them the synced view refreshes from their calendar.

CALL TRANSCRIPTS ON DEMAND: when an ON-DEMAND CALL TRANSCRIPT block is present, it was fetched only because the user explicitly asked about a specific recorded conversation. Treat the matched transcript source as authoritative for that question. Never combine it with another call, never substitute a generic scorecard for missing words, and never imply that you checked a raw transcript when the block says it is unavailable. If the block reports several close matches, ask the user which exact call they mean. If it contains bounded excerpts and the answer is not present, say that plainly and ask for the topic or phrase to search rather than guessing.

ACTIONS YOU CAN TAKE (never claim you already did them, approval is what does the work): you can change call records, client stages, stakeholders and to-dos, create or update internal CRM records, create and configure outreach campaigns, select a review queue, create profiles, update opportunities, pull email context, remember durable rules, correct records, and dismiss stale work. The current screen tells you what to lead with, but you are universal and can act anywhere in the CRM. Put ONLY the exact requested changes in a JSON array between these markers:
---ACTIONS---
[{"type":"set_meeting_link","call":"<call title or person from the context>","url":"<link>"},{"type":"set_intent","call":"<call title>","intent":"<intent text, empty to clear>"},{"type":"add_intent","call":"<call title>","note":"<the focus note to add to that call, kept alongside what is already there>"},{"type":"link_call","call":"<call title>","client":"<client name>"},{"type":"cancel_call","call":"<call title>","reason":"<why it is not happening, optional>"},{"type":"dismiss","kind":"draft","item":"<the draft subject>"},{"type":"dismiss","kind":"task","item":"<the to-do text>"},{"type":"create_client","name":"<person or company name>","brief":"<what you know about them so far, one or two sentences>"},{"type":"log_client_update","client":"<client name, omit on their profile>","channel":"phone|text|voice|note","content":"<the concise factual update and any agreed next step>"},{"type":"remember","note":"<the durable preference, habit, standard practice or fact to save, in one clear line>"},{"type":"correct","client":"<the client this correction is about>","correction":"<the corrected fact in one clear line>"},{"type":"pull_emails","person":"<their name>","email":"<their email if you know it, optional>"}]
---END ACTIONS---
Additional supported actions are:
{"type":"create_document","title":"<finished document title>","documentType":"plan|agreement|handbook|proposal|report|brief|other","instructions":"<grounded scope, intended reader, required outcome and useful structure>","client":"<optional exact client name>","sourceTask":"<optional exact open to-do text from DOCUMENT STUDIO ON DEMAND>"}
{"type":"update_client","client":"<client name, omit on their profile>","name":"<optional corrected name>","stage":"New|Discovery|Qualified|Proposal|Negotiation|Partner|Customer|Product Trial|In House|Dormant","sector":"<optional>","website":"<optional>","domain":"<optional>","notes":"<optional, null to clear>","emailContext":"<optional, null to clear>","removeFromPipeline":true,"rationale":"<only when the user explicitly says this is not a prospect, client or buyer>"}
{"type":"upsert_stakeholder","client":"<client name, omit on their profile>","person":"<contact name>","buyingRole":"decision_maker|champion|user|influencer|blocker|unknown","influence":"high|medium|low","engagement":"warm|neutral|cold","jobTitle":"<optional>","email":"<optional>"}
{"type":"update_contact","client":"<client name, omit on their profile>","person":"<existing contact name>","newName":"<optional corrected name>","role":"<optional, null to clear>","email":"<optional, null to clear>","sector":"<optional, null to clear>","notes":"<optional, null to clear>"}
{"type":"update_task","client":"<client name, omit on their profile>","item":"<existing to-do text>","status":"done|open","newText":"<optional replacement>","dueAt":"YYYY-MM-DD or null","pinned":true,"action":"email|call|task"}
{"type":"create_campaign","name":"<campaign name>","goal":"<commercial outcome>","audience":"<specific ideal customer profile>","offerAngle":"<one grounded Interviewa angle>","dailyLimit":20}
{"type":"update_campaign","campaign":"<existing campaign name or active campaign>","goal":"<optional>","audience":"<optional>","offerAngle":"<optional>","dailyLimit":20,"status":"draft|active|paused|completed"}
{"type":"build_outreach_queue","limit":20}
{"type":"update_opportunity","client":"<client name>","opportunity":"<opportunity title if needed>","title":"<optional corrected title>","dealIntent":"<the commercial outcome this deal is pursuing>","pipelineStage":"new|discovery|qualified|proposal|negotiation|verbal|won|lost","probability":0,"forecastCategory":"pipeline|best_case|commit|omitted","winOutlook":"not_assessed|at_risk|possible|likely|highly_likely|won","winOutlookConfidence":0,"winOutlookReasons":["<stored evidence only>"],"winOutlookQuestions":["<targeted next-call question>"],"engagementMotion":"cold_outreach_campaign|personal_relationship_led|existing_customer_expansion|inbound_enquiry|partner_referral","activeContactMethod":"automated_email|personal_email|phone|video_call|linkedin|event|in_person|other","opportunityType":"revenue|investment|internal|strategic","nextAction":"<one move>","nextActionDueAt":"YYYY-MM-DD","nextActionOwner":"us|buyer|joint","expectedCloseAt":"YYYY-MM-DD","status":"open|won|lost|dismissed","outcomeReason":"<optional>","rationale":"<why this change is supported>"}
For update_opportunity include only fields the user actually supplied or that are literally supported by the CRM context. Lifecycle stage and win outlook are separate. Never raise win outlook without concise stored evidence. If evidence is missing, keep it not_assessed and add targeted winOutlookQuestions for the next call. Never invent a value, probability, date or stage. Prospect value is deliberately unknown before a substantive call establishes likely usage, buying process, urgency and next-step evidence, so never assign or use speculative prospect values for outreach priority.
Use update_client for the relationship-level client stage and core facts. Use update_opportunity for a real revenue deal stage. When "move this client to qualified" clearly refers to a deal, update the opportunity. When it refers to the overall relationship or there is no deal, update the client stage. Never update both unless the user explicitly asks.
When the user explicitly says a company is a partner, supplier, internal organisation or other non-buyer and should not appear in prospecting or the sales pipeline, include removeFromPipeline:true with update_client. Do not include it merely because the relationship stage is Partner, because a partner can still have a genuine expansion deal. This action dismisses active revenue opportunities but preserves the client, calls, tasks and immutable deal history.
Use update_contact to correct or clear an existing person's core details. Use upsert_stakeholder when the change is specifically about their buying role or when the named contact may need to be created.
Use upsert_stakeholder when the user identifies a decision-maker, champion, influencer, user or blocker. It updates an existing contact or clearly proposes creating the named contact when none exists. Do not guess buying roles from a job title alone.
Use update_task when the user explicitly asks to complete, rename, pin, unpin or reschedule an existing to-do. If several match, the interface will ask which one.
Use create_document only for an explicit finished-document request. Do not emit create_task for the same request. If a matching sourceTask is used, it is completed only after the private Word file is successfully created. A queued request is not the same as a completed file, so tell the user it will continue in the background and appear in Documents.
Use log_client_update when the user reports an off-system phone call, text message, voice note or relationship update. Keep the content factual and concise. It enters that client's timeline and commercial memory, updates any grounded next action, and refreshes future next-call intent after the user confirms it once. If the user names a client, use the exact known client name or saved alias. Never map a one-word first name to a different full-name client merely because part of the text matches.
For update_campaign you may also include "voice":{"tone":"...","style":"...","rules":["..."],"signature":"Lee"}, "bannedPhrases":["..."], "bookingUrl":"https://...", "bookingCtaMode":"interested_reply|final_step|always|never", and "sequence":[{"step":1,"channel":"email|linkedin|phone","actionType":"email|linkedin_view|linkedin_like|linkedin_connect|linkedin_message|manual_call","delayDays":0,"purpose":"...","contentType":"plain|insight|case_study|video|close_loop","guidance":"...","assetUrl":null}]. LinkedIn and phone steps are always manual and must never be described as completed unless the salesperson confirms them. Only include settings the user asked for or approved in the conversation.

CAMPAIGN SAFETY: create_campaign always creates a draft. build_outreach_queue only selects up to the daily limit for review and spends no research tokens. Never propose or execute research, message approval or email sending as a universal batch action. Exact outreach drafts and external sends stay in the dedicated Outreach approval flow.

BATCH APPROVAL: when the user asks for several safe internal changes, emit them together. The interface shows every exact change and offers one approval for the safe subset. Destructive changes, mailbox pulls and any future external send stay separately confirmed.
NO SILENT FAILURES: if a requested edit cannot be matched or completed, the action panel will mark it Not completed. Never imply that an edit happened merely because you described it in prose.
When a call is cancelled or has moved off the calendar, use cancel_call (it removes the call and its prep to-do and records the reason). If there are also leftover to-dos or drafts about that call, propose dismissing those too. If you are not sure which call, client, draft or to-do the user means, ask them to clarify in your prose reply rather than guessing (the system will also offer a pick-list if more than one record matches the name).
Refer to the call, client, draft or to-do by the exact name/title/text shown in the context so it can be matched. Each one is shown to the user with a Confirm button and nothing happens until they tap it, so never say it is done.

NEW PEOPLE: when the user introduces or talks about a person or company who is a contact, prospect, partner or lead and is NOT already in the context, proactively OFFER to create their profile with create_client, capturing what you know in the brief, so future calls and notes track against them. Suggest it early rather than waiting to be asked twice.

PULL EMAILS: you CAN read the user's email thread with a person through their own connected Google or Microsoft account and build their client from it. When the user asks you to pull, fetch, check or look at someone's email, or to add a client from an email thread, emit a "pull_emails" action with their name and their email if it is in the context or the message. This reads the recent thread with them, distils it into their client context, and creates or refreshes their profile and contact, ready for prep. Do not say you cannot access email. If no mailbox is connected or email reading was not granted, the action will report that back and the user can connect their own account in Settings. When the user mentions emailing someone new from a company address, offer to pull the thread and set them up.

FIX WRONG RECORDS: when the user corrects a fact about a client (for example the records say someone was ill and they tell you it was actually a colleague, or a name, role, date, stage or detail is wrong), do NOT just acknowledge it in prose and move on. The records do not update themselves from chat. Emit a "correct" action naming the client and the corrected fact, so the stored "what we know", playbook, to-dos and call summary all get fixed. Acknowledge briefly in one line AND emit the action.

PREP NOTES GO INTO THE CALL: when the user says to add something to the plan or focus for a named upcoming call (for example "add to the focus for the Alain call that I should bring up Darren"), use add_intent so it lands in that call's intent window and is in front of them at prep time. Do NOT just make a loose to-do for this, since that is easy to miss.

EXPLICIT ASK = ACT NOW: when the user explicitly asks for one of these (create a profile, add to a plan, remember something, change or cancel a call, dismiss something), propose the action straight away in the SAME reply. Do not ask "want me to?" a second time when they have already told you to do it, and never claim it is already done. Emitting the action IS how you carry out their request. Only the destructive ones (cancel a call, dismiss a draft or to-do) and anything you are unsure about need a careful confirm. If you are not sure which call, client, draft or to-do they mean, ask them to clarify in your prose rather than guessing (the system also offers a pick-list when more than one record matches). Only include the actions the user actually asked for. Keep these markers out of your prose and still reply naturally.

STATUS QUESTIONS ARE NOT ACTIONS: when the user is only asking what you have, what is already planned, or to confirm something is done (for example "have you got everything for Alain", "what's on the plan for that call", "did you add that"), answer in prose from the context and emit NO action. Never re-propose an action you already proposed earlier in the thread, or one whose change is already present in the context, because that makes the user re-confirm something already done, which is confusing. Only emit an action when the user is asking you to make a NEW change right now.

CONFIRM MEANS DONE, NEVER ASK TWICE: the system automatically remembers every action you have proposed in this thread and silently drops any repeat, so you never need to re-list one to be safe. When the user says they confirmed it, pressed confirm, or that it is done, BELIEVE them: treat it as actioned, acknowledge in one short line, and move on. Do NOT re-emit that action, do NOT ask them to confirm it again, and do NOT keep offering the same one or two things in reply after reply. If everything you had to offer this thread is already proposed or done, say so plainly and stop, rather than repeating yourself.

TONE: warm, sharp, brief. Plain English, like a smart colleague who knows the book of business well and respects your time.

SPOKEN SUMMARY: the user often listens to your reply by voice, and hearing the whole thing read out is long winded (especially for a game plan or a list). So ALWAYS also give a SHORT spoken version - one or two sentences that carry the gist and the single most useful point, in a natural talking voice. Put ONLY that between these exact markers:
---SPOKEN---
<one or two spoken sentences. If your written reply ends by asking the user something, repeat that question word for word as the LAST sentence here>
---END SPOKEN---
ALWAYS end the spoken version with your closing question whenever your reply has one. The user is often hands-free, so hearing the question read out is what keeps the conversation going - never drop it. NEVER read out a full draft or email in the spoken version. If you wrote a draft, the spoken version should just say a draft is ready and ASK if they want you to read it out. Keep these markers out of your visible prose. The full written answer still goes in your normal reply.`,
        // Cache the big, stable instruction block so repeat calls skip
        // re-processing it (lower latency + cost). It only changes when the
        // brain knowledge or lessons change.
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
      {
        type: "text",
        text: `CURRENT SCREEN: ${screenContext.label} (${screenContext.path}). Lead with what is useful on this screen, but remain the one universal Brain and act across the whole CRM whenever the user asks.\nINTELLIGENCE MODE: ${wantsDeepHistory ? "extended scorecard history, user accepted the higher-token warning" : "concise commercial memory, the normal lower-token mode"}.\n\n${isGlobal ? "PIPELINE CONTEXT" : "CONTEXT"} (everything we know):\n\n${context}`,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ];

    const messages = [
      ...priorTurns,
      { role: "user" as const, content: rawMessage },
    ];

    // Route obvious data lookups (your to-do list, what's on the calendar) to the
    // FAST model - it is only reading the context that is already here. Anything
    // that creates, judges, plans, drafts, advises, compares or summarises stays
    // on the smart model, since that is the part that matters.
    const ml = contextMessage.toLowerCase();
    const LOOKUP =
      /(to.?do|task list|my tasks|what.?s on|what.?s next|what is next|upcoming|my calls?|my schedule|my calendar|show me|^list\b|list (my|the)|my drafts|my commitments|what do i owe|outstanding|who have i)/;
    const SMART =
      /(draft|write|email|message|plan|prep|summari[sz]e|advi[sc]e|should i|why|how (do|should|can|to|would)|best|strateg|recommend|opinion|brainstorm|idea|pitch|negoti|approach|think|compare|priorit|win\b|risk|objection|pros|cons|create|campaign|approve|update|move|change|action)/;
    const simple = LOOKUP.test(ml) && !SMART.test(ml);
    const model = simple ? OPENAI_MODEL_LIVE : OPENAI_MODEL_BRAIN;
    // Long strategic answers were getting cut off mid-sentence at 1300 tokens
    // (and then the SPOKEN block never arrived). Give the smart model real room
    // to finish a full game-plan; keep the fast lookups tight.
    const maxTok = simple ? 900 : 2400;

    // STREAM the reply so words appear as they are written. We emit newline-
    // delimited JSON frames: {type:"delta",text} as the model writes, then one
    // {type:"done", reply, spoken, createdTasks, proposedActions} once the full
    // text is in and we have run the to-do / action / spoken extraction.
    const encoder = new TextEncoder();
    const frame = (
      controller: ReadableStreamDefaultController,
      obj: any
    ) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

    const streamBody = new ReadableStream({
      async start(controller) {
        let full = "";
        let firstTokenAt = 0; // when the first word arrived (for TTFT)
        let lastPartialSaveAt = 0;
        let partialSave = Promise.resolve();
        const queuePartialSave = (content: string) => {
          partialSave = partialSave.then(async () => {
            const { error } = await supabaseAdmin
              .from("assistant_messages")
              .update({ content })
              .eq("id", persistedAssistantId);
            // A transient checkpoint failure should not kill an otherwise good
            // Brain reply. The final durable save below is still mandatory.
            if (error) console.error("Assistant checkpoint save failed:", error);
          });
        };
        try {
          const oaiStream: any = (openai as any).messages.stream({
            model,
            max_tokens: maxTok,
            temperature: 0.4,
            system,
            messages,
          });
          for await (const ev of oaiStream) {
            if (
              ev?.type === "content_block_delta" &&
              ev?.delta?.type === "text_delta"
            ) {
              const t = ev.delta.text || "";
              if (t) {
                if (!firstTokenAt) firstTokenAt = Date.now();
                full += t;
                frame(controller, { type: "delta", text: t });
                if (Date.now() - lastPartialSaveAt >= 2500) {
                  lastPartialSaveAt = Date.now();
                  queuePartialSave(full);
                }
              }
            }
          }
          let usage: any = null;
          let stopReason: string | null = null;
          try {
            const fm = await oaiStream.finalMessage();
            usage = fm?.usage;
            stopReason = (fm as any)?.stop_reason ?? null;
            if (!full && Array.isArray(fm?.content)) {
              full = fm.content
                .filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join("");
            }
          } catch {
            /* ignore - we still have `full` from the deltas */
          }
          await logModelUsage("assistant", simple ? "live" : "think", usage);

          let reply = full.trim();

          // --- TO-DOS: convert them into the same visible, confirm-gated plan
          // as every other write. Brain chat never silently creates work now.
          let createdTasks: any[] = [];
          let taskActionItems: any[] = [];
          const tm = reply.match(/---TASKS---\s*([\s\S]*?)\s*---END TASKS---/);
          if (tm) {
            reply = reply.replace(/---TASKS---[\s\S]*?---END TASKS---/, "").trim();
            try {
              const seg = tm[1];
              const a = seg.indexOf("[");
              const b = seg.lastIndexOf("]");
              const arr = a >= 0 && b > a ? JSON.parse(seg.slice(a, b + 1)) : [];
              if (Array.isArray(arr)) {
                taskActionItems = arr
                  .filter((x: any) => x && typeof x.text === "string" && x.text.trim())
                  .slice(0, 6)
                  .map((x: any) => ({
                    type: "create_task",
                    text: String(x.text).trim(),
                    action: x.action,
                    dueAt:
                      typeof x.dueAt === "string" &&
                      /^\d{4}-\d{2}-\d{2}/.test(x.dueAt)
                        ? x.dueAt
                        : undefined,
                    pinned: x.pinned === true,
                  }));
              }
            } catch {
              /* ignore a malformed task block */
            }
          }

          // --- WRITE ACTIONS: resolve targets, never execute (client confirms) ---
          let proposedActions: any[] = [];
          let writeActionItems: any[] = [];
          const am = reply.match(/---ACTIONS---\s*([\s\S]*?)\s*---END ACTIONS---/);
          if (am) {
            reply = reply.replace(/---ACTIONS---[\s\S]*?---END ACTIONS---/, "").trim();
            try {
              const seg = am[1];
              const a = seg.indexOf("[");
              const b = seg.lastIndexOf("]");
              writeActionItems = a >= 0 && b > a ? JSON.parse(seg.slice(a, b + 1)) : [];
            } catch {
              /* ignore a malformed action block */
            }
          }
          const requestedActions = [
            ...taskActionItems,
            ...(Array.isArray(writeActionItems) ? writeActionItems : []),
          ];
          proposedActions = await resolveActions(requestedActions, focus);
          const unresolvedActions = flagUnresolvedActions(
            requestedActions,
            proposedActions
          );
          // Drop anything already proposed earlier in this thread, so the brain
          // can never ask the user to confirm the same thing twice.
          if (priorSigs.length)
            proposedActions = proposedActions.filter(
              (pa) => !actionWasAlreadyProposed(pa, priorSigs)
            );
          proposedActions = [...proposedActions, ...unresolvedActions];

          // --- SPOKEN summary (tolerant of a malformed close) ---
          let spoken = "";
          const spIdx = reply.indexOf("---SPOKEN---");
          if (spIdx !== -1) {
            let after = reply.slice(spIdx + "---SPOKEN---".length);
            reply = reply.slice(0, spIdx).trim();
            after = after
              .replace(/---END SPOKEN---[\s\S]*$/, "")
              .replace(/---SPOKEN---[\s\S]*$/, "");
            spoken = after.trim();
          }
          // Safety net: never let stray SPOKEN / TASKS / ACTIONS markers remain.
          reply = reply
            .replace(/---END (SPOKEN|TASKS|ACTIONS)---/g, "")
            .replace(/---(SPOKEN|TASKS|ACTIONS)---/g, "")
            .trim();

          // If we still hit the token ceiling, the prose can end mid-sentence
          // (and the SPOKEN block never arrived). Trim back to the last complete
          // sentence so it never dangles mid-word.
          if (stopReason === "max_tokens" && reply) {
            const cut = reply.match(/^[\s\S]*[.!?]["')\]]?(?=\s|$)/);
            if (cut && cut[0].trim().length > 60) reply = cut[0].trim();
          }

          if (!reply)
            reply = proposedActions.length
              ? `I have prepared the exact changes for your approval.`
              : "Sorry, I couldn't form a reply just then. Try again?";

          await partialSave;
          const { error: saveError } = await supabaseAdmin
            .from("assistant_messages")
            .update({
              content: reply,
              // Remember what was proposed so it is never re-offered next turn.
              action_sigs: proposedActions
                .filter((pa) => !pa.unavailable)
                .map((pa) => brainActionSignature(pa)),
            })
            .eq("id", persistedAssistantId);
          if (saveError) throw saveError;

          // One timing line per reply (visible in Vercel runtime logs). ctxMs =
          // DB/context gather, ttftMs = time to first word, totalMs = end to end.
          // cacheRead > 0 proves the prompt cache is hitting.
          console.log(
            "assistant-timing " +
              JSON.stringify({
                model: simple ? "live" : "think",
                ctxMs,
                ttftMs: firstTokenAt ? firstTokenAt - reqStart : null,
                totalMs: Date.now() - reqStart,
                stop: stopReason,
                inTok: usage?.input_tokens ?? null,
                outTok: usage?.output_tokens ?? null,
                cacheRead: usage?.cache_read_input_tokens ?? null,
                cacheWrite: usage?.cache_creation_input_tokens ?? null,
                contextMode: wantsDeepHistory ? "extended" : "memory",
                screen: screenContext.section,
              })
          );
          frame(controller, {
            type: "done",
            reply,
            spoken,
            createdTasks,
            proposedActions,
            contextMode: wantsDeepHistory ? "extended" : "memory",
          });
        } catch (e: any) {
          console.error("Assistant stream failed:", e);
          try {
            await partialSave;
            const recovered = full.trim();
            await supabaseAdmin
              .from("assistant_messages")
              .update({
                content: recovered
                  ? `${recovered}\n\n(Reply interrupted. Ask the Brain to continue from here.)`
                  : "The reply was interrupted before it began. Ask the Brain to try again.",
              })
              .eq("id", persistedAssistantId);
          } catch (saveErr) {
            console.error("Assistant recovery save failed:", saveErr);
          }
          frame(controller, {
            type: "error",
            error: "the assistant failed just then - try again",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(streamBody, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "assistant failed" },
      { status: 500 }
    );
  }
}
