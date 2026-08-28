import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const verificationType = url.searchParams.get("type");
  const authenticationMethod = url.searchParams.get("method");
  const fallbackNext = verificationType === "recovery" ? "/reset-password" : "/login";
  const requestedNext = url.searchParams.get("next") || fallbackNext;
  const next =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/login";

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[]
        ) {
          cookiesToSet.forEach(
            ({ name, value, options }: {
              name: string;
              value: string;
              options: CookieOptions;
            }) => cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  let error: Error | null = null;
  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    error = result.error;
  } else if (
    tokenHash &&
    (verificationType === "invite" ||
      verificationType === "email" ||
      verificationType === "magiclink" ||
      verificationType === "recovery")
  ) {
    const result = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: verificationType as EmailOtpType,
    });
    error = result.error;
  } else {
    error = new Error("The authentication link is incomplete");
  }

  const errorDestination =
    verificationType === "recovery" || next === "/reset-password"
      ? "/forgot-password?reset=error"
      : authenticationMethod === "email"
        ? "/login?email=error"
      : "/login?invite=error";

  return NextResponse.redirect(new URL(error ? errorDestination : next, url.origin));
}
