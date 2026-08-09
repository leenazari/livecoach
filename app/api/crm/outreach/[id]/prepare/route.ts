import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_LIVE, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { londonDate, modelSources, modelText, parseObject } from "@/lib/outreach";
import { OUTREACH_FROM_EMAIL } from "@/lib/gmail";
import { removeDashesFromProse } from "@/lib/outreach-voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const clean = (value: any, max: number) => removeDashesFromProse(
  String(value || "").replace(/[—–]/g, ", ").replace(/;/g, ",").trim()
).slice(0, max);

const OUTREACH_DRAFT_FORMAT = {
  type: "json_schema",
  name: "outreach_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["research", "strategy", "email"],
    properties: {
      research: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "signals", "activeJobs", "volumeAssessment", "volumeReason", "likelyNeeds", "bestAngle", "commercialPath", "fitDecision", "personalisationFact", "approvedProof", "freshness", "confidence"],
        properties: {
          summary: { type: "string" }, signals: { type: "array", items: { type: "string" } },
          activeJobs: { type: "array", items: { type: "string" } },
          volumeAssessment: { type: "string", enum: ["high", "medium", "low", "unknown"] },
          volumeReason: { type: "string" },
          likelyNeeds: { type: "array", items: { type: "string" } }, bestAngle: { type: "string" },
          commercialPath: { type: "string" }, fitDecision: { type: "string" },
          personalisationFact: { type: "string" }, approvedProof: { type: "string" }, freshness: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
      strategy: {
        type: "object",
        additionalProperties: false,
        required: ["reasoning", "evidenceUsed", "angle", "tone", "cta", "persona", "qualityScore"],
        properties: {
          reasoning: { type: "string" }, evidenceUsed: { type: "array", items: { type: "string" } },
          angle: { type: "string" }, tone: { type: "string" }, cta: { type: "string" },
          persona: { type: "string" }, qualityScore: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
      email: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "previewText", "bodyText"],
        properties: { subject: { type: "string" }, previewText: { type: "string" }, bodyText: { type: "string" } },
      },
    },
  },
} as const;

type CompleteOutreachDraft = {
  research: Record<string, any>;
  strategy: Record<string, any>;
  email: { subject: string; previewText?: string; bodyText: string };
};

const completeDraft = (value: any): value is CompleteOutreachDraft => !!(
  value?.research &&
  value?.strategy &&
  value?.email &&
  String(value.email.subject || "").trim() &&
  String(value.email.bodyText || "").trim()
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const startedAt = Date.now();
  console.log(JSON.stringify({ level: "info", msg: "outreach prepare started", route: "/api/crm/outreach/[id]/prepare", prospectId: params.id, requestId: req.headers.get("x-vercel-id") }));
  try {
    const prospectId = params.id;
    const body = await req.json().catch(() => ({}));
    const [{ data: prospect }, { data: enrolments }, { data: brain }, { data: revenueConfig }, { data: offerConfig }] = await Promise.all([
      supabaseAdmin.from("outreach_prospects").select("*").eq("id", prospectId).single(),
      supabaseAdmin.from("outreach_enrolments").select("*").eq("prospect_id", prospectId).eq("queued_for", londonDate()).in("status", ["queued", "researched", "drafted"]).limit(1),
      supabaseAdmin.from("workspace_profile").select("knowledge,learned").eq("id", "main").maybeSingle(),
      supabaseAdmin.from("app_config").select("value").eq("key", "revenue_target_gbp").maybeSingle(),
      supabaseAdmin.from("app_config").select("value").eq("key", "interviewa_outreach_offer_truth").maybeSingle(),
    ]);
    const enrolment = enrolments?.[0];
    if (!prospect || !enrolment) return NextResponse.json({ error: "This person is not in today's queue" }, { status: 400 });
    const { data: campaign } = await supabaseAdmin.from("outreach_campaigns").select("*").eq("id", enrolment.campaign_id).single();
    if (!campaign || campaign.status !== "active") return NextResponse.json({ error: "The campaign is not active" }, { status: 400 });
    const { data: learnings } = await supabaseAdmin.from("outreach_learnings").select("dimension,label,insight,confidence,sent_count,positive_reply_count,meeting_count").eq("campaign_id", campaign.id).eq("status", "promoted").order("meeting_count", { ascending: false }).limit(8);

    const step = Number(enrolment.current_step) || 1;
    // Stable 50/50 assignment lets reply rates teach us which subject approach
    // works without tracking opens or adding invasive pixels.
    const variant = parseInt(String(prospect.id).replace(/-/g, "").slice(-2), 16) % 2 === 0 ? "A" : "B";
    const existingResearch = enrolment.research && typeof enrolment.research === "object" ? enrolment.research : null;
    const offerTruth = typeof offerConfig?.value === "string"
      ? offerConfig.value
      : JSON.stringify(offerConfig?.value || {});
    const productTruth = `${brain?.knowledge || ""}\n${brain?.learned || ""}\n${offerTruth}`.slice(0, 6200);
    const revenueTarget = Math.max(1_000, Number(revenueConfig?.value) || 2_000_000);
    const voice = campaign.voice && typeof campaign.voice === "object" ? campaign.voice : {};
    const banned = Array.isArray(campaign.banned_phrases) ? campaign.banned_phrases.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 20) : [];
    const sequence = Array.isArray(campaign.sequence) ? campaign.sequence : [];
    const sequenceStep = sequence.find((row: any) => Number(row?.step) === step) || {
      step,
      purpose: step === 1 ? "Relevant opening and one easy question" : "Useful follow-up that adds a new reason to respond",
      contentType: "plain",
      guidance: "",
      assetUrl: null,
    };
    const lastStep = Math.max(1, ...sequence.map((row: any) => Number(row?.step) || 0));
    const includeBooking = !!campaign.booking_url && (campaign.booking_cta_mode === "always" || (campaign.booking_cta_mode === "final_step" && step >= lastStep));
    const system = `You are Lee Nazari's careful B2B outreach researcher and copywriter for Interviewa. Use web_search to check this exact person and company today. Return ONLY compact JSON.

COMMERCIAL NORTH STAR: help Interviewa build toward £${revenueTarget.toLocaleString("en-GB")} revenue over the next 12 months, in support of a roughly £10m valuation. Use this to prioritise credible routes to revenue and strong strategic relationships. Never invent a prospect's budget, deal value, urgency or buying authority to make them look valuable.

Do not invent personal facts, clients, results, savings, case studies, product capabilities or problems. Never present an illustrative scenario as a real customer result. Use a verified case study only when it appears in INTERVIEWA PRODUCT TRUTH. Otherwise approvedProof must be empty. A weak or absent signal must be stated as such. Do not use information from people with similar names. Do not mention that AI researched them. Use British English, no jargon, flattery, em dashes or semicolons.

RESEARCH DISCIPLINE: bring back only information that changes the decision or message. Prefer recent primary company sources and current role evidence. Find up to four current or very recent vacancies, including role, location and recency when verifiable. Assess hiring volume only from observed current evidence. Never invent a job count or use a generic industry applicant average as if it belongs to this company. Mark volume unknown when evidence is insufficient. Ignore generic biography, old news and facts that do not affect the campaign intent. Tie every retained fact to one of three outcomes: close a customer deal, build a commercially useful relationship, or start a credible partnership. Reuse saved research when still current and refresh only facts likely to have changed. The saved research must be concise enough to reuse in future Brain, intent and call prep prompts without reopening the web.

VOICE TO FOLLOW: ${clean(voice.tone || "warm, commercially curious and concise", 300)}. ${clean(voice.style || "Founder to founder, plain English and respectful", 400)}
COACHING RULES: ${Array.isArray(voice.rules) ? voice.rules.join(" | ").slice(0, 1000) : "Lead with one verified relevance signal | make one useful commercial observation | ask one easy question | never pretend familiarity"}
BANNED PHRASES: ${banned.join(" | ") || "quick question | hope you are well | reaching out"}.

The email must be plain text, 90 to 135 words, short mobile friendly paragraphs, one easy question as the CTA, and signed "${clean(voice.signature || "Lee", 80)}". End with a natural one line opt out such as "If this is not relevant, tell me and I will not follow up." It must sound individually written by Lee, not like a template or a faceless product message. Never use a hyphen, dash or em dash in prose, even when grammar normally calls for one. Write "better prepared", never "better-prepared". Subject under 45 characters. Use one or two verified current vacancies when available. Say that Interviewa specialises in preparing candidates for those exact types of roles, rather than making a generic recruitment claim. Explain that the prospect can try Interviewa free on a current vacancy, setup takes about 10 minutes, it adds no extra administration for their team, they control and can reuse the interview, and results appear in their dashboard. Where natural, state the approved proof that thousands of candidates already use Interviewa. Position better preparation as a credible way to improve candidate acceptance or client placement rates, but never guarantee a result. Say Lee will prove the value through the free trial, not that a placement outcome is guaranteed. Candidate training is the primary campaign angle. Mention screening only as a secondary possibility when verified vacancy volume makes it credible and product truth supports it. Be commercially vivid without hype. If no approved case study exists, use a concrete illustrative workflow such as practising for one live role, but never imply another customer achieved a result. This prospect is variant ${variant}, ${variant === "A" ? "use a direct relevance or benefit led subject" : "use a short natural question led subject"}. Do not use any banned phrase or fake familiarity. This is sequence step ${step}. ${step > 1 ? "This is a follow up. Do not repeat Lee's full introduction or the opening email, and make it easy to close the loop." : "This is the first email. After the personalised opening, introduce Lee naturally with: I’m Lee Nazari, CEO of Interviewa. Then explain in Lee's voice that we built it specifically to help recruiters prepare candidates for successful job placements. Keep Lee's name, CEO role and purpose."} ${includeBooking ? `Include this booking link once, naturally, as the optional next step: ${campaign.booking_url}` : "Do not include a calendar or booking link. Earn interest first."}

APPROVED SEQUENCE BRIEF FOR THIS STEP:
Purpose: ${clean(sequenceStep.purpose, 240)}
Content type: ${clean(sequenceStep.contentType || "plain", 60)}
Extra guidance: ${clean(sequenceStep.guidance, 500) || "none"}
${sequenceStep.assetUrl ? `Approved asset link: ${clean(sequenceStep.assetUrl, 600)}. Include it once only if it directly supports this step, never invent what the asset contains.` : "No asset link is approved for this step."}

Before writing, choose ONE evidence-backed reason this person should care now and ONE Interviewa angle. The first sentence must be grounded in a verified fact or transparently framed hypothesis. Never mix several random use cases. Explain your evidence and choice in strategy so Lee can approve the thinking as well as the words.

Output exactly:
{"research":{"summary":"max 65 words, only decision useful facts","signals":["max 3 factual current signals"],"activeJobs":["max 4 verified current or recent roles with location and recency when available"],"volumeAssessment":"high|medium|low|unknown","volumeReason":"evidence based reason, max 35 words","likelyNeeds":["max 2 clearly labelled hypotheses"],"bestAngle":"one grounded Interviewa angle led by candidate training","commercialPath":"customer deal|relationship|partnership plus one short reason","fitDecision":"contact now|hold|skip plus one short reason","personalisationFact":"one verifiable fact or empty string","approvedProof":"verified Interviewa case study or result from product truth, otherwise empty string","freshness":"what was checked and how current it is, max 25 words","confidence":"high|medium|low"},"strategy":{"reasoning":"why this one message is relevant, max 55 words","evidenceUsed":["max 3 facts actually used"],"angle":"short label","tone":"short label","cta":"short label","persona":"short label","qualityScore":0},"email":{"subject":"...","previewText":"...","bodyText":"..."}}`;
    const user = `PERSON
Name: ${prospect.first_name || ""} ${prospect.last_name || ""}
Role: ${prospect.job_title || ""}
Email: ${prospect.email}
LinkedIn hint: ${prospect.person_linkedin_url || ""}

COMPANY
Name: ${prospect.company_name}
Website: ${prospect.website || prospect.company_domain || ""}
Industry: ${prospect.industry || ""}
Employees: ${prospect.employee_range || ""}
Company LinkedIn hint: ${prospect.company_linkedin_url || ""}

CAMPAIGN
Audience: ${campaign.audience}
Goal: ${campaign.goal}
Angle: ${campaign.offer_angle}

INTERVIEWA PRODUCT AND OFFER TRUTH, use only the most relevant supported claims and do not list every feature:
${productTruth || campaign.offer_angle}

PROMOTED LEARNINGS, only use these when supported by enough evidence and relevant to this person:
${(learnings || []).length ? (learnings || []).map((learning: any) => `- ${learning.dimension}/${learning.label}: ${learning.insight} (${learning.confidence}, ${learning.sent_count} sent, ${learning.positive_reply_count} positive replies, ${learning.meeting_count} meetings)`).join("\n") : "No conversion learning yet. Do not invent best practices from nonexistent campaign results."}

${existingResearch ? `RESEARCH ALREADY SAVED, refresh only what may have changed and reuse solid facts:\n${JSON.stringify(existingResearch).slice(0, 3500)}` : ""}
${typeof body.guidance === "string" && body.guidance.trim() ? `LEE'S EXTRA GUIDANCE:\n${body.guidance.trim().slice(0, 1000)}` : ""}`;
    const message = await openai.messages.create({
      model: OPENAI_MODEL_PRO,
      max_tokens: 2000,
      response_format: OUTREACH_DRAFT_FORMAT,
      system,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] as any,
      messages: [{ role: "user", content: user }],
    }, { timeout: 38_000 });
    const originalText = modelText(message);
    const sources = modelSources(message);
    await logModelUsage("outreach_prepare", "pro", message?.usage, {
      prospectId,
      inputTokens: Number(message?.usage?.input_tokens) || 0,
      outputTokens: Number(message?.usage?.output_tokens) || 0,
      cachedInputTokens: Number(message?.usage?.cache_read_input_tokens) || 0,
      sourceCount: sources.length,
      stopReason: message?.stop_reason || "unknown",
      outputChars: originalText.length,
    });
    let parsed = parseObject(originalText);
    let formatRepaired = false;
    if (!completeDraft(parsed)) {
      console.warn(JSON.stringify({ level: "warning", msg: "outreach prepare needs format repair", prospectId, stopReason: message?.stop_reason || "unknown", outputChars: originalText.length, ms: Date.now() - startedAt }));
      const repair = await openai.messages.create({
        model: OPENAI_MODEL_LIVE,
        max_tokens: 1800,
        response_format: OUTREACH_DRAFT_FORMAT,
        system: `Repair an incomplete structured outreach result and return ONLY the required JSON. Preserve every supplied research fact. Never invent facts about the person, company, vacancies, customers, savings or results. If a research field is missing, use an empty array, empty string, unknown volume, or low confidence as appropriate. You may complete the email using only the supplied facts and approved Interviewa truth. Use British English, short mobile friendly paragraphs, one question, no semicolons, and no hyphens or dashes in prose. The first email must naturally introduce: I’m Lee Nazari, CEO of Interviewa. Include a natural opt out.`,
        messages: [{ role: "user", content: `PERSON: ${prospect.first_name || ""} ${prospect.last_name || ""}, ${prospect.job_title || ""} at ${prospect.company_name || ""}
CAMPAIGN GOAL: ${campaign.goal || ""}
CAMPAIGN ANGLE: ${campaign.offer_angle || ""}
SEQUENCE STEP: ${step}
APPROVED INTERVIEWA TRUTH:
${productTruth.slice(0, 3200)}

INCOMPLETE RESULT TO REPAIR:
${originalText.slice(0, 9000) || "No usable formatted text was returned. Use only the safe context above and mark all prospect research as low confidence."}` }],
      }, { timeout: 16_000 });
      await logModelUsage("outreach_prepare_repair", "live", repair?.usage, {
        prospectId,
        inputTokens: Number(repair?.usage?.input_tokens) || 0,
        outputTokens: Number(repair?.usage?.output_tokens) || 0,
        cachedInputTokens: Number(repair?.usage?.cache_read_input_tokens) || 0,
        originalStopReason: message?.stop_reason || "unknown",
      });
      parsed = parseObject(modelText(repair));
      formatRepaired = completeDraft(parsed);
    }
    if (!completeDraft(parsed)) {
      console.error(JSON.stringify({ level: "error", msg: "outreach prepare format repair failed", prospectId, ms: Date.now() - startedAt }));
      return NextResponse.json({ error: "The research response could not be formatted after an automatic repair. Nothing was saved or sent." }, { status: 502 });
    }
    const research = {
      summary: clean(parsed.research.summary, 800),
      signals: Array.isArray(parsed.research.signals) ? parsed.research.signals.map((x: any) => clean(x, 240)).filter(Boolean).slice(0, 3) : [],
      activeJobs: Array.isArray(parsed.research.activeJobs) ? parsed.research.activeJobs.map((x: any) => clean(x, 240)).filter(Boolean).slice(0, 4) : [],
      volumeAssessment: ["high", "medium", "low", "unknown"].includes(parsed.research.volumeAssessment) ? parsed.research.volumeAssessment : "unknown",
      volumeReason: clean(parsed.research.volumeReason, 300),
      likelyNeeds: Array.isArray(parsed.research.likelyNeeds) ? parsed.research.likelyNeeds.map((x: any) => clean(x, 240)).filter(Boolean).slice(0, 3) : [],
      bestAngle: clean(parsed.research.bestAngle, 400),
      commercialPath: clean(parsed.research.commercialPath, 240),
      fitDecision: clean(parsed.research.fitDecision, 240),
      personalisationFact: clean(parsed.research.personalisationFact, 400),
      approvedProof: clean(parsed.research.approvedProof, 400),
      freshness: clean(parsed.research.freshness, 180),
      confidence: ["high", "medium", "low"].includes(parsed.research.confidence) ? parsed.research.confidence : "low",
      generatedAt: new Date().toISOString(),
    };
    const email = {
      subject: removeDashesFromProse(clean(parsed.email.subject, 120)),
      preview_text: removeDashesFromProse(clean(parsed.email.previewText, 180)),
      body_text: removeDashesFromProse(clean(parsed.email.bodyText, 4000)),
    };
    if (!/(not relevant|will not follow up|won't follow up|do not follow up)/i.test(email.body_text)) {
      email.body_text = `${email.body_text.trim()}\n\nIf this is not relevant, tell me and I will not follow up.`.slice(0, 4000);
    }
    const lowerBody = email.body_text.toLowerCase();
    const wordCount = email.body_text.split(/\s+/).filter(Boolean).length;
    const bannedHits = banned.filter((phrase: string) => phrase && lowerBody.includes(phrase.toLowerCase()));
    const questionCount = (email.body_text.match(/\?/g) || []).length;
    let qualityScore = 100;
    if (wordCount < 70 || wordCount > 135) qualityScore -= 15;
    if (questionCount !== 1) qualityScore -= 12;
    if (bannedHits.length) qualityScore -= Math.min(30, bannedHits.length * 15);
    if (!research.personalisationFact && research.confidence === "low") qualityScore -= 10;
    if (email.subject.length > 55) qualityScore -= 8;
    if (!/(not relevant|will not follow up|won't follow up|do not follow up)/i.test(email.body_text)) qualityScore -= 15;
    qualityScore = Math.max(0, Math.min(formatRepaired ? 85 : 100, Math.min(qualityScore, Number(parsed.strategy.qualityScore) || 100)));
    const needsExtraReview = qualityScore < 70 || formatRepaired;
    const strategy = {
      reasoning: clean(parsed.strategy.reasoning, 700),
      evidenceUsed: Array.isArray(parsed.strategy.evidenceUsed) ? parsed.strategy.evidenceUsed.map((item: any) => clean(item, 240)).filter(Boolean).slice(0, 3) : [],
      angle: clean(parsed.strategy.angle || research.bestAngle, 180),
      tone: clean(parsed.strategy.tone || voice.tone, 180),
      cta: clean(parsed.strategy.cta, 180),
      persona: clean(parsed.strategy.persona || prospect.job_title, 180),
      qualityChecks: { wordCount, questionCount, bannedHits },
    };
    const messageTags = {
      angle: strategy.angle,
      tone: strategy.tone,
      cta: strategy.cta,
      persona: strategy.persona,
      step,
      variant,
      sequenceContentType: sequenceStep.contentType || "plain",
    };

    const { data: draft, error: draftError } = await supabaseAdmin.from("outreach_messages").upsert({
      enrolment_id: enrolment.id, campaign_id: campaign.id, prospect_id: prospect.id,
      step_number: step, variant, from_email: OUTREACH_FROM_EMAIL, subject: email.subject,
      preview_text: email.preview_text, body_text: email.body_text, status: "draft", updated_at: new Date().toISOString(),
      strategy, quality_score: qualityScore, message_tags: messageTags, booking_link_included: includeBooking,
    }, { onConflict: "enrolment_id,step_number" }).select("*").single();
    if (draftError) throw draftError;
    await Promise.all([
      supabaseAdmin.from("outreach_enrolments").update({ status: "drafted", research, research_sources: sources, researched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", enrolment.id),
      supabaseAdmin.from("outreach_prospects").update({ research, last_researched_at: new Date().toISOString(), status: "ready", updated_at: new Date().toISOString() }).eq("id", prospect.id),
      supabaseAdmin.from("outreach_events").insert([
        { campaign_id: campaign.id, prospect_id: prospect.id, kind: "researched", metadata: { sources: sources.length, confidence: research.confidence } },
        { campaign_id: campaign.id, prospect_id: prospect.id, message_id: draft.id, kind: "drafted", metadata: { step, variant, qualityScore, tags: messageTags } },
      ]),
    ]);
    console.log(JSON.stringify({ level: "info", msg: "outreach prepare completed", prospectId, qualityScore, needsExtraReview, formatRepaired, ms: Date.now() - startedAt }));
    return NextResponse.json({ research, sources, strategy, qualityScore, needsExtraReview, formatRepaired, checks: { wordCount, questionCount, bannedHits }, message: draft });
  } catch (error: any) {
    console.error(JSON.stringify({ level: "error", msg: "outreach prepare failed", prospectId: params.id, error: error?.message || "unknown error", ms: Date.now() - startedAt }));
    return NextResponse.json({ error: error?.name === "AbortError" ? "Research timed out, try this person again" : error?.message || "failed to prepare outreach" }, { status: 500 });
  }
}
