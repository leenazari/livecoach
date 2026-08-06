import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPrivatePage =
    path.startsWith("/call") ||
    path.startsWith("/crm") ||
    path.startsWith("/settings") ||
    path.startsWith("/candidate-bot") ||
    path.startsWith("/meet-test");
  // CRM and model-powered interview APIs contain private client data and can
  // incur usage. Keep only the room-scoped candidate context route public.
  const isPrivateApi =
    path.startsWith("/api/crm") ||
    path === "/api/candidate/respond" ||
    path === "/api/auth/google/status" ||
    (path.startsWith("/api/interview") && path !== "/api/interview/context");
  // Vercel cron and authenticated server-to-server follow-ups use CRON_SECRET.
  const cronSecret = process.env.CRON_SECRET || "";
  const serviceAuthorized =
    !!cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`;

  if (!user && !serviceAuthorized && isPrivateApi) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  // Candidate join pages and the bot harness stay public; the private operator
  // console always requires the signed-in Supabase session.
  if (!user && isPrivatePage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
