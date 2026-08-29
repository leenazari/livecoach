import "server-only";

import {
  listSendPilotCampaigns,
  listSendPilotLeads,
  type SendPilotCampaign,
  type SendPilotLead,
} from "@/lib/sendpilot-api";
import type { SendPilotIntegrationRow } from "@/lib/sendpilot";
import {
  normaliseLinkedInProfileUrl,
  normaliseStoredLinkedInProfileUrl,
} from "@/lib/linkedin-inbox-contract";
import { supabaseService } from "@/lib/supabase";

type OwnerScope = { userId: string; workspaceId: string };

type Prospect = {
  id: string;
  assigned_to_user_id: string | null;
  email: string;
  person_linkedin_url: string | null;
  status: string;
};

type ExistingLink = {
  id: string;
  integration_id: string;
  owner_id: string;
  outreach_prospect_id: string;
  sendpilot_lead_id: string | null;
  linkedin_url: string;
  email: string | null;
};

export type SendPilotReconciliationResult = {
  campaigns: number;
  scanned: number;
  matched: number;
  updated: number;
  review: number;
  duplicatesBlocked: number;
  emailOutreachPaused: number;
  truncated: boolean;
};

const REVIEW_REASONS = new Set([
  "unmatched",
  "missing_linkedin",
  "ambiguous_linkedin",
  "ambiguous_email",
  "identity_conflict",
  "assigned_to_another_user",
  "unassigned_prospect",
  "workspace_duplicate",
]);

const CONTACTED_STATUSES = new Set([
  "CONNECTION_SENT",
  "CONNECTION_ACCEPTED",
  "MESSAGE_SENT",
  "FOLLOWUP_SENT",
  "REPLY_RECEIVED",
  "SUCCESS",
  "DONE",
  "MEETING_BOOKED",
  "OPPORTUNITY",
]);

const MESSAGE_STATUSES = new Set([
  "MESSAGE_SENT",
  "FOLLOWUP_SENT",
  "REPLY_RECEIVED",
]);

const CONNECTION_STATUSES = new Set([
  "CONNECTION_SENT",
  "CONNECTION_ACCEPTED",
]);

const SUPPRESSED_STATUSES = new Set([
  "BLOCKED",
  "UNSUBSCRIBED",
  "IRRELEVANT",
  "NOT_INTERESTED",
  "WRONG_PERSON",
]);

const FAILED_STATUSES = new Set([
  "FAILED",
  "PROFILE_UNREACHABLE",
  "SKIPPED",
]);

const COMPLETED_STATUSES = new Set([
  "DONE",
  "SUCCESS",
  "MEETING_BOOKED",
  "OPPORTUNITY",
]);

const cleanEmail = (value: unknown) => {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
};

const clean = (value: unknown, maximum = 500) =>
  String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);

function syncStatus(statusValue: unknown): string {
  const status = clean(statusValue, 80).toUpperCase();
  if (SUPPRESSED_STATUSES.has(status)) return "suppressed";
  if (status === "REPLY_RECEIVED") return "replied";
  if (COMPLETED_STATUSES.has(status)) return "completed";
  if (FAILED_STATUSES.has(status)) return "failed";
  return "active";
}

async function loadWorkspaceProspects(workspaceId: string): Promise<Prospect[]> {
  const rows: Prospect[] = [];
  for (let page = 0; page < 20; page += 1) {
    const from = page * 1_000;
    const { data, error } = await supabaseService
      .from("outreach_prospects")
      .select("id,assigned_to_user_id,email,person_linkedin_url,status")
      .eq("workspace_id", workspaceId)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data || []) as Prospect[]));
    if ((data || []).length < 1_000) break;
  }
  return rows;
}

async function loadWorkspaceLinks(workspaceId: string): Promise<ExistingLink[]> {
  const rows: ExistingLink[] = [];
  for (let page = 0; page < 20; page += 1) {
    const from = page * 1_000;
    const { data, error } = await supabaseService
      .from("sendpilot_lead_links")
      .select(
        "id,integration_id,owner_id,outreach_prospect_id,sendpilot_lead_id,linkedin_url,email"
      )
      .eq("workspace_id", workspaceId)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data || []) as ExistingLink[]));
    if ((data || []).length < 1_000) break;
  }
  return rows;
}

const append = <T>(map: Map<string, T[]>, key: string, value: T) => {
  if (!key) return;
  const items = map.get(key) || [];
  items.push(value);
  map.set(key, items);
};

async function upsertReview(
  integration: SendPilotIntegrationRow,
  campaign: SendPilotCampaign,
  lead: SendPilotLead,
  input: {
    reason: string;
    profileUrl: string;
    email: string;
    matchedProspectId?: string | null;
  }
) {
  const reason = REVIEW_REASONS.has(input.reason) ? input.reason : "identity_conflict";
  const now = new Date().toISOString();
  const { error } = await supabaseService.from("sendpilot_lead_reviews").upsert(
    {
      integration_id: integration.id,
      workspace_id: integration.workspace_id,
      owner_id: integration.owner_id,
      visibility: "private",
      sendpilot_lead_id: lead.id,
      sendpilot_campaign_id: campaign.id,
      sendpilot_campaign_name: campaign.name,
      linkedin_url: input.profileUrl,
      email: input.email || null,
      first_name: clean(lead.firstName, 120) || null,
      last_name: clean(lead.lastName, 120) || null,
      company_name: clean(lead.company, 240) || null,
      job_title: clean(lead.title, 240) || null,
      external_status: clean(lead.status, 80) || null,
      custom_lead_status: clean(lead.customLeadStatus, 80) || null,
      review_reason: reason,
      status: "pending",
      matched_prospect_id: input.matchedProspectId || null,
      resolution_note: null,
      resolved_at: null,
      last_seen_at: now,
      updated_at: now,
    },
    { onConflict: "integration_id,sendpilot_lead_id" }
  );
  if (error) throw error;
}

async function resolveReview(
  integration: SendPilotIntegrationRow,
  leadId: string,
  prospectId: string
) {
  const now = new Date().toISOString();
  const { error } = await supabaseService
    .from("sendpilot_lead_reviews")
    .update({
      status: "resolved",
      matched_prospect_id: prospectId,
      resolution_note: "Matched by exact CRM identity during reconciliation",
      resolved_at: now,
      last_seen_at: now,
      updated_at: now,
    })
    .eq("integration_id", integration.id)
    .eq("workspace_id", integration.workspace_id)
    .eq("owner_id", integration.owner_id)
    .eq("sendpilot_lead_id", leadId)
    .eq("status", "pending");
  if (error) throw error;
}

export async function pauseLiveCoachEmailOutreachForSendPilot(input: {
  workspaceId: string;
  prospectId: string;
  reason: string;
  keepEnrolmentId?: string | null;
}): Promise<number> {
  const now = new Date().toISOString();
  let enrolments = supabaseService
    .from("outreach_enrolments")
    .update({ status: "paused", next_action_at: null, updated_at: now })
    .eq("workspace_id", input.workspaceId)
    .eq("prospect_id", input.prospectId)
    .in("status", ["queued", "researched", "drafted", "approved", "contacted"]);
  if (input.keepEnrolmentId) enrolments = enrolments.neq("id", input.keepEnrolmentId);
  const [messagesResult, enrolmentsResult] = await Promise.all([
    supabaseService
      .from("outreach_messages")
      .update({
        status: "cancelled",
        scheduled_at: null,
        claim_expires_at: null,
        error: input.reason.slice(0, 500),
        updated_at: now,
      })
      .eq("workspace_id", input.workspaceId)
      .eq("prospect_id", input.prospectId)
      .in("status", ["draft", "approved"])
      .select("id"),
    enrolments.select("id"),
  ]);
  if (messagesResult.error) throw messagesResult.error;
  if (enrolmentsResult.error) throw enrolmentsResult.error;
  return (messagesResult.data || []).length + (enrolmentsResult.data || []).length;
}

async function applyLeadState(
  integration: SendPilotIntegrationRow,
  prospect: Prospect,
  lead: SendPilotLead,
  keepEnrolmentId?: string | null
) {
  const status = clean(lead.status, 80).toUpperCase();
  const at = lead.updatedAt || lead.createdAt || new Date().toISOString();
  let paused = 0;
  if (!FAILED_STATUSES.has(status)) {
    paused = await pauseLiveCoachEmailOutreachForSendPilot({
      workspaceId: integration.workspace_id,
      prospectId: prospect.id,
      keepEnrolmentId,
      reason: `Paused because SendPilot owns this contact. Current status ${status || "ACTIVE"}`,
    });
  }
  if (CONTACTED_STATUSES.has(status)) {
    const { error } = await supabaseService
      .from("outreach_prospects")
      .update({
        status: status === "REPLY_RECEIVED" ? "replied" : "contacted",
        last_contacted_at: at,
        ...(status === "REPLY_RECEIVED" ? { last_reply_at: at } : {}),
        next_action_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", integration.workspace_id)
      .eq("assigned_to_user_id", integration.owner_id)
      .eq("id", prospect.id)
      .in("status", [
        "imported",
        "queued",
        "researching",
        "ready",
        "contacted",
        "replied",
      ]);
    if (error) throw error;
  }
  if (SUPPRESSED_STATUSES.has(status)) {
    const email = cleanEmail(prospect.email);
    const updates = [
      supabaseService
        .from("outreach_prospects")
        .update({
          status: "suppressed",
          suppression_reason: `SendPilot status ${status}`,
          next_action_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("assigned_to_user_id", integration.owner_id)
        .eq("id", prospect.id),
      supabaseService
        .from("outreach_enrolments")
        .update({
          status: "suppressed",
          next_action_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("prospect_id", prospect.id)
        .in("status", [
          "queued",
          "researched",
          "drafted",
          "approved",
          "contacted",
          "paused",
        ]),
    ];
    if (email) {
      updates.push(
        supabaseService.from("outreach_suppressions").upsert({
          workspace_id: integration.workspace_id,
          owner_id: integration.owner_id,
          visibility: "team",
          target: email,
          kind: "email",
          reason: `SendPilot status ${status}`,
          source: "sendpilot_reconciliation",
        }) as any
      );
    }
    const results = await Promise.all(updates);
    const error = results.find((result: any) => result.error)?.error;
    if (error) throw error;
  }
  return paused;
}

export async function reconcileSendPilotLeads(
  scope: OwnerScope,
  integration: SendPilotIntegrationRow,
  apiKey: string
): Promise<SendPilotReconciliationResult> {
  if (
    integration.workspace_id !== scope.workspaceId ||
    integration.owner_id !== scope.userId
  ) {
    throw new Error("The SendPilot reconciliation owner does not match this CRM account");
  }

  const [campaigns, prospects, existingLinks] = await Promise.all([
    listSendPilotCampaigns(apiKey),
    loadWorkspaceProspects(scope.workspaceId),
    loadWorkspaceLinks(scope.workspaceId),
  ]);
  const prospectsByLinkedIn = new Map<string, Prospect[]>();
  const prospectsByEmail = new Map<string, Prospect[]>();
  for (const prospect of prospects) {
    append(
      prospectsByLinkedIn,
      normaliseStoredLinkedInProfileUrl(prospect.person_linkedin_url) || "",
      prospect
    );
    append(prospectsByEmail, cleanEmail(prospect.email), prospect);
  }
  const linksByProvider = new Map<string, ExistingLink>();
  const linksByLinkedIn = new Map<string, ExistingLink>();
  const linksByEmail = new Map<string, ExistingLink>();
  for (const link of existingLinks) {
    if (link.sendpilot_lead_id) {
      linksByProvider.set(`${link.integration_id}:${link.sendpilot_lead_id}`, link);
    }
    linksByLinkedIn.set(link.linkedin_url, link);
    if (link.email) linksByEmail.set(cleanEmail(link.email), link);
  }

  const result: SendPilotReconciliationResult = {
    campaigns: campaigns.length,
    scanned: 0,
    matched: 0,
    updated: 0,
    review: 0,
    duplicatesBlocked: 0,
    emailOutreachPaused: 0,
    truncated: false,
  };

  for (const campaign of campaigns) {
    for (let page = 1; page <= 20; page += 1) {
      const remote = await listSendPilotLeads(apiKey, {
        campaignId: campaign.id,
        page,
        limit: 100,
        full: true,
      });
      for (const lead of remote.leads) {
        result.scanned += 1;
        const email = cleanEmail(lead.email);
        const remoteProfileUrl = normaliseLinkedInProfileUrl(lead.linkedinUrl);
        const emailMatches = email ? prospectsByEmail.get(email) || [] : [];
        const emailProspect = emailMatches.length === 1 ? emailMatches[0] : null;
        // SendPilot normally supplies LinkedIn identity. If it does not, an
        // exact unique email may safely recover the canonical CRM profile URL.
        // Anything weaker is held for review and never becomes a CRM link.
        const profileUrl =
          remoteProfileUrl ||
          normaliseStoredLinkedInProfileUrl(emailProspect?.person_linkedin_url) ||
          "";
        const linkedinMatches = prospectsByLinkedIn.get(profileUrl) || [];
        let reviewReason = "";
        if (!profileUrl) reviewReason = "missing_linkedin";
        else if (linkedinMatches.length > 1) reviewReason = "ambiguous_linkedin";
        else if (emailMatches.length > 1) reviewReason = "ambiguous_email";
        const linkedinProspect = linkedinMatches.length === 1 ? linkedinMatches[0] : null;
        if (
          !reviewReason &&
          linkedinProspect &&
          emailProspect &&
          linkedinProspect.id !== emailProspect.id
        ) {
          reviewReason = "identity_conflict";
        }
        const prospect = linkedinProspect || emailProspect;
        if (!reviewReason && !prospect) reviewReason = "unmatched";
        if (!reviewReason && !prospect?.assigned_to_user_id) {
          reviewReason = "unassigned_prospect";
        }
        if (
          !reviewReason &&
          prospect?.assigned_to_user_id !== integration.owner_id
        ) {
          reviewReason = "assigned_to_another_user";
        }

        const providerKey = `${integration.id}:${lead.id}`;
        const existing = linksByProvider.get(providerKey);
        if (
          !reviewReason &&
          existing &&
          prospect &&
          existing.outreach_prospect_id !== prospect.id
        ) {
          reviewReason = "identity_conflict";
        }
        const workspaceCollision =
          linksByLinkedIn.get(profileUrl) || (email ? linksByEmail.get(email) : null);
        if (
          !reviewReason &&
          workspaceCollision &&
          workspaceCollision.id !== existing?.id
        ) {
          reviewReason = "workspace_duplicate";
        }
        if (reviewReason || !prospect) {
          await upsertReview(integration, campaign, lead, {
            reason: reviewReason || "unmatched",
            profileUrl,
            email,
            matchedProspectId:
              prospect?.assigned_to_user_id === integration.owner_id &&
              !["ambiguous_linkedin", "ambiguous_email", "identity_conflict"].includes(
                reviewReason
              )
                ? prospect.id
                : null,
          });
          result.review += 1;
          if (reviewReason === "workspace_duplicate") result.duplicatesBlocked += 1;
          continue;
        }

        const status = clean(lead.status, 80).toUpperCase();
        const mappedSyncStatus = syncStatus(status);
        const now = new Date().toISOString();
        const values = {
          integration_id: integration.id,
          campaign_link_id: null,
          workspace_id: scope.workspaceId,
          owner_id: scope.userId,
          visibility: "private",
          outreach_prospect_id: prospect.id,
          outreach_enrolment_id: null,
          livecoach_campaign_id: null,
          sendpilot_campaign_id: campaign.id,
          sendpilot_campaign_name: campaign.name,
          sendpilot_lead_id: lead.id,
          linkedin_url: profileUrl,
          email: email || cleanEmail(prospect.email) || null,
          sync_status: mappedSyncStatus,
          external_status: status || null,
          custom_lead_status: clean(lead.customLeadStatus, 80) || null,
          enrolled_at: lead.createdAt || null,
          last_event_at: lead.updatedAt || lead.createdAt || null,
          ...(MESSAGE_STATUSES.has(status)
            ? { last_message_at: lead.updatedAt || lead.createdAt || null }
            : {}),
          ...(CONNECTION_STATUSES.has(status)
            ? { last_connection_at: lead.updatedAt || lead.createdAt || null }
            : {}),
          ...(status === "REPLY_RECEIVED"
            ? { last_reply_at: lead.updatedAt || lead.createdAt || null }
            : {}),
          last_error: mappedSyncStatus === "failed" ? `SendPilot status ${status}` : null,
          updated_at: now,
        };
        const query = existing
          ? supabaseService
              .from("sendpilot_lead_links")
              .update(values)
              .eq("id", existing.id)
              .eq("integration_id", integration.id)
              .eq("workspace_id", scope.workspaceId)
              .eq("owner_id", scope.userId)
          : supabaseService.from("sendpilot_lead_links").insert(values);
        const { data: saved, error } = await query
          .select(
            "id,integration_id,owner_id,outreach_prospect_id,sendpilot_lead_id,linkedin_url,email"
          )
          .maybeSingle();
        if (error?.code === "23505") {
          await upsertReview(integration, campaign, lead, {
            reason: "workspace_duplicate",
            profileUrl,
            email,
            matchedProspectId: prospect.id,
          });
          result.review += 1;
          result.duplicatesBlocked += 1;
          continue;
        }
        if (error) throw error;
        if (!saved) throw new Error("The SendPilot lead reconciliation was not confirmed");
        const savedLink = saved as ExistingLink;
        linksByProvider.set(providerKey, savedLink);
        linksByLinkedIn.set(profileUrl, savedLink);
        if (savedLink.email) linksByEmail.set(cleanEmail(savedLink.email), savedLink);
        result.matched += 1;
        if (existing) result.updated += 1;
        result.emailOutreachPaused += await applyLeadState(
          integration,
          prospect,
          lead,
          null
        );
        await resolveReview(integration, lead.id, prospect.id);
      }
      if (page >= remote.totalPages) break;
      if (page === 20 && remote.totalPages > 20) result.truncated = true;
    }
  }

  const { error: auditError } = await supabaseService
    .from("access_audit_events")
    .insert({
      workspace_id: scope.workspaceId,
      actor_user_id: scope.userId,
      source: "system",
      action: "sendpilot_leads_reconciled",
      target_table: "sendpilot_integrations",
      target_id: integration.id,
      previous_scope: {},
      next_scope: result,
    });
  if (auditError) console.error("SendPilot reconciliation audit failed", auditError.message);
  return result;
}

export async function activeSendPilotConflictForProspect(input: {
  workspaceId: string;
  prospectId: string;
  email?: string | null;
  linkedinUrl?: string | null;
  excludeLinkId?: string | null;
}): Promise<ExistingLink | null> {
  const profileUrl = normaliseStoredLinkedInProfileUrl(input.linkedinUrl);
  const email = cleanEmail(input.email);
  let query = supabaseService
    .from("sendpilot_lead_links")
    .select(
      "id,integration_id,owner_id,outreach_prospect_id,sendpilot_lead_id,linkedin_url,email"
    )
    .eq("workspace_id", input.workspaceId);
  if (input.excludeLinkId) query = query.neq("id", input.excludeLinkId);
  const filters = [
    `outreach_prospect_id.eq.${input.prospectId}`,
    ...(profileUrl ? [`linkedin_url.eq.${profileUrl}`] : []),
    ...(email ? [`email.eq.${email}`] : []),
  ];
  const { data, error } = await query.or(filters.join(",")).limit(1).maybeSingle();
  if (error) throw error;
  return (data as ExistingLink | null) || null;
}
