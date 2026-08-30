import { getRequestScope, isVerifiedServiceRequest } from "@/lib/request-scope";
import { getServiceRecordScope } from "@/lib/service-scope";
import { supabaseService } from "@/lib/supabase";
import { googleEventIdForRequest } from "@/lib/calendar-create";

// In-app Google Calendar connection. The deployed app reads/writes the user's
// real calendar using OAuth tokens stored in a private, per-user google_oauth
// row. All credentials come from env vars the user sets in Vercel:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
// Nothing is hardcoded.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// calendar.events lets us read AND write events; userinfo.email is just to show
// which account is connected; gmail.readonly lets the app read the mail thread
// with a contact so the brain can pull emails and build a client from them.
// gmail.readonly is a RESTRICTED scope: it must be added to the Google Cloud
// OAuth consent screen, and the user must re-connect Google in Settings once to
// grant it (prompt=consent below forces the re-grant).
// gmail.send lets the app send mail AS you, which is how the daily digest
// lands in your own inbox and shows up in your Sent folder. It is a separate
// scope from gmail.readonly and, like it, must be added to the Google Cloud
// OAuth consent screen. After adding it you MUST reconnect Google in Settings
// once, or sending 403s while reading keeps working, which looks like the
// digest silently doing nothing.
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
export const GOOGLE_CALENDAR_EVENTS_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_LIST_READ_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

const GOOGLE_CALENDAR_LIST_SCOPES = new Set([
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist",
  GOOGLE_CALENDAR_LIST_READ_SCOPE,
]);

export function googleCanListCalendars(scopes: Iterable<string>): boolean {
  for (const scope of scopes) {
    if (GOOGLE_CALENDAR_LIST_SCOPES.has(scope)) return true;
  }
  return false;
}

const SCOPE = [
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_CALENDAR_LIST_READ_SCOPE,
  "https://www.googleapis.com/auth/userinfo.email",
  GMAIL_READ_SCOPE,
  GMAIL_SEND_SCOPE,
  GMAIL_COMPOSE_SCOPE,
  GOOGLE_DRIVE_FILE_SCOPE,
].join(" ");

export function googleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || "",
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // get a refresh token
    prompt: "consent", // force a refresh token on every connect
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

// Exchange the auth code for tokens after the user consents.
export async function exchangeCode(code: string): Promise<any> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || "",
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return res.json();
}

type GoogleConnection = {
  id: string;
  owner_id: string;
  workspace_id: string;
  refresh_token: string | null;
  access_token: string | null;
  expiry: string | null;
  email: string | null;
};

async function connectionForOwner(
  ownerId?: string
): Promise<GoogleConnection | null> {
  const requestScope = getRequestScope();
  const serviceScope = getServiceRecordScope();
  if (requestScope && ownerId && ownerId !== requestScope.userId) {
    throw new Error("Cross-account Google access is not permitted");
  }
  if (serviceScope && ownerId && ownerId !== serviceScope.userId) {
    throw new Error("Cross-account Google service access is not permitted");
  }
  const exactOwner = ownerId || requestScope?.userId || serviceScope?.userId || null;

  if (exactOwner) {
    const { data, error } = await supabaseService
      .from("google_oauth")
      .select(
        "id,owner_id,workspace_id,refresh_token,access_token,expiry,email"
      )
      .eq("owner_id", exactOwner)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as GoogleConnection | null) || null;
  }

  // Existing crons predate per-user connectors. They may use the only stored
  // connection while LiveCoach still has one member. The moment a second
  // connection exists they fail closed until the cron explicitly supplies an
  // owner, preventing one person's mailbox or calendar from being selected by
  // accident.
  if (!isVerifiedServiceRequest()) {
    throw new Error("A verified account is required for Google access");
  }
  const { data, error } = await supabaseService
    .from("google_oauth")
    .select("id,owner_id,workspace_id,refresh_token,access_token,expiry,email")
    .order("updated_at", { ascending: false })
    .limit(2);
  if (error) throw error;
  if (!data?.length) return null;
  if (data.length !== 1) {
    throw new Error("A Google connector owner must be selected for this job");
  }
  return data[0] as GoogleConnection;
}

export async function saveGoogleConnection(input: {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiry: string;
  email?: string | null;
}): Promise<void> {
  const scope = getRequestScope();
  if (!scope) throw new Error("A verified account is required to connect Google");
  return saveGoogleConnectionForOwner(input, {
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  });
}

export async function saveGoogleConnectionForOwner(
  input: {
    accessToken?: string | null;
    refreshToken?: string | null;
    expiry: string;
    email?: string | null;
  },
  owner: { userId: string; workspaceId: string }
): Promise<void> {
  const { data: existing, error: existingError } = await supabaseService
    .from("google_oauth")
    .select("id")
    .eq("workspace_id", owner.workspaceId)
    .eq("owner_id", owner.userId)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  const row: Record<string, unknown> = {
    id: existing?.id || `user:${owner.userId}`,
    owner_id: owner.userId,
    workspace_id: owner.workspaceId,
    visibility: "private",
    access_token: input.accessToken || null,
    expiry: input.expiry,
    updated_at: new Date().toISOString(),
  };
  if (input.refreshToken) row.refresh_token = input.refreshToken;
  if (input.email) row.email = input.email;
  const { error } = await supabaseService
    .from("google_oauth")
    .upsert(row, { onConflict: "id" });
  if (error) throw error;
}

// Whether a calendar is connected (a refresh token is on file).
export async function googleConnected(
  ownerId?: string
): Promise<{ connected: boolean; email: string | null }> {
  const data = await connectionForOwner(ownerId);
  return { connected: !!data?.refresh_token, email: data?.email || null };
}

export async function disconnectGoogleConnection(): Promise<{
  disconnected: boolean;
  email: string | null;
}> {
  const scope = getRequestScope();
  if (!scope) throw new Error("A verified account is required to disconnect Google");
  const existing = await connectionForOwner(scope.userId);
  if (!existing) return { disconnected: false, email: null };
  const wasConnected = !!existing.refresh_token || !!existing.access_token;
  const { data, error } = await supabaseService
    .from("google_oauth")
    .update({
      refresh_token: null,
      access_token: null,
      expiry: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("owner_id", scope.userId)
    .eq("workspace_id", scope.workspaceId)
    .select("owner_id,email,refresh_token,access_token")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Google disconnect was not confirmed");
  if (data.refresh_token || data.access_token)
    throw new Error("Google credentials were not cleared");
  return { disconnected: wasConnected, email: data.email || existing.email || null };
}

// A valid access token, refreshing via the stored refresh token when needed.
// Returns null if not connected.
export async function getAccessToken(
  forceRefresh = false,
  ownerId?: string
): Promise<string | null> {
  const data = await connectionForOwner(ownerId);
  if (!data?.refresh_token) return null;
  // Reuse the cached access token while it has more than a minute left.
  if (
    !forceRefresh &&
    data.access_token &&
    data.expiry &&
    new Date(data.expiry).getTime() - Date.now() > 60_000
  ) {
    return data.access_token;
  }
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: data.refresh_token,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const tok = await res.json();
  const access = tok.access_token as string;
  const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();
  await supabaseService
    .from("google_oauth")
    .update({ access_token: access, expiry, updated_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("owner_id", data.owner_id);
  return access;
}

// Google can be connected while the stored grant is missing a newer scope.
// Tokeninfo lets Settings distinguish that partial state without sending a
// test email or exposing the access token to the browser.
export async function googleGrantedScopes(ownerId?: string): Promise<Set<string>> {
  const token = await getAccessToken(false, ownerId);
  if (!token) return new Set();
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
      { cache: "no-store", signal: AbortSignal.timeout(6_000) }
    );
    if (!response.ok) return new Set();
    const data = await response.json();
    return new Set(String(data.scope || "").split(/\s+/).filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function googleHasScope(scope: string, ownerId?: string): Promise<boolean> {
  return (await googleGrantedScopes(ownerId)).has(scope);
}

// List events on ONE calendar between two ISO times (single instances, recurring
// expanded). Defaults to the primary calendar.
export async function listEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string,
  calendarId = "primary"
): Promise<any[]> {
  const p = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events?${p.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`calendar list failed (${res.status})`);
  const d = await res.json();
  return Array.isArray(d.items) ? d.items : [];
}

export type GoogleCalendarEventInput = {
  requestId: string;
  title: string;
  startIso: string;
  endIso: string;
  attendeeEmails: string[];
  meetingUrl: string | null;
};

export async function createGoogleCalendarEvent(
  accessToken: string,
  input: GoogleCalendarEventInput
): Promise<any> {
  const eventId = googleEventIdForRequest(input.requestId);
  const query = new URLSearchParams();
  if (input.attendeeEmails.length) query.set("sendUpdates", "all");
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/primary/events${
    query.size ? `?${query.toString()}` : ""
  }`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: eventId,
      summary: input.title,
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
      attendees: input.attendeeEmails.map((email) => ({ email })),
      ...(input.meetingUrl ? { location: input.meetingUrl } : {}),
      extendedProperties: {
        private: { livecoachRequestId: input.requestId },
      },
    }),
    cache: "no-store",
  });

  // The caller supplies a deterministic ID. If the browser retries after the
  // first response was lost, Google returns 409. Read that exact event rather
  // than creating a duplicate or telling the user nothing happened.
  if (response.status === 409) {
    const existing = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
        eventId
      )}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );
    if (existing.ok) return existing.json();
  }
  if (!response.ok) {
    const error = new Error(
      `Google calendar event creation failed (${response.status})`
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// The calendars this account can see (its calendar list). Used to read events
// across ALL of them, not just the primary, so a personal calendar shared into
// the connected account (e.g. lee.nazari@gmail.com shared into lee@ai13.com)
// flows in too.
export async function listCalendars(accessToken: string): Promise<any[]> {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const error = new Error(`calendar list failed (${res.status})`) as Error & {
      status?: number;
    };
    error.status = res.status;
    throw error;
  }
  const d = await res.json();
  return Array.isArray(d.items) ? d.items : [];
}

// Events across EVERY calendar the account can see (owner / writer / reader),
// skipping holiday / birthday / contacts noise calendars, deduped so a meeting
// that appears on both the primary and a shared calendar is only counted once
// (by iCalUID). Best-effort per calendar: one that can't be read is skipped.
export async function listAllEventsSnapshot(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<{
  events: any[];
  complete: boolean;
  failedCalendars: string[];
  calendarListAccessible: boolean | null;
}> {
  let cals: any[] = [];
  let complete = true;
  let calendarListAccessible: boolean | null = true;
  const failedCalendars: string[] = [];
  try {
    cals = await listCalendars(accessToken);
  } catch (error: any) {
    // calendar.events can read the primary calendar, but it cannot enumerate
    // secondary or shared calendars. Keep the usable primary events while
    // marking this snapshot partial, so callers never report a false complete
    // sync or delete rows that may still exist on a calendar we could not see.
    cals = [];
    complete = false;
    calendarListAccessible = error?.status === 403 ? false : null;
    failedCalendars.push(
      calendarListAccessible === false
        ? "calendar list permission"
        : "calendar list"
    );
  }
  const NOISE = /#(holiday|contacts|weather|birthday)/i;
  const eligible = cals.filter((c) => {
    const id = String(c?.id || "");
    if (!id || NOISE.test(id)) return false;
    const role = String(c?.accessRole || "");
    return role === "owner" || role === "writer" || role === "reader";
  });
  const ids = eligible.length ? eligible.map((c) => String(c.id)) : ["primary"];
  if (!ids.includes("primary") && !eligible.some((c) => c?.primary))
    ids.unshift("primary");

  const all: any[] = [];
  for (const id of ids) {
    try {
      const evs = await listEvents(accessToken, timeMinIso, timeMaxIso, id);
      for (const e of evs) all.push(e);
    } catch {
      // Keep the usable events, but flag the snapshot as incomplete. Callers
      // may safely add/update from it, but must not infer that absent events
      // were cancelled.
      complete = false;
      failedCalendars.push(id === "primary" ? "primary calendar" : id);
    }
  }
  // Dedupe: the same meeting can sit on the primary (as an invitee) AND a shared
  // calendar. Keep the first seen (primary is read first), keyed by iCalUID.
  const seen = new Set<string>();
  const out: any[] = [];
  for (const e of all) {
    const key = String(e?.iCalUID || e?.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return { events: out, complete, failedCalendars, calendarListAccessible };
}

export async function listAllEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<any[]> {
  const snapshot = await listAllEventsSnapshot(
    accessToken,
    timeMinIso,
    timeMaxIso
  );
  return snapshot.events;
}

// Any join link we recognise as a video meeting, across the providers other
// people actually send. Google Meet is the common case for the user's own
// invites; Teams / Zoom / Webex etc. turn up on invites others organise.
const MEETING_PROVIDERS =
  /https?:\/\/[^\s"'<>]*(?:meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|teams\.microsoft\.us|zoom\.us|zoom\.com|webex\.com|gotomeeting\.com|gotomeet\.me|whereby\.com|meet\.jit\.si|chime\.aws|bluejeans\.com|around\.co|around\.com)[^\s"'<>]*/i;

// Microsoft/Outlook rewrites links into a SafeLinks redirect, so a Teams URL
// arrives url-encoded inside safelinks.protection.outlook.com. Unwrap the real
// destination from its url= parameter so we can recognise the provider.
function unwrapSafeLinks(haystack: string): string | null {
  const safe = haystack.match(
    /https?:\/\/[^\s"'<>]*safelinks\.protection\.outlook\.com\/[^\s"'<>]*/i
  );
  if (!safe) return null;
  const u = safe[0].match(/[?&]url=([^&]+)/i);
  if (!u) return null;
  try {
    return decodeURIComponent(u[1]);
  } catch {
    return null;
  }
}

// Best-effort meeting link, in priority order: Google Meet's own field, a
// conference entry point (Meet or any provider Google recorded), then a link
// pasted into the LOCATION or DESCRIPTION of an invite (this is where external
// Teams / Zoom / Webex invites put the join URL - they have no Google
// conferenceData). SafeLinks-wrapped Teams URLs are unwrapped first.
export function meetingUrlOf(ev: any): string | null {
  if (typeof ev.hangoutLink === "string" && ev.hangoutLink) return ev.hangoutLink;
  const eps = ev.conferenceData?.entryPoints;
  if (Array.isArray(eps)) {
    const video = eps.find((e: any) => e.entryPointType === "video" && e.uri);
    if (video) return video.uri;
  }
  const loc = typeof ev.location === "string" ? ev.location : "";
  const desc = typeof ev.description === "string" ? ev.description : "";
  const hay = `${loc}\n${desc}`;

  // Unwrap a SafeLinks redirect first, so a wrapped Teams link is recognised.
  const unwrapped = unwrapSafeLinks(hay);
  if (unwrapped) {
    const um = unwrapped.match(MEETING_PROVIDERS);
    if (um) return um[0];
  }
  const m = hay.match(MEETING_PROVIDERS);
  return m ? m[0] : null;
}

// A readable title from a bare email-style summary.
export function titleOf(ev: any): string {
  const s = typeof ev.summary === "string" ? ev.summary.trim() : "";
  if (!s) return "Call";
  return s;
}
