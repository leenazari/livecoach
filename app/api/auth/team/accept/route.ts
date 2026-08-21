import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getVerifiedUser } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const user = getVerifiedUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in from the invitation email first" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (token.length < 32 || token.length > 200) {
      return NextResponse.json(
        { error: "The invitation link is invalid" },
        { status: 400 }
      );
    }
    if (!displayName || displayName.length > 120) {
      return NextResponse.json(
        { error: "Enter the name that should appear in LiveCoach" },
        { status: 400 }
      );
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { data, error } = await supabaseService.rpc(
      "accept_livecoach_invitation",
      {
        invitation_token_hash: tokenHash,
        invited_user_id: user.userId,
        requested_display_name: displayName,
      }
    );
    if (error) throw error;
    const membership = Array.isArray(data) ? data[0] : data;
    if (!membership) throw new Error("Invitation acceptance was not confirmed");

    return NextResponse.json(
      { ok: true, membership },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not accept the invitation" },
      { status: 400 }
    );
  }
}
