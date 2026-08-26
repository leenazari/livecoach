export type RemainingConnector = "google" | "microsoft" | null;

const email = (value: string | null | undefined) =>
  String(value || "").trim().toLowerCase();

export function senderAfterConnectorDisconnect(input: {
  currentSenderEmail?: string | null;
  disconnectedEmail?: string | null;
  googleEmail?: string | null;
  microsoftEmail?: string | null;
}): { provider: RemainingConnector; senderEmail: string | null } {
  const current = email(input.currentSenderEmail);
  const disconnected = email(input.disconnectedEmail);
  const google = email(input.googleEmail);
  const microsoft = email(input.microsoftEmail);

  if (google) {
    // Gmail can use a separately verified send-as alias. Preserve it unless it
    // was the address belonging to the provider that has just been removed.
    return {
      provider: "google",
      senderEmail: !current || current === disconnected ? google : current,
    };
  }
  // Microsoft sending is deliberately limited to the exact connected mailbox.
  if (microsoft) return { provider: "microsoft", senderEmail: microsoft };
  return { provider: null, senderEmail: null };
}
