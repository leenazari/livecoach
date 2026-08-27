import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildLinkedInAuthUrl,
  linkedinConfigured,
} from "@/lib/linkedin";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const scope = requireRequestScope();
    if (!linkedinConfigured()) {
      return NextResponse.json(
        {
          error:
            "LinkedIn is not configured yet. Add the LinkedIn app credentials in Vercel first.",
        },
        { status: 400 }
      );
    }
    const includeSocial = request.nextUrl.searchParams.get("social") === "1";
    const state = randomBytes(32).toString("base64url");
    const response = NextResponse.redirect(
      buildLinkedInAuthUrl(state, includeSocial)
    );
    response.cookies.set("linkedin_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    response.cookies.set("linkedin_oauth_owner", scope.userId, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: "A signed in account is required" },
      { status: 401 }
    );
  }
}
