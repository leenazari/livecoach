import "server-only";

import { NextResponse } from "next/server";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import {
  actionableClashes,
  clashWarningCopy,
  collectPages,
  emailDomain,
  isExcludedMatchDomain,
  linkedinSlug,
  parseLeadClashMatches,
  prepareCompaniesForDuplicateScan,
  prepareContactsForDuplicateScan,
  strongClashes,
  leadClashSwitchEnabled,
  type LeadClashMatch,
} from "@/lib/lead-clash-rules";
import type { RequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LeadClashStatus = {
  enabled: boolean;
  available: boolean;
  forcedOff: boolean;
};

type CheckInput = {
  workspaceId: string;
  actorUserId: string;
  name?: string | null;
  domain?: string | null;
  emails?: string[] | null;
  linkedin?: string[] | null;
  excludeCompanyId?: string | null;
  excludeContactId?: string | null;
  attendeeEmails?: string[] | null;
  externalIds?: string[] | null;
  meetingUrls?: string[] | null;
};

function envForcesOff() {
  return leadClashSwitchEnabled({
    forceOff: process.env.LEAD_CLASH_FORCE_OFF,
    enabledEnv: process.env.LEAD_CLASH_ENABLED,
    databaseEnabled: true,
    databaseReadable: true,
  }) === false && (
    ["1", "true", "yes", "on"].includes(String(process.env.LEAD_CLASH_FORCE_OFF || "").trim().toLowerCase())
    || ["0", "false", "no", "off"].includes(String(process.env.LEAD_CLASH_ENABLED || "").trim().toLowerCase())
  );
}

export async function readLeadClashStatus(workspaceId: string): Promise<LeadClashStatus> {
  const forcedOff = envForcesOff();
  if (!UUID.test(workspaceId)) {
    return { enabled: false, available: false, forcedOff };
  }
  try {
    const { data, error } = await supabaseService
      .from("lead_clash_settings")
      .select("enabled")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) return { enabled: false, available: false, forcedOff };
    return {
      enabled: leadClashSwitchEnabled({
        forceOff: process.env.LEAD_CLASH_FORCE_OFF,
        enabledEnv: process.env.LEAD_CLASH_ENABLED,
        databaseEnabled: data?.enabled === true,
        databaseReadable: true,
      }),
      available: true,
      forcedOff,
    };
  } catch (error) {
    console.error("Lead clash setting could not be read", errorCode(error));
    return { enabled: false, available: false, forcedOff };
  }
}

export async function isLeadClashEnabled(workspaceId: string): Promise<boolean> {
  return (await readLeadClashStatus(workspaceId)).enabled;
}

function cleanList(values: Array<string | null | undefined> | null | undefined, limit = 20) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, limit);
}

// Any failure, including a missing function before the migration is applied,
// leaves the existing write path untouched.
export async function findLeadClashes(input: CheckInput): Promise<LeadClashMatch[] | null> {
  try {
    if (!(await isLeadClashEnabled(input.workspaceId))) return [];
    const domain = input.domain && !isExcludedMatchDomain(input.domain) ? input.domain : null;
    const { data, error } = await supabaseService.rpc("lead_clash_check", {
      p_workspace: input.workspaceId,
      p_actor_user_id: input.actorUserId,
      p_name: input.name || null,
      p_domain: domain,
      p_emails: cleanList(input.emails),
      p_linkedin: cleanList(input.linkedin),
      p_exclude_company: input.excludeCompanyId || null,
      p_exclude_contact: input.excludeContactId || null,
      p_attendee_emails: cleanList(input.attendeeEmails, 40),
      p_external_ids: cleanList(input.externalIds, 20),
      p_meeting_urls: cleanList(input.meetingUrls, 20),
    });
    if (error) {
      console.error("Lead clash check failed open", errorCode(error));
      return null;
    }
    return parseLeadClashMatches(data);
  } catch (error) {
    console.error("Lead clash check failed open", errorCode(error));
    return null;
  }
}

function acknowledgement(body: Record<string, unknown> | null | undefined) {
  const acknowledged = body?.acknowledgeClash === true;
  const reason = String(body?.clashReason || "").replace(/\s+/g, " ").trim();
  return { acknowledged, reason };
}

export function leadClashBlockedResponse(matches: LeadClashMatch[]) {
  const copy = clashWarningCopy(matches);
  return NextResponse.json(
    {
      ...crmBlockerPayload({
        code: "lead_clash",
        title: copy.title,
        reason: copy.reason,
        nextAction: copy.nextAction,
        responsible: "user",
        outcome: "Nothing was saved.",
      }),
      leadClash: { canProceed: true, matches: actionableClashes(matches) },
    },
    { status: 409 }
  );
}

async function memberIds(workspaceId: string, roles?: string[]) {
  let query = supabaseService
    .from("workspace_members")
    .select("user_id,role")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (roles?.length) query = query.in("role", roles);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as { user_id: string; role: string }[];
}

async function wantsClashAlerts(workspaceId: string, userId: string) {
  const { data, error } = await supabaseService
    .from("crm_notification_preferences")
    .select("assignment_alerts,in_app_enabled")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return true;
  return data.assignment_alerts !== false && data.in_app_enabled !== false;
}

function notificationCopy(match: LeadClashMatch, audience: "manager" | "fyi", actorName: string) {
  const company = match.confidential || !match.companyName ? "this account" : match.companyName;
  if (audience === "fyi") {
    return {
      title: `FYI: ${actorName} also worked ${company}`.slice(0, 160),
      body: `${actorName} added or updated a record that matches ${company}. This is a notice only. No notes or deal details are included.`.slice(0, 1000),
      href: "/crm",
    };
  }
  const summary = clashWarningCopy([match]).reason;
  return {
    title: `Lead clash: ${company}`.slice(0, 160),
    body: `${actorName} hit a ${match.matchType} match. ${summary}`.slice(0, 1000),
    href: "/crm#duplicates",
  };
}

async function actorName(userId: string) {
  const { data } = await supabaseService
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  const name = String(data?.display_name || "").replace(/\s+/g, " ").trim();
  return name || "A teammate";
}

async function writeNotifications(input: {
  workspaceId: string;
  actorUserId: string;
  matches: LeadClashMatch[];
  event: string;
}) {
  const clashes = actionableClashes(input.matches);
  if (!clashes.length) return false;
  const managers = await memberIds(input.workspaceId, ["owner", "manager"]);
  const name = await actorName(input.actorUserId);
  const rows: Record<string, string>[] = [];
  for (const match of clashes) {
    const companyKey = match.otherCompanyId || match.otherUserId;
    const copyFor = notificationCopy(match, "manager", name);
    for (const manager of managers) {
      if (manager.user_id === input.actorUserId) continue;
      if (!(await wantsClashAlerts(input.workspaceId, manager.user_id))) continue;
      rows.push({
        workspace_id: input.workspaceId,
        user_id: manager.user_id,
        kind: "lead_clash",
        title: copyFor.title,
        body: copyFor.body,
        href: copyFor.href,
        source_table: "lead_clashes",
        source_id: companyKey,
        source_event_key: `lead_clash:${companyKey}:${input.actorUserId}:${input.event}:manager`,
      });
    }
    if (
      match.otherUserId !== input.actorUserId &&
      !managers.some((manager) => manager.user_id === match.otherUserId) &&
      (await wantsClashAlerts(input.workspaceId, match.otherUserId))
    ) {
      const fyi = notificationCopy(match, "fyi", name);
      rows.push({
        workspace_id: input.workspaceId,
        user_id: match.otherUserId,
        kind: "lead_clash",
        title: fyi.title,
        body: fyi.body,
        href: fyi.href,
        source_table: "lead_clashes",
        source_id: companyKey,
        source_event_key: `lead_clash:${companyKey}:${input.actorUserId}:${input.event}:fyi`,
      });
    }
  }
  if (!rows.length) return false;
  const { error } = await supabaseService.from("crm_notifications").upsert(rows, {
    onConflict: "user_id,source_event_key",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return true;
}

async function logClash(input: {
  workspaceId: string;
  actorUserId: string;
  trigger: string;
  matches: LeadClashMatch[];
  resolution: "open" | "proceeded" | "shared";
  reason?: string | null;
}) {
  const rows = input.matches.slice(0, 5).map((match) => ({
    workspace_id: input.workspaceId,
    trigger: input.trigger.slice(0, 80),
    actor_user_id: input.actorUserId,
    other_user_id: match.otherUserId,
    other_company_id: match.otherCompanyId,
    match_type: match.matchType,
    match_value: match.matchValue,
    disposition: match.disposition,
    resolution: input.resolution,
    resolution_reason: input.reason ? input.reason.slice(0, 500) : null,
    resolved_by: input.resolution === "open" ? null : input.actorUserId,
    resolved_at: input.resolution === "open" ? null : new Date().toISOString(),
  }));
  if (!rows.length) return;
  const { error } = await supabaseService.from("lead_clashes").insert(rows);
  if (error) throw error;
}

async function recordClash(input: {
  workspaceId: string;
  actorUserId: string;
  trigger: string;
  matches: LeadClashMatch[];
  resolution: "open" | "proceeded" | "shared";
  reason?: string | null;
  notify: boolean;
}) {
  try {
    await logClash(input);
    if (input.notify) {
      await writeNotifications({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        matches: input.matches,
        event: input.resolution,
      });
    }
    return true;
  } catch (error) {
    console.error("Lead clash notice was not saved", errorCode(error));
    return false;
  }
}

// Manual create/update. Returns a 409 warning, or null to continue the
// existing write. A missing function or a disabled switch returns null.
export async function guardManualLeadClash(input: Omit<CheckInput, "workspaceId" | "actorUserId"> & {
  scope: Pick<RequestScope, "userId" | "workspaceId">;
  trigger: string;
  body?: Record<string, unknown> | null;
}): Promise<NextResponse | null> {
  const matches = await findLeadClashes({
    ...input,
    workspaceId: input.scope.workspaceId,
    actorUserId: input.scope.userId,
  });
  if (!matches) return null;
  const clashes = actionableClashes(matches);
  if (!clashes.length) return null;
  const { acknowledged, reason } = acknowledgement(input.body);
  if (!acknowledged) return leadClashBlockedResponse(clashes);
  if (reason.length < 8 || reason.length > 500) {
    return NextResponse.json(
      crmBlockerPayload({
        code: "lead_clash_reason_required",
        title: "A short reason is required",
        reason: "Continuing past a lead clash needs a reason of at least 8 characters so the workspace owner can see why a second record was created.",
        nextAction: "Add the reason and save again, or cancel. Nothing has been saved.",
        responsible: "user",
        outcome: "Nothing was saved.",
      }),
      { status: 400 }
    );
  }
  await recordClash({
    workspaceId: input.scope.workspaceId,
    actorUserId: input.scope.userId,
    trigger: input.trigger,
    matches: clashes,
    resolution: "proceeded",
    reason,
    notify: true,
  });
  return null;
}

// Calendar and email sync never stop because of a clash. A strong cross-owner
// match skips the new private company. A shared meeting is not a clash and
// does not notify, but it still does not create a second company.
export async function automatedCompanyCreateHeld(input: CheckInput & {
  trigger: "calendar_sync" | "email_pull";
}): Promise<boolean> {
  const matches = await findLeadClashes(input);
  if (!matches) return false;
  const strong = matches.filter(
    (match) => match.matchType === "person" || match.matchType === "domain"
  );
  if (!strong.length) return false;
  const clashes = strongClashes(strong);
  const shared = strong.filter((match) => match.disposition === "shared");
  if (clashes.length) {
    await recordClash({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      trigger: input.trigger,
      matches: clashes,
      resolution: "open",
      notify: true,
    });
  }
  if (shared.length) {
    await recordClash({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      trigger: input.trigger,
      matches: shared,
      resolution: "shared",
      notify: false,
    });
  }
  return true;
}

export async function loadAllScopedRows<T>(
  load: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>
): Promise<T[]> {
  return collectPages((from, to) => Promise.resolve(load(from, to)));
}

export function workspaceDuplicateInputs<T extends {
  id: string;
  name: string;
  domain?: string | null;
  website?: string | null;
  profile?: Record<string, unknown> | null;
  email?: string | null;
}>(companies: T[], contacts: { email?: string | null }[]) {
  return {
    companies: prepareCompaniesForDuplicateScan(companies, {
      excludeGenericDomains: true,
      excludeTestRecords: true,
    }),
    contacts: prepareContactsForDuplicateScan(contacts, { excludeInternalEmails: true }),
  };
}

export function linkedinValuesFromBody(body: Record<string, unknown> | null | undefined) {
  const attributes = body?.attributes && typeof body.attributes === "object"
    ? (body.attributes as Record<string, unknown>)
    : {};
  return [body?.linkedin, body?.linkedin_url, attributes.linkedin, attributes.linkedin_url, attributes.person_linkedin_url]
    .map(linkedinSlug)
    .filter(Boolean);
}

export function domainFromEmail(email: string) {
  const domain = emailDomain(email);
  return domain && !isExcludedMatchDomain(domain) ? domain : null;
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  const record = error as { code?: string; message?: string };
  return record.code || String(record.message || "unknown").slice(0, 80);
}
