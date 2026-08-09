const PROTECTED_TOKEN = /(https?:\/\/[^\s]+|www\.[^\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/gi;
const DASHES = /[-\u2010-\u2015\u2212]+/g;

/**
 * Lee's outreach voice avoids dashes, including technically correct hyphens.
 * Links and email addresses are protected because changing those could make
 * them unusable.
 */
export function removeDashesFromProse(value: unknown): string {
  return String(value || "")
    .split(PROTECTED_TOKEN)
    .map((part) =>
      /^(?:https?:\/\/|www\.)/i.test(part) || /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/i.test(part)
        ? part
        : part.replace(DASHES, " ").replace(/[ \t]{2,}/g, " ")
    )
    .join("");
}
