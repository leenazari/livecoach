import assert from "node:assert/strict";
import { usageCostUSD } from "../lib/costs.ts";

// Exercise the public adapter with intercepted HTTP, never customer data or a
// real API key. Isolated module imports also verify deployed env precedence.
const originalFetch = globalThis.fetch;
const keys = ["OPENAI_API_KEY", "OPENAI_MODEL_LIVE", "OPENAI_MODEL_PRO", "OPENAI_MODEL_THINK", "OPENAI_MODEL_BRAIN"];
const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const requests = [];
const completion = {
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }],
  usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 20 },
};

try {
  for (const key of keys) delete process.env[key];
  process.env.OPENAI_API_KEY = "test-only";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body);
    requests.push(body);
    assert.equal(body.store, false);
    assert.equal(body.temperature, undefined);
    assert.equal(body.top_p, undefined);
    if (body.stream) {
      const events = [
        { type: "response.output_text.delta", delta: '{"ok":true}' },
        { type: "response.completed", response: completion },
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
      return new Response(events, { headers: { "Content-Type": "text/event-stream" } });
    }
    return Response.json(completion);
  };

  const defaults = await import(`../lib/openai.ts?defaults=${Date.now()}`);
  assert.equal(defaults.OPENAI_MODEL_LIVE, "gpt-5.6-luna");
  assert.equal(defaults.OPENAI_MODEL_PRO, "gpt-5.6-terra");
  assert.equal(defaults.OPENAI_MODEL_THINK, "gpt-6.1-sol");
  assert.equal(defaults.OPENAI_MODEL_BRAIN, "gpt-6.1-sol");

  for (const [model, maxTokens, expectedEffort] of [
    [defaults.OPENAI_MODEL_THINK, 350, "low"],
    [defaults.OPENAI_MODEL_BRAIN, 500, "low"],
    [defaults.OPENAI_MODEL_THINK, 850, "medium"],
    [defaults.OPENAI_MODEL_BRAIN, 2200, "medium"],
    [defaults.OPENAI_MODEL_LIVE, 120, "none"],
    [defaults.OPENAI_MODEL_LIVE, 700, "none"],
    [defaults.OPENAI_MODEL_PRO, 400, "none"],
    [defaults.OPENAI_MODEL_PRO, 1800, "low"],
  ]) {
    const result = await defaults.openai.messages.create({
      model, max_tokens: maxTokens, system: "Return the requested result.",
      messages: [{ role: "user", content: "Test input" }],
      temperature: 0.2,
    });
    assert.equal(requests.at(-1).reasoning.effort, expectedEffort);
    assert.equal(requests.at(-1).model, model);
    assert.equal(requests.at(-1).max_output_tokens, maxTokens);
    assert.equal(result.content[0].text, '{"ok":true}');
    assert.equal(result.usage.input_tokens, 60);
    assert.equal(result.usage.cache_read_input_tokens, 40);
  }

  const format = { type: "json_schema", name: "result", strict: true, schema: {
    type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false,
  } };
  const stream = defaults.openai.messages.stream({
    model: defaults.OPENAI_MODEL_BRAIN, max_tokens: 350,
    system: [{ type: "text", text: "Research only official sources." }],
    messages: [{ role: "user", content: [{ type: "text", text: "Test research" }] }],
    tools: [{ type: "web_search", max_uses: 2, filters: { allowed_domains: ["example.com"] } }],
    response_format: format,
  });
  let text = "";
  for await (const event of stream) text += event.delta.text;
  assert.equal(text, '{"ok":true}');
  assert.equal((await stream.finalMessage()).stop_reason, "end_turn");
  assert.equal(requests.at(-1).reasoning.effort, "low");
  assert.deepEqual(requests.at(-1).text.format, format);
  assert.deepEqual(requests.at(-1).tools, [{ type: "web_search", filters: { allowed_domains: ["example.com"] } }]);
  assert.equal(requests.at(-1).max_tool_calls, 2);

  // Preserve explicit rollback/custom overrides, including whitespace handling.
  process.env.OPENAI_MODEL_THINK = " gpt-5.6-sol ";
  process.env.OPENAI_MODEL_BRAIN = "gpt-5.6-sol";
  const rollback = await import(`../lib/openai.ts?rollback=${Date.now()}`);
  assert.equal(rollback.OPENAI_MODEL_THINK, "gpt-5.6-sol");
  assert.equal(rollback.OPENAI_MODEL_BRAIN, "gpt-5.6-sol");
  await rollback.openai.messages.create({ model: rollback.OPENAI_MODEL_THINK, max_tokens: 350, messages: [] });
  assert.equal(requests.at(-1).reasoning.effort, "none");

  process.env.OPENAI_MODEL_LIVE = "gpt-6.1-sol";
  const routedSol = await import(`../lib/openai.ts?routed=${Date.now()}`);
  await routedSol.openai.messages.create({ model: routedSol.OPENAI_MODEL_LIVE, max_tokens: 700, messages: [] });
  assert.equal(requests.at(-1).reasoning.effort, "low");

  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, web_search_calls: 2 };
  for (const tier of ["think", "brain"]) assert.ok(Math.abs(usageCostUSD(tier, usage) - 14.62) < 1e-10);
  assert.ok(Math.abs(usageCostUSD("live", usage) - 1.69) < 1e-10);
  assert.ok(Math.abs(usageCostUSD("pro", usage) - 16.72) < 1e-10);
  console.log("Sol migration checks passed: tier routing, reasoning, JSON, web search, streaming, overrides and costs");
} finally {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}
