import "server-only";

// Storage prefixes are assembled by the server. User-controlled values may be
// used only as one literal path segment, never as a slash-delimited path.
const SAFE_STORAGE_SEGMENT = /^[a-z0-9][a-z0-9._-]{0,159}$/i;

export function storageSegment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return SAFE_STORAGE_SEGMENT.test(clean) ? clean : null;
}

export function userStoragePrefix(userId: string): string {
  return `users/${userId}/`;
}
