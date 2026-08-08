import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

export type CommercialMemory = {
  sourceHash: string;
  company: string;
  relationship: string;
  lastCall: null | {
    at: string;
    headline: string;
    overview: string;
    ourActions: string[];
    theirActions: string[];
    gaps: string[];
    painPoints: string[];
    decisions: string[];
    buyingSignals: string[];
    objections: string[];
    commercialOpportunities: string[];
    missedOpportunities: string[];
  };
  email: null | { at: string | null; summary: string };
  outreach: null | {
    person: string;
    category: string;
    summary: string;
    lastReplyAt: string | null;
    lastContactedAt: string | null;
  };
  opportunity: null | {
    id: string;
    title: string;
    stage: string;
    probability: number;
    value: number | null;
    nextAction: string;
    nextActionDueAt: string | null;
    nextActionOwner: string;
  };
  stakeholders: {
    name: string;
    jobTitle: string;
    buyingRole: string;
    influence: string;
    engagement: string;
  }[];
  openActions: { text: string; kind: string; dueAt: string | null }[];
  addedContext: { title: string; content: string }[];
};

const cut = (value: any, max: number): string => {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/, "")}…` : clean;
};
const list = (value: any, max = 3): string[] =>
  (Array.isArray(value) ? value : [])
    .filter((item: any) => typeof item === "string" && item.trim())
    .slice(0, max)
    .map((item: string) => cut(item, 220));

// Refreshes a small facts-only memory. Database reads are cheap; model input
// is not. The source hash avoids rewriting the row when nothing material has
// changed and also invalidates the cached next-call intent when something has.
export async function getCommercialMemory(companyId: string): Promise<CommercialMemory | null> {
  try {
    const [companyRes, callsRes, tasksRes, opportunitiesRes, contextRes, prospectsRes, contactsRes] = await Promise.all([
      supabaseAdmin
        .from("companies")
        .select("name, profile, notes, email_context, email_context_updated_at, commercial_memory")
        .eq("id", companyId)
        .single(),
      supabaseAdmin
        .from("interview_summaries")
        .select("id, created_at, summary")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1),
      supabaseAdmin
        .from("tasks")
        .select("id, text, kind, due_at, created_at")
        .eq("company_id", companyId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(8),
      supabaseAdmin
        .from("opportunities")
        .select("id, title, value, status, pipeline_stage, probability, next_action, next_action_due_at, next_action_owner, updated_at")
        .eq("company_id", companyId)
        .eq("opportunity_type", "revenue")
        .order("updated_at", { ascending: false })
        .limit(5),
      supabaseAdmin
        .from("client_context")
        .select("id, kind, title, content, url, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(3),
      supabaseAdmin
        .from("outreach_prospects")
        .select("id, first_name, last_name, email, reply_category, reply_summary, last_reply_at, last_contacted_at, updated_at")
        .eq("crm_company_id", companyId)
        .order("updated_at", { ascending: false })
        .limit(3),
      supabaseAdmin
        .from("contacts")
        .select("id, name, role, attributes, updated_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true })
        .limit(20),
    ]);
    const company: any = companyRes.data;
    if (!company) return null;
    const call: any = callsRes.data?.[0] || null;
    const tasks: any[] = tasksRes.data || [];
    const opportunity: any = (opportunitiesRes.data || []).find((row: any) => row.status === "open") || opportunitiesRes.data?.[0] || null;
    const contexts: any[] = contextRes.data || [];
    const prospect: any = prospectsRes.data?.[0] || null;
    const contacts: any[] = contactsRes.data || [];
    const profile = company.profile && typeof company.profile === "object" ? company.profile : {};
    const brief = Array.isArray(profile.brief) ? profile.brief.join(" ") : profile.brief;
    const relationship = cut(brief || company.notes, 600);
    const sourceHash = createHash("sha256").update(JSON.stringify({
      schema: 3,
      name: company.name,
      relationship,
      emailAt: company.email_context_updated_at,
      email: cut(company.email_context, 900),
      call: call ? [call.id, call.created_at] : null,
      tasks: tasks.map((row) => [row.id, row.text, row.kind, row.due_at]),
      opportunity: opportunity ? [opportunity.id, opportunity.updated_at, opportunity.status, opportunity.next_action] : null,
      context: contexts.map((row) => [row.id, row.created_at, cut(row.content || row.url, 400)]),
      outreach: prospect ? [prospect.id, prospect.updated_at, prospect.reply_category, prospect.last_reply_at] : null,
      stakeholders: contacts.map((row) => [
        row.id,
        row.name,
        row.role,
        row.updated_at,
        row.attributes?.stakeholderRole,
        row.attributes?.stakeholderInfluence,
        row.attributes?.stakeholderEngagement,
      ]),
    })).digest("hex");

    const existing = company.commercial_memory as CommercialMemory | null;
    if (existing?.sourceHash === sourceHash) return existing;
    const summary: any = call?.summary && typeof call.summary === "object" ? call.summary : {};
    const person = prospect
      ? [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || prospect.email || "Prospect"
      : "";
    const memory: CommercialMemory = {
      sourceHash,
      company: cut(company.name, 140),
      relationship,
      lastCall: call ? {
        at: call.created_at,
        headline: cut(summary.headline || summary.title, 220),
        overview: cut(summary.overview, 450),
        ourActions: list(summary.myNextActions),
        theirActions: list(summary.theirNextActions),
        gaps: list(summary.notCovered),
        painPoints: list(summary.painPoints),
        decisions: list(summary.decisions),
        buyingSignals: list(summary.buyingSignals),
        objections: list(summary.objections),
        commercialOpportunities: list(summary.commercialOpportunities),
        missedOpportunities: list(summary.missedOpportunities),
      } : null,
      email: company.email_context ? {
        at: company.email_context_updated_at || null,
        summary: cut(company.email_context, 800),
      } : null,
      outreach: prospect ? {
        person: cut(person, 120),
        category: cut(prospect.reply_category, 60),
        summary: cut(prospect.reply_summary, 400),
        lastReplyAt: prospect.last_reply_at || null,
        lastContactedAt: prospect.last_contacted_at || null,
      } : null,
      opportunity: opportunity ? {
        id: opportunity.id,
        title: cut(opportunity.title, 180),
        stage: cut(opportunity.pipeline_stage || opportunity.status, 60),
        probability: Number(opportunity.probability) || 0,
        value: opportunity.value == null ? null : Number(opportunity.value) || 0,
        nextAction: cut(opportunity.next_action, 300),
        nextActionDueAt: opportunity.next_action_due_at || null,
        nextActionOwner: cut(opportunity.next_action_owner, 30) || "us",
      } : null,
      stakeholders: contacts
        .map((row) => ({
          name: cut(row.name, 100),
          jobTitle: cut(row.role, 100),
          buyingRole: cut(row.attributes?.stakeholderRole, 30) || "unknown",
          influence: cut(row.attributes?.stakeholderInfluence, 20) || "medium",
          engagement: cut(row.attributes?.stakeholderEngagement, 20) || "neutral",
        }))
        .sort((a, b) => {
          const roleRank: Record<string, number> = {
            decision_maker: 0,
            champion: 1,
            influencer: 2,
            user: 3,
            blocker: 4,
            unknown: 5,
          };
          return (roleRank[a.buyingRole] ?? 5) - (roleRank[b.buyingRole] ?? 5);
        })
        .slice(0, 8),
      openActions: tasks.slice(0, 8).map((row) => ({
        text: cut(row.text, 220),
        kind: cut(row.kind, 50),
        dueAt: row.due_at || null,
      })),
      addedContext: contexts.map((row) => ({
        title: cut(row.title || row.kind, 100),
        content: cut(row.content || row.url, 400),
      })),
    };
    await supabaseAdmin
      .from("companies")
      .update({ commercial_memory: memory, commercial_memory_updated_at: new Date().toISOString() })
      .eq("id", companyId);
    return memory;
  } catch {
    return null;
  }
}

export function formatCommercialMemoryBlock(memory: CommercialMemory | null): string {
  if (!memory) return "";
  const lines = [`CLIENT COMMERCIAL MEMORY: ${memory.company}`];
  if (memory.relationship) lines.push(`Relationship: ${memory.relationship}`);
  if (memory.stakeholders?.length) {
    lines.push(
      `Stakeholders: ${memory.stakeholders
        .map(
          (person) =>
            `${person.name}${person.jobTitle ? ` (${person.jobTitle})` : ""} [${person.buyingRole.replace(/_/g, " ")}, ${person.influence} influence, ${person.engagement}]`
        )
        .join(" | ")}`
    );
  }
  if (memory.lastCall) {
    lines.push(`Latest call (${memory.lastCall.at}): ${memory.lastCall.headline} ${memory.lastCall.overview}`.trim());
    if (memory.lastCall.ourActions.length) lines.push(`We owe: ${memory.lastCall.ourActions.join(" | ")}`);
    if (memory.lastCall.theirActions.length) lines.push(`They owe: ${memory.lastCall.theirActions.join(" | ")}`);
    if (memory.lastCall.gaps.length) lines.push(`Not covered: ${memory.lastCall.gaps.join(" | ")}`);
    if (memory.lastCall.painPoints.length) lines.push(`Pain points: ${memory.lastCall.painPoints.join(" | ")}`);
    if (memory.lastCall.decisions?.length) lines.push(`Decisions: ${memory.lastCall.decisions.join(" | ")}`);
    if (memory.lastCall.buyingSignals?.length) lines.push(`Buying signals: ${memory.lastCall.buyingSignals.join(" | ")}`);
    if (memory.lastCall.objections?.length) lines.push(`Objections or blockers: ${memory.lastCall.objections.join(" | ")}`);
    if (memory.lastCall.commercialOpportunities?.length) lines.push(`Commercial opportunities: ${memory.lastCall.commercialOpportunities.join(" | ")}`);
    if (memory.lastCall.missedOpportunities?.length) lines.push(`Missed opportunities: ${memory.lastCall.missedOpportunities.join(" | ")}`);
  }
  if (memory.email) lines.push(`Latest email context (${memory.email.at || "date unknown"}): ${memory.email.summary}`);
  if (memory.outreach) lines.push(`Outreach with ${memory.outreach.person}: ${memory.outreach.category || "no reply category"}. ${memory.outreach.summary}`.trim());
  if (memory.opportunity) lines.push(`Revenue opportunity: ${memory.opportunity.title}. Stage ${memory.opportunity.stage}, ${memory.opportunity.probability}%, ${memory.opportunity.value == null ? "value not set" : `£${memory.opportunity.value}`}. Next: ${memory.opportunity.nextAction || "not confirmed"}${memory.opportunity.nextActionDueAt ? `, due ${memory.opportunity.nextActionDueAt.slice(0, 10)}` : ""}, owner ${memory.opportunity.nextActionOwner}.`);
  if (memory.openActions.length) lines.push(`Open CRM actions: ${memory.openActions.map((row) => `${row.text}${row.dueAt ? ` (due ${row.dueAt.slice(0, 10)})` : ""}`).join(" | ")}`);
  if (memory.addedContext.length) lines.push(`Latest added context: ${memory.addedContext.map((row) => `${row.title}: ${row.content}`).join(" | ")}`);
  return lines.join("\n").slice(0, 5200);
}

export async function getCommercialMemoryBlock(companyId: string): Promise<string> {
  return formatCommercialMemoryBlock(await getCommercialMemory(companyId));
}
