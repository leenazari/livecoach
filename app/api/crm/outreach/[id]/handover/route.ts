import { NextRequest, NextResponse } from "next/server";
import {
  ensureOutreachCompany,
  getOutreachHandoverPreview,
} from "@/lib/outreach-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const handover = await getOutreachHandoverPreview(params.id);
    if (!handover)
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    return NextResponse.json(
      { handover },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to check the CRM handover" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const approvedCompanyId =
      typeof body.companyId === "string" ? body.companyId.trim() : "";
    const approveCreate = body.createNew === true;
    if (!approvedCompanyId && !approveCreate) {
      return NextResponse.json(
        { error: "Choose an existing company or approve a new CRM profile" },
        { status: 400 }
      );
    }
    const handover = await ensureOutreachCompany(params.id, "interested", {
      ...(approvedCompanyId ? { approvedCompanyId } : {}),
      approveCreate,
    });
    if (!handover?.companyId || handover.requiresReview) {
      return NextResponse.json(
        { error: "The CRM identity still needs review" },
        { status: 409 }
      );
    }
    return NextResponse.json({
      ok: true,
      companyId: handover.companyId,
      contactId: handover.contactId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to complete the CRM handover" },
      { status: 500 }
    );
  }
}
