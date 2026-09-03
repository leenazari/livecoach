export function safeLocalRedirect(
  value: string | null | undefined,
  fallback = "/crm"
): string {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;

  try {
    const parsed = new URL(candidate, "https://www.livecoachcrm.com");
    if (parsed.origin !== "https://www.livecoachcrm.com") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
