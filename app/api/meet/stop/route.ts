// FIRST LINE MARKER (route): app/api/meet/stop/route.ts  — exports POST, no JSX
import { NextRequest, NextResponse } from "next/server";
import { resolveRecordScope } from "@/lib/record-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { validMeetSessionId } from "@/lib/transcriber";

// Stop a Meet bot. Accepts EITHER { botId } (direct) or { sessionId } (look up
// the active bot(s) for that session). The session path means "End session"
// can stop the bot even after the tab that started it is gone.
export async function POST(req: NextRequest) {
  try {
    const accountScope = await resolveRecordScope();
    const { botId, sessionId } = await req.json();

    const requestedBotId =
      typeof botId === "string" && botId.length <= 200 ? botId : null;
    const requestedSessionId = validMeetSessionId(sessionId) ? sessionId : null;
    if (!requestedBotId && !requestedSessionId) {
      return NextResponse.json(
        { error: "An owned bot or LiveCoach session is required" },
        { status: 400 }
      );
    }

    const key = process.env.RECALL_API_KEY;
    const region = process.env.RECALL_REGION;
    if (!key || !region) {
      return NextResponse.json(
        { error: "RECALL_API_KEY / RECALL_REGION not set in Vercel env" },
        { status: 500 }
      );
    }

    // Never call Recall with a browser-supplied bot id directly. First resolve
    // it through the signed-in person's private meet_bots rows.
    let ownedBotsQuery = supabaseAdmin
      .from("meet_bots")
      .select("bot_id,session_id")
      .eq("workspace_id", accountScope.workspaceId)
      .eq("owner_id", accountScope.userId)
      .eq("status", "active");
    ownedBotsQuery = requestedBotId
      ? ownedBotsQuery.eq("bot_id", requestedBotId)
      : ownedBotsQuery.eq("session_id", requestedSessionId as string);
    const { data: ownedBots, error: ownedBotsError } = await ownedBotsQuery;
    if (ownedBotsError) {
      return NextResponse.json(
        { error: ownedBotsError.message },
        { status: 500 }
      );
    }
    const botIds = (ownedBots || []).map((row: any) => String(row.bot_id));

    if (botIds.length === 0) {
      // Nothing active to stop - treat as success so the UI stays clean.
      return NextResponse.json({ ok: true, stopped: 0 });
    }

    const leave = async (id: string) => {
      const endpoint = `https://${region}.recall.ai/api/v1/bot/${encodeURIComponent(
        id
      )}/leave_call/`;
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
            .eq("workspace_id", accountScope.workspaceId)
            .eq("owner_id", accountScope.userId)
            .eq("bot_id", id);
        } catch (e) {
          console.error("meet_bots update failed:", e);
        }
      }
    }

    return NextResponse.json(
      { ok: true, stopped },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unknown error" },
      { status: 500 }
    );
  }
}
