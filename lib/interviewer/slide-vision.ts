import "server-only";

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

function pitchFrom(raw: Record<string, unknown>, number: number): SlidePitch {
  const points = Array.isArray(raw.talkingPoints) ? raw.talkingPoints : [];
  const verbatim = cleanSlideText(String(raw.verbatim || ""));
  return {
    number,
    title: cleanSlideText(String(raw.title || "")).slice(0, 160) || `Slide ${number}`,
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
      text: `These are slide images, in order: ${batch.map((image) => image.number).join(", ")}. Return JSON {"slides":[{"number":1,"title":"","oneLine":"","talkingPoints":["",""],"verbatim":null,"stats":""}]}. oneLine says when to show the slide. talkingPoints are 1 to 3 spoken points, not a script. verbatim is only a slogan, tagline or mission line, otherwise null. A customer benefit such as "lower cost" stays. Do not copy an internal supplier price, margin, or our own cost. Never invent a fact that is not on the image.`,
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
