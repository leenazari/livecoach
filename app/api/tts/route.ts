import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/tts { text } -> ElevenLabs speech as audio/mpeg.
// Voice + model + key come from env (nothing hardcoded but a sensible default
// voice). Returns 400 when not configured so the client falls back cleanly to
// the browser's built-in voice. ElevenLabs usage is billed on Lee's ElevenLabs
// account, separate from the app's AI budget.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "tSFrmifcoKA2lXImR5MW";
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";

export async function POST(req: NextRequest) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: "tts not configured" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const { text } = await req.json();
    const t = typeof text === "string" ? text.trim().slice(0, 2500) : "";
    if (!t) {
      return new Response(JSON.stringify({ error: "no text" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Try the configured model first, then fall back to widely-available models,
    // so an account that doesn't include flash still gets the ElevenLabs voice
    // instead of silently dropping to the browser voice.
    const models = [MODEL_ID, "eleven_multilingual_v2", "eleven_turbo_v2_5"].filter(
      (m, i, a) => a.indexOf(m) === i
    );
    let buf: ArrayBuffer | null = null;
    let usedModel = "";
    let lastStatus = 0;
    let lastDetail = "";
    for (const model of models) {
      const r = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: t,
            model_id: model,
            voice_settings: { stability: 0.5, similarity_boost: 0.8 },
          }),
        }
      );
      if (r.ok) {
        buf = await r.arrayBuffer();
        usedModel = model;
        break;
      }
      lastStatus = r.status;
      lastDetail = (await r.text().catch(() => "")).slice(0, 200);
      // A bad key or unauthorized voice won't be fixed by another model.
      if (r.status === 401) break;
    }
    if (!buf) {
      return new Response(
        JSON.stringify({ error: `tts failed (${lastStatus})`, detail: lastDetail }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(buf, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "x-tts-model": usedModel,
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "tts error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
