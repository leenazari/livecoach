"use client";

// A read-only view of the canonical summary, shared by the live debrief and
// saved call. It never generates drafts, creates tasks or changes ownership.
export default function CallActionRegister({
  actions,
  hostName,
}: {
  actions?: unknown;
  hostName?: string;
}) {
  if (!Array.isArray(actions)) return null;
  const byOwner = new Map<string, string[]>();
  for (const action of actions) {
    if (!action || typeof action.text !== "string" || !action.text.trim()) continue;
    const raw = typeof action.owner === "string" ? action.owner.trim() : "";
    const owner = !raw || /^unassigned$/i.test(raw) ? "Unassigned" : raw;
    const list = byOwner.get(owner) || [];
    list.push(action.text.trim());
    byOwner.set(owner, list);
  }
  if (!byOwner.size) return null;
  const owners = Array.from(byOwner.keys()).sort((x, y) => {
    if (x === y) return 0;
    if (x === "Unassigned") return 1;
    if (y === "Unassigned") return -1;
    if (hostName && x === hostName) return -1;
    if (hostName && y === hostName) return 1;
    return x.localeCompare(y);
  });
  const count = Array.from(byOwner.values()).reduce((total, items) => total + items.length, 0);
  return (
    <section aria-label="Requests and actions by person" className="my-5 rounded-xl border border-sky/40 bg-panel/40 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-sky">Requests and actions by person</h3>
        <span className="font-mono text-xs text-muted">{count} recorded {count === 1 ? "item" : "items"}</span>
      </div>
      <p className="mb-4 mt-2 text-sm leading-relaxed text-muted">Recorded requests and commitments from this call. This list is separate from tracked tasks and prepared drafts. Unclear owners stay unconfirmed.</p>
      <div className="flex flex-col gap-5">
        {owners.map(owner => (
          <div key={owner}>
            <h4 className={`mb-2 font-medium ${owner === hostName ? "text-amber" : owner === "Unassigned" ? "text-muted" : "text-sky"}`}>
              {owner === "Unassigned" ? "Owner to confirm" : owner}{owner === hostName ? " (you)" : ""}
              <span className="ml-2 text-xs text-muted">{byOwner.get(owner)!.length}</span>
            </h4>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-bone/85">
              {byOwner.get(owner)!.map((text, index) => <li key={index} className="break-words">{text}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
