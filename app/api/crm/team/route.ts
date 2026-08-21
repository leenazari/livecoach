import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendMail } from "@/lib/gmail";
import { requireWorkspaceOwner } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { deriveTranscriberName } from "@/lib/transcriber";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["manager", "sales"]);

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
          .select("user_id,role,status,created_at,updated_at")
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
    const [{ data: profiles, error: profilesError }, { data: googleRows, error: googleError }] =
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
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
          ];
    if (profilesError) throw profilesError;
    if (googleError) throw googleError;

    const profileByUser = new Map(
      (profiles || []).map((profile: any) => [profile.user_id, profile])
    );
    const googleByUser = new Map(
      (googleRows || []).map((row: any) => [row.owner_id, row])
    );
    const members = (membersResult.data || []).map((member: any) => {
      const profile = profileByUser.get(member.user_id) as any;
      const google = googleByUser.get(member.user_id) as any;
      return {
        ...member,
        displayName: profile?.display_name || null,
        email: profile?.email || null,
        googleConnected: !!google?.refresh_token,
        googleEmail: google?.email || null,
        outreachSenderName: profile?.outreach_sender_name || profile?.display_name || null,
        outreachSenderEmail: profile?.outreach_sender_email || google?.email || null,
        canActivate:
          member.status !== "active" &&
          member.status !== "removed" &&
          !!profile?.display_name &&
          !!google?.refresh_token &&
          !!google?.email,
        activationIssues: [
          ...(!profile?.display_name ? ["Finish account setup"] : []),
          ...(!google?.refresh_token || !google?.email ? ["Connect this user's Google account"] : []),
        ],
        transcriberName:
          profile?.transcriber_name ||
          deriveTranscriberName(profile?.display_name || null),
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
            "After account and Google setup, the owner activates access. Each user keeps a separate Calendar, Gmail, transcriber and private Brain memory.",
        },
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
    const action = body.action === "activate" || body.action === "suspend"
      ? body.action
      : "";
    if (!userId || !action)
      return NextResponse.json({ error: "Choose an account action" }, { status: 400 });
    if (userId === scope.userId)
      return NextResponse.json({ error: "The workspace owner cannot suspend their own account here" }, { status: 400 });

    const { data: member, error: memberError } = await supabaseService
      .from("workspace_members")
      .select("user_id,role,status")
      .eq("workspace_id", scope.workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.status === "removed")
      return NextResponse.json({ error: "Team account not found" }, { status: 404 });

    if (action === "activate") {
      const [{ data: profile, error: profileError }, { data: google, error: googleError }] =
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
        ]);
      if (profileError) throw profileError;
      if (googleError) throw googleError;
      if (!profile?.display_name)
        return NextResponse.json({ error: "This person must finish account setup first" }, { status: 409 });
      if (!google?.refresh_token || !google.email)
        return NextResponse.json({ error: "This person must connect their own Google account first" }, { status: 409 });
      const senderName = String(profile.display_name).trim();
      // A newly activated account must begin with its own verified Google
      // mailbox. A different Gmail alias can be enabled later through an
      // owner-controlled verification flow, never from a self-edited profile.
      const senderEmail = String(google.email).trim().toLowerCase();
      const { error: profileUpdateError } = await supabaseService
        .from("profiles")
        .update({
          outreach_sender_name: senderName,
          outreach_sender_email: senderEmail,
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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const nextPath = `/join-team?invite=${encodeURIComponent(rawToken)}`;
    const callback = new URL("/auth/callback", appUrl);
    callback.searchParams.set("next", nextPath);

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
        options: { redirectTo: callback.toString() },
      } as any);
    if (linkError) throw linkError;
    const actionLink = linkData.properties?.action_link;
    if (!actionLink) throw new Error("Supabase did not create an invitation link");

    const safeLink = htmlEscape(actionLink);
    const sent = await sendMail({
      to: email,
      subject: "Your LiveCoach sales workspace invitation",
      text: `Lee has invited you to the Interviewa LiveCoach sales workspace. Open this secure link within seven days to set up your account. ${actionLink}`,
      html: `<p>Lee has invited you to the Interviewa LiveCoach sales workspace.</p><p>You will set up your own login, then connect your own Google Calendar and Gmail. Lee's private calls, emails, investors and Brain history are not shared with your account.</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#d9a35f;color:#171614;text-decoration:none;font-weight:700;">Set up LiveCoach</a></p><p>This secure invitation expires in seven days.</p>`,
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
