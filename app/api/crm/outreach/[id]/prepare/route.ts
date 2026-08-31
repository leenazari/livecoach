import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ensureWorkspaceProfileId } from "@/lib/workspace-profile";
import { getAppConfigValue } from "@/lib/app-config";
import { openai, OPENAI_MODEL_LIVE, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { londonDate, modelSources, modelText, parseObject } from "@/lib/outreach";
import { removeDashesFromProse } from "@/lib/outreach-voice";
import {
  ensureOutreachEmailDemoReplyCta,
  ensureOutreachVoiceDemoReplyCta,
  OUTREACH_EMAIL_DEMO_REPLY_CTA,
  OUTREACH_VOICE_DEMO_REPLY_CTA,
  outreachEmailEndsWithDemoReplyCta,
  outreachVoiceEndsWithDemoReplyCta,
} from "@/lib/outreach-demo-reply-cta";
import {
  estimatedVoiceSeconds,
  normaliseOutreachVoiceScript,
} from "@/lib/outreach-voice-note";
import {
  OUTREACH_VOICE_HARD_MAX_CHARACTERS,
  OUTREACH_VOICE_HARD_MAX_WORDS,
  OUTREACH_VOICE_PREFERRED_MAX_WORDS,
  OUTREACH_VOICE_PREFERRED_MIN_WORDS,
  OUTREACH_VOICE_TARGET_WORDS,
  prepareOutreachVoiceScriptForReview,
} from "@/lib/outreach-voice-policy";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import {
  conciseJobSignal,
  isCandidatePreparationCampaign,
  officialCompanyOverviewUrl,
  officialJobBoardUrl,
  officialJobSearchDomains,
  officialResearchSources,
  rankCandidatePreparationJobSignals,
  sanitiseJobResearchSignals,
} from "@/lib/job-research-sources";
import {
  getOptionalSalesProfile,
  salesProfileContextBlock,
} from "@/lib/sales-profile";
import { shouldIncludePersonalOutreachBookingLink } from "@/lib/outreach-booking-link";

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
    required: ["research", "strategy", "email", "voiceNote"],
    properties: {
      research: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "companyOverview", "signals", "activeJobs", "jobSignals", "volumeAssessment", "volumeReason", "likelyNeeds", "bestAngle", "commercialPath", "fitDecision", "personalisationFact", "approvedProof", "freshness", "confidence"],
        properties: {
          summary: { type: "string" },
          companyOverview: { type: "string" },
          signals: { type: "array", items: { type: "string" } },
          activeJobs: { type: "array", items: { type: "string" } },
          jobSignals: {
            type: "array",
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "location", "compensation", "recency", "sourceUrl"],
              properties: {
                role: { type: "string" },
                location: { type: "string" },
                compensation: { type: "string" },
                recency: { type: "string" },
                sourceUrl: { type: "string" },
              },
            },
          },
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
      voiceNote: {
        type: "object",
        additionalProperties: false,
        required: ["script", "whyNow", "urgencyType", "urgencyEvidence"],
        properties: {
          script: { type: "string" },
          whyNow: { type: "string" },
          urgencyType: {
            type: "string",
            enum: ["verified_trigger", "natural_next_moment"],
          },
          urgencyEvidence: { type: "string" },
        },
      },
    },
  },
} as const;

type CompleteOutreachDraft = {
  research: Record<string, any>;
  strategy: Record<string, any>;
  email: { subject: string; previewText?: string; bodyText: string };
  voiceNote: {
    script: string;
    whyNow: string;
    urgencyType: "verified_trigger" | "natural_next_moment";
    urgencyEvidence: string;
  };
};

const completeDraft = (value: any): value is CompleteOutreachDraft => !!(
  value?.research &&
  value?.strategy &&
  value?.email &&
  String(value.email.subject || "").trim() &&
  String(value.email.bodyText || "").trim() &&
  value?.voiceNote &&
  String(value.voiceNote.script || "").trim()
);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const startedAt = Date.now();
  try {
    const sender = await resolveOutreachIdentity();
    const profileId = await ensureWorkspaceProfileId();
    const prospectId = params.id;
    const body = await req.json().catch(() => ({}));
    const generationMode =
      body?.generationMode === "overnight" ? "overnight" : "manual";
    console.log(JSON.stringify({ level: "info", msg: "outreach prepare started", route: "/api/crm/outreach/[id]/prepare", prospectId, generationMode, requestId: req.headers.get("x-vercel-id") }));
    const [
      { data: prospect },
      { data: enrolments },
      { data: brain },
      { data: revenueConfig },
      { data: offerConfig },
      personalProfile,
    ] = await Promise.all([
      supabaseAdmin.from("outreach_prospects").select("*").eq("workspace_id", sender.workspaceId).eq("id", prospectId).single(),
      supabaseAdmin.from("outreach_enrolments").select("*").eq("workspace_id", sender.workspaceId).eq("owner_id", sender.userId).eq("prospect_id", prospectId).eq("queued_for", londonDate()).in("status", ["queued", "researched", "drafted"]).limit(1),
      supabaseAdmin.from("workspace_profile").select("knowledge,learned").eq("id", profileId).maybeSingle(),
      getAppConfigValue("revenue_target_gbp").then((data) => ({ data })),
      getAppConfigValue("interviewa_outreach_offer_truth").then((data) => ({ data })),
      getOptionalSalesProfile({
        userId: sender.userId,
        workspaceId: sender.workspaceId,
      }),
    ]);
    const enrolment = enrolments?.[0];
    if (!prospect || !enrolment) return NextResponse.json({ error: "This person is not in today's queue" }, { status: 400 });
    if (prospect.assigned_to_user_id !== sender.userId)
      return NextResponse.json({ error: "Assign this prospect to yourself before preparing outreach" }, { status: 403 });
    const { data: campaign } = await supabaseAdmin.from("outreach_campaigns").select("*").eq("workspace_id", sender.workspaceId).eq("id", enrolment.campaign_id).single();
    if (!campaign || campaign.status !== "active") return NextResponse.json({ error: "The campaign is not active" }, { status: 400 });
    const { data: learnings } = await supabaseAdmin.from("outreach_learnings").select("dimension,label,insight,confidence,sent_count,positive_reply_count,meeting_count").eq("workspace_id", sender.workspaceId).eq("owner_id", sender.userId).eq("campaign_id", campaign.id).eq("status", "promoted").order("meeting_count", { ascending: false }).limit(8);

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
    const salesProfile = salesProfileContextBlock(personalProfile);
    const emailSignoff = clean(
      personalProfile.emailSignoff ||
        voice.signature ||
        sender.senderName.split(" ")[0],
      160
    );
    const banned = Array.isArray(campaign.banned_phrases) ? campaign.banned_phrases.map((item: any) => String(item).trim()).filter(Boolean).slice(0, 20) : [];
    const sequence = Array.isArray(campaign.sequence) ? campaign.sequence : [];
    const sequenceStep = sequence.find((row: any) => Number(row?.step) === step) || {
      step,
      channel: "email",
      actionType: "email",
      purpose: step === 1 ? "Relevant opening and one easy question" : "Useful follow-up that adds a new reason to respond",
      contentType: "plain",
      guidance: "",
      assetUrl: null,
    };
    if ((sequenceStep.channel || "email") !== "email") {
      return NextResponse.json(
        {
          error:
            "Complete this manual sequence step from Today before preparing the next email",
          manualStep: {
            step,
            channel: sequenceStep.channel,
            actionType: sequenceStep.actionType,
            purpose: sequenceStep.purpose,
          },
        },
        { status: 409 }
      );
    }
    const lastStep = Math.max(1, ...sequence.map((row: any) => Number(row?.step) || 0));
    const personalBookingUrl = String(personalProfile.bookingUrl || "").trim();
    const includeBooking = shouldIncludePersonalOutreachBookingLink({
      bookingUrl: personalBookingUrl,
      mode: campaign.booking_cta_mode,
      step,
      lastStep,
    });
    const jobSearchDomains = officialJobSearchDomains(prospect);
    const campaignContract = {
      name: clean(campaign.name, 180),
      audience: clean(campaign.audience, 700),
      goal: clean(campaign.goal, 700),
      offerAngle: clean(campaign.offer_angle, 1_200),
    };
    const candidatePreparationCampaign = isCandidatePreparationCampaign(campaignContract);
    const candidatePreparationVacancyPriority = candidatePreparationCampaign
      ? `CANDIDATE PREPARATION VACANCY PRIORITY: do not simply take the first vacancies returned by the jobs page. Compare the verified live roles and select the four with the highest preparation value. Rank technical and interview intensive roles first, especially software engineering, data, cyber security, cloud, infrastructure, product and technical leadership. Then consider seniority, complexity, the consequence of a weak interview and any explicitly published annual compensation. Higher compensation is supporting evidence of a high stakes interview, not a reason on its own. Prefer a technically complex role over a generic role even when the generic role has a slightly higher salary. Keep the exact published compensation in jobSignals.compensation or use an empty string when it is not stated. For a recruitment company, say the company is advertising or recruiting for the role on behalf of a client. Never claim the named prospect personally posted it or that the recruitment company itself is hiring.`
      : "";
    const system = `You are ${sender.senderName}'s careful B2B outreach researcher and copywriter for Interviewa. Use web search to check this exact company today. Return ONLY compact JSON.${salesProfile}

COMMERCIAL NORTH STAR: help Interviewa build toward £${revenueTarget.toLocaleString("en-GB")} revenue over the next 12 months, in support of a roughly £10m valuation. Use this to prioritise credible routes to revenue and strong strategic relationships. Never invent a prospect's budget, deal value, urgency or buying authority to make them look valuable.

CAMPAIGN CONTRACT, this is the only permitted message purpose:
Name: ${campaignContract.name}
Audience: ${campaignContract.audience}
Goal: ${campaignContract.goal}
Offer angle: ${campaignContract.offerAngle}
The email and voice note must be written specifically for this campaign contract and the current sequence step. Do not replace it with a generic Interviewa pitch or carry an angle from another campaign. Campaign wording cannot override the factual safeguards below. Mention a free trial, demo, guarantee, vacancy, candidate training, screening, partnership, event or asset only when it is supported by this campaign contract and INTERVIEWA PRODUCT TRUTH.

CAMPAIGN VALUE TRANSLATION: turn the selected campaign offer into one concrete before and after, not a feature list. When and only when the campaign contract and product truth support recruiter led candidate preparation, explain the practical flow clearly: the candidate completes a focused mock interview in about five minutes, the candidate and recruiter can both review the results before the client interview, the candidate builds confidence, and the recruiter can prepare them without another preparation call or extra administration. Keep that complete causal chain in the voice note. The email can use the smallest relevant subset naturally. Do not carry this candidate preparation message into screening, employer hiring, partnership or other campaigns.

Do not invent personal facts, clients, results, savings, case studies, product capabilities or problems. Never present an illustrative scenario as a real customer result. Use a verified case study only when it appears in INTERVIEWA PRODUCT TRUTH. Otherwise approvedProof must be empty. A weak or absent signal must be stated as such. Do not use information from people with similar names. Do not mention that AI researched them. Use British English, no jargon, flattery, em dashes or semicolons.

RESEARCH DISCIPLINE: bring back only information that changes the decision or message for the campaign contract. Use the company's own website and other approved primary company or applicant tracking system pages only. Never search, open, scrape or cite LinkedIn. Do not use job aggregators, social networks or copied vacancy listings. When the official company site has an About, About us, Who we are, Our story, Company or What we do page, use it to understand what the business sells, whom it serves, its specialism and its operating model. Put only the commercially useful facts in companyOverview. Do not copy generic marketing prose, biographies or values. Research current vacancies only when hiring evidence directly supports this campaign goal or offer angle. When it does, find up to four current or very recent vacancies and retain only roles with an exact primary source URL. Otherwise activeJobs and jobSignals must be empty and volumeAssessment must be unknown. Never invent a job count or use a generic industry applicant average as if it belongs to this company. Ignore generic biography, old news and facts that do not affect the campaign intent. Tie every retained fact to one of three outcomes: close a customer deal, build a commercially useful relationship, or start a credible partnership. Reuse saved research when still current and refresh only facts likely to have changed. The saved research must be concise enough to reuse in future Brain, intent and call prep prompts without reopening the web.

${candidatePreparationVacancyPriority}

VOICE TO FOLLOW: ${clean(voice.tone || "warm, commercially curious and concise", 300)}. ${clean(voice.style || "Founder to founder, plain English and respectful", 400)}
PERSONAL DELIVERY: write in a ${personalProfile.emailTone.replace(/_/g, " ")} style while keeping every campaign rule and factual safeguard below.
COACHING RULES: ${Array.isArray(voice.rules) ? voice.rules.join(" | ").slice(0, 1000) : "Lead with one verified relevance signal | make one useful commercial observation | ask one easy question | never pretend familiarity"}
EMAIL BANNED PHRASES: ${banned.join(" | ") || "quick question | hope you are well | reaching out"}. These apply to the email body. The required welcoming voice note opening below is allowed.

The email must be plain text, 90 to 135 words, use short mobile friendly paragraphs, ask one easy question, and be signed exactly "${emailSignoff}". Its final three parts must appear in this order: a natural one line opt out such as "If this is not relevant, tell me and I will not follow up.", then this exact mandatory CTA as its own paragraph, "${OUTREACH_EMAIL_DEMO_REPLY_CTA}", then the signature. This reply to book CTA is required on every campaign email step and must not be replaced with a generic invitation. It must sound individually written by ${sender.senderName}, not like a template or a faceless product message. Never use a hyphen, dash or em dash in prose, even when grammar normally calls for one. Subject under 45 characters. Select one supported benefit and one approved next step from the campaign contract. Do not list unrelated Interviewa capabilities. Use a verified current vacancy only when it is relevant to this campaign. Use approved proof only when it appears in product truth and directly supports the selected angle. Be commercially vivid without hype. This prospect is variant ${variant}, ${variant === "A" ? "use a direct relevance or benefit led subject" : "use a short natural question led subject"}. Do not use any banned phrase or fake familiarity. This is sequence step ${step}. ${step > 1 ? `This is a follow up. Do not repeat ${sender.senderName}'s full introduction or the opening email, and make it easy to close the loop.` : `This is the first email. After the personalised opening, introduce the sender naturally with: I’m ${sender.senderName} from Interviewa. Then explain Interviewa only through the selected campaign angle.`} ${includeBooking ? `Include this salesperson's personal booking link once, naturally, as the optional next step: ${personalBookingUrl}` : "Do not include a calendar or booking link. Earn interest first."}

VOICE NOTE: also write a separate spoken pitch. Aim for about ${OUTREACH_VOICE_TARGET_WORDS} words and normally stay between ${OUTREACH_VOICE_PREFERRED_MIN_WORDS} and ${OUTREACH_VOICE_PREFERRED_MAX_WORDS} words so it lands at roughly 45 seconds. This is a naturalness target, not permission to cut a sentence. Always finish the final sentence cleanly. Personalisation matters more than hitting an exact word count. The delivery must feel welcoming, upbeat and positive, with genuine conversational enthusiasm and varied sentence rhythm. Write as if the speaker is smiling and pleased to speak to this person. The opening must be steady and conversational, never rushed or overexcited. Avoid flat corporate phrasing, forced excitement, hype and repeated exclamation marks. Start exactly with "Hi ${prospect.first_name || "there"}, I hope you are doing well today." Do not use an exclamation mark in that opening. Then use "We are Interviewa" when the brand needs introducing. This is a shared or synthetic voice, so it must never impersonate the salesperson. Never say "I am ${sender.senderName}", "I'm ${sender.senderName}", "This is ${sender.senderName}", "My name is ${sender.senderName}" or claim the voice is the sender. Keep the correct Interviewa spelling in the visible script. The audio layer handles its pronunciation as "Interviewer". Use the recipient's first name, their exact company, and the single strongest current verified fact from the research, such as a relevant live vacancy or recent hiring signal. If no current fact is verified, use a clearly framed role and company specific hypothesis rather than inventing one. It must use the same campaign contract, sequence purpose, approved offer and verified prospect evidence as the email. Explain one campaign approved outcome, state one supported next step, and finish with this exact mandatory final sentence, "${OUTREACH_VOICE_DEMO_REPLY_CTA}". Do not use an offer, use case or CTA from another campaign. Do not read out a URL, email address, opt out line or subject. Do not copy the email word for word. Use British English, contractions where natural, short spoken sentences, and no hyphens, dashes or semicolons.

TRUTHFUL MOMENTUM RULE: the voice note must create gentle urgency without sounding pushy. Include one short, complete why now sentence in the script and return that exact sentence as voiceNote.whyNow. Use urgencyType verified_trigger only when a current primary source or saved current interaction proves a real time sensitive trigger, such as a live vacancy, active hiring round, dated event, current candidate cohort or agreed follow up. Put that supporting fact in urgencyEvidence. Otherwise use urgencyType natural_next_moment and connect the invitation to the prospect's next natural operating moment, such as their next live role, interview round or candidate group, without claiming it is scheduled. The preferred pattern is "With those roles open now, this is a good point to test it on one live vacancy" or "The easiest way to judge it is on your next live role". Keep the action small and low risk. Never invent urgency, deadlines, scarcity, availability, business pressure, familiarity, a customer result or a case study. Never use "act now", "today only", "last chance", "limited availability", "slots are filling" or "do not miss out".

APPROVED SEQUENCE BRIEF FOR THIS STEP:
Purpose: ${clean(sequenceStep.purpose, 240)}
Content type: ${clean(sequenceStep.contentType || "plain", 60)}
Extra guidance: ${clean(sequenceStep.guidance, 500) || "none"}
${sequenceStep.assetUrl ? `Approved asset link: ${clean(sequenceStep.assetUrl, 600)}. Include it once only if it directly supports this step, never invent what the asset contains.` : "No asset link is approved for this step."}

Before writing, choose ONE evidence-backed reason this person should care now and ONE angle permitted by the campaign contract. The first sentence must be grounded in a verified fact or transparently framed hypothesis. Never mix several random use cases. The voice note must include the exact why now sentence returned in voiceNote.whyNow. Explain the urgency basis and choice in strategy so ${sender.senderName} can approve the thinking as well as the words.

Output exactly:
{"research":{"summary":"max 65 words, only decision useful facts","companyOverview":"max 55 words on what the business does, whom it serves, its specialism and operating model, using only the official company overview or homepage","signals":["max 3 factual current signals"],"activeJobs":["max 4 verified current or recent roles ordered by campaign relevance"],"jobSignals":[{"role":"verified role","location":"verified location or empty","compensation":"exact published annual compensation or empty","recency":"verified date or current status","sourceUrl":"exact primary company or ATS vacancy URL"}],"volumeAssessment":"high|medium|low|unknown","volumeReason":"evidence based reason, max 35 words","likelyNeeds":["max 2 clearly labelled hypotheses"],"bestAngle":"one grounded angle permitted by the campaign contract","commercialPath":"customer deal|relationship|partnership plus one short reason","fitDecision":"contact now|hold|skip plus one short reason","personalisationFact":"one verifiable fact or empty string","approvedProof":"verified Interviewa case study or result from product truth, otherwise empty string","freshness":"what was checked and how current it is, max 25 words","confidence":"high|medium|low"},"strategy":{"reasoning":"why this one message is relevant, max 55 words","evidenceUsed":["max 3 facts actually used"],"angle":"short label","tone":"short label","cta":"short label","persona":"short label","qualityScore":0},"email":{"subject":"...","previewText":"...","bodyText":"..."},"voiceNote":{"script":"about 100 words, normally 80 to 120, fully personalised, gently urgent and ending with a complete sentence","whyNow":"one exact complete sentence copied from the script","urgencyType":"verified_trigger|natural_next_moment","urgencyEvidence":"verified current fact or honest next natural moment, max 30 words"}}`;
    const user = `PERSON
Name: ${prospect.first_name || ""} ${prospect.last_name || ""}
Role: ${prospect.job_title || ""}
Email: ${prospect.email}

COMPANY
Name: ${prospect.company_name}
Website: ${prospect.website || prospect.company_domain || ""}
Industry: ${prospect.industry || ""}
Employees: ${prospect.employee_range || ""}

CAMPAIGN
Audience: ${campaign.audience}
Goal: ${campaign.goal}
Angle: ${campaign.offer_angle}

INTERVIEWA PRODUCT AND OFFER TRUTH, use only the most relevant supported claims and do not list every feature:
${productTruth || campaign.offer_angle}

PROMOTED LEARNINGS, only use these when supported by enough evidence and relevant to this person:
${(learnings || []).length ? (learnings || []).map((learning: any) => `- ${learning.dimension}/${learning.label}: ${learning.insight} (${learning.confidence}, ${learning.sent_count} sent, ${learning.positive_reply_count} positive replies, ${learning.meeting_count} meetings)`).join("\n") : "No conversion learning yet. Do not invent best practices from nonexistent campaign results."}

${existingResearch ? `RESEARCH ALREADY SAVED, refresh only what may have changed and reuse solid facts:\n${JSON.stringify(existingResearch).slice(0, 3500)}` : ""}
${typeof body.guidance === "string" && body.guidance.trim() ? `SENDER'S EXTRA GUIDANCE:\n${body.guidance.trim().slice(0, 1000)}` : ""}`;
    const message = await openai.messages.create({
      model: OPENAI_MODEL_PRO,
      max_tokens: 2000,
      response_format: OUTREACH_DRAFT_FORMAT,
      system,
      tools: [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
        filters: { allowed_domains: jobSearchDomains },
        search_context_size: "medium",
      }] as any,
      messages: [{ role: "user", content: user }],
    }, { timeout: 38_000 });
    const originalText = modelText(message);
    const sources = officialResearchSources(modelSources(message), prospect);
    await logModelUsage("outreach_prepare", "pro", message?.usage, {
      prospectId,
      inputTokens: Number(message?.usage?.input_tokens) || 0,
      outputTokens: Number(message?.usage?.output_tokens) || 0,
      cachedInputTokens: Number(message?.usage?.cache_read_input_tokens) || 0,
      sourceCount: sources.length,
      stopReason: message?.stop_reason || "unknown",
      outputChars: originalText.length,
      generationMode,
    }, { userId: sender.userId, workspaceId: sender.workspaceId });
    let parsed = parseObject(originalText);
    let formatRepaired = false;
    if (!completeDraft(parsed)) {
      console.warn(JSON.stringify({ level: "warning", msg: "outreach prepare needs format repair", prospectId, stopReason: message?.stop_reason || "unknown", outputChars: originalText.length, ms: Date.now() - startedAt }));
      const repair = await openai.messages.create({
        model: OPENAI_MODEL_LIVE,
        max_tokens: 2200,
        response_format: OUTREACH_DRAFT_FORMAT,
        system: `Repair an incomplete structured outreach result and return ONLY the required JSON. Preserve every supplied research fact. Never invent facts about the person, company, vacancies, customers, savings or results. If a research field is missing, use an empty array, empty string, unknown volume, or low confidence as appropriate. companyOverview must be empty unless the incomplete result contains facts from the official company website. jobSignals must be an empty array unless the incomplete result contains an exact primary company or applicant tracking system vacancy URL. For every retained job signal, copy an explicitly published annual compensation or set compensation to an empty string. Never use LinkedIn or a job aggregator. You may complete the email and voiceNote using only the supplied facts and approved Interviewa truth. Use British English, short mobile friendly email paragraphs, one email question, no semicolons, and no hyphens or dashes in prose. The first email must naturally introduce: I’m ${sender.senderName} from Interviewa. Include a natural opt out in the email, followed by the exact final pre-signature CTA "${OUTREACH_EMAIL_DEMO_REPLY_CTA}". voiceNote.script must be a distinct natural spoken pitch aiming for ${OUTREACH_VOICE_TARGET_WORDS} words and normally between ${OUTREACH_VOICE_PREFERRED_MIN_WORDS} and ${OUTREACH_VOICE_PREFERRED_MAX_WORDS} words. It must never cut a sentence to meet the target. It must sound welcoming, upbeat and positive, with natural enthusiasm and varied spoken rhythm rather than flat corporate phrasing. The opening must be steady and conversational, never rushed or overexcited. It must start exactly "Hi ${prospect.first_name || "there"}, I hope you are doing well today.", name their exact company, use "We are Interviewa" when introducing the brand, use the strongest current verified relevance signal, and end with the exact sentence "${OUTREACH_VOICE_DEMO_REPLY_CTA}". The synthetic voice must never say it is ${sender.senderName}, introduce itself using the sender's name, or claim to be the sender. Keep Interviewa spelled correctly in the visible script because the audio layer supplies the pronunciation. It must not read out a URL or the opt out line.`,
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
        generationMode,
      }, { userId: sender.userId, workspaceId: sender.workspaceId });
      parsed = parseObject(modelText(repair));
      formatRepaired = completeDraft(parsed);
    }
    if (!completeDraft(parsed)) {
      console.error(JSON.stringify({ level: "error", msg: "outreach prepare format repair failed", prospectId, ms: Date.now() - startedAt }));
      return NextResponse.json({ error: "The research response could not be formatted after an automatic repair. Nothing was saved or sent." }, { status: 502 });
    }
    const verifiedJobSignals = sanitiseJobResearchSignals(parsed.research.jobSignals, prospect);
    const jobSignals = candidatePreparationCampaign
      ? rankCandidatePreparationJobSignals(verifiedJobSignals)
      : verifiedJobSignals;
    const companyOverviewUrl = officialCompanyOverviewUrl(
      [
        ...sources,
        ...(existingResearch?.companyOverviewUrl
          ? [{
              url: existingResearch.companyOverviewUrl,
              title: "Previously verified company overview",
            }]
          : []),
      ],
      prospect
    );
    const jobBoardUrl = officialJobBoardUrl(sources, prospect);
    const research = {
      summary: clean(parsed.research.summary, 800),
      companyOverview: companyOverviewUrl
        ? clean(
            parsed.research.companyOverview || existingResearch?.companyOverview,
            500
          )
        : "",
      companyOverviewUrl,
      signals: Array.isArray(parsed.research.signals) ? parsed.research.signals.map((x: any) => clean(x, 240)).filter(Boolean).slice(0, 3) : [],
      activeJobs: jobSignals.map(conciseJobSignal),
      jobBoardUrl,
      jobSignals,
      volumeAssessment: jobSignals.length && ["high", "medium", "low"].includes(parsed.research.volumeAssessment) ? parsed.research.volumeAssessment : "unknown",
      volumeReason: jobSignals.length ? clean(parsed.research.volumeReason, 300) : "No current vacancies were verified on the company or its public applicant tracking system.",
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
      body_text: ensureOutreachEmailDemoReplyCta({
        body: removeDashesFromProse(clean(parsed.email.bodyText, 4000)),
        signoff: emailSignoff,
        maximumCharacters: 4000,
      }),
    };
    const voiceScript = normaliseOutreachVoiceScript(
      ensureOutreachVoiceDemoReplyCta(
        prepareOutreachVoiceScriptForReview({
          script: parsed.voiceNote.script,
          recipientFirstName: prospect.first_name,
          senderName: sender.senderName,
        })
      )
    );
    const voiceWhyNow = normaliseOutreachVoiceScript(parsed.voiceNote.whyNow);
    const voiceUrgencyType = parsed.voiceNote.urgencyType === "verified_trigger"
      ? "verified_trigger"
      : "natural_next_moment";
    const voiceUrgencyEvidence = clean(parsed.voiceNote.urgencyEvidence, 300);
    const voiceWordCount = voiceScript.split(/\s+/).filter(Boolean).length;
    const voiceCharacterCount = voiceScript.length;
    const voiceIncludesWhyNow = Boolean(
      voiceWhyNow &&
      voiceScript.toLocaleLowerCase("en-GB").includes(
        voiceWhyNow.toLocaleLowerCase("en-GB")
      )
    );
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
    const voiceOutsidePreferredRange =
      voiceWordCount < OUTREACH_VOICE_PREFERRED_MIN_WORDS ||
      voiceWordCount > OUTREACH_VOICE_PREFERRED_MAX_WORDS;
    const voiceBeyondSafetyLimit =
      voiceWordCount > OUTREACH_VOICE_HARD_MAX_WORDS ||
      voiceCharacterCount > OUTREACH_VOICE_HARD_MAX_CHARACTERS;
    if (voiceOutsidePreferredRange) qualityScore -= 8;
    if (voiceBeyondSafetyLimit) qualityScore -= 20;
    if (!voiceIncludesWhyNow) qualityScore -= 15;
    if (!/(not relevant|will not follow up|won't follow up|do not follow up)/i.test(email.body_text)) qualityScore -= 15;
    const emailHasDemoReplyCta = outreachEmailEndsWithDemoReplyCta(email.body_text);
    const voiceHasDemoReplyCta = outreachVoiceEndsWithDemoReplyCta(voiceScript);
    if (!emailHasDemoReplyCta) qualityScore -= 20;
    if (!voiceHasDemoReplyCta) qualityScore -= 20;
    qualityScore = Math.max(0, Math.min(formatRepaired ? 85 : 100, Math.min(qualityScore, Number(parsed.strategy.qualityScore) || 100)));
    const needsExtraReview =
      qualityScore < 70 ||
      formatRepaired ||
      voiceOutsidePreferredRange ||
      voiceBeyondSafetyLimit ||
      !voiceIncludesWhyNow ||
      !emailHasDemoReplyCta ||
      !voiceHasDemoReplyCta;
    const strategy = {
      reasoning: clean(parsed.strategy.reasoning, 700),
      evidenceUsed: Array.isArray(parsed.strategy.evidenceUsed) ? parsed.strategy.evidenceUsed.map((item: any) => clean(item, 240)).filter(Boolean).slice(0, 3) : [],
      angle: clean(parsed.strategy.angle || research.bestAngle, 180),
      tone: clean(parsed.strategy.tone || voice.tone, 180),
      cta: "Book a quick demo by replying to this email",
      persona: clean(parsed.strategy.persona || prospect.job_title, 180),
      voiceUrgency: {
        type: voiceUrgencyType,
        whyNow: voiceWhyNow,
        evidence: voiceUrgencyEvidence,
        includedInScript: voiceIncludesWhyNow,
      },
      qualityChecks: {
        wordCount,
        questionCount,
        bannedHits,
        voiceWordCount,
        voiceCharacterCount,
        voiceIncludesWhyNow,
        emailHasDemoReplyCta,
        voiceHasDemoReplyCta,
      },
    };
    const messageTags = {
      angle: strategy.angle,
      tone: strategy.tone,
      cta: strategy.cta,
      persona: strategy.persona,
      step,
      variant,
      sequenceContentType: sequenceStep.contentType || "plain",
      voiceUrgencyType,
      generationMode,
    };

    const { data: previousDraft } = await supabaseAdmin
      .from("outreach_messages")
      .select("voice_script,voice_status")
      .eq("workspace_id", sender.workspaceId)
      .eq("sender_user_id", sender.userId)
      .eq("enrolment_id", enrolment.id)
      .eq("step_number", step)
      .maybeSingle();
    const preserveReadyAudio =
      previousDraft?.voice_status === "ready" &&
      previousDraft?.voice_script === voiceScript;
    const voicePayload = preserveReadyAudio
      ? { voice_script: voiceScript }
      : {
          voice_script: voiceScript,
          voice_status: "script_ready",
          voice_audio_path: null,
          voice_audio_mime: null,
          voice_generated_at: null,
          voice_script_hash: null,
          voice_model_id: null,
          voice_provider_voice_id: null,
          voice_provider_request_id: null,
          voice_estimated_seconds: estimatedVoiceSeconds(voiceScript),
          voice_character_count: null,
          voice_estimated_cost_gbp: null,
          voice_error: null,
          voice_script_approved_at: null,
          voice_script_approved_by: null,
          voice_script_approved_hash: null,
        };

    const { data: draft, error: draftError } = await supabaseAdmin.from("outreach_messages").upsert({
      workspace_id: sender.workspaceId, owner_id: sender.userId, visibility: "team",
      enrolment_id: enrolment.id, campaign_id: campaign.id, prospect_id: prospect.id,
      step_number: step, variant, from_email: sender.senderEmail, sender_user_id: sender.userId, subject: email.subject,
      preview_text: email.preview_text, body_text: email.body_text, status: "draft", updated_at: new Date().toISOString(),
      strategy, quality_score: qualityScore, message_tags: messageTags, booking_link_included: includeBooking,
      ...voicePayload,
    }, { onConflict: "enrolment_id,step_number" }).select("*").single();
    if (draftError) throw draftError;
    await Promise.all([
      supabaseAdmin.from("outreach_enrolments").update({ status: "drafted", research, research_sources: sources, researched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("workspace_id", sender.workspaceId).eq("owner_id", sender.userId).eq("id", enrolment.id),
      supabaseAdmin.from("outreach_prospects").update({ research, last_researched_at: new Date().toISOString(), status: "ready", updated_at: new Date().toISOString() }).eq("workspace_id", sender.workspaceId).eq("assigned_to_user_id", sender.userId).eq("id", prospect.id),
      supabaseAdmin.from("outreach_events").insert([
        { workspace_id: sender.workspaceId, owner_id: sender.userId, visibility: "team", campaign_id: campaign.id, prospect_id: prospect.id, kind: "researched", metadata: { sources: sources.length, confidence: research.confidence, verifiedJobs: jobSignals.length, jobBoardSaved: Boolean(jobBoardUrl), companyOverviewSaved: Boolean(research.companyOverview && companyOverviewUrl), generationMode } },
        { workspace_id: sender.workspaceId, owner_id: sender.userId, visibility: "team", campaign_id: campaign.id, prospect_id: prospect.id, message_id: draft.id, kind: "drafted", metadata: { step, variant, qualityScore, tags: messageTags, generationMode } },
      ]),
    ]);
    console.log(JSON.stringify({ level: "info", msg: "outreach prepare completed", prospectId, generationMode, qualityScore, needsExtraReview, formatRepaired, ms: Date.now() - startedAt }));
    return NextResponse.json({ research, sources, strategy, qualityScore, needsExtraReview, formatRepaired, generationMode, checks: { wordCount, questionCount, bannedHits, voiceWordCount, voiceCharacterCount, emailHasDemoReplyCta, voiceHasDemoReplyCta }, message: draft });
  } catch (error: any) {
    console.error(JSON.stringify({ level: "error", msg: "outreach prepare failed", prospectId: params.id, error: error?.message || "unknown error", ms: Date.now() - startedAt }));
    return NextResponse.json({ error: error?.name === "AbortError" ? "Research timed out, try this person again" : error?.message || "failed to prepare outreach" }, { status: 500 });
  }
}
