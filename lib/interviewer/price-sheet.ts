import { extractSetup, planPreview, type Suggestion } from "./setup-extract";
import type { PricePlan } from "./setup-fields";
import { isInternalCostLine } from "./slide-notes";

export type SheetRow = {
  name: string;
  price: string;
  period: string;
  includes: string;
  overage: string;
  details: string;
};

export type SheetParse = {
  columns: string[];
  rows: SheetRow[];
  plans: PricePlan[];
  trial: string;
  discount: string;
  warnings: string[];
};

const SKIP_COLUMN = /\b(margin|supplier|wholesale|cost price|our cost|internal|reseller|api cost|token cost)\b/i;
const NAME_COLUMN = /^(plan|name|tier|package|product|sku)( name)?$/;
const PERIOD_COLUMN = /^(period|billing|interval|cadence|billed|term)$/;
const INCLUDE_COLUMN = /(minute|unit|allowance|included|hours|quantity)/;
const FEATURE_COLUMN = /(feature|include|description|detail)/;
const OVERAGE_COLUMN = /(overage|extra|excess)/;
const CURRENCY_COLUMN = /^currency$/;
const TRIAL_COLUMN = /^trial$/;
const DISCOUNT_COLUMN = /(discount|save)/;

export function emptySheet(warning = ""): SheetParse {
  return { columns: ["Plan", "Price", "Period", "Includes", "Overage", "Details"], rows: [], plans: [], trial: "", discount: "", warnings: warning ? [warning] : [] };
}

export function parseCsvPriceSheet(text: string): SheetParse {
  const table = parseDelimited(text);
  if (table.length < 2) return emptySheet("No rows were found. Use a header row and one row per price.");
  return plansFromTable(table[0], table.slice(1));
}

export async function parseXlsxPriceSheet(bytes: ArrayBuffer | Uint8Array): Promise<SheetParse> {
  const files = await unzip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const shared = sharedStrings(files.get("xl/sharedStrings.xml") || "");
  const sheetName = [...files.keys()].find((name) => /xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const sheet = sheetName ? files.get(sheetName) || "" : "";
  if (!sheet) return emptySheet("That spreadsheet has no sheet to read. Save the first sheet as CSV and upload that.");
  const table = sheetRows(sheet, shared);
  if (table.length < 2) return emptySheet("No rows were found. Use a header row and one row per price.");
  return plansFromTable(table[0], table.slice(1));
}

export function plansFromSheetText(text: string): SheetParse {
  const cleaned = String(text || "").replace(/\u0000/g, " ").trim();
  if (!cleaned) return emptySheet("No text was found in that file.");
  const lines = cleaned.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : lines.filter((line) => line.split(",").length > 3).length >= 2 ? "," : "";
  if (delimiter) {
    const table = parseDelimited(lines.join("\n"), delimiter);
    if (table.length >= 2) {
      const parsed = plansFromTable(table[0], table.slice(1));
      if (parsed.plans.length) return parsed;
    }
  }
  const extracted = extractSetup(withCurrencyWords(cleaned));
  const rows = extracted.plans.map((plan) => ({
    name: plan.name,
    price: plan.price,
    period: plan.period,
    includes: plan.includes,
    overage: plan.overage,
    details: "",
  }));
  return {
    columns: ["Plan", "Price", "Period", "Includes", "Overage", "Details"],
    rows,
    plans: rows.map(toPlan).filter(hasPrice),
    trial: extracted.trial,
    discount: extracted.discount,
    warnings: rows.length ? [] : ["No prices were found. Check the sheet, or type the plans in below."],
  };
}

export function plansFromVision(payload: { rows?: Array<Partial<SheetRow>>; trial?: string; discount?: string }): SheetParse {
  const rows = (payload.rows || []).flatMap((row) => {
    const next = cleanRow({
      name: String(row.name || ""),
      price: withCurrencyWords(String(row.price || "")),
      period: periodWord(String(row.period || "")),
      includes: String(row.includes || ""),
      overage: String(row.overage || ""),
      details: String(row.details || ""),
    });
    return next ? [next] : [];
  });
  return {
    columns: ["Plan", "Price", "Period", "Includes", "Overage", "Details"],
    rows,
    plans: rows.map(toPlan).filter(hasPrice),
    trial: isInternalCostLine(String(payload.trial || "")) ? "" : String(payload.trial || "").trim(),
    discount: isInternalCostLine(String(payload.discount || "")) ? "" : String(payload.discount || "").trim(),
    warnings: rows.length ? [] : ["No prices were read from that image."],
  };
}

export function priceSheetSuggestions(parsed: SheetParse | null, existing: PricePlan[], trial: string, discount: string): Suggestion[] {
  if (!parsed) return [];
  const items: Suggestion[] = [];
  parsed.plans.forEach((plan, index) => {
    const same = existing.some((item) => item.name.trim().toLowerCase() === plan.name.trim().toLowerCase() && item.price.trim().toLowerCase() === plan.price.trim().toLowerCase() && item.period.trim().toLowerCase() === plan.period.trim().toLowerCase());
    if (same) return;
    items.push({
      id: `sheet-plan-${index}`,
      step: 3,
      label: plan.name || "Plan",
      preview: planPreview(plan),
      source: "price sheet",
      apply: "plan",
      value: planPreview(plan),
      plan,
    });
  });
  if (!trial.trim() && parsed.trial) {
    items.push({ id: "sheet-trial", step: 3, label: "Trial", preview: parsed.trial, source: "price sheet", apply: "trial", value: parsed.trial });
  }
  if (!discount.trim() && parsed.discount) {
    items.push({ id: "sheet-discount", step: 3, label: "Discount", preview: parsed.discount, source: "price sheet", apply: "discount", value: parsed.discount });
  }
  return items;
}

function plansFromTable(headers: string[], body: string[][]): SheetParse {
  const keys = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9£$€]+/g, " ").trim());
  const skipped = keys.map((key) => SKIP_COLUMN.test(key));
  const rows: SheetRow[] = [];
  const warnings: string[] = [];
  let trial = "";
  let discount = "";
  const limited = body.slice(0, 200);
  if (body.length > 200) warnings.push("Only the first 200 rows were read.");
  for (const cells of limited) {
    const currency = cellFor(keys, cells, (key) => CURRENCY_COLUMN.test(key));
    const name = cellFor(keys, cells, (key) => NAME_COLUMN.test(key)) || "Plan";
    const periodCell = periodWord(cellFor(keys, cells, (key) => PERIOD_COLUMN.test(key)));
    const includes = [cellFor(keys, cells, (key) => INCLUDE_COLUMN.test(key)), cellFor(keys, cells, (key) => FEATURE_COLUMN.test(key) && !INCLUDE_COLUMN.test(key))].filter(Boolean).join("; ");
    const overage = cellFor(keys, cells, (key) => OVERAGE_COLUMN.test(key));
    const details = keys.flatMap((key, index) => {
      if (!key || skipped[index] || NAME_COLUMN.test(key) || PERIOD_COLUMN.test(key) || INCLUDE_COLUMN.test(key) || FEATURE_COLUMN.test(key) || OVERAGE_COLUMN.test(key) || CURRENCY_COLUMN.test(key) || TRIAL_COLUMN.test(key) || DISCOUNT_COLUMN.test(key) || isPriceKey(key)) return [];
      const value = String(cells[index] || "").trim();
      if (!value || isInternalCostLine(value) || isInternalCostLine(key)) return [];
      return [`${headers[index].trim()}: ${value}`];
    }).join("; ");
    if (!trial) trial = cellFor(keys, cells, (key) => TRIAL_COLUMN.test(key));
    if (!discount) discount = cellFor(keys, cells, (key) => DISCOUNT_COLUMN.test(key));
    const prices = priceCells(keys, cells, currency, periodCell);
    if (!prices.length && !name) continue;
    if (isInternalCostLine(name)) continue;
    for (const price of prices) {
      const row = cleanRow({ name, price: price.price, period: price.period || periodCell, includes, overage, details });
      if (row) rows.push(row);
    }
  }
  return {
    columns: ["Plan", "Price", "Period", "Includes", "Overage", "Details"],
    rows,
    plans: rows.map(toPlan).filter(hasPrice),
    trial: isInternalCostLine(trial) ? "" : trial,
    discount: isInternalCostLine(discount) ? "" : discount,
    warnings,
  };
}

function priceCells(keys: string[], cells: string[], currency: string, periodCell: string): Array<{ price: string; period: string }> {
  const found: Array<{ price: string; period: string }> = [];
  keys.forEach((key, index) => {
    if (!isPriceKey(key) || SKIP_COLUMN.test(key)) return;
    const price = money(String(cells[index] || ""), currency);
    if (!price) return;
    found.push({ price, period: periodFromKey(key) || periodCell });
  });
  return found;
}

function isPriceKey(key: string): boolean {
  if (SKIP_COLUMN.test(key) || OVERAGE_COLUMN.test(key)) return false;
  return /^(price|amount|fee)\b|monthly|month|yearly|annual|year/.test(key);
}

function periodFromKey(key: string): string {
  if (/year|annual/.test(key)) return "yearly";
  if (/month/.test(key)) return "monthly";
  if (/week/.test(key)) return "weekly";
  return "";
}

function periodWord(value: string): string {
  const text = value.toLowerCase();
  if (/year|annual|annum/.test(text)) return "yearly";
  if (/month/.test(text)) return "monthly";
  if (/week/.test(text)) return "weekly";
  return value.trim();
}

function money(value: string, currency: string): string {
  const text = withCurrencyWords(value).trim();
  if (!text || /^(-|n\/a|na)$/i.test(text)) return "";
  if (/[£$€]/.test(text) || /^(free|custom)$/i.test(text)) return text.replace(/\s+/g, "");
  const number = text.match(/\d[\d,]*(?:\.\d{1,2})?/);
  if (!number) return /[a-z]/i.test(text) ? text : "";
  const code = currency.toLowerCase();
  const symbol = /usd|dollar/.test(code) ? "$" : /eur|euro/.test(code) ? "€" : /gbp|pound|sterling/.test(code) ? "£" : "";
  return symbol ? `${symbol}${number[0]}` : number[0];
}

function withCurrencyWords(value: string): string {
  return value
    .replace(/\bGBP\s*(\d[\d,]*(?:\.\d{1,2})?)/gi, "£$1")
    .replace(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*GBP\b/gi, "£$1")
    .replace(/\bUSD\s*(\d[\d,]*(?:\.\d{1,2})?)/gi, (_match, amount: string) => `$${amount}`)
    .replace(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*USD\b/gi, (_match, amount: string) => `$${amount}`)
    .replace(/\bEUR\s*(\d[\d,]*(?:\.\d{1,2})?)/gi, "€$1")
    .replace(/\b(\d[\d,]*(?:\.\d{1,2})?)\s*EUR\b/gi, "€$1");
}

function cellFor(keys: string[], cells: string[], match: (key: string) => boolean): string {
  const index = keys.findIndex((key) => key && match(key) && !SKIP_COLUMN.test(key));
  return index === -1 ? "" : String(cells[index] || "").replace(/\s+/g, " ").trim();
}

function cleanRow(row: SheetRow): SheetRow | null {
  const next = {
    name: row.name.replace(/\s+/g, " ").trim() || "Plan",
    price: row.price.replace(/\s+/g, " ").trim(),
    period: row.period.replace(/\s+/g, " ").trim(),
    includes: row.includes.replace(/\s+/g, " ").trim(),
    overage: row.overage.replace(/\s+/g, " ").trim(),
    details: row.details.replace(/\s+/g, " ").trim(),
  };
  if (isInternalCostLine([next.name, next.price, next.period, next.includes, next.overage].join(" "))) return null;
  if (!next.price && !next.includes) return null;
  return next;
}

function toPlan(row: SheetRow): PricePlan {
  return { name: row.name, price: row.price, period: row.period, includes: row.includes, overage: row.overage, details: row.details };
}

export function sheetWithRows(parsed: SheetParse, rows: SheetRow[]): SheetParse {
  return { ...parsed, rows, plans: rows.map(toPlan).filter(hasPrice) };
}

function hasPrice(plan: PricePlan): boolean {
  return Boolean(plan.price.trim());
}

function parseDelimited(text: string, forced?: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = forced || detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(cell.trim()); cell = ""; continue; }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((entry) => entry.trim()) || "";
  const counts = [",", "\t", ";"].map((mark) => ({ mark, count: line.split(mark).length }));
  counts.sort((left, right) => right.count - left.count);
  return counts[0].count > 1 ? counts[0].mark : ",";
}

async function unzip(bytes: Uint8Array): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    const data = bytes.slice(start, start + compressed);
    const raw = method === 0 ? data : method === 8 ? await inflateRaw(data) : data;
    if (!name.endsWith("/")) files.set(name, new TextDecoder().decode(raw));
    offset = start + compressed;
  }
  return files;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function sharedStrings(xml: string): string[] {
  const values: string[] = [];
  for (const item of xml.match(/<si\b[\s\S]*?<\/si>/g) || []) {
    values.push(decodeXml((item.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map((part) => part.replace(/<[^>]+>/g, "")).join("")));
  }
  return values;
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
    const cells: string[] = [];
    for (const cell of row.match(/<c\b[\s\S]*?<\/c>|<c\b[^>]*\/>/g) || []) {
      const ref = cell.match(/\br="([A-Z]+)\d+"/i)?.[1] || "";
      const index = columnIndex(ref);
      const kind = cell.match(/\bt="([^"]+)"/)?.[1] || "";
      const value = decodeXml(cell.match(/<v>([\s\S]*?)<\/v>/)?.[1] || cell.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || "");
      cells[index] = kind === "s" ? shared[Number(value)] || "" : value;
    }
    rows.push(cells.map((cell) => cell || ""));
  }
  return rows;
}

function columnIndex(letters: string): number {
  return letters.toUpperCase().split("").reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
