import "server-only";

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";

export type DeepgramGrant =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; reason: "unconfigured" | "concurrency" | "failed" };

// Short-lived Deepgram JWT. The member API key stays on the server.
// Callers must already have confirmed an active interviewer slot.
export async function mintDeepgramGrant(): Promise<DeepgramGrant> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return { ok: false, reason: "unconfigured" };
  let response: Response;
  try {
    response = await fetch(GRANT_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (response.status === 429) return { ok: false, reason: "concurrency" };
  if (!response.ok) {
    console.error("interviewer deepgram grant failed", { status: response.status });
    return { ok: false, reason: "failed" };
  }
  const body = await response.json().catch(() => null);
  const accessToken = body?.access_token;
  if (typeof accessToken !== "string" || !accessToken) return { ok: false, reason: "failed" };
  return { ok: true, accessToken, expiresIn: Number(body?.expires_in || 60) };
}
