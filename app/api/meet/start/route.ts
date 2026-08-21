// FIRST LINE MARKER (route): app/api/meet/start/route.ts  — exports POST, no JSX
import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { privateRecordFields, resolveRecordScope } from "@/lib/record-scope";
import { supabaseAdmin } from "@/lib/supabase";
import {
  getTranscriberIdentity,
  validMeetingUrl,
  validMeetSessionId,
} from "@/lib/transcriber";

// Public Railway worker that receives Recall's transcript webhooks.
// Override in Vercel env with MEET_WORKER_URL if the domain ever changes.
const WORKER_URL =
  (process.env.MEET_WORKER_URL ||
    "https://livecoach-meet-worker-production.up.railway.app").replace(
    /\/+$/,
    ""
  );

async function recallRequest(
  endpoint: string,
  key: string,
  init: Omit<RequestInit, "headers"> = {}
) {
  const call = (authorization: string) =>
    fetch(endpoint, {
      ...init,
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  let response = await call(key);
  if (response.status === 401 || response.status === 403) {
    response = await call(`Token ${key}`);
  }
  return response;
}

async function leaveUntrackedBot(
  region: string,
  key: string,
  botId: string
) {
  try {
    await recallRequest(
      `https://${region}.recall.ai/api/v1/bot/${encodeURIComponent(
        botId
      )}/leave_call/`,
      key,
      { method: "POST" }
    );
  } catch (error) {
    console.error("Failed to remove untracked Recall bot", error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const accountScope = await resolveRecordScope();
    const { meetingUrl, sessionId } = await req.json();
    if (!validMeetingUrl(meetingUrl) || !validMeetSessionId(sessionId)) {
      return NextResponse.json(
        { error: "A supported meeting link and LiveCoach session are required" },
        { status: 400 }
      );
    }

    const identity = await getTranscriberIdentity(accountScope.userId);
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("meet_bots")
      .select("bot_id,bot_name")
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("session_id", sessionId)
      .eq("status", "active")
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.bot_id) {
      return NextResponse.json(
        {
          botId: existing.bot_id,
          botName: existing.bot_name || identity.botName,
          status: "already_active",
        },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const key = process.env.RECALL_API_KEY;
    const region = process.env.RECALL_REGION; // e.g. us-west-2, eu-central-1
    if (!key) {
      return NextResponse.json(
        { error: "RECALL_API_KEY is not set in Vercel env" },
        { status: 500 }
      );
    }
    if (!region) {
      return NextResponse.json(
        { error: "RECALL_REGION is not set in Vercel env (e.g. us-west-2)" },
        { status: 500 }
      );
    }

    const endpoint = `https://${region}.recall.ai/api/v1/bot/`;
    const webhookToken = randomBytes(32).toString("base64url");
    const webhookTokenHash = createHash("sha256")
      .update(webhookToken)
      .digest("hex");
    const webhookTokenExpiresAt = new Date(
      Date.now() + 4 * 60 * 60 * 1000
    );
    const realtimeEndpoint = new URL(`${WORKER_URL}/webhook/recall`);
    realtimeEndpoint.searchParams.set("token", webhookToken);
    const body = {
      meeting_url: meetingUrl,
      bot_name: identity.botName,
      // Provider-side protection against abandoned bots. This runs inside
      // Recall, so it still works if the LiveCoach tab is closed, asleep or
      // offline. `everyone_left_timeout` handles the normal case. The two bot
      // heuristics cover calls where another notetaker remains behind, and the
      // conservative silence timer is the final fallback. A three-hour hard
      // ceiling prevents an exceptional provider/platform state running on
      // indefinitely without cutting off ordinary calls or workshops.
      automatic_leave: {
        everyone_left_timeout: {
          timeout: 30,
          activate_after: 60,
        },
        bot_detection: {
          using_participant_names: {
            matches: [
              "notetaker",
              "note taker",
              "transcriber",
              "meeting recorder",
              "meeting assistant",
              "ai assistant",
              "copilot",
              "grain",
              "fellow",
              "tl;dv",
              "read.ai",
              "fathom",
              "otter",
              "fireflies",
              "avoma",
            ],
            activate_after: 300,
            timeout: 30,
          },
          // Recall notes that Google Meet participant events can be noisy, so
          // this fallback deliberately waits longer than name matching.
          using_participant_events: {
            activate_after: 600,
            timeout: 180,
          },
        },
        silence_detection: {
          activate_after: 1200,
          timeout: 600,
        },
        waiting_room_timeout: 300,
        noone_joined_timeout: 300,
        in_call_not_recording_timeout: 300,
        in_call_recording_timeout: 10800,
        recording_permission_denied_timeout: 30,
      },
      // Recall returns this signed metadata on every webhook. The worker still
      // checks it against the canonical meet_bots row before relaying anything.
      metadata: {
        session_id: sessionId,
        owner_id: accountScope.userId,
        workspace_id: accountScope.workspaceId,
      },
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              mode: "prioritize_low_latency",
              language_code: identity.languageCode,
            },
          },
        },
        // Per-bot realtime webhook -> our Railway worker.
        realtime_endpoints: [
          {
            type: "webhook",
            url: realtimeEndpoint.toString(),
            events: ["transcript.data"],
          },
        ],
      },
    };

    const res = await recallRequest(endpoint, key, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Recall create-bot failed (${res.status})`,
          detail: raw.slice(0, 600),
        },
        { status: 502 }
      );
    }

    const data = JSON.parse(raw);
    if (!data?.id || typeof data.id !== "string") {
      throw new Error("Recall returned a bot without an identifier");
    }

    // A bot without a scoped database record cannot be stopped safely and its
    // transcript cannot be assigned safely. Remove it immediately on failure.
    const { error: botInsertError } = await supabaseAdmin
      .from("meet_bots")
      .insert({
        session_id: String(sessionId),
        bot_id: data.id,
        bot_name: identity.botName,
        provider: "recall",
        webhook_token_hash: webhookTokenHash,
        webhook_token_expires_at: webhookTokenExpiresAt.toISOString(),
        status: "active",
        ...privateRecordFields(accountScope),
      });
    if (botInsertError) {
      await leaveUntrackedBot(region, key, data.id);
      throw botInsertError;
    }

    return NextResponse.json(
      {
        botId: data.id,
        botName: identity.botName,
        status: "joining",
        autoStop: {
          everyoneLeftSeconds: 30,
          silentFallbackMinutes: 10,
          hardLimitHours: 3,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unknown error" },
      { status: 500 }
    );
  }
}
