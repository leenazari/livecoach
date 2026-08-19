import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { processDocumentJob } from "@/lib/document-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { data: job, error } = await supabaseAdmin
      .from("document_jobs")
      .select("id, status, updated_at")
      .eq("id", params.id)
      .maybeSingle();
    if (error) throw error;
    if (!job)
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (job.status === "complete") return NextResponse.json({ ok: true, status: "complete" });
    const stale =
      job.status === "processing" || job.status === "quality_check"
        ? Date.now() - new Date(job.updated_at).getTime() > 3 * 60 * 1000
        : false;
    if (!["failed", "queued"].includes(job.status) && !stale)
      return NextResponse.json({ ok: true, status: job.status }, { status: 202 });
    if (job.status !== "queued") {
      const { error: resetError } = await supabaseAdmin
        .from("document_jobs")
        .update({
          status: "queued",
          progress: 0,
          stage_label: "Queued for another attempt",
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("status", job.status);
      if (resetError) throw resetError;
    }
    const processing = processDocumentJob(job.id).catch((processingError) =>
      console.error("Background document retry failed", processingError)
    );
    waitUntil(processing);
    return NextResponse.json({ ok: true, status: "queued" }, { status: 202 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not retry the document" },
      { status: 500 }
    );
  }
}
