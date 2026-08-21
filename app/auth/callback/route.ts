import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const verificationType = url.searchParams.get("type");
  const requestedNext = url.searchParams.get("next") || "/login";
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
    (verificationType === "invite" || verificationType === "magiclink")
  ) {
    const result = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: verificationType,
    });
    error = result.error;
  } else {
    error = new Error("The authentication link is incomplete");
  }

  return NextResponse.redirect(
    new URL(error ? "/login?invite=error" : next, url.origin)
  );
}
