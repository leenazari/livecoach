export type CostRates = {
  voiceAgentUsdPerMinute: number;
  voiceAgentByoUsdPerMinute: number | null;
  useByoLlm: boolean;
  listenUsdPerMinute: number;
  ttsUsdPer1kChars: number;
  openaiInputUsdPerMillion: number;
  openaiOutputUsdPerMillion: number;
  storageUsdPerGb: number;
  vercelUsdPerCall: number;
  usdToGbp: number;
};

export type SessionCostInput = {
  connectedSeconds: number;
  recordingBytes: number;
  ratePerMinute: number;
  currency: string;
  rates: CostRates;
};

export type SessionCost = {
  connectedSeconds: number;
  voiceAgentUsd: number;
  listenUsd: number;
  storageUsd: number;
  vercelUsd: number;
  totalUsd: number;
  totalGbp: number;
  revenueGbp: number | null;
  marginGbp: number | null;
  marginPercent: number | null;
};

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export function sessionCost(input: SessionCostInput): SessionCost {
  const minutes = Math.max(0, input.connectedSeconds) / 60;
  const voiceRate = input.rates.useByoLlm && input.rates.voiceAgentByoUsdPerMinute != null
    ? input.rates.voiceAgentByoUsdPerMinute
    : input.rates.voiceAgentUsdPerMinute;
  const voiceAgentUsd = round6(minutes * voiceRate);
  const listenUsd = round6(minutes * input.rates.listenUsdPerMinute);
  const storageUsd = round6((Math.max(0, input.recordingBytes) / 1_000_000_000) * input.rates.storageUsdPerGb);
  const vercelUsd = input.connectedSeconds > 0 ? round6(input.rates.vercelUsdPerCall) : 0;
  const totalUsd = round6(voiceAgentUsd + listenUsd + storageUsd + vercelUsd);
  const totalGbp = round6(totalUsd * input.rates.usdToGbp);
  const revenue = (Math.max(0, input.connectedSeconds) / 60) * Math.max(0, input.ratePerMinute);
  const currency = input.currency.toUpperCase();
  const revenueGbp = currency === "GBP"
    ? round6(revenue)
    : currency === "USD"
      ? round6(revenue * input.rates.usdToGbp)
      : null;
  const marginGbp = revenueGbp == null ? null : round6(revenueGbp - totalGbp);
  const marginPercent = revenueGbp && revenueGbp > 0 && marginGbp != null
    ? Math.round((marginGbp / revenueGbp) * 10000) / 100
    : null;
  return {
    connectedSeconds: input.connectedSeconds,
    voiceAgentUsd,
    listenUsd,
    storageUsd,
    vercelUsd,
    totalUsd,
    totalGbp,
    revenueGbp,
    marginGbp,
    marginPercent,
  };
}

export function llmUsd(rates: CostRates, inputTokens: number, outputTokens: number): number {
  return round6(
    (Math.max(0, inputTokens) / 1_000_000) * rates.openaiInputUsdPerMillion
    + (Math.max(0, outputTokens) / 1_000_000) * rates.openaiOutputUsdPerMillion
  );
}

export function ttsPreviewUsd(rates: CostRates, characters: number): number {
  return round6((Math.max(0, characters) / 1000) * rates.ttsUsdPer1kChars);
}

export function money(value: number | null, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `£${value.toFixed(digits)}`;
}
