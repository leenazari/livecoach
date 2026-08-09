import { supabaseAdmin } from "@/lib/supabase";
import { emailFromHeader } from "@/lib/gmail";
import {
  companyAliases,
  normaliseCompanyDomain,
  normaliseCompanyName,
} from "@/lib/company-identity";

const asText = (value: any, max = 1000) => String(value || "").trim().slice(0, max);

type HandoverReason = "interested" | "booked";
type HandoverCandidate = { id: string; name: string; domain: string | null };
type HandoverOptions = {
  approvedCompanyId?: string;
  approveCreate?: boolean;
};

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "proton.me",
  "protonmail.com",
]);

const uniqueCompanies = (companies: any[]): HandoverCandidate[] => [
  ...new Map(
    companies
      .filter((company) => company?.id)
      .map((company) => [
        company.id,
        {
          id: company.id,
          name: asText(company.name, 180),
          domain: normaliseCompanyDomain(company.domain || company.website) || null,
        },
      ])
  ).values(),
];

async function resolveOutreachCompany(
  prospect: any,
  options: HandoverOptions = {}
): Promise<{
  company: any | null;
  candidates: HandoverCandidate[];
  canCreateSafely: boolean;
  needsReview: boolean;
  reason: string;
}> {
  if (options.approvedCompanyId) {
    const { data } = await supabaseAdmin
      .from("companies")
      .select("*")
      .eq("id", options.approvedCompanyId)
      .maybeSingle();
    if (!data) throw new Error("The selected CRM company no longer exists");
    return {
      company: data,
      candidates: uniqueCompanies([data]),
      canCreateSafely: false,
      needsReview: false,
      reason: "Approved CRM company",
    };
  }

  if (prospect.crm_company_id) {
    const { data } = await supabaseAdmin
      .from("companies")
      .select("*")
      .eq("id", prospect.crm_company_id)
      .maybeSingle();
    if (data) {
      return {
        company: data,
        candidates: uniqueCompanies([data]),
        canCreateSafely: false,
        needsReview: false,
        reason: "Already linked",
      };
    }
  }

  const email = emailFromHeader(prospect.email || "");
  const inputDomain = normaliseCompanyDomain(
    prospect.company_domain || prospect.website
  );
  const inputName = normaliseCompanyName(prospect.company_name);
  const [{ data: contacts, error: contactError }, { data: companies, error: companyError }] =
    await Promise.all([
      email
        ? supabaseAdmin
            .from("contacts")
            .select("company_id")
            .ilike("email", email)
            .not("company_id", "is", null)
            .limit(20)
        : Promise.resolve({ data: [] as any[], error: null }),
      supabaseAdmin.from("companies").select("*").limit(1500),
    ]);
  if (contactError) throw contactError;
  if (companyError) throw companyError;

  const contactCompanyIds = new Set(
    (contacts || []).map((contact: any) => contact.company_id).filter(Boolean)
  );
  const contactMatches = (companies || []).filter((company: any) =>
    contactCompanyIds.has(company.id)
  );
  const domainMatches = inputDomain
    ? (companies || []).filter(
        (company: any) =>
          normaliseCompanyDomain(company.domain || company.website) === inputDomain
      )
    : [];
  const nameMatches = inputName
    ? (companies || []).filter(
        (company: any) =>
          normaliseCompanyName(company.name) === inputName ||
          companyAliases(company.profile).some(
            (alias) => normaliseCompanyName(alias) === inputName
          )
      )
    : [];
  const candidates = uniqueCompanies([
    ...contactMatches,
    ...domainMatches,
    ...nameMatches,
  ]);

  // Exact email and domain matches are strong enough to automate. A name-only
  // match is shown for approval because similarly named companies do exist.
  const strongIds = new Set(
    [...contactMatches, ...domainMatches].map((company: any) => company.id)
  );
  if (candidates.length === 1 && strongIds.size === 1) {
    const company = (companies || []).find(
      (candidate: any) => candidate.id === candidates[0].id
    );
    return {
      company: company || null,
      candidates,
      canCreateSafely: false,
      needsReview: false,
      reason: "Exact email or domain match",
    };
  }

  const canCreateSafely = Boolean(
    inputName &&
      inputDomain &&
      !PERSONAL_EMAIL_DOMAINS.has(inputDomain) &&
      !candidates.length
  );
  if (options.approveCreate) {
    if (!inputName) throw new Error("Add a company name before creating its CRM profile");
    return {
      company: null,
      candidates,
      canCreateSafely,
      needsReview: false,
      reason: "New company approved",
    };
  }
  return {
    company: null,
    candidates,
    canCreateSafely,
    needsReview: !canCreateSafely,
    reason: candidates.length
      ? "More than one CRM identity could match"
      : inputDomain && PERSONAL_EMAIL_DOMAINS.has(inputDomain)
        ? "A personal email domain cannot safely identify a company"
      : inputDomain
        ? "No existing CRM identity matched"
        : "A company domain is needed for automatic matching",
  };
}

function compactResearch(research: any) {
  const source = research && typeof research === "object" ? research : {};
  return {
    summary: asText(source.summary, 600),
    signals: Array.isArray(source.signals)
      ? source.signals.map((item: any) => asText(item, 220)).filter(Boolean).slice(0, 3)
      : [],
    activeJobs: Array.isArray(source.activeJobs)
      ? source.activeJobs.map((item: any) => asText(item, 220)).filter(Boolean).slice(0, 4)
      : [],
    volumeAssessment: asText(source.volumeAssessment, 20) || "unknown",
    volumeReason: asText(source.volumeReason, 260),
    likelyNeeds: Array.isArray(source.likelyNeeds)
      ? source.likelyNeeds.map((item: any) => asText(item, 220)).filter(Boolean).slice(0, 2)
      : [],
    bestAngle: asText(source.bestAngle, 400),
    personalisationFact: asText(source.personalisationFact, 300),
    approvedProof: asText(source.approvedProof, 300),
    commercialPath: asText(source.commercialPath, 220),
    fitDecision: asText(source.fitDecision, 220),
    confidence: asText(source.confidence, 20),
    generatedAt: source.generatedAt || null,
  };
}

export function outreachEmailsForAttendees(attendees: any[]): string[] {
  return (Array.isArray(attendees) ? attendees : [])
    .filter((attendee: any) => !attendee?.self)
    .map((attendee: any) => emailFromHeader(attendee?.email || ""))
    .filter(Boolean);
}

export async function loadOutreachProspectsForAttendees(attendeeSets: any[][]): Promise<Map<string, any>> {
  const emails = Array.from(
    new Set(attendeeSets.flatMap(outreachEmailsForAttendees))
  );
  const byEmail = new Map<string, any>();
  if (!emails.length) return byEmail;
  const { data } = await supabaseAdmin
    .from("outreach_prospects")
    .select("*")
    .in("email", emails);
  for (const prospect of data || []) {
    if (prospect.email) byEmail.set(String(prospect.email).toLowerCase(), prospect);
  }
  return byEmail;
}

export function matchOutreachProspectForAttendees(
  attendees: any[],
  prospectsByEmail: Map<string, any>
): any | null {
  for (const email of outreachEmailsForAttendees(attendees)) {
    const prospect = prospectsByEmail.get(email.toLowerCase());
    if (prospect) return prospect;
  }
  return null;
}

export async function findOutreachProspectForAttendees(attendees: any[]): Promise<any | null> {
  const emails = outreachEmailsForAttendees(attendees);
  if (!emails.length) return null;
  const matches = await loadOutreachProspectsForAttendees([attendees]);
  return matchOutreachProspectForAttendees(attendees, matches);
}

export async function getOutreachHandoverPreview(prospectId: string) {
  const { data: prospect } = await supabaseAdmin
    .from("outreach_prospects")
    .select("*")
    .eq("id", prospectId)
    .single();
  if (!prospect) return null;
  const resolution = await resolveOutreachCompany(prospect);
  return {
    prospectId,
    companyId: resolution.company?.id || null,
    companyName: resolution.company?.name || null,
    candidates: resolution.candidates,
    canCreateSafely: resolution.canCreateSafely,
    needsReview: resolution.needsReview,
    reason: resolution.reason,
  };
}

export async function ensureOutreachCompany(
  prospectId: string,
  reason: HandoverReason,
  options: HandoverOptions = {}
) {
  const { data: prospect } = await supabaseAdmin
    .from("outreach_prospects")
    .select("*")
    .eq("id", prospectId)
    .single();
  if (!prospect) return null;

  const [{ data: sent }, { data: enrolment }] = await Promise.all([
    supabaseAdmin
      .from("outreach_messages")
      .select("subject,body_text,sent_at,step_number")
      .eq("prospect_id", prospect.id)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(3),
    supabaseAdmin
      .from("outreach_enrolments")
      .select("id,campaign_id,research,research_sources,status,booked_at")
      .eq("prospect_id", prospect.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const research = compactResearch(enrolment?.research || prospect.research || {});
  const resolution = await resolveOutreachCompany(prospect, options);
  let company = resolution.company;
  let companyId = company?.id || null;
  let created = false;

  if (!companyId && resolution.needsReview) {
    const { data: existingReview } = await supabaseAdmin
      .from("outreach_events")
      .select("id")
      .eq("prospect_id", prospect.id)
      .eq("kind", "handover_review")
      .limit(1);
    if (!existingReview?.length) {
      await supabaseAdmin.from("outreach_events").insert({
        campaign_id: enrolment?.campaign_id || null,
        prospect_id: prospect.id,
        kind: "handover_review",
        metadata: {
          reason: resolution.reason,
          candidates: resolution.candidates,
          trigger: reason,
        },
      });
    }
    return {
      companyId: null,
      contactId: null,
      prospect,
      enrolment,
      research,
      outreachContext: "",
      requiresReview: true,
      candidates: resolution.candidates,
      reviewReason: resolution.reason,
    };
  }

  if (!companyId) {
    const { data, error } = await supabaseAdmin
      .from("companies")
      .insert({
        name: prospect.company_name,
        domain: prospect.company_domain || null,
        website:
          prospect.website ||
          (prospect.company_domain ? `https://${prospect.company_domain}` : null),
        sector: prospect.industry || null,
        // A booked first conversation is discovery, not proof of qualification.
        stage: "Discovery",
        profile: {
          auto_created_from: "outreach",
          outreach_prospect_id: prospect.id,
        },
      })
      .select("*")
      .single();
    if (error) throw error;
    company = data;
    companyId = data.id;
    created = true;
  }

  const fullName =
    [prospect.first_name, prospect.last_name].filter(Boolean).join(" ").trim() ||
    prospect.email;
  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("id,attributes")
    .eq("company_id", companyId)
    .ilike("email", prospect.email)
    .limit(1);
  let contactId = contacts?.[0]?.id || null;
  if (!contacts?.length) {
    const { data: createdContact } = await supabaseAdmin
      .from("contacts")
      .insert({
        company_id: companyId,
        name: fullName,
        role: prospect.job_title || null,
        email: prospect.email,
        sector: prospect.industry || null,
        attributes: {
          source: "outreach",
          personLinkedIn: prospect.person_linkedin_url || null,
        },
      })
      .select("id")
      .single();
    contactId = createdContact?.id || null;
  }

  // Use the newest real source timestamp, not the time calendar sync happened
  // to run. Re-writing `updatedAt` on every daily sync invalidated the compact
  // commercial-memory cache even when the underlying outreach was unchanged.
  const contextUpdatedAt =
    prospect.last_reply_at ||
    prospect.last_contacted_at ||
    research?.generatedAt ||
    prospect.created_at ||
    new Date().toISOString();
  if (contactId) {
    const existingAttributes =
      contacts?.[0]?.attributes && typeof contacts[0].attributes === "object"
        ? contacts[0].attributes
        : {};
    const nextAttributes = {
        ...existingAttributes,
        source: "outreach",
        personLinkedIn: prospect.person_linkedin_url || null,
        research: {
          subject: fullName,
          background: [prospect.job_title ? `${fullName} is recorded as ${prospect.job_title} at ${prospect.company_name}.` : "", research?.personalisationFact, ...(Array.isArray(research?.signals) ? research.signals : [])].filter(Boolean).join("\n"),
          sources: enrolment?.research_sources || [],
          generatedAt: research?.generatedAt || contextUpdatedAt,
        },
      };
    if (JSON.stringify(existingAttributes) !== JSON.stringify(nextAttributes)) {
      await supabaseAdmin.from("contacts").update({
        attributes: nextAttributes,
        updated_at: new Date().toISOString(),
      }).eq("id", contactId);
    }
  }
  const outreachContext = [
    "OUTREACH ORIGIN, use this when preparing the first call:",
    research?.summary ? `Research: ${asText(research.summary, 800)}` : "",
    research?.bestAngle ? `Why Interviewa may be relevant: ${asText(research.bestAngle, 500)}` : "",
    ...(sent || [])
      .reverse()
      .map(
        (message: any) =>
          `Email ${message.step_number}: ${asText(message.subject, 140)}\n${asText(message.body_text, 500)}`
      ),
    prospect.last_reply_text
      ? `Their reply: ${asText(prospect.last_reply_text, 700)}`
      : prospect.reply_summary
        ? `Their reply: ${asText(prospect.reply_summary, 300)}`
        : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 3200);
  const markerStart = `[OUTREACH:${prospect.id}]`;
  const markerEnd = `[/OUTREACH:${prospect.id}]`;
  const markerPattern = new RegExp(
    `\\[OUTREACH:${prospect.id}\\][\\s\\S]*?\\[\\/OUTREACH:${prospect.id}\\]\\s*`,
    "g"
  );
  const preservedEmailContext = String(company?.email_context || "")
    .replace(markerPattern, "")
    .trim();
  const nextEmailContext = [
    preservedEmailContext,
    `${markerStart}\n${outreachContext}\n${markerEnd}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(-8000);
  const existingProfile = company?.profile && typeof company.profile === "object" ? company.profile : {};
  const currentStage = asText(company?.stage, 80);
  const nextStage =
    !currentStage || ["lead", "prospect", "new"].includes(currentStage.toLowerCase())
      ? "Discovery"
      : currentStage;
  const existingOutreach =
    (existingProfile as any).outreach &&
    typeof (existingProfile as any).outreach === "object"
      ? (existingProfile as any).outreach
      : {};
  const previousRelationships = Array.isArray(existingOutreach.relationships)
    ? existingOutreach.relationships
    : existingOutreach.prospectId
      ? [
          {
            prospectId: existingOutreach.prospectId,
            replyCategory: existingOutreach.replyCategory || null,
            updatedAt: existingOutreach.updatedAt || null,
          },
        ]
      : [];
  const relationship = {
    prospectId: prospect.id,
    contactId,
    name: fullName,
    role: prospect.job_title || null,
    replyCategory: prospect.reply_category || null,
    researchSummary: research.summary || null,
    bestAngle: research.bestAngle || null,
    updatedAt: contextUpdatedAt,
  };
  const relationships = [
    relationship,
    ...previousRelationships.filter(
      (item: any) => item?.prospectId !== prospect.id
    ),
  ].slice(0, 8);
  const nextProfile = {
    ...existingProfile,
    research: existingProfile.research || {
      subject: prospect.company_name,
      background: [research?.summary, research?.bestAngle ? `Interviewa relevance: ${research.bestAngle}` : ""].filter(Boolean).join("\n\n"),
      sources: enrolment?.research_sources || [],
      generatedAt: research?.generatedAt || contextUpdatedAt,
    },
    outreach: {
      ...existingOutreach,
      prospectId: prospect.id,
      research,
      replyCategory: prospect.reply_category,
      source: "Interviewa outreach",
      updatedAt: contextUpdatedAt,
      dealValueDeferred: true,
      relationships,
    },
  };
  const companyChanged =
    company?.stage !== nextStage ||
    company?.email_context !== nextEmailContext ||
    JSON.stringify(existingProfile) !== JSON.stringify(nextProfile);
  const writes: PromiseLike<any>[] = [];
  if (companyChanged) {
    writes.push(
      supabaseAdmin.from("companies").update({
        stage: nextStage,
        email_context: nextEmailContext,
        email_context_updated_at: contextUpdatedAt,
        profile: nextProfile,
        updated_at: new Date().toISOString(),
      }).eq("id", companyId)
    );
  }
  if (prospect.crm_company_id !== companyId) {
    writes.push(
      supabaseAdmin.from("outreach_prospects").update({
        crm_company_id: companyId,
        updated_at: new Date().toISOString(),
      }).eq("id", prospect.id)
    );
  }
  await Promise.all(writes);

  if (created) {
    await supabaseAdmin.from("outreach_events").insert({
      campaign_id: enrolment?.campaign_id || null,
      prospect_id: prospect.id,
      kind: "crm_created",
      metadata: { companyId, reason, dealValueDeferred: true },
    });
  }
  return {
    companyId,
    contactId,
    prospect,
    enrolment,
    research,
    outreachContext,
    requiresReview: false,
    candidates: resolution.candidates,
  };
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
  const { data: call } = await supabaseAdmin.from("upcoming_calls").select("company_id,intent,prep,research").eq("id", upcomingId).maybeSingle();
  const prep = call?.prep && typeof call.prep === "object" ? call.prep : {};
  const research = call?.research && typeof call.research === "object" ? call.research : {};
  const manualIntent = prep?.intentMeta?.source === "manual";
  const outreachResearch = {
    prospectId,
    companyName: context.prospect?.company_name || null,
    person: [context.prospect?.first_name, context.prospect?.last_name]
      .filter(Boolean)
      .join(" ") || null,
    research: context.research,
    emailContext: context.outreachContext,
    source: "Interviewa outreach",
  };
  const nextResearch = { ...research, outreach: outreachResearch };
  const callPatch: Record<string, any> = {};
  if (context.companyId && call?.company_id !== context.companyId)
    callPatch.company_id = context.companyId;
  if (JSON.stringify(research?.outreach || null) !== JSON.stringify(outreachResearch)) {
    callPatch.research = nextResearch;
  }
  // A calendar repair may discover the outreach relationship after the user
  // has already edited the call. Link all the commercial context, but their
  // explicit intent always wins.
  if (!manualIntent) {
    if (call?.intent !== intent) callPatch.intent = intent;
    if (prep?.intentMeta?.source !== "outreach") {
      callPatch.prep = {
        ...prep,
        intentMeta: {
          source: "outreach",
          rationale: "Built from the personalised email, reply and saved prospect research.",
          savedAt: new Date().toISOString(),
        },
      };
    }
  }
  const statusWrites: PromiseLike<any>[] = [];
  if (context.enrolment && (
    context.enrolment.status !== "booked" ||
    context.enrolment.booked_at !== scheduledAt
  )) {
    statusWrites.push(
      supabaseAdmin.from("outreach_enrolments").update({
        status: "booked",
        booked_at: scheduledAt,
        next_action_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", context.enrolment.id)
    );
  }
  if (context.prospect.status !== "qualified" || (context.companyId && context.prospect.crm_company_id !== context.companyId)) {
    statusWrites.push(
      supabaseAdmin.from("outreach_prospects").update({
        status: "qualified",
        ...(context.companyId ? { crm_company_id: context.companyId } : {}),
        updated_at: new Date().toISOString(),
      }).eq("id", prospectId)
    );
  }
  await Promise.all([
    ...(Object.keys(callPatch).length
      ? [supabaseAdmin.from("upcoming_calls").update(callPatch).eq("id", upcomingId)]
      : []),
    // A calendar booking is also a stop signal. This covers cases where the
    // invite lands before Gmail reply polling sees the prospect's response.
    supabaseAdmin
      .from("outreach_messages")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("prospect_id", prospectId)
      .in("status", ["draft", "approved"]),
    ...statusWrites,
  ]);
  const { data: already } = await supabaseAdmin.from("outreach_events").select("id").eq("prospect_id", prospectId).eq("kind", "meeting_booked").contains("metadata", { upcomingId }).limit(1);
  if (!already?.length) {
    await supabaseAdmin.from("outreach_events").insert({
      campaign_id: context.enrolment?.campaign_id || null,
      prospect_id: prospectId,
      kind: "meeting_booked",
      metadata: {
        upcomingId,
        companyId: context.companyId,
        scheduledAt,
        handoverNeedsReview: context.requiresReview,
      },
    });
  }
  return { ...context, intent: manualIntent ? call?.intent : intent, manualIntentPreserved: manualIntent };
}
