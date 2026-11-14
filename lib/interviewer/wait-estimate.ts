export type WaitEstimate = {
  label: string;
  overTenMinutes: boolean;
  lowMinutes: number | null;
  highMinutes: number | null;
};

function percentile(sorted: number[], ratio: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

// Range from recent connected-call lengths. Queue time is never an input.
// With no finished calls yet, the copy stays honest instead of inventing a range.
export function estimateInterviewerWait(input: {
  position: number;
  slotLimit: number;
  recentSeconds: number[];
}): WaitEstimate {
  const ahead = Math.max(0, Math.floor(input.position || 1) - 1);
  if (ahead === 0) {
    return { label: "Less than a minute", overTenMinutes: false, lowMinutes: 0, highMinutes: 1 };
  }

  const samples = input.recentSeconds.filter((seconds) => seconds >= 15 && seconds <= 180 * 60);
  if (!samples.length) {
    return {
      label: "A wait estimate will appear after a few conversations finish",
      overTenMinutes: false,
      lowMinutes: null,
      highMinutes: null,
    };
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const slots = Math.max(1, Math.floor(input.slotLimit || 43));
  const waves = ahead / slots;
  const lowMinutes = Math.max(1, Math.round((waves * percentile(sorted, 0.25)) / 60));
  const highMinutes = Math.max(lowMinutes, Math.round((waves * percentile(sorted, 0.75)) / 60));
  if (lowMinutes > 10 || highMinutes > 10) {
    return { label: "Over 10 minutes", overTenMinutes: true, lowMinutes, highMinutes };
  }
  const label = lowMinutes === highMinutes
    ? `About ${lowMinutes} minute${lowMinutes === 1 ? "" : "s"}`
    : `About ${lowMinutes}–${highMinutes} minutes`;
  return { label, overTenMinutes: false, lowMinutes, highMinutes };
}
