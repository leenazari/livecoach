import { NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  _req: Request,
  { params }: { params: { token: string } }
) {
  if (!UUID.test(params.token)) return new NextResponse(null, { status: 204 });
  const { data: message } = await supabaseService
    .from("outreach_messages")
    .select("id,workspace_id,sender_user_id,campaign_id,prospect_id")
    .eq("voice_public_token", params.token)
    .eq("voice_status", "ready")
    .maybeSingle();
  if (!message) return new NextResponse(null, { status: 204 });
  const { error } = await supabaseService.from("outreach_events").insert({
    workspace_id: message.workspace_id,
    owner_id: message.sender_user_id,
    visibility: "team",
    campaign_id: message.campaign_id,
    prospect_id: message.prospect_id,
    message_id: message.id,
    kind: "voice_played",
    metadata: { firstConfirmedPlayAt: new Date().toISOString() },
  });
  if (error && error.code !== "23505") {
    console.error("voice note play receipt failed", error.message);
  }
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "private, no-store" },
  });
}
