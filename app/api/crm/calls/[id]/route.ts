import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { requireRequestScope } from "@/lib/request-scope";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { loadSharedCallAccess } from "@/lib/shared-call-access";

export const runtime = "nodejs";
// Live CRM data: without force-dynamic Next caches this GET response and
// keeps serving a stale snapshot even after the database has changed (a
// recovered call stayed invisible on the client page for exactly this reason).
export const dynamic = "force-dynamic";

// GET /api/crm/calls/:id -> one call's full scorecard, for the call-detail view.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scope = requireRequestScope();
    const { data: ownedCall, error } = await supabaseAdmin
      .from("interview_summaries")
      .select("id, candidate, role, company_id, created_at, cost, summary, session_id, ref")
      .eq("id", params.id)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .maybeSingle();
    if (error) throw error;
    let call: any = ownedCall;
    let sharedAccess: Awaited<ReturnType<typeof loadSharedCallAccess>> = null;
    if (!call) {
      const { data: candidate, error: candidateError } = await supabaseService
        .from("interview_summaries")
        .select("id, candidate, role, company_id, created_at, cost, summary, session_id, ref")
        .eq("id", params.id)
        .eq("workspace_id", scope.workspaceId)
        .maybeSingle();
      if (candidateError) throw candidateError;
      if (candidate?.session_id) {
        sharedAccess = await loadSharedCallAccess({
          workspaceId: scope.workspaceId,
          userId: scope.userId,
          sessionId: candidate.session_id,
        });
      }
      if (sharedAccess) call = candidate;
    }
    if (!call) {
      return NextResponse.json({ error: "call not found" }, { status: 404 });
    }

    let company: string | null = null;
    let companyInternal = false;
    if (call?.company_id) {
      const access = await loadAssignedClientAccess(call.company_id, scope);
      if (!access && !sharedAccess) {
        return NextResponse.json(
          { error: "The linked company is not available to your account" },
          { status: 403 }
        );
      }
      if (access) company = access.company.name || null;
      if (!company && sharedAccess) {
        const { data: sharedCompany } = await supabaseService
          .from("companies")
          .select("name")
          .eq("workspace_id", scope.workspaceId)
          .eq("id", call.company_id)
          .maybeSingle();
        company = sharedCompany?.name || null;
      }
      if (access?.mode === "owner") {
        const { data: owned } = await supabaseAdmin
          .from("companies")
          .select("profile")
          .eq("id", call.company_id)
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .maybeSingle();
        companyInternal = (owned?.profile as any)?.internal === true;
      }
    }

    // Richer call-event data from interview_sessions (the call record linked by
    // session_id): how long it ran, how much was said, and who was on it.
    let durationSeconds: number | null = null;
    let transcriptChars: number | null = null;
    let participants: string[] = [];
    if (call?.session_id) {
      const { data: ownedSession } = await supabaseAdmin
        .from("interview_sessions")
        .select("started_at, ended_at, transcript")
        .eq("session_id", call.session_id)
        .eq("workspace_id", scope.workspaceId)
        .eq("owner_id", scope.userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let sess: any = ownedSession;
      if (!sess) {
        sharedAccess =
          sharedAccess ||
          (await loadSharedCallAccess({
            workspaceId: scope.workspaceId,
            userId: scope.userId,
            sessionId: call.session_id,
          }));
        if (sharedAccess) {
          const { data: sharedSession, error: sharedSessionError } =
            await supabaseService
              .from("interview_sessions")
              .select("started_at, ended_at, transcript")
              .eq("workspace_id", scope.workspaceId)
              .eq("owner_id", (sharedAccess.capture as any).owner_id)
              .eq("session_id", call.session_id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
          if (sharedSessionError) throw sharedSessionError;
          sess = sharedSession;
        }
      }
      if (sess) {
        if (sess.started_at && sess.ended_at) {
          const ms =
            new Date(sess.ended_at as string).getTime() -
            new Date(sess.started_at as string).getTime();
          if (ms > 0) durationSeconds = Math.round(ms / 1000);
        }
        if (typeof sess.transcript === "string") {
          transcriptChars = sess.transcript.length;
          // Participants = the distinct speaker labels at line starts
          // ("Name: ..."). Keeps it grounded in what was actually said.
          const names = new Set<string>();
          for (const line of sess.transcript.split("\n")) {
            const m = line.match(/^\s*([A-Za-z][\w .'-]{0,40}?):\s/);
            if (m) names.add(m[1].trim());
          }
          participants = Array.from(names).slice(0, 12);
        }
      }
    }

    // Fall back to the AI-extracted contributors if the transcript had no clear
    // speaker labels.
    if (participants.length === 0 && Array.isArray((call?.summary as any)?.contributors)) {
      participants = (call!.summary as any).contributors
        .map((c: any) => (typeof c?.name === "string" ? c.name.trim() : ""))
        .filter(Boolean)
        .slice(0, 12);
    }

    return NextResponse.json({
      call: {
        ...call,
        company,
        companyInternal,
        durationSeconds,
        transcriptChars,
        participants,
        sharedCall: sharedAccess
          ? {
              accessRole: (sharedAccess.access as any).access_role,
              hostOwnerId: (sharedAccess.capture as any).host_owner_id,
            }
          : null,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "call not found" },
      { status: 404 }
    );
  }
}
