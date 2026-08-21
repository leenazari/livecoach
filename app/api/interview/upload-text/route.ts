import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { storageSegment } from "@/lib/storage-scope";

export const runtime = "nodejs";

// Stores already-extracted document TEXT as a .txt in the same storage location
// the context loader reads (session/<id>/cv/). The browser does the heavy
// extraction, so this body is small - no request-size limit in play. The
// context route reads .txt files as plain text directly, so the doc flows into
// the plan with no other changes.
const BUCKET = "knowledge_docs";

export async function POST(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const { sessionId, name, text } = await req.json();
    const safeSessionId = storageSegment(sessionId);
    if (!safeSessionId) {
      return NextResponse.json(
        { error: "a valid sessionId is required" },
        { status: 400 }
      );
    }
    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: "no text to store" },
        { status: 400 }
      );
    }

    const base =
      (typeof name === "string" && name ? name : "document")
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9._ -]/g, "_")
        .slice(0, 80) || "document";
    const path = `users/${account.userId}/session/${safeSessionId}/cv/${Date.now()}_${base}.txt`;

    const { error } = await supabaseService.storage
      .from(BUCKET)
      .upload(path, new Blob([text], { type: "text/plain" }), {
        contentType: "text/plain; charset=utf-8",
        upsert: true,
      });
    if (error) throw error;

    return NextResponse.json({ ok: true, name: `${base}.txt`, chars: text.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to store document" },
      { status: 500 }
    );
  }
}
