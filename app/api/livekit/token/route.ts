import { NextRequest, NextResponse } from "next/server";
import { createLiveKitToken } from "@/lib/livekit";

export const runtime = "nodejs";

// Returns a LiveKit join token + server URL for a given room/identity/role.
export async function POST(req: NextRequest) {
  try {
    const { room, identity, role } = await req.json();

    if (!room || !identity) {
      return NextResponse.json(
        { error: "room and identity are required" },
        { status: 400 }
      );
    }

    const token = await createLiveKitToken({
      room,
      identity,
      role: role === "candidate" ? "candidate" : "interviewer",
    });

    return NextResponse.json({
      token,
      url: process.env.NEXT_PUBLIC_LIVEKIT_URL,
    });
  } catch (err: any) {
    console.error("LiveKit token error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to mint LiveKit token" },
      { status: 500 }
    );
  }
}
