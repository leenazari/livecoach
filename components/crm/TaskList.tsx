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

// A tickable to-do list backed by the tasks table. Tick to complete, click the
// ticked box to remove now (done tasks also auto-clear the next day). Click the
// task text to jump to where you action it.
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

  const complete = (t: Task) => {
    setTasks((p) =>
      p.map((x) =>
        x.id === t.id
          ? { ...x, status: "done", done_at: new Date().toISOString() }
          : x
      )
    );
    crmFetch(`/api/crm/tasks/${t.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    }).catch(() => {});
  };

  const remove = (t: Task) => {
    setTasks((p) => p.filter((x) => x.id !== t.id));
    crmFetch(`/api/crm/tasks/${t.id}`, { method: "DELETE" }).catch(() => {});
  };

  // Where clicking the task text takes you, to start the action.
  const go = (t: Task) => {
    if (t.link_kind === "drafts") return router.push("/crm/board?tab=drafts");
    if (t.link_kind === "call") {
      const qs = t.company_id ? `?company=${t.company_id}` : "";
      return router.push(`/call${qs}`);
    }
    if (t.company_id) return router.push(`/crm/${t.company_id}`);
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
        return (
          <li
            key={t.id}
            className="flex items-start gap-2.5 border-b border-edge/40 py-2 last:border-none"
          >
            <button
              type="button"
              onClick={() => (done ? remove(t) : complete(t))}
              title={done ? "completed - click to remove" : "mark done"}
              className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded border text-[0.6rem] transition ${
                done
                  ? "border-sage bg-sage text-ink"
                  : "border-muted hover:border-sage"
              }`}
            >
              {done ? "✓" : ""}
            </button>
            <span className="flex-1 leading-snug">
              <button
                type="button"
                onClick={() => go(t)}
                className={`text-left font-sans text-[0.84rem] transition hover:text-amber hover:underline ${
                  done ? "text-muted line-through" : "text-bone"
                }`}
              >
                {t.text}
              </button>
              {showCompany && t.company && (
                <span className="ml-1.5 font-mono text-[0.6rem] text-sky">
                  · {t.company}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
