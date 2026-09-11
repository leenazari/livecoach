type ImportActor = { userId: string; role: string };

// Import permission grants new leads to the uploader. It does not grant the
// authority to allocate another salesperson's work or leave a shared pool.
export function resolveOutreachImportAssignee(
  actor: ImportActor,
  requested: unknown
): string | null {
  const assignee = typeof requested === "string" && requested ? requested : null;
  if (actor.role === "owner") return assignee;
  if (assignee && assignee !== actor.userId) {
    throw new Error("Lead import access only allows assigning your own uploads to yourself");
  }
  return actor.userId;
}
