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
  return text;
}

function holdback(value: string): number {
  const url = value.match(/https?:\/\/\S*$/i);
  if (url?.[0]) return url[0].length;
  if (MARKER_TAIL.test(value)) return 1;
  if (/(^|\n)[-*•]$/.test(value)) return 1;
  return 0;
}

export function createSpeechStreamFilter() {
  let pending = "";
  return {
    push(chunk: string): string {
      pending += String(chunk || "");
      const hold = Math.min(pending.length, holdback(pending));
      const ready = pending.slice(0, pending.length - hold);
      pending = pending.slice(pending.length - hold);
      return stripSpeechText(ready);
    },
    flush(): string {
      const rest = stripSpeechText(pending);
      pending = "";
      return rest;
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
  if (!spoken && !delta.tool_calls) return null;
  delta.content = spoken;
  return `data: ${JSON.stringify(payload)}`;
}

export function flushSpeechEvent(filter: StreamFilter): string | null {
  const spoken = filter.flush();
  if (!spoken) return null;
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: spoken } }] })}`;
}
