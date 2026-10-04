import { createHash } from "node:crypto";

export const calendarChannelId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function calendarNotificationHash(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  return createHash("sha256").update(value).digest("hex");
}

export function googleCalendarNotification(headers: Headers) {
  const id = headers.get("x-goog-channel-id");
  const tokenHash = calendarNotificationHash(headers.get("x-goog-channel-token"));
  const resource = headers.get("x-goog-resource-id");
  const sequence = headers.get("x-goog-message-number");
  const state = headers.get("x-goog-resource-state");
  if (!calendarChannelId(id) || !tokenHash || !resource || resource.length > 1024
    || !sequence || !/^[1-9]\d{0,19}$/.test(sequence)
    || !["sync", "exists", "not_exists"].includes(state || "")) return null;
  return { p_channel_id: id, p_token_hash: tokenHash, p_external_id: id,
    p_resource_id: resource, p_message_number: sequence };
}

export function microsoftCalendarNotification(channelId: unknown, value: any) {
  const tokenHash = calendarNotificationHash(value?.clientState);
  const externalId = value?.subscriptionId;
  if (!calendarChannelId(channelId) || !tokenHash || typeof externalId !== "string"
    || !externalId || externalId.length > 200) return null;
  const lifecycle = value?.lifecycleEvent;
  if (lifecycle ? !["reauthorizationRequired", "subscriptionRemoved", "missed"].includes(lifecycle)
    : !["created", "updated", "deleted"].includes(value?.changeType)) return null;
  return { p_channel_id: channelId, p_token_hash: tokenHash,
    p_external_id: externalId, p_lifecycle: lifecycle || null };
}
