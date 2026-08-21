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
    path.startsWith("/api/auth/google") ||
    path.startsWith("/api/meet") ||
    path.startsWith("/api/knowledge") ||
    path === "/api/feedback" ||
    path === "/api/tts" ||
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

  // Authentication alone is not authorization. LiveCoach is invite-only and
  // every private page/API requires an active workspace membership. This gate
  // is deliberately in place before a second account is invited because the
  // legacy server routes still use a service-role database client.
  const requiresWorkspaceMembership = isPrivatePage || isPrivateApi;
  if (user && !serviceAuthorized && requiresWorkspaceMembership) {
    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership) {
      if (isPrivateApi) {
        return NextResponse.json(
          { error: "workspace access required" },
          {
            status: 403,
            headers: { "Cache-Control": "private, no-store" },
          }
        );
      }

      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("access", "denied");
      const denied = NextResponse.redirect(url);
      denied.headers.set("Cache-Control", "private, no-store");
      return denied;
    }
  }

  // Authenticated responses must never be reused for a different account by a
  // browser, CDN or warm Vercel instance.
  if (user) response.headers.set("Cache-Control", "private, no-store");

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
