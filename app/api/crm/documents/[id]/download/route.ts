import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { userStoragePrefix } from "@/lib/storage-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const { data: job, error } = await supabaseAdmin
      .from("document_jobs")
      .select("owner_id, status, file_bucket, file_path, file_name")
      .eq("id", params.id)
      .maybeSingle();
    if (error) throw error;
    if (!job)
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (job.status !== "complete" || !job.file_bucket || !job.file_path)
      return NextResponse.json({ error: "Document is not ready yet" }, { status: 409 });
    if (
      job.owner_id !== account.userId ||
      !job.file_path.startsWith(userStoragePrefix(account.userId))
    ) {
      return NextResponse.json({ error: "Document access is not permitted" }, { status: 403 });
    }
    const { data, error: signedError } = await supabaseService.storage
      .from(job.file_bucket)
      .createSignedUrl(job.file_path, 60, { download: job.file_name || true });
    if (signedError || !data?.signedUrl)
      throw signedError || new Error("Could not create the private download link");
    return NextResponse.redirect(data.signedUrl, 302);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not download the document" },
      { status: 500 }
    );
  }
}
