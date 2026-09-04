import { NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin, supabaseService } from "@/lib/supabase";
import { loadSharedCallAccess } from "@/lib/shared-call-access";
import {
  parseTranscriptDownloadId,
  renderTranscriptDownload,
  transcriptDownloadFilename,
} from "@/lib/call-transcript-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const speakersFromTranscript = (transcript: string) => {
  const speakers = new Set<string>();
  for (const line of transcript.split("\n")) {
    const match = line.match(/^\s*([A-Za-z][\w .'-]{0,40}?):\s/);
    if (match) speakers.add(match[1].trim());
  }
  return Array.from(speakers).slice(0, 20);
};

// Downloads the exact canonical transcript stored for one visible call. The
// route does not summarise, rewrite, duplicate or persist the transcript.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    const requested = parseTranscriptDownloadId(params.id);
    if (!requested) {
      return NextResponse.json({ error: "Invalid call reference" }, { status: 400 });
    }

    let sessionId = requested.kind === "session" ? requested.id : "";
    let title = "Call";
    let companyId: string | null = null;
    let recordedAt: string | null = null;
    let sharedAccess: Awaited<ReturnType<typeof loadSharedCallAccess>> = null;

    if (requested.kind === "summary") {
      const { data: ownedSummary, error: summaryError } = await supabaseAdmin
        .from("interview_summaries")
        .select("id,session_id,candidate,company_id,created_at,summary")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .eq("id", requested.id)
        .maybeSingle();
      if (summaryError) throw summaryError;
      let summary: any = ownedSummary;
      if (!summary) {
        const { data: candidate, error: candidateError } = await supabaseService
          .from("interview_summaries")
          .select("id,session_id,candidate,company_id,created_at,summary")
          .eq("workspace_id", account.workspaceId)
          .eq("id", requested.id)
          .maybeSingle();
        if (candidateError) throw candidateError;
        if (candidate?.session_id) {
          sharedAccess = await loadSharedCallAccess({
            workspaceId: account.workspaceId,
            userId: account.userId,
            sessionId: candidate.session_id,
          });
        }
        if (sharedAccess) summary = candidate;
      }
      if (!summary) {
        return NextResponse.json({ error: "Call not found" }, { status: 404 });
      }
      sessionId = String(summary.session_id || "").trim();
      title =
        (summary.summary as any)?.title || summary.candidate || "Call";
      companyId = summary.company_id || null;
      recordedAt = summary.created_at || null;
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: "No transcript was saved for this call" },
        { status: 404 }
      );
    }

    const { data: ownedSession, error: sessionError } = await supabaseAdmin
      .from("interview_sessions")
      .select("session_id,candidate,company_id,created_at,ended_at,transcript")
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sessionError) throw sessionError;
    let session: any = ownedSession;
    if (!session) {
      sharedAccess =
        sharedAccess ||
        (await loadSharedCallAccess({
          workspaceId: account.workspaceId,
          userId: account.userId,
          sessionId,
        }));
      if (sharedAccess) {
        const { data: sharedSession, error: sharedSessionError } =
          await supabaseService
            .from("interview_sessions")
            .select("session_id,candidate,company_id,created_at,ended_at,transcript")
            .eq("workspace_id", account.workspaceId)
            .eq("owner_id", (sharedAccess.capture as any).owner_id)
            .eq("session_id", sessionId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        if (sharedSessionError) throw sharedSessionError;
        session = sharedSession;
      }
    }
    const transcript =
      typeof session?.transcript === "string" ? session.transcript : "";
    if (!session || !transcript.trim()) {
      return NextResponse.json(
        { error: "No transcript was saved for this call" },
        { status: 404 }
      );
    }

    if (
      !sharedAccess &&
      companyId &&
      session.company_id &&
      companyId !== session.company_id
    ) {
      return NextResponse.json(
        { error: "The call and transcript links do not match" },
        { status: 409 }
      );
    }
    companyId = companyId || session.company_id || null;
    title = title === "Call" ? session.candidate || title : title;
    recordedAt = recordedAt || session.ended_at || session.created_at || null;

    let company: string | null = null;
    if (companyId) {
      const { data } = sharedAccess
        ? await supabaseService
            .from("companies")
            .select("name")
            .eq("workspace_id", account.workspaceId)
            .eq("id", companyId)
            .maybeSingle()
        : await supabaseAdmin
        .from("companies")
        .select("name")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .eq("id", companyId)
        .maybeSingle();
      company = data?.name || null;
    }

    const content = renderTranscriptDownload({
      title,
      company,
      recordedAt,
      participants: speakersFromTranscript(transcript),
      transcript,
    });
    const filename = transcriptDownloadFilename(company || title, recordedAt);
    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    const message = error?.message || "Could not download the transcript";
    const status = message.includes("verified workspace access") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
