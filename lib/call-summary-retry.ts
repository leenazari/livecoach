export function isTransientSummaryFailure(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return /\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|rate limit|temporar|unavailable|timeout|timed out|network|fetch failed/.test(
    message
  );
}

export async function withTransientSummaryRetry<T>(
  work: (attempt: number) => Promise<T>,
  options?: { attempts?: number; delayMs?: number }
) {
  const attempts = Math.max(1, options?.attempts || 2);
  const delayMs = Math.max(0, options?.delayMs ?? 600);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientSummaryFailure(error)) throw error;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
