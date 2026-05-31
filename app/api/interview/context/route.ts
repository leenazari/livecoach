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
    const { candidate } = await req.json();

    let context = "";
    const sources: string[] = [];

    // 1. Frameworks — always loaded for every session.
    const frameworks = await listFiles("framework/global");
    for (const f of frameworks) {
      if (!f.name || f.id === null) continue;
      const t = await downloadText(`framework/global/${f.name}`);
      if (t.trim()) {
        context += `### QUESTION FRAMEWORK (${f.name})\n${t}\n\n`;
        sources.push(`${f.name} (framework)`);
      }
    }

    // 2. CVs — tolerant: prefer candidate's folder, else most recent CV anywhere.
    const cvRoot = await listFiles("cv");
    const folders = cvRoot.filter((e) => e.id === null).map((e) => e.name);
    const directFiles = cvRoot.filter((e) => e.id !== null);

    const matchedFolder = candidate
      ? folders.find(
          (f) => f.toLowerCase() === String(candidate).toLowerCase()
        )
      : undefined;

    let chosenCvPaths: string[] = [];

    if (matchedFolder) {
      const files = await listFiles(`cv/${matchedFolder}`);
      chosenCvPaths = files
        .filter((f) => f.id !== null)
        .map((f) => `cv/${matchedFolder}/${f.name}`);
    } else {
      // Fallback: gather every CV across all folders, pick the most recent.
      const all: { path: string; created: string }[] = [];
      for (const folder of folders) {
        const files = await listFiles(`cv/${folder}`);
        for (const f of files) {
          if (f.id !== null) {
            all.push({
              path: `cv/${folder}/${f.name}`,
              created: (f as any).created_at || "",
            });
          }
        }
      }
      for (const f of directFiles) {
        all.push({
          path: `cv/${f.name}`,
          created: (f as any).created_at || "",
        });
      }
      all.sort((a, b) => (b.created > a.created ? 1 : -1));
      if (all.length) chosenCvPaths = [all[0].path];
    }

    for (const p of chosenCvPaths) {
      const t = await downloadText(p);
      if (t.trim()) {
        const name = p.split("/").pop();
        context += `### CANDIDATE CV (${name})\n${t}\n\n`;
        sources.push(`${name} (cv)`);
      }
    }

    // 3. Previous summary — only when we matched a specific candidate.
    if (matchedFolder) {
      const summaries = await listFiles(`summary/${matchedFolder}`);
      for (const f of summaries) {
        if (f.id === null) continue;
        const t = await downloadText(`summary/${matchedFolder}/${f.name}`);
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
