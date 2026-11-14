// Deepgram signals a full concurrency pool with HTTP 429, close code 1013,
// or an error description. Ordinary socket drops are not treated as a refusal,
// so a lead is not moved to the front of the queue by a blip.
export function isDeepgramConcurrencyRefusal(input: {
  code?: string | number | null;
  message?: string | null;
  closeCode?: number | null;
}): boolean {
  if (input.closeCode === 1013 || input.code === 429 || input.code === "429") return true;
  const text = `${input.code ?? ""} ${input.message ?? ""}`.toLowerCase();
  return /concurren|too many|rate.?limit|no_capacity|resource_exhausted|quota|over.?limit|maximum concurrent|connection limit/.test(text);
}
