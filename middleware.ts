import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  LIVECOACH_ACCESS_TOKEN_HEADER,
  LIVECOACH_INTERNAL_AUTH_HEADERS,
  LIVECOACH_SERVICE_REQUEST_HEADER,
  LIVECOACH_USER_ID_HEADER,
  LIVECOACH_WORKSPACE_ID_HEADER,
  LIVECOACH_WORKSPACE_ROLE_HEADER,
  LIVECOACH_WORKSPACE_STATUS_HEADER,
} from "@/lib/internal-auth-headers";

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function middleware(request: NextRequest) {
  // Browser-supplied internal headers are never trusted. Remove them before
  // authentication, then add verified values only after membership succeeds.
  const forwardedHeaders = new Headers(request.headers);
  for (const name of LIVECOACH_INTERNAL_AUTH_HEADERS) {
    forwardedHeaders.delete(name);
  }

  const pendingCookies: PendingCookie[] = [];
  const finish = <T extends NextResponse>(response: T): T => {
    for (const cookie of pendingCookies) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return response;
  };

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: PendingCookie[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          pendingCookies.push(...cookiesToSet);
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
    path.startsWith("/api/auth/microsoft") ||
    path === "/api/auth/team/status" ||
    path.startsWith("/api/meet") ||
    path.startsWith("/api/knowledge") ||
    path === "/api/feedback" ||
    path === "/api/tts" ||
    path.startsWith("/api/interview");
  const isPreMembershipApi = path === "/api/auth/team/accept";
  const isOnboardingApi =
    path === "/api/auth/team/status" ||
    path.startsWith("/api/auth/google") ||
    path.startsWith("/api/auth/microsoft");
  // Vercel cron and authenticated server-to-server follow-ups use CRON_SECRET.
  const cronSecret = process.env.CRON_SECRET || "";
  const serviceAuthorized =
    !!cronSecret &&
    request.headers.get("authorization") === `Bearer ${cronSecret}`;

  if (serviceAuthorized) {
    forwardedHeaders.set(LIVECOACH_SERVICE_REQUEST_HEADER, "cron");
  }

  if (!user && !serviceAuthorized && (isPrivateApi || isPreMembershipApi)) {
    return finish(
      NextResponse.json(
        { error: "authentication required" },
        {
          status: 401,
          headers: { "Cache-Control": "private, no-store" },
        }
      )
    );
  }

  // Candidate join pages and the bot harness stay public. The private operator
  // console always requires the signed-in Supabase session.
  if (!user && isPrivatePage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const login = NextResponse.redirect(url);
    login.headers.set("Cache-Control", "private, no-store");
    return finish(login);
  }

  // Authentication alone is not authorization. Every private page and API
  // requires an active workspace membership.
  const requiresWorkspaceMembership = isPrivatePage || isPrivateApi;

  // The invitation acceptance endpoint needs a verified Supabase user before
  // that user has a workspace membership. Forward only the verified user and
  // access token. The endpoint still validates the one-time invitation token.
  if (user && !serviceAuthorized && isPreMembershipApi) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return finish(
        NextResponse.json(
          { error: "authenticated session is required" },
          { status: 401, headers: { "Cache-Control": "private, no-store" } }
        )
      );
    }
    forwardedHeaders.set(LIVECOACH_ACCESS_TOKEN_HEADER, session.access_token);
    forwardedHeaders.set(LIVECOACH_USER_ID_HEADER, user.id);
  }

  if (user && !serviceAuthorized && requiresWorkspaceMembership) {
    const { data: membership, error: membershipError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, status")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership) {
      if (isPrivateApi) {
        return finish(
          NextResponse.json(
            { error: "workspace access required" },
            {
              status: 403,
              headers: { "Cache-Control": "private, no-store" },
            }
          )
        );
      }

      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("access", "denied");
      const denied = NextResponse.redirect(url);
      denied.headers.set("Cache-Control", "private, no-store");
      return finish(denied);
    }

    if (membership.status !== "active" && !(
      membership.status === "onboarding" && isOnboardingApi
    )) {
      if (isPrivateApi) {
        return finish(
          NextResponse.json(
            { error: "workspace access is not active" },
            { status: 403, headers: { "Cache-Control": "private, no-store" } }
          )
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = membership.status === "onboarding" ? "/join-team" : "/login";
      url.searchParams.set("access", membership.status);
      const denied = NextResponse.redirect(url);
      denied.headers.set("Cache-Control", "private, no-store");
      return finish(denied);
    }

    // getUser above validates the account with Supabase Auth. getSession is
    // used only to forward that already-verified request's access token so the
    // route's database queries execute under RLS as this person.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      if (isPrivateApi) {
        return finish(
          NextResponse.json(
            { error: "authenticated session is required" },
            {
              status: 401,
              headers: { "Cache-Control": "private, no-store" },
            }
          )
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      const expired = NextResponse.redirect(url);
      expired.headers.set("Cache-Control", "private, no-store");
      return finish(expired);
    }

    forwardedHeaders.set(LIVECOACH_ACCESS_TOKEN_HEADER, session.access_token);
    forwardedHeaders.set(LIVECOACH_USER_ID_HEADER, user.id);
    forwardedHeaders.set(
      LIVECOACH_WORKSPACE_ID_HEADER,
      membership.workspace_id
    );
    forwardedHeaders.set(LIVECOACH_WORKSPACE_ROLE_HEADER, membership.role);
    forwardedHeaders.set(
      LIVECOACH_WORKSPACE_STATUS_HEADER,
      membership.status
    );
  }

  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  // Authenticated responses must never be reused for a different account by a
  // browser, CDN or warm Vercel instance.
  if (user) response.headers.set("Cache-Control", "private, no-store");

  return finish(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
