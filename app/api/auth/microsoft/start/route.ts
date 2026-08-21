import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import {
  buildMicrosoftAuthUrl,
  microsoftConfigured,
} from "@/lib/microsoft";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";

export async function GET() {
  try {
    requireRequestScope();
    if (!microsoftConfigured()) {
      return NextResponse.json(
        {
          error:
            "Microsoft is not configured yet. Add the Microsoft app credentials in Vercel first.",
        },
        { status: 400 }
      );
    }
    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(buildMicrosoftAuthUrl(state));
    response.cookies.set("ms_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ error: "A signed in account is required" }, { status: 401 });
  }
}
