import { createHash } from "crypto";

type ModelTier = "live" | "pro" | "think" | "brain";

type LegacyMessage = {
  role: "user" | "assistant";
  content: string | Array<{ type?: string; text?: string }>;
};

type LegacyRequest = {
  model: string;
  max_tokens?: number;
  system?: string | Array<{ type?: string; text?: string }>;
  messages: LegacyMessage[];
  temperature?: number;
  tools?: any[];
  response_format?: any;
};

const API_URL = "https://api.openai.com/v1/responses";
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RESPONSE_ATTEMPTS = 2;

export class OpenAIResponsesError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`OpenAI Responses API failed (${status}): ${detail}`);
    this.name = "OpenAIResponsesError";
    this.status = status;
    this.detail = detail;
  }
}

export function isTransientOpenAIError(error: unknown): boolean {
  if (error instanceof OpenAIResponsesError) {
    return TRANSIENT_STATUS_CODES.has(error.status);
  }
  const name = String((error as any)?.name || "").toLowerCase();
  if (name === "aborterror") return false;
  const message = String((error as any)?.message || error || "").toLowerCase();
  return /\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|rate limit|temporar|unavailable|timeout|timed out|network|fetch failed|stream error/.test(
    message
  );
}

const pickModel = (value: string | undefined, fallback: string): string =>
  (value || "").trim() || fallback;

// Keep the app's cost/latency router: Luna handles high-frequency work, Terra
// handles synthesis, and Sol is reserved for strategic and learned-brain work.
export const OPENAI_MODEL_LIVE = pickModel(
  process.env.OPENAI_MODEL_LIVE,
  "gpt-5.6-luna"
);
export const OPENAI_MODEL_PRO = pickModel(
  process.env.OPENAI_MODEL_PRO,
  "gpt-5.6-terra"
);
export const OPENAI_MODEL_THINK = pickModel(
  process.env.OPENAI_MODEL_THINK,
  "gpt-5.6-sol"
);
export const OPENAI_MODEL_BRAIN = pickModel(
  process.env.OPENAI_MODEL_BRAIN,
  "gpt-5.6-sol"
);

function tierForModel(model: string): ModelTier {
  if (model === OPENAI_MODEL_LIVE || /luna/i.test(model)) return "live";
  if (model === OPENAI_MODEL_PRO || /terra/i.test(model)) return "pro";
  if (model === OPENAI_MODEL_BRAIN) return "brain";
  return "think";
}

function textOf(value: LegacyRequest["system"] | LegacyMessage["content"]): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter((part) => part?.type === "text" || typeof part?.text === "string")
    .map((part) => part?.text || "")
    .filter(Boolean)
    .join("\n\n");
}

function requestBody(body: LegacyRequest, stream: boolean) {
  const maxOutput = Math.max(16, Number(body.max_tokens) || 1024);
  const tier = tierForModel(body.model);
  // Short JSON/extraction/live calls should not spend their tiny output budget
  // on hidden reasoning. Longer strategic calls get measured reasoning depth.
  const effort =
    maxOutput <= 500 || tier === "live"
      ? "none"
      : tier === "pro"
      ? "low"
      : "medium";

  const usesWebSearch = Array.isArray(body.tools) && body.tools.length > 0;
  const webSearchTool = usesWebSearch
    ? body.tools?.find((tool: any) =>
        String(tool?.type || tool?.name || "").includes("web_search")
      ) || body.tools?.[0]
    : null;
  const maxToolCalls = usesWebSearch
    ? Math.max(1, Math.min(10, Number(body.tools?.[0]?.max_uses) || 3))
    : 0;
  const instructions = textOf(body.system);
  // Route repeated, stable prompt prefixes to the same cache shard. OpenAI's
  // implicit prompt cache still validates the exact prefix, so this cannot
  // return stale content; it only improves the chance of a discounted cache hit.
  const promptCacheKey = createHash("sha256")
    .update(`${body.model}\n${instructions.slice(0, 6000)}`)
    .digest("hex");
  return {
    model: body.model,
    instructions,
    input: body.messages.map((message) => ({
      role: message.role,
      content: textOf(message.content),
    })),
    max_output_tokens: maxOutput,
    reasoning: { effort },
    text: {
      verbosity: tier === "live" ? "low" : "medium",
      ...(body.response_format ? { format: body.response_format } : {}),
    },
    prompt_cache_key: promptCacheKey,
    ...(usesWebSearch
      ? {
          tools: [{
            type: "web_search",
            ...(webSearchTool?.filters?.allowed_domains?.length
              ? {
                  filters: {
                    allowed_domains: webSearchTool.filters.allowed_domains,
                  },
                }
              : {}),
            ...(webSearchTool?.search_context_size
              ? { search_context_size: webSearchTool.search_context_size }
              : {}),
          }],
          max_tool_calls: maxToolCalls,
          include: ["web_search_call.action.sources"],
        }
      : {}),
    stream,
    store: false,
  };
}

function apiKey(): string {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set in Vercel env");
  return key;
}

function normalizeUsage(usage: any) {
  const cached = Number(usage?.input_tokens_details?.cached_tokens) || 0;
  const totalInput = Number(usage?.input_tokens) || 0;
  return {
    input_tokens: Math.max(0, totalInput - cached),
    output_tokens: Number(usage?.output_tokens) || 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens:
      Number(usage?.input_tokens_details?.cache_write_tokens) ||
      Number(usage?.cache_write_tokens) ||
      0,
  };
}

function outputText(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text;
  return (Array.isArray(response?.output) ? response.output : [])
    .filter((item: any) => item?.type === "message")
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((item: any) => item?.type === "output_text")
    .map((item: any) => item?.text || "")
    .join("");
}

function legacyMessage(response: any) {
  const text = outputText(response);
  const output = Array.isArray(response?.output) ? response.output : [];
  const webSearchCalls = output.filter(
    (item: any) => item?.type === "web_search_call"
  ).length;
  const annotationSources = output
    .filter((item: any) => item?.type === "message")
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .flatMap((item: any) => (Array.isArray(item?.annotations) ? item.annotations : []))
    .filter((item: any) => item?.type === "url_citation" && item?.url)
    .map((item: any) => ({
      type: "web_search_result",
      title: item.title || item.url,
      url: item.url,
    }));
  const searchSources = output
    .filter((item: any) => item?.type === "web_search_call")
    .flatMap((item: any) => Array.isArray(item?.action?.sources) ? item.action.sources : [])
    .filter((item: any) => item?.url)
    .map((item: any) => ({
      type: "web_search_result",
      title: item.title || item.url,
      url: item.url,
    }));
  const citations = Array.from(
    new Map([...annotationSources, ...searchSources].map((item: any) => [item.url, item])).values()
  );
  return {
    content: [
      { type: "text", text },
      ...(citations.length
        ? [{ type: "web_search_tool_result", content: citations }]
        : []),
    ],
    usage: {
      ...normalizeUsage(response?.usage),
      web_search_calls: webSearchCalls,
    },
    stop_reason:
      response?.status === "incomplete" &&
      response?.incomplete_details?.reason === "max_output_tokens"
        ? "max_tokens"
        : "end_turn",
  };
}

async function post(
  body: LegacyRequest,
  stream: boolean,
  options?: { timeout?: number; signal?: AbortSignal }
) {
  const controller = new AbortController();
  const timer = options?.timeout
    ? setTimeout(() => controller.abort(), options.timeout)
    : null;
  try {
    const authorization = `Bearer ${apiKey()}`;
    const payload = JSON.stringify(requestBody(body, stream));
    let lastError: unknown;
    for (let attempt = 1; attempt <= RESPONSE_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
          },
          body: payload,
          signal: options?.signal || controller.signal,
        });
        if (response.ok) return response;
        const detail = (await response.text()).slice(0, 1200);
        lastError = new OpenAIResponsesError(response.status, detail);
      } catch (error) {
        lastError = error;
      }
      if (
        attempt >= RESPONSE_ATTEMPTS ||
        !isTransientOpenAIError(lastError)
      ) {
        throw lastError;
      }
      await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
    }
    throw lastError;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class OpenAIResponseStream implements AsyncIterable<any> {
  private finalPromise: Promise<any>;
  private resolveFinal!: (value: any) => void;
  private rejectFinal!: (reason: any) => void;
  private responsePromise: Promise<Response>;

  constructor(responsePromise: Promise<Response>) {
    this.responsePromise = responsePromise;
    this.finalPromise = new Promise((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
  }

  async *[Symbol.asyncIterator]() {
    try {
      const response = await this.responsePromise;
      if (!response.body) throw new Error("OpenAI stream returned no body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResponse: any = null;

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const rawEvent of events) {
          const line = rawEvent
            .split("\n")
            .find((part) => part.startsWith("data:"));
          if (!line) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const event = JSON.parse(data);
          if (event.type === "response.output_text.delta" && event.delta) {
            yield {
              type: "content_block_delta",
              delta: { type: "text_delta", text: event.delta },
            };
          }
          if (event.type === "response.completed") finalResponse = event.response;
          if (event.type === "response.incomplete") finalResponse = event.response;
          if (event.type === "error") {
            throw new OpenAIResponsesError(
              Number(event?.status) || 503,
              String(event?.message || "OpenAI stream error").slice(0, 1200)
            );
          }
        }
        if (done) break;
      }
      if (!finalResponse) throw new Error("OpenAI stream ended without a final response");
      this.resolveFinal(legacyMessage(finalResponse));
    } catch (error) {
      this.rejectFinal(error);
      throw error;
    }
  }

  finalMessage() {
    return this.finalPromise;
  }
}

export const openai = {
  messages: {
    async create(
      body: LegacyRequest,
      options?: { timeout?: number; signal?: AbortSignal }
    ) {
      const response = await post(body, false, options);
      return legacyMessage(await response.json());
    },
    stream(
      body: LegacyRequest,
      options?: { timeout?: number; signal?: AbortSignal }
    ) {
      return new OpenAIResponseStream(post(body, true, options));
    },
  },
};
