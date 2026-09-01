// Shared CRM types and helpers used by the CRM pages and components. Account
// ownership and workspace visibility are enforced by the server and database,
// so browser-side shapes deliberately expose only the product fields they use.

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
  is_confidential?: boolean;
  commercial_memory?: Record<string, any> | null;
  commercial_memory_updated_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type Contact = {
  id: string;
  company_id: string | null;
  department_id?: string | null;
  name: string;
  role: string | null;
  email: string | null;
  sector: string | null;
  attributes: Record<string, any>;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Department = {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type Workstream = {
  id: string;
  company_id: string;
  department_id: string | null;
  name: string;
  kind: "relationship" | "opportunity" | "partnership" | "project" | "support" | "internal";
  status: "active" | "paused" | "completed" | "archived";
  purpose: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkstreamContact = {
  workstream_id: string;
  contact_id: string;
  company_id: string;
  relationship_role: string | null;
  is_primary: boolean;
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
// Several dashboard cards ask for the same feed as they mount. Share the first
// in-flight request instead of sending duplicate database reads while the
// cache is still empty.
const _getInflight = new Map<string, Promise<any>>();
let _cacheEpoch = 0;

export function clearCrmCache(): void {
  _cacheEpoch += 1;
  _getCache.clear();
  _getInflight.clear();
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("livecoach:outreach-prepare-queue:v1");
  }
}

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
export type CrmRequestBlocker = {
  code: string;
  title: string;
  reason: string;
  nextAction: string;
  responsible: "user" | "manager" | "owner" | "system";
};

export class CrmRequestError extends Error {
  status: number;
  blocker: CrmRequestBlocker | null;

  constructor(
    message: string,
    status: number,
    blocker: CrmRequestBlocker | null = null
  ) {
    super(message);
    this.name = "CrmRequestError";
    this.status = status;
    this.blocker = blocker;
  }
}

export function crmFetch<T = any>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET") {
    const existing = _getInflight.get(url);
    if (existing) return existing as Promise<T>;
  }
  const readEpoch = _cacheEpoch;
  // CACHE-BUST EVERY READ.
  //
  // `cache: "no-store"` and server-side force-dynamic were both still losing to
  // something in front of the app: recovered calls kept showing as unsummarised,
  // and a client page kept serving a call list from before the data changed,
  // while the database was correct the whole time. A URL that has never been
  // requested before cannot be served from ANY cache (browser, service worker,
  // CDN or edge), so a unique parameter is the one thing that always wins.
  //
  // The cache KEY stays the clean url, so getCached(url) still seeds instantly.
  const fetchUrl =
    method === "GET"
      ? `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`
      : url;
  const request = (async () => {
    const res = await fetch(fetchUrl, {
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
    if (!res.ok) {
      const blocker =
        data?.blocker && typeof data.blocker === "object"
          ? (data.blocker as CrmRequestBlocker)
          : null;
      throw new CrmRequestError(
        data.error || `The CRM request failed with status ${res.status}. Refresh and try again.`,
        res.status,
        blocker
      );
    }
    // Cache under the CLEAN url (not the cache-busted one) so getCached() hits.
    if (method === "GET") {
      // A write may have completed while this read was in flight. Return the
      // response to its original caller, but never let that older snapshot
      // become the value shown on a later screen.
      if (readEpoch === _cacheEpoch) _getCache.set(url, data);
    } else {
      // A successful write can affect several different CRM feeds (dashboard,
      // client page, tasks, pipeline and outreach). Never let an older in-memory
      // GET snapshot repaint that confirmed database change on the next screen.
      _cacheEpoch += 1;
      _getCache.clear();
      _getInflight.clear();
    }
    return data as T;
  })();

  if (method === "GET") {
    _getInflight.set(url, request);
    void request.finally(() => {
      if (_getInflight.get(url) === request) _getInflight.delete(url);
    }).catch(() => {});
  }
  return request;
}
