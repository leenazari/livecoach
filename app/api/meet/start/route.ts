// FIRST LINE MARKER (route): app/api/meet/start/route.ts  — exports POST, no JSX
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Public Railway worker that receives Recall's transcript webhooks.
// Override in Vercel env with MEET_WORKER_URL if the domain ever changes.
const WORKER_URL =
  process.env.MEET_WORKER_URL ||
  "https://livecoach-meet-worker-production.up.railway.app";

export async function POST(req: NextRequest) {
  try {
    const { meetingUrl, sessionId } = await req.json();
    if (!meetingUrl || !sessionId) {
      return NextResponse.json(
        { error: "meetingUrl and sessionId are required" },
        { status: 400 }
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
    const body = {
      meeting_url: meetingUrl,
      bot_name: "Lee's Transcriber",
      // session_id flows through here and comes back on every webhook,
      // so the worker knows which call each utterance belongs to.
      metadata: { session_id: String(sessionId) },
      recording_config: {
        transcript: {
          provider: {
            recallai_streaming: {
              mode: "prioritize_low_latency",
              language_code: "en",
            },
          },
        },
        // Per-bot realtime webhook -> our Railway worker.
        realtime_endpoints: [
          {
            type: "webhook",
            url: `${WORKER_URL}/webhook/recall`,
            events: ["transcript.data"],
          },
        ],
      },
    };

    const callRecall = (authHeader: string) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

    // Recall docs show the auth header two ways across versions.
    // Try the raw key; if it's rejected as unauthorized, retry with "Token ".
    let res = await callRecall(key);
    if (res.status === 401 || res.status === 403) {
      res = await callRecall(`Token ${key}`);
    }

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

    // Record the bot so it can be stopped by session_id later, even if the
    // browser tab that started it is gone. Non-fatal if it fails.
    try {
      await supabaseAdmin.from("meet_bots").insert({
        session_id: String(sessionId),
        bot_id: data.id,
        status: "active",
      });
    } catch (e) {
      console.error("meet_bots insert failed:", e);
    }

    return NextResponse.json({ botId: data.id, status: "joining" });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unknown error" },
      { status: 500 }
    );
  }
}
