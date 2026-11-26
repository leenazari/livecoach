import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";
import { setAppConfigValue } from "@/lib/app-config";
import { approvedDocumentPath, approveUploadedDocument, loadApprovedDocuments } from "@/lib/approved-documents";
import { APPROVED_DOCUMENT_BUCKET, AUTO_DRAFT_CONFIG, MAX_APPROVED_DOCUMENT_BYTES, isApprovedDocumentKey } from "@/lib/approved-document-policy";
import { crmBlockerPayload } from "@/lib/crm-blocker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function blocked() {
  return NextResponse.json(crmBlockerPayload({ code: "approved_document_not_confirmed", title: "Document action not confirmed", reason: "LiveCoach could not confirm access or save the approved PDF", nextAction: "Refresh Documents to check the current version before uploading again", responsible: "system" }), { status: 502 });
}
export async function GET() {
  try { requireRequestScope(); return NextResponse.json(await loadApprovedDocuments(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return blocked(); }
}
export async function PATCH(req: NextRequest) {
  try {
    requireRequestScope();
    const body = await req.json();
    if (typeof body.autoDrafts !== "boolean") return NextResponse.json({ error: "Choose whether automatic drafts are enabled" }, { status: 400 });
    await setAppConfigValue({ key: AUTO_DRAFT_CONFIG, value: JSON.stringify({ enabled: body.autoDrafts, enabledSince: new Date().toISOString() }), visibility: "private" });
    return NextResponse.json({ ok: true, autoDrafts: body.autoDrafts });
  } catch { return blocked(); }
}
export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    if (!isApprovedDocumentKey(body.key) || typeof body.name !== "string" || !body.name.toLowerCase().endsWith(".pdf") ||
      !Number.isSafeInteger(body.size) || body.size < 5 || body.size > MAX_APPROVED_DOCUMENT_BYTES)
      return NextResponse.json({ error: "Choose a document type and a PDF up to 10 MB" }, { status: 400 });
    const name = body.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160);
    if (body.action === "prepare") {
      const version = randomUUID();
      const path = approvedDocumentPath(scope.userId, scope.workspaceId, body.key, version);
      const result = await supabaseService.storage.from(APPROVED_DOCUMENT_BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (result.error || !result.data) return blocked();
      return NextResponse.json({ ok: true, version, path, token: result.data.token, bucket: APPROVED_DOCUMENT_BUCKET });
    }
    if (body.action !== "approve" || typeof body.version !== "string" || !/^[0-9a-f-]{36}$/i.test(body.version))
      return NextResponse.json({ error: "Choose a valid upload to approve" }, { status: 400 });
    const document = await approveUploadedDocument({ key: body.key, version: body.version, name, size: body.size });
    return NextResponse.json({ ok: true, document });
  } catch { return blocked(); }
}
