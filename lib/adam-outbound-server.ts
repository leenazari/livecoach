import "server-only";

import { crmBlockerPayload, type CrmBlocker } from "@/lib/crm-blocker";
import {
  getAccessToken,
  googleHasScope,
  GOOGLE_SHEETS_SCOPE,
} from "@/lib/google";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { modelText, outreachCrmGuard, parseObject, prospectHasBlockedCrmRelationship } from "@/lib/outreach";
import { resolveOutreachIdentity } from "@/lib/outreach-identity";
import { readAdamSheet, writeAdamSheetCells } from "@/lib/adam-sheet";
import { supabaseAdmin } from "@/lib/supabase";
import { logModelUsage } from "@/lib/usage";
import {
  ADAM_CAMPAIGN_NAME,
  ADAM_CAMPAIGN_SLUG,
  adamDraftFacts,
  adamLinkedinKey,
  adamMetadataFromLead,
  adamOutboundPlaybook,
  adamSheetNote,
  adamSheetStatusLabel,
  adamSheetsBlocker,
  decideAdamLead,
  findAdamSheetRow,
  isAdamCampaign,
  leadFromProspect,
  mergeAdamMetadata,
  mergeStoredPlaybook,
  nextAdamProspectStatus,
  normaliseAdamEmail,
  parseAdamSheet,
  sheetCopyForAudience,
  validateAdamDraft,
  type AdamHold,
  type AdamLeadPlan,
  type AdamPlaybook,
  type AdamSheetLead,
} from "@/lib/adam-outbound";

type Actor = {
  userId: string;
  workspaceId: string;
  role: "owner" | "manager" | "sales";
};

type Blocked = { status: number; error: string; blocker: CrmBlocker };

export type AdamCampaignRecord = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  playbook: AdamPlaybook;
  storedPlaybookVersion: number;
  visibility: string;
};

function blocked(status: number, input: Parameters<typeof crmBlockerPayload>[0]): Blocked {
  return { status, ...crmBlockerPayload(input) };
}

function missingColumn(error: { message?: string; code?: string } | null) {
  const message = String(error?.message || "");
  return error?.code === "42703" || /slug|playbook/i.test(message) && /column|schema cache/i.test(message);
}

function missingFunction(error: { message?: string; code?: string } | null) {
  const message = String(error?.message || "");
  return (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    /adam_sendpilot_touches|lead_clash_check/i.test(message) && /does not exist|schema cache|could not find/i.test(message)
  );
}

export async function loadAdamCampaign(actor: Actor): Promise<
  | { ok: true; campaign: AdamCampaignRecord | null; migrationReady: boolean }
  | Blocked
> {
  const { data, error } = await supabaseAdmin
    .from("outreach_campaigns")
    .select("id,name,slug,status,playbook,visibility,workspace_id")
    .eq("workspace_id", actor.workspaceId)
    .eq("slug", ADAM_CAMPAIGN_SLUG)
    .maybeSingle();
  if (error) {
    if (missingColumn(error)) return { ok: true, campaign: null, migrationReady: false };
    console.error("Adam campaign lookup failed", error.message);
    return blocked(500, {
      code: "adam_campaign_unconfirmed",
      title: "Adam outbound could not be loaded",
      reason: "LiveCoach could not confirm whether the Adam outbound campaign exists.",
      nextAction: "Refresh Outreach. If it still fails, check that the Adam migration has been applied on this database.",
      responsible: "owner",
    });
  }
  if (!data) return { ok: true, campaign: null, migrationReady: true };
  return {
    ok: true,
    migrationReady: true,
    campaign: {
      id: data.id,
      name: data.name,
      slug: data.slug,
      status: data.status,
      visibility: data.visibility,
      playbook: mergeStoredPlaybook(data.playbook),
      storedPlaybookVersion: Number(data.playbook?.version) || 0,
    },
  };
}

export async function ensureAdamCampaign(actor: Actor): Promise<
  { ok: true; campaign: AdamCampaignRecord } | Blocked
> {
  const loaded = await loadAdamCampaign(actor);
  if ("blocker" in loaded) return loaded;
  if (!loaded.migrationReady) {
    return blocked(409, {
      code: "adam_migration_required",
      title: "The Adam outbound migration is not on this database",
      reason: "The campaign tag and sheet safety check are not installed yet, so nothing was imported or drafted.",
      nextAction: "Apply supabase/migrations/20261109120000_adam_outbound_campaign.sql on a preview database first. Do not apply it to production until Lee approves.",
      responsible: "owner",
    });
  }
  if (loaded.campaign) return upgradePlaybook(actor, loaded.campaign);
  if (actor.role === "sales") {
    return blocked(403, {
      code: "adam_campaign_missing",
      title: "Adam outbound is not set up yet",
      reason: "This workspace does not have the Adam outbound campaign.",
      nextAction: "Ask a workspace owner or manager to open Adam outbound once so the campaign can be created.",
      responsible: "manager",
    });
  }
  const playbook = adamOutboundPlaybook();
  const { data, error } = await supabaseAdmin
    .from("outreach_campaigns")
    .insert({
      workspace_id: actor.workspaceId,
      owner_id: actor.userId,
      visibility: "team",
      name: ADAM_CAMPAIGN_NAME,
      slug: ADAM_CAMPAIGN_SLUG,
      goal: "Book a short Adam trial after a human approves each email",
      audience: "Companies supplied by the Adam daily leads sheet",
      offer_angle: `${playbook.product.name}: ${playbook.product.summary}. ${playbook.product.price}.`,
      status: "active",
      approval_mode: true,
      daily_limit: 20,
      booking_cta_mode: "never",
      sequence: [{
        step: 1,
        delayDays: 0,
        channel: "email",
        actionType: "email",
        contentType: "plain",
        purpose: "First Adam email, approved by a human before it sends",
      }],
      playbook,
      cta_config: { type: "link", label: "Watch the Adam demo", url: "" },
      voice: {
        tone: "plain, specific and calm",
        style: "short British English",
        rules: playbook.leadRules,
      },
      banned_phrases: ["hope you are well", "just reaching out", "quick question", "circle back", "touch base"],
    })
    .select("id,name,slug,status,playbook,visibility")
    .maybeSingle();
  if (error || !data) {
    const again = await loadAdamCampaign(actor);
    if ("campaign" in again && again.campaign) return { ok: true, campaign: again.campaign };
    console.error("Adam campaign create failed", error?.message);
    return blocked(500, {
      code: "adam_campaign_not_created",
      title: "Adam outbound was not created",
      reason: "LiveCoach could not confirm the new campaign row.",
      nextAction: "Refresh Outreach and check whether Adam outbound is already in the campaign list before trying again.",
      responsible: "manager",
    });
  }
  return {
    ok: true,
    campaign: {
      id: data.id,
      name: data.name,
      slug: data.slug,
      status: data.status,
      visibility: data.visibility,
      playbook: mergeStoredPlaybook(data.playbook),
      storedPlaybookVersion: Number(data.playbook?.version) || 0,
    },
  };
}

async function upgradePlaybook(
  actor: Actor,
  campaign: AdamCampaignRecord
): Promise<{ ok: true; campaign: AdamCampaignRecord } | Blocked> {
  if (
    campaign.storedPlaybookVersion >= campaign.playbook.version &&
    campaign.playbook.emailPrompt
  ) {
    return { ok: true, campaign };
  }
  if (actor.role === "sales" && campaign.storedPlaybookVersion > 0) {
    return { ok: true, campaign };
  }
  const next = mergeStoredPlaybook({ ...campaign.playbook, version: 0 });
  const { data, error } = await supabaseAdmin
    .from("outreach_campaigns")
    .update({ playbook: next, updated_at: new Date().toISOString() })
    .eq("workspace_id", actor.workspaceId)
    .eq("id", campaign.id)
    .select("id,name,slug,status,playbook,visibility")
    .maybeSingle();
  if (error || !data) {
    console.error("Adam playbook upgrade failed", error?.message);
    return { ok: true, campaign };
  }
  return {
    ok: true,
    campaign: {
      id: data.id,
      name: data.name,
      slug: data.slug,
      status: data.status,
      visibility: data.visibility,
      playbook: mergeStoredPlaybook(data.playbook),
      storedPlaybookVersion: Number(data.playbook?.version) || 0,
    },
  };
}

async function workspaceMembers(actor: Actor) {
  const { data: members, error } = await supabaseAdmin
    .from("workspace_members")
    .select("user_id,status")
    .eq("workspace_id", actor.workspaceId)
    .eq("status", "active");
  if (error) throw error;
  const ids = (members || []).map((member) => member.user_id);
  if (!ids.length) return [];
  const { data: profiles, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("user_id,display_name")
    .in("user_id", ids);
  if (profileError) throw profileError;
  return (members || []).map((member) => {
    const profile = (profiles || []).find((item) => item.user_id === member.user_id);
    return {
      userId: member.user_id as string,
      name: String(profile?.display_name || "Teammate"),
      email: null,
    };
  });
}

async function rowsByEmail(table: "outreach_prospects" | "contacts", emails: string[], fields: string) {
  const rows: any[] = [];
  for (let index = 0; index < emails.length; index += 20) {
    const chunk = emails.slice(index, index + 20);
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(fields)
      .or(chunk.map((email) => `email.ilike.${email}`).join(","));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

async function sendPilotTouches(actor: Actor, emails: string[], linkedins: string[]) {
  const { data, error } = await supabaseAdmin.rpc("adam_sendpilot_touches", {
    p_workspace: actor.workspaceId,
    p_emails: emails,
    p_linkedin: linkedins,
  });
  if (error) {
    if (missingFunction(error)) {
      throw blocked(409, {
        code: "adam_sendpilot_check_missing",
        title: "The SendPilot safety check is not installed",
        reason: "Adam leads were not imported because LiveCoach could not check Kamm and Sharon's SendPilot links.",
        nextAction: "Apply the Adam outbound migration before syncing. Nothing was imported by this attempt.",
        responsible: "owner",
      });
    }
    throw error;
  }
  return (data || []) as Array<{
    match_type: "linkedin" | "email";
    match_value: string;
    sync_status: string;
    owner_display_name: string;
  }>;
}

async function leadClashHints(actor: Actor, lead: AdamSheetLead) {
  const emails = [lead.generalEmail, lead.decisionMakerEmail].filter(Boolean) as string[];
  const { data, error } = await supabaseAdmin.rpc("lead_clash_check", {
    p_workspace: actor.workspaceId,
    p_name: lead.company,
    p_domain: lead.domain,
    p_emails: emails,
    p_linkedin: lead.linkedinUrl ? [lead.linkedinUrl] : [],
    p_actor_user_id: actor.userId,
  });
  if (error) {
    if (missingFunction(error)) return { installed: false, hints: [] as Array<{ displayName: string; matchType: string }> };
    console.error("Adam lead clash check failed", error.message);
    return { installed: true, hints: [] as Array<{ displayName: string; matchType: string }> };
  }
  const hints = (data || []).slice(0, 5).map((row: any) => ({
    displayName: String(row.other_display_name || "A colleague"),
    matchType: String(row.match_type || "company"),
  }));
  return { installed: true, hints };
}

function preferText(incoming: string | null, existing: unknown) {
  return incoming || (typeof existing === "string" && existing.trim() ? existing : null);
}

export async function syncAdamSheet(actor: Actor) {
  const ready = await ensureAdamCampaign(actor);
  if ("blocker" in ready) return ready;
  const campaign = ready.campaign;
  const playbook = campaign.playbook;
  const token = await getAccessToken(false, actor.userId);
  const granted = token ? await googleHasScope(GOOGLE_SHEETS_SCOPE, actor.userId) : false;
  if (!token || !granted) {
    return blocked(409, adamSheetsBlocker(token ? "sheets_scope" : "sheets_access"));
  }
  const sheet = await readAdamSheet({
    accessToken: token,
    spreadsheetId: playbook.sheet.spreadsheetId,
    tab: playbook.sheet.tab,
  });
  if (!sheet.ok) return blocked(409, adamSheetsBlocker(sheet.code));
  const parsed = parseAdamSheet(sheet.values);
  const emails = [...new Set(parsed.leads.flatMap((lead) => [lead.generalEmail, lead.decisionMakerEmail].filter(Boolean) as string[]))];
  const linkedins = [...new Set(parsed.leads.map((lead) => lead.linkedinKey).filter(Boolean) as string[])];
  let prospects: any[] = [];
  let contacts: any[] = [];
  let touches: Awaited<ReturnType<typeof sendPilotTouches>> = [];
  let members: Awaited<ReturnType<typeof workspaceMembers>> = [];
  try {
    [prospects, contacts, members, touches] = await Promise.all([
      rowsByEmail("outreach_prospects", emails, "id,email,person_linkedin_url,status,source_metadata,assigned_to_user_id,company_name,company_domain,website,phone,job_title,first_name,last_name"),
      rowsByEmail("contacts", emails, "email"),
      workspaceMembers(actor),
      sendPilotTouches(actor, emails, linkedins),
    ]);
  } catch (error) {
    if (error && typeof error === "object" && "blocker" in (error as Blocked)) return error as Blocked;
    console.error("Adam sync lookup failed", error);
    return blocked(500, {
      code: "adam_sync_lookup_failed",
      title: "Adam leads were not imported",
      reason: "LiveCoach could not finish the duplicate check, so this sync did not write leads.",
      nextAction: "Refresh the prospect list to confirm nothing new appeared, then try the sync again.",
      responsible: "user",
    });
  }
  const guard = await outreachCrmGuard();
  const prospectIds = prospects.map((prospect) => prospect.id);
  const { data: enrolments, error: enrolmentError } = prospectIds.length
    ? await supabaseAdmin
        .from("outreach_enrolments")
        .select("prospect_id,campaign_id,status")
        .eq("workspace_id", actor.workspaceId)
        .in("prospect_id", prospectIds)
    : { data: [], error: null };
  if (enrolmentError) {
    console.error("Adam enrolment lookup failed", enrolmentError.message);
    return blocked(500, {
      code: "adam_sync_lookup_failed",
      title: "Adam leads were not imported",
      reason: "LiveCoach could not check existing campaign enrolments, so this sync stopped before writing.",
      nextAction: "Refresh Outreach and try the sync again. Do not send from the sheet in the meantime.",
      responsible: "user",
    });
  }
  const seenEmails = new Set<string>();
  const results: Array<{ rowNumber: number; company: string; outcome: string; detail: string }> = [];
  let created = 0;
  let updated = 0;
  let held = 0;
  let skipped = 0;
  let failed = 0;
  let clashInstalled: boolean | null = null;

  for (const lead of parsed.leads) {
    const clash: { installed: boolean; hints: Array<{ displayName: string; matchType: string }> } =
      clashInstalled === false
        ? { installed: false, hints: [] }
        : await leadClashHints(actor, lead);
    if (clashInstalled === null) clashInstalled = clash.installed;
    const leadEmails = [lead.generalEmail, lead.decisionMakerEmail].filter(Boolean) as string[];
    const leadTouches = touches.filter((touch) =>
      leadEmails.includes(String(touch.match_value || "").toLowerCase()) ||
      (lead.linkedinKey && touch.match_value === lead.linkedinKey)
    );
    const existingForLead = prospects.filter((prospect) => {
      const email = String(prospect.email || "").toLowerCase();
      const linkedin = adamLinkedinKey(prospect.person_linkedin_url);
      return leadEmails.includes(email) || (lead.linkedinKey && linkedin === lead.linkedinKey);
    });
    const plan = decideAdamLead({
      lead,
      actor: { userId: actor.userId, role: actor.role },
      members,
      prospects: existingForLead.map((prospect) => ({
        id: prospect.id,
        email: String(prospect.email || "").toLowerCase(),
        linkedinKey: adamLinkedinKey(prospect.person_linkedin_url),
        status: prospect.status,
        activeEnrolmentCampaignId: (enrolments || []).find((row) =>
          row.prospect_id === prospect.id &&
          ["queued", "researched", "drafted", "approved", "contacted", "replied", "booked", "paused"].includes(row.status)
        )?.campaign_id || null,
      })),
      contactEmails: new Set((contacts || []).map((contact) => String(contact.email || "").toLowerCase())),
      blockedDomains: guard.blockedDomains,
      sendpilot: leadTouches.map((touch) => ({
        matchType: touch.match_type,
        syncStatus: touch.sync_status,
        ownerName: touch.owner_display_name,
      })),
      clashes: clash.hints,
      seenEmails,
      campaignId: campaign.id,
    });
    if (plan.skip) {
      skipped += 1;
      results.push({ rowNumber: lead.rowNumber, company: lead.company, outcome: "skipped", detail: plan.skipReason || "Skipped" });
      continue;
    }
    let rowFailed = false;
    let rowHeld = false;
    for (const audience of plan.audiences) {
      seenEmails.add(audience.email);
      if (audience.action === "skip") {
        skipped += 1;
        results.push({
          rowNumber: lead.rowNumber,
          company: lead.company,
          outcome: "skipped",
          detail: audience.hold?.reason || "Skipped",
        });
        continue;
      }
      const saved = await saveAdamAudience({
        actor,
        campaignId: campaign.id,
        lead,
        plan,
        audience: audience.audience,
        email: audience.email,
        hold: audience.hold,
        existing: prospects.find((prospect) => String(prospect.email || "").toLowerCase() === audience.email) || null,
      });
      if (!saved.ok) {
        rowFailed = true;
        failed += 1;
        results.push({ rowNumber: lead.rowNumber, company: lead.company, outcome: "failed", detail: saved.detail });
        continue;
      }
      if (saved.created) created += 1;
      else updated += 1;
      if (audience.hold) {
        rowHeld = true;
        held += 1;
      }
      results.push({
        rowNumber: lead.rowNumber,
        company: lead.company,
        outcome: audience.hold ? "held" : saved.created ? "created" : "updated",
        detail: audience.hold?.reason || (saved.created ? "Saved. No email was drafted or sent." : "Updated. No email was drafted or sent."),
      });
    }
    if (!rowFailed && !rowHeld) {
      await recordSignal(actor, campaign.id, lead, plan);
    }
  }

  return {
    ok: true as const,
    campaignId: campaign.id,
    scanned: parsed.leads.length,
    truncated: parsed.truncated,
    created,
    updated,
    held,
    skipped,
    failed,
    leadClash: clashInstalled ? "checked" : "not_installed",
    emailed: 0,
    rows: results.slice(0, 80),
    notice: failed
      ? `${created + updated} lead emails were saved before a later row failed. Nothing was emailed. Check the rows below, then sync again only for what is still missing.`
      : `Saved ${created + updated} lead emails. ${held} are held and will not be drafted until the clash is reviewed. Nothing was emailed.`,
  };
}

async function saveAdamAudience(input: {
  actor: Actor;
  campaignId: string;
  lead: AdamSheetLead;
  plan: AdamLeadPlan;
  audience: "general_inbox" | "decision_maker";
  email: string;
  hold: AdamHold | null;
  existing: any | null;
}): Promise<{ ok: true; created: boolean } | { ok: false; detail: string }> {
  const metadata = adamMetadataFromLead({
    lead: input.lead,
    plan: input.plan,
    audience: input.audience,
    campaignId: input.campaignId,
  });
  const status = nextAdamProspectStatus(input.existing?.status || null, input.lead.sheetStatus);
  const assigned = input.existing?.assigned_to_user_id || input.plan.assignedToUserId;
  const row = {
    email: input.email,
    first_name: preferText(input.lead.firstName, input.existing?.first_name),
    last_name: preferText(input.lead.lastName, input.existing?.last_name),
    job_title: input.audience === "general_inbox"
      ? preferText(input.lead.role, input.existing?.job_title) || "General inbox"
      : preferText(input.lead.role, input.existing?.job_title),
    company_name: input.lead.company,
    company_domain: preferText(input.lead.domain, input.existing?.company_domain),
    website: preferText(input.lead.website, input.existing?.website),
    phone: preferText(input.lead.phone, input.existing?.phone),
    person_linkedin_url: preferText(input.lead.linkedinUrl, input.existing?.person_linkedin_url),
    status: input.hold?.code === "do_not_contact" && status !== "qualified" && status !== "replied" ? "suppressed" : status,
    source_file: "Adam daily leads",
    source_sheet: "Leads",
    source_row: input.lead.rowNumber,
    source_metadata: mergeAdamMetadata(input.existing?.source_metadata, metadata),
    assigned_to_user_id: assigned,
    updated_at: new Date().toISOString(),
  };
  if (input.existing?.id) {
    const { error } = await supabaseAdmin
      .from("outreach_prospects")
      .update(row)
      .eq("workspace_id", input.actor.workspaceId)
      .eq("id", input.existing.id);
    if (error) {
      console.error("Adam prospect update failed", error.message);
      return { ok: false, detail: "This email was found, but the update was not confirmed. Check the existing prospect before syncing again." };
    }
    await insertEvent(input.actor, input.campaignId, input.existing.id, "sheet_imported", {
      audience: input.audience,
      held: Boolean(input.hold),
      holdCode: input.hold?.code || null,
    });
    return { ok: true, created: false };
  }
  const { data, error } = await supabaseAdmin
    .from("outreach_prospects")
    .insert({
      ...row,
      owner_id: input.actor.userId,
      workspace_id: input.actor.workspaceId,
      visibility: "team",
      priority: "medium",
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, detail: "This email is already in LiveCoach. Ask a manager to review the existing record before anyone emails it." };
    }
    console.error("Adam prospect insert failed", error?.message);
    return { ok: false, detail: "This lead was not confirmed as saved. Refresh the prospect list before trying again." };
  }
  await insertEvent(input.actor, input.campaignId, data.id, "sheet_imported", {
    audience: input.audience,
    held: Boolean(input.hold),
    holdCode: input.hold?.code || null,
  });
  return { ok: true, created: true };
}

async function insertEvent(
  actor: Actor,
  campaignId: string | null,
  prospectId: string,
  kind: string,
  metadata: Record<string, unknown>
) {
  const { error } = await supabaseAdmin.from("outreach_events").insert({
    workspace_id: actor.workspaceId,
    owner_id: actor.userId,
    visibility: "team",
    campaign_id: campaignId,
    prospect_id: prospectId,
    kind,
    metadata,
  });
  if (error) console.error("Adam outreach event was not saved", error.message);
}

async function recordSignal(actor: Actor, campaignId: string, lead: AdamSheetLead, plan: AdamLeadPlan) {
  if (!lead.signal) return;
  const summary = lead.whyAdamFits || lead.signal;
  const { error } = await supabaseAdmin.from("outreach_signals").insert({
    workspace_id: actor.workspaceId,
    owner_id: actor.userId,
    visibility: "team",
    source_type: "manual",
    source_url: /^https?:\/\//i.test(lead.signalLink || "") ? lead.signalLink : null,
    source_text: lead.signal,
    company_name: lead.company,
    author_name: lead.contact,
    author_role: lead.role,
    signal_type: /hiring|recruit/.test(lead.signal.toLowerCase()) ? "hiring" : "other",
    summary: summary.slice(0, 500),
    relevance_reason: lead.whyAdamFits,
    recommended_action: plan.hold ? "ignore" : "prepare_outreach",
    priority: "medium",
    confidence: "medium",
    status: "new",
    evidence: [{ campaignId, leadKey: plan.leadKey, signalLink: lead.signalLink }],
  });
  if (error && error.code !== "23505") console.error("Adam signal was not saved", error.message);
}

function allowedFacts(playbook: AdamPlaybook, lead: AdamSheetLead) {
  return [
    playbook.product.summary,
    playbook.product.price,
    lead.whyAdamFits,
    lead.signal,
    lead.suggestedOpener,
    lead.demoLink,
    lead.company,
  ].filter(Boolean).join("\n");
}

export async function draftAdamProspect(actor: Actor, prospectId: string) {
  const ready = await ensureAdamCampaign(actor);
  if ("blocker" in ready) return ready;
  const { data: prospect, error } = await supabaseAdmin
    .from("outreach_prospects")
    .select("*")
    .eq("workspace_id", actor.workspaceId)
    .eq("id", prospectId)
    .maybeSingle();
  if (error || !prospect) {
    return blocked(404, {
      code: "adam_prospect_missing",
      title: "That Adam lead is not available",
      reason: "LiveCoach could not open this prospect for your account.",
      nextAction: "Refresh the Adam outbound list and choose the lead again.",
      responsible: "user",
    });
  }
  if (prospect.source_metadata?.campaign_slug !== ADAM_CAMPAIGN_SLUG) {
    return blocked(409, {
      code: "adam_prospect_wrong_campaign",
      title: "This prospect is not an Adam lead",
      reason: "Adam drafting only runs for leads imported into Adam outbound.",
      nextAction: "Use the normal Outreach prepare action for other campaigns.",
      responsible: "user",
    });
  }
  if (prospect.assigned_to_user_id !== actor.userId) {
    return blocked(403, {
      code: "adam_draft_owner",
      title: "Draft this lead from the assigned mailbox",
      reason: "The email has to be drafted by the person who will send it, so the From address stays theirs.",
      nextAction: prospect.assigned_to_user_id
        ? "Ask the assigned salesperson to open this lead and press Draft Adam email."
        : "Claim the lead first, then draft it from your own account.",
      responsible: "user",
    });
  }
  const lead = leadFromProspect(prospect);
  const audience = prospect.source_metadata?.audience === "decision_maker" ? "decision_maker" : "general_inbox";
  let liveHold: AdamHold | null;
  try {
    liveHold = await liveAdamHold(actor, prospect, lead);
  } catch (holdError) {
    if (holdError && typeof holdError === "object" && "blocker" in (holdError as Blocked)) {
      return holdError as Blocked;
    }
    throw holdError;
  }
  if (liveHold) {
    await supabaseAdmin
      .from("outreach_prospects")
      .update({
        source_metadata: mergeAdamMetadata(prospect.source_metadata, { adam_hold: liveHold }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", prospect.id)
      .eq("workspace_id", actor.workspaceId);
    return blocked(409, {
      code: `adam_hold_${liveHold.code}`,
      title: "This Adam lead is held",
      reason: liveHold.reason,
      nextAction: liveHold.nextAction,
      responsible: "user",
    });
  }
  let sender;
  try {
    sender = await resolveOutreachIdentity(actor.userId);
  } catch (identityError) {
    console.error("Adam sender identity unavailable", identityError);
    return blocked(409, {
      code: "adam_sender_missing",
      title: "Your mailbox is not ready to draft",
      reason: "Adam drafts are saved against the connected mailbox of the person who will send them.",
      nextAction: "Connect Google or Microsoft email for this account, then draft again. Nothing was sent.",
      responsible: "user",
    });
  }
  const playbook = ready.campaign.playbook;
  const copy = sheetCopyForAudience(lead, audience);
  const checkedCopy = copy.subject && copy.body
    ? validateAdamDraft({
        audience,
        subject: copy.subject,
        body: copy.body,
        firstName: lead.firstName,
        demoLink: lead.demoLink,
        whyAdamFits: lead.whyAdamFits,
        allowedFacts: allowedFacts(playbook, lead),
        rules: playbook.emailRules,
      })
    : null;
  let drafted: { subject: string; body: string } | null = checkedCopy?.ok
    ? { subject: checkedCopy.subject, body: checkedCopy.body }
    : null;
  let source: "sheet" | "campaign_prompt" = "sheet";
  if (!drafted) {
    source = "campaign_prompt";
    const generated = await generateAdamCopy({
      actor,
      playbook,
      lead,
      audience,
      senderFirstName: sender.senderName.split(" ")[0] || sender.senderName,
      prospectId: prospect.id,
    });
    if ("blocker" in generated) return generated;
    drafted = { subject: generated.subject, body: generated.body };
  }
  if (!drafted) {
    return blocked(500, {
      code: "adam_draft_not_saved",
      title: "The Adam draft was not saved",
      reason: "LiveCoach did not produce email text for this lead.",
      nextAction: "Check the lead facts, then draft again. Nothing was sent.",
      responsible: "user",
    });
  }
  const enrolmentId = await ensureDraftEnrolment(actor, ready.campaign.id, prospect.id);
  if ("blocker" in enrolmentId) return enrolmentId;
  const { data: existingMessage, error: messageError } = await supabaseAdmin
    .from("outreach_messages")
    .select("id,status")
    .eq("workspace_id", actor.workspaceId)
    .eq("enrolment_id", enrolmentId.enrolmentId)
    .eq("step_number", 1)
    .maybeSingle();
  if (messageError) {
    return blocked(500, {
      code: "adam_draft_unconfirmed",
      title: "The Adam draft was not saved",
      reason: "LiveCoach could not check whether a draft already exists.",
      nextAction: "Open the prospect activity before drafting again, so you do not create a second copy.",
      responsible: "user",
    });
  }
  if (existingMessage && ["approved", "sending", "sent"].includes(existingMessage.status)) {
    return blocked(409, {
      code: "adam_draft_already_progressed",
      title: "This email is already approved or sent",
      reason: "The existing message was left unchanged.",
      nextAction: "Review that message in Today before writing another version.",
      responsible: "user",
    });
  }
  const now = new Date().toISOString();
  const payload = {
    workspace_id: actor.workspaceId,
    owner_id: actor.userId,
    visibility: "team",
    enrolment_id: enrolmentId.enrolmentId,
    campaign_id: ready.campaign.id,
    prospect_id: prospect.id,
    step_number: 1,
    variant: "A",
    from_email: sender.senderEmail,
    sender_user_id: actor.userId,
    subject: drafted.subject,
    body_text: drafted.body,
    status: "draft",
    voice_script: null,
    voice_status: "none",
    message_tags: { audience, origin: "adam_outbound", source },
    strategy: { reasoning: "Drafted from the Adam outbound campaign prompt.", audience, source },
    updated_at: now,
  };
  const write = existingMessage
    ? supabaseAdmin.from("outreach_messages").update(payload).eq("id", existingMessage.id).select("id,status").maybeSingle()
    : supabaseAdmin.from("outreach_messages").insert(payload).select("id,status").maybeSingle();
  const { data: message, error: writeError } = await write;
  if (writeError || !message) {
    console.error("Adam draft save failed", writeError?.message);
    return blocked(500, {
      code: "adam_draft_not_saved",
      title: "The Adam draft was not saved",
      reason: enrolmentId.created
        ? "The lead was linked to Adam outbound, but the email text was not confirmed."
        : "The email text was not confirmed.",
      nextAction: "Refresh the prospect and look for a draft before pressing Draft again.",
      responsible: "user",
    });
  }
  await supabaseAdmin
    .from("outreach_prospects")
    .update({
      status: prospect.status === "imported" ? "ready" : prospect.status,
      source_metadata: mergeAdamMetadata(prospect.source_metadata, { adam_hold: null }),
      updated_at: now,
    })
    .eq("id", prospect.id)
    .eq("workspace_id", actor.workspaceId);
  await insertEvent(actor, ready.campaign.id, prospect.id, "drafted", {
    audience,
    source,
    messageId: message.id,
  });
  return {
    ok: true as const,
    messageId: message.id,
    source,
    notice: source === "sheet"
      ? "Draft saved from the sheet copy. Review it and press Approve & queue when you are ready. Nothing was sent."
      : "Draft saved from the Adam campaign prompt. Review it and press Approve & queue when you are ready. Nothing was sent.",
  };
}

async function generateAdamCopy(input: {
  actor: Actor;
  playbook: AdamPlaybook;
  lead: AdamSheetLead;
  audience: "general_inbox" | "decision_maker";
  senderFirstName: string;
  prospectId: string;
}): Promise<{ subject: string; body: string } | Blocked> {
  if (!input.playbook.emailPrompt.trim()) {
    return blocked(409, {
      code: "adam_prompt_missing",
      title: "The Adam email prompt is empty",
      reason: "Drafting uses the prompt stored on the Adam outbound campaign, and that prompt is blank.",
      nextAction: "Ask a manager to save the email prompt on the campaign, then draft again.",
      responsible: "manager",
    });
  }
  let message: any;
  try {
    message = await openai.messages.create({
      model: OPENAI_MODEL_LIVE,
      max_tokens: 900,
      system: input.playbook.emailPrompt,
      messages: [{
        role: "user",
        content: adamDraftFacts({
          audience: input.audience,
          lead: input.lead,
          senderFirstName: input.senderFirstName,
        }),
      }],
    });
  } catch (error) {
    console.error("Adam draft model failed", error);
    return blocked(502, {
      code: "adam_draft_model_failed",
      title: "The Adam draft was not written",
      reason: "The writing step failed before a draft was saved.",
      nextAction: "Check the lead facts, then press Draft Adam email again. Do not send from the spreadsheet.",
      responsible: "user",
    });
  }
  await logModelUsage("adam_outbound_draft", "live", message?.usage, {
    prospectId: input.prospectId,
  }, { userId: input.actor.userId, workspaceId: input.actor.workspaceId });
  const parsed = parseObject(modelText(message));
  const side = input.audience === "decision_maker" ? parsed?.decisionMaker : parsed?.general;
  const validated = validateAdamDraft({
    audience: input.audience,
    subject: side?.subject,
    body: side?.body,
    firstName: input.lead.firstName,
    demoLink: input.lead.demoLink,
    whyAdamFits: input.lead.whyAdamFits,
    allowedFacts: allowedFacts(input.playbook, input.lead),
    rules: input.playbook.emailRules,
  });
  if (!validated.ok) {
    return blocked(409, {
      code: "adam_draft_rejected",
      title: "The Adam draft was not saved",
      reason: validated.problems[0] || "The draft did not meet the campaign rules.",
      nextAction: "Adjust the lead facts or the campaign prompt, then draft again. The rejected text was not stored.",
      responsible: "user",
    });
  }
  return { subject: validated.subject, body: validated.body };
}

async function ensureDraftEnrolment(
  actor: Actor,
  campaignId: string,
  prospectId: string
): Promise<{ enrolmentId: string; created: boolean } | Blocked> {
  const { data: existing, error } = await supabaseAdmin
    .from("outreach_enrolments")
    .select("id,campaign_id,status")
    .eq("workspace_id", actor.workspaceId)
    .eq("prospect_id", prospectId);
  if (error) {
    return blocked(500, {
      code: "adam_enrolment_unconfirmed",
      title: "The Adam draft was not started",
      reason: "LiveCoach could not check this lead's existing campaign enrolment.",
      nextAction: "Refresh the prospect before drafting again.",
      responsible: "user",
    });
  }
  const same = (existing || []).find((row) => row.campaign_id === campaignId);
  if (same) return { enrolmentId: same.id, created: false };
  const otherActive = (existing || []).find((row) =>
    ["queued", "researched", "drafted", "approved", "contacted", "replied", "booked", "paused"].includes(row.status)
  );
  if (otherActive) {
    return blocked(409, {
      code: "adam_hold_active_outreach",
      title: "This email is already in another campaign",
      reason: "Adam outbound did not create a second active enrolment.",
      nextAction: "Continue in the existing campaign, or ask a manager to close it first.",
      responsible: "manager",
    });
  }
  const { data, error: insertError } = await supabaseAdmin
    .from("outreach_enrolments")
    .insert({
      workspace_id: actor.workspaceId,
      owner_id: actor.userId,
      visibility: "team",
      campaign_id: campaignId,
      prospect_id: prospectId,
      status: "drafted",
      current_step: 1,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !data) {
    console.error("Adam enrolment insert failed", insertError?.message);
    return blocked(409, {
      code: "adam_enrolment_not_created",
      title: "The Adam draft was not linked to the campaign",
      reason: "The lead is saved, but the campaign enrolment was not confirmed, so no draft was stored.",
      nextAction: "Refresh the prospect and check its campaign badges before drafting again.",
      responsible: "user",
    });
  }
  return { enrolmentId: data.id, created: true };
}

async function liveAdamHold(actor: Actor, prospect: any, lead: AdamSheetLead): Promise<AdamHold | null> {
  const stored = prospect.source_metadata?.adam_hold;
  if (stored && ["do_not_contact", "already_sent_on_sheet", "already_contacted"].includes(stored.code)) {
    return stored as AdamHold;
  }
  const email = normaliseAdamEmail(prospect.email);
  if (!email) return null;
  try {
    const touches = await sendPilotTouches(actor, [email], lead.linkedinKey ? [lead.linkedinKey] : []);
    if (touches.length) {
      return {
        code: "sendpilot",
        reason: `${touches[0].owner_display_name || "A teammate"} already has this person in SendPilot.`,
        nextAction: "Leave the email unsent and review that SendPilot conversation first.",
      };
    }
  } catch (error) {
    if (error && typeof error === "object" && "blocker" in (error as Blocked)) throw error;
    throw error;
  }
  const guard = await outreachCrmGuard();
  if (prospectHasBlockedCrmRelationship(prospect, guard)) {
    return {
      code: "crm_company",
      reason: "This company is not a confirmed new lead, or it already has an open opportunity.",
      nextAction: "Review the company and pipeline before sending a cold Adam email.",
    };
  }
  const { data: contacts, error } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .ilike("email", email)
    .limit(1);
  if (error) throw error;
  if (contacts?.length) {
    return {
      code: "existing_contact",
      reason: "This email is already a CRM contact.",
      nextAction: "Open the existing contact instead of sending a cold Adam email.",
    };
  }
  const clash = await leadClashHints(actor, lead);
  if (clash.hints.length) {
    return {
      code: "lead_clash",
      reason: `${clash.hints[0].displayName} is already working this company.`,
      nextAction: "Review that clash before drafting or sending.",
    };
  }
  return null;
}

export async function adamSendBlockReason(input: {
  campaign: { slug?: string | null; playbook?: { kind?: string } | null } | null;
  prospect: any;
  workspaceId: string;
  userId: string;
}) {
  if (!isAdamCampaign(input.campaign)) return null;
  const actor: Actor = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    role: "sales",
  };
  try {
    const hold = await liveAdamHold(actor, input.prospect, leadFromProspect(input.prospect));
    return hold?.reason || null;
  } catch (error) {
    if (error && typeof error === "object" && "blocker" in (error as Blocked)) {
      return (error as Blocked).blocker.reason;
    }
    console.error("Adam send safety check failed", error);
    return "The Adam send safety check did not finish, so this email was not sent.";
  }
}

export async function writeAdamReplyStatus(input: {
  prospect: any;
  status: string;
  summary: string;
  senderUserId: string;
  workspaceId: string;
}) {
  const metadata = input.prospect?.source_metadata;
  if (metadata?.campaign_slug !== ADAM_CAMPAIGN_SLUG) return { wrote: false };
  const label = adamSheetStatusLabel(input.status);
  if (!label) return { wrote: false };
  const playbook = adamOutboundPlaybook();
  const spreadsheetId = String(metadata.sheet_spreadsheet_id || playbook.sheet.spreadsheetId);
  const tab = String(metadata.sheet_tab || playbook.sheet.tab);
  const emails = [metadata.general_email, metadata.decision_maker_email, input.prospect.email]
    .map((value) => normaliseAdamEmail(value))
    .filter(Boolean) as string[];
  const token = await getAccessToken(false, input.senderUserId);
  const granted = token ? await googleHasScope(GOOGLE_SHEETS_SCOPE, input.senderUserId) : false;
  const actor: Actor = {
    userId: input.senderUserId,
    workspaceId: input.workspaceId,
    role: "sales",
  };
  if (!token || !granted) {
    await rememberWriteback(actor, input.prospect, {
      status: "needs_sheets_access",
      at: new Date().toISOString(),
    });
    return { wrote: false, reason: "needs_sheets_access" };
  }
  const sheet = await readAdamSheet({ accessToken: token, spreadsheetId, tab });
  if (!sheet.ok) {
    await rememberWriteback(actor, input.prospect, {
      status: sheet.code,
      at: new Date().toISOString(),
    });
    return { wrote: false, reason: sheet.code };
  }
  const found = findAdamSheetRow(sheet.values, emails);
  if (!found.rowNumber) {
    await rememberWriteback(actor, input.prospect, {
      status: found.ambiguous ? "ambiguous_row" : "row_not_found",
      at: new Date().toISOString(),
    });
    return { wrote: false, reason: found.ambiguous ? "ambiguous_row" : "row_not_found" };
  }
  const existingNote = String(sheet.values[found.rowNumber - 1]?.[12] || "");
  const note = adamSheetNote(existingNote, input.summary, new Date().toISOString());
  const written = await writeAdamSheetCells({
    accessToken: token,
    spreadsheetId,
    tab,
    rowNumber: found.rowNumber,
    status: label,
    note,
  });
  await rememberWriteback(actor, input.prospect, {
    status: written.ok ? "written" : written.code,
    at: new Date().toISOString(),
    rowNumber: found.rowNumber,
  });
  await insertEvent(actor, metadata.adam_campaign_id || null, input.prospect.id, "sheet_writeback", {
    status: written.ok ? "written" : written.code,
    sheetStatus: label,
  });
  return { wrote: written.ok };
}

async function rememberWriteback(actor: Actor, prospect: any, sheetWriteback: Record<string, unknown>) {
  const { error } = await supabaseAdmin
    .from("outreach_prospects")
    .update({
      source_metadata: mergeAdamMetadata(prospect.source_metadata, { sheet_writeback: sheetWriteback }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", prospect.id)
    .eq("workspace_id", actor.workspaceId);
  if (error) console.error("Adam sheet writeback note was not saved", error.message);
}

export async function saveAdamPrompt(actor: Actor, emailPrompt: string) {
  if (actor.role === "sales") {
    return blocked(403, {
      code: "adam_prompt_forbidden",
      title: "Only a manager can change the Adam prompt",
      reason: "The email prompt is part of the shared campaign.",
      nextAction: "Ask a workspace owner or manager to save the prompt.",
      responsible: "manager",
    });
  }
  const ready = await ensureAdamCampaign(actor);
  if ("blocker" in ready) return ready;
  const prompt = emailPrompt.trim();
  if (prompt.length < 80 || prompt.length > 8000) {
    return blocked(400, {
      code: "adam_prompt_invalid",
      title: "The Adam prompt was not saved",
      reason: "The prompt needs to be long enough to carry the email rules, and shorter than 8,000 characters.",
      nextAction: "Edit the prompt and save it again. The previous prompt is still on the campaign.",
      responsible: "manager",
    });
  }
  const playbook = { ...ready.campaign.playbook, emailPrompt: prompt, version: ready.campaign.playbook.version };
  const { data, error } = await supabaseAdmin
    .from("outreach_campaigns")
    .update({ playbook, updated_at: new Date().toISOString() })
    .eq("workspace_id", actor.workspaceId)
    .eq("id", ready.campaign.id)
    .select("playbook")
    .maybeSingle();
  if (error || !data) {
    return blocked(500, {
      code: "adam_prompt_not_saved",
      title: "The Adam prompt was not saved",
      reason: "LiveCoach could not confirm the campaign update.",
      nextAction: "Reload Adam outbound and check the prompt before editing it again.",
      responsible: "manager",
    });
  }
  return { ok: true as const, playbook: mergeStoredPlaybook(data.playbook) };
}
