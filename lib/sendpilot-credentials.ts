import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const CREDENTIAL_VERSION = "v1";

type CredentialScope = {
  ownerId: string;
  workspaceId: string;
  purpose: "api-key" | "webhook-secret";
};

function configuredSecret(secret?: string): string {
  const value = String(
    secret || process.env.SENDPILOT_CREDENTIAL_ENCRYPTION_KEY || ""
  ).trim();
  if (value.length < 32) {
    throw new Error("SendPilot credential encryption is not configured");
  }
  return value;
}

function encryptionKey(secret?: string): Buffer {
  return createHash("sha256").update(configuredSecret(secret)).digest();
}

function additionalData(scope: CredentialScope): Buffer {
  return Buffer.from(
    [CREDENTIAL_VERSION, scope.workspaceId, scope.ownerId, scope.purpose].join(":"),
    "utf8"
  );
}

export function isSendPilotCredentialEncryptionConfigured(): boolean {
  return String(process.env.SENDPILOT_CREDENTIAL_ENCRYPTION_KEY || "").trim()
    .length >= 32;
}

export function encryptSendPilotCredential(
  value: string,
  scope: CredentialScope,
  secret?: string
): string {
  const plaintext = String(value || "").trim();
  if (!plaintext) throw new Error("A SendPilot credential is required");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(additionalData(scope));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    CREDENTIAL_VERSION,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptSendPilotCredential(
  value: string,
  scope: CredentialScope,
  secret?: string
): string {
  const [version, encodedIv, encodedPayload, encodedTag, extra] = String(
    value || ""
  ).split(".");
  if (
    version !== CREDENTIAL_VERSION ||
    !encodedIv ||
    !encodedPayload ||
    !encodedTag ||
    extra
  ) {
    throw new Error("The stored SendPilot credential is invalid");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(encodedIv, "base64url")
    );
    decipher.setAAD(additionalData(scope));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedPayload, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("The stored SendPilot credential could not be decrypted");
  }
}
