import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { calendarNotificationHash } from "@/lib/calendar-notification-auth";
import { connectedCalendarProvider, type CalendarProvider } from "@/lib/calendar-provider";
import { getAccessToken, listCalendars } from "@/lib/google";
import { getMicrosoftAccessToken } from "@/lib/microsoft";
import { publicAppOrigin } from "@/lib/public-app-url";
import { resolveRecordScope, type RecordScope } from "@/lib/record-scope";
import { supabaseService } from "@/lib/supabase";

const DAY = 86400000;
const CALENDAR_LIST = "__calendar_list__";
type Channel = {
  id: string; provider: CalendarProvider; calendar_id: string; connection_email: string;
  external_id: string | null; resource_id: string | null; expires_at: string;
  status: string; needs_renewal: boolean; created_at: string;
};

async function providerRequest(provider: CalendarProvider, ownerId: string, path: string, init: RequestInit) {
  const getToken = provider === "google" ? getAccessToken : getMicrosoftAccessToken;
  const base = provider === "google" ? "https://www.googleapis.com/calendar/v3" : "https://graph.microsoft.com/v1.0";
  const send = (token: string) => fetch(`${base}${path}`, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(12000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  let token = await getToken(false, ownerId);
  if (!token) throw new Error("calendar_disconnected");
  let response = await send(token);
  if (response.status === 401) {
    token = await getToken(true, ownerId);
    if (token) response = await send(token);
  }
  return response;
}

async function saveChannel(scope: RecordScope, id: string, patch: Record<string, unknown>) {
  const { error } = await supabaseService.from("calendar_notification_channels")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id).eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId);
  if (error) throw error;
}

function callbackFor(channel: Pick<Channel, "provider" | "id">) {
  const base = `${publicAppOrigin()}/api/webhooks/calendar/${channel.provider}`;
  return channel.provider === "microsoft" ? `${base}?channel=${channel.id}` : base;
}

async function stopChannel(scope: RecordScope, channel: Channel) {
  // Invalidate locally first so even a provider deletion failure cannot route
  // another person's old mailbox through this account after reconnecting.
  await saveChannel(scope, channel.id, { status: "stopped" });
  if (Date.parse(channel.expires_at) <= Date.now()) return;
  try {
    if (channel.provider === "google" && channel.resource_id) {
      await providerRequest("google", scope.userId, "/channels/stop", {
        method: "POST", body: JSON.stringify({ id: channel.id, resourceId: channel.resource_id }),
      });
    } else if (channel.provider === "microsoft" && channel.external_id) {
      await providerRequest("microsoft", scope.userId, `/subscriptions/${encodeURIComponent(channel.external_id)}`, { method: "DELETE" });
    }
  } catch { /* The expired/retired channel is already fail-closed locally. */ }
}

export async function disableCalendarWatches(scope: RecordScope, provider: CalendarProvider) {
  const { error } = await supabaseService.from("calendar_notification_channels")
    .update({ status: "stopped", updated_at: new Date().toISOString() })
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("provider", provider)
    .in("status", ["pending", "active"]);
  if (error) throw error;
}

async function activateChannel(scope: RecordScope, id: string, provider: CalendarProvider, result: any) {
  const expires = provider === "google" ? Number(result?.expiration) : Date.parse(result?.expirationDateTime || "");
  if (!result?.id || !Number.isFinite(expires) || expires <= Date.now()
    || (provider === "google" && (result.id !== id || !result.resourceId))) {
    throw new Error("calendar_watch_not_confirmed");
  }
  await saveChannel(scope, id, {
    external_id: String(result.id), resource_id: result.resourceId || null,
    expires_at: new Date(expires).toISOString(), status: "active", needs_renewal: false, last_error: null,
  });
}

async function createChannel(scope: RecordScope, provider: CalendarProvider, calendarId: string, email: string) {
  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const { error } = await supabaseService.from("calendar_notification_channels").insert({
    id, workspace_id: scope.workspaceId, owner_id: scope.userId, provider, calendar_id: calendarId,
    connection_email: email, token_hash: calendarNotificationHash(token),
    external_id: provider === "google" ? id : null,
    // The initial sync notification can arrive before the create response.
    expires_at: new Date(Date.now() + 10 * 60000).toISOString(), status: "pending",
  });
  if (error) throw error;
  try {
    const callback = callbackFor({ provider, id });
    const path = provider === "microsoft" ? "/subscriptions"
      : calendarId === CALENDAR_LIST ? "/users/me/calendarList/watch"
      : `/calendars/${encodeURIComponent(calendarId)}/events/watch`;
    const body = provider === "google" ? {
      id, token, type: "web_hook", address: callback, params: { ttl: "604800" },
    } : {
      resource: "/me/events", changeType: "created,updated,deleted", clientState: token,
      notificationUrl: callback, lifecycleNotificationUrl: callback,
      expirationDateTime: new Date(Date.now() + 6 * DAY).toISOString(),
    };
    const response = await providerRequest(provider, scope.userId, path, { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`calendar_watch_${response.status}`);
    await activateChannel(scope, id, provider, await response.json());
  } catch (error: any) {
    // Keep an uncertain create pending. Recovery can find Microsoft's created
    // subscription after a timeout, rather than creating a duplicate forever.
    await saveChannel(scope, id, { last_error: String(error?.message || "calendar_watch_failed").slice(0, 100) });
    throw error;
  }
}

async function renewMicrosoft(scope: RecordScope, channel: Channel) {
  let externalId = channel.external_id;
  if (!externalId) {
    const response = await providerRequest("microsoft", scope.userId, "/subscriptions", { method: "GET" });
    if (!response.ok) throw new Error(`calendar_watch_recovery_${response.status}`);
    const result = await response.json();
    const existing = (result.value || []).find((item: any) => item.notificationUrl === callbackFor(channel));
    externalId = existing?.id || null;
    if (existing) await activateChannel(scope, channel.id, "microsoft", existing);
  }
  if (!externalId) return false;
  const response = await providerRequest("microsoft", scope.userId, `/subscriptions/${encodeURIComponent(externalId)}`, {
    method: "PATCH", body: JSON.stringify({ expirationDateTime: new Date(Date.now() + 6 * DAY).toISOString() }),
  });
  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok) throw new Error(`calendar_watch_renew_${response.status}`);
  await activateChannel(scope, channel.id, "microsoft", await response.json());
  return true;
}

// Called inside the account's calendar-sync lease. No second calendar store,
// and no global OAuth credential fallback. Preview deployments cannot replace
// production subscriptions or subscribe real users to a preview endpoint.
export async function ensureCalendarWatches() {
  if (process.env.VERCEL_ENV !== "production") return { active: 0, changed: 0, failed: 0, disabled: true };
  const scope = await resolveRecordScope();
  const connection = await connectedCalendarProvider(scope.userId);
  if (!connection.provider || !connection.email) return { active: 0, changed: 0, failed: 1 };
  const provider = connection.provider;
  const email = connection.email.trim().toLowerCase();
  const { data, error } = await supabaseService.from("calendar_notification_channels").select("*")
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId)
    .in("status", ["pending", "active"]).order("created_at", { ascending: false });
  if (error) throw error;
  const channels = (data || []) as Channel[];
  let targets = ["/me/events"];
  let listComplete = true;
  if (provider === "google") {
    try {
      const token = await getAccessToken(false, scope.userId);
      if (!token) throw new Error("calendar_disconnected");
      const calendars = await listCalendars(token);
      const eligible = calendars.filter((c: any) => c.id && !/#(holiday|contacts|weather|birthday)/i.test(c.id)
        && ["owner", "writer", "reader"].includes(c.accessRole));
      targets = eligible.map((c: any) => String(c.id));
      if (!eligible.some((c: any) => c.primary)) targets.unshift("primary");
      targets.push(CALENDAR_LIST);
    } catch {
      // Never retire shared-calendar channels on a transient list failure.
      listComplete = false;
      targets = Array.from(new Set(["primary", ...channels.filter((c) => c.provider === provider
        && c.connection_email === email).map((c) => c.calendar_id)]));
    }
  }
  for (const channel of channels) {
    if (channel.provider !== provider || channel.connection_email !== email
      || (listComplete && !targets.includes(channel.calendar_id))) await stopChannel(scope, channel);
  }
  const result = { active: 0, changed: 0, failed: 0 };
  for (const calendarId of targets) {
    const matching = channels.filter((c) => c.provider === provider && c.connection_email === email && c.calendar_id === calendarId);
    const current = matching.find((c) => c.status === "active") || matching[0];
    if (current?.status === "active" && !current.needs_renewal && Date.parse(current.expires_at) > Date.now() + 36 * 3600000) {
      result.active++;
      continue;
    }
    try {
      if (provider === "microsoft" && current && await renewMicrosoft(scope, current)) {
        result.active++; result.changed++; continue;
      }
      if (provider === "microsoft" && current) await stopChannel(scope, current);
      await createChannel(scope, provider, calendarId, email);
      result.active++; result.changed++;
      // Replace first, retire afterwards so Google renewal has no watch gap.
      for (const previous of matching) await stopChannel(scope, previous);
    } catch (error: any) {
      result.failed++;
      if (current) await saveChannel(scope, current.id, { last_error: String(error?.message || "calendar_watch_failed").slice(0, 100) });
      console.error("Calendar watch needs retry", provider, String(error?.message || "calendar_watch_failed").slice(0, 100));
    }
  }
  return result;
}
