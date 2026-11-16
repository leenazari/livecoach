import { forSpeech } from "./pronunciations";
import { guardSpokenText } from "./guardrails";
import { incompleteSlideCommand, takeSpokenSlideCommands } from "./slide-command";

const MARKER_TAIL = /[*_#`]$/;

// Removes markdown and links from text that will be spoken. Markers are deleted,
// not read aloud, including when a pair is only half present.
export function stripSpeechText(value: string): string {
  let text = String(value || "");
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/https?:\/\/\S+/gi, "");
  text = text.replace(/\bwww\.\S+/gi, "");
  text = text.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "");
  text = text.replace(/[*#`_•]/g, "");
  return speakReady(text, []);
}

function holdback(value: string): number {
  const url = value.match(/https?:\/\/\S*$/i);
  if (url?.[0]) return url[0].length;
  const tool = value.match(/show\s*slide\s*\{[^}]*$/i);
  if (tool?.[0]) return tool[0].length;
  const slide = incompleteSlideCommand(value);
  if (slide) return slide;
  if (MARKER_TAIL.test(value)) return 1;
  if (/(^|\n)[-*•]$/.test(value)) return 1;
  const word = value.match(/[A-Za-z']+$/);
  if (word) return Math.min(word[0].length, 80);
  return 0;
}

function speakReady(value: string, slides: number[]): string {
  const guarded = guardSpokenText(forSpeech(value));
  const directed = takeSpokenSlideCommands(guarded, { trim: false });
  slides.push(...directed.slides);
  return directed.text;
}

export function createSpeechStreamFilter() {
  let pending = "";
  const slides: number[] = [];
  const emit = (value: string) => speakReady(value.replace(/```[\s\S]*?```/g, " ").replace(/https?:\/\/\S+/gi, "").replace(/\bwww\.\S+/gi, "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "").replace(/[*#`_•]/g, ""), slides);
  return {
    push(chunk: string): string {
      pending += String(chunk || "");
      const hold = Math.min(pending.length, holdback(pending));
      const ready = pending.slice(0, pending.length - hold);
      pending = pending.slice(pending.length - hold);
      return emit(ready);
    },
    flush(): string {
      const rest = emit(pending);
      pending = "";
      return rest;
    },
    takeSlides(): number[] {
      return slides.splice(0, slides.length);
    },
  };
}

type StreamFilter = ReturnType<typeof createSpeechStreamFilter>;

// Rewrites one Server-Sent Event line. Content that is still an unfinished
// marker is held and the line is skipped. Tool-call fields are left as sent.
export function rewriteSpeechEvent(line: string, filter: StreamFilter): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return line;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return line;
  let payload: { choices?: Array<{ delta?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }> };
  try {
    payload = JSON.parse(data);
  } catch {
    return line;
  }
  const delta = payload.choices?.[0]?.delta;
  if (!delta || typeof delta.content !== "string") return line;
  const spoken = filter.push(delta.content);
  const slides = filter.takeSlides();
  if (!spoken && !slides.length && !delta.tool_calls) return null;
  delta.content = spoken;
  if (slides.length) {
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    delta.tool_calls = [
      ...calls,
      ...slides.map((number, index) => ({
        index: calls.length + index,
        id: `spoken_slide_${number}_${index}`,
        type: "function",
        function: { name: "show_slide", arguments: JSON.stringify({ slide_number: number, reason: "spoken slide number" }) },
      })),
    ];
  }
  return `data: ${JSON.stringify(payload)}`;
}

export function flushSpeechEvent(filter: StreamFilter): string | null {
  const spoken = filter.flush();
  const slides = filter.takeSlides();
  if (!spoken && !slides.length) return null;
  return `data: ${JSON.stringify({
    choices: [{
      index: 0,
      delta: {
        content: spoken,
        ...(slides.length ? {
          tool_calls: slides.map((number, index) => ({
            index,
            id: `spoken_slide_${number}_${index}`,
            type: "function",
            function: { name: "show_slide", arguments: JSON.stringify({ slide_number: number, reason: "spoken slide number" }) },
          })),
        } : {}),
      },
    }],
  })}`;
}
