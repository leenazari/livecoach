import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extractTextFromPDF } from "@/lib/pdf-extract";
import { anthropic, CLAUDE_MODEL_LIVE } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "knowledge_docs";

// Keep names path-safe but human-readable (spaces allowed, no slashes).
function cleanName(raw: string): string {
  return raw.replace(/[\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

async function extractCandidateName(cvText: string): Promise<string | null> {
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL_LIVE,
      max_tokens: 30,
      system:
        "Extract the candidate's full name from this CV. Reply with ONLY the name — no labels, no punctuation, nothing else. If you genuinely cannot find a name, reply with exactly: UNKNOWN",
      messages: [{ role: "user", content: cvText.slice(0, 4000) }],
    });
    const raw = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("")
      .trim();
    if (!raw || raw.toUpperCase() === "UNKNOWN") return null;
    return cleanName(raw) || null;
  } catch (e) {
    console.error("Name extraction failed:", e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const docType = (form.get("doc_type") as string) || "framework";
    const typedCandidate = (form.get("candidate") as string) || null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Read bytes once.
    const arrayBuf = await file.arrayBuffer();
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    // For CVs we need the text now (to read the name). For other docs we skip.
    let detectedName: string | null = null;
    if (docType === "cv") {
      let text = "";
      try {
        text = isPdf
          ? await extractTextFromPDF(new Uint8Array(arrayBuf))
          : new TextDecoder().decode(arrayBuf);
      } catch (e) {
        console.error("CV text extract failed:", e);
      }
      if (text.trim()) {
        detectedName = await extractCandidateName(text);
      }
    }

    // Decide the folder this doc lives under.
    const candidateFolder =
      docType === "framework"
        ? "global"
        : cleanName(detectedName || typedCandidate || "unknown") || "unknown";

    const timestamp = Date.now();
    const fileSafe = `${timestamp}-${file.name
      .replace(/[^a-z0-9.-]/gi, "_")
      .toLowerCase()}`;
    const storagePath = `${docType}/${candidateFolder}/${fileSafe}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, file);

    if (uploadError) throw uploadError;

    return NextResponse.json({
      ok: true,
      source: file.name,
      doc_type: docType,
      // The name the UI should adopt (extracted for CVs, else whatever was typed).
      candidate: docType === "framework" ? null : candidateFolder,
      detectedName,
      storagePath,
    });
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: err?.message || "Upload failed" },
      { status: 500 }
    );
  }
}
