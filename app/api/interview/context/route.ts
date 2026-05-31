import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

// Loads ALL knowledge for a session ONCE at start:
//   - the candidate's CV + previous summary (scoped by name)
//   - every global question framework (candidate IS NULL)
// The client holds this and passes it to /suggest each call, where it
// rides in a CACHED system block — so we don't re-search or re-send-at-full-price
// every 5 seconds. This is the single biggest cost lever for the live loop.
export async function POST(req: NextRequest) {
  try {
    const { candidate } = await req.json();

    let query = supabaseAdmin
      .from("knowledge_docs")
      .select("content, doc_type, source, candidate")
      .order("doc_type", { ascending: true });

    // candidate docs + global frameworks
    if (candidate) {
      query = query.or(`candidate.eq.${candidate},candidate.is.null`);
    } else {
      query = query.is("candidate", null);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const sources = Array.from(
      new Set(rows.map((r) => `${r.source} (${r.doc_type})`))
    );

    // Group into labelled sections so Claude knows what it's reading.
    const byType: Record<string, string[]> = {};
    for (const r of rows) {
      (byType[r.doc_type] ||= []).push(r.content);
    }

    const labels: Record<string, string> = {
      cv: "CANDIDATE CV",
      summary: "PREVIOUS INTERVIEW SUMMARY",
      framework: "QUESTION FRAMEWORK",
    };

    const context = Object.entries(byType)
      .map(([type, chunks]) => `### ${labels[type] || type.toUpperCase()}\n${chunks.join("\n")}`)
      .join("\n\n");

    return NextResponse.json({
      context: context || "No knowledge base documents found for this session.",
      sources,
      chunkCount: rows.length,
    });
  } catch (err: any) {
    console.error("Context load error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load context" },
      { status: 500 }
    );
  }
}
