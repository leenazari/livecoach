import "server-only";

import { getRequestScope } from "@/lib/request-scope";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseService } from "@/lib/supabase";

export type OutreachIdentity = {
  userId: string;
  workspaceId: string;
  senderName: string;
  senderEmail: string;
  provider: "google" | "microsoft";
  mailboxEmail: string;
  // Kept while older call sites migrate to the provider-neutral name.
  googleEmail: string;
};

export async function resolveOutreachIdentity(
  explicitUserId?: string
): Promise<OutreachIdentity> {
  const scope = await resolveRecordScope(explicitUserId);
  const requestScope = getRequestScope();
  if (requestScope && scope.userId !== requestScope.userId) {
    throw new Error("Another account's outreach identity is not available");
  }
  const [
    { data: member, error: memberError },
    { data: profile, error: profileError },
    { data: google, error: googleError },
    { data: microsoft, error: microsoftError },
  ] =
    await Promise.all([
      supabaseService
        .from("workspace_members")
        .select("status")
        .eq("workspace_id", scope.workspaceId)
        .eq("user_id", scope.userId)
        .maybeSingle(),
      supabaseService
        .from("profiles")
        .select("display_name,outreach_sender_name,outreach_sender_email")
        .eq("user_id", scope.userId)
        .maybeSingle(),
      supabaseService
        .from("google_oauth")
        .select("email,refresh_token")
        .eq("owner_id", scope.userId)
        .maybeSingle(),
      supabaseService
        .from("microsoft_oauth")
        .select("email,refresh_token")
        .eq("owner_id", scope.userId)
        .maybeSingle(),
    ]);
  if (memberError) throw memberError;
  if (profileError) throw profileError;
  if (googleError) throw googleError;
  if (microsoftError) throw microsoftError;
  if (!member || member.status !== "active")
    throw new Error("This account is not active");
  const provider = google?.refresh_token && google.email
    ? "google"
    : microsoft?.refresh_token && microsoft.email
      ? "microsoft"
      : null;
  const mailboxEmail = String(google?.email || microsoft?.email || "")
    .trim()
    .toLowerCase();
  if (!provider || !mailboxEmail)
    throw new Error("Connect this account's Google or Microsoft email first");
  const savedSenderEmail = String(profile?.outreach_sender_email || "")
    .trim()
    .toLowerCase();
  const savedSenderName = String(profile?.outreach_sender_name || "").trim();
  let senderEmail = savedSenderEmail || mailboxEmail;
  let senderName = String(
    savedSenderName || profile?.display_name || mailboxEmail
  ).trim();
  if (!senderEmail || !senderName)
    throw new Error("This account needs an outreach sender identity");

  // Google and Microsoft are the verified source of a salesperson's mailbox.
  // Older invitations could become active without copying that identity onto
  // the profile used by the database sender guard. Repair only missing fields
  // before any research or generation starts, while preserving configured
  // aliases and never borrowing another user's connector.
  if (!savedSenderEmail || !savedSenderName) {
    const senderPatch: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };
    if (!savedSenderEmail) {
      senderPatch.outreach_sender_email = mailboxEmail;
    }
    if (!savedSenderName) {
      senderPatch.outreach_sender_name = senderName;
    }
    const { data: repairedProfile, error: repairError } = await supabaseService
      .from("profiles")
      .update(senderPatch)
      .eq("user_id", scope.userId)
      .select("outreach_sender_name,outreach_sender_email")
      .maybeSingle();
    if (repairError || !repairedProfile) {
      throw new Error(
        "Your mailbox is connected, but LiveCoach could not finish your sender setup. Reconnect the mailbox in Settings, then try again."
      );
    }
    senderEmail = String(repairedProfile.outreach_sender_email || "")
      .trim()
      .toLowerCase();
    senderName = String(repairedProfile.outreach_sender_name || "").trim();
    if (!senderEmail || !senderName) {
      throw new Error(
        "Your mailbox is connected, but your outreach sender name or email is still missing."
      );
    }
  }
  return {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    senderName,
    senderEmail,
    provider,
    mailboxEmail,
    googleEmail: mailboxEmail,
  };
}
