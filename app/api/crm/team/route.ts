import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendConnectedMail } from "@/lib/mail";
import { requireWorkspaceOwner } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { deriveTranscriberName } from "@/lib/transcriber";
import { publicAppOrigin } from "@/lib/public-app-url";
import { buildTeamInvitationActionUrl } from "@/lib/team-invitation-link";
import {
  calculateTranscriberUsage,
  londonDayBounds,
  TRANSCRIBER_DAILY_LIMIT_MAX,
  TRANSCRIBER_DAILY_LIMIT_MIN,
  TRANSCRIBER_HARD_LIMIT_SECONDS,
} from "@/lib/transcriber-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["manager", "sales"]);

const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

async function workspaceOwnerIdentities(workspaceId: string) {
  const { data: ownerMember, error: ownerError } = await supabaseService
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner")
    .neq("status", "removed")
    .limit(1)
    .maybeSingle();
  if (ownerError) throw ownerError;
  if (!ownerMember?.user_id) return new Set<string>();

  const [
    { data: profile, error: profileError },
    { data: google, error: googleError },
    { data: microsoft, error: microsoftError },
  ] =
    await Promise.all([
      supabaseService
        .from("profiles")
        .select("email")
        .eq("user_id", ownerMember.user_id)
        .maybeSingle(),
      supabaseService
        .from("google_oauth")
        .select("email")
        .eq("owner_id", ownerMember.user_id)
        .maybeSingle(),
      supabaseService
        .from("microsoft_oauth")
        .select("email")
        .eq("owner_id", ownerMember.user_id)
        .maybeSingle(),
    ]);
  if (profileError) throw profileError;
  if (googleError) throw googleError;
  if (microsoftError) throw microsoftError;

  return new Set(
    [
      normalizeEmail(profile?.email),
      normalizeEmail(google?.email),
      normalizeEmail(microsoft?.email),
    ].filter(Boolean)
  );
}

async function memberSetupEvidence(workspaceId: string, userId: string) {
  const [assignedResult, sentResult, transcriptResult] = await Promise.all([
    supabaseService
      .from("outreach_prospects")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("visibility", "team")
      .eq("assigned_to_user_id", userId),
    supabaseService
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("sender_user_id", userId)
      .eq("status", "sent"),
    supabaseService
      .from("interview_sessions")
      .select("session_id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("owner_id", userId)
      .not("transcript", "is", null),
  ]);
  for (const result of [assignedResult, sentResult, transcriptResult]) {
    if (result.error) throw result.error;
  }
  return {
    assignedProspects: assignedResult.count || 0,
    sentMessages: sentResult.count || 0,
    transcribedCalls: transcriptResult.count || 0,
  };
}

const htmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export async function GET() {
  try {
    const scope = requireWorkspaceOwner();
    const [membersResult, invitationsResult, prospectsResult, companiesResult, opportunitiesResult] =
      await Promise.all([
        supabaseService
          .from("workspace_members")
          .select("user_id,role,status,transcriber_daily_minutes_limit,created_at,updated_at")
          .eq("workspace_id", scope.workspaceId)
          .order("created_at", { ascending: true }),
        supabaseService
          .from("workspace_invitations")
          .select("id,email,role,status,expires_at,created_at,accepted_at")
          .eq("workspace_id", scope.workspaceId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabaseService
          .from("outreach_prospects")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", scope.workspaceId)
          .eq("visibility", "team"),
        supabaseService
          .from("companies")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", scope.workspaceId)
          .eq("visibility", "team"),
        supabaseService
          .from("opportunities")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", scope.workspaceId)
          .eq("visibility", "team"),
      ]);
    for (const result of [membersResult, invitationsResult]) {
      if (result.error) throw result.error;
    }

    const memberIds = (membersResult.data || []).map((row) => row.user_id);
    const now = new Date();
    const { start: todayStart, end: todayEnd } = londonDayBounds(now);
    const usageWindowStart = new Date(
      todayStart.getTime() - TRANSCRIBER_HARD_LIMIT_SECONDS * 1000
    );
    const [
      { data: profiles, error: profilesError },
      { data: googleRows, error: googleError },
      { data: microsoftRows, error: microsoftError },
      { data: botRows, error: botRowsError },
    ] =
      memberIds.length
        ? await Promise.all([
            supabaseService
              .from("profiles")
              .select("user_id,display_name,email,transcriber_name,outreach_sender_name,outreach_sender_email")
              .in("user_id", memberIds),
            supabaseService
              .from("google_oauth")
              .select("owner_id,email,refresh_token")
              .in("owner_id", memberIds),
            supabaseService
              .from("microsoft_oauth")
              .select("owner_id,email,refresh_token")
              .in("owner_id", memberIds),
            supabaseService
              .from("meet_bots")
              .select("owner_id,created_at,ended_at,status")
              .eq("workspace_id", scope.workspaceId)
              .in("owner_id", memberIds)
              .gte("created_at", usageWindowStart.toISOString())
              .lt("created_at", todayEnd.toISOString()),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];
    if (profilesError) throw profilesError;
    if (googleError) throw googleError;
    if (microsoftError) throw microsoftError;
    if (botRowsError) throw botRowsError;

    const nonOwnerIds = (membersResult.data || [])
      .filter((member) => member.role !== "owner")
      .map((member) => member.user_id);
    const [ownerIdentities, setupEntries, privacyEventsResult] = await Promise.all([
      workspaceOwnerIdentities(scope.workspaceId),
      Promise.all(
        nonOwnerIds.map(async (userId) => [
          userId,
          await memberSetupEvidence(scope.workspaceId, userId),
        ] as const)
      ),
      nonOwnerIds.length
        ? supabaseService
            .from("access_audit_events")
            .select("target_id,action,created_at")
            .eq("workspace_id", scope.workspaceId)
            .eq("target_table", "workspace_members")
            .in("target_id", nonOwnerIds)
            .in("action", [
              "workspace_member_privacy_test_confirmed",
              "workspace_member_privacy_test_reset",
            ])
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (privacyEventsResult.error) throw privacyEventsResult.error;

    const profileByUser = new Map(
      (profiles || []).map((profile: any) => [profile.user_id, profile])
    );
    const googleByUser = new Map(
      (googleRows || []).map((row: any) => [row.owner_id, row])
    );
    const microsoftByUser = new Map(
      (microsoftRows || []).map((row: any) => [row.owner_id, row])
    );
    const setupByUser = new Map(setupEntries);
    const latestPrivacyEventByUser = new Map<string, any>();
    for (const event of privacyEventsResult.data || []) {
      if (event.target_id && !latestPrivacyEventByUser.has(event.target_id)) {
        latestPrivacyEventByUser.set(event.target_id, event);
      }
    }
    const members = (membersResult.data || []).map((member: any) => {
      const profile = profileByUser.get(member.user_id) as any;
      const google = googleByUser.get(member.user_id) as any;
      const microsoft = microsoftByUser.get(member.user_id) as any;
      const memberEmail = normalizeEmail(profile?.email);
      const googleEmail = normalizeEmail(google?.email);
      const microsoftEmail = normalizeEmail(microsoft?.email);
      const mailboxEmail = googleEmail || microsoftEmail;
      const connectorIdentitySafe =
        (!googleEmail || !ownerIdentities.has(googleEmail)) &&
        (!microsoftEmail || !ownerIdentities.has(microsoftEmail));
      const separateIdentity =
        member.role === "owner"
          ? false
          : !!memberEmail &&
            !ownerIdentities.has(memberEmail) &&
            connectorIdentitySafe;
      const setupEvidence = setupByUser.get(member.user_id) || {
        assignedProspects: 0,
        sentMessages: 0,
        transcribedCalls: 0,
      };
      const privacyEvent = latestPrivacyEventByUser.get(member.user_id);
      const privacyTestConfirmed =
        privacyEvent?.action === "workspace_member_privacy_test_confirmed";
      const outreachSenderReady =
        separateIdentity &&
        !!normalizeEmail(profile?.outreach_sender_email) &&
        !!String(profile?.outreach_sender_name || "").trim();
      const transcriberUsage = calculateTranscriberUsage(
        botRows || [],
        member.user_id,
        member.transcriber_daily_minutes_limit,
        now
      );
      return {
        ...member,
        displayName: profile?.display_name || null,
        email: profile?.email || null,
        googleConnected: !!google?.refresh_token,
        googleEmail: google?.email || null,
        microsoftConnected: !!microsoft?.refresh_token,
        microsoftEmail: microsoft?.email || null,
        mailboxProvider: google?.refresh_token
          ? "google"
          : microsoft?.refresh_token
            ? "microsoft"
            : null,
        mailboxConnected: !!google?.refresh_token || !!microsoft?.refresh_token,
        outreachSenderName: profile?.outreach_sender_name || profile?.display_name || null,
        outreachSenderEmail: profile?.outreach_sender_email || mailboxEmail || null,
        canActivate:
          member.status !== "active" &&
          member.status !== "removed" &&
          !!profile?.display_name &&
          separateIdentity,
        activationIssues: [
          ...(!profile?.display_name ? ["Finish account setup"] : []),
          ...(!memberEmail || ownerIdentities.has(memberEmail)
            ? ["Use a login address that is different from Lee's owner account"]
            : []),
          ...(!connectorIdentitySafe
            ? ["Use a mailbox that is different from Lee's owner connections"]
            : []),
        ],
        transcriberName:
          profile?.transcriber_name ||
          deriveTranscriberName(profile?.display_name || null),
        transcriberUsage,
        setup: {
          separateIdentity,
          outreachSenderReady,
          assignedProspects: setupEvidence.assignedProspects,
          sentMessages: setupEvidence.sentMessages,
          transcribedCalls: setupEvidence.transcribedCalls,
          privacyTestConfirmed,
          privacyTestConfirmedAt: privacyTestConfirmed ? privacyEvent?.created_at || null : null,
          canConfirmPrivacy:
            member.status === "active" &&
            separateIdentity &&
            outreachSenderReady &&
            setupEvidence.assignedProspects > 0 &&
            setupEvidence.sentMessages > 0 &&
            setupEvidence.transcribedCalls > 0,
        },
      };
    });

    return NextResponse.json(
      {
        members,
        invitations: invitationsResult.data || [],
        sharedData: {
          outreachProspects: prospectsResult.count || 0,
          companies: companiesResult.count || 0,
          opportunities: opportunitiesResult.count || 0,
        },
        activation: {
          ready: true,
          reason:
            "After separate account setup, the owner can activate CRM access. Google or Microsoft is optional and unlocks only that user's email and calendar features.",
        },
        ownerIdentities: [...ownerIdentities],
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Team access is unavailable" },
      { status: 403 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const scope = requireWorkspaceOwner();
    const body = await req.json();
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const action = [
      "activate",
      "suspend",
      "update_transcriber_limit",
      "confirm_privacy_test",
      "reset_privacy_test",
    ].includes(body.action)
      ? body.action
      : "";
    if (!userId || !action)
      return NextResponse.json({ error: "Choose an account action" }, { status: 400 });
    if (userId === scope.userId && action !== "update_transcriber_limit")
      return NextResponse.json({ error: "The workspace owner cannot suspend their own account here" }, { status: 400 });

    const { data: member, error: memberError } = await supabaseService
      .from("workspace_members")
      .select("user_id,role,status,transcriber_daily_minutes_limit")
      .eq("workspace_id", scope.workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.status === "removed")
      return NextResponse.json({ error: "Team account not found" }, { status: 404 });

    if (action === "confirm_privacy_test" || action === "reset_privacy_test") {
      if (member.role === "owner") {
        return NextResponse.json(
          { error: "The privacy rehearsal is only for a separate team account" },
          { status: 400 }
        );
      }
      if (action === "confirm_privacy_test") {
        const [
          ownerIdentities,
          setupEvidence,
          profileResult,
          googleResult,
          microsoftResult,
        ] =
          await Promise.all([
            workspaceOwnerIdentities(scope.workspaceId),
            memberSetupEvidence(scope.workspaceId, userId),
            supabaseService
              .from("profiles")
              .select("email,outreach_sender_name,outreach_sender_email")
              .eq("user_id", userId)
              .maybeSingle(),
            supabaseService
              .from("google_oauth")
              .select("email,refresh_token")
              .eq("owner_id", userId)
              .maybeSingle(),
            supabaseService
              .from("microsoft_oauth")
              .select("email,refresh_token")
              .eq("owner_id", userId)
              .maybeSingle(),
          ]);
        if (profileResult.error) throw profileResult.error;
        if (googleResult.error) throw googleResult.error;
        if (microsoftResult.error) throw microsoftResult.error;

        const memberEmail = normalizeEmail(profileResult.data?.email);
        const googleEmail = normalizeEmail(googleResult.data?.email);
        const microsoftEmail = normalizeEmail(microsoftResult.data?.email);
        const mailboxConnected =
          (!!googleResult.data?.refresh_token && !!googleEmail) ||
          (!!microsoftResult.data?.refresh_token && !!microsoftEmail);
        const separateIdentity =
          !!memberEmail &&
          !ownerIdentities.has(memberEmail) &&
          (!googleEmail || !ownerIdentities.has(googleEmail)) &&
          (!microsoftEmail || !ownerIdentities.has(microsoftEmail));
        const senderReady =
          !!normalizeEmail(profileResult.data?.outreach_sender_email) &&
          !!String(profileResult.data?.outreach_sender_name || "").trim();
        const missing = [
          ...(member.status !== "active" ? ["activate the isolated account"] : []),
          ...(!separateIdentity ? ["use a separate login and mailbox identity"] : []),
          ...(!mailboxConnected ? ["connect Google or Microsoft for the outreach test"] : []),
          ...(!senderReady ? ["finish the outreach sender setup"] : []),
          ...(setupEvidence.assignedProspects < 1 ? ["assign a test prospect"] : []),
          ...(setupEvidence.sentMessages < 1 ? ["send a test outreach email"] : []),
          ...(setupEvidence.transcribedCalls < 1 ? ["complete a transcribed test call"] : []),
        ];
        if (missing.length) {
          return NextResponse.json(
            { error: `Finish these checks first. ${missing.join(". ")}.` },
            { status: 409 }
          );
        }
        const { error: privacyAuditError } = await supabaseService
          .from("access_audit_events")
          .insert({
            workspace_id: scope.workspaceId,
            actor_user_id: scope.userId,
            source: "human",
            action: "workspace_member_privacy_test_confirmed",
            target_table: "workspace_members",
            target_id: userId,
            next_scope: { privacy_test_confirmed: true },
            metadata: {
              assignedProspects: setupEvidence.assignedProspects,
              sentMessages: setupEvidence.sentMessages,
              transcribedCalls: setupEvidence.transcribedCalls,
            },
          });
        if (privacyAuditError) throw privacyAuditError;
      } else {
        const { error: privacyResetError } = await supabaseService
          .from("access_audit_events")
          .insert({
            workspace_id: scope.workspaceId,
            actor_user_id: scope.userId,
            source: "human",
            action: "workspace_member_privacy_test_reset",
            target_table: "workspace_members",
            target_id: userId,
            next_scope: { privacy_test_confirmed: false },
          });
        if (privacyResetError) throw privacyResetError;
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "update_transcriber_limit") {
      const dailyMinutes = Number(body.dailyMinutes);
      if (
        !Number.isInteger(dailyMinutes) ||
        dailyMinutes < TRANSCRIBER_DAILY_LIMIT_MIN ||
        dailyMinutes > TRANSCRIBER_DAILY_LIMIT_MAX
      ) {
        return NextResponse.json(
          {
            error: `Choose a daily allowance from ${TRANSCRIBER_DAILY_LIMIT_MIN} to ${TRANSCRIBER_DAILY_LIMIT_MAX} minutes`,
          },
          { status: 400 }
        );
      }
      const { data: updated, error: updateError } = await supabaseService
        .from("workspace_members")
        .update({
          transcriber_daily_minutes_limit: dailyMinutes,
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", scope.workspaceId)
        .eq("user_id", userId)
        .select("user_id,role,status,transcriber_daily_minutes_limit")
        .single();
      if (updateError) throw updateError;
      await supabaseService.from("access_audit_events").insert({
        workspace_id: scope.workspaceId,
        actor_user_id: scope.userId,
        source: "human",
        action: "workspace_member_transcriber_limit_updated",
        target_table: "workspace_members",
        target_id: userId,
        previous_scope: {
          transcriber_daily_minutes_limit:
            member.transcriber_daily_minutes_limit,
        },
        next_scope: { transcriber_daily_minutes_limit: dailyMinutes },
      });
      return NextResponse.json({ member: updated });
    }

    if (action === "activate") {
      const [
        { data: profile, error: profileError },
        { data: google, error: googleError },
        { data: microsoft, error: microsoftError },
        ownerIdentities,
      ] =
        await Promise.all([
          supabaseService
            .from("profiles")
            .select("display_name,email,outreach_sender_name,outreach_sender_email")
            .eq("user_id", userId)
            .maybeSingle(),
          supabaseService
            .from("google_oauth")
            .select("email,refresh_token")
            .eq("owner_id", userId)
            .maybeSingle(),
          supabaseService
            .from("microsoft_oauth")
            .select("email,refresh_token")
            .eq("owner_id", userId)
            .maybeSingle(),
          workspaceOwnerIdentities(scope.workspaceId),
        ]);
      if (profileError) throw profileError;
      if (googleError) throw googleError;
      if (microsoftError) throw microsoftError;
      if (!profile?.display_name)
        return NextResponse.json({ error: "This person must finish account setup first" }, { status: 409 });
      const memberEmail = normalizeEmail(profile.email);
      if (!memberEmail || ownerIdentities.has(memberEmail)) {
        return NextResponse.json(
          { error: "This person must use a login address separate from Lee's owner account" },
          { status: 409 }
        );
      }
      const { data: otherMembers, error: otherMembersError } = await supabaseService
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", scope.workspaceId)
        .neq("user_id", userId)
        .neq("status", "removed");
      if (otherMembersError) throw otherMembersError;
      const otherMemberIds = (otherMembers || []).map((row) => row.user_id);
      if (otherMemberIds.length && google?.refresh_token && google.email) {
        const { data: duplicateGoogle, error: duplicateGoogleError } = await supabaseService
          .from("google_oauth")
          .select("owner_id")
          .in("owner_id", otherMemberIds)
          .ilike("email", normalizeEmail(google.email))
          .limit(1)
          .maybeSingle();
        if (duplicateGoogleError) throw duplicateGoogleError;
        if (duplicateGoogle?.owner_id) {
          return NextResponse.json(
            {
              error:
                "This Google account is already connected to another workspace member. Use a genuinely separate work account.",
            },
            { status: 409 }
          );
        }
      }
      if (otherMemberIds.length && microsoft?.refresh_token && microsoft.email) {
        const { data: duplicateMicrosoft, error: duplicateMicrosoftError } =
          await supabaseService
            .from("microsoft_oauth")
            .select("owner_id")
            .in("owner_id", otherMemberIds)
            .ilike("email", normalizeEmail(microsoft.email))
            .limit(1)
            .maybeSingle();
        if (duplicateMicrosoftError) throw duplicateMicrosoftError;
        if (duplicateMicrosoft?.owner_id) {
          return NextResponse.json(
            {
              error:
                "This Microsoft account is already connected to another workspace member. Use a genuinely separate work account.",
            },
            { status: 409 }
          );
        }
      }
      const senderName = String(profile.display_name).trim();
      // CRM access is provider-neutral. A verified mailbox unlocks outreach,
      // but its absence never grants access to another member's connection.
      const senderEmail = normalizeEmail(google?.email || microsoft?.email);
      const { error: profileUpdateError } = await supabaseService
        .from("profiles")
        .update({
          outreach_sender_name: senderEmail ? senderName : null,
          outreach_sender_email: senderEmail || null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      if (profileUpdateError) throw profileUpdateError;
    } else {
      await Promise.all([
        supabaseService
          .from("meet_stream_tokens")
          .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", userId)
          .is("revoked_at", null),
        supabaseService
          .from("meet_bots")
          .update({ status: "left", ended_at: new Date().toISOString() })
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", userId)
          .eq("status", "active"),
      ]);
    }

    const nextStatus = action === "activate" ? "active" : "suspended";
    const { data: updated, error: updateError } = await supabaseService
      .from("workspace_members")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("workspace_id", scope.workspaceId)
      .eq("user_id", userId)
      .select("user_id,role,status")
      .single();
    if (updateError) throw updateError;
    await supabaseService.from("access_audit_events").insert({
      workspace_id: scope.workspaceId,
      actor_user_id: scope.userId,
      source: "human",
      action: action === "activate" ? "workspace_member_activated" : "workspace_member_suspended",
      target_table: "workspace_members",
      target_id: userId,
      previous_scope: { status: member.status },
      next_scope: { status: nextStatus },
    });
    return NextResponse.json({ member: updated });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not update team access" },
      { status: 403 }
    );
  }
}

export async function POST(req: NextRequest) {
  let invitationId: string | null = null;
  try {
    const scope = requireWorkspaceOwner();
    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = typeof body.role === "string" ? body.role : "sales";
    if (!EMAIL.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Enter a valid work email" }, { status: 400 });
    }
    if (!ROLES.has(role)) {
      return NextResponse.json({ error: "Choose sales or manager access" }, { status: 400 });
    }

    const ownerIdentities = await workspaceOwnerIdentities(scope.workspaceId);
    if (ownerIdentities.has(email)) {
      return NextResponse.json(
        {
          error:
            "That is Lee's owner account. A privacy test requires a genuinely separate email address.",
        },
        { status: 409 }
      );
    }

    const { data: existingProfile } = await supabaseService
      .from("profiles")
      .select("user_id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (existingProfile?.user_id) {
      const { data: existingMember } = await supabaseService
        .from("workspace_members")
        .select("status")
        .eq("workspace_id", scope.workspaceId)
        .eq("user_id", existingProfile.user_id)
        .maybeSingle();
      if (existingMember && existingMember.status !== "removed") {
        return NextResponse.json(
          { error: "That person already has a workspace account" },
          { status: 409 }
        );
      }
    }

    // A pending invitation cannot be reused because only the hashed token is
    // stored. Replace it when Lee resends so the old broken or exposed link is
    // invalid immediately and the new email receives a fresh seven-day token.
    const { data: replacedInvitations, error: replaceError } = await supabaseService
      .from("workspace_invitations")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("workspace_id", scope.workspaceId)
      .ilike("email", email)
      .eq("status", "pending")
      .select("id");
    if (replaceError) throw replaceError;

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: invitation, error: invitationError } = await supabaseService
      .from("workspace_invitations")
      .insert({
        workspace_id: scope.workspaceId,
        email,
        role,
        status: "pending",
        token_hash: tokenHash,
        invited_by: scope.userId,
        expires_at: expiresAt,
      })
      .select("id,email,role,status,expires_at,created_at")
      .single();
    if (invitationError) {
      if (invitationError.code === "23505") {
        return NextResponse.json(
          { error: "A live invitation already exists for that email" },
          { status: 409 }
        );
      }
      throw invitationError;
    }
    invitationId = invitation.id;

    const appUrl = publicAppOrigin(req.nextUrl.origin);
    const { data: usersData, error: usersError } =
      await supabaseService.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) throw usersError;
    const existingAuthUser = usersData.users.find(
      (user) => user.email?.toLowerCase() === email
    );
    const { data: linkData, error: linkError } =
      await supabaseService.auth.admin.generateLink({
        type: existingAuthUser ? "magiclink" : "invite",
        email,
      } as any);
    if (linkError) throw linkError;
    const verificationType = linkData.properties?.verification_type;
    if (verificationType !== "invite" && verificationType !== "magiclink") {
      throw new Error("Supabase created an unsupported invitation type");
    }
    const actionLink = buildTeamInvitationActionUrl({
      appOrigin: appUrl,
      authTokenHash: linkData.properties.hashed_token,
      authVerificationType: verificationType,
      workspaceInvitationToken: rawToken,
    });

    const safeLink = htmlEscape(actionLink);
    const sent = await sendConnectedMail({
      to: email,
      subject: "Your LiveCoach sales workspace invitation",
      text: `Lee has invited you to the Interviewa LiveCoach sales workspace. Open this secure link within seven days to set up your account. Google or Microsoft is optional for core CRM access. ${actionLink}`,
      html: `<p>Lee has invited you to the Interviewa LiveCoach sales workspace.</p><p>You will set up your own login. Google or Microsoft can then be connected for your own email and calendar, but neither is required for core CRM access. Lee's private calls, emails, investors and Brain history are not shared with your account.</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#d9a35f;color:#171614;text-decoration:none;font-weight:700;">Set up LiveCoach</a></p><p>This secure invitation expires in seven days.</p>`,
    });
    if (!sent.ok) throw new Error(sent.error || "The invitation email could not be sent");

    await supabaseService.from("access_audit_events").insert({
      workspace_id: scope.workspaceId,
      actor_user_id: scope.userId,
      source: "human",
      action: "workspace_invitation_sent",
      target_table: "workspace_invitations",
      target_id: invitation.id,
      next_scope: { email, role, status: "pending" },
    });
    if (replacedInvitations?.length) {
      await supabaseService.from("access_audit_events").insert(
        replacedInvitations.map((replaced) => ({
          workspace_id: scope.workspaceId,
          actor_user_id: scope.userId,
          source: "human",
          action: "workspace_invitation_replaced",
          target_table: "workspace_invitations",
          target_id: replaced.id,
          previous_scope: { email, status: "pending" },
          next_scope: { email, status: "revoked", replacement_id: invitation.id },
        }))
      );
    }

    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error: any) {
    if (invitationId) {
      await supabaseService
        .from("workspace_invitations")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", invitationId)
        .eq("status", "pending");
    }
    return NextResponse.json(
      { error: error?.message || "Could not send the invitation" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const scope = requireWorkspaceOwner();
    const body = await req.json();
    const invitationId = typeof body.invitationId === "string" ? body.invitationId : "";
    if (!invitationId) {
      return NextResponse.json({ error: "Invitation id is required" }, { status: 400 });
    }
    const { data, error } = await supabaseService
      .from("workspace_invitations")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("workspace_id", scope.workspaceId)
      .eq("id", invitationId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Live invitation not found" }, { status: 404 });
    await supabaseService.from("access_audit_events").insert({
      workspace_id: scope.workspaceId,
      actor_user_id: scope.userId,
      source: "human",
      action: "workspace_invitation_revoked",
      target_table: "workspace_invitations",
      target_id: invitationId,
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not revoke the invitation" },
      { status: 403 }
    );
  }
}
