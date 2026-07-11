import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mints a short-lived Deepgram access token (JWT) from the server-only API key
// via Deepgram's /auth/grant endpoint. The browser calls this and connects to
// Deepgram with the temporary token, so the real key never ships to the client.
//
// IMPORTANT: DEEPGRAM_API_KEY must be a **Member (or higher) permission** key —
// the /auth/grant endpoint rejects usage-only keys with a 403. Set it in
// Vercel > Project > Settings > Environment Variables (NOT prefixed with
// NEXT_PUBLIC_, so it stays server-side only).
export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server misconfigured: DEEPGRAM_API_KEY is not set" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      // 60s is ample: the token only needs to be valid at socket-open time.
      // Once the WebSocket handshake completes, the live connection persists
      // even after the token expires.
      body: JSON.stringify({ ttl_seconds: 60 }),
      cache: "no-store",
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: "Deepgram token grant failed", detail },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      access_token: data.access_token,
      expires_in: data.expires_in,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Deepgram token request error", detail: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
