import { NextRequest, NextResponse } from "next/server";
import { supabaseService } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { storageSegment } from "@/lib/storage-scope";
import { extractTextFromPDF } from "@/lib/pdf-extract";
import { openai, OPENAI_MODEL_LIVE } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "knowledge_docs";
const DOCUMENT_TYPES = new Set(["framework", "cv", "summary"]);

function cleanName(raw: string): string {
  return raw.replace(/[\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

async function extractCandidateName(cvText: string): Promise<string | null> {
  try {
    const msg = await openai.messages.create({
      model: OPENAI_MODEL_LIVE,
      max_tokens: 30,
      system:
        "Extract the candidate's full name from this CV. Reply with ONLY the name - no labels, no punctuation. If you cannot find a name, reply exactly: UNKNOWN",
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
    const account = requireRequestScope();
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const rawDocType = (form.get("doc_type") as string) || "framework";
    const docType = DOCUMENT_TYPES.has(rawDocType) ? rawDocType : null;
    const qpSession = new URL(req.url).searchParams.get("sessionId") || "";
    const rawSessionId = qpSession || ((form.get("sessionId") as string) || "");
    const sessionId = rawSessionId ? storageSegment(rawSessionId) : null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!docType) {
      return NextResponse.json({ error: "Unsupported document type" }, { status: 400 });
    }
    if (rawSessionId && !sessionId) {
      return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
    }

    const arrayBuf = await file.arrayBuffer();
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

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
      if (text.trim()) detectedName = await extractCandidateName(text);
    }

    const timestamp = Date.now();
    const fileSafe = `${timestamp}-${file.name
      .replace(/[^a-z0-9.-]/gi, "_")
      .toLowerCase()}`;

    // Frameworks are reusable -> global. CVs and summaries are SESSION-SCOPED,
    // so a previous interview's CV can never bleed into a new call.
    let storagePath: string;
    if (docType === "framework") {
      storagePath = `users/${account.userId}/framework/global/${fileSafe}`;
    } else {
      const scope = sessionId
        ? `users/${account.userId}/session/${sessionId}`
        : `users/${account.userId}/session/_legacy`;
      storagePath = `${scope}/${docType}/${fileSafe}`;
    }

    const { error: uploadError } = await supabaseService.storage
      .from(BUCKET)
      .upload(storagePath, file);
    if (uploadError) throw uploadError;

    return NextResponse.json({
      ok: true,
      source: file.name,
      doc_type: docType,
      sessionId,
      candidate: docType === "cv" ? detectedName : null,
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
