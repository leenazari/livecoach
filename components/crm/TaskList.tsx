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
  // Set on prep to-dos derived from an upcoming client call.
  upcoming_id?: string | null;
  scheduled_at?: string | null;
  meeting_url?: string | null;
  intent?: string | null;
  due_soon?: boolean;
};

// "today 14:00" / "Tue 14:00" for a prep to-do's call time.
const whenLabel = (iso?: string | null) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === new Date().toDateString()) return `today ${t}`;
    return `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
  } catch {
    return "";
  }
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

  // Refresh when something elsewhere creates to-dos (the assistant, or the
  // post-call voice debrief) so new items appear without a manual reload.
  useEffect(() => {
    const onUpd = () =>
      crmFetch<{ tasks: Task[] }>(url)
        .then((d) => setTasks(d.tasks || []))
        .catch(() => {});
    window.addEventListener("lc:tasks-updated", onUpd);
    return () => window.removeEventListener("lc:tasks-updated", onUpd);
  }, [url]);

  // Tick / un-tick (toggle done). Never deletes - that's the ✕.
  const toggle = (t: Task) => {
    // A prep to-do is derived from an upcoming call: ticking it marks that call
    // prepped, which drops it off the list, rather than writing a tasks row.
    if (t.upcoming_id) {
      crmFetch(`/api/crm/upcoming/${t.upcoming_id}`, {
        method: "PATCH",
        body: JSON.stringify({ prepped: true }),
      }).catch(() => {});
      setTasks((p) => p.filter((x) => x.id !== t.id));
      return;
    }
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
          detail: {
            companyId: t.company_id,
            companyName: t.company,
            text: t.text,
            taskId: t.id,
          },
        })
      );
      return;
    }
    if (a === "call") {
      const q = new URLSearchParams();
      if (t.company_id) q.set("company", t.company_id);
      if (t.company) q.set("companyName", t.company);
      // Prefer the call's own intent; only fall back to the task text for a
      // plain manual call task (not a "Prep: ..." label).
      const intentVal = t.intent || (t.upcoming_id ? "" : t.text);
      if (intentVal) q.set("intent", intentVal);
      if (t.meeting_url) q.set("meetingUrl", t.meeting_url);
      // Tie it to the scheduled call so the plan saves + reloads against it.
      if (t.upcoming_id) q.set("upcoming", t.upcoming_id);
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

            {t.upcoming_id && t.scheduled_at && (
              <span
                title={t.due_soon ? "within 48 hours - prep now" : "upcoming call"}
                className={`flex-none rounded-full px-2 py-0.5 font-mono text-[0.54rem] uppercase tracking-wider ${
                  t.due_soon
                    ? "border border-amber/60 bg-amber/15 text-amber"
                    : "border border-edge text-muted"
                }`}
              >
                {t.due_soon ? "▲ " : ""}
                {whenLabel(t.scheduled_at)}
              </span>
            )}
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

            {/* Prep to-dos are derived from the call, so there's no row to
                delete - you complete them by ticking (marks the call prepped)
                or they roll off once the call has passed. */}
            {!t.upcoming_id && (
              <button
                type="button"
                onClick={() => remove(t)}
                aria-label="remove task"
                title="remove"
                className="flex-none font-mono text-[0.7rem] text-muted transition hover:text-rust"
              >
                ✕
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
