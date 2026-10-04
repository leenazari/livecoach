import "server-only";

import { supabaseService } from "@/lib/supabase";
import { PRECALL_LEAD_MS } from "@/lib/precall-schedule";

async function recallRequest(
  endpoint: string,
  key: string,
  init: Omit<RequestInit, "headers"> = {}
) {
  const call = (authorization: string) =>
    fetch(endpoint, {
      ...init,
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: authorization,
        Accept: "application/json",
      },
    });
  let response = await call(key);
  if (response.status === 401 || response.status === 403) {
    response = await call(`Token ${key}`);
  }
  return response;
}

export async function cancelRecallBotRequest(input: {
  region: string;
  key: string;
  botId: string;
}) {
  const endpoint = `https://${input.region}.recall.ai/api/v1/bot/${encodeURIComponent(
    input.botId
  )}/`;
  const deleted = await recallRequest(endpoint, input.key, { method: "DELETE" });
  if (deleted.ok || deleted.status === 404) return true;

  // Recall stops accepting a scheduled-bot deletion shortly before it starts
  // joining. The leave endpoint is the safe fallback inside that boundary.
  const left = await recallRequest(`${endpoint}leave_call/`, input.key, {
    method: "POST",
  });
  return left.ok || left.status === 404;
}

export async function cancelScheduledNotetakers(input: {
  workspaceId: string;
  ownerId: string;
  upcomingIds: string[];
}) {
  const upcomingIds = Array.from(new Set(input.upcomingIds.filter(Boolean)));
  if (!upcomingIds.length) return { cancelled: 0 };

  // A shared calendar meeting can have one provider bot and several private
  // user subscriptions. Resolve the caller through their exact upcoming-call
  // subscription instead of assuming they own the underlying provider bot.
  const { data: loadedSubscriptions, error: subscriptionLoadError } =
    await supabaseService
      .from("meet_capture_subscribers")
      .select("id,capture_id,session_id,upcoming_id")
      .eq("workspace_id", input.workspaceId)
      .eq("owner_id", input.ownerId)
      .in("upcoming_id", upcomingIds)
      .in("status", ["scheduled", "active"]);
  if (subscriptionLoadError) throw subscriptionLoadError;

  const subscribedCaptureIds = Array.from(
    new Set((loadedSubscriptions || []).map((row: any) => String(row.capture_id)))
  );
  const nowIso = new Date().toISOString();
  const preMeetingBoundary = new Date(Date.now() - PRECALL_LEAD_MS).toISOString();
  const { data: subscribedCaptures, error: subscribedCaptureError } =
    subscribedCaptureIds.length
      ? await supabaseService
          .from("meet_bots")
          .select("id,bot_id,session_id,owner_id,source_upcoming_id,scheduled_join_at")
          .eq("workspace_id", input.workspaceId)
          .eq("status", "active")
          .gt("scheduled_join_at", preMeetingBoundary)
          .in("id", subscribedCaptureIds)
      : { data: [], error: null };
  if (subscribedCaptureError) throw subscribedCaptureError;

  // Keep an owner/source fallback for old or partially-created reservations
  // whose trigger subscription is missing. It remains exact-account scoped.
  const { data: ownedCaptures, error: ownedCaptureError } = await supabaseService
    .from("meet_bots")
    .select("id,bot_id,session_id,owner_id,source_upcoming_id,scheduled_join_at")
    .eq("workspace_id", input.workspaceId)
    .eq("owner_id", input.ownerId)
    .eq("status", "active")
    .gt("scheduled_join_at", preMeetingBoundary)
    .in("source_upcoming_id", upcomingIds);
  if (ownedCaptureError) throw ownedCaptureError;

  const captureById = new Map<string, any>();
  for (const capture of [...(subscribedCaptures || []), ...(ownedCaptures || [])]) {
    if (captureById.has(String(capture.id))) continue;
    if (capture.scheduled_join_at <= nowIso) {
      // A cancellation inside the five-minute lead window must remove a bot
      // already waiting to join. Never interrupt a conversation started early.
      const { data: speech, error: speechError } = await supabaseService.from("meet_utterances")
        .select("id").eq("workspace_id", input.workspaceId).eq("bot_id", capture.bot_id).limit(1);
      if (speechError) throw speechError;
      if (speech?.length) continue;
    }
    captureById.set(String(capture.id), capture);
  }
  // Only future or not-yet-started reservations are cancelled. An ongoing
  // capture is ended through the explicit Stop flow and idle protections.
  const subscriptions = (loadedSubscriptions || []).filter((row: any) =>
    captureById.has(String(row.capture_id))
  );
  if (!captureById.size) return { cancelled: 0, detached: 0 };

  const capturesToCancel: any[] = [];
  for (const capture of captureById.values()) {
    const selectedCount = (subscriptions || []).filter(
      (row: any) => String(row.capture_id) === String(capture.id)
    ).length;
    const { count, error: countError } = await supabaseService
      .from("meet_capture_subscribers")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", input.workspaceId)
      .eq("capture_id", capture.id)
      .in("status", ["scheduled", "active"]);
    if (countError) throw countError;
    if ((count || 0) <= selectedCount) capturesToCancel.push(capture);
  }

  if (capturesToCancel.length) {
    const key = process.env.RECALL_API_KEY || "";
    const region = process.env.RECALL_REGION || "";
    if (!key || !region) {
      throw new Error("The notetaker provider is not configured");
    }
    // Cancel the provider reservation before detaching the last subscriber.
    // If Recall rejects the cancellation, the calendar record remains intact
    // and the operation can be retried without losing its canonical link.
    for (const capture of capturesToCancel) {
      const providerCancelled = await cancelRecallBotRequest({
        region,
        key,
        botId: capture.bot_id,
      });
      if (!providerCancelled) {
        throw new Error(
          "The scheduled notetaker could not be cancelled safely. Try the calendar change again."
        );
      }
    }
  }

  const endedAt = new Date().toISOString();
  const subscriptionIds = (subscriptions || []).map((row: any) => row.id);
  if (subscriptionIds.length) {
    const { error: subscriberError } = await supabaseService
      .from("meet_capture_subscribers")
      .update({ status: "ended", ended_at: endedAt, updated_at: endedAt })
      .eq("workspace_id", input.workspaceId)
      .eq("owner_id", input.ownerId)
      .in("id", subscriptionIds)
      .in("status", ["scheduled", "active"]);
    if (subscriberError) throw subscriberError;
  }

  const sessionIds = Array.from(
    new Set((subscriptions || []).map((row: any) => String(row.session_id)))
  );
  if (sessionIds.length) {
    const { error: tokenError } = await supabaseService
      .from("meet_stream_tokens")
      .update({ revoked_at: endedAt, updated_at: endedAt })
      .eq("workspace_id", input.workspaceId)
      .eq("owner_id", input.ownerId)
      .in("session_id", sessionIds)
      .is("revoked_at", null);
    if (tokenError) throw tokenError;
  }

  const { error: accessError } = await supabaseService
    .from("meet_capture_access")
    .update({ revoked_at: endedAt })
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.ownerId)
    .in("capture_id", Array.from(captureById.keys()))
    .in("upcoming_id", upcomingIds)
    .is("revoked_at", null);
  if (accessError) throw accessError;

  for (const capture of capturesToCancel) {
    const { error: captureError } = await supabaseService
      .from("meet_bots")
      .update({ status: "left", ended_at: endedAt })
      .eq("workspace_id", input.workspaceId)
      .eq("id", capture.id)
      .eq("status", "active");
    if (captureError) throw captureError;
  }

  return {
    cancelled: capturesToCancel.length,
    detached: subscriptionIds.length,
  };
}
