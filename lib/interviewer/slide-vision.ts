import "server-only";

import { clipHeadline, headlineFromNotes, isGenericSlideTitle } from "@/lib/interviewer/slide-headline";
import { cleanSlideText } from "@/lib/interviewer/slide-notes";

export type SlidePitch = {
  number: number;
  title: string;
  oneLine: string;
  talkingPoints: string[];
  verbatim: string | null;
  stats: string;
};

type ImageSlide = { number: number; bytes: Uint8Array; mime: string };

function customerTitle(title: string, points: string[], oneLine: string, verbatim: string): string {
  const clipped = clipHeadline(title);
  if (clipped && !isGenericSlideTitle(clipped)) return clipped;
  return headlineFromNotes({ talkingPoints: points.join("\n"), oneLine, verbatim });
}

function pitchFrom(raw: Record<string, unknown>, number: number): SlidePitch {
  const points = Array.isArray(raw.talkingPoints) ? raw.talkingPoints : [];
  const verbatim = cleanSlideText(String(raw.verbatim || ""));
  return {
    number,
    title: customerTitle(String(raw.title || ""), points.map((point) => cleanSlideText(String(point))).filter(Boolean), cleanSlideText(String(raw.oneLine || "")), verbatim),
    oneLine: cleanSlideText(String(raw.oneLine || "")).slice(0, 220),
    talkingPoints: points.map((point) => cleanSlideText(String(point))).filter(Boolean).slice(0, 3),
    verbatim: verbatim ? verbatim.slice(0, 220) : null,
    stats: cleanSlideText(String(raw.stats || "")).slice(0, 400),
  };
}

export async function notesFromImages(images: ImageSlide[]): Promise<{ slides: SlidePitch[]; inputTokens: number; outputTokens: number }> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("not_configured");
  let inputTokens = 0;
  let outputTokens = 0;
  const slides: SlidePitch[] = [];
  for (let start = 0; start < images.length; start += 4) {
    const batch = images.slice(start, start + 4);
    const content: Array<Record<string, unknown>> = [{
      type: "text",
      text: `These are slide images, in order: ${batch.map((image) => image.number).join(", ")}. Return JSON {"slides":[{"number":1,"title":"","oneLine":"","talkingPoints":["",""],"verbatim":null,"stats":""}]}. title is a customer headline of at most 60 characters, never "Slide 1" or a file name. oneLine says when to show the slide. talkingPoints are 1 to 3 spoken points, not a script. verbatim is only a slogan, tagline or mission line, otherwise null. A customer benefit such as "lower cost" stays. Do not copy an internal supplier price, margin, or a supplier name. Never invent a fact that is not on the image.`,
    }];
    for (const image of batch) {
      content.push({ type: "text", text: `Slide ${image.number}` });
      content.push({
        type: "image_url",
        image_url: { url: `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}` },
      });
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error("draft_failed");
    const payload = await response.json();
    inputTokens += Number(payload?.usage?.prompt_tokens || 0);
    outputTokens += Number(payload?.usage?.completion_tokens || 0);
    const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}") as { slides?: Array<Record<string, unknown>> };
    const byNumber = new Map((parsed.slides || []).map((slide) => [Number(slide.number), slide]));
    for (const image of batch) slides.push(pitchFrom(byNumber.get(image.number) || {}, image.number));
  }
  return { slides, inputTokens, outputTokens };
}

export async function headlinesFromContent(slides: Array<{ number: number; text: string }>): Promise<Map<number, string>> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  const headlines = new Map<number, string>();
  if (!key || !slides.length) return headlines;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: `Write a customer headline for each slide, at most 60 characters. No supplier names, no internal costs. A customer benefit such as "lower cost" may stay. Never answer with "Slide 1" or a file name. Return JSON {"slides":[{"number":1,"title":""}]}.\n${slides.map((slide) => `SLIDE ${slide.number}\n${slide.text}`).join("\n\n")}`,
      }],
    }),
    signal: AbortSignal.timeout(40000),
  });
  if (!response.ok) return headlines;
  const payload = await response.json();
  const parsed = JSON.parse(payload?.choices?.[0]?.message?.content || "{}") as { slides?: Array<{ number?: number; title?: string }> };
  for (const slide of parsed.slides || []) {
    const title = clipHeadline(String(slide.title || ""));
    if (title && !isGenericSlideTitle(title)) headlines.set(Number(slide.number), title);
  }
  return headlines;
}
