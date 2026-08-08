import { getAccessToken } from "@/lib/google";

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
};

async function api(path: string, token: string): Promise<any | null> {
  try {
    const res = await fetch(`${GMAIL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
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
export async function gmailConnected(): Promise<boolean> {
  return !!(await getAccessToken());
}

// Verify Gmail itself, not merely the shared Google token. This distinguishes
// a healthy calendar-only connection from a missing Gmail scope/API.
export async function gmailAccessStatus(): Promise<"ok" | "missing" | "disconnected"> {
  const token = await getAccessToken();
  if (!token) return "disconnected";
  try {
    const res = await fetch(`${GMAIL}/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    return res.ok ? "ok" : "missing";
  } catch {
    return "missing";
  }
}

// Recent messages matching a Gmail query (e.g. "from:x@y.com OR to:x@y.com"),
// newest first, metadata + snippet only.
export async function recentMessages(
  query: string,
  max = 12
): Promise<GmailMsg[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const list = await api(
    `/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(
      Math.max(max, 1),
      25
    )}`,
    token
  );
  const ids: string[] = Array.isArray(list?.messages)
    ? list.messages.map((m: any) => m?.id).filter(Boolean)
    : [];
  // Metadata requests are independent. Fetch them concurrently so refreshing
  // an email thread takes one network round-trip window instead of up to 25.
  const fetched = await Promise.all(ids.map(async (id): Promise<GmailMsg | null> => {
    const m = await api(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
      token
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
}): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const token = await getAccessToken();
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
    const res = await fetch(`${GMAIL}/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded, ...(opts.threadId ? { threadId: opts.threadId } : {}) }),
    });
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

// Prospect outreach must never silently fall back to the connected account.
// Gmail accepts this From header only when the address is an approved "Send
// mail as" alias. If the alias is removed or becomes invalid, Gmail refuses the
// request and the prospect stays unsent for the user to fix safely.
export const OUTREACH_FROM_EMAIL = "lee@interviewa.com";

export async function sendOutreachMail(opts: {
  to: string;
  subject: string;
  text: string;
  threadId?: string;
}): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const safeText = String(opts.text || "").trim();
  return sendMail({
    to: opts.to,
    subject: opts.subject,
    text: safeText,
    html: safeText
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
      .join(""),
    from: `Lee Nazari <${OUTREACH_FROM_EMAIL}>`,
    replyTo: OUTREACH_FROM_EMAIL,
    threadId: opts.threadId,
  });
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
export async function connectedEmail(): Promise<string> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin
    .from("google_oauth")
    .select("email")
    .eq("id", "main")
    .maybeSingle();
  return typeof data?.email === "string" ? data.email : "";
}
