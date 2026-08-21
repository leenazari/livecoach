export type TeamInvitationVerificationType = "invite" | "magiclink";

type TeamInvitationLinkInput = {
  appOrigin: string;
  authTokenHash: string;
  authVerificationType: TeamInvitationVerificationType;
  workspaceInvitationToken: string;
};

/**
 * Keep both one-time credentials on LiveCoach's own confirmation route.
 * Supabase's generated action URL uses an implicit fragment, which a Next.js
 * route handler cannot read. Verifying the token hash server-side lets the
 * callback replace any existing browser session and set the correct cookies.
 */
export function buildTeamInvitationActionUrl({
  appOrigin,
  authTokenHash,
  authVerificationType,
  workspaceInvitationToken,
}: TeamInvitationLinkInput): string {
  if (!authTokenHash.trim()) throw new Error("Supabase did not create an authentication token");
  if (!workspaceInvitationToken.trim()) throw new Error("The workspace invitation token is missing");

  const nextPath = `/join-team?invite=${encodeURIComponent(workspaceInvitationToken)}`;
  const callback = new URL("/auth/callback", appOrigin);
  callback.searchParams.set("token_hash", authTokenHash);
  callback.searchParams.set("type", authVerificationType);
  callback.searchParams.set("next", nextPath);
  return callback.toString();
}
