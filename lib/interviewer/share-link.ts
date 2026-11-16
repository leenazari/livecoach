// Query added to a copied preview link so an outside tester can pass Vercel
// Deployment Protection. Production and local links stay unchanged. The secret
// is passed in by the server from the environment. Do not read it in client
// code and do not hardcode it.
export function previewProtectionQuery(env: {
  VERCEL_ENV?: string;
  VERCEL_AUTOMATION_BYPASS_SECRET?: string;
}): string {
  if (env.VERCEL_ENV !== "preview") return "";
  const secret = (env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();
  if (!secret) return "";
  const params = new URLSearchParams();
  params.set("x-vercel-protection-bypass", secret);
  params.set("x-vercel-set-bypass-cookie", "true");
  return params.toString();
}

export function appendShareQuery(url: string, shareQuery: string): string {
  const extra = shareQuery.trim();
  if (!extra) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${extra}`;
}
