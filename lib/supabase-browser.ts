import { createBrowserClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// Client-side Supabase client (uses the anon key). Safe in the browser.
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Password recovery deliberately uses the implicit browser flow. The normal
 * application client uses PKCE, whose verifier is stored in the browser that
 * requested the email. Recovery links need to remain usable when the user
 * opens the email on another trusted device. Access tokens return in the URL
 * fragment, which is not sent to the server, and the normal browser client
 * consumes and clears that fragment on the reset page.
 */
export function createSupabasePasswordResetClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "implicit",
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

/**
 * The reset page receives an implicit recovery session in the URL fragment.
 * It must use an implicit client as well. The normal SSR browser client is
 * intentionally PKCE-only and rejects that fragment as the wrong flow type.
 *
 * A separate storage key keeps this short-lived recovery session away from the
 * normal application session. The reset page signs it out after the password
 * has been changed.
 */
export function createSupabasePasswordRecoveryClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "implicit",
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: true,
        storageKey: "livecoach-password-recovery",
      },
    }
  );
}
