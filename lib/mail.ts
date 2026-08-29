import "server-only";

import {
  connectedEmail as googleConnectedEmail,
  createGmailDraft,
  digestMessages,
  emailFromHeader,
  freshMessageText as freshGmailMessageText,
  gmailConnected,
  nameFromHeader,
  newInboxMessagesSince as newGmailInboxMessagesSince,
  recentMessages as recentGmailMessages,
  sendMail as sendGmail,
  sendOutreachMail as sendGmailOutreach,
  type GmailInboxDelta,
  type GmailMsg,
} from "@/lib/gmail";
import { googleConnected } from "@/lib/google";
import {
  createMicrosoftMailDraft,
  freshMicrosoftMessageText,
  microsoftConnected,
  newMicrosoftInboxMessagesSince,
  recentMicrosoftMessages,
  sendMicrosoftMail,
} from "@/lib/microsoft";

export type MailProvider = "google" | "microsoft";
export type MailMessage = GmailMsg;
export type MailInboxDelta = GmailInboxDelta;
export type ConnectedMailDraftResult = {
  ok: boolean;
  id?: string;
  threadId?: string;
  url?: string;
  error?: string;
};
export { digestMessages, emailFromHeader, nameFromHeader };

export async function connectedMailProvider(ownerId?: string): Promise<{
  provider: MailProvider | null;
  email: string | null;
}> {
  const [google, microsoft] = await Promise.all([
    googleConnected(ownerId),
    microsoftConnected(ownerId),
  ]);
  if (google.connected) return { provider: "google", email: google.email };
  if (microsoft.connected) {
    return { provider: "microsoft", email: microsoft.email };
  }
  return { provider: null, email: null };
}

export async function mailboxConnected(ownerId?: string): Promise<boolean> {
  return (await connectedMailProvider(ownerId)).provider !== null;
}

export async function recentMessages(
  query: string,
  max = 12,
  ownerId?: string
): Promise<MailMessage[]> {
  const connection = await connectedMailProvider(ownerId);
  if (connection.provider === "google") {
    return recentGmailMessages(query, max, ownerId);
  }
  if (connection.provider === "microsoft") {
    return recentMicrosoftMessages(query, max, ownerId);
  }
  return [];
}

export async function freshMessageText(
  id: string,
  max = 6000,
  ownerId?: string
): Promise<string> {
  const connection = await connectedMailProvider(ownerId);
  if (connection.provider === "google") {
    return freshGmailMessageText(id, max, ownerId);
  }
  if (connection.provider === "microsoft") {
    return freshMicrosoftMessageText(id, max, ownerId);
  }
  return "";
}

export async function newInboxMessagesSince(
  cursor: string | null,
  maxMessages = 50,
  ownerId?: string
): Promise<MailInboxDelta> {
  const connection = await connectedMailProvider(ownerId);
  if (connection.provider === "google") {
    return newGmailInboxMessagesSince(cursor, maxMessages, ownerId);
  }
  if (connection.provider === "microsoft") {
    return newMicrosoftInboxMessagesSince(cursor, maxMessages, ownerId);
  }
  return { cursor: cursor || "", messages: [], reset: true };
}

export async function sendConnectedMail(
  opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    from?: string;
    replyTo?: string;
    threadId?: string;
  },
  ownerId?: string
): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const connection = await connectedMailProvider(ownerId);
  if (connection.provider === "google") return sendGmail(opts, ownerId);
  if (connection.provider === "microsoft") return sendMicrosoftMail(opts, ownerId);
  return { ok: false, error: "Connect Google or Microsoft in Settings first" };
}

export type ConnectedMailDraftInput = {
  to: string;
  subject: string;
  text: string;
  threadId?: string;
  sourceMessageId?: string;
  voiceNote?: {
    url: string;
    estimatedSeconds?: number | null;
    previewText?: string | null;
  };
};

export function buildConnectedMailDraftContent(
  opts: Pick<ConnectedMailDraftInput, "text" | "voiceNote">
): { text: string; html: string } {
  const safeText = String(opts.text || "").trim();
  const voiceUrl = String(opts.voiceNote?.url || "").trim();
  const seconds = Math.max(
    20,
    Math.min(90, Number(opts.voiceNote?.estimatedSeconds) || 50)
  );
  const previewText = String(opts.voiceNote?.previewText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const providerText = voiceUrl
    ? `${safeText}\n\nI’ve added a short personal voice message for you.\nListen here\n${voiceUrl}${previewText ? `\n\nIn short, ${previewText}` : ""}`
    : safeText;
  const voiceHtml = voiceUrl
    ? `<div style="margin:24px 0;padding:18px;border:1px solid #d9a34a;border-radius:12px;background:#fffaf0"><p style="margin:0 0 12px"><strong>I’ve added a short personal voice message for you.</strong></p><a href="${escapeHtml(voiceUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#b7791f;color:#ffffff;text-decoration:none;font-weight:600">Listen to the ${seconds} second message</a>${previewText ? `<p style="margin:12px 0 0;color:#555;font-size:13px;line-height:1.5">In short, ${escapeHtml(previewText)}</p>` : ""}</div>`
    : "";
  return {
    text: providerText,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#171717">${escapeHtml(
      safeText
    ).replace(/\n/g, "<br>")}${voiceHtml}</div>`,
  };
}

// Create a real provider draft, never send it. The CRM calls this only after
// the signed-in user approves the editable LiveCoach draft.
export async function createConnectedMailDraft(
  opts: ConnectedMailDraftInput,
  ownerId?: string
): Promise<ConnectedMailDraftResult> {
  const connection = await connectedMailProvider(ownerId);
  const content = buildConnectedMailDraftContent(opts);
  if (connection.provider === "google") {
    return createGmailDraft(
      {
        to: opts.to,
        subject: opts.subject,
        text: content.text,
        html: content.html,
        threadId: opts.threadId,
        sourceMessageId: opts.sourceMessageId,
      },
      ownerId
    );
  }
  if (connection.provider === "microsoft") {
    return createMicrosoftMailDraft(
      {
        to: opts.to,
        subject: opts.subject,
        text: content.text,
        sourceMessageId: opts.sourceMessageId,
      },
      ownerId
    );
  }
  return {
    ok: false,
    error: "Connect Google or Microsoft in Settings before creating a mail draft",
  };
}

export async function sendConnectedOutreachMail(opts: {
  to: string;
  subject: string;
  text: string;
  threadId?: string;
  ownerId: string;
  senderName: string;
  fromEmail: string;
  voiceNote?: {
    url: string;
    estimatedSeconds?: number | null;
    previewText?: string | null;
  };
}): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const connection = await connectedMailProvider(opts.ownerId);
  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const safeText = String(opts.text || "").trim();
  const paragraphs = safeText
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
  const firstName = String(opts.senderName || "").trim().split(/\s+/)[0] || "me";
  const seconds = Math.max(
    20,
    Math.min(90, Number(opts.voiceNote?.estimatedSeconds) || 50)
  );
  const voiceUrl = String(opts.voiceNote?.url || "").trim();
  const previewText = String(opts.voiceNote?.previewText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  const voiceHtml = voiceUrl
    ? `<div style="margin:24px 0;padding:18px;border:1px solid #d9a34a;border-radius:12px;background:#fffaf0"><p style="margin:0 0 12px;font-size:15px;line-height:1.5"><strong>I’ve added a short personal voice message for you.</strong></p><a href="${escapeHtml(voiceUrl)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#b7791f;color:#ffffff;text-decoration:none;font-weight:600">Listen to ${escapeHtml(firstName)}’s ${seconds} second message</a>${previewText ? `<p style="margin:12px 0 0;color:#555;font-size:13px;line-height:1.5">In short, ${escapeHtml(previewText)}</p>` : ""}</div>`
    : "";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#171717;max-width:640px">${paragraphs}${voiceHtml}</div>`;
  const text = voiceUrl
    ? `${safeText}\n\nI’ve added a short personal voice message for you.\nListen to ${firstName}'s ${seconds} second message\n${voiceUrl}${previewText ? `\n\nIn short, ${previewText}` : ""}`
    : safeText;
  // Gmail performs its own verified send-as alias check. Keep that path intact
  // so Lee can continue sending from lee@interviewa.com through his connected
  // Google account. Microsoft starts conservatively with the exact mailbox.
  if (connection.provider === "google")
    return sendGmailOutreach({ ...opts, text, html });
  if (connection.provider === "microsoft") {
    if (
      !connection.email ||
      connection.email.toLowerCase() !== opts.fromEmail.toLowerCase()
    ) {
      return {
        ok: false,
        error: "Microsoft outreach must use the connected mailbox address",
      };
    }
    return sendMicrosoftMail(
      {
        to: opts.to,
        subject: opts.subject,
        text,
        html,
        replyTo: opts.fromEmail,
      },
      opts.ownerId
    );
  }
  return { ok: false, error: "Connect Google or Microsoft before sending outreach" };
}

export async function connectedEmail(ownerId?: string): Promise<string> {
  const connection = await connectedMailProvider(ownerId);
  if (connection.provider === "google") return googleConnectedEmail(ownerId);
  return connection.email || "";
}

export async function providerSpecificMailboxConnected(ownerId?: string): Promise<{
  google: boolean;
  microsoft: boolean;
}> {
  const [google, microsoft] = await Promise.all([
    gmailConnected(ownerId),
    microsoftConnected(ownerId),
  ]);
  return { google, microsoft: microsoft.connected };
}
