import "server-only";

import { supabaseService } from "@/lib/supabase";
import {
  meetingInstanceKey,
  shareableCalendarSource,
} from "@/lib/shared-meet-capture";

export type SharedUpcomingCall = {
  id: string;
  workspace_id: string;
  owner_id: string;
  company_id?: string | null;
  workstream_id?: string | null;
  title?: string | null;
  scheduled_at: string;
  meeting_url: string | null;
  source: string | null;
  external_id: string | null;
  completed_at?: string | null;
  attendees: unknown;
  intent?: string | null;
  prepped?: boolean | null;
  prep?: unknown;
};

export type SharedOccurrenceMember = {
  userId: string;
  upcomingId: string;
  accessRole: "host" | "attendee";
};

export type SharedCalendarOccurrence = {
  instanceKey: string;
  requested: SharedUpcomingCall;
  canonical: SharedUpcomingCall;
  hostOwnerId: string;
  members: SharedOccurrenceMember[];
};

const normaliseEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

function attendeeRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object"
      )
    : [];
}

function attendeeEmail(row: Record<string, unknown>) {
  return normaliseEmail(
    row.email ||
      (row.emailAddress && typeof row.emailAddress === "object"
        ? (row.emailAddress as Record<string, unknown>).address
        : "")
  );
}

function organiserEmail(rows: SharedUpcomingCall[]) {
  for (const row of rows) {
    for (const attendee of attendeeRows(row.attendees)) {
      if (attendee.organizer === true || attendee.organiser === true) {
        const email = attendeeEmail(attendee);
        if (email) return email;
      }
    }
  }
  return "";
}

async function workspaceMemberEmails(workspaceId: string) {
  const { data: memberships, error: membershipError } = await supabaseService
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (membershipError) throw membershipError;
  const userIds = (memberships || []).map((row: any) => String(row.user_id));
  const byUser = new Map<string, Set<string>>(
    userIds.map((userId) => [userId, new Set<string>()])
  );
  if (!userIds.length) return byUser;

  const [{ data: profiles }, { data: google }, { data: microsoft }] =
    await Promise.all([
      supabaseService.from("profiles").select("user_id,email").in("user_id", userIds),
      supabaseService
        .from("google_oauth")
        .select("owner_id,email")
        .eq("workspace_id", workspaceId)
        .in("owner_id", userIds),
      supabaseService
        .from("microsoft_oauth")
        .select("owner_id,email")
        .eq("workspace_id", workspaceId)
        .in("owner_id", userIds),
    ]);

  for (const row of profiles || []) {
    const email = normaliseEmail((row as any).email);
    if (email) byUser.get(String((row as any).user_id))?.add(email);
  }
  for (const row of [...(google || []), ...(microsoft || [])]) {
    const email = normaliseEmail((row as any).email);
    if (email) byUser.get(String((row as any).owner_id))?.add(email);
  }
  return byUser;
}

// Resolve only sibling rows for the exact provider occurrence already verified
// as belonging to the signed-in user. A meeting URL by itself never grants
// access. Matching the provider id, normalised URL and scheduled minute keeps
// recurring calls and copied links separate.
export async function resolveSharedCalendarOccurrence(
  requested: SharedUpcomingCall
): Promise<SharedCalendarOccurrence | null> {
  if (
    !shareableCalendarSource(requested.source, requested.external_id) ||
    !requested.meeting_url
  ) {
    return null;
  }
  const instanceKey = meetingInstanceKey(
    requested.meeting_url,
    requested.scheduled_at
  );
  if (!instanceKey) return null;

  const { data, error } = await supabaseService
    .from("upcoming_calls")
    .select(
      "id,workspace_id,owner_id,company_id,workstream_id,title,scheduled_at,meeting_url,source,external_id,completed_at,attendees,intent,prepped,prep"
    )
    .eq("workspace_id", requested.workspace_id)
    .eq("source", requested.source)
    .eq("external_id", requested.external_id)
    .limit(50);
  if (error) throw error;

  const siblings = ((data || []) as SharedUpcomingCall[]).filter(
    (row) => meetingInstanceKey(row.meeting_url, row.scheduled_at) === instanceKey
  );
  if (!siblings.some((row) => row.id === requested.id)) siblings.push(requested);

  const identities = await workspaceMemberEmails(requested.workspace_id);
  const invitedEmails = new Set<string>();
  for (const row of siblings) {
    for (const attendee of attendeeRows(row.attendees)) {
      const email = attendeeEmail(attendee);
      if (email) invitedEmails.add(email);
    }
  }
  const organiser = organiserEmail(siblings);
  const userForEmail = (email: string) =>
    [...identities.entries()].find(([, emails]) => emails.has(email))?.[0] || null;
  const organiserUserId = organiser ? userForEmail(organiser) : null;
  const canonical =
    siblings.find((row) => row.owner_id === organiserUserId) || requested;
  const hostOwnerId = canonical.owner_id;

  const members: SharedOccurrenceMember[] = [];
  for (const row of siblings) {
    const emails = identities.get(row.owner_id) || new Set<string>();
    const isVerifiedAttendee =
      row.owner_id === requested.owner_id ||
      [...emails].some((email) => invitedEmails.has(email));
    if (!isVerifiedAttendee || members.some((item) => item.userId === row.owner_id)) {
      continue;
    }
    members.push({
      userId: row.owner_id,
      upcomingId: row.id,
      accessRole: row.owner_id === hostOwnerId ? "host" : "attendee",
    });
  }

  return {
    instanceKey,
    requested,
    canonical,
    hostOwnerId,
    members,
  };
}

export async function grantSharedCaptureAccess(input: {
  captureId: string;
  occurrence: SharedCalendarOccurrence;
  captureOwnerId: string;
}) {
  const rows = input.occurrence.members.map((member) => ({
    capture_id: input.captureId,
    workspace_id: input.occurrence.requested.workspace_id,
    user_id: member.userId,
    upcoming_id: member.upcomingId,
    access_role: member.accessRole,
    grant_source:
      member.userId === input.captureOwnerId
        ? "capture_owner"
        : "calendar_attendee",
    revoked_at: null,
  }));
  if (!rows.length) return;
  const { error } = await supabaseService
    .from("meet_capture_access")
    .upsert(rows, { onConflict: "capture_id,user_id" });
  if (error) throw error;
}

export async function loadSharedCallAccess(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  const { data: captures, error: captureError } = await supabaseService
    .from("meet_bots")
    .select(
      "id,session_id,owner_id,host_owner_id,canonical_upcoming_id,source_upcoming_id,created_at"
    )
    .eq("workspace_id", input.workspaceId)
    .eq("session_id", input.sessionId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (captureError) throw captureError;
  for (const capture of captures || []) {
    const { data: access, error: accessError } = await supabaseService
      .from("meet_capture_access")
      .select("access_role,upcoming_id")
      .eq("workspace_id", input.workspaceId)
      .eq("capture_id", (capture as any).id)
      .eq("user_id", input.userId)
      .is("revoked_at", null)
      .maybeSingle();
    if (accessError) throw accessError;
    if (access) return { capture, access };
  }
  return null;
}

export async function completeSharedUpcomingCalls(input: {
  workspaceId: string;
  userId: string;
  sessionId: string;
}) {
  const verified = await loadSharedCallAccess(input);
  if (!verified) return [] as string[];
  const { data: grants, error } = await supabaseService
    .from("meet_capture_access")
    .select("upcoming_id")
    .eq("workspace_id", input.workspaceId)
    .eq("capture_id", (verified.capture as any).id)
    .is("revoked_at", null);
  if (error) throw error;
  const upcomingIds = Array.from(
    new Set(
      (grants || [])
        .map((row: any) => String(row.upcoming_id || ""))
        .filter(Boolean)
    )
  );
  if (!upcomingIds.length) return [] as string[];
  const completedAt = new Date().toISOString();
  const guard = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error: updateError } = await supabaseService
    .from("upcoming_calls")
    .update({ completed_at: completedAt })
    .eq("workspace_id", input.workspaceId)
    .in("id", upcomingIds)
    .is("completed_at", null)
    .lte("scheduled_at", guard);
  if (updateError) throw updateError;
  return upcomingIds;
}

export function sharedFocusPrep(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const prep = value as Record<string, unknown>;
  const keys = [
    "brief",
    "role",
    "callType",
    "candidate",
    "character",
    "suggestedComps",
    "selectedComps",
    "goals",
    "openingQuestions",
    "planStage",
    "focusBasisBrief",
    "intentMeta",
  ];
  return Object.fromEntries(
    keys.filter((key) => key in prep).map((key) => [key, prep[key]])
  );
}
