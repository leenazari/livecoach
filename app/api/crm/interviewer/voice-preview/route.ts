import { NextResponse } from "next/server";

import { requireInterviewerOwner, interviewerOwnerError } from "@/lib/interviewer/access";
import { loadCostRates, recordCostEvent, ttsPreviewUsd } from "@/lib/interviewer/cost-store";
import { INTERVIEWER_VOICES, isInterviewerVoiceId } from "@/lib/interviewer/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cache = new Map<string, Uint8Array>();
const MAX_CACHE = 80;

function sampleLine(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 80) || "the team";
  return `Hi, it's the team at ${clean}, have you got a couple of minutes?`;
}

export async function GET(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const url = new URL(req.url);
    const voiceId = url.searchParams.get("voiceId") || "";
    if (!isInterviewerVoiceId(voiceId)) {
      return NextResponse.json(
        { error: "Choose a voice from the Deepgram list." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const text = sampleLine(url.searchParams.get("name") || "");
    const key = `${voiceId}:${text}`;
    let audio = cache.get(key);
    if (!audio) {
      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: "Voice preview is not configured." },
          { status: 503, headers: { "Cache-Control": "private, no-store" } }
        );
      }
      const response = await fetch(
        `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voiceId)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
          cache: "no-store",
        }
      );
      if (!response.ok) {
        console.error("interviewer voice preview failed", { status: response.status, voiceId });
        return NextResponse.json(
          { error: "That voice sample could not be played." },
          { status: 502, headers: { "Cache-Control": "private, no-store" } }
        );
      }
      audio = new Uint8Array(await response.arrayBuffer());
      if (cache.size >= MAX_CACHE) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, audio);
      const rates = await loadCostRates();
      const campaignId = url.searchParams.get("campaignId");
      if (rates) {
        await recordCostEvent({
          workspaceId: scope.workspaceId,
          campaignId: campaignId && /^[0-9a-f-]{36}$/i.test(campaignId) ? campaignId : null,
          kind: "tts_preview",
          usd: ttsPreviewUsd(rates, text.length),
          detail: { characters: text.length, voiceId },
        });
      }
    }
    return new NextResponse(Buffer.from(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=86400",
        "X-Interviewer-Voice": INTERVIEWER_VOICES.find((voice) => voice.id === voiceId)?.name || voiceId,
      },
    });
  } catch (error) {
    return interviewerOwnerError(error);
  }
}
