import { NextRequest, NextResponse } from "next/server";
import { requireRequestScope } from "@/lib/request-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { upsertTasks } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const account = requireRequestScope();
    if (!UUID.test(params.id))
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const action = typeof body.text === "string" ? body.text.trim() : "";
    const dueDate = typeof body.dueAt === "string" ? body.dueAt.trim() : "";
    if (!action)
      return NextResponse.json({ error: "Add the next action first" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
      return NextResponse.json({ error: "Choose a due date" }, { status: 400 });

    const { data: prospect, error: prospectError } = await supabaseAdmin
      .from("outreach_prospects")
      .select(
        "id,first_name,last_name,company_name,reply_category,last_reply_at,crm_company_id"
      )
      .eq("workspace_id", account.workspaceId)
      .eq("assigned_to_user_id", account.userId)
      .eq("id", params.id)
      .maybeSingle();
    if (prospectError) throw prospectError;
    if (!prospect)
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    if (prospect.reply_category !== "interested" || !prospect.last_reply_at) {
      return NextResponse.json(
        { error: "This prospect does not have an open positive reply" },
        { status: 409 }
      );
    }

    // A task may link only to a client this salesperson owns or has been
    // explicitly assigned. A historical team-visible row is not sufficient.
    let companyId: string | null = null;
    if (prospect.crm_company_id) {
      const [{ data: company }, { data: share }] = await Promise.all([
        supabaseAdmin
          .from("companies")
          .select("id,owner_id")
          .eq("workspace_id", account.workspaceId)
          .eq("id", prospect.crm_company_id)
          .maybeSingle(),
        supabaseAdmin
          .from("team_client_shares")
          .select("company_id")
          .eq("workspace_id", account.workspaceId)
          .eq("company_id", prospect.crm_company_id)
          .eq("assigned_to_user_id", account.userId)
          .eq("status", "active")
          .maybeSingle(),
      ]);
      if (company?.owner_id === account.userId || share?.company_id) {
        companyId = prospect.crm_company_id;
      }
    }

    const sourceRef = `outreach-reply:${prospect.id}:${prospect.last_reply_at}`;
    const created = await upsertTasks(companyId, [
      {
        text: action.slice(0, 500),
        kind: "next_step",
        linkKind: companyId ? "client" : "email",
        source: "outreach_reply",
        sourceRef,
        dueAt: `${dueDate}T12:00:00.000Z`,
        pinned: true,
        payload: {
          outreachProspectId: prospect.id,
          replyReceivedAt: prospect.last_reply_at,
        },
      },
    ]);

    let task = created[0] || null;
    if (!task) {
      const { data: existing } = await supabaseAdmin
        .from("tasks")
        .select("id,company_id,text,due_at,status")
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .eq("source_ref", sourceRef)
        .maybeSingle();
      task = existing || null;
    }

    if (!task) {
      return NextResponse.json(
        {
          error:
            "A very similar open action already exists. Review it before adding another one.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      task,
      created: created.length > 0,
      linkedCompany: Boolean(companyId),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "The next action could not be saved" },
      { status: 500 }
    );
  }
}
