import { NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { approvedDocumentBytes, loadApprovedDocuments } from "@/lib/approved-documents";
import { isApprovedDocumentKey } from "@/lib/approved-document-policy";

export async function GET(_req: Request, { params }: { params: { key: string } }) {
  try {
    requireRequestScope();
    if (!isApprovedDocumentKey(params.key)) return NextResponse.json({ error: "Choose an approved document" }, { status: 400 });
    const document = (await loadApprovedDocuments()).documents.find(d => d.key === params.key);
    if (!document) return NextResponse.json({ error: "Upload this document first" }, { status: 404 });
    const bytes = await approvedDocumentBytes(document);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`, "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "The approved PDF could not be opened. Refresh Documents and check its current version" }, { status: 502 }); }
}
