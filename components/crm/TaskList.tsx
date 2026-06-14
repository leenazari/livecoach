"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { crmFetch, getCached } from "@/lib/crm";

type Task = {
  id: string;
  company_id: string | null;
  company: string | null;
  text: string;
  kind: string;
  link_kind: string | null;
  status: string;
  done_at: string | null;
};

// A tickable to-do list backed by the tasks table.
// - Tick the box to mark done; tick again to UN-tick (no data loss).
// - The separate ✕ removes a task for good.
// - Done tasks also auto-clear the next day.
// - Clicking the text starts the action: email -> opens the assistant to draft
//   it, call -> starts a preloaded call, anything else -> opens the client.
export default function TaskList({
  companyId,
  showCompany = false,
  emptyText = "Nothing on your plate. Nice.",
}: {
  companyId?: string;
  showCompany?: boolean;
  emptyText?: string;
}) {
  const router = useRouter();
  const url = `/api/crm/tasks${companyId ? `?companyId=${companyId}` : ""}`;
  const cached = getCached<{ tasks: Task[] }>(url);
  const [tasks, setTasks] = useState<Task[]>(cached?.tasks || []);

  useEffect(() => {
    crmFetch<{ tasks: Task[] }>(url)
      .then((d) => setTasks(d.tasks || []))
      .catch(() => {});
  }, [url]);

  // Tick / un-tick (toggle done). Never deletes - that's the ✕.
  const toggle = (t: Task) => {
    const next = t.status === "done" ? "open" : "done";
    setTasks((p) =>
      p.map((x) =>
        x.id === t.id
          ? { ...x, status: next, done_at: next === "done" ? new Date().toISOString() : null }
          : x
      )
    );
    crmFetch(`/api/crm/tasks/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    }).catch(() => {});
  };

  const remove = (t: Task) => {
    setTasks((p) => p.filter((x) => x.id !== t.id));
    crmFetch(`/api/crm/tasks/${t.id}`, { method: "DELETE" }).catch(() => {});
  };

  // What clicking the task text does, by action.
  const start = (t: Task) => {
    const a = t.link_kind || "task";
    if (a === "email") {
      window.dispatchEvent(
        new CustomEvent("lc:draft-email", {
          detail: { companyId: t.company_id, companyName: t.company, text: t.text },
        })
      );
      return;
    }
    if (a === "call") {
      const q = new URLSearchParams();
      if (t.company_id) q.set("company", t.company_id);
      if (t.company) q.set("companyName", t.company);
      q.set("intent", t.text);
      return router.push(`/call?${q.toString()}`);
    }
    if (a === "drafts") return router.push("/crm/board?tab=drafts");
    // task / client: open the client - unless we're already on that client page.
    if (t.company_id && t.company_id !== companyId) {
      return router.push(`/crm/${t.company_id}`);
    }
  };

  const chip = (a: string | null) => {
    if (a === "email")
      return { label: "draft email", icon: "ti-mail", bg: "var(--color-background-info)", fg: "var(--color-text-info)" };
    if (a === "call")
      return { label: "prep call", icon: "ti-player-play", bg: "var(--color-background-warning)", fg: "var(--color-text-warning)" };
    if (a === "drafts")
      return { label: "draft", icon: "ti-mail", bg: "var(--color-background-info)", fg: "var(--color-text-info)" };
    return null;
  };

  const actionable = (t: Task) => {
    const a = t.link_kind || "task";
    if (a === "email" || a === "call" || a === "drafts") return true;
    return !!(t.company_id && t.company_id !== companyId);
  };

  if (tasks.length === 0) {
    return (
      <p className="font-mono text-[0.62rem] leading-relaxed text-muted">
        {emptyText}
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {tasks.map((t) => {
        const done = t.status === "done";
        const c = chip(t.link_kind);
        const canClick = actionable(t);
        return (
          <li
            key={t.id}
            className="flex items-center gap-2.5 border-b border-edge/40 py-2 last:border-none"
          >
            <button
              type="button"
              onClick={() => toggle(t)}
              title={done ? "tick to un-complete" : "mark done"}
              className={`flex h-4 w-4 flex-none items-center justify-center rounded border text-[0.6rem] transition ${
                done
                  ? "border-sage bg-sage text-ink"
                  : "border-muted hover:border-sage"
              }`}
            >
              {done ? "✓" : ""}
            </button>

            <button
              type="button"
              onClick={() => canClick && start(t)}
              disabled={!canClick}
              className={`flex-1 text-left font-sans text-[0.84rem] leading-snug transition ${
                done
                  ? "text-muted line-through"
                  : canClick
                  ? "text-bone hover:text-amber hover:underline"
                  : "cursor-default text-bone"
              }`}
            >
              {t.text}
            </button>

            {c && !done && (
              <span
                className="flex-none rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider"
                style={{ background: c.bg, color: c.fg }}
              >
                <i className={`ti ${c.icon}`} aria-hidden="true" /> {c.label}
              </span>
            )}
            {showCompany && t.company && (
              <span className="flex-none font-mono text-[0.58rem] text-sky">
                {t.company}
              </span>
            )}

            <button
              type="button"
              onClick={() => remove(t)}
              aria-label="remove task"
              title="remove"
              className="flex-none font-mono text-[0.7rem] text-muted transition hover:text-rust"
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}
