export function sharedClientBlockReason(company: any): string | null {
  const triage =
    company?.profile?.triage && typeof company.profile.triage === "object"
      ? company.profile.triage
      : {};
  const classification = String(triage.classification || "").toLowerCase();
  const stage = String(company?.stage || "").toLowerCase();
  const sector = String(company?.sector || "").toLowerCase();
  const combined = `${classification} ${stage} ${sector}`;
  if (/\binvest(or|ment)?\b/.test(combined))
    return "Investor records stay private";
  if (/\b(in[ _-]?house|internal|employee|staff)\b/.test(combined))
    return "Internal and staff records stay private";
  if (/\b(board|adviser|advisor)\b/.test(combined))
    return "Board and adviser records stay private";
  if (
    /\b(strategic|major|large|confidential|private)[ _-]?partner(ship)?\b/.test(
      combined
    ) ||
    /\bpartner(ship)?[ _-]?(strategic|major|large|confidential|private)\b/.test(
      combined
    )
  )
    return "Strategic and confidential partner records stay private";
  if (/\b(product[ _-]?trial|vendor|supplier)\b/.test(combined))
    return "Vendors and product trials stay private";
  if (/\b(personal|private)\b/.test(combined))
    return "Personal records stay private";
  return null;
}
