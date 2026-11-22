import "server-only";

import {
  LEAD_GENERATOR_PATHS,
  LeadGeneratorError,
  assertLeadGeneratorOrigin,
  costEstimateQuery,
  parseCostEstimate,
  parseSampleResponse,
  performLeadGeneratorRequest,
  sampleRequestBody,
  type LeadCostEstimate,
  type LeadGeneratorFilters,
  type SampleResult,
} from "@/lib/lead-generator-contract";

type Kind = "sample" | "estimate";

export type UpstreamDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

function failure(kind: Kind, status: number, known: boolean): LeadGeneratorError {
  const sample = kind === "sample";
  const refused = status === 401 || status === 403;
  const missing = status === 404;
  const busy = status === 429;
  return new LeadGeneratorError({
    status: status === 404 ? 502 : status >= 400 && status < 500 ? status : known ? 502 : 504,
    code: sample ? "lead_sample_failed" : "lead_estimate_failed",
    title: sample ? "Sample could not be confirmed" : "Cost estimate could not be confirmed",
    reason: refused
      ? "The mailer did not accept the server secret."
      : missing
        ? "The mailer does not offer that action yet."
        : busy
          ? "The mailer asked us to wait."
          : known
            ? "The mailer rejected the request."
            : "The mailer did not return a complete reply.",
    outcome: sample
      ? known && !refused && !busy
        ? "The sample was not accepted. It should not have been charged, but check with the owner if you are unsure."
        : "This sample may already have been charged."
      : "Nothing was saved.",
    nextAction: sample
      ? "Check with a workspace owner before running another sample."
      : "Ask for the cost again. Do not save the campaign until a cost is shown.",
    responsible: refused || missing ? "owner" : "system",
  });
}

export function readLeadGeneratorConfig(env: NodeJS.ProcessEnv) {
  const raw = String(env.OUTREACHMAILER_BASE_URL || "").trim();
  const secret = String(env.LEADGEN_API_SECRET || "").trim();
  if (!raw || !secret) {
    throw new LeadGeneratorError({
      status: 503,
      code: "leadgen_not_configured",
      title: "Lead generator is not set up",
      reason: "The mailer address or server secret is missing.",
      nextAction: "Ask a workspace owner to set the server address and secret, then try again.",
      outcome: "Nothing was sent.",
      responsible: "owner",
    });
  }
  return { baseUrl: assertLeadGeneratorOrigin(raw, secret), secret };
}

async function callUpstream(
  kind: Kind,
  method: "GET" | "POST",
  path: string,
  deps: UpstreamDeps,
  query?: URLSearchParams,
  body?: unknown
) {
  const config = readLeadGeneratorConfig(deps.env || process.env);
  let result: { status: number; payload: unknown };
  try {
    result = await performLeadGeneratorRequest({
      baseUrl: config.baseUrl,
      secret: config.secret,
      path,
      method,
      query,
      body,
      timeoutMs: kind === "sample" ? 25000 : 15000,
      fetchImpl: deps.fetchImpl || fetch,
    });
  } catch (error) {
    if (error instanceof LeadGeneratorError) throw error;
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    console.error("lead_generator_upstream", { kind, code: aborted ? "timeout" : "network" });
    throw failure(kind, aborted ? 504 : 502, false);
  }
  if (result.status < 200 || result.status >= 300) {
    console.error("lead_generator_upstream", { kind, status: result.status });
    throw failure(kind, result.status, result.status < 500);
  }
  return result.payload;
}

export async function fetchLeadSample(
  filters: LeadGeneratorFilters,
  deps: UpstreamDeps = {}
): Promise<SampleResult> {
  const payload = await callUpstream(
    "sample",
    "POST",
    LEAD_GENERATOR_PATHS.sample,
    deps,
    undefined,
    sampleRequestBody(filters)
  );
  return parseSampleResponse(payload);
}

export async function fetchLeadCostEstimate(
  input: {
    filters: LeadGeneratorFilters;
    daysToRun: number | null;
    dailyLeadTarget: number | null;
  },
  deps: UpstreamDeps = {}
): Promise<LeadCostEstimate> {
  const payload = await callUpstream(
    "estimate",
    "GET",
    LEAD_GENERATOR_PATHS.costEstimate,
    deps,
    costEstimateQuery(input)
  );
  return parseCostEstimate(payload);
}
