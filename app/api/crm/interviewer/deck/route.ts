import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import { requireInterviewerOwner, interviewerOwnerError } from "@/lib/interviewer/access";
import { llmUsd, loadCostRates, recordCostEvent } from "@/lib/interviewer/cost-store";
import { interviewerFieldError } from "@/lib/interviewer/field-error";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SENSITIVE = /\b(costs?|margins?|tavus|deepgram|elevenlabs|openai|cartesia)\b/i;

function hits(text: string): string[] {
  const found = new Set<string>();
  for (const word of ["cost", "costs", "margin", "margins", "tavus", "deepgram", "elevenlabs", "openai", "cartesia"]) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) found.add(word.toLowerCase());
  }
  return [...found];
}

function clean(text: string): string {
  return text.split("\n").filter((line) => !SENSITIVE.test(line)).join("\n").trim().slice(0, 1500);
}

function slideSvg(number: number, title: string, body: string): string {
  const lines = body.replace(/\s+/g, " ").trim().slice(0, 500).match(/.{1,70}/g) || [];
  const text = lines.slice(0, 8).map((line, index) =>
    `<text x="48" y="${120 + index * 36}" font-size="22" fill="#1b1a17">${escapeXml(line)}</text>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#f7f4ed"/>
  <text x="48" y="72" font-size="22" fill="#976408">Slide ${number}</text>
  <text x="48" y="112" font-size="40" fill="#1b1a17">${escapeXml(title.slice(0, 80) || "Untitled")}</text>
  ${text}
</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Pitch = {
  title: string;
  oneLine: string;
  talkingPoints: string[];
  verbatim: string | null;
  stats: string;
};

async function pitchSlides(pages: string[]): Promise<{ slides: Pitch[]; outline: string; inputTokens: number; outputTokens: number }> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("not_configured");
  const packed = pages.map((page, index) => `SLIDE ${index + 1}\n${page.slice(0, 2500)}`).join("\n\n").slice(0, 24000);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Build a conversational pitch from slide text. Not a script. Return JSON {"outline":"","slides":[{"title":"","oneLine":"","talkingPoints":["",""],"verbatim":null,"stats":""}]}.
Each slide has 1 to 3 talking points in plain spoken British English. The speaker will paraphrase them and ask questions. Put words in verbatim ONLY for a slogan, tagline or mission statement. Otherwise verbatim is null.
Never invent facts. Omit a point that is not on the slide. No markdown. Each talking point under 180 characters.`,
        },
        { role: "user", content: packed },
      ],
    }),
    signal: AbortSignal.timeout(40000),
  });
  if (!response.ok) throw new Error("draft_failed");
  const payload = await response.json();
  const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}") as {
    outline?: string;
    slides?: Array<{ title?: string; oneLine?: string; talkingPoints?: string[]; verbatim?: string | null; stats?: string }>;
  };
  const slides = (parsed.slides || []).map((slide) => ({
    title: clean(String(slide.title || "")).slice(0, 160),
    oneLine: clean(String(slide.oneLine || "")).slice(0, 220),
    talkingPoints: (slide.talkingPoints || []).map((point) => clean(String(point))).filter(Boolean).slice(0, 3),
    verbatim: slide.verbatim ? clean(String(slide.verbatim)).slice(0, 220) || null : null,
    stats: clean(String(slide.stats || "")).slice(0, 400),
  }));
  return {
    slides,
    outline: clean(String(parsed.outline || "")).slice(0, 2000),
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

export async function POST(req: Request) {
  try {
    const scope = await requireInterviewerOwner();
    const form = await req.formData();
    const campaignId = String(form.get("campaignId") || "");
    const file = form.get("file");
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
      return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", { campaignId: "Pick a campaign." });
    }
    if (!(file instanceof File)) {
      return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", { file: "Choose a PDF." });
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".ppt") || lower.endsWith(".pptx")) {
      return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", {
        file: "PowerPoint is not converted here. Export the deck as a PDF, then upload that.",
      });
    }
    if (!lower.endsWith(".pdf") && file.type !== "application/pdf") {
      return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", { file: "Upload a PDF." });
    }
    if (file.size > 15_000_000) {
      return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", { file: "The PDF is over 15 MB." });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);
    const extracted = await extractText(pdf, { mergePages: false });
    const pages = (Array.isArray(extracted.text) ? extracted.text : [extracted.text]).slice(0, 24);
    const raw = pages.join("\n");
    const warnings = hits(raw);
    const pitch = await pitchSlides(pages.map((page) => page || ""));
    const deckId = crypto.randomUUID();
    const slideRows = [];
    for (let index = 0; index < pages.length; index += 1) {
      const number = index + 1;
      const pitchSlide = pitch.slides[index] || { title: `Slide ${number}`, oneLine: "", talkingPoints: [], verbatim: null, stats: "" };
      const path = `${scope.workspaceId}/${campaignId}/${deckId}/${number}.svg`;
      const svg = slideSvg(number, pitchSlide.title || `Slide ${number}`, pages[index] || "");
      const uploaded = await supabaseService.storage.from("interviewer-slides").upload(path, svg, {
        contentType: "image/svg+xml",
        upsert: true,
      });
      if (uploaded.error) throw uploaded.error;
      slideRows.push({
        workspace_id: scope.workspaceId,
        campaign_id: campaignId,
        deck_id: deckId,
        slide_number: number,
        image_path: path,
        image_mime: "image/svg+xml",
        title: pitchSlide.title || `Slide ${number}`,
        one_line: pitchSlide.oneLine,
        talking_points: pitchSlide.talkingPoints.join("\n"),
        verbatim: pitchSlide.verbatim,
        stats: pitchSlide.stats,
      });
    }
    const { error: deckError } = await supabaseService.from("interviewer_decks").insert({
      id: deckId,
      workspace_id: scope.workspaceId,
      campaign_id: campaignId,
      title: file.name.replace(/\.pdf$/i, "").slice(0, 160),
      outline: pitch.outline,
      warnings,
    });
    if (deckError) throw deckError;
    const { error: slideError } = await supabaseService.from("interviewer_slides").insert(slideRows);
    if (slideError) throw slideError;
    const rates = await loadCostRates();
    if (rates) {
      await recordCostEvent({
        workspaceId: scope.workspaceId,
        campaignId,
        kind: "deck_vision",
        usd: llmUsd(rates, pitch.inputTokens, pitch.outputTokens),
        detail: { slides: pages.length, inputTokens: pitch.inputTokens, outputTokens: pitch.outputTokens },
      });
    }
    return Response.json({
      deckId,
      slides: slideRows.length,
      warnings,
      outline: pitch.outline,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "not_configured") {
      return interviewerFieldError("interviewer_deck_blocked", "Deck was not saved", { file: "The writing service is not configured." });
    }
    return interviewerOwnerError(error);
  }
}
