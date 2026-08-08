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

    const step = Number(enrolment.current_step) || 1;
    // Stable 50/50 assignment lets reply rates teach us which subject approach
    // works without tracking opens or adding invasive pixels.
    const variant = parseInt(String(prospect.id).replace(/-/g, "").slice(-2), 16) % 2 === 0 ? "A" : "B";
    const existingResearch = enrolment.research && typeof enrolment.research === "object" ? enrolment.research : null;
    const productTruth = `${brain?.knowledge || ""}\n${brain?.learned || ""}`.slice(0, 5000);
    const system = `You are Lee Nazari's careful B2B outreach researcher and copywriter for Interviewa. Use web_search to check this exact person and company today. Return ONLY compact JSON.

Do not invent personal facts, clients, results, product capabilities or problems. A weak or absent signal must be stated as such. Do not use information from people with similar names. Do not mention that AI researched them. Use British English, no jargon, flattery, em dashes or semicolons.

The email must be plain text, 60 to 105 words, short mobile-friendly paragraphs, one easy question as the CTA, and signed "Lee". End with a natural one-line opt-out such as "If this is not relevant, tell me and I will not follow up." It must sound individually written, not like a template. Subject under 45 characters. This prospect is variant ${variant}, ${variant === "A" ? "use a direct relevance or benefit-led subject" : "use a short natural question-led subject"}. Do not use "quick question", "hope you're well", "reaching out", or fake familiarity. This is sequence step ${step}. ${step > 1 ? "This is a follow-up, do not repeat the opening email and make it easy to close the loop." : "This is the first email."}

Output exactly:
{"research":{"summary":"max 70 words","signals":["max 3 factual current signals"],"likelyNeeds":["max 3 clearly labelled hypotheses"],"bestAngle":"one grounded Interviewa angle","personalisationFact":"one verifiable fact or empty string","confidence":"high|medium|low"},"email":{"subject":"...","previewText":"...","bodyText":"..."}}`;
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
    if (!parsed?.research || !parsed?.email) return NextResponse.json({ error: "The draft could not be prepared, try again" }, { status: 502 });
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

    const { data: draft, error: draftError } = await supabaseAdmin.from("outreach_messages").upsert({
      enrolment_id: enrolment.id, campaign_id: campaign.id, prospect_id: prospect.id,
      step_number: step, variant, from_email: OUTREACH_FROM_EMAIL, subject: email.subject,
      preview_text: email.preview_text, body_text: email.body_text, status: "draft", updated_at: new Date().toISOString(),
    }, { onConflict: "enrolment_id,step_number" }).select("*").single();
    if (draftError) throw draftError;
    await Promise.all([
      supabaseAdmin.from("outreach_enrolments").update({ status: "drafted", research, research_sources: sources, researched_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", enrolment.id),
      supabaseAdmin.from("outreach_prospects").update({ research, last_researched_at: new Date().toISOString(), status: "ready", updated_at: new Date().toISOString() }).eq("id", prospect.id),
      supabaseAdmin.from("outreach_events").insert([
        { campaign_id: campaign.id, prospect_id: prospect.id, kind: "researched", metadata: { sources: sources.length, confidence: research.confidence } },
        { campaign_id: campaign.id, prospect_id: prospect.id, message_id: draft.id, kind: "drafted", metadata: { step, variant } },
      ]),
    ]);
    return NextResponse.json({ research, sources, message: draft });
  } catch (error: any) {
    return NextResponse.json({ error: error?.name === "AbortError" ? "Research timed out, try this person again" : error?.message || "failed to prepare outreach" }, { status: 500 });
  }
}
