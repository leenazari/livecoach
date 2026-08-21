import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getRequestScope,
  isVerifiedServiceRequest,
} from "@/lib/request-scope";

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
    if (isVerifiedServiceRequest()) return supabaseService;
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
