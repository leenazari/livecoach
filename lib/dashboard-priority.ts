export function compareDashboardActions(
  a: { entity?: string; score?: number; at?: string | number | null },
  b: { entity?: string; score?: number; at?: string | number | null },
  callsFirst: boolean,
): number {
  if (callsFirst) {
    const aCall = a.entity === "upcoming";
    const bCall = b.entity === "upcoming";
    if (aCall !== bCall) return aCall ? -1 : 1;
    if (aCall && bCall) return new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime();
  }
  return (b.score || 0) - (a.score || 0);
}
