// FIRST LINE MARKER (route): app/api/meet/stop/route.ts  — exports POST, no JSX
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Stop a Meet bot. Accepts EITHER { botId } (direct) or { sessionId } (look up
// the active bot(s) for that session). The session path means "End session"
// can stop the bot even after the tab that started it is gone.
export async function POST(req: NextRequest) {
  try {
    const { botId, sessionId } = await req.json();

    const key = process.env.RECALL_API_KEY;
    const region = process.env.RECALL_REGION;
    if (!key || !region) {
      return NextResponse.json(
        { error: "RECALL_API_KEY / RECALL_REGION not set in Vercel env" },
        { status: 500 }
      );
    }

    // Resolve which bot ids to stop.
    let botIds: string[] = [];
    if (botId) {
      botIds = [String(botId)];
    } else if (sessionId) {
      const { data, error } = await supabaseAdmin
        .from("meet_bots")
        .select("bot_id")
        .eq("session_id", String(sessionId))
        .eq("status", "active");
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      botIds = (data || []).map((r: any) => r.bot_id);
    }

    if (botIds.length === 0) {
      // Nothing active to stop - treat as success so the UI stays clean.
      return NextResponse.json({ ok: true, stopped: 0 });
    }

    const leave = async (id: string) => {
      const endpoint = `https://${region}.recall.ai/api/v1/bot/${id}/leave_call/`;
      const call = (auth: string) =>
        fetch(endpoint, {
          method: "POST",
          headers: { Authorization: auth, Accept: "application/json" },
        });
      let res = await call(key);
      if (res.status === 401 || res.status === 403) res = await call(`Token ${key}`);
      return res.ok;
    };

    let stopped = 0;
    for (const id of botIds) {
      const ok = await leave(id);
      if (ok) {
        stopped += 1;
        try {
          await supabaseAdmin
            .from("meet_bots")
            .update({ status: "left", ended_at: new Date().toISOString() })
            .eq("bot_id", id);
        } catch (e) {
          console.error("meet_bots update failed:", e);
        }
      }
    }

    return NextResponse.json({ ok: true, stopped });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unknown error" },
      { status: 500 }
    );
  }
}
