import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, googleConfigured } from "@/lib/google";
import { createGoogleOAuthState } from "@/lib/google-oauth-state";
import { publicAppOrigin } from "@/lib/public-app-url";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";

// GET /api/auth/google/start -> kick off the Google consent flow. Sets a state
// cookie for CSRF protection, then redirects to Google.
export async function GET(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    if (!googleConfigured()) {
      return NextResponse.json(
        {
          error:
            "Google isn't configured yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in Vercel, then redeploy.",
        },
        { status: 400 }
      );
    }
    const state = createGoogleOAuthState({
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      returnOrigin: publicAppOrigin(request.nextUrl.origin),
      onboarding: scope.status === "onboarding",
    });
    const response = NextResponse.redirect(buildAuthUrl(state));
    response.cookies.set("g_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "A signed in account is required" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
