const LINK_HINT = /pricing|prices|services|service|about|faq|faqs|contact|product|kiosk|pos|hardware|hospitality|solution|industr|demo|book|plan|feature|menu|order/i;

const PAGE_SCORE: Array<[RegExp, number]> = [
  [/kiosk/, 100],
  [/pos|point-of-sale/, 90],
  [/pric|plan/, 80],
  [/product|hardware|hospitality/, 70],
  [/feature|solution|order|menu/, 50],
  [/about|contact|faq|demo|book/, 30],
];

export function pageScore(url: URL): number {
  const path = `${url.pathname} ${url.href}`.toLowerCase();
  return PAGE_SCORE.reduce((best, [pattern, score]) => pattern.test(path) ? Math.max(best, score) : best, 0);
}

export function isBlockedAddress(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  const v4 = value.startsWith("::ffff:") ? value.slice(7) : value;
  const parts = v4.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function robotsAllows(robots: string, path: string): boolean {
  const lines = robots.split(/\r?\n/);
  let applies = false;
  let best: { allow: boolean; length: number } | null = null;
  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    const agent = line.match(/^user-agent:\s*(.+)$/i);
    if (agent) {
      const name = agent[1].trim().toLowerCase();
      applies = name === "*" || name === "livecoachinterviewer";
      continue;
    }
    if (!applies) continue;
    const rule = line.match(/^(allow|disallow):\s*(.*)$/i);
    if (!rule) continue;
    const prefix = rule[2].trim();
    if (!prefix) continue;
    if (path.startsWith(prefix) && (!best || prefix.length > best.length)) {
      best = { allow: rule[1].toLowerCase() === "allow", length: prefix.length };
    }
  }
  return best ? best.allow : true;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
}

export function pickInternalLinks(html: string, pageUrl: URL, limit = 40): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    let next: URL;
    try { next = new URL(match[1], pageUrl); } catch { continue; }
    if (next.host !== pageUrl.host || next.protocol !== pageUrl.protocol) continue;
    if (!LINK_HINT.test(`${next.pathname} ${next.href}`)) continue;
    next.hash = "";
    next.search = "";
    const value = next.toString();
    if (!found.includes(value) && value !== pageUrl.toString()) found.push(value);
    if (found.length >= limit) break;
  }
  return found;
}

export function sitemapLocs(xml: string, pageUrl: URL): string[] {
  const found: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    let next: URL;
    try { next = new URL(match[1], pageUrl); } catch { continue; }
    if (next.host !== pageUrl.host || next.protocol !== pageUrl.protocol) continue;
    if (!/\.html?$|\/$/i.test(next.pathname) && next.pathname.split("/").pop()?.includes(".")) continue;
    next.hash = "";
    next.search = "";
    const value = next.toString();
    if (!found.includes(value)) found.push(value);
  }
  return found;
}

export function choosePages(urls: string[], home: URL, limit = 25): string[] {
  const unique = new Map<string, URL>();
  for (const value of urls) {
    let next: URL;
    try { next = new URL(value, home); } catch { continue; }
    if (next.host !== home.host || next.protocol !== home.protocol) continue;
    next.hash = "";
    next.search = "";
    unique.set(next.toString(), next);
  }
  const homeKey = home.toString().replace(/\/$/, "");
  return [...unique.entries()]
    .sort((left, right) => {
      const leftHome = left[0].replace(/\/$/, "") === homeKey ? 1 : 0;
      const rightHome = right[0].replace(/\/$/, "") === homeKey ? 1 : 0;
      return rightHome - leftHome || pageScore(right[1]) - pageScore(left[1]);
    })
    .slice(0, limit)
    .map(([value]) => value);
}
