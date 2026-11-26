import "server-only";
import { createHash } from "node:crypto";
import { supabaseService } from "@/lib/supabase";
import { resolveRecordScope } from "@/lib/record-scope";
import { setAppConfigValue } from "@/lib/app-config";
import { APPROVED_DOCUMENTS, APPROVED_DOCUMENT_BUCKET, AUTO_DRAFT_CONFIG, DOCUMENT_CONFIG_PREFIX, MAX_APPROVED_DOCUMENT_BYTES, isApprovedDocumentKey, type ApprovedDocument, type ApprovedDocumentKey } from "@/lib/approved-document-policy";

export async function loadApprovedDocuments() {
  const scope = await resolveRecordScope();
  const result = await supabaseService.from("app_config").select("key,value")
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("visibility", "private")
    .in("key", [AUTO_DRAFT_CONFIG, ...Object.keys(APPROVED_DOCUMENTS).map(k => DOCUMENT_CONFIG_PREFIX + k)]);
  if (result.error) throw result.error;
  const documents: ApprovedDocument[] = [];
  for (const row of result.data || []) {
    if (row.key === AUTO_DRAFT_CONFIG) continue;
    try {
      const value = JSON.parse(row.value || "null");
      if (value && isApprovedDocumentKey(value.key) && row.key === DOCUMENT_CONFIG_PREFIX + value.key &&
        value.path === approvedDocumentPath(scope.userId, scope.workspaceId, value.key, value.version)) documents.push(value);
    } catch { throw new Error("An approved document record needs review in Documents"); }
  }
  return { documents, autoDrafts: result.data?.find(r => r.key === AUTO_DRAFT_CONFIG)?.value === "true" };
}

export function approvedDocumentPath(userId: string, workspaceId: string, key: ApprovedDocumentKey, version: string) {
  if (!/^[0-9a-f-]{36}$/i.test(version)) throw new Error("Invalid document version");
  return `users/${userId}/approved/${workspaceId}/${key}/${version}.pdf`;
}

export async function approvedDocumentBytes(document: ApprovedDocument) {
  const scope = await resolveRecordScope();
  if (!isApprovedDocumentKey(document.key) || document.path !== approvedDocumentPath(scope.userId, scope.workspaceId, document.key, document.version))
    throw new Error("Document access is not permitted");
  if (!Number.isSafeInteger(document.size) || document.size < 5 || document.size > MAX_APPROVED_DOCUMENT_BYTES)
    throw new Error("The approved PDF is too large or invalid");
  const result = await supabaseService.storage.from(APPROVED_DOCUMENT_BUCKET).download(document.path);
  if (result.error || !result.data) throw new Error("The approved PDF could not be loaded");
  if (result.data.size !== document.size) throw new Error("The approved PDF changed. Upload it again in Documents");
  const bytes = Buffer.from(await result.data.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== "%PDF-" || createHash("sha256").update(bytes).digest("hex") !== document.sha256)
    throw new Error("The approved PDF did not match its saved version");
  return bytes;
}

export async function approveUploadedDocument(input: { key: ApprovedDocumentKey; version: string; name: string; size: number }) {
  const scope = await resolveRecordScope();
  const path = approvedDocumentPath(scope.userId, scope.workspaceId, input.key, input.version);
  const result = await supabaseService.storage.from(APPROVED_DOCUMENT_BUCKET).download(path);
  if (result.error || !result.data) throw new Error("The upload was not confirmed. Check Documents before trying again");
  if (result.data.size !== input.size || input.size < 5 || input.size > MAX_APPROVED_DOCUMENT_BYTES) throw new Error("Choose a PDF up to 10 MB");
  const bytes = Buffer.from(await result.data.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Choose a valid PDF document");
  const document: ApprovedDocument = { ...input, path, sha256: createHash("sha256").update(bytes).digest("hex"), approvedAt: new Date().toISOString() };
  await setAppConfigValue({ key: DOCUMENT_CONFIG_PREFIX + input.key, value: JSON.stringify(document), visibility: "private" });
  return document;
}
