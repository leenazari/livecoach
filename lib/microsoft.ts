import "server-only";

import { getRequestScope, isVerifiedServiceRequest } from "@/lib/request-scope";
import { getServiceRecordScope } from "@/lib/service-scope";
import { supabaseService } from "@/lib/supabase";
import {
  microsoftCalendarRecurrence,
  microsoftLondonDateTime,
  microsoftUtcDateTime,
  type CalendarRecurrence,
} from "@/lib/calendar-create";
import {
  freshReplyOnly,
  type GmailInboxDelta,
  type GmailMsg,
} from "@/lib/gmail";

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";

export const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "Calendars.ReadWrite",
];

type MicrosoftConnection = {
  id: string;
  owner_id: string;
  workspace_id: string;
  account_id: string | null;
  tenant_id: string | null;
  email: string | null;
  refresh_token: string | null;
  access_token: string | null;
  expiry: string | null;
  scopes: string[] | null;
};

type GraphFetchInit = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

export type MicrosoftEventSnapshot = {
  events: any[];
  complete: boolean;
  failedCalendars: string[];
};

export function microsoftConfigured(): boolean {
  return !!(
    process.env.MICROSOFT_CLIENT_ID &&
    process.env.MICROSOFT_CLIENT_SECRET &&
    process.env.MICROSOFT_REDIRECT_URI
  );
}

export function buildMicrosoftAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    response_type: "code",
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI || "",
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  return `${AUTHORITY}/authorize?${params.toString()}`;
}

export async function exchangeMicrosoftCode(code: string): Promise<any> {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
    redirect_uri: process.env.MICROSOFT_REDIRECT_URI || "",
    grant_type: "authorization_code",
    scope: MICROSOFT_SCOPES.join(" "),
    code,
  });
  const response = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Microsoft token exchange failed (${response.status})`);
  return response.json();
}

async function connectionForOwner(ownerId?: string): Promise<MicrosoftConnection | null> {
  const requestScope = getRequestScope();
  const serviceScope = getServiceRecordScope();
  if (requestScope && ownerId && ownerId !== requestScope.userId) {
    throw new Error("Cross-account Microsoft access is not permitted");
  }
  if (serviceScope && ownerId && ownerId !== serviceScope.userId) {
    throw new Error("Cross-account Microsoft service access is not permitted");
  }
  const exactOwner = ownerId || requestScope?.userId || serviceScope?.userId || null;
  const fields =
    "id,owner_id,workspace_id,account_id,tenant_id,email,refresh_token,access_token,expiry,scopes";

  if (exactOwner) {
    const { data, error } = await supabaseService
      .from("microsoft_oauth")
      .select(fields)
      .eq("owner_id", exactOwner)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as MicrosoftConnection | null) || null;
  }

  if (!isVerifiedServiceRequest()) {
    throw new Error("A verified account is required for Microsoft access");
  }
  const { data, error } = await supabaseService
    .from("microsoft_oauth")
    .select(fields)
    .order("updated_at", { ascending: false })
    .limit(2);
  if (error) throw error;
  if (!data?.length) return null;
  if (data.length !== 1) {
    throw new Error("A Microsoft connector owner must be selected for this job");
  }
  return data[0] as MicrosoftConnection;
}

export async function saveMicrosoftConnection(input: {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiry: string;
  email: string;
  accountId?: string | null;
  tenantId?: string | null;
  scopes?: string[];
}): Promise<void> {
  const scope = getRequestScope();
  if (!scope) throw new Error("A verified account is required to connect Microsoft");
  const existing = await connectionForOwner(scope.userId);
  const row: Record<string, unknown> = {
    id: existing?.id || `user:${scope.userId}`,
    owner_id: scope.userId,
    workspace_id: scope.workspaceId,
    visibility: "private",
    account_id: input.accountId || existing?.account_id || null,
    tenant_id: input.tenantId || existing?.tenant_id || null,
    email: input.email.trim().toLowerCase(),
    access_token: input.accessToken || null,
    expiry: input.expiry,
    scopes: input.scopes || existing?.scopes || [],
    updated_at: new Date().toISOString(),
  };
  if (input.refreshToken) row.refresh_token = input.refreshToken;
  const { error } = await supabaseService
    .from("microsoft_oauth")
    .upsert(row, { onConflict: "id" });
  if (error) throw error;
}

export async function microsoftConnected(ownerId?: string): Promise<{
  connected: boolean;
  email: string | null;
  scopes: string[];
}> {
  const data = await connectionForOwner(ownerId);
  return {
    connected: !!data?.refresh_token,
    email: data?.email || null,
    scopes: Array.isArray(data?.scopes) ? data.scopes : [],
  };
}

export async function disconnectMicrosoftConnection(): Promise<{
  disconnected: boolean;
  email: string | null;
}> {
  const scope = getRequestScope();
  if (!scope) throw new Error("A verified account is required to disconnect Microsoft");
  const existing = await connectionForOwner(scope.userId);
  if (!existing) return { disconnected: false, email: null };
  const wasConnected = !!existing.refresh_token || !!existing.access_token;
  const { data, error } = await supabaseService
    .from("microsoft_oauth")
    .update({
      refresh_token: null,
      access_token: null,
      expiry: null,
      scopes: [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("owner_id", scope.userId)
    .eq("workspace_id", scope.workspaceId)
    .select("owner_id,email,refresh_token,access_token")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Microsoft disconnect was not confirmed");
  if (data.refresh_token || data.access_token)
    throw new Error("Microsoft credentials were not cleared");
  return { disconnected: wasConnected, email: data.email || existing.email || null };
}

export async function getMicrosoftAccessToken(
  forceRefresh = false,
  ownerId?: string
): Promise<string | null> {
  const data = await connectionForOwner(ownerId);
  if (!data?.refresh_token) return null;
  if (
    !forceRefresh &&
    data.access_token &&
    data.expiry &&
    new Date(data.expiry).getTime() - Date.now() > 60_000
  ) {
    return data.access_token;
  }

  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
    grant_type: "refresh_token",
    refresh_token: data.refresh_token,
    scope: MICROSOFT_SCOPES.join(" "),
  });
  const response = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) return null;
  const token = await response.json();
  const accessToken = String(token.access_token || "");
  if (!accessToken) return null;
  const expiry = new Date(
    Date.now() + Number(token.expires_in || 3600) * 1000
  ).toISOString();
  const patch: Record<string, unknown> = {
    access_token: accessToken,
    expiry,
    scopes: String(token.scope || "")
      .split(/\s+/)
      .filter(Boolean),
    updated_at: new Date().toISOString(),
  };
  if (token.refresh_token) patch.refresh_token = token.refresh_token;
  await supabaseService
    .from("microsoft_oauth")
    .update(patch)
    .eq("id", data.id)
    .eq("owner_id", data.owner_id);
  return accessToken;
}

async function graphFetch(
  pathOrUrl: string,
  init: GraphFetchInit = {},
  ownerId?: string
): Promise<Response | null> {
  const url = pathOrUrl.startsWith("https://graph.microsoft.com/")
    ? pathOrUrl
    : `${GRAPH}${pathOrUrl}`;
  if (!url.startsWith("https://graph.microsoft.com/")) return null;
  const request = (accessToken: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
  try {
    let token = await getMicrosoftAccessToken(false, ownerId);
    if (!token) return null;
    let response = await request(token);
    if (response.status === 401) {
      token = await getMicrosoftAccessToken(true, ownerId);
      if (token) response = await request(token);
    }
    return response;
  } catch {
    return null;
  }
}

export async function microsoftProfile(ownerId?: string): Promise<{
  id: string;
  email: string;
  displayName: string;
} | null> {
  const response = await graphFetch(
    "/me?$select=id,mail,userPrincipalName,displayName",
    {},
    ownerId
  );
  if (!response?.ok) return null;
  const data = await response.json();
  const email = String(data.mail || data.userPrincipalName || "")
    .trim()
    .toLowerCase();
  if (!data.id || !email) return null;
  return {
    id: String(data.id),
    email,
    displayName: String(data.displayName || email),
  };
}

export async function microsoftAccessStatus(ownerId?: string): Promise<{
  status: "ok" | "missing" | "disconnected";
  email: string | null;
  mailRead: boolean;
  mailSend: boolean;
  mailDraft: boolean;
  calendar: boolean;
}> {
  const connection = await microsoftConnected(ownerId);
  if (!connection.connected) {
    return {
      status: "disconnected",
      email: null,
      mailRead: false,
      mailSend: false,
      mailDraft: false,
      calendar: false,
    };
  }
  const profile = await microsoftProfile(ownerId);
  const scopes = new Set(connection.scopes.map((scope) => scope.toLowerCase()));
  return {
    status: profile ? "ok" : "missing",
    email: profile?.email || connection.email,
    mailRead: scopes.has("mail.read") || scopes.has("mail.readwrite"),
    mailSend: scopes.has("mail.send"),
    mailDraft: scopes.has("mail.readwrite"),
    calendar:
      scopes.has("calendars.read") || scopes.has("calendars.readwrite"),
  };
}

const cleanGraphDate = (value: unknown, timeZone: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw)) return new Date(raw).toISOString();
  if (String(timeZone || "").toUpperCase() === "UTC") {
    return new Date(`${raw}Z`).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

const meetingUrlFromMicrosoftEvent = (event: any): string | null => {
  const direct = event?.onlineMeeting?.joinUrl || event?.onlineMeetingUrl;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const text = [
    event?.location?.displayName,
    event?.bodyPreview,
    event?.webLink,
  ]
    .filter(Boolean)
    .join(" ");
  const match = text.match(
    /https?:\/\/[^\s"'<>]*(?:meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|zoom\.us|zoom\.com|webex\.com|whereby\.com)[^\s"'<>]*/i
  );
  return match?.[0] || null;
};

export type MicrosoftCalendarEventInput = {
  requestId: string;
  title: string;
  startIso: string;
  endIso: string;
  attendeeEmails: string[];
  meetingUrl: string | null;
  recurrence?: CalendarRecurrence | null;
};

export async function createMicrosoftCalendarEvent(
  input: MicrosoftCalendarEventInput,
  ownerId?: string
): Promise<any> {
  const response = await graphFetch(
    "/me/calendar/events",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: input.title,
        start: input.recurrence
          ? {
              dateTime: microsoftLondonDateTime(input.startIso),
              timeZone: "GMT Standard Time",
            }
          : {
              dateTime: microsoftUtcDateTime(input.startIso),
              timeZone: "UTC",
            },
        end: input.recurrence
          ? {
              dateTime: microsoftLondonDateTime(input.endIso),
              timeZone: "GMT Standard Time",
            }
          : {
              dateTime: microsoftUtcDateTime(input.endIso),
              timeZone: "UTC",
            },
        attendees: input.attendeeEmails.map((email) => ({
          emailAddress: { address: email, name: email },
          type: "required",
        })),
        ...(input.meetingUrl
          ? {
              location: { displayName: input.meetingUrl },
              body: {
                contentType: "text",
                content: `Join the meeting\n${input.meetingUrl}`,
              },
            }
          : {}),
        allowNewTimeProposals: true,
        transactionId: input.requestId,
        ...(input.recurrence
          ? { recurrence: microsoftCalendarRecurrence(input.recurrence, input.startIso) }
          : {}),
      }),
    },
    ownerId
  );
  if (!response?.ok) {
    throw new Error(
      `Microsoft calendar event creation failed (${response?.status || 0})`
    );
  }
  return response.json();
}

export async function getMicrosoftCalendarEvent(
  eventId: string,
  ownerId?: string
): Promise<any> {
  const response = await graphFetch(
    `/me/events/${encodeURIComponent(
      eventId
    )}?$select=id,subject,start,end,attendees,location`,
    { headers: { Prefer: 'outlook.timezone="UTC"' } },
    ownerId
  );
  if (!response?.ok) {
    throw new Error(
      `Microsoft calendar event read failed (${response?.status || 0})`
    );
  }
  return response.json();
}

export async function updateMicrosoftCalendarEvent(
  eventId: string,
  input: Omit<MicrosoftCalendarEventInput, "requestId">,
  ownerId?: string
): Promise<any> {
  const response = await graphFetch(
    `/me/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: input.title,
        start: {
          dateTime: microsoftUtcDateTime(input.startIso),
          timeZone: "UTC",
        },
        end: {
          dateTime: microsoftUtcDateTime(input.endIso),
          timeZone: "UTC",
        },
        attendees: input.attendeeEmails.map((email) => ({
          emailAddress: { address: email, name: email },
          type: "required",
        })),
        location: { displayName: input.meetingUrl || "" },
      }),
    },
    ownerId
  );
  if (!response?.ok) {
    throw new Error(
      `Microsoft calendar event update failed (${response?.status || 0})`
    );
  }
  return response.status === 204 ? {} : response.json();
}

export async function deleteMicrosoftCalendarEvent(
  eventId: string,
  ownerId?: string
): Promise<void> {
  const response = await graphFetch(
    `/me/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
    ownerId
  );
  if (response?.status === 404 || response?.status === 410) return;
  if (!response?.ok) {
    throw new Error(
      `Microsoft calendar event cancellation failed (${response?.status || 0})`
    );
  }
}

async function listCalendarEvents(
  calendarId: string | null,
  timeMinIso: string,
  timeMaxIso: string,
  ownerId?: string
): Promise<any[]> {
  const path = calendarId
    ? `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
    : "/me/calendarView";
  const params = new URLSearchParams({
    startDateTime: timeMinIso,
    endDateTime: timeMaxIso,
    $top: "250",
    $select:
      "id,subject,start,end,isCancelled,onlineMeeting,onlineMeetingUrl,webLink,location,attendees,organizer,bodyPreview,responseStatus",
  });
  let url = `${path}?${params.toString()}`;
  const events: any[] = [];
  for (let page = 0; page < 20 && url; page += 1) {
    const response = await graphFetch(
      url,
      { headers: { Prefer: 'outlook.timezone="UTC"' } },
      ownerId
    );
    if (!response?.ok) throw new Error(`Microsoft calendar list failed (${response?.status || 0})`);
    const data = await response.json();
    if (Array.isArray(data.value)) events.push(...data.value);
    url = typeof data["@odata.nextLink"] === "string" ? data["@odata.nextLink"] : "";
  }
  return events;
}

export async function listAllMicrosoftEventsSnapshot(
  timeMinIso: string,
  timeMaxIso: string,
  ownerId?: string
): Promise<MicrosoftEventSnapshot> {
  const profile = await microsoftProfile(ownerId);
  if (!profile) throw new Error("Microsoft Calendar is not connected");
  const calendarResponse = await graphFetch(
    "/me/calendars?$top=100&$select=id,name",
    {},
    ownerId
  );
  const calendarData = calendarResponse?.ok ? await calendarResponse.json() : null;
  const calendars = Array.isArray(calendarData?.value) ? calendarData.value : [];
  const targets = calendars.length
    ? calendars.map((calendar: any) => ({ id: String(calendar.id), name: String(calendar.name || calendar.id) }))
    : [{ id: null, name: "primary" }];
  const failedCalendars: string[] = [];
  const batches = await Promise.all(
    targets.map(async (calendar: { id: string | null; name: string }) => {
      try {
        return await listCalendarEvents(calendar.id, timeMinIso, timeMaxIso, ownerId);
      } catch {
        failedCalendars.push(calendar.name);
        return [];
      }
    })
  );
  const byId = new Map<string, any>();
  for (const event of batches.flat()) {
    if (!event?.id || byId.has(String(event.id))) continue;
    const attendees = Array.isArray(event.attendees)
      ? event.attendees.map((attendee: any) => {
          const email = String(attendee?.emailAddress?.address || "").toLowerCase();
          return {
            email,
            displayName: attendee?.emailAddress?.name || email,
            self: email === profile.email,
            responseStatus: attendee?.status?.response || "none",
          };
        })
      : [];
    byId.set(String(event.id), {
      id: String(event.id),
      status: event.isCancelled ? "cancelled" : "confirmed",
      summary: String(event.subject || "Untitled meeting"),
      start: {
        dateTime: cleanGraphDate(event?.start?.dateTime, event?.start?.timeZone),
      },
      attendees,
      htmlLink: event.webLink || null,
      meeting_url: meetingUrlFromMicrosoftEvent(event),
    });
  }
  return {
    events: [...byId.values()],
    complete: failedCalendars.length === 0,
    failedCalendars,
  };
}

const recipientList = (items: any): string =>
  (Array.isArray(items) ? items : [])
    .map((item: any) => {
      const email = String(item?.emailAddress?.address || "").trim();
      const name = String(item?.emailAddress?.name || "").trim();
      return name && email ? `${name} <${email}>` : email;
    })
    .filter(Boolean)
    .join(", ");

const headerValue = (headers: any, name: string): string => {
  const item = (Array.isArray(headers) ? headers : []).find(
    (header: any) => String(header?.name || "").toLowerCase() === name.toLowerCase()
  );
  return String(item?.value || "");
};

const graphMessage = (message: any): GmailMsg | null => {
  if (!message?.id) return null;
  const received = message.receivedDateTime || message.sentDateTime || "";
  const fromEmail = String(message?.from?.emailAddress?.address || "");
  const fromName = String(message?.from?.emailAddress?.name || "");
  return {
    id: String(message.id),
    threadId: String(message.conversationId || ""),
    date: received ? new Date(received).toISOString() : "",
    from: fromName && fromEmail ? `${fromName} <${fromEmail}>` : fromEmail,
    to: recipientList(message.toRecipients),
    cc: recipientList(message.ccRecipients),
    subject: String(message.subject || ""),
    snippet: String(message.bodyPreview || ""),
    autoSubmitted: headerValue(message.internetMessageHeaders, "Auto-Submitted"),
    listUnsubscribe: headerValue(message.internetMessageHeaders, "List-Unsubscribe"),
  };
};

const messageSelect =
  "id,conversationId,receivedDateTime,sentDateTime,subject,bodyPreview,from,toRecipients,ccRecipients,internetMessageHeaders";

export async function recentMicrosoftMessages(
  query: string,
  max = 12,
  ownerId?: string
): Promise<GmailMsg[]> {
  const sentOnly = /\bin:sent\b/i.test(query);
  const path = sentOnly ? "/me/mailFolders/sentitems/messages" : "/me/messages";
  const params = new URLSearchParams({
    $top: String(Math.min(Math.max(max * 4, 25), 100)),
    $orderby: sentOnly ? "sentDateTime desc" : "receivedDateTime desc",
    $select: messageSelect,
  });
  const response = await graphFetch(`${path}?${params.toString()}`, {}, ownerId);
  if (!response?.ok) return [];
  const data = await response.json();
  const fromEmails = [...query.matchAll(/\bfrom:([^\s)]+)/gi)].map((match) => match[1].toLowerCase());
  const toEmails = [...query.matchAll(/\bto:([^\s)]+)/gi)].map((match) => match[1].toLowerCase());
  const newerDays = Number(query.match(/\bnewer_than:(\d+)d\b/i)?.[1] || 0);
  const cutoff = newerDays ? Date.now() - newerDays * 86400000 : 0;
  const quoted = query.match(/"([^"]+)"/)?.[1]?.toLowerCase() || "";
  const domain = query.match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase() || "";
  const combinesAddressesWithOr =
    /\bOR\b/i.test(query) && (fromEmails.length > 0 || toEmails.length > 0);
  return (Array.isArray(data.value) ? data.value : [])
    .map(graphMessage)
    .filter((message: GmailMsg | null): message is GmailMsg => !!message)
    .filter((message: GmailMsg) => {
      if (cutoff && new Date(message.date).getTime() < cutoff) return false;
      const from = message.from.toLowerCase();
      const recipients = `${message.to} ${message.cc}`.toLowerCase();
      const matchesFrom = fromEmails.some((email) => from.includes(email));
      const matchesTo = toEmails.some((email) => recipients.includes(email));
      if (combinesAddressesWithOr) {
        if (!matchesFrom && !matchesTo) return false;
      } else {
        if (fromEmails.length && !matchesFrom) return false;
        if (toEmails.length && !matchesTo) return false;
      }
      const haystack = `${message.from} ${message.to} ${message.cc} ${message.subject}`.toLowerCase();
      if (quoted && !haystack.includes(quoted)) return false;
      if (domain && !haystack.includes(`@${domain}`)) return false;
      return true;
    })
    .slice(0, Math.min(Math.max(max, 1), 25));
}

const htmlToText = (value: string): string =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export async function freshMicrosoftMessageText(
  id: string,
  max = 6000,
  ownerId?: string
): Promise<string> {
  if (!id) return "";
  const response = await graphFetch(
    `/me/messages/${encodeURIComponent(id)}?$select=body,bodyPreview`,
    {},
    ownerId
  );
  if (!response?.ok) return "";
  const data = await response.json();
  const raw = data?.body?.contentType === "html"
    ? htmlToText(String(data?.body?.content || ""))
    : String(data?.body?.content || data?.bodyPreview || "");
  // Match Gmail's low-token behaviour by keeping only the newest reply rather
  // than feeding the entire quoted thread back into the CRM Brain.
  return freshReplyOnly(raw, max);
}

export async function newMicrosoftInboxMessagesSince(
  cursor: string | null,
  maxMessages = 50,
  ownerId?: string
): Promise<GmailInboxDelta> {
  const initial = `${GRAPH}/me/mailFolders/inbox/messages/delta?${new URLSearchParams({
    $select: messageSelect,
    $top: "100",
  }).toString()}`;
  const reset = !cursor || !cursor.startsWith("https://graph.microsoft.com/");
  let url = reset ? initial : cursor;
  const messages: GmailMsg[] = [];
  let finalCursor = cursor || "";
  for (let page = 0; page < 20 && url; page += 1) {
    const response = await graphFetch(url, {}, ownerId);
    if (!response?.ok) {
      if (!reset) return newMicrosoftInboxMessagesSince(null, maxMessages, ownerId);
      return { cursor: "", messages: [], reset: true };
    }
    const data = await response.json();
    if (!reset && Array.isArray(data.value)) {
      for (const item of data.value) {
        if (item?.["@removed"]) continue;
        const message = graphMessage(item);
        if (message) messages.push(message);
      }
    }
    const next = data["@odata.nextLink"];
    const delta = data["@odata.deltaLink"];
    if (typeof delta === "string") finalCursor = delta;
    url = typeof next === "string" ? next : "";
  }
  messages.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    cursor: finalCursor,
    messages: messages.slice(-Math.max(1, maxMessages)),
    reset,
  };
}

export async function sendMicrosoftMail(
  opts: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
    sourceMessageId?: string;
  },
  ownerId?: string
): Promise<{ ok: boolean; id?: string; threadId?: string; error?: string }> {
  const to = String(opts.to || "").trim();
  if (!to) return { ok: false, error: "A recipient is required" };
  const sourceMessageId = String(opts.sourceMessageId || "").trim();
  if (sourceMessageId) {
    const response = await graphFetch(
      `/me/messages/${encodeURIComponent(sourceMessageId)}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: String(opts.text || htmlToText(opts.html || "")) }),
      },
      ownerId
    );
    if (!response) return { ok: false, error: "Microsoft Mail could not be reached" };
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 240);
      return {
        ok: false,
        error: `Microsoft Mail refused the reply (${response.status})${detail ? ` ${detail}` : ""}`,
      };
    }
    return { ok: true, id: sourceMessageId };
  }
  const content = opts.html || String(opts.text || "").replace(/\n/g, "<br>");
  const message: Record<string, unknown> = {
    subject: String(opts.subject || ""),
    body: { contentType: "HTML", content },
    toRecipients: [{ emailAddress: { address: to } }],
  };
  if (opts.replyTo) {
    message.replyTo = [{ emailAddress: { address: opts.replyTo } }];
  }
  const response = await graphFetch(
    "/me/sendMail",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, saveToSentItems: true }),
    },
    ownerId
  );
  if (!response) return { ok: false, error: "Microsoft Mail could not be reached" };
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    return {
      ok: false,
      error: `Microsoft Mail refused the send (${response.status})${detail ? ` ${detail}` : ""}`,
    };
  }
  return { ok: true };
}

export async function createMicrosoftMailDraft(
  opts: {
    to: string;
    subject: string;
    text: string;
    sourceMessageId?: string;
  },
  ownerId?: string
): Promise<{ ok: boolean; id?: string; threadId?: string; url?: string; error?: string }> {
  const to = cleanEmailAddress(opts.to);
  if (!to) return { ok: false, error: "A valid recipient is required" };
  const text = String(opts.text || "").trim();
  if (!text) return { ok: false, error: "The email draft is empty" };
  const sourceMessageId = String(opts.sourceMessageId || "").trim();
  const response = sourceMessageId
    ? await graphFetch(
        `/me/messages/${encodeURIComponent(sourceMessageId)}/createReply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: text }),
        },
        ownerId
      )
    : await graphFetch(
        "/me/messages",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: String(opts.subject || "").slice(0, 240),
            body: { contentType: "Text", content: text },
            toRecipients: [{ emailAddress: { address: to } }],
          }),
        },
        ownerId
      );
  if (!response) {
    return { ok: false, error: "Microsoft Mail could not be reached" };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 403) {
      return {
        ok: false,
        error:
          "Microsoft draft access is missing. Reconnect Microsoft in Settings to approve Mail.ReadWrite.",
      };
    }
    return {
      ok: false,
      error: `Microsoft Mail could not create the draft (${response.status})${
        detail ? ` ${detail.slice(0, 180)}` : ""
      }`,
    };
  }
  const data = await response.json().catch(() => ({}));
  return {
    ok: true,
    id: data?.id,
    threadId: data?.conversationId,
    url: data?.webLink || "https://outlook.office.com/mail/drafts",
  };
}

function cleanEmailAddress(value: unknown): string {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
