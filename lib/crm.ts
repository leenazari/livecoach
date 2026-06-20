// Shared CRM types + helpers used by the /crm pages and components.
// Single-user today (owner_id stays null); the shapes already allow multi-tenant.

export type FieldType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "select"
  | "multiselect"
  | "url"
  | "boolean";

export type FieldDefinition = {
  id: string;
  entity: "company" | "contact";
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  filterable: boolean;
  searchable: boolean;
  position: number;
};

export type Company = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  sector: string | null;
  stage: string | null;
  profile: Record<string, any>;
  attributes: Record<string, any>;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Contact = {
  id: string;
  company_id: string | null;
  name: string;
  role: string | null;
  email: string | null;
  sector: string | null;
  attributes: Record<string, any>;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// A stable, lowercase key from a human label, for a new custom field.
export function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

// Render a stored attribute value for display, by field type.
export function formatFieldValue(type: FieldType, value: any): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "currency": {
      const n = Number(value);
      if (Number.isNaN(n)) return String(value);
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 0,
      }).format(n);
    }
    case "number":
      return String(value);
    case "boolean":
      return value ? "Yes" : "No";
    case "multiselect":
      return Array.isArray(value) ? value.join(", ") : String(value);
    default:
      return String(value);
  }
}

// Last successful GET response per URL. Module scope persists across in-app
// (client-side) navigation, so a page can render its previous data INSTANTLY
// on a revisit (no blank/blink) while a fresh fetch updates it in the
// background. Cleared on a full page reload. Use `getCached` to seed state.
const _getCache = new Map<string, any>();

export function getCached<T = any>(url: string): T | undefined {
  return _getCache.get(url) as T | undefined;
}

// Manually update the cache (e.g. right after a save) so the next render of a
// page that seeds from getCached shows the new value, not a stale one.
export function setCached(url: string, value: any): void {
  _getCache.set(url, value);
}

// Tiny typed fetch wrapper - throws on non-OK with the server's message.
// Successful GETs are cached by URL for instant re-render on revisit.
export async function crmFetch<T = any>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    // Never serve a CRM read from the browser's HTTP cache. A just-saved change
    // (assigning a call to a client, marking a call done) must be reflected on
    // the very next load, not after some cache TTL expires.
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("unexpected response from the server");
  }
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET") _getCache.set(url, data);
  return data as T;
}
