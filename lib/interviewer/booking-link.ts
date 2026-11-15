export function publicBookingUrl(value: unknown): string {
  const text = String(value || "").trim();
  if (text.length < 12 || text.length > 500) return "";
  if (!/^https:\/\/[^\s]+$/i.test(text)) return "";
  return text;
}
