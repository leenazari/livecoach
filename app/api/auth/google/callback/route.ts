import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/auth/google/callback -> Google redirects here with a code. Verify the
// state cookie, exchange the code for tokens, store them, and bounce back to
// Settings with a status flag.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("g_oauth_state")?.value;

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(`${base}/settings?google=denied`);
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(`${base}/settings?google=error`);
  }

  try {
    const tok = await exchangeCode(code);
    const access = tok.access_token as string | undefined;
    const refresh = tok.refresh_token as string | undefined;
    const expiry = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();

    // Best-effort: which account did they connect.
    let email: string | null = null;
    if (access) {
      try {
        const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${access}` },
        });
        if (r.ok) email = (await r.json())?.email || null;
      } catch {
        /* ignore */
      }
    }

    // Only overwrite the refresh token when Google sends a new one (it does on a
    // fresh consent). Keep the existing one otherwise.
    const row: Record<string, any> = {
      id: "main",
      access_token: access || null,
      expiry,
      updated_at: new Date().toISOString(),
    };
    if (refresh) row.refresh_token = refresh;
    if (email) row.email = email;

    await supabaseAdmin.from("google_oauth").upsert(row, { onConflict: "id" });

    const res = NextResponse.redirect(`${base}/settings?google=connected`);
    res.cookies.set("g_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  } catch {
    return NextResponse.redirect(`${base}/settings?google=error`);
  }
}
