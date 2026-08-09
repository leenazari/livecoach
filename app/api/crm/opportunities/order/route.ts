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

    // The database function replaces the whole snapshot atomically. A failed
    // insert therefore rolls the delete back instead of losing the old order.
    const { data: savedCount, error } = await supabaseAdmin.rpc(
      "replace_company_priority",
      { p_order: order }
    );
    if (error) throw error;
    if (Number(savedCount) !== order.length)
      throw new Error("database did not confirm the full opportunity order");

    return NextResponse.json({ ok: true, count: Number(savedCount) });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to save order" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const { data: savedCount, error } = await supabaseAdmin.rpc(
      "replace_company_priority",
      { p_order: [] }
    );
    if (error) throw error;
    if (Number(savedCount) !== 0)
      throw new Error("database did not confirm the order reset");
    return NextResponse.json({ ok: true, count: 0 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "failed to clear order" },
      { status: 500 }
    );
  }
}
