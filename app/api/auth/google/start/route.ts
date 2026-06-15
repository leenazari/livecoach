import { NextResponse } from "next/server";
import { buildAuthUrl, googleConfigured } from "@/lib/google";

export const runtime = "nodejs";

// GET /api/auth/google/start -> kick off the Google consent flow. Sets a state
// cookie for CSRF protection, then redirects to Google.
export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google isn't configured yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in Vercel, then redeploy.",
      },
      { status: 400 }
    );
  }
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
