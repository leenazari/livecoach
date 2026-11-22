import "server-only";

import { randomUUID } from "node:crypto";

import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";
import { usageCostUSD } from "@/lib/costs";
import { LeadGeneratorError } from "@/lib/lead-generator-contract";
import { isMissingLeadBankError } from "@/lib/lead-bank-shape";
import {
  existingCleanseDomains,
  loadPendingCleanseLeads,
  logCleanseDecision,
  saveCleanseVerdict,
} from "@/lib/lead-bank";
import {
  CLEANSE_BATCH_SIZE,
  CLEANSE_MAX_BATCHES,
  CLEANSE_MAX_OUTPUT_TOKENS,
  CLEANSE_RESPONSE_FORMAT,
  CLEANSE_SYSTEM,
  executeLeadCleanse,
} from "@/lib/lead-cleanse-rules";

async function askCleanseModel(leads: unknown[]) {
  const message = await openai.messages.create(
    {
      model: OPENAI_MODEL_LIVE,
      max_tokens: CLEANSE_MAX_OUTPUT_TOKENS,
      response_format: CLEANSE_RESPONSE_FORMAT,
      system: CLEANSE_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ leads }) }],
    },
    { timeout: 20000 }
  );
  const usage = message.usage || {};
  const text = (message.content || [])
    .map((part) => String((part as { text?: string }).text || ""))
    .join("");
  return {
    text,
    inputTokens:
      (usage.input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0),
    outputTokens: usage.output_tokens || 0,
    costUsd: usageCostUSD("live", usage),
  };
}

export async function runNightlyLeadCleanse(now = new Date(), env = process.env) {
  const loadedIds = new Set<string>();
  try {
    return await executeLeadCleanse({
      now,
      env,
      loadPending: async () => {
        const loaded = await loadPendingCleanseLeads(CLEANSE_BATCH_SIZE * CLEANSE_MAX_BATCHES);
        loadedIds.clear();
        for (const lead of loaded.leads) loadedIds.add(lead.id);
        return loaded;
      },
      existingDomainHits: (domains) => existingCleanseDomains(domains, loadedIds),
      saveVerdict: saveCleanseVerdict,
      askModel: askCleanseModel,
      runId: randomUUID(),
      logDecision: logCleanseDecision,
    });
  } catch (error) {
    if (error instanceof LeadGeneratorError || isMissingLeadBankError(error)) {
      return {
        ok: false as const,
        error: "lead_bank_not_ready",
        note: "The lead bank is not ready. No leads were checked.",
      };
    }
    console.error("lead_cleanse_failed", {
      name: error instanceof Error ? error.name : "error",
    });
    return {
      ok: false as const,
      error: "lead_cleanse_failed",
      note: "The cleanse stopped before checking leads. Pending rows were left pending.",
    };
  }
}
