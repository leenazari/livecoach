import { bookInterviewerMeeting, suggestInterviewerMeetings } from "@/lib/interviewer/booking";
import { interviewerJson, interviewerPublicError, readJson } from "@/lib/interviewer/http";
import { linkedSession } from "@/lib/interviewer/queue-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const linked = await linkedSession(String(body.token || ""), String(body.sessionId || ""));
    if (!linked?.campaign) return interviewerJson({ error: "This link is not available." }, 404);
    if (linked.session.ended_at && body.action !== "suggest") {
      return interviewerJson({ booked: false, note: "This conversation has already finished." });
    }

    if (body.action === "book") {
      try {
        const result = await bookInterviewerMeeting({
          sessionId: linked.session.id,
          ownerId: linked.campaign.owner_id,
          workspaceId: linked.campaign.workspace_id,
          campaignName: linked.campaign.name,
          prospectName: linked.invite.prospect_name,
          prospectEmail: linked.invite.prospect_email,
          start: String(body.start || ""),
          end: String(body.end || ""),
        });
        return interviewerJson(result);
      } catch (error) {
        console.error("interviewer book failed", {
          message: error instanceof Error ? error.message.slice(0, 180) : "unknown",
        });
        return interviewerJson({
          booked: false,
          note: "The connected calendar could not reserve that time. No second meeting was attempted.",
        });
      }
    }

    const suggestion = await suggestInterviewerMeetings({
      ownerId: linked.campaign.owner_id,
      workspaceId: linked.campaign.workspace_id,
      durationMinutes: Number(body.durationMinutes || body.duration_minutes || 30),
      timeOfDay: typeof body.timeOfDay === "string" ? body.timeOfDay : typeof body.time_of_day === "string" ? body.time_of_day : "any",
      fromDate: typeof body.fromDate === "string" ? body.fromDate : typeof body.from_date === "string" ? body.from_date : null,
      toDate: typeof body.toDate === "string" ? body.toDate : typeof body.to_date === "string" ? body.to_date : null,
    });
    return interviewerJson(suggestion);
  } catch (error) {
    return interviewerPublicError(error);
  }
}
