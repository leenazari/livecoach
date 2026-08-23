export function sharedClientBlockReason(company: any): string | null {
  if (company?.is_confidential === true) return "Confidential lock is on";
  const triage =
    company?.profile?.triage && typeof company.profile.triage === "object"
      ? company.profile.triage
      : {};
  const classification = String(triage.classification || "").toLowerCase();
  const stage = String(company?.stage || "").toLowerCase();
  const sector = String(company?.sector || "").toLowerCase();
  const labels = [classification, stage, sector];
  const contains = (pattern: RegExp) => labels.some((label) => pattern.test(label));
  if (contains(/\binvest(or|ment)?\b/))
    return "Investor records stay private";
  if (contains(/\b(in[ _-]?house|internal|employee|staff)\b/))
    return "Internal and staff records stay private";
  if (contains(/\b(board|adviser|advisor)\b/))
    return "Board and adviser records stay private";
  if (
    contains(
      /\b(strategic|major|large|confidential|private)[ _-]?partner(ship)?\b/
    ) ||
    contains(
      /\bpartner(ship)?[ _-]?(strategic|major|large|confidential|private)\b/
    )
  )
    return "Strategic and confidential partner records stay private";
  if (contains(/\b(product[ _-]?trial|vendor|supplier)\b/))
    return "Vendors and product trials stay private";
  if (contains(/\b(personal|private)\b/))
    return "Personal records stay private";
  return null;
}
