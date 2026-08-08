import { createClient } from "@supabase/supabase-js";

// Next.js 13/14 can cache the GET requests that supabase-js makes to PostgREST,
// even when the surrounding API response is marked no-store. That produced a
// particularly dangerous split-brain state: a company PATCH was committed and
// its individual page showed the new stage, while the portfolio's broader
// companies SELECT kept returning the pre-save stage after a hard refresh.
//
// This service-role client is only used on the server. Make every underlying
// database request bypass Next's Data Cache so any successful write is visible
// on the very next CRM read. Correctness matters more than caching a small,
// single-user CRM database; the higher-level endpoints already keep reads
// bounded and parallel.
const databaseFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: "no-store",
  });

// Server-side Supabase client using the service role key.
// Never import this into a client component.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
    global: { fetch: databaseFetch },
  }
);
