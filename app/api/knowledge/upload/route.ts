import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

// Upload PDF or text file to Supabase storage.
// Text extraction happens asynchronously when /api/interview/context loads it.
// This matches VoiceReach pattern: upload → process in background.
//
// Form fields:
//   file      - PDF or .txt
//   doc_type  - "cv" | "summary" | "framework"
//   candidate - optional; scopes CVs/summaries to a candidate
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const docType = (form.get("doc_type") as string) || "framework";
    const candidate = (form.get("candidate") as string) || null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Generate a safe filename with timestamp to avoid collisions
    const timestamp = Date.now();
    const safeName = `${timestamp}-${file.name
      .replace(/[^a-z0-9.-]/gi, "_")
      .toLowerCase()}`;
    const storagePath = `${docType}/${candidate || "global"}/${safeName}`;

    // Upload to Supabase storage (not database)
    const { error: uploadError } = await supabaseAdmin.storage
      .from("knowledge_docs")
      .upload(storagePath, file);

    if (uploadError) throw uploadError;

    return NextResponse.json({
      ok: true,
      source: file.name,
      doc_type: docType,
      candidate,
      storagePath,
      message: "File uploaded. Processing in background...",
    });
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: err?.message || "Upload failed" },
      { status: 500 }
    );
  }
}
