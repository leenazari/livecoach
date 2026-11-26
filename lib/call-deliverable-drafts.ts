import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { supabaseService } from "@/lib/supabase";
import { resolveRecordScope } from "@/lib/record-scope";
import { approvedDocumentBytes, loadApprovedDocuments } from "@/lib/approved-documents";
import { requestedApprovedDocument, APPROVED_DOCUMENTS } from "@/lib/approved-document-policy";
import { connectedMailProvider, createConnectedMailDraft } from "@/lib/mail";
import { loadTaskEmailWorkspace } from "@/lib/task-email";
import { verifySentCallDeliverable } from "@/lib/gmail";

// Every external draft creation has a durable, compare-and-swap barrier. A
// missing provider response is uncertain, never permission to create a copy.
export async function prepareCallDeliverableDraft(taskId: string) {
  const scope = await resolveRecordScope();
  const registry = await loadApprovedDocuments();
  if (!registry.autoDrafts) return;
  const result = await supabaseService.from("tasks").select("id,text,status,kind,source,payload,link_kind,created_at")
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", taskId).maybeSingle();
  if (result.error) throw result.error;
  const task = result.data, payload = task?.payload || {};
  if (!task || task.status !== "open" || task.kind !== "commitment" || task.source !== "call" || payload.ownerType !== "me") return;
  // Enabling automatic drafts must not replay old, possibly already-fulfilled
  // conversations. Existing commitments still receive reminders for review.
  if (!payload.deliverableDraft && registry.autoDraftsSince && Date.parse(task.created_at) < Date.parse(registry.autoDraftsSince)) return;
  if (payload.deliverableDraft?.status === "ready") {
    const state = payload.deliverableDraft;
    if ((state.documents || []).some((old: any) => registry.documents.find(d => d.key === old.key)?.version !== old.version)) {
      const changed = await supabaseService.from("tasks").update({ payload: { ...payload, deliverableDraft: { ...state,
        reason: "An approved PDF changed after this Gmail draft was prepared. Review its attachment before sending. Existing drafts are not overwritten." } } })
        .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", taskId).eq("payload", JSON.stringify(task.payload));
      if (changed.error) throw changed.error;
      return;
    }
    const sentId = await verifySentCallDeliverable({ trackingMessageId: state.trackingMessageId, recipient: state.recipient,
      bodyHash: state.bodyHash, documents: state.documents || [] }, scope.userId);
    if (sentId) {
      const completed = await supabaseService.from("tasks").update({ status: "done", done_at: new Date().toISOString(),
        payload: { ...payload, deliverableDraft: { ...state, sentMessageId: sentId, status: "sent" } } })
        .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", taskId).eq("status", "open")
        .eq("payload", JSON.stringify(task.payload));
      if (completed.error) throw completed.error;
    }
    return;
  }
  if (payload.gmailDraftId || ["uncertain", "preparing"].includes(payload.deliverableDraft?.status)) return;
  const comparePayload = JSON.stringify(task.payload);
  const save = async (patch: Record<string, any>) => {
    const saved = await supabaseService.from("tasks").update({ payload: { ...payload, ...patch } })
      .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", taskId).eq("status", "open")
      .eq("payload", comparePayload).select("id").maybeSingle();
    if (saved.error) throw saved.error;
    return !!saved.data;
  };
  const block = async (reason: string) => {
    if (payload.deliverableDraft?.status === "blocked" && payload.deliverableDraft?.reason === reason) return;
    await save({ deliverableDraft: { status: "blocked", reason, checkedAt: new Date().toISOString() }, pinned: true });
  };
  const requested = requestedApprovedDocument(`${task.text}\n${payload.subject || ""}\n${payload.sourceQuote || ""}`);
  if (requested === "ambiguous") return block("Choose the correct approved brochure or price list. The promise does not identify one unambiguously.");
  const document = requested ? registry.documents.find(d => d.key === requested) : null;
  if (requested && !document) return block(`Upload ${APPROVED_DOCUMENTS[requested]} in Documents. Your prepared copy remains saved.`);
  if (payload.preparationKind === "document" && !document) return block("Review and produce the promised document before preparing its covering email.");
  if (task.link_kind !== "email" && task.link_kind !== "drafts") return block("Open this task to select an email recipient and review the covering email.");
  let body = String(payload.preparationKind === "document" ? payload.coverEmailBody || "" : payload.body || "").replace(/\\n/g, "\n").trim();
  const subject = String(payload.preparationKind === "document" ? payload.coverEmailSubject || "" : payload.subject || "").trim();
  if (!document && /\b(attached|attachment|enclosed)\b/i.test(body))
    return block("This draft refers to an attachment, but no approved PDF was identified. Select or upload the promised document before preparing the mailbox draft.");
  if (document) body = body.replace(/\[To confirm:\s*(?:brochure|guide|document)(?:\s+link)?(?:\s+or\s+file)?\s*\]/gi, "the attached PDF");
  const unresolved = (Array.isArray(payload.missingDetails) ? payload.missingDetails : [])
    .filter((detail: string) => !(document && /(?:brochure|guide|document).*(?:link|file|version)|(?:link|file).*to include/i.test(detail)));
  if (!body || !subject || /\[To confirm/i.test(body) || unresolved.length)
    return block(`Review the missing details before creating the mailbox draft.${unresolved.length ? ` ${unresolved.join(" ")}` : ""}`.slice(0, 900));
  const connection = await connectedMailProvider(scope.userId);
  if (connection.provider !== "google") return block("Connect your Google mailbox to prepare automatic drafts with approved PDFs.");
  const workspace = await loadTaskEmailWorkspace(taskId);
  if (workspace.recipients.length !== 1) return block("Choose one exact saved recipient. LiveCoach will not guess who should receive this document.");
  const recipient = workspace.recipients[0];
  const attachments = document ? [{ name: document.name, mimeType: "application/pdf" as const, content: await approvedDocumentBytes(document) }] : [];
  // Recheck the opt-in immediately before an external action.
  const latestRegistry = await loadApprovedDocuments();
  if (!latestRegistry.autoDrafts) return;
  if (document && latestRegistry.documents.find(d => d.key === document.key)?.version !== document.version)
    return block("The approved PDF changed during preparation. LiveCoach will check the current version before preparing the draft.");
  const attempt = randomUUID();
  const trackingMessageId = `<lc-deliverable-${attempt}@livecoach.invalid>`;
  const state = { status: "preparing", attempt, startedAt: new Date().toISOString(), recipient: recipient.email,
    trackingMessageId, bodyHash: createHash("sha256").update(body.replace(/\s+/g, " ").trim()).digest("hex"), documents: document ? [document] : [] };
  if (!await save({ deliverableDraft: state })) return;
  let provider: Awaited<ReturnType<typeof createConnectedMailDraft>> | null = null;
  try {
    provider = await createConnectedMailDraft({ to: recipient.email, subject, text: body, attachments, trackingMessageId }, scope.userId);
  } catch { /* Any interrupted external write has an unknown outcome. */ }
  const status = provider?.ok && provider.id ? "ready" : "uncertain";
  const receipt = { ...state, status, providerDraftId: provider?.id || null, url: provider?.url || null,
    reason: status === "uncertain" ? "Mailbox draft creation was not confirmed. Check Gmail Drafts before retrying. LiveCoach will not create another copy automatically." : null };
  const saved = await supabaseService.from("tasks").update({ payload: { ...payload, deliverableDraft: receipt, pinned: true } })
    .eq("workspace_id", scope.workspaceId).eq("owner_id", scope.userId).eq("id", taskId)
    .eq("payload", JSON.stringify({ ...payload, deliverableDraft: state })).select("id").maybeSingle();
  if (saved.error || !saved.data) throw new Error("The draft outcome was not confirmed in Tasks. Check Gmail Drafts before taking further action");
}
