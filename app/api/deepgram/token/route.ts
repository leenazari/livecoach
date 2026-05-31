import { NextResponse } from "next/server";
import { createClient } from "@deepgram/sdk";

export const runtime = "nodejs";

// Mints a short-lived Deepgram token so the long-lived API key never
// reaches the browser. The browser opens a WebSocket to Deepgram using
// this temporary token.
export async function GET() {
  try {
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);

    // grantToken issues a short-lived access token.
    const { result, error } = await deepgram.auth.grantToken();

    if (error || !result) {
      throw error || new Error("No token returned from Deepgram");
    }

    return NextResponse.json({
      access_token: result.access_token,
      expires_in: result.expires_in,
    });
  } catch (err: any) {
    console.error("Deepgram token error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to mint Deepgram token" },
      { status: 500 }
    );
  }
}
