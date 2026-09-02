import "server-only";

import {
  addSendPilotLeads,
  listSendPilotCampaigns,
  listSendPilotLeads,
  SendPilotApiError,
  updateSendPilotCampaign,
  updateSendPilotLeadStatus,
  type SendPilotCampaign,
  type SendPilotLead,
} from "@/lib/sendpilot-api";
import type { SendPilotWebhookEvent } from "@/lib/sendpilot-contract";
import {
  decryptSendPilotApiKey,
  loadSendPilotIntegrationForOwner,
  type SendPilotIntegrationRow,
} from "@/lib/sendpilot";
import {
  normaliseLinkedInProfileUrl,
  normaliseStoredLinkedInProfileUrl,
} from "@/lib/linkedin-inbox-contract";
import {
  clampOutreachDailyLimit,
  emailDomain,
  londonDayBounds,
  outreachCrmGuard,
  prospectHasBlockedCrmRelationship,
} from "@/lib/outreach";
import {
  isActiveOutreachEnrolmentStatus,
  isInsideCrossCampaignCooldown,
} from "@/lib/outreach-team-safety";
import { outreachSequenceStepAt } from "@/lib/outreach-sequence";
import {
  activeSendPilotConflictForProspect,
  pauseLiveCoachEmailOutreachForSendPilot,
} from "@/lib/sendpilot-reconciliation";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import {
  ensureReplyAttentionTask,
  type ReplyAttentionCategory,
} from "@/lib/reply-attention";
import { runWithServiceRecordScope } from "@/lib/service-scope";
import { preparePositiveReplyForApproval } from "@/lib/outreach-positive-reply";

type OwnerScope = { userId: string; workspaceId: string };

type CampaignLink = {
  id: string;
  integration_id: string;
  workspace_id: string;
  owner_id: string;
  livecoach_campaign_id: string;
  sendpilot_campaign_id: string;
  sendpilot_campaign_name: string;
  sendpilot_campaign_status: SendPilotCampaign["status"];
  active: boolean;
};

export type SendPilotLeadLink = {
  id: string;
  integration_id: string;
  campaign_link_id: string | null;
  workspace_id: string;
  owner_id: string;
  outreach_prospect_id: string;
  outreach_enrolment_id: string | null;
  livecoach_campaign_id: string | null;
  sendpilot_campaign_id: string;
  sendpilot_campaign_name: string | null;
  sendpilot_lead_id: string | null;
  linkedin_url: string;
  email: string | null;
  sync_status: string;
  external_status: string | null;
  custom_lead_status: string | null;
  last_event_type: string | null;
  enrolled_at: string | null;
  last_event_at: string | null;
  last_message_at: string | null;
  last_reply_at: string | null;
  last_connection_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const LEAD_LINK_SELECT =
  "id,integration_id,campaign_link_id,workspace_id,owner_id,outreach_prospect_id,outreach_enrolment_id,livecoach_campaign_id,sendpilot_campaign_id,sendpilot_campaign_name,sendpilot_lead_id,linkedin_url,email,sync_status,external_status,custom_lead_status,last_event_type,enrolled_at,last_event_at,last_message_at,last_reply_at,last_connection_at,last_error,created_at,updated_at";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clean = (value: unknown, maximum = 1_000) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";

const safeError = (error: any) =>
  String(error?.message || "SendPilot outreach failed").slice(0, 500);

function sendPilotBlock(code: string, message: string, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

async function writeAudit(
  scope: OwnerScope,
  input: {
    action: string;
    targetTable: string;
    targetId: string;
    previous?: Record<string, unknown>;
    next?: Record<string, unknown>;
  }
) {
  const { error } = await supabaseService.from("access_audit_events").insert({
    workspace_id: scope.workspaceId,
    actor_user_id: scope.userId,
    source: "system",
    action: input.action,
    target_table: input.targetTable,
    target_id: input.targetId,
    previous_scope: input.previous || {},
    next_scope: input.next || {},
  });
  if (error) console.error("SendPilot outreach audit failed", error.message);
}

async function requireActiveIntegration(scope: OwnerScope) {
  const integration = await loadSendPilotIntegrationForOwner(scope);
  if (!integration || integration.status !== "active") {
    throw Object.assign(new Error("Connect your SendPilot account first"), {
      status: 409,
    });
  }
  return integration;
}

export async function sendPilotCampaignConfiguration(scope: OwnerScope) {
  const integration = await loadSendPilotIntegrationForOwner(scope);
  if (!integration || integration.status !== "active") {
    return {
      connected: false,
      webhookConfigured: false,
      campaigns: [] as SendPilotCampaign[],
      livecoachCampaigns: [] as any[],
      mappings: [] as CampaignLink[],
    };
  }
  const apiKey = decryptSendPilotApiKey(integration);
  const campaigns = await listSendPilotCampaigns(apiKey);
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const { data: existing, error: mappingError } = await supabaseService
    .from("sendpilot_campaign_links")
    .select("*")
    .eq("integration_id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .order("updated_at", { ascending: false });
  if (mappingError) throw mappingError;

  const now = new Date().toISOString();
  for (const mapping of existing || []) {
    const current = campaignById.get(mapping.sendpilot_campaign_id);
    if (!current) {
      if (mapping.active) {
        await supabaseService
          .from("sendpilot_campaign_links")
          .update({ active: false, updated_at: now, last_refreshed_at: now })
          .eq("id", mapping.id)
          .eq("integration_id", integration.id)
          .eq("owner_id", scope.userId)
          .eq("workspace_id", scope.workspaceId);
      }
      continue;
    }
    if (
      mapping.sendpilot_campaign_name !== current.name ||
      mapping.sendpilot_campaign_status !== current.status ||
      mapping.active !== (current.status === "started")
    ) {
      const { error } = await supabaseService
        .from("sendpilot_campaign_links")
        .update({
          sendpilot_campaign_name: current.name,
          sendpilot_campaign_status: current.status,
          active: current.status === "started",
          last_refreshed_at: now,
          updated_at: now,
        })
        .eq("id", mapping.id)
        .eq("integration_id", integration.id)
        .eq("owner_id", scope.userId)
        .eq("workspace_id", scope.workspaceId);
      if (error) throw error;
    }
  }

  const [{ data: livecoachCampaigns, error: livecoachError }, { data: mappings, error: refreshedError }] =
    await Promise.all([
      supabaseService
        .from("outreach_campaigns")
        .select("id,name,status,approval_mode,daily_limit,updated_at")
        .eq("workspace_id", scope.workspaceId)
        .or(`owner_id.eq.${scope.userId},visibility.eq.team`)
        .order("updated_at", { ascending: false }),
      supabaseService
        .from("sendpilot_campaign_links")
        .select("*")
        .eq("integration_id", integration.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .order("updated_at", { ascending: false }),
    ]);
  if (livecoachError) throw livecoachError;
  if (refreshedError) throw refreshedError;
  return {
    connected: true,
    webhookConfigured: !!integration.webhook_secret_ciphertext,
    campaigns,
    livecoachCampaigns: livecoachCampaigns || [],
    mappings: (mappings || []) as CampaignLink[],
  };
}

export async function saveSendPilotCampaignMapping(
  scope: OwnerScope,
  input: { livecoachCampaignId: unknown; sendpilotCampaignId: unknown }
) {
  const livecoachCampaignId = clean(input.livecoachCampaignId, 80);
  const sendpilotCampaignId = clean(input.sendpilotCampaignId, 240);
  if (!UUID.test(livecoachCampaignId)) {
    throw Object.assign(new Error("Choose a valid LiveCoach campaign"), {
      status: 400,
    });
  }
  const integration = await requireActiveIntegration(scope);
  const { data: livecoachCampaign, error: livecoachError } = await supabaseService
    .from("outreach_campaigns")
    .select("id,name,status,approval_mode")
    .eq("id", livecoachCampaignId)
    .eq("workspace_id", scope.workspaceId)
    .or(`owner_id.eq.${scope.userId},visibility.eq.team`)
    .maybeSingle();
  if (livecoachError) throw livecoachError;
  if (!livecoachCampaign) {
    throw Object.assign(new Error("That LiveCoach campaign is unavailable"), {
      status: 404,
    });
  }

  const { data: existing, error: existingError } = await supabaseService
    .from("sendpilot_campaign_links")
    .select("*")
    .eq("integration_id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("livecoach_campaign_id", livecoachCampaignId)
    .maybeSingle();
  if (existingError) throw existingError;

  if (!sendpilotCampaignId) {
    if (existing) {
      const { error } = await supabaseService
        .from("sendpilot_campaign_links")
        .delete()
        .eq("id", existing.id)
        .eq("integration_id", integration.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId);
      if (error) throw error;
      await writeAudit(scope, {
        action: "sendpilot_campaign_unmapped",
        targetTable: "sendpilot_campaign_links",
        targetId: existing.id,
        previous: { active: existing.active, sendpilotCampaignId: existing.sendpilot_campaign_id },
        next: { deleted: true },
      });
    }
    return { mapping: null };
  }

  const apiKey = decryptSendPilotApiKey(integration);
  const campaigns = await listSendPilotCampaigns(apiKey);
  const remote = campaigns.find((campaign) => campaign.id === sendpilotCampaignId);
  if (!remote) {
    throw Object.assign(new Error("That SendPilot campaign is unavailable in your account"), {
      status: 404,
    });
  }
  const now = new Date().toISOString();
  const values = {
    integration_id: integration.id,
    workspace_id: scope.workspaceId,
    owner_id: scope.userId,
    visibility: "private",
    livecoach_campaign_id: livecoachCampaignId,
    sendpilot_campaign_id: remote.id,
    sendpilot_campaign_name: remote.name,
    sendpilot_campaign_status: remote.status,
    active: remote.status === "started",
    last_refreshed_at: now,
    updated_at: now,
  };
  const query = existing
    ? supabaseService
        .from("sendpilot_campaign_links")
        .update(values)
        .eq("id", existing.id)
        .eq("integration_id", integration.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
    : supabaseService.from("sendpilot_campaign_links").insert(values);
  const { data, error } = await query.select("*").single();
  if (error) {
    if (error.code === "23505") {
      throw Object.assign(
        new Error("That SendPilot campaign is already mapped to another LiveCoach campaign"),
        { status: 409 }
      );
    }
    throw error;
  }
  await writeAudit(scope, {
    action: existing ? "sendpilot_campaign_remapped" : "sendpilot_campaign_mapped",
    targetTable: "sendpilot_campaign_links",
    targetId: data.id,
    previous: existing
      ? { sendpilotCampaignId: existing.sendpilot_campaign_id, active: existing.active }
      : {},
    next: { sendpilotCampaignId: remote.id, active: remote.status === "started" },
  });
  return { mapping: data };
}

export async function loadSendPilotLeadLinksForOwner(
  scope: OwnerScope,
  prospectIds?: string[]
): Promise<SendPilotLeadLink[]> {
  const integration = await loadSendPilotIntegrationForOwner(scope);
  if (!integration) return [];
  let query = supabaseService
    .from("sendpilot_lead_links")
    .select(LEAD_LINK_SELECT)
    .eq("integration_id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .order("updated_at", { ascending: false });
  if (prospectIds?.length) query = query.in("outreach_prospect_id", prospectIds);
  const { data, error } = await query.limit(2_000);
  if (error) throw error;
  return (data || []) as SendPilotLeadLink[];
}

export async function loadSendPilotOutreachContext(
  scope: OwnerScope,
  input: { prospectIds?: string[]; campaignIds?: string[] } = {}
) {
  const integration = await loadSendPilotIntegrationForOwner(scope);
  if (!integration || integration.status !== "active") {
    return {
      connected: false,
      webhookConfigured: false,
      mappings: [] as Array<{
        livecoachCampaignId: string;
        sendpilotCampaignId: string;
        sendpilotCampaignName: string;
        active: boolean;
      }>,
      links: [] as SendPilotLeadLink[],
    };
  }
  let mappingQuery = supabaseService
    .from("sendpilot_campaign_links")
    .select(
      "livecoach_campaign_id,sendpilot_campaign_id,sendpilot_campaign_name,active"
    )
    .eq("integration_id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId);
  if (input.campaignIds?.length) {
    mappingQuery = mappingQuery.in("livecoach_campaign_id", input.campaignIds);
  }
  const [mappingResult, links] = await Promise.all([
    mappingQuery,
    loadSendPilotLeadLinksForOwner(scope, input.prospectIds),
  ]);
  if (mappingResult.error) throw mappingResult.error;
  return {
    connected: true,
    webhookConfigured: !!integration.webhook_secret_ciphertext,
    mappings: (mappingResult.data || []).map((mapping: any) => ({
      livecoachCampaignId: mapping.livecoach_campaign_id,
      sendpilotCampaignId: mapping.sendpilot_campaign_id,
      sendpilotCampaignName: mapping.sendpilot_campaign_name,
      active: mapping.active === true,
    })),
    links,
  };
}

export async function stopSendPilotLead(
  scope: OwnerScope,
  input: {
    prospectId: unknown;
    requestId: unknown;
    confirmed: unknown;
    note?: unknown;
  }
) {
  const prospectId = clean(input.prospectId, 80);
  const requestId = clean(input.requestId, 80);
  if (!UUID.test(prospectId) || !UUID.test(requestId) || input.confirmed !== true) {
    throw Object.assign(
      new Error("Confirm one exact prospect before stopping their SendPilot outreach"),
      { status: 400 }
    );
  }
  const integration = await requireActiveIntegration(scope);
  const [{ data: prospect, error: prospectError }, { data: link, error: linkError }] =
    await Promise.all([
      supabaseService
        .from("outreach_prospects")
        .select("id,first_name,last_name,email,assigned_to_user_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("assigned_to_user_id", scope.userId)
        .eq("id", prospectId)
        .maybeSingle(),
      supabaseService
        .from("sendpilot_lead_links")
        .select(LEAD_LINK_SELECT)
        .eq("integration_id", integration.id)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("outreach_prospect_id", prospectId)
        .not("sendpilot_lead_id", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  if (prospectError) throw prospectError;
  if (linkError) throw linkError;
  if (!prospect || !link?.sendpilot_lead_id) {
    throw Object.assign(
      new Error("This prospect is not linked to your SendPilot account"),
      { status: 404 }
    );
  }
  if (link.external_status === "DONE" && link.sync_status === "completed") {
    return { alreadyStopped: true, link };
  }

  const apiKey = decryptSendPilotApiKey(integration);
  const remote = await updateSendPilotLeadStatus(apiKey, {
    leadId: link.sendpilot_lead_id,
    status: "DONE",
    note:
      clean(input.note, 500) ||
      "Stopped from LiveCoach after explicit salesperson approval",
  });
  const now = new Date().toISOString();
  const results = await Promise.all([
    supabaseService
      .from("sendpilot_lead_links")
      .update({
        external_status: "DONE",
        sync_status: "completed",
        last_event_type: "livecoach.lead.stopped",
        last_event_at: now,
        last_error: null,
        updated_at: now,
      })
      .eq("id", link.id)
      .eq("integration_id", integration.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId),
    supabaseService
      .from("outreach_enrolments")
      .update({ status: "completed", next_action_at: null, updated_at: now })
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("prospect_id", prospectId)
      .in("status", ["queued", "researched", "drafted", "approved", "contacted", "paused"]),
    supabaseService
      .from("outreach_messages")
      .update({ status: "cancelled", scheduled_at: null, updated_at: now })
      .eq("workspace_id", scope.workspaceId)
      .eq("sender_user_id", scope.userId)
      .eq("prospect_id", prospectId)
      .in("status", ["draft", "approved"]),
  ]);
  const localError = results.find((result) => result.error)?.error;
  if (localError) {
    throw Object.assign(
      new Error(
        "SendPilot confirmed the lead stop, but LiveCoach could not finish its local update"
      ),
      {
        status: 409,
        code: "sendpilot_stop_local_update_failed",
        nextAction:
          "Refresh the prospect to reconcile SendPilot before preparing another action",
      }
    );
  }
  const { data: existingEvent, error: existingEventError } = await supabaseService
    .from("outreach_events")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .contains("metadata", { source: "brain", requestId })
    .limit(1)
    .maybeSingle();
  if (existingEventError) throw existingEventError;
  if (!existingEvent) {
    const { error } = await supabaseService.from("outreach_events").insert({
      workspace_id: scope.workspaceId,
      owner_id: scope.userId,
      visibility: "team",
      campaign_id: link.livecoach_campaign_id,
      prospect_id: prospectId,
      kind: "sendpilot_status",
      metadata: {
        source: "brain",
        provider: "sendpilot",
        requestId,
        action: "stop_lead",
        sendpilotLeadId: link.sendpilot_lead_id,
      },
      created_at: now,
    });
    if (error) throw error;
  }
  await writeAudit(scope, {
    action: "sendpilot_lead_stopped",
    targetTable: "sendpilot_lead_links",
    targetId: link.id,
    previous: { externalStatus: link.external_status, syncStatus: link.sync_status },
    next: { externalStatus: remote.status, syncStatus: "completed" },
  });
  return {
    alreadyStopped: false,
    leadId: remote.leadId,
    status: remote.status,
    prospect: {
      id: prospect.id,
      name: `${prospect.first_name || ""} ${prospect.last_name || ""}`.trim(),
    },
  };
}

export async function controlSendPilotCampaign(
  scope: OwnerScope,
  input: {
    livecoachCampaignId: unknown;
    action: unknown;
    requestId: unknown;
    confirmed: unknown;
  }
) {
  const livecoachCampaignId = clean(input.livecoachCampaignId, 80);
  const requestId = clean(input.requestId, 80);
  const action = clean(input.action, 20);
  if (
    !UUID.test(livecoachCampaignId) ||
    !UUID.test(requestId) ||
    !["pause", "resume"].includes(action) ||
    input.confirmed !== true
  ) {
    throw Object.assign(
      new Error("Confirm one exact mapped SendPilot campaign and action"),
      { status: 400 }
    );
  }
  const integration = await requireActiveIntegration(scope);
  const { data: mapping, error: mappingError } = await supabaseService
    .from("sendpilot_campaign_links")
    .select("*")
    .eq("integration_id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("livecoach_campaign_id", livecoachCampaignId)
    .maybeSingle();
  if (mappingError) throw mappingError;
  if (!mapping) {
    throw Object.assign(
      new Error("This campaign is not mapped to your SendPilot account"),
      { status: 404 }
    );
  }
  const alreadyInState =
    (action === "pause" && mapping.sendpilot_campaign_status === "paused") ||
    (action === "resume" && mapping.sendpilot_campaign_status === "started");
  if (alreadyInState) {
    return { alreadyApplied: true, action, mapping };
  }
  const apiKey = decryptSendPilotApiKey(integration);
  const remote = await updateSendPilotCampaign(apiKey, {
    campaignId: mapping.sendpilot_campaign_id,
    action: action as "pause" | "resume",
  });
  const normalisedStatus = action === "pause" ? "paused" : "started";
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseService
    .from("sendpilot_campaign_links")
    .update({
      sendpilot_campaign_status: normalisedStatus,
      active: action === "resume",
      last_refreshed_at: now,
      updated_at: now,
    })
    .eq("id", mapping.id)
    .eq("integration_id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .select("*")
    .single();
  if (updateError) {
    throw Object.assign(
      new Error(
        `SendPilot confirmed the campaign ${action}, but LiveCoach could not finish its local update`
      ),
      {
        status: 409,
        code: "sendpilot_campaign_local_update_failed",
        nextAction:
          "Refresh the SendPilot campaign mapping before preparing another action",
      }
    );
  }
  await writeAudit(scope, {
    action: `sendpilot_campaign_${action}d`,
    targetTable: "sendpilot_campaign_links",
    targetId: mapping.id,
    previous: {
      status: mapping.sendpilot_campaign_status,
      active: mapping.active,
    },
    next: { status: normalisedStatus, active: action === "resume", requestId },
  });
  return {
    alreadyApplied: false,
    action,
    remoteStatus: remote.newStatus,
    mapping: updated,
  };
}

async function findExactSendPilotLead(
  apiKey: string,
  campaignId: string,
  profileUrl: string
): Promise<SendPilotLead | null> {
  const matches: SendPilotLead[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await listSendPilotLeads(apiKey, {
      campaignId,
      page,
      limit: 100,
    });
    matches.push(
      ...result.leads.filter(
        (lead) => normaliseLinkedInProfileUrl(lead.linkedinUrl) === profileUrl
      )
    );
    if (page >= result.totalPages) break;
  }
  const ids = [...new Set(matches.map((lead) => lead.id))];
  if (ids.length > 1) {
    throw new SendPilotApiError(
      "SendPilot returned more than one exact lead for this LinkedIn profile",
      409,
      null
    );
  }
  return matches[0] || null;
}

async function updateLeadLink(
  integration: SendPilotIntegrationRow,
  linkId: string,
  values: Record<string, unknown>
): Promise<SendPilotLeadLink> {
  const { data, error } = await supabaseService
    .from("sendpilot_lead_links")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("integration_id", integration.id)
    .eq("workspace_id", integration.workspace_id)
    .eq("owner_id", integration.owner_id)
    .select(LEAD_LINK_SELECT)
    .single();
  if (error) throw error;
  return data as SendPilotLeadLink;
}

export async function enrolProspectInSendPilot(
  scope: OwnerScope,
  prospectId: string,
  input: {
    requestId: unknown;
    enrolmentId: unknown;
    confirmed: unknown;
    ownerOverride?: boolean;
  }
) {
  const requestId = clean(input.requestId, 80);
  const enrolmentId = clean(input.enrolmentId, 80);
  if (!UUID.test(requestId) || !UUID.test(enrolmentId)) {
    throw Object.assign(new Error("A valid SendPilot approval request is required"), {
      status: 400,
    });
  }
  if (input.confirmed !== true) {
    throw Object.assign(
      new Error("Confirm this exact prospect before adding them to SendPilot"),
      { status: 400 }
    );
  }
  const integration = await requireActiveIntegration(scope);
  if (!integration.webhook_secret_ciphertext) {
    throw Object.assign(
      new Error("Finish the SendPilot webhook setup before sending leads"),
      { status: 409 }
    );
  }

  const { data: idempotent, error: idempotentError } = await supabaseService
    .from("sendpilot_lead_links")
    .select(LEAD_LINK_SELECT)
    .eq("integration_id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("enrollment_request_id", requestId)
    .maybeSingle();
  if (idempotentError) throw idempotentError;
  if (idempotent) {
    return { alreadySubmitted: true, link: idempotent as SendPilotLeadLink };
  }

  const [prospectResult, enrolmentResult] = await Promise.all([
    supabaseAdmin
      .from("outreach_prospects")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", prospectId)
      .maybeSingle(),
    supabaseAdmin
      .from("outreach_enrolments")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("id", enrolmentId)
      .eq("prospect_id", prospectId)
      .maybeSingle(),
  ]);
  if (prospectResult.error) throw prospectResult.error;
  if (enrolmentResult.error) throw enrolmentResult.error;
  const prospect = prospectResult.data;
  const enrolment = enrolmentResult.data;
  if (!prospect || !enrolment) {
    throw Object.assign(new Error("This SendPilot action is no longer available"), {
      status: 404,
    });
  }
  if (prospect.assigned_to_user_id !== scope.userId) {
    throw Object.assign(new Error("This prospect is assigned to another team member"), {
      status: 403,
    });
  }
  if (
    prospect.last_reply_at ||
    ["replied", "qualified", "not_interested", "suppressed"].includes(prospect.status) ||
    ["replied", "booked", "completed", "paused", "suppressed"].includes(enrolment.status)
  ) {
    throw Object.assign(
      new Error("This prospect replied or is no longer eligible for outreach"),
      { status: 409 }
    );
  }

  const profileUrl = normaliseLinkedInProfileUrl(prospect.person_linkedin_url);
  if (!profileUrl) {
    throw Object.assign(
      new Error("Save the prospect's exact LinkedIn profile URL before using SendPilot"),
      { status: 400 }
    );
  }
  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from("outreach_campaigns")
    .select("id,name,status,approval_mode,daily_limit,sequence")
    .eq("workspace_id", scope.workspaceId)
    .eq("id", enrolment.campaign_id)
    .maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign || campaign.status !== "active" || campaign.approval_mode !== true) {
    throw Object.assign(
      new Error("The LiveCoach campaign must be active and approval-led"),
      { status: 409 }
    );
  }
  const step = outreachSequenceStepAt(campaign.sequence, Number(enrolment.current_step) || 1);
  if (step?.channel !== "linkedin") {
    throw Object.assign(
      new Error("SendPilot can only take over when the current campaign step is LinkedIn"),
      { status: 409 }
    );
  }
  if (
    enrolment.next_action_at &&
    new Date(enrolment.next_action_at).getTime() > Date.now()
  ) {
    throw Object.assign(new Error("This LinkedIn step is not due yet"), {
      status: 409,
    });
  }

  const { data: mapping, error: mappingError } = await supabaseService
    .from("sendpilot_campaign_links")
    .select("*")
    .eq("integration_id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("livecoach_campaign_id", campaign.id)
    .eq("active", true)
    .maybeSingle();
  if (mappingError) throw mappingError;
  if (!mapping || mapping.sendpilot_campaign_status !== "started") {
    throw Object.assign(
      new Error("Map this LiveCoach campaign to a running SendPilot campaign first"),
      { status: 409 }
    );
  }
  const apiKey = decryptSendPilotApiKey(integration);
  const remoteCampaign = (await listSendPilotCampaigns(apiKey)).find(
    (candidate) => candidate.id === mapping.sendpilot_campaign_id
  );
  if (!remoteCampaign || remoteCampaign.status !== "started") {
    const now = new Date().toISOString();
    const { error: staleMappingError } = await supabaseService
      .from("sendpilot_campaign_links")
      .update({
        active: false,
        ...(remoteCampaign
          ? {
              sendpilot_campaign_name: remoteCampaign.name,
              sendpilot_campaign_status: remoteCampaign.status,
            }
          : {}),
        last_refreshed_at: now,
        updated_at: now,
      })
      .eq("id", mapping.id)
      .eq("integration_id", integration.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId);
    if (staleMappingError) throw staleMappingError;
    throw Object.assign(
      new Error("The mapped SendPilot campaign is no longer running"),
      { status: 409 }
    );
  }
  if (remoteCampaign.name !== mapping.sendpilot_campaign_name) {
    const refreshedAt = new Date().toISOString();
    const { error: refreshMappingError } = await supabaseService
      .from("sendpilot_campaign_links")
      .update({
        sendpilot_campaign_name: remoteCampaign.name,
        sendpilot_campaign_status: remoteCampaign.status,
        active: true,
        last_refreshed_at: refreshedAt,
        updated_at: refreshedAt,
      })
      .eq("id", mapping.id)
      .eq("integration_id", integration.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId);
    if (refreshMappingError) throw refreshMappingError;
  }

  const email = clean(prospect.email, 320).toLowerCase();
  const domain = clean(prospect.company_domain, 320).toLowerCase() || emailDomain(email);
  const [{ data: blocked }, crmGuard, { data: otherEnrolments, error: otherError }] =
    await Promise.all([
      supabaseAdmin
        .from("outreach_suppressions")
        .select("target")
        .eq("workspace_id", scope.workspaceId)
        .in("target", [email, domain].filter(Boolean)),
      outreachCrmGuard(),
      supabaseAdmin
        .from("outreach_enrolments")
        .select("id,campaign_id,status,last_sent_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("recipient_email", email)
        .neq("campaign_id", campaign.id),
    ]);
  if (otherError) throw otherError;
  if (blocked?.length) {
    throw Object.assign(new Error("This person or company is on the do not contact list"), {
      status: 409,
    });
  }
  if (prospectHasBlockedCrmRelationship(prospect, crmGuard)) {
    if (!input.ownerOverride) {
      throw sendPilotBlock(
        "outreach_crm_relationship_ineligible",
        "This CRM relationship is engaged, dormant or not confirmed as a new lead"
      );
    }
  }
  const otherActiveEnrolment = (otherEnrolments || []).find((row: any) =>
    isActiveOutreachEnrolmentStatus(row.status)
  );
  if (otherActiveEnrolment && !input.ownerOverride) {
    throw sendPilotBlock(
      otherActiveEnrolment.status === "paused"
        ? "outreach_paused_campaign_enrolment"
        : "outreach_existing_campaign_enrolment",
      otherActiveEnrolment.status === "paused"
        ? "This person is still enrolled in a paused LiveCoach campaign"
        : "This person is already active in another LiveCoach campaign"
    );
  }
  if (
    !input.ownerOverride &&
    (otherEnrolments || []).some((row: any) =>
      isInsideCrossCampaignCooldown(row.last_sent_at)
    )
  ) {
    throw sendPilotBlock(
      "outreach_cross_campaign_cooldown",
      "This person is still inside the 30 day cross-campaign safety pause"
    );
  }

  const { start, end } = londonDayBounds();
  const { count: enrolledToday, error: dailyError } = await supabaseService
    .from("sendpilot_lead_links")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .gte("enrolled_at", start)
    .lt("enrolled_at", end);
  if (dailyError) throw dailyError;
  const dailyLimit = clampOutreachDailyLimit(campaign.daily_limit);
  if ((enrolledToday || 0) >= dailyLimit) {
    throw Object.assign(
      new Error(`Your SendPilot handoff limit of ${dailyLimit} leads has been reached today`),
      { status: 429 }
    );
  }

  const { data: existingLink, error: existingLinkError } = await supabaseService
    .from("sendpilot_lead_links")
    .select(LEAD_LINK_SELECT)
    .eq("integration_id", integration.id)
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("outreach_enrolment_id", enrolment.id)
    .maybeSingle();
  if (existingLinkError) throw existingLinkError;
  if (existingLink && existingLink.sync_status !== "failed") {
    return { alreadySubmitted: true, link: existingLink as SendPilotLeadLink };
  }

  const workspaceConflict = await activeSendPilotConflictForProspect({
    workspaceId: scope.workspaceId,
    prospectId: prospect.id,
    email,
    linkedinUrl: profileUrl,
    excludeLinkId: existingLink?.id || null,
  });
  if (workspaceConflict) {
    throw Object.assign(
      new Error(
        "This person is already tracked by a SendPilot account in this workspace"
      ),
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const claimValues = {
    integration_id: integration.id,
    campaign_link_id: mapping.id,
    workspace_id: scope.workspaceId,
    owner_id: scope.userId,
    visibility: "private",
    outreach_prospect_id: prospect.id,
    outreach_enrolment_id: enrolment.id,
    livecoach_campaign_id: campaign.id,
    sendpilot_campaign_id: mapping.sendpilot_campaign_id,
    sendpilot_campaign_name: remoteCampaign.name,
    sendpilot_lead_id: null,
    linkedin_url: profileUrl,
    email: email || null,
    enrollment_request_id: requestId,
    sync_status: "submitting",
    external_status: null,
    last_event_type: null,
    enrolled_at: null,
    last_error: null,
    updated_at: now,
  };
  const claimQuery = existingLink
    ? supabaseService
        .from("sendpilot_lead_links")
        .update(claimValues)
        .eq("id", existingLink.id)
        .eq("sync_status", "failed")
    : supabaseService.from("sendpilot_lead_links").insert(claimValues);
  const { data: claimed, error: claimError } = await claimQuery
    .select(LEAD_LINK_SELECT)
    .maybeSingle();
  if (claimError?.code === "23505") {
    throw Object.assign(
      new Error(
        "This LinkedIn profile or email is already tracked by SendPilot in this workspace"
      ),
      { status: 409 }
    );
  }
  if (claimError) throw claimError;
  if (!claimed) {
    throw Object.assign(new Error("Another SendPilot handoff is already in progress"), {
      status: 409,
    });
  }

  const finalise = async (lead: SendPilotLead | null, duplicated: boolean) => {
    const completedAt = new Date().toISOString();
    const link = await updateLeadLink(integration, claimed.id, {
      sendpilot_lead_id: lead?.id || null,
      sync_status: "queued",
      external_status: lead?.status || "PENDING",
      custom_lead_status: lead?.customLeadStatus || null,
      enrolled_at: completedAt,
      last_error: null,
    });
    const eventMetadata = {
      requestId,
      provider: "sendpilot",
      sendpilotCampaignId: mapping.sendpilot_campaign_id,
      sendpilotCampaignName: remoteCampaign.name,
      sendpilotLeadId: lead?.id || null,
      duplicated,
      approvedBy: scope.userId,
    };
    const { data: existingEvent, error: existingEventError } = await supabaseService
      .from("outreach_events")
      .select("id")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("kind", "linkedin_enrolled")
      .contains("metadata", { provider: "sendpilot", requestId })
      .limit(1)
      .maybeSingle();
    if (existingEventError) throw existingEventError;
    let outreachEventId = existingEvent?.id || null;
    if (!outreachEventId) {
      const { data: event, error: eventError } = await supabaseService
        .from("outreach_events")
        .insert({
          workspace_id: scope.workspaceId,
          owner_id: scope.userId,
          visibility: "team",
          campaign_id: campaign.id,
          prospect_id: prospect.id,
          kind: "linkedin_enrolled",
          metadata: eventMetadata,
          created_at: completedAt,
        })
        .select("id")
        .single();
      if (eventError?.code === "23505") {
        const { data: racedEvent, error: racedEventError } = await supabaseService
          .from("outreach_events")
          .select("id")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .eq("kind", "linkedin_enrolled")
          .contains("metadata", { provider: "sendpilot", requestId })
          .limit(1)
          .maybeSingle();
        if (racedEventError) throw racedEventError;
        outreachEventId = racedEvent?.id || null;
      } else if (eventError) {
        throw eventError;
      } else {
        outreachEventId = event.id;
      }
    }
    if (!outreachEventId) throw new Error("The SendPilot audit event was not confirmed");
    const { error: enrolmentUpdateError } = await supabaseService
      .from("outreach_enrolments")
      .update({ status: "queued", next_action_at: null, updated_at: completedAt })
      .eq("id", enrolment.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("prospect_id", prospect.id)
      .in("status", ["queued", "contacted"]);
    if (enrolmentUpdateError) throw enrolmentUpdateError;
    await pauseLiveCoachEmailOutreachForSendPilot({
      workspaceId: scope.workspaceId,
      prospectId: prospect.id,
      keepEnrolmentId: enrolment.id,
      reason: `Paused because SendPilot owns this contact in ${remoteCampaign.name}`,
    });
    await writeAudit(scope, {
      action: "sendpilot_lead_enrolled",
      targetTable: "sendpilot_lead_links",
      targetId: link.id,
      next: {
        prospectId: prospect.id,
        campaignId: campaign.id,
        sendpilotCampaignId: mapping.sendpilot_campaign_id,
      },
    });
    return { alreadySubmitted: false, link, outreachEventId };
  };

  try {
    const result = await addSendPilotLeads(apiKey, {
      campaignId: mapping.sendpilot_campaign_id,
      leads: [{
        linkedinUrl: profileUrl,
        firstName: clean(prospect.first_name, 120) || undefined,
        lastName: clean(prospect.last_name, 120) || undefined,
        email: email || undefined,
        company: clean(prospect.company_name, 240) || undefined,
        title: clean(prospect.job_title, 240) || undefined,
        livecoachProspectId: prospect.id,
        livecoachEnrolmentId: enrolment.id,
        livecoachCampaignId: campaign.id,
        leadSource: "LiveCoach approved outreach",
      }],
    });
    if (result.invalidEntries || (!result.leadsAdded && !result.duplicatesSkipped)) {
      const reason = result.errors[0]?.reason || "SendPilot rejected this lead";
      await updateLeadLink(integration, claimed.id, {
        sync_status: "failed",
        last_error: reason,
      });
      throw Object.assign(new Error(reason), { status: 400 });
    }
    let lead: SendPilotLead | null = null;
    try {
      lead = await findExactSendPilotLead(
        apiKey,
        mapping.sendpilot_campaign_id,
        profileUrl
      );
    } catch {
      // The POST response already confirmed either an addition or an exact
      // duplicate. Lead-ID enrichment is useful, but it is not a reason to
      // turn a confirmed handoff into an uncertain operation.
    }
    return await finalise(lead, result.duplicatesSkipped > 0);
  } catch (error: any) {
    if (Number(error?.status) === 400) throw error;
    try {
      const lead = await findExactSendPilotLead(
        apiKey,
        mapping.sendpilot_campaign_id,
        profileUrl
      );
      if (lead) return await finalise(lead, true);
    } catch {
      // The original request may have reached SendPilot. Never retry an
      // ambiguous external side effect automatically.
    }
    const ambiguous =
      !(error instanceof SendPilotApiError) ||
      [429, 502, 503, 504].includes(Number(error.status));
    await updateLeadLink(integration, claimed.id, {
      sync_status: ambiguous ? "pending_confirmation" : "failed",
      last_error: safeError(error),
    });
    if (ambiguous) {
      throw Object.assign(
        new Error(
          "SendPilot did not confirm the handoff. LiveCoach will not retry it automatically, which prevents a duplicate lead."
        ),
        { status: 502 }
      );
    }
    throw error;
  }
}

async function exactAssignedProspect(
  integration: SendPilotIntegrationRow,
  profileUrl: string
) {
  const path = new URL(profileUrl).pathname;
  const escaped = path.replace(/[\\%_]/g, (value) => `\\${value}`);
  const { data, error } = await supabaseService
    .from("outreach_prospects")
    .select("*")
    .eq("workspace_id", integration.workspace_id)
    .eq("assigned_to_user_id", integration.owner_id)
    .ilike("person_linkedin_url", `%${escaped}%`)
    .limit(100);
  if (error) throw error;
  const exact = (data || []).filter(
    (prospect: any) =>
      normaliseStoredLinkedInProfileUrl(prospect.person_linkedin_url) === profileUrl
  );
  return exact.length === 1 ? exact[0] : null;
}

async function loadEventLeadLink(
  integration: SendPilotIntegrationRow,
  event: SendPilotWebhookEvent,
  profileUrl: string
): Promise<SendPilotLeadLink | null> {
  const { data: byLead, error: byLeadError } = await supabaseService
    .from("sendpilot_lead_links")
    .select(LEAD_LINK_SELECT)
    .eq("integration_id", integration.id)
    .eq("workspace_id", integration.workspace_id)
    .eq("owner_id", integration.owner_id)
    .eq("sendpilot_lead_id", event.data.leadId)
    .maybeSingle();
  if (byLeadError) throw byLeadError;
  if (byLead) {
    if (
      byLead.sendpilot_campaign_id !== event.data.campaignId ||
      byLead.linkedin_url !== profileUrl
    ) {
      throw new Error("SendPilot lead identity changed outside LiveCoach");
    }
    return byLead as SendPilotLeadLink;
  }

  // lead.updated has no senderId. Without a pre-existing owner-scoped link it
  // cannot be attributed safely, so it fails closed instead of URL guessing.
  if (event.eventType === "lead.updated") return null;

  const { data: byUrl, error: byUrlError } = await supabaseService
    .from("sendpilot_lead_links")
    .select(LEAD_LINK_SELECT)
    .eq("integration_id", integration.id)
    .eq("workspace_id", integration.workspace_id)
    .eq("owner_id", integration.owner_id)
    .eq("sendpilot_campaign_id", event.data.campaignId)
    .eq("linkedin_url", profileUrl)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byUrlError) throw byUrlError;
  if (byUrl) {
    return await updateLeadLink(integration, byUrl.id, {
      sendpilot_lead_id: event.data.leadId,
    });
  }

  const prospect = await exactAssignedProspect(integration, profileUrl);
  if (!prospect) return null;
  const { data: mapping, error: mappingError } = await supabaseService
    .from("sendpilot_campaign_links")
    .select("*")
    .eq("integration_id", integration.id)
    .eq("workspace_id", integration.workspace_id)
    .eq("owner_id", integration.owner_id)
    .eq("sendpilot_campaign_id", event.data.campaignId)
    .maybeSingle();
  if (mappingError) throw mappingError;
  const { data: enrolment, error: enrolmentError } = mapping
    ? await supabaseService
        .from("outreach_enrolments")
        .select("id,campaign_id")
        .eq("workspace_id", integration.workspace_id)
        .eq("prospect_id", prospect.id)
        .eq("campaign_id", mapping.livecoach_campaign_id)
        .maybeSingle()
    : { data: null, error: null };
  if (enrolmentError) throw enrolmentError;
  const now = new Date().toISOString();
  const { data: created, error: createError } = await supabaseService
    .from("sendpilot_lead_links")
    .insert({
      integration_id: integration.id,
      campaign_link_id: mapping?.id || null,
      workspace_id: integration.workspace_id,
      owner_id: integration.owner_id,
      visibility: "private",
      outreach_prospect_id: prospect.id,
      outreach_enrolment_id: enrolment?.id || null,
      livecoach_campaign_id: mapping?.livecoach_campaign_id || null,
      sendpilot_campaign_id: event.data.campaignId,
      sendpilot_campaign_name: mapping?.sendpilot_campaign_name || null,
      sendpilot_lead_id: event.data.leadId,
      linkedin_url: profileUrl,
      sync_status: event.eventType === "reply.received" ? "replied" : "active",
      enrolled_at: event.timestamp,
      last_event_at: event.timestamp,
      last_event_type: event.eventType,
      created_at: now,
      updated_at: now,
    })
    .select(LEAD_LINK_SELECT)
    .single();
  if (createError?.code === "23505") {
    const { data: raced, error: racedError } = await supabaseService
      .from("sendpilot_lead_links")
      .select(LEAD_LINK_SELECT)
      .eq("integration_id", integration.id)
      .eq("workspace_id", integration.workspace_id)
      .eq("owner_id", integration.owner_id)
      .eq("linkedin_url", profileUrl)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (racedError) throw racedError;
    return (raced as SendPilotLeadLink | null) || null;
  }
  if (createError) throw createError;
  return created as SendPilotLeadLink;
}

type LinkedInReplyClassification = {
  category: ReplyAttentionCategory;
  summary: string;
  prospectStatus: string;
  enrolmentStatus: string;
  eventKind: string;
  suppress: boolean;
};

function classifyLinkedInReply(text: string): LinkedInReplyClassification {
  const lower = text.toLowerCase();
  if (/unsubscribe|remove me|do not contact|don't contact|stop messaging|opt out/.test(lower)) {
    return {
      category: "unsubscribe",
      summary: "Asked not to receive further outreach.",
      prospectStatus: "suppressed",
      enrolmentStatus: "suppressed",
      eventKind: "unsubscribe",
      suppress: true,
    };
  }
  if (/not interested|no thanks|not for (me|us)|please don't|please do not/.test(lower)) {
    return {
      category: "irrelevant",
      summary: "Not interested in further outreach.",
      prospectStatus: "suppressed",
      enrolmentStatus: "suppressed",
      eventKind: "reply",
      suppress: true,
    };
  }
  if (/book|calendar|demo|interested|sounds good|tell me more|let's talk|lets talk|schedule/.test(lower)) {
    return {
      category: "interested",
      summary: "Positive LinkedIn response that may lead to a conversation.",
      prospectStatus: "qualified",
      enrolmentStatus: "replied",
      eventKind: "positive_reply",
      suppress: false,
    };
  }
  if (/speak to|contact my|introduce you|colleague|right person/.test(lower)) {
    return {
      category: "referral",
      summary: "LinkedIn reply may contain a referral to another person.",
      prospectStatus: "replied",
      enrolmentStatus: "replied",
      eventKind: "referral",
      suppress: false,
    };
  }
  if (/later|next month|next quarter|not now|circle back|come back/.test(lower)) {
    return {
      category: "later",
      summary: "Asked to revisit the conversation later.",
      prospectStatus: "replied",
      enrolmentStatus: "replied",
      eventKind: "later",
      suppress: false,
    };
  }
  if (/budget|price|cost|already use|not a priority|concern/.test(lower)) {
    return {
      category: "objection",
      summary: "LinkedIn reply contains a possible objection.",
      prospectStatus: "replied",
      enrolmentStatus: "replied",
      eventKind: "objection",
      suppress: false,
    };
  }
  return {
    category: "unclassified",
    summary: "LinkedIn reply received through SendPilot.",
    prospectStatus: "replied",
    enrolmentStatus: "replied",
    eventKind: "reply",
    suppress: false,
  };
}

async function applySendPilotReplyConsequences(
  integration: SendPilotIntegrationRow,
  prospect: any,
  input: {
    reply: string;
    receivedAt: string;
    replyThreadId: string;
    classification: ReturnType<typeof classifyLinkedInReply>;
  }
) {
  const currentReplyMs = new Date(prospect.last_reply_at || 0).getTime();
  const incomingReplyMs = new Date(input.receivedAt).getTime();
  if (
    !Number.isFinite(currentReplyMs) ||
    currentReplyMs < incomingReplyMs ||
    (currentReplyMs === incomingReplyMs && !prospect.last_reply_text)
  ) {
    const { error: updateError } = await supabaseService
      .from("outreach_prospects")
      .update({
        status: input.classification.prospectStatus,
        last_reply_at: input.receivedAt,
        reply_category: input.classification.category,
        reply_summary: input.classification.summary,
        last_reply_text: input.reply.slice(0, 4_000),
        reply_thread_id: input.replyThreadId,
        next_action_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", integration.workspace_id)
      .eq("assigned_to_user_id", integration.owner_id)
      .eq("id", prospect.id);
    if (updateError) throw updateError;
  }

  const related = await Promise.all([
    supabaseService
      .from("outreach_enrolments")
      .update({
        status: input.classification.enrolmentStatus,
        replied_at: input.receivedAt,
        next_action_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", integration.workspace_id)
      .eq("prospect_id", prospect.id)
      .in("status", ["queued", "researched", "drafted", "approved", "contacted", "paused"]),
    supabaseService
      .from("outreach_messages")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("workspace_id", integration.workspace_id)
      .eq("prospect_id", prospect.id)
      .in("status", ["draft", "approved"]),
  ]);
  const relatedError = related.find((result) => result.error)?.error;
  if (relatedError) throw relatedError;
  if (input.classification.suppress && prospect.email) {
    const { error: suppressionError } = await supabaseService
      .from("outreach_suppressions")
      .upsert({
        workspace_id: integration.workspace_id,
        owner_id: integration.owner_id,
        visibility: "team",
        target: String(prospect.email).trim().toLowerCase(),
        kind: "email",
        reason: input.classification.summary,
        source: "sendpilot_reply",
      });
    if (suppressionError) throw suppressionError;
  }
}

async function ensureSendPilotReplyTask(
  integration: SendPilotIntegrationRow,
  prospect: any,
  classification: ReturnType<typeof classifyLinkedInReply>,
  sourceRef: string,
  receivedAt: string
) {
  await ensureReplyAttentionTask({
    workspaceId: integration.workspace_id,
    userId: integration.owner_id,
    companyId: UUID.test(String(prospect.crm_company_id || ""))
      ? String(prospect.crm_company_id)
      : null,
    prospectId: String(prospect.id),
    prospectName: [prospect.first_name, prospect.last_name]
      .map((value: unknown) => clean(value, 100))
      .filter(Boolean)
      .join(" "),
    companyName: clean(prospect.company_name, 160),
    channel: "linkedin",
    category: classification.category,
    summary: classification.summary,
    sourceRef,
    receivedAt,
  });
}

async function prepareInterestedReplyPackage(
  integration: SendPilotIntegrationRow,
  prospect: any,
  receivedAt: string
) {
  const scope = {
    userId: integration.owner_id,
    workspaceId: integration.workspace_id,
  };
  return runWithServiceRecordScope(scope, async () => {
    const taskCreated = true;
    let draftPrepared = false;
    const errors: string[] = [];
    try {
      await preparePositiveReplyForApproval(scope, prospect.id);
      draftPrepared = true;
    } catch (error: any) {
      errors.push(`draft: ${safeError(error)}`);
    }
    if (errors.length) {
      const { error } = await supabaseService.from("outreach_events").insert({
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        visibility: "private",
        prospect_id: prospect.id,
        kind: "failed",
        metadata: {
          source: "sendpilot_positive_reply_package",
          receivedAt,
          errors,
          taskCreated,
          draftPrepared,
        },
      });
      if (error) console.error("Positive reply package audit failed", error.message);
    }
    return { taskCreated, draftPrepared, errors };
  });
}

async function insertOutreachEvent(
  integration: SendPilotIntegrationRow,
  link: SendPilotLeadLink,
  event: SendPilotWebhookEvent,
  kind: string,
  metadata: Record<string, unknown>
) {
  const { data, error } = await supabaseService
    .from("outreach_events")
    .insert({
      workspace_id: integration.workspace_id,
      owner_id: integration.owner_id,
      visibility: "team",
      campaign_id: link.livecoach_campaign_id,
      prospect_id: link.outreach_prospect_id,
      kind,
      metadata: {
        provider: "sendpilot",
        providerEventId: event.eventId,
        sendpilotLeadId: event.data.leadId,
        sendpilotCampaignId: event.data.campaignId,
        linkedinUrl: link.linkedin_url,
        ...metadata,
      },
      created_at: event.timestamp,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: existing, error: existingError } = await supabaseService
      .from("outreach_events")
      .select("id,kind,prospect_id")
      .eq("workspace_id", integration.workspace_id)
      .eq("owner_id", integration.owner_id)
      .contains("metadata", {
        provider: "sendpilot",
        providerEventId: event.eventId,
      })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (
      existing &&
      existing.kind === kind &&
      existing.prospect_id === link.outreach_prospect_id
    ) {
      return existing.id as string;
    }
  }
  if (error) throw error;
  return data.id as string;
}

export async function recordSendPilotReplyInCrm(
  integration: SendPilotIntegrationRow,
  event: Extract<SendPilotWebhookEvent, { eventType: "reply.received" }>,
  linkedInboxMessageId: string | null,
  providerMessageId: string
) {
  const profileUrl = normaliseLinkedInProfileUrl(event.data.linkedinUrl);
  if (!profileUrl) throw new Error("SendPilot reply has an invalid LinkedIn identity");
  const link = await loadEventLeadLink(integration, event, profileUrl);
  if (!link) return { leadLinkId: null, outreachEventId: null };
  const classification = classifyLinkedInReply(event.data.reply);
  const { data: prospect, error: prospectError } = await supabaseService
    .from("outreach_prospects")
    .select(
      "id,email,first_name,last_name,company_name,crm_company_id,last_reply_at,last_reply_text,status"
    )
    .eq("workspace_id", integration.workspace_id)
    .eq("assigned_to_user_id", integration.owner_id)
    .eq("id", link.outreach_prospect_id)
    .maybeSingle();
  if (prospectError) throw prospectError;
  if (!prospect) return { leadLinkId: link.id, outreachEventId: null };

  await applySendPilotReplyConsequences(integration, prospect, {
    reply: event.data.reply,
    receivedAt: event.timestamp,
    replyThreadId: `sendpilot:${event.data.leadId}`,
    classification,
  });
  const outreachEventId = await insertOutreachEvent(
    integration,
    link,
    event,
    classification.eventKind,
    {
      summary: classification.summary,
      replyCategory: classification.category,
      classificationSource: "deterministic_rules",
      linkedInboxMessageId,
      providerMessageId,
      receivedAt: event.timestamp,
      channel: "linkedin",
    }
  );
  await ensureSendPilotReplyTask(
    integration,
    prospect,
    classification,
    `sendpilot_reply:${providerMessageId}`,
    event.timestamp
  );
  await updateLeadLink(integration, link.id, {
    sync_status: classification.suppress ? "suppressed" : "replied",
    external_status: "REPLY_RECEIVED",
    last_event_type: event.eventType,
    last_event_at: event.timestamp,
    last_reply_at: event.timestamp,
    last_error: null,
  });
  const replyPackage =
    classification.category === "interested"
      ? await prepareInterestedReplyPackage(integration, prospect, event.timestamp)
      : null;
  return { leadLinkId: link.id, outreachEventId, replyPackage };
}

export async function recordSendPilotBackfillReplyInCrm(
  integration: SendPilotIntegrationRow,
  message: {
    messageId: string;
    conversationId: string;
    senderProfileUrl: string;
    body: string;
    receivedAt: string;
  },
  linkedInboxMessageId: string | null
) {
  const profileUrl = normaliseLinkedInProfileUrl(message.senderProfileUrl);
  if (!profileUrl) return { outreachEventId: null, matched: false };
  const prospect = await exactAssignedProspect(integration, profileUrl);
  if (!prospect) return { outreachEventId: null, matched: false };
  const classification = classifyLinkedInReply(message.body);
  const lastBackfillAt = new Date(integration.last_backfill_at || "").getTime();
  const receivedAt = new Date(message.receivedAt).getTime();
  // The first connector backfill establishes history without flooding Today
  // with old tasks or drafts. Later passes package only replies that arrived
  // after the last successful owner-scoped backfill.
  const isNewSinceLastBackfill =
    Number.isFinite(lastBackfillAt) &&
    Number.isFinite(receivedAt) &&
    receivedAt > lastBackfillAt;
  if (isNewSinceLastBackfill) {
    await ensureSendPilotReplyTask(
      integration,
      prospect,
      classification,
      `sendpilot_reply:${message.messageId}`,
      message.receivedAt
    );
  }

  const { data: existing, error: existingError } = await supabaseService
    .from("outreach_events")
    .select("id")
    .eq("workspace_id", integration.workspace_id)
    .eq("owner_id", integration.owner_id)
    .eq("prospect_id", prospect.id)
    .contains("metadata", {
      provider: "sendpilot",
      providerMessageId: message.messageId,
    })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const replyPackage =
      isNewSinceLastBackfill && classification.category === "interested"
        ? await prepareInterestedReplyPackage(
            integration,
            prospect,
            message.receivedAt
          )
        : null;
    return {
      outreachEventId: existing.id as string,
      matched: true,
      replyPackage,
    };
  }

  await applySendPilotReplyConsequences(integration, prospect, {
    reply: message.body,
    receivedAt: message.receivedAt,
    replyThreadId: `sendpilot:${message.conversationId}`,
    classification,
  });
  const { data: enrolment, error: enrolmentError } = await supabaseService
    .from("outreach_enrolments")
    .select("campaign_id")
    .eq("workspace_id", integration.workspace_id)
    .eq("prospect_id", prospect.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (enrolmentError) throw enrolmentError;
  const { data: created, error: createError } = await supabaseService
    .from("outreach_events")
    .insert({
      workspace_id: integration.workspace_id,
      owner_id: integration.owner_id,
      visibility: "team",
      campaign_id: enrolment?.campaign_id || null,
      prospect_id: prospect.id,
      kind: classification.eventKind,
      metadata: {
        provider: "sendpilot",
        providerMessageId: message.messageId,
        linkedInboxMessageId,
        linkedinUrl: profileUrl,
        summary: classification.summary,
        replyCategory: classification.category,
        classificationSource: "deterministic_rules",
        receivedAt: message.receivedAt,
        channel: "linkedin",
        source: "sendpilot_api",
      },
      created_at: message.receivedAt,
    })
    .select("id")
    .single();
  if (createError?.code === "23505") {
    const { data: raced, error: racedError } = await supabaseService
      .from("outreach_events")
      .select("id")
      .eq("workspace_id", integration.workspace_id)
      .eq("owner_id", integration.owner_id)
      .contains("metadata", {
        provider: "sendpilot",
        providerMessageId: message.messageId,
      })
      .limit(1)
      .maybeSingle();
    if (racedError) throw racedError;
    const replyPackage =
      isNewSinceLastBackfill && classification.category === "interested"
        ? await prepareInterestedReplyPackage(
            integration,
            prospect,
            message.receivedAt
          )
        : null;
    return {
      outreachEventId: raced?.id || null,
      matched: true,
      replyPackage,
    };
  }
  if (createError) throw createError;
  const replyPackage =
    isNewSinceLastBackfill && classification.category === "interested"
      ? await prepareInterestedReplyPackage(integration, prospect, message.receivedAt)
      : null;
  return {
    outreachEventId: created.id as string,
    matched: true,
    replyPackage,
  };
}

export async function recordSendPilotOperationalEvent(
  integration: SendPilotIntegrationRow,
  event: Exclude<SendPilotWebhookEvent, { eventType: "reply.received" }>
) {
  const profileUrl = normaliseLinkedInProfileUrl(event.data.linkedinUrl);
  if (!profileUrl) throw new Error("SendPilot event has an invalid LinkedIn identity");
  const link = await loadEventLeadLink(integration, event, profileUrl);
  if (!link) return { leadLinkId: null, outreachEventId: null };

  let kind = "sendpilot_status";
  let syncStatus = "active";
  let externalStatus: string | null = null;
  let lastMessageAt: string | null = null;
  let lastConnectionAt: string | null = null;
  let metadata: Record<string, unknown> = {};
  let markContacted = false;
  let markBooked = false;
  let markCompleted = false;
  let suppress = false;

  if (event.eventType === "message.sent") {
    kind = "linkedin_message_sent";
    externalStatus = "MESSAGE_SENT";
    lastMessageAt = event.timestamp;
    markContacted = true;
    metadata = {
      message: event.data.message,
      sequenceStep: event.data.sequenceStep,
      channel: "linkedin",
    };
  } else if (event.eventType === "connection_request.sent") {
    kind = "linkedin_connection_sent";
    externalStatus = "CONNECTION_SENT";
    lastConnectionAt = event.timestamp;
    markContacted = true;
    metadata = { note: event.data.note, channel: "linkedin" };
  } else if (event.eventType === "connection_request.accepted") {
    kind = "linkedin_connection_accepted";
    externalStatus = "CONNECTION_ACCEPTED";
    lastConnectionAt = event.data.acceptedAt;
    markContacted = true;
    metadata = { acceptedAt: event.data.acceptedAt, channel: "linkedin" };
  } else {
    externalStatus = event.data.newStatus;
    metadata = {
      previousStatus: event.data.previousStatus,
      newStatus: event.data.newStatus,
      channel: "linkedin",
    };
    if (["CONNECTION_SENT", "MESSAGE_SENT", "FOLLOWUP_SENT"].includes(event.data.newStatus)) {
      markContacted = true;
    }
    if (event.data.newStatus === "MEETING_BOOKED") {
      kind = "meeting_booked";
      markBooked = true;
      syncStatus = "completed";
    }
    if (["UNSUBSCRIBED", "NOT_INTERESTED", "WRONG_PERSON"].includes(event.data.newStatus)) {
      suppress = true;
      syncStatus = "suppressed";
    } else if (["DONE", "SUCCESS"].includes(event.data.newStatus)) {
      syncStatus = "completed";
      markCompleted = true;
    } else if (["FAILED", "PROFILE_UNREACHABLE"].includes(event.data.newStatus)) {
      syncStatus = "failed";
    }
  }

  const updates: PromiseLike<any>[] = [];
  if (markContacted) {
    updates.push(
      supabaseService
        .from("outreach_prospects")
        .update({
          status: "contacted",
          last_contacted_at: event.timestamp,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("assigned_to_user_id", integration.owner_id)
        .eq("id", link.outreach_prospect_id)
        .in("status", ["imported", "queued", "researching", "ready", "contacted"]),
      supabaseService
        .from("outreach_enrolments")
        .update({
          status: "contacted",
          last_sent_at: event.timestamp,
          next_action_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("id", link.outreach_enrolment_id || "00000000-0000-0000-0000-000000000000")
        .in("status", ["queued", "researched", "drafted", "approved", "contacted"])
    );
  }
  if (markBooked && link.outreach_enrolment_id) {
    updates.push(
      supabaseService
        .from("outreach_prospects")
        .update({
          status: "qualified",
          next_action_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("assigned_to_user_id", integration.owner_id)
        .eq("id", link.outreach_prospect_id)
        .in("status", ["imported", "queued", "researching", "ready", "contacted", "replied", "qualified"]),
      supabaseService
        .from("outreach_enrolments")
        .update({
          status: "booked",
          booked_at: event.timestamp,
          next_action_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("id", link.outreach_enrolment_id)
    );
  }
  if (markCompleted && link.outreach_enrolment_id) {
    updates.push(
      supabaseService
        .from("outreach_enrolments")
        .update({
          status: "completed",
          next_action_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("id", link.outreach_enrolment_id)
        .in("status", ["queued", "researched", "drafted", "approved", "contacted", "paused"])
    );
  }
  if (suppress) {
    const { data: suppressedProspect, error: suppressedProspectError } =
      await supabaseService
        .from("outreach_prospects")
        .select("email")
        .eq("workspace_id", integration.workspace_id)
        .eq("assigned_to_user_id", integration.owner_id)
        .eq("id", link.outreach_prospect_id)
        .maybeSingle();
    if (suppressedProspectError) throw suppressedProspectError;
    updates.push(
      supabaseService
        .from("outreach_prospects")
        .update({
          status: "suppressed",
          suppression_reason: `SendPilot status ${externalStatus}`,
          next_action_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("assigned_to_user_id", integration.owner_id)
        .eq("id", link.outreach_prospect_id),
      supabaseService
        .from("outreach_enrolments")
        .update({
          status: "suppressed",
          next_action_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", integration.workspace_id)
        .eq("prospect_id", link.outreach_prospect_id)
        .in("status", ["queued", "researched", "drafted", "approved", "contacted", "paused"]),
      supabaseService
        .from("outreach_messages")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("workspace_id", integration.workspace_id)
        .eq("prospect_id", link.outreach_prospect_id)
        .in("status", ["draft", "approved"])
    );
    if (suppressedProspect?.email) {
      updates.push(
        supabaseService.from("outreach_suppressions").upsert({
          workspace_id: integration.workspace_id,
          owner_id: integration.owner_id,
          visibility: "team",
          target: String(suppressedProspect.email).trim().toLowerCase(),
          kind: "email",
          reason: `SendPilot status ${externalStatus}`,
          source: "sendpilot_status",
        })
      );
    }
  }
  if (updates.length) {
    const results = await Promise.all(updates);
    const updateError = results.find((result: any) => result.error)?.error;
    if (updateError) throw updateError;
  }

  const outreachEventId = await insertOutreachEvent(
    integration,
    link,
    event,
    kind,
    metadata
  );
  await updateLeadLink(integration, link.id, {
    sync_status: syncStatus,
    external_status: externalStatus,
    last_event_type: event.eventType,
    last_event_at: event.timestamp,
    ...(lastMessageAt ? { last_message_at: lastMessageAt } : {}),
    ...(lastConnectionAt ? { last_connection_at: lastConnectionAt } : {}),
    last_error: syncStatus === "failed" ? `SendPilot status ${externalStatus}` : null,
  });
  return { leadLinkId: link.id, outreachEventId };
}
