"use client";

import { useEffect, useState } from "react";
import { crmFetch, getCached } from "@/lib/crm";
import VoiceNoteButton from "@/components/VoiceNoteButton";

type Payload = {
  actionType?: string; // "email" | "task"
  subject?: string;
  body?: string;
  notes?: string;
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
    (t) => t.kind === "commitment" && t.status !== "done"
  );
  const [items, setItems] = useState<Task[]>(seed);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Payload>({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () =>
    crmFetch<{ tasks: Task[] }>(url)
      .then((d) =>
        setItems(
          (d.tasks || []).filter(
            (t) => t.kind === "commitment" && t.status !== "done"
          )
        )
      )
      .catch(() => {});

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
  };

  const saveDraft = async (t: Task) => {
    setSaving(true);
    try {
      await crmFetch(`/api/crm/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ payload: { ...(t.payload || {}), ...draft } }),
      });
      setItems((p) =>
        p.map((x) =>
          x.id === t.id ? { ...x, payload: { ...(x.payload || {}), ...draft } } : x
        )
      );
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const complete = (t: Task) => {
    setItems((p) => p.filter((x) => x.id !== t.id));
    if (openId === t.id) setOpenId(null);
    crmFetch(`/api/crm/tasks/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    }).catch(() => {});
  };

  const remove = (t: Task) => {
    // Dismiss across the whole pipeline (kept as a row so the jobs don't
    // re-create it from the same email or call).
    setItems((p) => p.filter((x) => x.id !== t.id));
    if (openId === t.id) setOpenId(null);
    crmFetch(`/api/crm/tasks/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "dismissed" }),
    }).catch(() => {});
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

  return (
    <div className="mb-3 rounded-xl border border-sky/40 bg-sky/[0.05] p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
          {"✓"} You promised{" "}
          <span className="text-muted">
            - {items.length} to approve &amp; send
          </span>
        </p>
      </div>

      <ul className="flex flex-col">
        {items.map((t) => {
          const open = openId === t.id;
          const isEmail = (t.payload?.actionType || "task") === "email";
          return (
            <li
              key={t.id}
              className="border-b border-edge/40 py-2 last:border-none"
            >
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => complete(t)}
                  title="mark done"
                  className="flex h-4 w-4 flex-none items-center justify-center rounded border border-muted text-[0.6rem] transition hover:border-sage"
                />
                <button
                  type="button"
                  onClick={() => expand(t)}
                  className="flex-1 text-left font-sans text-[0.84rem] leading-snug text-bone transition hover:text-amber"
                >
                  {t.text}
                </button>
                {dueBadge(t.due_at)}
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
                  {isEmail ? "email" : "prepare"}
                </span>
                {showCompany && t.company && (
                  <span className="flex-none font-mono text-[0.58rem] text-sky">
                    {t.company}
                  </span>
                )}
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
                    <VoiceNoteButton
                      onText={(tx) =>
                        setDraft((d) =>
                          isEmail
                            ? { ...d, body: d.body ? `${d.body} ${tx}` : tx }
                            : { ...d, notes: d.notes ? `${d.notes} ${tx}` : tx }
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() => saveDraft(t)}
                      disabled={saving}
                      className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber disabled:opacity-40"
                    >
                      {saving ? "saving…" : "save edit"}
                    </button>
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
                      ✓ done
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
