import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { modelText, parseObject } from "@/lib/outreach";
import { removeDashesFromProse } from "@/lib/outreach-voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE_TYPES = new Set(["linkedin", "email", "news", "manual"]);
const SIGNAL_TYPES = new Set(["hiring", "growth", "pain", "leadership", "funding", "partnership", "product", "engagement", "other"]);
const ACTIONS = new Set(["comment", "message", "prepare_outreach", "follow_up", "ignore"]);
const LEVELS = new Set(["high", "medium", "low"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SIGNAL_FORMAT = {
  type: "json_schema",
  name: "buying_signal",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["signalType", "summary", "relevanceReason", "opportunityHypothesis", "evidence", "recommendedAction", "draftText", "priority", "confidence"],
    properties: {
      signalType: { type: "string", enum: [...SIGNAL_TYPES] },
      summary: { type: "string" },
      relevanceReason: { type: "string" },
      opportunityHypothesis: { type: "string" },
      evidence: { type: "array", maxItems: 3, items: { type: "string" } },
      recommendedAction: { type: "string", enum: [...ACTIONS] },
      draftText: { type: "string" },
      priority: { type: "string", enum: [...LEVELS] },
      confidence: { type: "string", enum: [...LEVELS] },
    },
  },
};

function concise(value: unknown, max: number) {
  return removeDashesFromProse(String(value || "").replace(/\s+/g, " ").trim()).slice(0, max);
}

function validUrl(value: string) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function GET() {
  const [signalsRes, prospectsRes, companiesRes] = await Promise.all([
    supabaseAdmin.from("outreach_signals").select("*").order("created_at", { ascending: false }).limit(200),
    supabaseAdmin
      .from("outreach_prospects")
      .select("id,first_name,last_name,company_name,job_title,email,status")
      .neq("status", "suppressed")
      .order("company_name", { ascending: true })
      .limit(1000),
    supabaseAdmin.from("companies").select("id,name,stage").order("name", { ascending: true }).limit(1000),
  ]);
  const error = signalsRes.error || prospectsRes.error || companiesRes.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    signals: signalsRes.data || [],
    prospects: prospectsRes.data || [],
    companies: companiesRes.data || [],
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sourceType = SOURCE_TYPES.has(body.sourceType) ? body.sourceType : "manual";
    const sourceText = String(body.sourceText || "").trim().slice(0, 8000);
    const sourceUrl = String(body.sourceUrl || "").trim().slice(0, 1200) || null;
    const prospectId = UUID.test(String(body.prospectId || "")) ? String(body.prospectId) : null;
    const companyId = UUID.test(String(body.companyId || "")) ? String(body.companyId) : null;
    if (sourceText.length < 25)
      return NextResponse.json({ error: "Paste enough of the post, email or update for a reliable signal." }, { status: 400 });
    if (!validUrl(sourceUrl || ""))
      return NextResponse.json({ error: "The source link is not a valid web address." }, { status: 400 });

    const [prospectRes, companyRes] = await Promise.all([
      prospectId
        ? supabaseAdmin.from("outreach_prospects").select("id,first_name,last_name,job_title,company_name,email,research,status").eq("id", prospectId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      companyId
        ? supabaseAdmin.from("companies").select("id,name,stage,sector,commercial_memory").eq("id", companyId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (prospectRes.error || companyRes.error) throw prospectRes.error || companyRes.error;
    if (prospectId && !prospectRes.data)
      return NextResponse.json({ error: "That prospect could not be found." }, { status: 404 });
    if (companyId && !companyRes.data)
      return NextResponse.json({ error: "That client could not be found." }, { status: 404 });

    const prospect = prospectRes.data as any;
    const company = companyRes.data as any;
    const authorName = concise(body.authorName || (prospect ? `${prospect.first_name || ""} ${prospect.last_name || ""}` : ""), 160);
    const authorRole = concise(body.authorRole || prospect?.job_title, 160);
    const companyName = concise(body.companyName || prospect?.company_name || company?.name, 200);
    const system = `You are analysing one possible commercial buying signal for Lee Nazari, CEO of Interviewa.

Interviewa helps recruiters prepare candidates for interviews and can support screening. The commercial goal is credible customer revenue and useful partnerships, not engagement for its own sake.

Use ONLY the supplied evidence and saved context. Never invent urgency, budgets, authority, relationships, hiring volume, client results or personal facts. Distinguish a fact from a hypothesis. If the material is generic or weak, recommend ignore. A public LinkedIn comment should add a useful thought and normally avoid pitching. Recommend a direct message or outreach only when the evidence supports a relevant next step. Never imply Lee knows the person unless the saved context proves it.

Priority means commercial usefulness now: high requires a specific timely need or direct relationship trigger, medium is relevant but not urgent, low is weak or generic. Confidence is confidence in the interpretation, not confidence that a sale will close.

Write British English in Lee's concise, natural voice. Do not use hyphens, dashes, semicolons, hype or fake familiarity. The summary is at most 40 words. Relevance is at most 50 words. The opportunity hypothesis is at most 35 words and must be labelled as a possibility in its wording. Each evidence item is a short factual observation copied or closely paraphrased from the source. Draft comments are 30 to 65 words. Draft messages are 45 to 90 words. prepare_outreach should give a short first contact opener. follow_up should give a short follow up. If action is ignore, draftText must be empty.

Nothing is being posted or sent. Lee will review and approve the exact words.`;
    const user = `SOURCE TYPE: ${sourceType}
SOURCE URL: ${sourceUrl || "not supplied"}
AUTHOR: ${authorName || "not supplied"}
ROLE: ${authorRole || "not supplied"}
COMPANY: ${companyName || "not supplied"}

LINKED PROSPECT CONTEXT:
${prospect ? JSON.stringify({ name: authorName, role: prospect.job_title, company: prospect.company_name, status: prospect.status, savedResearch: prospect.research || null }).slice(0, 2200) : "No outreach prospect linked."}

LINKED CRM CLIENT CONTEXT:
${company ? JSON.stringify({ name: company.name, stage: company.stage, sector: company.sector, commercialMemory: company.commercial_memory || null }).slice(0, 2200) : "No CRM client linked."}

NEW EVIDENCE:
${sourceText}`;

    const message = await openai.messages.create({
      model: OPENAI_MODEL_PRO,
      max_tokens: 900,
      response_format: SIGNAL_FORMAT,
      system,
      messages: [{ role: "user", content: user }],
    }, { timeout: 40_000 });
    await logModelUsage("outreach_signal", "pro", (message as any).usage, {
      sourceType,
      prospectId,
      companyId,
    });
    const parsed = parseObject(modelText(message));
    if (!parsed) throw new Error("The signal analysis was incomplete. Try again.");

    const signalType = SIGNAL_TYPES.has(parsed.signalType) ? parsed.signalType : "other";
    const recommendedAction = ACTIONS.has(parsed.recommendedAction) ? parsed.recommendedAction : "ignore";
    const priority = LEVELS.has(parsed.priority) ? parsed.priority : "low";
    const confidence = LEVELS.has(parsed.confidence) ? parsed.confidence : "low";
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.map((item: unknown) => concise(item, 240)).filter(Boolean).slice(0, 3)
      : [];
    const row = {
      source_type: sourceType,
      source_url: sourceUrl,
      source_text: sourceText,
      prospect_id: prospectId,
      company_id: companyId,
      author_name: authorName || null,
      author_role: authorRole || null,
      company_name: companyName || null,
      signal_type: signalType,
      summary: concise(parsed.summary, 500),
      relevance_reason: concise(parsed.relevanceReason, 600) || null,
      opportunity_hypothesis: concise(parsed.opportunityHypothesis, 500) || null,
      evidence,
      recommended_action: recommendedAction,
      draft_text: recommendedAction === "ignore" ? null : concise(parsed.draftText, 1400) || null,
      priority,
      confidence,
      status: "new",
      ai_processed_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin.from("outreach_signals").insert(row).select("*").single();
    if (error) {
      if (error.code === "23505")
        return NextResponse.json({ error: "That source link is already saved in Buying Signals." }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ signal: data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not analyse this buying signal." }, { status: 500 });
  }
}
