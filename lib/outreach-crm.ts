import { supabaseAdmin } from "@/lib/supabase";
import { emailFromHeader } from "@/lib/gmail";

const asText = (value: any, max = 1000) => String(value || "").trim().slice(0, max);

export async function findOutreachProspectForAttendees(attendees: any[]): Promise<any | null> {
  const emails = (Array.isArray(attendees) ? attendees : [])
    .filter((attendee: any) => !attendee?.self)
    .map((attendee: any) => emailFromHeader(attendee?.email || ""))
    .filter(Boolean);
  if (!emails.length) return null;
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select("*")
    .in("email", emails)
    .limit(1);
  return data?.[0] || null;
}

export async function ensureOutreachCompany(prospectId: string, reason: "interested" | "booked") {
  const { data: prospect } = await supabaseAdmin.from("outreach_prospects").select("*").eq("id", prospectId).single();
  if (!prospect) return null;

  let companyId = prospect.crm_company_id as string | null;
  let created = false;
  let company: any = null;
  if (companyId) {
    const { data } = await supabaseAdmin.from("companies").select("*").eq("id", companyId).maybeSingle();
    company = data || null;
    if (!company) companyId = null;
  }
  if (!companyId && prospect.company_domain) {
    const { data } = await supabaseAdmin.from("companies").select("*").ilike("domain", prospect.company_domain).limit(1);
    company = data?.[0] || null;
    companyId = company?.id || null;
  }
  if (!companyId && prospect.company_name) {
    const { data } = await supabaseAdmin.from("companies").select("*").ilike("name", prospect.company_name).limit(1);
    company = data?.[0] || null;
    companyId = company?.id || null;
  }
  if (!companyId) {
    const { data, error } = await supabaseAdmin.from("companies").insert({
      name: prospect.company_name,
      domain: prospect.company_domain || null,
      website: prospect.website || (prospect.company_domain ? `https://${prospect.company_domain}` : null),
      sector: prospect.industry || null,
      stage: reason === "booked" ? "Qualified" : "Discovery",
      profile: { auto_created_from: "outreach", outreach_prospect_id: prospect.id },
    }).select("*").single();
    if (error) throw error;
    company = data;
    companyId = data.id;
    created = true;
  }

  const fullName = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ").trim() || prospect.email;
  const { data: contacts } = await supabaseAdmin.from("contacts").select("id,attributes").eq("company_id", companyId).ilike("email", prospect.email).limit(1);
  let contactId = contacts?.[0]?.id || null;
  if (!contacts?.length) {
    const { data: createdContact } = await supabaseAdmin.from("contacts").insert({
      company_id: companyId,
      name: fullName,
      role: prospect.job_title || null,
      email: prospect.email,
      sector: prospect.industry || null,
      attributes: { source: "outreach", personLinkedIn: prospect.person_linkedin_url || null },
    }).select("id").single();
    contactId = createdContact?.id || null;
  }

  const [{ data: sent }, { data: enrolment }] = await Promise.all([
    supabaseAdmin.from("outreach_messages").select("subject,body_text,sent_at,step_number").eq("prospect_id", prospect.id).eq("status", "sent").order("sent_at", { ascending: true }).limit(5),
    supabaseAdmin.from("outreach_enrolments").select("id,campaign_id,research,research_sources,status").eq("prospect_id", prospect.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const research = enrolment?.research || prospect.research || {};
  if (contactId) {
    await supabaseAdmin.from("contacts").update({
      attributes: {
        ...((contacts?.[0]?.attributes && typeof contacts[0].attributes === "object") ? contacts[0].attributes : {}),
        source: "outreach",
        personLinkedIn: prospect.person_linkedin_url || null,
        research: {
          subject: fullName,
          background: [prospect.job_title ? `${fullName} is recorded as ${prospect.job_title} at ${prospect.company_name}.` : "", research?.personalisationFact, ...(Array.isArray(research?.signals) ? research.signals : [])].filter(Boolean).join("\n"),
          sources: enrolment?.research_sources || [],
          generatedAt: research?.generatedAt || new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    }).eq("id", contactId);
  }
  const outreachContext = [
    "OUTREACH ORIGIN, use this when preparing the first call:",
    research?.summary ? `Research: ${asText(research.summary, 800)}` : "",
    research?.bestAngle ? `Why Interviewa may be relevant: ${asText(research.bestAngle, 500)}` : "",
    ...(sent || []).map((message: any) => `Email ${message.step_number}: ${asText(message.subject, 160)}\n${asText(message.body_text, 1200)}`),
    prospect.last_reply_text ? `Their reply: ${asText(prospect.last_reply_text, 1000)}` : prospect.reply_summary ? `Their reply: ${asText(prospect.reply_summary, 400)}` : "",
  ].filter(Boolean).join("\n\n");
  const existingProfile = company?.profile && typeof company.profile === "object" ? company.profile : {};
  await Promise.all([
    supabaseAdmin.from("companies").update({
      stage: reason === "booked" ? "Qualified" : (company?.stage || "Discovery"),
      email_context: outreachContext,
      email_context_updated_at: new Date().toISOString(),
      profile: {
        ...existingProfile,
        research: existingProfile.research || {
          subject: prospect.company_name,
          background: [research?.summary, research?.bestAngle ? `Interviewa relevance: ${research.bestAngle}` : ""].filter(Boolean).join("\n\n"),
          sources: enrolment?.research_sources || [],
          generatedAt: research?.generatedAt || new Date().toISOString(),
        },
        outreach: { prospectId: prospect.id, research, replyCategory: prospect.reply_category, source: "Interviewa outreach", updatedAt: new Date().toISOString() },
      },
      updated_at: new Date().toISOString(),
    }).eq("id", companyId),
    supabaseAdmin.from("outreach_prospects").update({ crm_company_id: companyId, updated_at: new Date().toISOString() }).eq("id", prospect.id),
  ]);

  const { data: openOpps } = await supabaseAdmin.from("opportunities").select("id,probability,pipeline_stage").eq("company_id", companyId).eq("status", "open").limit(1);
  let opportunityId = openOpps?.[0]?.id || null;
  if (!opportunityId) {
    const { data: opportunity, error } = await supabaseAdmin.from("opportunities").insert({
      company_id: companyId,
      title: `Interviewa opportunity, ${prospect.company_name}`,
      detail: `Created from a ${reason === "booked" ? "booked meeting" : "positive reply"} to personalised Interviewa outreach.`,
      status: "open",
      surfaced_by_ai: false,
      source: "outreach",
      pipeline_stage: reason === "booked" ? "qualified" : "discovery",
      probability: reason === "booked" ? 40 : 25,
      forecast_category: "pipeline",
    }).select("id").single();
    if (error) throw error;
    opportunityId = opportunity?.id || null;
  } else if (reason === "booked" && (Number(openOpps?.[0]?.probability) || 0) < 40) {
    await supabaseAdmin.from("opportunities").update({ pipeline_stage: "qualified", probability: 40, updated_at: new Date().toISOString() }).eq("id", opportunityId);
  }

  if (created) {
    await supabaseAdmin.from("outreach_events").insert({
      campaign_id: enrolment?.campaign_id || null,
      prospect_id: prospect.id,
      kind: "crm_created",
      metadata: { companyId, opportunityId, reason },
    });
  }
  return { companyId, opportunityId, prospect, enrolment, research, outreachContext };
}

export function firstOutreachCallIntent(context: any): string {
  const prospect = context?.prospect || {};
  const research = context?.research || {};
  const person = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ").trim() || "them";
  const response = prospect.reply_summary ? ` Their reply indicates: ${asText(prospect.reply_summary, 220)}` : "";
  const angle = research.bestAngle || research.summary || "the Interviewa use case raised in the outreach";
  return `I want to understand ${person}'s priorities at ${prospect.company_name} and test the real need behind ${asText(angle, 320)}.${response} I need to qualify the use case, urgency, decision process and success criteria, then agree the strongest next step for an Interviewa demonstration or pilot.`;
}

export async function attachOutreachMeeting(prospectId: string, upcomingId: string, scheduledAt: string) {
  const context = await ensureOutreachCompany(prospectId, "booked");
  if (!context) return null;
  const intent = firstOutreachCallIntent(context);
  const { data: call } = await supabaseAdmin.from("upcoming_calls").select("prep,research").eq("id", upcomingId).maybeSingle();
  const prep = call?.prep && typeof call.prep === "object" ? call.prep : {};
  const research = call?.research && typeof call.research === "object" ? call.research : {};
  await Promise.all([
    supabaseAdmin.from("upcoming_calls").update({
      company_id: context.companyId,
      intent,
      research: { ...research, outreach: { prospectId, research: context.research, emailContext: context.outreachContext, source: "Interviewa outreach" } },
      prep: { ...prep, intentMeta: { source: "outreach", rationale: "Built from the personalised email, reply and saved prospect research.", savedAt: new Date().toISOString() } },
    }).eq("id", upcomingId),
    supabaseAdmin.from("outreach_enrolments").update({ status: "booked", booked_at: scheduledAt, next_action_at: null, updated_at: new Date().toISOString() }).eq("prospect_id", prospectId),
    supabaseAdmin.from("outreach_prospects").update({ status: "qualified", crm_company_id: context.companyId, updated_at: new Date().toISOString() }).eq("id", prospectId),
  ]);
  const { data: already } = await supabaseAdmin.from("outreach_events").select("id").eq("prospect_id", prospectId).eq("kind", "meeting_booked").contains("metadata", { upcomingId }).limit(1);
  if (!already?.length) {
    await supabaseAdmin.from("outreach_events").insert({
      campaign_id: context.enrolment?.campaign_id || null,
      prospect_id: prospectId,
      kind: "meeting_booked",
      metadata: { upcomingId, companyId: context.companyId, scheduledAt },
    });
  }
  return { ...context, intent };
}
