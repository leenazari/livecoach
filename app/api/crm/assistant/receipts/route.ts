import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  formatBrainActionReceipt,
  normaliseBrainActionReceiptResults,
} from "@/lib/brain-action-receipts";
import { brainActionSignature } from "@/lib/brain-action-signatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Persist the outcome separately from the proposed action. The underlying CRM
// write has already returned successfully (or failed) before this is called, so
// the receipt is an honest audit trail and never claims that a proposed change
// happened merely because the Brain described it.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const results = normaliseBrainActionReceiptResults(body?.results);
    if (!results.length)
      return NextResponse.json(
        { error: "No action results were supplied" },
        { status: 400 }
      );

    const companyId =
      typeof body?.companyId === "string" &&
      /^[0-9a-f-]{36}$/i.test(body.companyId)
        ? body.companyId
        : null;
    const content = formatBrainActionReceipt(results, body?.screenLabel);
    const actionSignatures = results
      .filter((result) => result.action?.type)
      .map((result) => ({
        ...brainActionSignature(result.action),
        outcome: result.status,
      }));
    const { data, error } = await supabaseAdmin
      .from("assistant_messages")
      .insert({
        company_id: companyId,
        role: "assistant",
        content,
        action_sigs: actionSignatures.length ? actionSignatures : null,
      })
      .select("id,role,content,created_at")
      .single();
    if (error) throw error;
    if (!data || data.content !== content)
      throw new Error("The database did not confirm the action receipt");

    return NextResponse.json({ receipt: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not record the Brain action receipt" },
      { status: 500 }
    );
  }
}
