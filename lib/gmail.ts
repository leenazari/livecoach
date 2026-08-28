import { getAccessToken, googleConnected } from "@/lib/google";

// Read-only Gmail access for the app, using the SAME Google OAuth token as the
// calendar (lib/google.ts). Lets the brain pull the mail thread with a contact
// and build a client from it. Metadata + snippet only - never the full HTML
// body - so context stays clean and small. Best-effort: every call returns an
// empty result rather than throwing, and an empty result when a query should
// match usually means Gmail scope was not granted (reconnect Google in Settings).

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailMsg = {
  id: string;
  threadId: string;
  date: string; // ISO, best-effort
  from: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  labelIds?: string[];
  autoSubmitted?: string;
  listUnsubscribe?: string;
};

export type GmailInboxDelta = {
  cursor: string;
  messages: GmailMsg[];
  reset: boolean;
};

type GmailFetchInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

// Google can reject a cached access token before its advertised expiry (for
// example after a new consent grant). Refresh once on 401 so Gmail recovers
// immediately instead of appearing disconnected until the cache expires.
async function gmailFetch(
  path: string,
  token: string,
  init: GmailFetchInit = {},
  ownerId?: string
): Promise<Response | null> {
  const request = (accessToken: string) =>
    fetch(`${GMAIL}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  try {
    let res = await request(token);
    if (res.status === 401) {
      const refreshed = await getAccessToken(true, ownerId);
      if (refreshed) res = await request(refreshed);
    }
    return res;
  } catch {
    return null;
  }
}

async function api(path: string, token: string, ownerId?: string): Promise<any | null> {
  try {
    const res = await gmailFetch(path, token, {}, ownerId);
    if (!res) return null;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const header = (headers: any, name: string): string => {
  const list = Array.isArray(headers) ? headers : [];
  const h = list.find(
    (x: any) => String(x?.name || "").toLowerCase() === name.toLowerCase()
  );
  return h && typeof h.value === "string" ? h.value : "";
};

// Whether Google is connected at all (a token comes back). Note: the token is
// shared with calendar - if only the calendar scope was granted, Gmail calls
// 403 and recentMessages returns [], which the caller treats as "reconnect".
export async function gmailConnected(ownerId?: string): Promise<boolean> {
  return !!(await getAccessToken(false, ownerId));
}

// Verify Gmail itself, not merely the shared Google token. This distinguishes
// a healthy calendar-only connection from a missing Gmail scope/API.
export type GmailAccessIssue =
  | "none"
  | "disconnected"
  | "scope_missing"
  | "workspace_policy"
  | "api_disabled"
  | "token_rejected"
  | "rate_limited"
  | "google_error";

export async function gmailAccessDiagnostic(ownerId?: string): Promise<{
  status: "ok" | "missing" | "disconnected";
  issue: GmailAccessIssue;
}> {
  const token = await getAccessToken(false, ownerId);
  if (!token) return { status: "disconnected", issue: "disconnected" };
  try {
    const res = await gmailFetch("/profile", token, {
      cache: "no-store",
    }, ownerId);
    if (!res) return { status: "missing", issue: "google_error" };
    if (res.ok) return { status: "ok", issue: "none" };

    const body = await res.text();
    const error = body.toLowerCase();
    let issue: GmailAccessIssue = "google_error";
    if (res.status === 401) issue = "token_rejected";
    else if (res.status === 429) issue = "rate_limited";
    else if (
      error.includes("access_token_scope_insufficient") ||
      error.includes("insufficientpermission") ||
      error.includes("insufficient permission")
    ) {
      issue = "scope_missing";
    } else if (
      error.includes("admin_policy_enforced") ||
      error.includes("domainpolicy") ||
      error.includes("domain policy") ||
      error.includes("org_internal")
    ) {
      issue = "workspace_policy";
    } else if (
      error.includes("accessnotconfigured") ||
      error.includes("service_disabled") ||
      error.includes("api has not been used")
    ) {
      issue = "api_disabled";
    }
    return { status: "missing", issue };
  } catch {
    return { status: "missing", issue: "google_error" };
  }
}

export async function gmailAccessStatus(ownerId?: string): Promise<"ok" | "missing" | "disconnected"> {
  return (await gmailAccessDiagnostic(ownerId)).status;
}

// Recent messages matching a Gmail query (e.g. "from:x@y.com OR to:x@y.com"),
// newest first, metadata + snippet only.
export async function recentMessages(
  query: string,
  max = 12,
  ownerId?: string
): Promise<GmailMsg[]> {
  const token = await getAccessToken(false, ownerId);
  if (!token) return [];
  const list = await api(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(
      Math.max(max, 1),
      25
    )}`,
    token,
    ownerId
  );
  const ids: string[] = Array.isArray(list?.messages)
    ? list.messages.map((m: any) => m?.id).filter(Boolean)
    : [];
  // Metadata requests are independent. Fetch them concurrently so refreshing
  // an email thread takes one network round-trip window instead of up to 25.
  const fetched = await Promise.all(ids.map(async (id): Promise<GmailMsg | null> => {
    const m = await api(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
      token,
      ownerId
    );
    if (!m) return null;
    const headers = m.payload?.headers || [];
    const dateMs = m.internalDate
      ? Number(m.internalDate)
      : Date.parse(header(headers, "Date")) || 0;
    return {
      id: String(m.id),
      threadId: String(m.threadId || ""),
      date: dateMs ? new Date(dateMs).toISOString() : "",
      from: header(headers, "From"),
      to: header(headers, "To"),
      cc: header(headers, "Cc"),
      subject: header(headers, "Subject"),
      snippet: typeof m.snippet === "string" ? m.snippet : "",
    };
  }));
  const out = fetched.filter((m): m is GmailMsg => !!m);
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

async function gmailProfile(token: string, ownerId?: string): Promise<any | null> {
  return api("/profile", token, ownerId);
}

async function messageMetadata(
  id: string,
  token: string,
  ownerId?: string
): Promise<GmailMsg | null> {
  const fields = [
    "From",
    "To",
    "Cc",
    "Subject",
    "Date",
    "Auto-Submitted",
    "List-Unsubscribe",
  ]
    .map((name) => `metadataHeaders=${encodeURIComponent(name)}`)
    .join("&");
  const message = await api(`/messages/${id}?format=metadata&${fields}`, token, ownerId);
  if (!message) return null;
  const headers = message.payload?.headers || [];
  const dateMs = message.internalDate
    ? Number(message.internalDate)
    : Date.parse(header(headers, "Date")) || 0;
  return {
    id: String(message.id || id),
    threadId: String(message.threadId || ""),
    date: dateMs ? new Date(dateMs).toISOString() : "",
    from: header(headers, "From"),
    to: header(headers, "To"),
    cc: header(headers, "Cc"),
    subject: header(headers, "Subject"),
    snippet: typeof message.snippet === "string" ? message.snippet : "",
    labelIds: Array.isArray(message.labelIds) ? message.labelIds : [],
    autoSubmitted: header(headers, "Auto-Submitted"),
    listUnsubscribe: header(headers, "List-Unsubscribe"),
  };
}

// Gmail History returns only changes since the last cursor. This is the cheap
// monitoring path: old threads are never listed or re-read, and each message
// ID is considered once. An expired cursor is reset to the current profile
// without treating old inbox mail as new.
export async function newInboxMessagesSince(
  startHistoryId: string | null,
  maxMessages = 50,
  ownerId?: string
): Promise<GmailInboxDelta> {
  const token = await getAccessToken(false, ownerId);
  if (!token) throw new Error("Google is not connected");
  const profile = await gmailProfile(token, ownerId);
  const currentCursor = String(profile?.historyId || "");
  if (!currentCursor) throw new Error("Gmail history is unavailable");
  if (!startHistoryId) {
    return { cursor: currentCursor, messages: [], reset: true };
  }

  const ids = new Set<string>();
  let pageToken = "";
  let cursor = currentCursor;
  let pages = 0;
  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      labelId: "INBOX",
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await gmailFetch(`/history?${params.toString()}`, token, {
      cache: "no-store",
    }, ownerId);
    if (!response) throw new Error("Gmail history check failed");
    if (response.status === 404) {
      return { cursor: currentCursor, messages: [], reset: true };
    }
    if (!response.ok) throw new Error(`Gmail history check failed (${response.status})`);
    const data = await response.json();
    cursor = String(data.historyId || cursor);
    for (const history of Array.isArray(data.history) ? data.history : []) {
      for (const added of Array.isArray(history.messagesAdded)
        ? history.messagesAdded
        : []) {
        const message = added?.message;
        if (!message?.id) continue;
        const labels = Array.isArray(message.labelIds) ? message.labelIds : [];
        if (labels.includes("INBOX")) ids.add(String(message.id));
        if (ids.size >= maxMessages) break;
      }
      if (ids.size >= maxMessages) break;
    }
    pageToken = String(data.nextPageToken || "");
    pages += 1;
  } while (pageToken && ids.size < maxMessages && pages < 5);

  const metadata = await Promise.all(
    [...ids].slice(0, maxMessages).map((id) => messageMetadata(id, token, ownerId))
  );
  const messages = metadata
    .filter((message): message is GmailMsg => !!message)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { cursor, messages, reset: false };
}

const decodeBase64Url = (value: unknown): string => {
  const data = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  if (!data) return "";
  try {
    return Buffer.from(data, "base64").toString("utf8");
  } catch {
    return "";
  }
};

const mimeText = (part: any, mimeType: string): string => {
  if (!part || typeof part !== "object") return "";
  if (String(part.mimeType || "").toLowerCase() === mimeType) {
    return decodeBase64Url(part.body?.data);
  }
  for (const child of Array.isArray(part.parts) ? part.parts : []) {
    const text = mimeText(child, mimeType);
    if (text) return text;
  }
  return "";
};

export function freshReplyOnly(value: unknown, max = 6000): string {
  let text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
  const quoteMarkers = [
    /\n\s*On .{0,240}wrote:\s*\n/i,
    /\n\s*-{2,}\s*Original Message\s*-{2,}\s*\n/i,
    /\n\s*From:\s+.{1,240}\n\s*(?:Sent|Date):/i,
    /\n\s*_{5,}\s*\n/,
  ];
  let cutAt = text.length;
  for (const marker of quoteMarkers) {
    const match = marker.exec(text);
    // Short replies such as "Yes, Tuesday works" are common. Do not require a
    // long preamble before recognising the quoted history marker.
    if (match) cutAt = Math.min(cutAt, match.index);
  }
  text = text
    .slice(0, cutAt)
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max
    ? `${text.slice(0, max).replace(/\s+\S*$/, "").trim()}…`
    : text;
}

// Fetches ONE Gmail message, never its thread. The caller pays for only the
// fresh message body, with quoted history stripped and a hard character cap.
export async function freshMessageText(id: string, max = 6000, ownerId?: string): Promise<string> {
  const token = await getAccessToken(false, ownerId);
  if (!token || !id) return "";
  const message = await api(`/messages/${encodeURIComponent(id)}?format=full`, token, ownerId);
  if (!message?.payload) return "";
  const plain = mimeText(message.payload, "text/plain");
  const html = plain ? "" : mimeText(message.payload, "text/html");
  const text = plain || (html ? stripHtml(html) : decodeBase64Url(message.payload.body?.data));
  return freshReplyOnly(text, max);
}

// A compact, plain-text digest of a thread, for distilling into a context note.
export function digestMessages(msgs: GmailMsg[], max = 10): string {
  return msgs
    .slice(0, max)
    .map((m) => {
      const when = m.date ? m.date.slice(0, 10) : "";
      return `- ${when} | from: ${m.from} | to: ${m.to}${
        m.cc ? ` | cc: ${m.cc}` : ""
      }\n  ${m.subject ? m.subject + " - " : ""}${m.snippet}`;
    })
    .join("\n");
}

// Pull an email address out of a raw header value like `Jane Doe <jane@acme.com>`.
export function emailFromHeader(h: string): string {
  const m = String(h || "").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : "";
}

// Pull a display name out of `Jane Doe <jane@acme.com>` (falls back to the local
// part of the address, title-cased).
export function nameFromHeader(h: string): string {
  const raw = String(h || "").trim();
  const m = raw.match(/^"?([^"<]+?)"?\s*</);
  if (m && m[1].trim()) return m[1].trim();
  const email = emailFromHeader(raw);
  if (email) {
    const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    return local
      .split(" ")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return "";
}

// ---------------------------------------------------------------------------
// SENDING
// ---------------------------------------------------------------------------

// Send an email AS the connected Google account. Needs the gmail.send scope
// (see SCOPE in lib/google.ts), which is separate from gmail.readonly - if you
// added the scope but did not reconnect Google in Settings, the stored token
// still lacks it and this returns a 403 rather than throwing.
//
// Returns { ok } plus a plain-English reason when it could not send, so the
// caller can log something useful instead of a silent failure.
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  threadId?: string;
}, ownerId?: string): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const token = await getAccessToken(false, ownerId);
  if (!token) {
    return { ok: false, error: "Google is not connected, connect it in Settings" };
  }

  const to = String(opts.to || "").trim();
  if (!to) return { ok: false, error: "no recipient" };

  // RFC 2822. The subject is base64 encoded so non-ASCII (curly quotes, names
  // with accents) survives instead of arriving as mojibake.
  const subject = `=?UTF-8?B?${Buffer.from(
    String(opts.subject || "").slice(0, 200),
    "utf8"
  ).toString("base64")}?=`;

  const boundary = "lc_boundary_a7f3d2";
  const raw = [
    `To: ${to}`,
    ...(opts.from ? [`From: ${opts.from}`] : []),
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    opts.text || stripHtml(opts.html),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    opts.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  // Gmail wants base64url, not plain base64.
  const encoded = Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const res = await gmailFetch("/messages/send", token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded, ...(opts.threadId ? { threadId: opts.threadId } : {}) }),
    }, ownerId);
    if (!res) return { ok: false, error: "Gmail could not be reached" };
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 403) {
        return {
          ok: false,
          error:
            "Gmail refused the send. The gmail.send scope is missing, reconnect Google in Settings.",
        };
      }
      return { ok: false, error: `Gmail said ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, id: data?.id, threadId: data?.threadId };
  } catch (e: any) {
    return { ok: false, error: e?.message || "send failed" };
  }
}

export async function sendOutreachMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  threadId?: string;
  ownerId: string;
  senderName: string;
  fromEmail: string;
}): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const safeText = String(opts.text || "").trim();
  const fromEmail = String(opts.fromEmail).trim().toLowerCase();
  const senderName = String(opts.senderName).trim();
  if (!fromEmail || !senderName || !opts.ownerId)
    return { ok: false, error: "The outreach sender identity is incomplete" };
  return sendMail({
    to: opts.to,
    subject: opts.subject,
    text: safeText,
    html: opts.html || safeText
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
      .join(""),
    from: `${senderName} <${fromEmail}>`,
    replyTo: fromEmail,
    threadId: opts.threadId,
  }, opts.ownerId);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A readable plain-text fallback for mail clients that will not render HTML.
function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<li[^>]*>/gi, "  - ")
    .replace(/<\/(p|div|h1|h2|h3|tr|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The address the digest goes to: whoever connected Google.
export async function connectedEmail(ownerId?: string): Promise<string> {
  const connection = await googleConnected(ownerId);
  return connection.email || "";
}
