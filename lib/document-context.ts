import { supabaseAdmin } from "@/lib/supabase";

// Keep ordinary Brain turns lean. This small lookup runs only when the user
// explicitly mentions a finished document and does not import the DOCX renderer.
export async function documentBrainContext(message: string) {
  const wantsDocuments =
    /\b(document|docx|word file|handbook|contract|agreement|proposal|report|business plan|sales plan|produce|write up)\b/i.test(
      message
    );
  if (!wantsDocuments) return "";
  const [{ data: tasks }, { data: jobs }] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select("id, company_id, text, due_at, payload")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("document_jobs")
      .select(
        "id, company_id, task_id, title, document_type, status, stage_label, file_name, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  const documentTasks = (tasks || [])
    .filter((task: any) =>
      /\b(document|handbook|contract|agreement|proposal|report|plan|guide|write up|draft)\b/i.test(
        String(task.text || "")
      )
    )
    .slice(0, 12);
  const lines = [
    "DOCUMENT STUDIO ON DEMAND",
    "Use create_document only when the user explicitly asks for a finished business document. These jobs run in the background and do not block the CRM.",
  ];
  if (documentTasks.length) {
    lines.push("Open document-related to-dos:");
    for (const task of documentTasks)
      lines.push(
        `- ${task.text}${
          task.due_at ? ` due ${String(task.due_at).slice(0, 10)}` : ""
        } [source task ${task.id}]`
      );
  }
  if ((jobs || []).length) {
    lines.push("Recent document jobs:");
    for (const job of jobs || [])
      lines.push(`- ${job.title} [${job.document_type}, ${job.status}]`);
  }
  return lines.join("\n");
}
