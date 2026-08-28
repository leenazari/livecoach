import { NextResponse } from "next/server";
import { OUTREACH_VOICE_BUCKET } from "@/lib/outreach-voice-note";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
) {
  if (!UUID.test(params.token))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: message } = await supabaseService
    .from("outreach_messages")
    .select("voice_audio_path")
    .eq("voice_public_token", params.token)
    .eq("voice_status", "ready")
    .maybeSingle();
  if (!message?.voice_audio_path)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await supabaseService.storage
    .from(OUTREACH_VOICE_BUCKET)
    .createSignedUrl(message.voice_audio_path, 60 * 60);
  if (error || !data?.signedUrl)
    return NextResponse.json({ error: "Audio unavailable" }, { status: 404 });
  const response = NextResponse.redirect(data.signedUrl, 307);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
