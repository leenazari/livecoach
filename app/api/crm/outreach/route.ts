import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { outreachCrmGuard } from "@/lib/outreach";
import { clampOutreachDailyLimit } from "@/lib/outreach-limits";
import { scoreOutreachProspect } from "@/lib/outreach-scoring";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { isActiveOutreachEnrolmentStatus } from "@/lib/outreach-team-safety";
import { resolveOutreachCampaignSelection } from "@/lib/outreach-campaign-selection";
import { loadSendPilotOutreachContext } from "@/lib/sendpilot-outreach";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import { privateRecordFields } from "@/lib/record-scope";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROSPECT_LIST_FIELDS = [
  "id",
  "assigned_to_user_id",
  "email",
  "first_name",
  "last_name",
  "job_title",
  "company_name",
  "company_domain",
  "website",
  "employee_range",
  "industry",
  "state",
  "country",
  "person_linkedin_url",
  "company_linkedin_url",
  "public_profile",
  "priority",
  "priority_score",
  "status",
  "research",
  "last_researched_at",
  "last_contacted_at",
  "last_reply_at",
  "reply_category",
  "reply_summary",
  "next_action_at",
  "source_metadata",
  "crm_company_id",
  "updated_at",
].join(",");

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECENT_CLIENT_DAYS = 30;
const RECENT_CLIENT_LIMIT = 20;

function cleanManualField(value: unknown, max: number): string {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function exactIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function manualProspectBlocker(
  status: number,
  input: Parameters<typeof crmBlockerPayload>[0]
) {
  return NextResponse.json(crmBlockerPayload(input), { status });
}

async function loadRecentClientProspectCandidates(account: {
  userId: string;
  workspaceId: string;
}) {
  const since = new Date(
    Date.now() - RECENT_CLIENT_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data: companies, error: companyError } = await supabaseAdmin
    .from("companies")
    .select("id,name,profile,created_at,updated_at")
    .eq("workspace_id", account.workspaceId)
    .eq("owner_id", account.userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(RECENT_CLIENT_LIMIT * 2);
  if (companyError) throw companyError;

  const activeCompanies = (companies || []).filter((company: any) => {
    const profile = company.profile && typeof company.profile === "object"
      ? company.profile
      : {};
    return profile.archived !== true && profile.deleted !== true;
  });
  const companyIds = activeCompanies.map((company: any) => company.id);
  if (!companyIds.length) return [];

  const [contactsResult, linkedProspectsResult] = await Promise.all([
    supabaseAdmin
      .from("contacts")
      .select("id,company_id,name,email,role,created_at")
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .in("company_id", companyIds)
      .order("created_at", { ascending: true }),
    // This service query is deliberately bounded to the verified workspace and
    // candidate IDs. It prevents a private duplicate owned by a teammate from
    // making the same client appear available for a second outreach record.
    supabaseService
      .from("outreach_prospects")
      .select("crm_company_id")
      .eq("workspace_id", account.workspaceId)
      .in("crm_company_id", companyIds),
  ]);
  if (contactsResult.error) throw contactsResult.error;
  if (linkedProspectsResult.error) throw linkedProspectsResult.error;

  const linkedCompanyIds = new Set(
    (linkedProspectsResult.data || [])
      .map((prospect: any) => String(prospect.crm_company_id || ""))
      .filter(Boolean)
  );
  const contactsByCompany = new Map<string, any[]>();
  for (const contact of contactsResult.data || []) {
    const rows = contactsByCompany.get(contact.company_id) || [];
    rows.push({
      id: contact.id,
      name: cleanManualField(contact.name, 240),
      email: cleanManualField(contact.email, 320).toLowerCase() || null,
      role: cleanManualField(contact.role, 200) || null,
    });
    contactsByCompany.set(contact.company_id, rows);
  }

  return activeCompanies
    .filter((company: any) => !linkedCompanyIds.has(company.id))
    .slice(0, RECENT_CLIENT_LIMIT)
    .map((company: any) => ({
      companyId: company.id,
      companyName: cleanManualField(company.name, 200),
      createdAt: company.created_at,
      contacts: contactsByCompany.get(company.id) || [],
    }));
}

function hasSavedResearch(value: unknown) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

export async function GET(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const canManageAssignments = account.role === "owner" || account.role === "manager";
    const priority = req.nextUrl.searchParams.get("priority") || "all";
    const status = req.nextUrl.searchParams.get("status") || "all";
    let query = supabaseAdmin
      .from("outreach_prospects")
      .select(PROSPECT_LIST_FIELDS)
      .eq("workspace_id", account.workspaceId)
      .order("priority_score", { ascending: false })
      .order("company_name", { ascending: true })
      .limit(1000);
    if (!canManageAssignments) {
      query = query.or(
        `assigned_to_user_id.is.null,assigned_to_user_id.eq.${account.userId}`
      );
    }
    if (["high", "medium", "low"].includes(priority)) query = query.eq("priority", priority);
    if (status !== "all") query = query.eq("status", status);
    const contextPromise = Promise.all([
      resolveOutreachCampaignSelection(account.userId, account.workspaceId),
      supabaseAdmin.from("outreach_learnings").select("*").eq("workspace_id", account.workspaceId).eq("status", "promoted").limit(100),
      supabaseAdmin.from("outreach_suppressions").select("target").eq("workspace_id", account.workspaceId),
      outreachCrmGuard(),
    ]);
    let messagesQuery = supabaseAdmin
        .from("outreach_messages")
        .select("id,prospect_id,status,subject,step_number,scheduled_at,sent_at,updated_at,message_source")
        .eq("workspace_id", account.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(5000);
    let enrolmentsQuery = supabaseAdmin
        .from("outreach_enrolments")
        .select("campaign_id,prospect_id,recipient_email,status,current_step,last_sent_at,next_action_at,updated_at")
        .eq("workspace_id", account.workspaceId)
        .order("updated_at", { ascending: false })
        .limit(2000);
    if (!canManageAssignments) {
      messagesQuery = messagesQuery.eq("sender_user_id", account.userId);
      enrolmentsQuery = enrolmentsQuery.eq("owner_id", account.userId);
    }
    const historyPromise = Promise.all([messagesQuery, enrolmentsQuery]);
    const [{ data, error }, context, history, crmCandidates] = await Promise.all([
      query,
      contextPromise,
      historyPromise,
      loadRecentClientProspectCandidates(account),
    ]);
    if (error) throw error;
    const [selection, { data: learnings }, { data: suppressions }, crmGuard] = context;
    const [{ data: messages }, { data: ownEnrolments }] = history;
    const campaigns = selection.campaigns;
    const campaign = selection.campaign;
    const sendpilotContext = await loadSendPilotOutreachContext(
      { userId: account.userId, workspaceId: account.workspaceId },
      {
        prospectIds: (data || [])
          .filter((prospect: any) => prospect.assigned_to_user_id === account.userId)
          .map((prospect: any) => prospect.id),
        campaignIds: campaigns.map((row: any) => row.id),
      }
    );
    const sendpilotByProspect = new Map<string, any>();
    for (const link of sendpilotContext.links) {
      if (!sendpilotByProspect.has(link.outreach_prospect_id)) {
        sendpilotByProspect.set(link.outreach_prospect_id, link);
      }
    }
    let enrolments = ownEnrolments || [];
    if (!canManageAssignments && data?.length) {
      // Once a prospect is assigned, its campaign history follows the
      // prospect even if the original import membership was created by the
      // workspace owner. An unassigned person exposes only a pristine paused
      // campaign label, never another sender's active history or reply detail.
      const assignedIds = (data || [])
        .filter((row: any) => row.assigned_to_user_id === account.userId)
        .map((row: any) => row.id);
      const unassignedIds = (data || [])
        .filter((row: any) => !row.assigned_to_user_id)
        .map((row: any) => row.id);
      const enrolmentFields =
        "campaign_id,prospect_id,recipient_email,status,current_step,last_sent_at,next_action_at,updated_at";
      const [assignedMembershipResult, sharedMembershipResult] =
        await Promise.all([
          assignedIds.length
            ? supabaseAdmin
                .from("outreach_enrolments")
                .select(enrolmentFields)
                .eq("workspace_id", account.workspaceId)
                .in("prospect_id", assignedIds)
            : Promise.resolve({ data: [] as any[], error: null }),
          unassignedIds.length
            ? supabaseAdmin
                .from("outreach_enrolments")
                .select(enrolmentFields)
                .eq("workspace_id", account.workspaceId)
                .eq("status", "paused")
                .is("last_sent_at", null)
                .in("prospect_id", unassignedIds)
            : Promise.resolve({ data: [] as any[], error: null }),
        ]);
      if (assignedMembershipResult.error) throw assignedMembershipResult.error;
      if (sharedMembershipResult.error) throw sharedMembershipResult.error;
      enrolments = [
        ...enrolments,
        ...(assignedMembershipResult.data || []),
        ...(sharedMembershipResult.data || []),
      ].filter(
        (row: any, index: number, rows: any[]) =>
          rows.findIndex(
            (candidate: any) =>
              candidate.campaign_id === row.campaign_id &&
              candidate.prospect_id === row.prospect_id
          ) === index
      );
    }
    const campaignMap = new Map((campaigns || []).map((row: any) => [row.id, row]));
    const blockedTargets = new Set(
      (suppressions || []).map((row: any) => String(row.target || "").toLowerCase())
    );
    const dailyLimit = clampOutreachDailyLimit(campaign?.daily_limit);
    let contactSlots = dailyLimit;
    const messageSummary = new Map<string, any>();
    for (const message of messages || []) {
      const existing = messageSummary.get(message.prospect_id) || {
        latestMessage: null,
        latestSentMessage: null,
        sentCount: 0,
      };
      if (!existing.latestMessage) existing.latestMessage = message;
      if (message.status === "sent") {
        existing.sentCount += 1;
        if (!existing.latestSentMessage) existing.latestSentMessage = message;
      }
      messageSummary.set(message.prospect_id, existing);
    }
    const latestEnrolment = new Map<string, any>();
    const campaignIdsByProspect = new Map<string, string[]>();
    const activeCampaignIdsByProspect = new Map<string, string[]>();
    const activeCampaignIdsByEmail = new Map<string, string[]>();
    for (const enrolment of enrolments || []) {
      if (!latestEnrolment.has(enrolment.prospect_id))
        latestEnrolment.set(enrolment.prospect_id, enrolment);
      const campaignIds = campaignIdsByProspect.get(enrolment.prospect_id) || [];
      if (!campaignIds.includes(enrolment.campaign_id)) campaignIds.push(enrolment.campaign_id);
      campaignIdsByProspect.set(enrolment.prospect_id, campaignIds);
      if (isActiveOutreachEnrolmentStatus(enrolment.status)) {
        const activeCampaignIds = activeCampaignIdsByProspect.get(enrolment.prospect_id) || [];
        if (!activeCampaignIds.includes(enrolment.campaign_id)) activeCampaignIds.push(enrolment.campaign_id);
        activeCampaignIdsByProspect.set(enrolment.prospect_id, activeCampaignIds);
        const recipientEmail = String(enrolment.recipient_email || "")
          .trim()
          .toLowerCase();
        if (recipientEmail) {
          const emailCampaignIds = activeCampaignIdsByEmail.get(recipientEmail) || [];
          if (!emailCampaignIds.includes(enrolment.campaign_id))
            emailCampaignIds.push(enrolment.campaign_id);
          activeCampaignIdsByEmail.set(recipientEmail, emailCampaignIds);
        }
      }
    }
    const prospects = (data || [])
      .map((prospect: any) => {
        const campaignIds = campaignIdsByProspect.get(prospect.id) || [];
        const recipientEmail = String(prospect.email || "").trim().toLowerCase();
        const activeCampaignIds = [
          ...(activeCampaignIdsByProspect.get(prospect.id) || []),
          ...(activeCampaignIdsByEmail.get(recipientEmail) || []),
        ].filter((id, index, all) => all.indexOf(id) === index);
        const scoringCampaign = campaignMap.get(activeCampaignIds[0]) || campaign;
        const recommendation = scoreOutreachProspect(prospect, {
          campaign: scoringCampaign,
          learnings: (learnings || []).filter((learning: any) => !scoringCampaign || learning.campaign_id === scoringCampaign.id),
          blockedTargets,
          crmGuard,
        });
        const { research, ...listProspect } = prospect;
        return {
          ...listProspect,
          has_research: hasSavedResearch(research),
          outreach: {
            ...(messageSummary.get(prospect.id) || {
              latestMessage: null,
              latestSentMessage: null,
              sentCount: 0,
            }),
            enrolment: latestEnrolment.get(prospect.id) || null,
            campaignIds,
            activeCampaignIds,
            sendpilot: (() => {
              const link = sendpilotByProspect.get(prospect.id);
              return link
                ? {
                    syncStatus: link.sync_status,
                    externalStatus: link.external_status,
                    campaignName: link.sendpilot_campaign_name,
                    enrolledAt: link.enrolled_at,
                    lastEventAt: link.last_event_at,
                    error: link.last_error,
                  }
                : null;
            })(),
          },
          recommendation,
        };
      })
      .sort((a: any, b: any) =>
        b.recommendation.score - a.recommendation.score ||
        String(a.company_name || "").localeCompare(String(b.company_name || ""))
      )
      .map((prospect: any) => {
        if (prospect.recommendation.action !== "contact_today") return prospect;
        const belongsToActiveCampaign = !prospect.outreach.activeCampaignIds.length || prospect.outreach.activeCampaignIds.includes(campaign?.id);
        if (!belongsToActiveCampaign) return prospect;
        if (contactSlots > 0) {
          contactSlots -= 1;
          return prospect;
        }
        return {
          ...prospect,
          recommendation: {
            ...prospect.recommendation,
            action: "hold",
            label: "Hold",
            risks: [
              `Strong fit, but below today’s top ${dailyLimit}`,
              ...prospect.recommendation.risks,
            ].slice(0, 3),
          },
        };
      });
    let membersQuery = supabaseService
      .from("workspace_members")
      .select("user_id,role,status")
      .eq("workspace_id", account.workspaceId)
      .eq("status", "active")
      .order("created_at");
    if (!canManageAssignments) {
      membersQuery = membersQuery.eq("user_id", account.userId);
    }
    const { data: members } = await membersQuery;
    const memberIds = (members || []).map((row: any) => row.user_id);
    const { data: profiles } = memberIds.length
      ? await supabaseService
          .from("profiles")
          .select("user_id,display_name,outreach_sender_name,outreach_sender_email")
          .in("user_id", memberIds)
      : { data: [] as any[] };
    const profileById = new Map((profiles || []).map((row: any) => [row.user_id, row]));
    const team = (members || []).map((member: any) => {
      const profile: any = profileById.get(member.user_id);
      return {
        userId: member.user_id,
        role: member.role,
        name: profile?.display_name || "Team member",
        senderName: profile?.outreach_sender_name || profile?.display_name || null,
        senderEmail: profile?.outreach_sender_email || null,
      };
    });
    return NextResponse.json({
      prospects,
      crmCandidates,
      team,
      currentUser: account.userId,
      canManageAssignments,
      canStageImports: account.role === "owner",
      selectedCampaignId: selection.selectedCampaignId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "failed to load outreach prospects" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return manualProspectBlocker(400, {
        code: "manual_prospect_details_required",
        title: "Prospect not added",
        reason: "The prospect details were missing or unreadable",
        nextAction: "Enter the person's name, company and exact work email, then try again",
        responsible: "user",
      });
    }

    const firstName = cleanManualField(body.firstName, 120);
    const lastName = cleanManualField(body.lastName, 120);
    const jobTitle = cleanManualField(body.jobTitle, 200);
    const email = cleanManualField(body.email, 320).toLowerCase();
    let companyName = cleanManualField(body.companyName, 200);
    const requestedCompanyId = cleanManualField(body.crmCompanyId, 80);

    if (!firstName || !companyName || !email) {
      return manualProspectBlocker(400, {
        code: "manual_prospect_details_required",
        title: "Prospect needs more information",
        reason: "First name, company and exact work email are required",
        nextAction: "Complete those three fields and add the prospect again",
        responsible: "user",
      });
    }
    if (!EMAIL.test(email)) {
      return manualProspectBlocker(400, {
        code: "manual_prospect_email_invalid",
        title: "Prospect email is not valid",
        reason: "LiveCoach needs an exact work email to prevent duplicate outreach",
        nextAction: "Correct the email address, then add the prospect again",
        responsible: "user",
      });
    }
    if (requestedCompanyId && !UUID.test(requestedCompanyId)) {
      return manualProspectBlocker(400, {
        code: "manual_prospect_client_invalid",
        title: "Client link is not valid",
        reason: "The selected CRM client could not be identified safely",
        nextAction: "Close the form, reopen the client from the list and try again",
        responsible: "user",
      });
    }

    const { data: existingRows, error: existingError } = await supabaseService
      .from("outreach_prospects")
      .select(`${PROSPECT_LIST_FIELDS},owner_id,workspace_id,visibility`)
      .eq("workspace_id", account.workspaceId)
      .ilike("email", exactIlikePattern(email))
      .limit(2);
    if (existingError) throw existingError;
    const existing = (existingRows as any[] | null)?.[0] || null;
    if (existing) {
      const availableToUser =
        existing.owner_id === account.userId ||
        existing.assigned_to_user_id === account.userId ||
        (!existing.assigned_to_user_id && existing.visibility === "team") ||
        ((account.role === "owner" || account.role === "manager") &&
          existing.visibility === "team");
      if (!availableToUser) {
        return manualProspectBlocker(409, {
          code: "manual_prospect_owned_by_teammate",
          title: "Duplicate prospect prevented",
          reason: "That work email is already held by another salesperson in this workspace",
          nextAction: "Ask a workspace owner or manager to confirm the owner instead of creating another copy",
          responsible: "manager",
        });
      }
      if (
        requestedCompanyId &&
        existing.crm_company_id &&
        existing.crm_company_id !== requestedCompanyId
      ) {
        return manualProspectBlocker(409, {
          code: "manual_prospect_existing_company_mismatch",
          title: "Duplicate prospect prevented",
          reason: "That exact work email is already linked to a different CRM client",
          nextAction: "Open the existing prospect and correct its company instead of creating another copy",
          responsible: "user",
        });
      }
      if (requestedCompanyId && !existing.crm_company_id) {
        if (
          existing.owner_id !== account.userId &&
          existing.assigned_to_user_id !== account.userId
        ) {
          return manualProspectBlocker(409, {
            code: "manual_prospect_existing_link_owner",
            title: "Existing prospect needs its owner",
            reason: "The existing shared prospect is not assigned to your account",
            nextAction: "Ask a workspace owner or manager to assign it before linking a CRM client",
            responsible: "manager",
          });
        }
        const access = await loadAssignedClientAccess(requestedCompanyId, account);
        if (!access) {
          return manualProspectBlocker(404, {
            code: "manual_prospect_client_not_assigned",
            title: "Prospect not linked",
            reason: "The selected CRM client is not owned by or assigned to your account",
            nextAction: "Ask a workspace owner to assign the client, then try again",
            responsible: "owner",
          });
        }
        const { data: linkedProspect, error: linkError } = await supabaseAdmin
          .from("outreach_prospects")
          .update({
            crm_company_id: requestedCompanyId,
            company_name: cleanManualField(access.company.name, 200),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .eq("workspace_id", account.workspaceId)
          .select(PROSPECT_LIST_FIELDS)
          .single();
        if (linkError) throw linkError;
        return NextResponse.json({
          ok: true,
          prospect: linkedProspect,
          created: false,
          duplicatePrevented: true,
          linkedExisting: true,
        });
      }
      return NextResponse.json({
        ok: true,
        prospect: existing,
        created: false,
        duplicatePrevented: true,
      });
    }

    const { data: knownContacts, error: contactError } = await supabaseService
      .from("contacts")
      .select("id,owner_id,company_id")
      .eq("workspace_id", account.workspaceId)
      .ilike("email", exactIlikePattern(email))
      .limit(3);
    if (contactError) throw contactError;
    const otherOwnerContact = (knownContacts || []).find(
      (contact: any) => contact.owner_id !== account.userId
    );
    if (otherOwnerContact) {
      return manualProspectBlocker(409, {
        code: "manual_prospect_known_relationship_owner",
        title: "Duplicate contact prevented",
        reason: "That work email is already held as a CRM relationship by another teammate",
        nextAction: "Ask a workspace owner or manager to confirm who should own the relationship before adding it to outreach",
        responsible: "manager",
      });
    }

    const ownContactCompanyIds = [
      ...new Set(
        (knownContacts || [])
          .map((contact: any) => String(contact.company_id || ""))
          .filter(Boolean)
      ),
    ];
    if (ownContactCompanyIds.length > 1) {
      return manualProspectBlocker(409, {
        code: "manual_prospect_contact_company_ambiguous",
        title: "Prospect company needs review",
        reason: "That email is attached to more than one of your CRM clients",
        nextAction: "Correct the duplicate CRM contact first, then add the prospect from the right client",
        responsible: "user",
      });
    }
    if (
      requestedCompanyId &&
      ownContactCompanyIds[0] &&
      requestedCompanyId !== ownContactCompanyIds[0]
    ) {
      return manualProspectBlocker(409, {
        code: "manual_prospect_contact_company_mismatch",
        title: "Prospect company does not match",
        reason: "That email is already attached to a different CRM client",
        nextAction: "Open the existing contact and correct its client before adding it to outreach",
        responsible: "user",
      });
    }

    let crmCompanyId = requestedCompanyId || ownContactCompanyIds[0] || null;
    if (!crmCompanyId) {
      const { data: exactCompanies, error: exactCompanyError } = await supabaseAdmin
        .from("companies")
        .select("id,name")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .ilike("name", exactIlikePattern(companyName))
        .limit(2);
      if (exactCompanyError) throw exactCompanyError;
      if ((exactCompanies || []).length > 1) {
        return manualProspectBlocker(409, {
          code: "manual_prospect_client_ambiguous",
          title: "Prospect company needs review",
          reason: "More than one of your CRM clients has that exact company name",
          nextAction: "Open the right client from Clients, then add its person from the Prospects tab",
          responsible: "user",
        });
      }
      if (exactCompanies?.[0]) {
        crmCompanyId = exactCompanies[0].id;
        companyName = cleanManualField(exactCompanies[0].name, 200);
      }
    }
    if (crmCompanyId) {
      const access = await loadAssignedClientAccess(crmCompanyId, account);
      if (!access) {
        return manualProspectBlocker(404, {
          code: "manual_prospect_client_not_assigned",
          title: "Prospect not added",
          reason: "The selected CRM client is not owned by or assigned to your account",
          nextAction: "Ask a workspace owner to assign the client, then add its contact to outreach",
          responsible: "owner",
        });
      }
      companyName = cleanManualField(access.company.name, 200);
    }

    const createdAt = new Date().toISOString();
    const { data: prospect, error: insertError } = await supabaseAdmin
      .from("outreach_prospects")
      .insert({
        ...privateRecordFields(account),
        assigned_to_user_id: account.userId,
        email,
        first_name: firstName,
        last_name: lastName || null,
        job_title: jobTitle || null,
        company_name: companyName,
        crm_company_id: crmCompanyId,
        priority: "low",
        status: "imported",
        source_file: "LiveCoach manual entry",
        source_sheet: "Outreach Prospects",
        source_metadata: {
          manual_entry: {
            created_at: createdAt,
            created_by: account.userId,
            linked_client_id: crmCompanyId,
          },
        },
      })
      .select(PROSPECT_LIST_FIELDS)
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        return manualProspectBlocker(409, {
          code: "manual_prospect_duplicate_protected",
          title: "Duplicate prospect prevented",
          reason: "That exact work email already exists in LiveCoach",
          nextAction: "Ask a workspace owner or manager to find and assign the existing record",
          responsible: "manager",
        });
      }
      throw insertError;
    }

    return NextResponse.json({
      ok: true,
      prospect,
      created: true,
      duplicatePrevented: false,
      noOutreachSent: true,
    });
  } catch (err: any) {
    console.error("Manual outreach prospect save failed", err?.message || err);
    return manualProspectBlocker(500, {
      code: "manual_prospect_save_not_confirmed",
      title: "Prospect not added",
      reason: "LiveCoach could not confirm the new prospect in the CRM",
      nextAction: "Refresh the Prospects tab and try once more. If it repeats, send this blocker code to a workspace owner",
      responsible: "system",
    });
  }
}
