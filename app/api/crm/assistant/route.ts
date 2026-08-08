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
  gatherOutreachContext,
  findCompaniesNamedIn,
} from "@/lib/crm-context";
import { getCommercialMemoryBlock } from "@/lib/commercial-memory";
import { workspaceContextBlock, getLessonsBlock, getBrainQuestions } from "@/lib/workspace";
import { logModelUsage } from "@/lib/usage";

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
  const { data } = await supabaseAdmin
    .from("upcoming_calls")
    .select("id, title, scheduled_at, intent")
    .ilike("title", `%${term}%`)
    .gte("scheduled_at", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(4);
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
  const { data } = await supabaseAdmin
    .from("companies")
    .select("id, name")
    .ilike("name", `%${term}%`)
    .limit(1);
  return data && data[0] ? data[0] : null;
}
async function findOpenTask(text: string) {
  const term = likeTerm(text);
  if (!term) return null;
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("id, text")
    .eq("status", "open")
    .ilike("text", `%${term}%`)
    .limit(1);
  return data && data[0] ? data[0] : null;
}
async function findDraft(subject: string) {
  const term = likeTerm(subject);
  if (!term) return null;
  const { data } = await supabaseAdmin
    .from("follow_ups")
    .select("id, draft_subject")
    .eq("status", "draft")
    .ilike("draft_subject", `%${term}%`)
    .limit(1);
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
  let q = supabaseAdmin
    .from("opportunities")
    .select("id, title, company_id, status, pipeline_stage")
    .order("updated_at", { ascending: false })
    .limit(4);
  if (company) q = q.eq("company_id", company.id);
  if (term) q = q.ilike("title", `%${term}%`);
  if (!company && !term) return [];
  const { data } = await q;
  return (data || []).map((row: any) => ({ ...row, companyName: company?.name || "client" }));
}

function opportunityPatch(item: any): Record<string, any> {
  const patch: Record<string, any> = {};
  const stages = ["new", "discovery", "qualified", "proposal", "negotiation", "verbal", "won", "lost"];
  const forecasts = ["pipeline", "best_case", "commit", "omitted"];
  const statuses = ["open", "won", "lost", "dismissed"];
  const owners = ["us", "buyer", "joint"];
  const types = ["revenue", "investment", "internal", "strategic"];
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
  return patch;
}

function opportunityChangeLabel(patch: Record<string, any>): string {
  const bits: string[] = [];
  if (patch.pipelineStage) bits.push(`stage ${patch.pipelineStage}`);
  if (patch.probability != null) bits.push(`probability ${patch.probability}%`);
  if (patch.forecastCategory) bits.push(`forecast ${patch.forecastCategory.replace("_", " ")}`);
  if (patch.nextAction) bits.push(`next action "${patch.nextAction}"`);
  if (patch.nextActionDueAt) bits.push(`due ${patch.nextActionDueAt}`);
  if (patch.expectedCloseAt) bits.push(`expected close ${patch.expectedCloseAt}`);
  if (patch.value != null) bits.push(`value £${patch.value}`);
  if (patch.status) bits.push(`status ${patch.status}`);
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

// --- ACTION MEMORY: stop the brain re-proposing what it already offered ---
// The model cannot see its own past proposals (they are stripped from the saved
// reply), so it re-lists the same actions every turn. We store a compact
// signature of each proposed action on the message row and, next turn, drop any
// new action that matches one already proposed in this thread. The match is
// fuzzy (type + target + word overlap) so a reworded repeat is still caught.
const SIG_STOP = new Set([
  "the","a","an","and","or","for","to","of","in","on","that","this","with","record",
  "call","note","correct","remember","add","focus","update","client","profile","set",
  "link","them","their","from","into","have","has","been","also","just","now","who",
  "his","her","one","two","day","take","over","around","still","worth","new",
]);
const sigNorm = (s: any) =>
  String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const sigWords = (s: any): string[] =>
  Array.from(
    new Set(sigNorm(s).split(" ").filter((w) => w.length >= 4 && !SIG_STOP.has(w)))
  );
const sigTarget = (pa: any): string => {
  const ep = String(pa?.endpoint || "");
  let m = ep.match(/\/companies\/([^/]+)/);
  if (m) return m[1];
  m = ep.match(/\/upcoming\/([^/]+)/);
  if (m) return m[1];
  const b = pa?.body || {};
  return sigNorm(b.name || b.email || b.query || b.client || "");
};
function actionSig(pa: any): { type: string; target: string; words: string[] } {
  return { type: String(pa?.type || ""), target: sigTarget(pa), words: sigWords(pa?.label) };
}
function sigOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const bs = new Set(b);
  let n = 0;
  for (const w of a) if (bs.has(w)) n++;
  return n / Math.min(a.length, b.length);
}
// True if this action was effectively already proposed earlier in the thread.
function alreadyProposed(pa: any, prior: any[]): boolean {
  const t = sigTarget(pa);
  const w = sigWords(pa?.label);
  const type = String(pa?.type || "");
  return (prior || []).some((p) => {
    if (!p || p.type !== type) return false;
    const ov = sigOverlap(w, Array.isArray(p.words) ? p.words : []);
    if (p.target && t && p.target === t && ov >= 0.34) return true; // same target, reworded
    if (!p.target && !t && ov >= 0.5) return true; // targetless (e.g. remember)
    return ov >= 0.7; // near-identical wording regardless
  });
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

    if (it.type === "create_task") {
      const text = typeof it.text === "string" ? it.text.trim() : "";
      if (!text) continue;
      const company = it.client ? await findCompany(String(it.client)) : null;
      out.push({
        key,
        type: it.type,
        label: `Add to-do: "${text.slice(0, 180)}"${company ? ` for ${company.name}` : ""}`,
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
      // Pull the recent Gmail thread with a person and build / refresh their
      // client from it. The client fires this endpoint on confirm; the route
      // reads Gmail server-side and creates or updates the company + contact.
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

export async function POST(req: NextRequest) {
  try {
    const { companyId, focusCompanyId, message, screenContext: rawScreen } = await req.json();
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }
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
    const wantsDeepHistory =
      /\b(full history|all calls|previous calls|older calls|past conversations|detailed history|every scorecard|source history|documents?|detailed notes?|email thread|what did .* say)\b/i.test(
        message
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
      const named = await findCompaniesNamedIn(message);
      const detailIds: string[] = [];
      if (focus) detailIds.push(focus);
      for (const n of named) {
        if (!detailIds.includes(n.id) && detailIds.length < 3)
          detailIds.push(n.id);
      }
      const wantsOutreachDetail =
        /\b(outreach|prospect|campaign|cold email|sequence|reply|replies|linkedin|send today|approved|priority|priorities|what.*next)\b/i.test(message);
      const [digest, outreach, ...details] = await Promise.all([
        gatherGlobalContext(),
        gatherOutreachContext(message, { detailed: wantsOutreachDetail }),
        ...detailIds.map((id) =>
          wantsDeepHistory ? gatherClientContext(id) : getCommercialMemoryBlock(id)
        ),
      ]);
      const detailBlocks = (details as (string | null)[]).filter(
        (d): d is string => !!d && d.trim().length > 0
      );
      const wider = [digest, outreach].filter(Boolean).join("\n\n==========\n\n");
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
    const [context, histRes, biz, lessons, brainQuestions] = await Promise.all([
      gatherContext(),
      histQ,
      workspaceContextBlock(),
      getLessonsBlock(["negotiation", "strategy", "psychology"]),
      getBrainQuestions(),
    ]);
    const ctxMs = Date.now() - reqStart; // time to gather all grounding context
    if (!context) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }
    const history = (histRes as any)?.data;
    // Signatures of actions already proposed earlier in this thread, so we never
    // re-offer the same one (the model can't see its own past proposals).
    const priorSigs: any[] = [];
    for (const m of (history || []) as any[]) {
      if (Array.isArray(m?.action_sigs))
        for (const s of m.action_sigs) if (s && s.type) priorSigs.push(s);
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

    const scope = isGlobal
      ? `You are the user's overall CRM assistant. You know ALL their clients and their whole pipeline (below). They might ask about one client ("what do I do next with Alaine"), or across everyone ("what's my to-do list", "which deal is closest to closing"). When they name a client, match it to the closest one in the context even if the spelling is slightly off, and answer about them. When the question is across the board, pull from everyone.`
      : `You are the user's strategic co-founder and CRM assistant. They are currently on ONE client's page, so by default answer about that client (the FOCUSED CLIENT below) and help move that relationship forward. But you are NOT limited to them - the user may bring up another client, a fresh idea, their week, or anything at all, and you should help with whatever they raise, drawing on the wider pipeline below. Whatever the topic, help them plan, prep and take action.`;
    const qBlock = brainQuestions
      ? `\n\nTHINGS YOU ARE TRYING TO LEARN (open questions about the user's business that would make you sharper). When it fits naturally, when the user asks what you need, or when you are brainstorming, raise one or two of these - never the whole list and never force them. When the user answers, weave it into your reply and treat it as fact from then on:\n${brainQuestions}`
      : "";
    const system: any[] = [
      {
        type: "text",
        text: `${biz}${lessons}${scope}${qBlock}

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

DRAFTS - ONLY WHEN ASKED (this keeps replies fast): do NOT write a full email, message or document unless the user EXPLICITLY asks you to draft, write, or send one. For a normal question, answer concisely and, if a draft would help, OFFER it in a single line ("want me to draft that email?") rather than writing it. Writing a long draft nobody asked for is slow and wasteful. When they DO ask you to draft something, put ONLY that sendable text between these exact marker lines:
---DRAFT---
<the sendable text only - for an email include a "Subject:" line then the body>
---END DRAFT---
Keep your commentary and reasoning OUTSIDE the markers. The text inside the markers can be plain and clean since it is what gets sent.

TO-DOS: when the user asks you to arrange, remember, chase, follow up, add, draft, prep, or otherwise CREATE actions to do later, propose each as a to-do. It is shown in the visible action plan and is only created after approval. In ADDITION to your normal prose reply, put ONLY a JSON array between these exact markers:
---TASKS---
[{"text":"short imperative to-do","action":"email|call|task","dueAt":"YYYY-MM-DD","pinned":true}]
---END TASKS---
Use "action" = "email" for anything to write or send, "call" to prep or schedule a call, "task" for anything else. Set "dueAt" to the deadline DATE when the user gives one, working out the real date from today's date in the context (e.g. "by Friday" becomes that Friday's YYYY-MM-DD, "by end of month" the last day of this month). Set "pinned" to true when the user says to keep it at the top, make it top priority, do it first, or that it is urgent. OMIT dueAt and pinned when the user did not give a deadline or priority. Only propose to-dos the user actually wants tracked, and do not repeat ones already outstanding in the context. Keep these markers out of your prose, and still answer naturally.

CALENDAR: the user's upcoming calls, synced from their calendar, are in the context below in the calls list, each with its join link when there is one. Answer "what's on my calendar" / "what's next" from that, and give the join link when asked. You cannot edit their Google calendar itself, but you CAN, with their confirmation, attach or change the meeting link, set or clear the intent, or link a call to a client on the in-app call record (see ACTIONS). If they tell you a call moved or was cancelled, note it or add a to-do, and remind them the synced view refreshes from their calendar.

ACTIONS YOU CAN TAKE (never claim you already did them, approval is what does the work): you can change call records, create or update internal CRM records, create and configure outreach campaigns, select a review queue, create profiles and to-dos, update opportunities, pull email context, remember durable rules, correct records, and dismiss stale work. The current screen tells you what to lead with, but you are universal and can act anywhere in the CRM. Put ONLY the exact requested changes in a JSON array between these markers:
---ACTIONS---
[{"type":"set_meeting_link","call":"<call title or person from the context>","url":"<link>"},{"type":"set_intent","call":"<call title>","intent":"<intent text, empty to clear>"},{"type":"add_intent","call":"<call title>","note":"<the focus note to add to that call, kept alongside what is already there>"},{"type":"link_call","call":"<call title>","client":"<client name>"},{"type":"cancel_call","call":"<call title>","reason":"<why it is not happening, optional>"},{"type":"dismiss","kind":"draft","item":"<the draft subject>"},{"type":"dismiss","kind":"task","item":"<the to-do text>"},{"type":"create_client","name":"<person or company name>","brief":"<what you know about them so far, one or two sentences>"},{"type":"remember","note":"<the durable preference, habit, standard practice or fact to save, in one clear line>"},{"type":"correct","client":"<the client this correction is about>","correction":"<the corrected fact in one clear line>"},{"type":"pull_emails","person":"<their name>","email":"<their email if you know it, optional>"}]
---END ACTIONS---
Additional supported actions are:
{"type":"create_campaign","name":"<campaign name>","goal":"<commercial outcome>","audience":"<specific ideal customer profile>","offerAngle":"<one grounded Interviewa angle>","dailyLimit":20}
{"type":"update_campaign","campaign":"<existing campaign name or active campaign>","goal":"<optional>","audience":"<optional>","offerAngle":"<optional>","dailyLimit":20,"status":"draft|active|paused|completed"}
{"type":"build_outreach_queue","limit":20}
{"type":"update_opportunity","client":"<client name>","opportunity":"<opportunity title if needed>","pipelineStage":"new|discovery|qualified|proposal|negotiation|verbal|won|lost","probability":0,"forecastCategory":"pipeline|best_case|commit|omitted","nextAction":"<one move>","nextActionDueAt":"YYYY-MM-DD","nextActionOwner":"us|buyer|joint","expectedCloseAt":"YYYY-MM-DD","status":"open|won|lost|dismissed"}
For update_opportunity include only fields the user actually supplied or that are literally supported by the CRM context. Never invent a value, probability, date or stage. Prospect value is deliberately unknown before a substantive call establishes likely usage, buying process, urgency and next-step evidence, so never assign or use speculative prospect values for outreach priority.
For update_campaign you may also include "voice":{"tone":"...","style":"...","rules":["..."],"signature":"Lee"}, "bannedPhrases":["..."], "bookingUrl":"https://...", "bookingCtaMode":"interested_reply|final_step|always|never", and "sequence":[{"step":1,"delayDays":0,"purpose":"...","contentType":"plain|insight|case_study|video|close_loop","guidance":"...","assetUrl":null}]. Only include settings the user asked for or approved in the conversation.

CAMPAIGN SAFETY: create_campaign always creates a draft. build_outreach_queue only selects up to the daily limit for review and spends no research tokens. Never propose or execute research, message approval or email sending as a universal batch action. Exact outreach drafts and external sends stay in the dedicated Outreach approval flow.

BATCH APPROVAL: when the user asks for several safe internal changes, emit them together. The interface shows every exact change and offers one approval for the safe subset. Destructive changes, Gmail pulls and any future external send stay separately confirmed.
When a call is cancelled or has moved off the calendar, use cancel_call (it removes the call and its prep to-do and records the reason). If there are also leftover to-dos or drafts about that call, propose dismissing those too. If you are not sure which call, client, draft or to-do the user means, ask them to clarify in your prose reply rather than guessing (the system will also offer a pick-list if more than one record matches the name).
Refer to the call, client, draft or to-do by the exact name/title/text shown in the context so it can be matched. Each one is shown to the user with a Confirm button and nothing happens until they tap it, so never say it is done.

NEW PEOPLE: when the user introduces or talks about a person or company who is a contact, prospect, partner or lead and is NOT already in the context, proactively OFFER to create their profile with create_client, capturing what you know in the brief, so future calls and notes track against them. Suggest it early rather than waiting to be asked twice.

PULL EMAILS: you CAN read the user's Gmail thread with a person (through the connected Google account) and build their client from it. When the user asks you to pull, fetch, check or look at someone's email, or to add a client from an email thread, emit a "pull_emails" action with their name (and their email if it is in the context or the message). This reads the recent thread with them, distils it into their client context, and creates or refreshes their profile and contact, ready for prep. Do not say you cannot access email. If Google is not connected or Gmail was not granted, the action will report that back and the user can connect it in Settings. When the user mentions emailing someone new from a company address, offer to pull the thread and set them up.

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
      { role: "user" as const, content: message.trim() },
    ];

    // Route obvious data lookups (your to-do list, what's on the calendar) to the
    // FAST model - it is only reading the context that is already here. Anything
    // that creates, judges, plans, drafts, advises, compares or summarises stays
    // on the smart model, since that is the part that matters.
    const ml = message.toLowerCase();
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
          proposedActions = await resolveActions(
            [...taskActionItems, ...(Array.isArray(writeActionItems) ? writeActionItems : [])],
            focus
          );
          // Drop anything already proposed earlier in this thread, so the brain
          // can never ask the user to confirm the same thing twice.
          if (priorSigs.length)
            proposedActions = proposedActions.filter(
              (pa) => !alreadyProposed(pa, priorSigs)
            );

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

          await supabaseAdmin.from("assistant_messages").insert([
            {
              company_id: isGlobal ? null : companyId,
              role: "user",
              content: message.trim(),
            },
            {
              company_id: isGlobal ? null : companyId,
              role: "assistant",
              content: reply,
              // Remember what was proposed so it is never re-offered next turn.
              action_sigs: proposedActions.map((pa) => actionSig(pa)),
            },
          ]);

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
