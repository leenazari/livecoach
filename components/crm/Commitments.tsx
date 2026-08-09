"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { crmFetch, getCached, setCached } from "@/lib/crm";
import VoiceNoteButton from "@/components/VoiceNoteButton";
import { capitaliseSentenceStarts } from "@/lib/text";

type Payload = {
  actionType?: string; // "email" | "task"
  subject?: string;
  body?: string;
  notes?: string;
  ownerType?: "me" | "counterparty";
  ownerName?: string;
};
type Task = {
  id: string;
  company_id: string | null;
  company: string | null;
  text: string;
  kind: string;
  status: string;
  due_at?: string | null;
  payload?: Payload | null;
};

// The Commitments queue: things YOU promised (on calls or in email), each with
// a prepared draft you approve, edit, then complete. Separate from "Do next".
// Self-hides when empty so it never clutters the dashboard.
export default function Commitments({
  companyId,
  showCompany = false,
}: {
  companyId?: string;
  showCompany?: boolean;
}) {
  const url = `/api/crm/tasks${companyId ? `?companyId=${companyId}` : ""}`;
  const seed = (getCached<{ tasks: Task[] }>(url)?.tasks || []).filter(
    (t) =>
      (t.kind === "commitment" || t.kind === "counterparty_commitment") &&
      t.status !== "done" &&
      t.status !== "dismissed"
  );
  const [items, setItems] = useState<Task[]>(seed);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Payload>({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dueDraft, setDueDraft] = useState("");
  const [saveError, setSaveError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  // Every load gets a sequence number. A tick/delete invalidates requests that
  // started before the click, so a slow stale response cannot repaint the item
  // two seconds after it was successfully saved.
  const loadSeq = useRef(0);
  // Once this screen has received confirmation that a commitment was closed,
  // never let a delayed list response paint that id again. The database remains
  // the source of truth; this only protects the UI from an older in-flight read.
  const closedIds = useRef(new Set<string>());

  const removeFromCachedList = (id: string) => {
    const cached = getCached<{ tasks: Task[] }>(url);
    if (!cached) return;
    setCached(url, {
      ...cached,
      tasks: (cached.tasks || []).filter((task) => task.id !== id),
    });
  };

  const load = async () => {
    const seq = ++loadSeq.current;
    try {
      const d = await crmFetch<{ tasks: Task[] }>(url);
      if (seq !== loadSeq.current) return;
      setItems(
        (d.tasks || []).filter(
          (t) =>
            (t.kind === "commitment" ||
              t.kind === "counterparty_commitment") &&
            t.status !== "done" &&
            t.status !== "dismissed" &&
            !closedIds.current.has(t.id)
        )
      );
    } catch {
      /* keep the last confirmed list */
    }
  };

  useEffect(() => {
    load();
    const onUpd = () => load();
    window.addEventListener("lc:tasks-updated", onUpd);
    return () => window.removeEventListener("lc:tasks-updated", onUpd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const expand = (t: Task) => {
    if (openId === t.id) {
      setOpenId(null);
      return;
    }
    setOpenId(t.id);
    setCopied(false);
    setDraft({ ...(t.payload || {}) });
    setDueDraft(t.due_at ? String(t.due_at).slice(0, 10) : "");
  };

  const saveDraft = async (t: Task) => {
    loadSeq.current += 1;
    setSaving(true);
    try {
      const result = await crmFetch<{ task: Task }>(`/api/crm/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          payload: { ...(t.payload || {}), ...draft },
          dueAt: dueDraft
            ? new Date(`${dueDraft}T12:00:00`).toISOString()
            : null,
        }),
      });
      if (!result.task?.id) throw new Error("draft not saved");
      setItems((all) =>
        all.map((item) =>
          item.id === t.id ? { ...item, ...result.task } : item
        )
      );
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const complete = async (t: Task) => {
    const previous = items;
    loadSeq.current += 1;
    closedIds.current.add(t.id);
    removeFromCachedList(t.id);
    setSaveError("");
    setItems((p) => p.filter((x) => x.id !== t.id));
    if (openId === t.id) setOpenId(null);
    try {
      const result = await crmFetch<{ task: Task }>(`/api/crm/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      });
      if (result.task?.status !== "done") throw new Error("status not saved");
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch {
      closedIds.current.delete(t.id);
      setItems(previous);
      setSaveError("That change did not save. Please try again.");
    }
  };

  const remove = async (t: Task) => {
    // Dismiss across the whole pipeline (kept as a row so the jobs don't
    // re-create it from the same email or call).
    const previous = items;
    loadSeq.current += 1;
    closedIds.current.add(t.id);
    removeFromCachedList(t.id);
    setSaveError("");
    setItems((p) => p.filter((x) => x.id !== t.id));
    if (openId === t.id) setOpenId(null);
    try {
      const result = await crmFetch<{ task: Task }>(`/api/crm/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "dismissed" }),
      });
      if (result.task?.status !== "dismissed")
        throw new Error("status not saved");
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch {
      closedIds.current.delete(t.id);
      setItems(previous);
      setSaveError("That change did not save. Please try again.");
    }
  };

  const beginEdit = (t: Task) => {
    setEditingId(t.id);
    setEditingText(t.text);
    setSaveError("");
  };

  const saveText = async (t: Task) => {
    const text = editingText.trim();
    if (!text || text === t.text) {
      setEditingId(null);
      return;
    }
    const previous = items;
    loadSeq.current += 1;
    setItems((p) => p.map((x) => (x.id === t.id ? { ...x, text } : x)));
    setEditingId(null);
    try {
      const result = await crmFetch<{ task: Task }>(`/api/crm/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ text }),
      });
      if (result.task?.text !== text) throw new Error("text not saved");
      setItems((all) =>
        all.map((item) =>
          item.id === t.id ? { ...item, ...result.task } : item
        )
      );
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch {
      setItems(previous);
      setSaveError("That edit did not save. Please try again.");
    }
  };

  const gmailUrl = () => {
    const su = encodeURIComponent(draft.subject || "");
    const body = encodeURIComponent(draft.body || "");
    return `https://mail.google.com/mail/?view=cm&fs=1&su=${su}&body=${body}`;
  };

  const copyDraft = async () => {
    const text =
      draft.actionType === "email" || draft.body
        ? `${draft.subject ? `Subject: ${draft.subject}\n\n` : ""}${
            draft.body || ""
          }`
        : draft.notes || "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const dueBadge = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const days = Math.floor((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    const overdue = d.getTime() < Date.now();
    const soon = days <= 2 && !overdue;
    const label = overdue
      ? "overdue"
      : days === 0
      ? "today"
      : days === 1
      ? "tomorrow"
      : d.toLocaleDateString([], { day: "2-digit", month: "short" });
    const cls = overdue
      ? "border-rust/60 bg-rust/15 text-rust"
      : soon
      ? "border-amber/60 bg-amber/15 text-amber"
      : "border-edge text-muted";
    return (
      <span
        className={`flex-none rounded-full border px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider ${cls}`}
      >
        due {label}
      </span>
    );
  };

  if (items.length === 0) return null;

  const mineCount = items.filter((t) => t.kind === "commitment").length;
  const theirCount = items.length - mineCount;

  return (
    <div className="mb-3 rounded-xl border border-sky/40 bg-sky/[0.05] p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
          {"✓"} Commitments{" "}
          <span className="text-muted">
            - {mineCount} yours, {theirCount} theirs
          </span>
        </p>
      </div>
      {saveError ? (
        <p className="mb-2 rounded-md border border-rust/50 bg-rust/10 px-2 py-1.5 font-sans text-[0.76rem] text-rust">
          {saveError}
        </p>
      ) : null}

      <ul className="flex flex-col">
        {items.map((t) => {
          const open = openId === t.id;
          const theirs = t.kind === "counterparty_commitment";
          const isEmail = !theirs && (t.payload?.actionType || "task") === "email";
          const ownerName =
            t.payload?.ownerName || (theirs ? "They" : "You");
          return (
            <li
              key={t.id}
              className="border-b border-edge/40 py-2 last:border-none"
            >
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => complete(t)}
                  title={theirs ? "mark received" : "mark done"}
                  className="flex h-4 w-4 flex-none items-center justify-center rounded border border-muted text-[0.6rem] transition hover:border-sage"
                />
                {editingId === t.id ? (
                  <input
                    autoFocus
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => saveText(t)}
                    aria-label="Edit commitment"
                    className="min-w-0 flex-1 rounded-md border border-amber/50 bg-ink/70 px-2 py-1.5 font-sans text-[0.84rem] text-bone outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => expand(t)}
                    className="flex-1 text-left font-sans text-[0.84rem] leading-snug text-bone transition hover:text-amber"
                  >
                    {capitaliseSentenceStarts(t.text)}
                  </button>
                )}
                {dueBadge(t.due_at)}
                <span
                  className={`flex-none rounded-full border px-2 py-0.5 font-mono text-[0.52rem] uppercase tracking-wider ${
                    theirs
                      ? "border-rust/45 bg-rust/10 text-rust"
                      : "border-sage/45 bg-sage/10 text-sage"
                  }`}
                >
                  {theirs ? `${ownerName} owes` : "you owe"}
                </span>
                <span
                  className="flex-none rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider"
                  style={{
                    background: isEmail
                      ? "var(--color-background-info)"
                      : "var(--color-background-warning)",
                    color: isEmail
                      ? "var(--color-text-info)"
                      : "var(--color-text-warning)",
                  }}
                >
                  {isEmail ? "email" : theirs ? "waiting" : "prepare"}
                </span>
                {showCompany && t.company && (
                  <Link
                    href={t.company_id ? `/crm/${t.company_id}` : "/crm/board?tab=clients"}
                    className="flex-none font-mono text-[0.58rem] text-sky hover:text-amber hover:underline"
                  >
                    {t.company}
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => beginEdit(t)}
                  aria-label="edit commitment"
                  title="edit"
                  className="flex-none font-mono text-[0.58rem] uppercase text-muted transition hover:text-amber"
                >
                  edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(t)}
                  aria-label="dismiss"
                  title="dismiss"
                  className="flex-none font-mono text-[0.7rem] text-muted transition hover:text-rust"
                >
                  ✕
                </button>
              </div>

              {open && (
                <div className="mt-2 rounded-lg border border-edge bg-ink/50 p-3">
                  <div className="mb-2 flex flex-wrap items-end gap-3">
                    <label className="block">
                      <span className="mb-1 block font-mono text-[0.52rem] uppercase tracking-wider text-muted">
                        Owner
                      </span>
                      <span className="block rounded-md border border-edge bg-ink/60 px-3 py-2 font-sans text-[0.78rem] text-bone">
                        {ownerName}
                      </span>
                    </label>
                    <label className="block">
                      <span className="mb-1 block font-mono text-[0.52rem] uppercase tracking-wider text-muted">
                        Due date
                      </span>
                      <input
                        type="date"
                        value={dueDraft}
                        onChange={(e) => setDueDraft(e.target.value)}
                        className="rounded-md border border-edge bg-ink/60 px-3 py-2 font-sans text-[0.78rem] text-bone outline-none focus:border-sky/60"
                      />
                    </label>
                  </div>
                  {isEmail ? (
                    <>
                      <input
                        value={draft.subject || ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, subject: e.target.value }))
                        }
                        placeholder="Subject"
                        className="mb-2 w-full rounded-md border border-edge bg-ink/60 px-3 py-2 font-sans text-[0.8rem] text-bone outline-none placeholder:text-muted/50 focus:border-sky/60"
                      />
                      <textarea
                        value={draft.body || ""}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, body: e.target.value }))
                        }
                        rows={8}
                        placeholder="Draft the user can edit, then send."
                        className="w-full resize-y rounded-md border border-edge bg-ink/60 px-3 py-2 font-sans text-[0.82rem] leading-relaxed text-bone outline-none placeholder:text-muted/50 focus:border-sky/60"
                      />
                    </>
                  ) : theirs ? (
                    <p className="rounded-md border border-rust/25 bg-rust/[0.04] px-3 py-2 font-sans text-[0.8rem] leading-relaxed text-bone/75">
                      Waiting for {ownerName}. Add or correct the due date, then
                      mark it received when they deliver.
                    </p>
                  ) : (
                    <textarea
                      value={draft.notes || ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, notes: e.target.value }))
                      }
                      rows={6}
                      placeholder="What to prepare for this commitment."
                      className="w-full resize-y rounded-md border border-edge bg-ink/60 px-3 py-2 font-sans text-[0.82rem] leading-relaxed text-bone outline-none placeholder:text-muted/50 focus:border-sky/60"
                    />
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {!theirs && <VoiceNoteButton
                      onText={(tx) =>
                        setDraft((d) =>
                          isEmail
                            ? { ...d, body: d.body ? `${d.body} ${tx}` : tx }
                            : { ...d, notes: d.notes ? `${d.notes} ${tx}` : tx }
                        )
                      }
                    />}
                    {!theirs && <button
                      type="button"
                      onClick={() => saveDraft(t)}
                      disabled={saving}
                      className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber disabled:opacity-40"
                    >
                      {saving ? "saving…" : "save edit"}
                    </button>}
                    <button
                      type="button"
                      onClick={copyDraft}
                      className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
                    >
                      {copied ? "copied" : "copy"}
                    </button>
                    {isEmail && (
                      <a
                        href={gmailUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-sky/60 bg-sky/15 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/25"
                      >
                        open in gmail
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => complete(t)}
                      className="ml-auto rounded-full border border-sage/60 bg-sage/15 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-sage transition hover:bg-sage/25"
                    >
                      ✓ {theirs ? "received" : "done"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
