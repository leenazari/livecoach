import { NextResponse } from "next/server";

import {
  buildAccountReadiness,
  type AccountReadiness,
  type AccountReadinessFacts,
} from "@/lib/account-readiness";
import { gmailAccessDiagnostic } from "@/lib/gmail";
import {
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  googleConnected,
  googleGrantedScopes,
} from "@/lib/google";
import {
  microsoftAccessStatus,
  microsoftConnected,
} from "@/lib/microsoft";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { deriveTranscriberName } from "@/lib/transcriber";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "private, no-store" };

const normaliseEmail = (value: unknown) =>
  String(value || "").trim().toLowerCase();

const latestIso = (...values: Array<string | null | undefined>) =>
  values
    .filter((value): value is string => {
      if (!value) return false;
      return Number.isFinite(Date.parse(value));
    })
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;

const hasMicrosoftScope = (scopes: unknown, ...wanted: string[]) => {
  const granted = new Set(
    (Array.isArray(scopes) ? scopes : [])
      .map((scope) => String(scope || "").toLowerCase())
      .filter(Boolean)
  );
  return wanted.some((scope) => granted.has(scope.toLowerCase()));
};

export async function GET() {
  try {
    const scope = requireRequestScope();
    let membershipQuery = supabaseService
      .from("workspace_members")
      .select("user_id,role,status")
      .eq("workspace_id", scope.workspaceId)
      .neq("status", "removed")
      .order("created_at", { ascending: true });
    if (scope.role !== "owner") {
      membershipQuery = membershipQuery.eq("user_id", scope.userId);
    }
    const { data: members, error: membersError } = await membershipQuery;
    if (membersError) throw membersError;

    const memberIds = (members || []).map((member: any) => member.user_id);
    if (!memberIds.includes(scope.userId)) {
      throw new Error("The signed in account is not an active workspace member");
    }

    const [
      profilesResult,
      googleResult,
      microsoftResult,
      salesProfilesResult,
      calendarSyncResult,
      prospectsResult,
      sharedClientsResult,
      sentMessagesResult,
      transcriptEvidenceResult,
      auditResult,
    ] = await Promise.all([
      supabaseService
        .from("profiles")
        .select(
          "user_id,display_name,email,transcriber_name,outreach_sender_name,outreach_sender_email"
        )
        .in("user_id", memberIds),
      supabaseService
        .from("google_oauth")
        .select("owner_id,email,refresh_token,updated_at")
        .eq("workspace_id", scope.workspaceId)
        .in("owner_id", memberIds),
      supabaseService
        .from("microsoft_oauth")
        .select("owner_id,email,refresh_token,scopes,updated_at")
        .eq("workspace_id", scope.workspaceId)
        .in("owner_id", memberIds),
      supabaseService
        .from("salesperson_profiles")
        .select("user_id,completed_at")
        .eq("workspace_id", scope.workspaceId)
        .in("user_id", memberIds),
      supabaseService
        .from("app_config")
        .select("owner_id,value,updated_at")
        .eq("workspace_id", scope.workspaceId)
        .eq("visibility", "private")
        .eq("key", "calendar_sync_last_success_at")
        .in("owner_id", memberIds)
        .order("updated_at", { ascending: false }),
      supabaseService
        .from("outreach_prospects")
        .select("assigned_to_user_id,status")
        .eq("workspace_id", scope.workspaceId)
        .eq("visibility", "team")
        .neq("status", "suppressed")
        .limit(5000),
      supabaseService
        .from("team_client_shares")
        .select("assigned_to_user_id,status")
        .eq("workspace_id", scope.workspaceId)
        .eq("status", "active")
        .limit(3000),
      supabaseService
        .from("outreach_messages")
        .select("sender_user_id,from_email,sent_at,status")
        .eq("workspace_id", scope.workspaceId)
        .eq("status", "sent")
        .in("sender_user_id", memberIds)
        .order("sent_at", { ascending: false })
        .limit(5000),
      supabaseService
        .from("interview_sessions")
        .select("owner_id,created_at")
        .eq("workspace_id", scope.workspaceId)
        .in("owner_id", memberIds)
        .not("transcript", "is", null)
        .order("created_at", { ascending: false })
        .limit(3000),
      supabaseService
        .from("access_audit_events")
        .select("target_id,action,created_at")
        .eq("workspace_id", scope.workspaceId)
        .in("action", [
          "workspace_member_privacy_test_confirmed",
          "workspace_member_privacy_test_reset",
          "account_readiness_test_email_completed",
        ])
        .order("created_at", { ascending: false })
        .limit(3000),
    ]);

    for (const result of [
      profilesResult,
      googleResult,
      microsoftResult,
      salesProfilesResult,
      calendarSyncResult,
      prospectsResult,
      sharedClientsResult,
      sentMessagesResult,
      transcriptEvidenceResult,
      auditResult,
    ]) {
      if (result.error) throw result.error;
    }

    const profileByUser = new Map(
      (profilesResult.data || []).map((row: any) => [row.user_id, row])
    );
    const googleByUser = new Map(
      (googleResult.data || []).map((row: any) => [row.owner_id, row])
    );
    const microsoftByUser = new Map(
      (microsoftResult.data || []).map((row: any) => [row.owner_id, row])
    );
    const salesProfileComplete = new Set(
      (salesProfilesResult.data || [])
        .filter((row: any) => !!row.completed_at)
        .map((row: any) => row.user_id)
    );
    const calendarSyncByUser = new Map<string, string>();
    for (const row of calendarSyncResult.data || []) {
      if (!calendarSyncByUser.has(row.owner_id)) {
        calendarSyncByUser.set(row.owner_id, row.value || row.updated_at);
      }
    }

    const assignedProspects = new Map<string, number>();
    let sharedPoolProspects = 0;
    for (const row of prospectsResult.data || []) {
      if (!row.assigned_to_user_id) {
        sharedPoolProspects += 1;
        continue;
      }
      assignedProspects.set(
        row.assigned_to_user_id,
        (assignedProspects.get(row.assigned_to_user_id) || 0) + 1
      );
    }
    const sharedClientsByUser = new Map<string, number>();
    for (const row of sharedClientsResult.data || []) {
      if (!row.assigned_to_user_id) continue;
      sharedClientsByUser.set(
        row.assigned_to_user_id,
        (sharedClientsByUser.get(row.assigned_to_user_id) || 0) + 1
      );
    }

    const sentRowsByUser = new Map<string, any[]>();
    for (const row of sentMessagesResult.data || []) {
      const current = sentRowsByUser.get(row.sender_user_id) || [];
      current.push(row);
      sentRowsByUser.set(row.sender_user_id, current);
    }
    const transcribedCallsByUser = new Map<string, number>();
    for (const row of transcriptEvidenceResult.data || []) {
      transcribedCallsByUser.set(
        row.owner_id,
        (transcribedCallsByUser.get(row.owner_id) || 0) + 1
      );
    }

    const privacyEventByUser = new Map<string, any>();
    const testEmailByUser = new Map<string, string>();
    for (const event of auditResult.data || []) {
      if (
        event.action === "account_readiness_test_email_completed" &&
        event.target_id &&
        !testEmailByUser.has(event.target_id)
      ) {
        testEmailByUser.set(event.target_id, event.created_at);
      }
      if (
        (event.action === "workspace_member_privacy_test_confirmed" ||
          event.action === "workspace_member_privacy_test_reset") &&
        event.target_id &&
        !privacyEventByUser.has(event.target_id)
      ) {
        privacyEventByUser.set(event.target_id, event);
      }
    }

    const [liveGoogle, liveGoogleScopes, liveGmail, liveMicrosoft] =
      await Promise.all([
        googleConnected(scope.userId).catch(() => ({
          connected: false,
          email: null,
        })),
        googleGrantedScopes(scope.userId).catch(() => new Set<string>()),
        gmailAccessDiagnostic(scope.userId).catch(() => ({
          status: "missing" as const,
          issue: "google_error" as const,
        })),
        microsoftAccessStatus(scope.userId).catch(() => ({
          status: "disconnected" as const,
          email: null,
          mailRead: false,
          mailSend: false,
          calendar: false,
        })),
      ]);

    const transcriberPlatformReady = !!(
      process.env.RECALL_API_KEY && process.env.RECALL_REGION
    );

    const readinessByUser = new Map<string, AccountReadiness>();
    for (const member of members || []) {
      const userId = member.user_id;
      const profile = profileByUser.get(userId) as any;
      const google = googleByUser.get(userId) as any;
      const microsoft = microsoftByUser.get(userId) as any;
      const googleStored = !!google?.refresh_token;
      const microsoftStored = !!microsoft?.refresh_token;
      const connectedProviderCount = Number(googleStored) + Number(microsoftStored);
      const provider = googleStored
        ? ("google" as const)
        : microsoftStored
          ? ("microsoft" as const)
          : null;
      const sentRows = sentRowsByUser.get(userId) || [];
      const sentAt = latestIso(...sentRows.map((row) => row.sent_at));
      const rehearsalAt = testEmailByUser.get(userId) || null;
      const testEmailCompletedAt = latestIso(sentAt, rehearsalAt);
      const senderEmail = normaliseEmail(
        profile?.outreach_sender_email || google?.email || microsoft?.email
      );
      const providerEmail = normaliseEmail(
        provider === "google" ? google?.email : microsoft?.email
      );
      const senderVerified =
        !!senderEmail &&
        (senderEmail === providerEmail ||
          sentRows.some(
            (row) => normaliseEmail(row.from_email) === senderEmail
          ) ||
          !!rehearsalAt);
      const microsoftMailRead = hasMicrosoftScope(
        microsoft?.scopes,
        "Mail.Read",
        "Mail.ReadWrite"
      );
      const microsoftMailSend = hasMicrosoftScope(
        microsoft?.scopes,
        "Mail.Send"
      );
      const microsoftCalendar = hasMicrosoftScope(
        microsoft?.scopes,
        "Calendars.Read",
        "Calendars.ReadWrite"
      );
      const isCurrent = userId === scope.userId;
      const currentGoogleRead =
        liveGoogleScopes.has(GMAIL_READ_SCOPE) || liveGmail.status === "ok";
      const currentGoogleSend =
        liveGoogleScopes.has(GMAIL_SEND_SCOPE) || senderVerified;
      const currentUsesGoogle = isCurrent && liveGoogle.connected;
      const currentUsesMicrosoft =
        isCurrent && liveMicrosoft.status !== "disconnected";
      const privacyEvent = privacyEventByUser.get(userId);

      const facts: AccountReadinessFacts = {
        userId,
        displayName: profile?.display_name || null,
        email: profile?.email || null,
        role: member.role,
        membershipStatus: member.status,
        salesProfileComplete: salesProfileComplete.has(userId),
        connectedProviderCount,
        provider,
        providerEmail: providerEmail || null,
        mailRead: currentUsesGoogle
          ? currentGoogleRead
          : currentUsesMicrosoft
            ? liveMicrosoft.status === "ok" && liveMicrosoft.mailRead
            : provider === "google"
              ? googleStored
              : microsoftMailRead,
        mailSend: currentUsesGoogle
          ? currentGoogleSend
          : currentUsesMicrosoft
            ? liveMicrosoft.status === "ok" && liveMicrosoft.mailSend
            : provider === "google"
              ? googleStored && senderVerified
              : microsoftMailSend,
        senderName:
          profile?.outreach_sender_name || profile?.display_name || null,
        senderEmail: senderEmail || null,
        senderVerified,
        calendarConnected: currentUsesGoogle
          ? liveGoogle.connected
          : currentUsesMicrosoft
            ? liveMicrosoft.status === "ok" && liveMicrosoft.calendar
            : provider === "google"
              ? googleStored
              : microsoftCalendar,
        lastCalendarSyncAt: calendarSyncByUser.get(userId) || null,
        transcriberName:
          profile?.transcriber_name ||
          deriveTranscriberName(profile?.display_name || null),
        transcriberPlatformReady,
        assignedProspects: assignedProspects.get(userId) || 0,
        sharedPoolProspects,
        sharedClients: sharedClientsByUser.get(userId) || 0,
        privacyBoundaryActive: true,
        privacyTestConfirmedAt:
          privacyEvent?.action === "workspace_member_privacy_test_confirmed"
            ? privacyEvent.created_at
            : null,
        testEmailCompletedAt,
        transcribedCalls: transcribedCallsByUser.get(userId) || 0,
      };
      readinessByUser.set(userId, buildAccountReadiness(facts));
    }

    const account = readinessByUser.get(scope.userId);
    if (!account) throw new Error("Account readiness could not be built");
    const team =
      scope.role === "owner"
        ? (members || [])
            .filter((member: any) => member.user_id !== scope.userId)
            .map((member: any) => readinessByUser.get(member.user_id))
            .filter((row): row is AccountReadiness => !!row)
        : undefined;

    return NextResponse.json(
      {
        account,
        ...(scope.role === "owner" ? { team } : {}),
        generatedAt: new Date().toISOString(),
        aiUsed: false,
      },
      { headers: NO_STORE }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Account readiness is unavailable" },
      { status: 403, headers: NO_STORE }
    );
  }
}
