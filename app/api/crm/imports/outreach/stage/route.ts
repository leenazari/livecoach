import { NextRequest, NextResponse } from "next/server";

import {
  normaliseOutreachImportRows,
  type StagedOutreachImportRow,
} from "@/lib/outreach-import";
import { requireWorkspaceOwner } from "@/lib/request-scope";
import { supabaseService } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function workspaceEmailSet(table: "outreach_prospects" | "contacts", workspaceId: string) {
  const emails = new Set<string>();
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await supabaseService
      .from(table)
      .select("email")
      .eq("workspace_id", workspaceId)
      .not("email", "is", null)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    for (const row of data || []) {
      const email = String(row.email || "").trim().toLowerCase();
      if (email) emails.add(email);
    }
    if ((data || []).length < 1000) break;
  }
  return emails;
}

function counts(rows: StagedOutreachImportRow[]) {
  return {
    row_count: rows.length,
    ready_count: rows.filter((row) => row.decision === "ready").length,
    duplicate_count: rows.filter((row) => row.decision === "duplicate").length,
    review_count: rows.filter((row) => row.decision === "review").length,
    invalid_count: rows.filter((row) => row.decision === "invalid").length,
  };
}

export async function POST(request: NextRequest) {
  try {
    const scope = requireWorkspaceOwner();
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.rows) || !body.rows.length) {
      return NextResponse.json(
        { error: "Add at least one lead row before staging the import" },
        { status: 400 }
      );
    }
    if (body.rows.length > 500) {
      return NextResponse.json(
        { error: "Stage no more than 500 rows in one batch" },
        { status: 400 }
      );
    }
    const sourceName = String(body.sourceName || "Pasted lead list")
      .replace(/[\u0000-\u001f]/g, " ")
      .trim()
      .slice(0, 240);
    if (!sourceName) {
      return NextResponse.json({ error: "A source name is required" }, { status: 400 });
    }
    const assignedToUserId =
      typeof body.assignedToUserId === "string" && body.assignedToUserId
        ? body.assignedToUserId
        : null;
    if (assignedToUserId) {
      const { data: member, error: memberError } = await supabaseService
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", scope.workspaceId)
        .eq("user_id", assignedToUserId)
        .eq("status", "active")
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member) {
        return NextResponse.json(
          { error: "Choose an active member of this workspace" },
          { status: 409 }
        );
      }
    }

    const [outreachEmails, contactEmails] = await Promise.all([
      workspaceEmailSet("outreach_prospects", scope.workspaceId),
      workspaceEmailSet("contacts", scope.workspaceId),
    ]);
    const rows = normaliseOutreachImportRows(
      body.rows,
      outreachEmails,
      contactEmails
    );
    const summary = counts(rows);
    const { data: batch, error } = await supabaseService
      .from("crm_import_batches")
      .insert({
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        assigned_to_user_id: assignedToUserId,
        source_name: sourceName,
        status: "staged",
        rows,
        ...summary,
      })
      .select(
        "id,source_name,status,row_count,ready_count,duplicate_count,review_count,invalid_count,rows,applied_result,assigned_to_user_id,expires_at,created_at"
      )
      .single();
    if (error) throw error;
    return NextResponse.json({ batch }, { status: 201 });
  } catch (error: any) {
    const forbidden = /owner access/i.test(error?.message || "");
    return NextResponse.json(
      { error: error?.message || "Could not stage this import" },
      { status: forbidden ? 403 : 500 }
    );
  }
}
