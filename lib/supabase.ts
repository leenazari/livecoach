import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getRequestScope,
  isVerifiedServiceRequest,
} from "@/lib/request-scope";
import { getServiceRecordScope } from "@/lib/service-scope";

// Next.js can cache PostgREST GETs independently of the surrounding route.
// CRM correctness and account isolation require every database operation to
// bypass the Data Cache.
const databaseFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: "no-store",
  });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const SCOPED_RECORD_TABLES = new Set([
  "ai_cache", "app_config", "assistant_messages", "call_feedback",
  "calendar_event_exclusions", "client_context", "coaching_points", "companies", "company_priority",
  "contact_company_overrides", "contacts", "crm_company_redirects",
  "daily_briefs", "departments", "document_jobs", "external_refs",
  "field_definitions", "follow_ups", "google_oauth", "linkedin_contact_links",
  "linkedin_inbox_connectors", "linkedin_inbox_messages", "linkedin_oauth",
  "microsoft_oauth", "interview_sessions",
  "interview_summaries", "knowledge_base", "knowledge_docs", "lessons",
  "meet_bots", "meet_utterances", "opportunities", "opportunity_events",
  "opportunity_signal_receipts", "outreach_campaigns", "outreach_enrolments",
  "outreach_events", "outreach_learnings", "outreach_messages",
  "outreach_prospects", "outreach_signals", "outreach_suppressions",
  "sendpilot_integrations", "sendpilot_webhook_events", "tasks",
  "upcoming_calls", "usage_log", "workspace_profile", "workstream_contacts",
  "workstreams",
]);

function scopedRows(value: unknown, scope: { userId: string; workspaceId: string }) {
  const rows = Array.isArray(value) ? value : [value];
  const scoped = rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const input = row as Record<string, unknown>;
    if (input.owner_id && input.owner_id !== scope.userId)
      throw new Error("Cross-account service insert is not permitted");
    if (input.workspace_id && input.workspace_id !== scope.workspaceId)
      throw new Error("Cross-workspace service insert is not permitted");
    return { ...input, owner_id: scope.userId, workspace_id: scope.workspaceId };
  });
  return Array.isArray(value) ? scoped : scoped[0];
}

function serviceScopedTable(table: string, scope: { userId: string; workspaceId: string }) {
  if (!SCOPED_RECORD_TABLES.has(table)) {
    throw new Error(`Service access to ${table} requires an explicit admin client`);
  }
  const tableClient: any = supabaseService.from(table);
  const constrain = (builder: any) =>
    builder
      .eq("workspace_id", scope.workspaceId)
      .or(`owner_id.eq.${scope.userId},visibility.eq.team`);
  return new Proxy(tableClient, {
    get(target, property, receiver) {
      if (property === "select")
        return (...args: any[]) => constrain(target.select(...args));
      if (property === "update")
        return (...args: any[]) => constrain(target.update(...args));
      if (property === "delete")
        return (...args: any[]) => constrain(target.delete(...args));
      if (property === "insert")
        return (value: unknown, ...args: any[]) =>
          target.insert(scopedRows(value, scope), ...args);
      if (property === "upsert")
        return (value: unknown, ...args: any[]) =>
          target.upsert(scopedRows(value, scope), ...args);
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// This client bypasses RLS. It is reserved for verified cron work, encrypted
// connector credentials and narrowly scoped storage operations. Never import
// it into a client component and never use it for an unscoped browser request.
export const supabaseService = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: databaseFetch },
});

function requestClient(): SupabaseClient {
  const scope = getRequestScope();
  if (!scope) {
    const serviceScope = getServiceRecordScope();
    if (isVerifiedServiceRequest() && serviceScope) {
      return new Proxy({} as SupabaseClient, {
        get(_target, property) {
          if (property === "from")
            return (table: string) => serviceScopedTable(table, serviceScope);
          if (property === "rpc")
            throw new Error("Service RPCs require an explicitly scoped wrapper");
          throw new Error(`Service client property ${String(property)} is not available`);
        },
      });
    }
    if (isVerifiedServiceRequest()) {
      throw new Error("A background job account owner must be selected");
    }
    throw new Error(
      "A verified user or service request is required for database access"
    );
  }

  return createClient(url, publicKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: databaseFetch,
      headers: { Authorization: `Bearer ${scope.accessToken}` },
    },
  });
}

// Compatibility name retained across existing routes. This proxy itself holds
// no session. It creates a fresh user-scoped client for every operation, so a
// warm Vercel instance cannot retain one person's credentials for the next
// request. Supabase RLS is the final authority for every CRM row.
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = requestClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
