import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { buildWorkCleanup, type CleanupTask } from "@/lib/work-cleanup";
import {
  requireRequestScope,
  type RequestScope,
} from "@/lib/request-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const noStore = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

async function currentCleanup(account: RequestScope) {
  const [tasksResult, companiesResult, opportunitiesResult] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select("id,company_id,text,kind,link_kind,status,created_at,due_at,payload")
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .eq("status", "open")
      .limit(600),
    supabaseAdmin
      .from("companies")
      .select("id,name")
      .eq("workspace_id", account.workspaceId)
      .eq("owner_id", account.userId)
      .limit(1500),
    supabaseAdmin
      .from("opportunities")
      .select("company_id")
      .eq("workspace_id", account.workspaceId)
      .eq("assigned_to_user_id", account.userId)
      .eq("status", "open")
      .eq("opportunity_type", "revenue")
      .limit(1000),
  ]);
  const error = [
    tasksResult.error,
    companiesResult.error,
    opportunitiesResult.error,
  ].find(Boolean);
  if (error) throw error;
  const companyNames = new Map<string, string>(
    (companiesResult.data || []).map((company: any) => [company.id, company.name])
  );
  const revenueCompanies = new Set<string>(
    (opportunitiesResult.data || [])
      .map((opportunity: any) => opportunity.company_id)
      .filter(Boolean)
  );
  return buildWorkCleanup(
    (tasksResult.data || []) as CleanupTask[],
    companyNames,
    revenueCompanies
  );
}

const validIds = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((id): id is string =>
              typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)
            )
            .slice(0, 300)
        )
      )
    : [];

export async function POST(req: NextRequest) {
  try {
    const account = requireRequestScope();
    const body = await req.json();
    if (body?.mode === "undo") {
      const taskIds = validIds(body.taskIds);
      if (!taskIds.length)
        return NextResponse.json(
          { error: "No cleanup changes were supplied to undo." },
          { status: 400, headers: noStore }
        );
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .update({ status: "open", done_at: null })
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .in("id", taskIds)
        .eq("status", "dismissed")
        .select("id,status");
      if (error) throw error;
      const restored = (data || [])
        .filter((task: any) => task.status === "open")
        .map((task: any) => task.id as string);
      const restoredSet = new Set(restored);
      const notCompleted = taskIds
        .filter((id) => !restoredSet.has(id))
        .map((id) => ({ id, reason: "This task was no longer an archived cleanup item." }));
      return NextResponse.json(
        { ok: notCompleted.length === 0, restored, notCompleted },
        { headers: noStore }
      );
    }

    const suggestionIds: string[] = Array.isArray(body?.suggestionIds)
      ? Array.from(
          new Set<string>(
            body.suggestionIds
              .filter((id: unknown): id is string => typeof id === "string")
              .slice(0, 100)
          )
        )
      : [];
    if (!suggestionIds.length)
      return NextResponse.json(
        { error: "Choose at least one cleanup suggestion first." },
        { status: 400, headers: noStore }
      );

    // Recompute immediately before writing. A stale browser cannot archive a
    // task that no longer meets the conservative cleanup rules.
    const cleanup = await currentCleanup(account);
    const available = new Map(
      cleanup.suggestions
        .filter((suggestion) => suggestion.safeToApply)
        .map((suggestion) => [suggestion.id, suggestion])
    );
    const completed: { id: string; taskIds: string[] }[] = [];
    const notCompleted: { id: string; reason: string }[] = [];
    const dismissedTaskIds: string[] = [];

    for (const suggestionId of suggestionIds) {
      const suggestion = available.get(suggestionId);
      if (!suggestion) {
        notCompleted.push({
          id: suggestionId,
          reason: "This suggestion changed or is no longer safe to apply.",
        });
        continue;
      }
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .update({ status: "dismissed" })
        .eq("workspace_id", account.workspaceId)
        .eq("owner_id", account.userId)
        .in("id", suggestion.taskIds)
        .eq("status", "open")
        .select("id,status");
      if (error) {
        notCompleted.push({ id: suggestionId, reason: error.message });
        continue;
      }
      const confirmed = (data || [])
        .filter((task: any) => task.status === "dismissed")
        .map((task: any) => task.id as string);
      if (confirmed.length !== suggestion.taskIds.length) {
        notCompleted.push({
          id: suggestionId,
          reason: `The database confirmed ${confirmed.length} of ${suggestion.taskIds.length} task changes.`,
        });
        dismissedTaskIds.push(...confirmed);
        continue;
      }
      completed.push({ id: suggestion.id, taskIds: confirmed });
      dismissedTaskIds.push(...confirmed);
    }

    return NextResponse.json(
      {
        ok: notCompleted.length === 0,
        completed,
        notCompleted,
        dismissedTaskIds: Array.from(new Set(dismissedTaskIds)),
      },
      { headers: noStore }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Cleanup did not complete." },
      { status: 500, headers: noStore }
    );
  }
}
