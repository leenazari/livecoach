const LINK_HINT = /pricing|prices|services|service|about|faq|faqs|contact|product|kiosk|pos|hardware|hospitality|solution|industr|demo|book|plan|feature|menu|order/i;

export const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const MIN_IMPORT_CHARS = 1500;
export const THIN_PAGE_CHARS = 400;

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

export function moduleScriptUrls(html: string, pageUrl: URL): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    const src = tag.match(/\ssrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    if (!/type\s*=\s*["']module["']/i.test(tag) && !/\.m?js(?:\?|$)/i.test(src)) continue;
    let next: URL;
    try { next = new URL(src, pageUrl); } catch { continue; }
    if (next.host !== pageUrl.host || next.protocol !== pageUrl.protocol) continue;
    const value = next.toString();
    if (!found.includes(value)) found.push(value);
  }
  return found;
}

export function scriptRoutes(js: string): string[] {
  const found: string[] = [];
  for (const match of js.matchAll(/path\s*:\s*["'](\/[^"' #\s]*)["']/g)) {
    const path = match[1];
    if (path.includes(":") || path.includes("*")) continue;
    if (!found.includes(path)) found.push(path);
  }
  return found;
}

function isHumanSentence(raw: string): boolean {
  if (!/[a-z]/i.test(raw) || !/\s/.test(raw)) return false;
  if (/[{}<>]|=>|\{\{|https?:|\/\/|\bfunction\b|className|\bjsx\b/.test(raw)) return false;
  const words = raw.split(/\s+/);
  if (words.length < 3) return false;
  if (words.some((word) => /^[a-z]+[A-Z][A-Za-z]+$/.test(word))) return false;
  return true;
}

export function humanSentences(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/"((?:\\.|[^"\\]){8,400})"/g)) {
    const raw = match[1]
      .replace(/\\n/g, " ")
      .replace(/\\"/g, "\"")
      .replace(/\\u00a3/gi, "£")
      .replace(/\s+/g, " ")
      .trim();
    if (!isHumanSentence(raw)) continue;
    if (!found.includes(raw)) found.push(raw);
  }
  return found;
}

function routeComponentName(js: string, pathname: string): string {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = js.match(new RegExp(`path\\s*:\\s*["']${escaped}["']\\s*,\\s*element\\s*:\\s*[A-Za-z0-9_$.]+\\(\\s*([A-Za-z0-9_$]+)`));
  return match?.[1] || "";
}

export function functionSource(js: string, name: string): string {
  if (!/^[A-Za-z0-9_$]+$/.test(name)) return "";
  const start = js.search(new RegExp(`function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`));
  if (start < 0) return "";
  const open = js.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < Math.min(js.length, open + 150000); index += 1) {
    const char = js[index];
    if (char === "\"" || char === "'" || char === "`") {
      index += 1;
      while (index < js.length && js[index] !== char) {
        if (js[index] === "\\") index += 1;
        index += 1;
      }
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return js.slice(open, index + 1);
    }
  }
  return "";
}

export function routeScriptText(js: string, pathname: string): string {
  const name = routeComponentName(js, pathname);
  if (!name) return "";
  return humanSentences(functionSource(js, name)).join("\n");
}

export function sharedScriptText(js: string): string {
  const claimed = new Set<string>();
  for (const path of scriptRoutes(js)) {
    for (const line of routeScriptText(js, path).split("\n")) if (line) claimed.add(line);
  }
  const rank = (line: string) => {
    if (/£\s?\d/.test(line)) return 3;
    if (/kiosk|pos|till|loyalty|book|hospitality|price/i.test(line)) return 2;
    return 1;
  };
  const lines = humanSentences(js).filter((line) => !claimed.has(line)).sort((left, right) => rank(right) - rank(left));
  let used = 0;
  const kept: string[] = [];
  for (const line of lines) {
    if (used + line.length > 6000) break;
    kept.push(line);
    used += line.length;
  }
  return kept.join("\n");
}

export function inlineScriptText(html: string): string {
  const parts: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(match[1])) continue;
    if (/fbq\(|gtag\(|googletagmanager|facebook\.net/i.test(match[2])) continue;
    const text = humanSentences(match[2]).join("\n");
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

export function readablePageText(input: { html: string; pathname: string; scripts: string[] }): { text: string; visibleChars: number } {
  const visible = htmlToText(input.html);
  if (visible.length >= THIN_PAGE_CHARS) return { text: visible.slice(0, 8000), visibleChars: visible.length };
  const route = input.scripts.map((script) => routeScriptText(script, input.pathname)).filter(Boolean).join("\n");
  const shared = input.pathname === "/" ? input.scripts.map((script) => sharedScriptText(script)).filter(Boolean).join("\n") : "";
  const inline = inlineScriptText(input.html);
  const text = [visible, inline, route, shared].filter(Boolean).join("\n\n").slice(0, 8000);
  return { text, visibleChars: visible.length };
}

export function priceTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of text.matchAll(/£\s?\d[\d,]*(?:\.\d+)?/g)) tokens.add(match[0].replace(/\s+/g, "").toLowerCase());
  return tokens;
}

export function dropInventedPrices(body: string, source: string): string {
  const allowed = priceTokens(source);
  return body
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => [...priceTokens(sentence)].every((token) => allowed.has(token)))
    .join(" ")
    .trim();
}
