import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extractTextFromPDF } from "@/lib/pdf-extract";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "knowledge_docs";

async function listFiles(prefix: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(prefix, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
  if (error || !data) return [];
  return data;
}

async function downloadText(path: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(path);
  if (error || !data) return "";
  if (path.toLowerCase().endsWith(".pdf")) {
    try {
      const buf = new Uint8Array(await data.arrayBuffer());
      return await extractTextFromPDF(buf);
    } catch (e) {
      console.error("PDF extract failed:", path, e);
      return "";
    }
  }
  return await data.text();
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();

    let context = "";
    const sources: string[] = [];

    // 1. Frameworks - always (reusable, global).
    const frameworks = await listFiles("framework/global");
    for (const f of frameworks) {
      if (!f.name || f.id === null) continue;
      const t = await downloadText(`framework/global/${f.name}`);
      if (t.trim()) {
        context += `### QUESTION FRAMEWORK (${f.name})\n${t}\n\n`;
        sources.push(`${f.name} (framework)`);
      }
    }

    // 2. CV + summary - ONLY for this session. No global fallback, so an
    //    empty session loads no candidate context and cues stay generic.
    if (sessionId) {
      const cvs = await listFiles(`session/${sessionId}/cv`);
      for (const f of cvs) {
        if (!f.name || f.id === null) continue;
        const t = await downloadText(`session/${sessionId}/cv/${f.name}`);
        if (t.trim()) {
          context += `### CANDIDATE CV (${f.name})\n${t}\n\n`;
          sources.push(`${f.name} (cv)`);
        }
      }

      const summaries = await listFiles(`session/${sessionId}/summary`);
      for (const f of summaries) {
        if (!f.name || f.id === null) continue;
        const t = await downloadText(`session/${sessionId}/summary/${f.name}`);
        if (t.trim()) {
          context += `### PREVIOUS SUMMARY (${f.name})\n${t}\n\n`;
          sources.push(`${f.name} (summary)`);
        }
      }
    }

    return NextResponse.json({
      context,
      sources,
      chunkCount: sources.length,
    });
  } catch (err: any) {
    console.error("Context load error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load context" },
      { status: 500 }
    );
  }
}
