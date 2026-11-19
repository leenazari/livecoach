import "server-only";
import { supabaseService } from "@/lib/supabase";
import { resolveRecordScope } from "@/lib/record-scope";
import { loadAssignedClientAccess } from "@/lib/assigned-client-access";
import { loadHostIdentityForUser } from "@/lib/speakers";
import { buildStrategicCoachingTranscript } from "@/lib/coaching-transcript";
import { openai, OPENAI_MODEL_PRO } from "@/lib/openai";
import { logModelUsage } from "@/lib/usage";
import { upsertTasks, fingerprintTask } from "@/lib/tasks";
import {
  CALL_ACTION_INSTRUCTIONS,
  groundCallActionPlan,
  type CallActionPlan,
} from "@/lib/call-action-plan";

export async function prepareCallActions(
  callId: string,
  options: { manual?: boolean } = {},
) {
  const scope = await resolveRecordScope();
  const base = () =>
    supabaseService
      .from("interview_summaries")
      .select("*")
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("id", callId);
  const { data: call, error } = await base().maybeSingle();
  if (error) throw error;
  if (!call) throw new Error("Call unavailable");
  if (call.post_call_preparation_state === "ready") return;
  if (!options.manual && call.post_call_preparation_state == null) return;
  const now = new Date().toISOString();
  if (
    call.post_call_preparation_lease &&
    call.post_call_preparation_lease > now &&
    (!options.manual || call.post_call_preparation_state === "preparing")
  )
    return;
  const attempts = Number(call.post_call_preparation_attempts || 0);
  if (!options.manual && attempts >= 5) return;
  const lease = new Date(Date.now() + 180000).toISOString();
  const { data: claim, error: claimError } = await supabaseService
    .from("interview_summaries")
    .update({
      post_call_preparation_state: "preparing",
      post_call_preparation_attempts: attempts + 1,
      post_call_preparation_lease: lease,
      post_call_preparation_error: null,
    })
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .eq("id", callId)
    .eq("post_call_preparation_attempts", attempts)
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claim) return;
  const update = (value: Record<string, unknown>) =>
    supabaseService
      .from("interview_summaries")
      .update(value)
      .eq("workspace_id", scope.workspaceId)
      .eq("owner_id", scope.userId)
      .eq("id", callId)
      .eq("post_call_preparation_lease", lease)
      .select("id")
      .single();
  let contentSaved = !!call.post_call_package?.actionPreparation;
  let tasksSaved = false;
  let draftsSaved = false;
  try {
    // Reuse the checkpoint after an interrupted task save. Never pay to rewrite
    // prepared content or overwrite a completed task on a retry.
    let plan: CallActionPlan = call.post_call_package?.actionPreparation;
    const access = call.company_id
      ? await loadAssignedClientAccess(call.company_id, scope, supabaseService)
      : null;
    const companyId = access ? call.company_id : null;
    if (!plan || plan.version !== 1) {
      const [session, script, identity] = await Promise.all([
        supabaseService
          .from("interview_sessions")
          .select("transcript,brief,started_at,created_at")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .eq("session_id", call.session_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseService
          .from("call_script_plans")
          .select("prep,products,timeline,script_snapshot")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .eq("context_key", `session:${call.session_id}`)
          .maybeSingle(),
        loadHostIdentityForUser(scope.userId, scope.workspaceId),
      ]);
      if (session.error) throw session.error;
      if (script.error) throw script.error;
      const transcript = String(session.data?.transcript || "");
      if (transcript.trim().length < 30) throw new Error("No saved transcript");
      const { privateNotes: _privateNotes, ...preparation } =
        script.data?.prep || {};
      const context = {
        user: identity.name,
        callDate:
          session.data?.started_at ||
          session.data?.created_at ||
          call.created_at,
        company: access?.company?.name || null,
        intent: session.data?.brief,
        summary: call.summary,
        products: script.data?.products,
        changes: script.data?.timeline,
        preparation,
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 40000);
      try {
        const msg = await openai.messages.create(
          {
            model: OPENAI_MODEL_PRO,
            max_tokens: 7000,
            temperature: 0.1,
            system: CALL_ACTION_INSTRUCTIONS,
            messages: [
              {
                role: "user",
                content: `CONTEXT\n${JSON.stringify(context).slice(0, 18000)}\nTRANSCRIPT\n${transcript.length <= 120000 ? transcript : buildStrategicCoachingTranscript(transcript, identity.name, 100000, true)}`,
              },
            ],
          },
          { signal: controller.signal },
        );
        await logModelUsage(
          "call-action-preparation",
          "pro",
          (msg as any).usage,
          { callId, sessionId: call.session_id },
          scope,
        ).catch(() => {});
        const raw = msg.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
        plan = groundCallActionPlan(
          JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)),
          transcript,
          identity.name,
        );
        if (transcript.length > 120000)
          plan.warnings.push(
            "This long call was sampled across the conversation. Review its transcript for any additional commitments.",
          );
      } finally {
        clearTimeout(timer);
      }
      const saved = await update({
        post_call_package: {
          ...(call.post_call_package || {}),
          actionPreparation: plan,
        },
      });
      if (saved.error) throw saved.error;
      contentSaved = true;
    }
    const key = (actionId: string) => `call-action:${callId}:${actionId}`;
    const taskRows = plan.actions.map((action) => ({
      text:
        action.ownerType === "unassigned"
          ? `Confirm owner: ${action.text}`
          : action.text,
      kind:
        action.ownerType === "counterparty"
          ? "counterparty_commitment"
          : action.ownerType === "unassigned"
            ? "next_step"
            : "commitment",
      linkKind:
        action.kind === "email" && action.ownerType === "me"
          ? "email"
          : "client",
      source: "call",
      sourceRef: call.session_id || callId,
      fingerprintKey: key(action.id),
      distinctSourceEvent: true,
      dueAt: action.dueAt,
      payload: {
        actionType:
          action.kind === "email" && action.ownerType === "me"
            ? "email"
            : "task",
        ownerType: action.ownerType,
        ownerName: action.ownerName,
        subject: action.subject,
        body: action.body,
        notes: action.body,
        coverEmailSubject: action.coverEmailSubject,
        coverEmailBody: action.coverEmailBody,
        callId,
        preparedActionId: action.id,
        preparationKind: action.kind,
        missingDetails: action.missingDetails,
        sourceQuote: action.sourceQuote,
      },
    }));
    await upsertTasks(
      companyId,
      taskRows,
      companyId ? call.workstream_id : null,
    );
    const fingerprints = plan.actions.map((a) =>
      fingerprintTask(
        companyId,
        `request ${key(a.id)}`,
        companyId ? call.workstream_id : null,
      ),
    );
    const receipts = fingerprints.length
      ? await supabaseService
          .from("tasks")
          .select("id,fingerprint,status")
          .eq("workspace_id", scope.workspaceId)
          .eq("owner_id", scope.userId)
          .in("fingerprint", fingerprints)
      : { data: [], error: null };
    if (receipts.error) throw receipts.error;
    if ((receipts.data || []).length !== plan.actions.length)
      throw new Error("Some tasks were not confirmed");
    tasksSaved = true;
    const drafts = plan.actions
      .filter(
        (a) =>
          a.ownerType === "me" &&
          (a.kind === "email" ? a.body.trim() : a.coverEmailBody?.trim()),
      )
      .map((a) => ({
        workspace_id: scope.workspaceId,
        owner_id: scope.userId,
        visibility: "private",
        company_id: companyId,
        session_id: call.session_id,
        source_action_key: a.id,
        draft_subject: a.kind === "email" ? a.subject : a.coverEmailSubject,
        draft_body: a.kind === "email" ? a.body : a.coverEmailBody,
        status: "draft",
      }));
    if (drafts.length) {
      const draftSave = await supabaseService
        .from("follow_ups")
        .upsert(drafts, {
          onConflict: "workspace_id,owner_id,session_id,source_action_key",
          ignoreDuplicates: true,
        });
      if (draftSave.error) throw draftSave.error;
    }
    draftsSaved = true;
    const actions = plan.actions.map((a, i) => {
      const task = receipts.data?.find(
        (t) => t.fingerprint === fingerprints[i],
      );
      return { ...a, taskId: task?.id, taskStatus: task?.status };
    });
    const saved = await update({
      post_call_package: {
        ...(call.post_call_package || {}),
        actionPreparation: { ...plan, actions },
      },
      post_call_preparation_state: "ready",
      post_call_preparation_lease: null,
      post_call_preparation_error: null,
    });
    if (saved.error) throw saved.error;
  } catch (error) {
    const failed = await update({
      post_call_preparation_state: "error",
      post_call_preparation_error:
        tasksSaved && draftsSaved
          ? "Your summary, prepared content, tasks and email drafts are saved. The final action-pack status was not confirmed. Reopen this call to check it."
          : tasksSaved
            ? "Your summary, prepared content and tasks are saved. Saving the email drafts was not confirmed. Check Drafts before retrying."
            : contentSaved
              ? "Your summary and prepared draft content are saved. Saving the tasks was not confirmed. Check Tasks before retrying."
              : "Your summary is saved. The prepared action content was not confirmed. Recovery will try again automatically.",
      post_call_preparation_lease: new Date(Date.now() + 300000).toISOString(),
    });
    console.error("Call action preparation incomplete", {
      callId,
      code: (error as any)?.code || "preparation_failed",
      stateSaved: !failed.error,
    });
  }
}

export async function recoverCallActionPreparation() {
  const scope = await resolveRecordScope();
  const { data, error } = await supabaseService
    .from("interview_summaries")
    .select("id,post_call_preparation_lease")
    .eq("workspace_id", scope.workspaceId)
    .eq("owner_id", scope.userId)
    .in("post_call_preparation_state", ["pending", "preparing", "error"])
    .lt("post_call_preparation_attempts", 5)
    .order("created_at", { ascending: true })
    .limit(30);
  if (error) throw error;
  const call = data?.find(
    (c) =>
      !c.post_call_preparation_lease ||
      c.post_call_preparation_lease < new Date().toISOString(),
  );
  if (call) await prepareCallActions(call.id);
}
