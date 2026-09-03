const OPENAI_OAUTH_HOSTS = ["chatgpt.com", "openai.com"] as const;

function allowedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return OPENAI_OAUTH_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );
}

export function isAllowedOpenAiUrl(value: string | null | undefined): boolean {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && allowedHost(url.hostname);
  } catch {
    return false;
  }
}

export function isAllowedChatGptOAuthClient(input: {
  clientUri?: string | null;
  redirectUri?: string | null;
}): boolean {
  return (
    isAllowedOpenAiUrl(input.clientUri) &&
    isAllowedOpenAiUrl(input.redirectUri)
  );
}

export function safeChatGptOAuthRedirect(value: string): string | null {
  return isAllowedOpenAiUrl(value) ? value : null;
}
