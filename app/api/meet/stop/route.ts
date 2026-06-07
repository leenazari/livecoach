// FIRST LINE MARKER (route): app/api/meet/stop/route.ts  — exports POST, no JSX
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { botId } = await req.json();
    if (!botId) {
      return NextResponse.json({ error: "botId is required" }, { status: 400 });
    }

    const key = process.env.RECALL_API_KEY;
    const region = process.env.RECALL_REGION;
    if (!key || !region) {
      return NextResponse.json(
        { error: "RECALL_API_KEY / RECALL_REGION not set in Vercel env" },
        { status: 500 }
      );
    }

    const endpoint = `https://${region}.recall.ai/api/v1/bot/${botId}/leave_call/`;
    const callRecall = (authHeader: string) =>
      fetch(endpoint, {
        method: "POST",
        headers: { Authorization: authHeader, Accept: "application/json" },
      });

    let res = await callRecall(key);
    if (res.status === 401 || res.status === 403) {
      res = await callRecall(`Token ${key}`);
    }

    if (!res.ok) {
      const raw = await res.text();
      return NextResponse.json(
        { error: `leave_call failed (${res.status})`, detail: raw.slice(0, 400) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "unknown error" },
      { status: 500 }
    );
  }
}
