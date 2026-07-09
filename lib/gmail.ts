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
  const out: GmailMsg[] = [];
  for (const id of ids) {
    const m = await api(
      `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
      token
    );
    if (!m) continue;
    const headers = m.payload?.headers || [];
    const dateMs = m.internalDate
      ? Number(m.internalDate)
      : Date.parse(header(headers, "Date")) || 0;
    out.push({
      id: String(m.id),
      threadId: String(m.threadId || ""),
      date: dateMs ? new Date(dateMs).toISOString() : "",
      from: header(headers, "From"),
      to: header(headers, "To"),
      cc: header(headers, "Cc"),
      subject: header(headers, "Subject"),
      snippet: typeof m.snippet === "string" ? m.snippet : "",
    });
  }
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
