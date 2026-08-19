import { randomUUID } from "crypto";
import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  DOCUMENT_TYPES,
  processDocumentJob,
  type DocumentType,
} from "@/lib/document-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const uuid = (value: unknown) =>
  typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const publicJob = (job: any) => ({
  id: job.id,
  companyId: job.company_id,
  taskId: job.task_id,
  documentType: job.document_type,
  title: job.title,
  status: job.status,
  progress: job.progress,
  stageLabel: job.stage_label,
  fileName: job.file_name,
  error: job.error,
  costGbp: job.cost_gbp == null ? null : Number(job.cost_gbp),
  createdAt: job.created_at,
  completedAt: job.completed_at,
  downloadUrl:
    job.status === "complete" && job.file_path
      ? `/api/crm/documents/${job.id}/download`
      : null,
});

const startBackgroundJob = (jobId: string) => {
  const processing = processDocumentJob(jobId).catch((processingError) =>
    console.error("Background document generation failed", processingError)
  );
  waitUntil(processing);
};

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("document_jobs")
      .select(
        "id, company_id, task_id, document_type, title, status, progress, stage_label, file_name, file_path, error, cost_gbp, created_at, completed_at"
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json(
      { jobs: (data || []).map(publicJob) },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not load documents" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title = text(body.title, 220);
    const instructions = text(body.instructions, 6000);
    const documentType = DOCUMENT_TYPES.includes(body.documentType as DocumentType)
      ? (body.documentType as DocumentType)
      : "other";
    const companyId = uuid(body.companyId);
    const taskId = uuid(body.taskId);
    const supersedesJobId = uuid(body.supersedesJobId);
    const idempotencyKey = text(body.idempotencyKey, 180) || randomUUID();
    if (!title || !instructions)
      return NextResponse.json(
        { error: "A document title and instructions are required" },
        { status: 400 }
      );

    if (companyId) {
      const { data: company, error } = await supabaseAdmin
        .from("companies")
        .select("id")
        .eq("id", companyId)
        .maybeSingle();
      if (error) throw error;
      if (!company)
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (taskId) {
      const { data: task, error } = await supabaseAdmin
        .from("tasks")
        .select("id, company_id, status")
        .eq("id", taskId)
        .maybeSingle();
      if (error) throw error;
      if (!task)
        return NextResponse.json({ error: "Source to-do not found" }, { status: 404 });
      if (companyId && task.company_id && task.company_id !== companyId)
        return NextResponse.json(
          { error: "The selected to-do belongs to a different client" },
          { status: 409 }
        );
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("document_jobs")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      if (existing.status === "queued") startBackgroundJob(existing.id);
      return NextResponse.json(
        { ok: true, job: publicJob(existing), existing: true },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const { data: job, error } = await supabaseAdmin
      .from("document_jobs")
      .insert({
        company_id: companyId,
        task_id: taskId,
        supersedes_job_id: supersedesJobId,
        idempotency_key: idempotencyKey,
        document_type: documentType,
        title,
        instructions,
        status: "queued",
        progress: 0,
        stage_label: "Queued",
      })
      .select("*")
      .single();
    if (error) {
      // The unique key is the final guard against two near-simultaneous taps.
      // Return the one canonical job instead of charging for a duplicate.
      if ((error as any).code === "23505") {
        const { data: duplicate, error: duplicateError } = await supabaseAdmin
          .from("document_jobs")
          .select("*")
          .eq("idempotency_key", idempotencyKey)
          .single();
        if (duplicateError) throw duplicateError;
        if (duplicate.status === "queued") startBackgroundJob(duplicate.id);
        return NextResponse.json(
          { ok: true, job: publicJob(duplicate), existing: true },
          { headers: { "Cache-Control": "no-store, max-age=0" } }
        );
      }
      throw error;
    }

    startBackgroundJob(job.id);
    return NextResponse.json(
      { ok: true, job: publicJob(job), existing: false },
      { status: 202, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not queue the document" },
      { status: 500 }
    );
  }
}
