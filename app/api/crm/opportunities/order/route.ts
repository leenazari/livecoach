import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
// Mutating methods on a route that would otherwise be static must be dynamic,
// or they 405 at the edge (the static-route lesson).
export const dynamic = "force-dynamic";

// Lee's manual order for the opportunity board. POST a full ordered list of
// companyIds to pin the order (it then wins over the coach's ranking). DELETE to
// clear it and fall back to the coach's order. We store a full snapshot, so the
// board reads positions directly.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const order: string[] = Array.isArray(body.order)
      ? body.order.filter((x: any) => typeof x === "string" && x)
      : [];
    if (!order.length) {
      return NextResponse.json({ error: "no order given" }, { status: 400 });
    }

    // Replace the whole snapshot so positions always reflect the latest drag.
    await supabaseAdmin
      .from("company_priority")
      .delete()
      .not("company_id", "is", null);

    const rows = order.map((companyId, i) => ({
      company_id: companyId,
      position: i,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabaseAdmin.from("company_priority").insert(rows);
    if (error) throw error;

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to save order" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await supabaseAdmin
      .from("company_priority")
      .delete()
      .not("company_id", "is", null);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to clear order" },
      { status: 500 }
    );
  }
}
