import { createBrowserClient } from "@supabase/ssr";

// Client-side Supabase client (uses the anon key). Safe in the browser.
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
