import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { extractTextFromPDF } from "@/lib/pdf-extract";

export const runtime = "nodejs";
export const maxDuration = 60;

// Load all knowledge docs from Supabase storage for a session.
// Reads files, extracts text (PDF or plain text), concatenates and returns.
// Client holds this context and passes it to /suggest, where it rides in a
// cached system block.
export async function POST(req: NextRequest) {
  try {
    const { candidate } = await req.json();

    let allContent = "";
    const sources: string[] = [];

    // Load global framework docs
    const { data: globalFiles, error: globalError } = await supabaseAdmin.storage
      .from("knowledge_docs")
      .list("framework/global", { limit: 100 });

    if (!globalError && globalFiles) {
      for (const file of globalFiles) {
        if (file.name.startsWith(".")) continue;

        const { data: fileData, error: readError } = await supabaseAdmin.storage
          .from("knowledge_docs")
          .download(`framework/global/${file.name}`);

        if (readError || !fileData) continue;

        let text = "";
        if (file.name.endsWith(".pdf")) {
          const buffer = Buffer.from(await fileData.arrayBuffer());
          text = await extractTextFromPDF(buffer);
        } else {
          text = await fileData.text();
        }

        allContent += `### QUESTION FRAMEWORK (${file.name})\n${text}\n\n`;
        sources.push(`${file.name} (framework)`);
      }
    }

    // Load candidate-specific docs (CV, summaries)
    if (candidate) {
      // CV docs
      const { data: cvFiles } = await supabaseAdmin.storage
        .from("knowledge_docs")
        .list(`cv/${candidate}`, { limit: 100 });

      if (cvFiles) {
        for (const file of cvFiles) {
          if (file.name.startsWith(".")) continue;

          const { data: fileData, error: readError } = await supabaseAdmin.storage
            .from("knowledge_docs")
            .download(`cv/${candidate}/${file.name}`);

          if (readError || !fileData) continue;

          let text = "";
          if (file.name.endsWith(".pdf")) {
            const buffer = Buffer.from(await fileData.arrayBuffer());
            text = await extractTextFromPDF(buffer);
          } else {
            text = await fileData.text();
          }

          allContent += `### CANDIDATE CV (${file.name})\n${text}\n\n`;
          sources.push(`${file.name} (cv)`);
        }
      }

      // Summary docs
      const { data: summaryFiles } = await supabaseAdmin.storage
        .from("knowledge_docs")
        .list(`summary/${candidate}`, { limit: 100 });

      if (summaryFiles) {
        for (const file of summaryFiles) {
          if (file.name.startsWith(".")) continue;

          const { data: fileData, error: readError } = await supabaseAdmin.storage
            .from("knowledge_docs")
            .download(`summary/${candidate}/${file.name}`);

          if (readError || !fileData) continue;

          let text = "";
          if (file.name.endsWith(".pdf")) {
            const buffer = Buffer.from(await fileData.arrayBuffer());
            text = await extractTextFromPDF(buffer);
          } else {
            text = await fileData.text();
          }

          allContent += `### PREVIOUS SUMMARY (${file.name})\n${text}\n\n`;
          sources.push(`${file.name} (summary)`);
        }
      }
    }

    return NextResponse.json({
      context:
        allContent || "No knowledge base documents found for this session.",
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
