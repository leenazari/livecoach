import { createSpeechStreamFilter, flushSpeechEvent, rewriteSpeechEvent, stripSpeechText } from "@/lib/interviewer/speech-stream";
import { thinkRequestAllowed } from "@/lib/interviewer/think-endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gpt-4o-mini";

function spokenMessage(value: unknown): unknown {
  if (typeof value === "string") {
    const filter = createSpeechStreamFilter();
    return `${filter.push(value)}${filter.flush()}`;
  }
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return { ...part, text: spokenMessage((part as { text: string }).text) };
      }
      return part;
    });
  }
  return value;
}

export async function POST(request: Request) {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    return Response.json({ error: "OPENAI_API_KEY is not set" }, { status: 503 });
  }
  const url = new URL(request.url);
  if (!thinkRequestAllowed(url.searchParams.get("exp"), url.searchParams.get("sig"), key)) {
    return Response.json({ error: "think endpoint refused" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "think request was empty" }, { status: 400 });
  }
  const stream = (body as { stream?: boolean }).stream !== false;
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(body as Record<string, unknown>),
      model: MODEL,
      stream,
    }),
  });
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(detail || "The speech model did not answer.", { status: upstream.status || 502 });
  }
  if (!stream) {
    const payload = await upstream.json().catch(() => null);
    const message = payload?.choices?.[0]?.message;
    if (message) message.content = spokenMessage(message.content);
    return Response.json(payload);
  }
  const filter = createSpeechStreamFilter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const output = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let pending = "";
      const write = (line: string) => {
        const rewritten = rewriteSpeechEvent(line, filter);
        if (rewritten == null) return;
        if (rewritten.trim() === "data: [DONE]") {
          const tail = flushSpeechEvent(filter);
          if (tail) controller.enqueue(encoder.encode(`${tail}\n\n`));
        }
        controller.enqueue(encoder.encode(`${rewritten}\n`));
      };
      try {
        while (true) {
          const step = await reader.read();
          if (step.done) break;
          pending += decoder.decode(step.value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop() || "";
          for (const line of lines) write(line);
        }
        if (pending) write(pending);
        const tail = flushSpeechEvent(filter);
        if (tail) controller.enqueue(encoder.encode(`${tail}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(output, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
