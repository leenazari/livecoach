import { NextResponse } from "next/server";
import { listSalespersonStockVoices } from "@/lib/salesperson-voice-library";
import { requireRequestScope } from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireRequestScope();
  } catch {
    return NextResponse.json({ error: "Sign in to choose your voice" }, { status: 403 });
  }
  try {
    const voices = await listSalespersonStockVoices();
    return NextResponse.json(
      { voices },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The voice library could not be loaded" },
      { status: 503 }
    );
  }
}
