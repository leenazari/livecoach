import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const STATE_VERSION = 1;
export const LINKEDIN_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type LinkedInOAuthState = {
  userId: string;
  workspaceId: string;
  returnOrigin: string;
  includeSocial: boolean;
  issuedAt: number;
};

type LinkedInOAuthStatePayload = LinkedInOAuthState & {
  version: number;
  nonce: string;
};

function signingSecret(secret?: string): string {
  const value = String(secret || process.env.LINKEDIN_CLIENT_SECRET || "").trim();
  if (!value) throw new Error("LinkedIn OAuth state signing is not configured");
  return value;
}

function normalizedReturnOrigin(value: string): string {
  const url = new URL(value);
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error("LinkedIn OAuth return origin must use HTTPS");
  }
  return url.origin;
}

function encryptionKey(secret?: string): Buffer {
  return createHash("sha256").update(signingSecret(secret)).digest();
}

export function createLinkedInOAuthState(
  input: Omit<LinkedInOAuthState, "issuedAt"> & { issuedAt?: number },
  secret?: string
): string {
  const payload: LinkedInOAuthStatePayload = {
    version: STATE_VERSION,
    nonce: randomBytes(32).toString("base64url"),
    userId: String(input.userId || "").trim(),
    workspaceId: String(input.workspaceId || "").trim(),
    returnOrigin: normalizedReturnOrigin(input.returnOrigin),
    includeSocial: input.includeSocial === true,
    issuedAt: input.issuedAt ?? Date.now(),
  };
  if (!payload.userId || !payload.workspaceId) {
    throw new Error("LinkedIn OAuth state is missing its account scope");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return `${iv.toString("base64url")}.${encrypted.toString(
    "base64url"
  )}.${cipher.getAuthTag().toString("base64url")}`;
}

export function verifyLinkedInOAuthState(
  value: string | null | undefined,
  options: { now?: number; secret?: string } = {}
): LinkedInOAuthState | null {
  try {
    const [encodedIv, encodedPayload, encodedTag, extra] = String(
      value || ""
    ).split(".");
    if (!encodedIv || !encodedPayload || !encodedTag || extra) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(options.secret),
      Buffer.from(encodedIv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encodedPayload, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(decrypted) as Partial<LinkedInOAuthStatePayload>;
    const now = options.now ?? Date.now();
    if (
      payload.version !== STATE_VERSION ||
      typeof payload.nonce !== "string" ||
      payload.nonce.length < 32 ||
      typeof payload.userId !== "string" ||
      !payload.userId.trim() ||
      typeof payload.workspaceId !== "string" ||
      !payload.workspaceId.trim() ||
      typeof payload.issuedAt !== "number" ||
      payload.issuedAt > now + 60_000 ||
      now - payload.issuedAt > LINKEDIN_OAUTH_STATE_TTL_MS ||
      typeof payload.returnOrigin !== "string"
    ) {
      return null;
    }

    return {
      userId: payload.userId.trim(),
      workspaceId: payload.workspaceId.trim(),
      returnOrigin: normalizedReturnOrigin(payload.returnOrigin),
      includeSocial: payload.includeSocial === true,
      issuedAt: payload.issuedAt,
    };
  } catch {
    return null;
  }
}
