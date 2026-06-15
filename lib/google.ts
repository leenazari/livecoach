import { supabaseAdmin } from "@/lib/supabase";

// In-app Google Calendar connection. The deployed app reads/writes the user's
// real calendar using OAuth tokens stored in the google_oauth table (single
// row, id='main'). All credentials come from env vars the user sets in Vercel:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
// Nothing is hardcoded.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
// calendar.events lets us read AND write events; userinfo.email is just to show
// which account is connected.
const SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
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

// Whether a calendar is connected (a refresh token is on file).
export async function googleConnected(): Promise<{ connected: boolean; email: string | null }> {
  const { data } = await supabaseAdmin
    .from("google_oauth")
    .select("refresh_token, email")
    .eq("id", "main")
    .maybeSingle();
  return { connected: !!data?.refresh_token, email: data?.email || null };
}

// A valid access token, refreshing via the stored refresh token when needed.
// Returns null if not connected.
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("google_oauth")
    .select("refresh_token, access_token, expiry")
    .eq("id", "main")
    .maybeSingle();
  if (!data?.refresh_token) return null;
  // Reuse the cached access token while it has more than a minute left.
  if (
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
  await supabaseAdmin
    .from("google_oauth")
    .update({ access_token: access, expiry, updated_at: new Date().toISOString() })
    .eq("id", "main");
  return access;
}

// List events on the primary calendar between two ISO times (single instances,
// recurring expanded).
export async function listEvents(
  accessToken: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<any[]> {
  const p = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`calendar list failed (${res.status})`);
  const d = await res.json();
  return Array.isArray(d.items) ? d.items : [];
}

// Best-effort meeting link: Google Meet, else a conference entry point, else a
// Teams/Zoom/Meet link found in the description.
export function meetingUrlOf(ev: any): string | null {
  if (typeof ev.hangoutLink === "string" && ev.hangoutLink) return ev.hangoutLink;
  const eps = ev.conferenceData?.entryPoints;
  if (Array.isArray(eps)) {
    const video = eps.find((e: any) => e.entryPointType === "video" && e.uri);
    if (video) return video.uri;
  }
  const desc = typeof ev.description === "string" ? ev.description : "";
  const m = desc.match(
    /https?:\/\/[^\s"'<>]*(?:teams\.microsoft\.com|zoom\.us|meet\.google\.com)[^\s"'<>]*/i
  );
  return m ? m[0] : null;
}

// A readable title from a bare email-style summary.
export function titleOf(ev: any): string {
  const s = typeof ev.summary === "string" ? ev.summary.trim() : "";
  if (!s) return "Call";
  return s;
}
