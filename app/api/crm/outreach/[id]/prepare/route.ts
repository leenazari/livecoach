import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { londonDate, modelSources, modelText, parseObject } from "@/lib/outreach";
import { OUTREACH_FROM_EMAIL } from "@/lib/gmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const clean = (value: any, max: number) => String(value || "").replace(/[—–]/g, ", ").replace(/;/g, ",").trim().slice(0, max);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const prospectId = params.id;
    const body = await req.json().catch(() => ({}));
    const [{ data: prospect }, { data: enrolments }, { data: brain }] = await Promise.all([
      supabaseAdmin.from("outreach_prospects").select("*").eq("id", prospectId).single(),
      supabaseAdmin.from("outreach_enrolments").select("*").eq("prospect_id", prospectId).eq("queued_for", londonDate()).in("status", ["queued", "researched", "drafted"]).limit(1),
      supabaseAdmin.from("workspace_profile").select("knowledge,learned").eq("id", "main").maybeSingle(),
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
    const productTruth = `${brain?.knowledge || ""}\n${brain?.learned || ""}`.slice(0, 5000);
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

Do not invent personal facts, clients, results, product capabilities or problems. A weak or absent signal must be stated as such. Do not use information from people with similar names. Do not mention that AI researched them. Use British English, no jargon, flattery, em dashes or semicolons.

VOICE TO FOLLOW: ${clean(voice.tone || "warm, commercially curious and concise", 300)}. ${clean(voice.style || "Founder-to-founder, plain English and respectful", 400)}
COACHING RULES: ${Array.isArray(voice.rules) ? voice.rules.join(" | ").slice(0, 1000) : "Lead with one verified relevance signal | make one useful commercial observation | ask one easy question | never pretend familiarity"}
BANNED PHRASES: ${banned.join(" | ") || "quick question | hope you are well | reaching out"}.

The email must be plain text, 60 to 105 words, short mobile-friendly paragraphs, one easy question as the CTA, and signed "${clean(voice.signature || "Lee", 80)}". End with a natural one-line opt-out such as "If this is not relevant, tell me and I will not follow up." It must sound individually written, not like a template. Subject under 45 characters. This prospect is variant ${variant}, ${variant === "A" ? "use a direct relevance or benefit-led subject" : "use a short natural question-led subject"}. Do not use any banned phrase or fake familiarity. This is sequence step ${step}. ${step > 1 ? "This is a follow-up, do not repeat the opening email and make it easy to close the loop." : "This is the first email."} ${includeBooking ? `Include this booking link once, naturally, as the optional next step: ${campaign.booking_url}` : "Do not include a calendar or booking link. Earn interest first."}

APPROVED SEQUENCE BRIEF FOR THIS STEP:
Purpose: ${clean(sequenceStep.purpose, 240)}
Content type: ${clean(sequenceStep.contentType || "plain", 60)}
Extra guidance: ${clean(sequenceStep.guidance, 500) || "none"}
${sequenceStep.assetUrl ? `Approved asset link: ${clean(sequenceStep.assetUrl, 600)}. Include it once only if it directly supports this step, never invent what the asset contains.` : "No asset link is approved for this step."}

Before writing, choose ONE evidence-backed reason this person should care now and ONE Interviewa angle. The first sentence must be grounded in a verified fact or transparently framed hypothesis. Never mix several random use cases. Explain your evidence and choice in strategy so Lee can approve the thinking as well as the words.

Output exactly:
{"research":{"summary":"max 70 words","signals":["max 3 factual current signals"],"likelyNeeds":["max 3 clearly labelled hypotheses"],"bestAngle":"one grounded Interviewa angle","personalisationFact":"one verifiable fact or empty string","confidence":"high|medium|low"},"strategy":{"reasoning":"why this one message is relevant, max 50 words","evidenceUsed":["max 3 facts actually used"],"angle":"short label","tone":"short label","cta":"short label","persona":"short label","qualityScore":0},"email":{"subject":"...","previewText":"...","bodyText":"..."}}`;
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

INTERVIEWA PRODUCT TRUTH, use only relevant supported claims:
${productTruth || campaign.offer_angle}

PROMOTED LEARNINGS, only use these when supported by enough evidence and relevant to this person:
${(learnings || []).length ? (learnings || []).map((learning: any) => `- ${learning.dimension}/${learning.label}: ${learning.insight} (${learning.confidence}, ${learning.sent_count} sent, ${learning.positive_reply_count} positive replies, ${learning.meeting_count} meetings)`).join("\n") : "No conversion learning yet. Do not invent best practices from nonexistent campaign results."}

${existingResearch ? `RESEARCH ALREADY SAVED, refresh only what may have changed and reuse solid facts:\n${JSON.stringify(existingResearch).slice(0, 3500)}` : ""}
${typeof body.guidance === "string" && body.guidance.trim() ? `LEE'S EXTRA GUIDANCE:\n${body.guidance.trim().slice(0, 1000)}` : ""}`;
    const message = await openai.messages.create({
      model: OPENAI_MODEL_PRO,
      max_tokens: 1300,
      system,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] as any,
      messages: [{ role: "user", content: user }],
    }, { timeout: 55_000 });
    await logModelUsage("outreach_prepare", "pro", message?.usage);
    const parsed = parseObject(modelText(message));
    if (!parsed?.research || !parsed?.strategy || !parsed?.email) return NextResponse.json({ error: "The draft could not be prepared, try again" }, { status: 502 });
    const research = {
      summary: clean(parsed.research.summary, 800),
      signals: Array.isArray(parsed.research.signals) ? parsed.research.signals.map((x: any) => clean(x, 240)).filter(Boolean).slice(0, 3) : [],
      likelyNeeds: Array.isArray(parsed.research.likelyNeeds) ? parsed.research.likelyNeeds.map((x: any) => clean(x, 240)).filter(Boolean).slice(0, 3) : [],
      bestAngle: clean(parsed.research.bestAngle, 400),
      personalisationFact: clean(parsed.research.personalisationFact, 400),
      confidence: ["high", "medium", "low"].includes(parsed.research.confidence) ? parsed.research.confidence : "low",
      generatedAt: new Date().toISOString(),
    };
    const sources = modelSources(message);
    const email = {
      subject: clean(parsed.email.subject, 120),
      preview_text: clean(parsed.email.previewText, 180),
      body_text: clean(parsed.email.bodyText, 4000),
    };
    if (!email.subject || !email.body_text) return NextResponse.json({ error: "The email draft was incomplete, try again" }, { status: 502 });
    const lowerBody = email.body_text.toLowerCase();
    const wordCount = email.body_text.split(/\s+/).filter(Boolean).length;
    const bannedHits = banned.filter((phrase: string) => phrase && lowerBody.includes(phrase.toLowerCase()));
    const questionCount = (email.body_text.match(/\?/g) || []).length;
    let qualityScore = 100;
    if (wordCount < 55 || wordCount > 115) qualityScore -= 15;
    if (questionCount !== 1) qualityScore -= 12;
    if (bannedHits.length) qualityScore -= Math.min(30, bannedHits.length * 15);
    if (!research.personalisationFact && research.confidence === "low") qualityScore -= 10;
    if (email.subject.length > 55) qualityScore -= 8;
    if (!/(not relevant|will not follow up|won't follow up|do not follow up)/i.test(email.body_text)) qualityScore -= 15;
    qualityScore = Math.max(0, Math.min(100, Math.min(qualityScore, Number(parsed.strategy.qualityScore) || 100)));
    if (qualityScore < 70) return NextResponse.json({ error: "The quality checks rejected this draft. Press Prepare again for a stronger version.", qualityScore, checks: { wordCount, questionCount, bannedHits } }, { status: 422 });
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
    return NextResponse.json({ research, sources, strategy, qualityScore, message: draft });
  } catch (error: any) {
    return NextResponse.json({ error: error?.name === "AbortError" ? "Research timed out, try this person again" : error?.message || "failed to prepare outreach" }, { status: 500 });
  }
}
