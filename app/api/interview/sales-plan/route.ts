import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { crmBlockerPayload } from "@/lib/crm-blocker";
import {
  ADAM_SCRIPT,
  cleanProducts,
  cleanStage,
  nextTimeline,
} from "@/lib/sales-call-script";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(status: number, reason: string) {
  return NextResponse.json(
    crmBlockerPayload({
      code: "call_script_save",
      title: "Call preparation not confirmed",
      reason,
      nextAction:
        "Keep this page open and check the saved preparation before continuing",
      responsible: "system",
    }),
    { status },
  );
}
function key(value: unknown) {
  const v = String(value || "unscheduled");
  if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(v))
    throw new Error("Invalid preparation reference");
  return v;
}
export async function GET(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const contextKey = key(req.nextUrl.searchParams.get("key"));
    const companyId = req.nextUrl.searchParams.get("companyId");
    if (
      companyId &&
      (!UUID.test(companyId) ||
        !(await loadAssignedClientAccess(companyId, scope)))
    )
      return fail(404, "This client is not available to your account");
    const [plan, interests, last] = await Promise.all([
      supabaseAdmin
        .from("call_script_plans")
        .select("*")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("context_key", contextKey)
        .maybeSingle(),
      companyId
        ? supabaseService
            .from("client_product_interests")
            .select("products,updated_at")
            .eq("workspace_id", scope.workspaceId)
            .eq("company_id", companyId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabaseService
        .from("script_call_coaching")
        .select("report")
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .eq("state", "ready")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    for (const result of [plan, interests, last])
      if (result.error) throw result.error;
    const draftKey = req.nextUrl.searchParams.get("draftKey");
    const seedResult =
      !plan.data && draftKey
        ? await supabaseAdmin
            .from("call_script_plans")
            .select("*")
            .eq("workspace_id", scope.workspaceId)
            .eq("owner_id", scope.userId)
            .eq("context_key", key(draftKey))
            .maybeSingle()
        : { data: null, error: null };
    if (seedResult.error) throw seedResult.error;
    const seed = plan.data || seedResult.data;
    const clientNewer =
      interests.data?.updated_at &&
      (!seed || interests.data.updated_at > seed.updated_at);
    return NextResponse.json(
      {
        plan: plan.data,
        seedPlan: seed,
        products: cleanProducts(
          clientNewer
            ? interests.data?.products
            : (seed?.products ?? interests.data?.products),
        ),
        improvement: last.data?.report?.nextCallFocus || null,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return fail(500, "The saved preparation could not be loaded");
  }
}
export async function POST(req: NextRequest) {
  try {
    const scope = requireRequestScope();
    const body = await req.json();
    const contextKey = key(body.key);
    const companyId = body.companyId || null;
    if (
      companyId &&
      (!UUID.test(companyId) ||
        !(await loadAssignedClientAccess(companyId, scope)))
    )
      return fail(404, "This client is not available to your account");
    const sessionId = body.sessionId || null;
    if (sessionId && !/^lc-[a-zA-Z0-9-]{6,100}$/.test(sessionId))
      return fail(400, "The call reference is invalid");
    const { data: previous, error: readError } = await supabaseAdmin
      .from("call_script_plans")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("context_key", contextKey)
      .maybeSingle();
    if (readError) throw readError;
    if (previous && body.expectedUpdatedAt !== previous.updated_at)
      return fail(
        409,
        "This preparation changed in another tab. Reopen it to see the latest saved version",
      );
    const products = cleanProducts(body.products);
    const stage = cleanStage(body.stage);
    const prep =
      body.prep && typeof body.prep === "object" && !Array.isArray(body.prep)
        ? body.prep
        : {};
    if (JSON.stringify(prep).length > 40000)
      return fail(400, "The saved call preparation is too long");
    const timeline = sessionId
      ? nextTimeline(
          Array.isArray(previous?.timeline) ? previous.timeline : [],
          {
            products,
            stage,
            elapsedSeconds: Math.max(
              0,
              Math.min(86400, Number(body.elapsedSeconds) || 0),
            ),
            transcriptChars: Math.max(
              0,
              Math.min(2000000, Number(body.transcriptChars) || 0),
            ),
          },
        )
      : [];
    const now = new Date().toISOString();
    const row = {
      workspace_id: scope.workspaceId,
      owner_id: scope.userId,
      context_key: contextKey,
      session_id: sessionId,
      company_id: companyId,
      products,
      stage,
      prep,
      script_snapshot: previous?.script_snapshot?.version
        ? previous.script_snapshot
        : products.includes("adam")
          ? ADAM_SCRIPT
          : {},
      timeline,
      updated_at: now,
    };
    const result = previous
      ? await supabaseAdmin
          .from("call_script_plans")
          .update(row)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .eq("context_key", contextKey)
          .eq("updated_at", previous.updated_at)
          .select("updated_at")
          .maybeSingle()
      : await supabaseAdmin
          .from("call_script_plans")
          .insert(row)
          .select("updated_at")
          .single();
    if (result.error) throw result.error;
    if (!result.data)
      return fail(
        409,
        "Another save changed this preparation. Reopen it to see the saved version",
      );
    let clientSaved = true;
    if (companyId && body.saveClientProducts === true) {
      const { error } = await supabaseService
        .from("client_product_interests")
        .upsert(
          {
            workspace_id: scope.workspaceId,
            company_id: companyId,
            products,
            updated_by: scope.userId,
            updated_at: now,
          },
          { onConflict: "workspace_id,company_id" },
        );
      clientSaved = !error;
    }
    return NextResponse.json({
      ok: true,
      updatedAt: result.data.updated_at,
      timeline,
      clientSaved,
      notice: clientSaved
        ? null
        : "Call preparation saved. The client product tags could not be confirmed; keep this page open and check the client record.",
    });
  } catch {
    return fail(
      500,
      "The preparation save could not be confirmed. Your on-screen draft is kept",
    );
  }
}
