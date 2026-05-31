import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { chunkText } from "@/lib/chunk";

export const runtime = "nodejs";
export const maxDuration = 60;

// Accepts a PDF or text doc, extracts + chunks it, stores it in Supabase.
//
// POC note: we store raw text chunks only (no embedding). The live loop
// loads them whole via /context and caches them — cheaper and simpler than
// vector search for a single interview. When knowledge bases get large
// (e.g. the sales template with many brochures), re-enable embeddings here
// using lib/embeddings.ts + the match_knowledge_docs function in schema.sql.
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

    // ---- Extract text ----
    let text = "";
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      text = parsed.text;
    } else {
      text = await file.text();
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "Could not extract any text from the file" },
        { status: 422 }
      );
    }

    // ---- Chunk + store (no embedding in the POC) ----
    const chunks = chunkText(text);
    const rows = chunks.map((content) => ({
      content,
      doc_type: docType,
      candidate,
      source: file.name,
    }));

    const { error } = await supabaseAdmin.from("knowledge_docs").insert(rows);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      source: file.name,
      doc_type: docType,
      candidate,
      chunks: chunks.length,
    });
  } catch (err: any) {
    console.error("Knowledge upload error:", err);
    return NextResponse.json(
      { error: err?.message || "Upload failed" },
      { status: 500 }
    );
  }
}
