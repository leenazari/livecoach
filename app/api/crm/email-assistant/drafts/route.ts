import { NextResponse } from "next/server";

import {
  getEmailAssistantCapabilities,
  listEmailAssistantDrafts,
} from "@/lib/email-assistant";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET() {
  try {
    requireRequestScope();
    const [drafts, capabilities] = await Promise.all([
      listEmailAssistantDrafts(),
      getEmailAssistantCapabilities(),
    ]);
    return NextResponse.json({ drafts, capabilities }, { headers: noStore });
  } catch {
    return NextResponse.json(
      { error: "Could not load the next-move drafts" },
      { status: 500, headers: noStore }
    );
  }
}
