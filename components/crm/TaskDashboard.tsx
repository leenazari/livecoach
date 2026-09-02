"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import MatrixRain from "@/components/MatrixRain";
import TaskComposer from "@/components/crm/TaskComposer";
import {
  crmConfirmationError,
  crmFetch,
  getCached,
  setCached,
} from "@/lib/crm";
import {
  outreachProspectHref,
  outreachReplyHref,
} from "@/lib/crm-navigation";
import {
  followUpAtFromLocalParts,
  followUpAtIsPast,
  localDateInputValue,
} from "@/lib/follow-up-scheduling";
import {
  countTaskDashboard,
  sortTaskDashboard,
  taskDueValue,
  taskMatchesDashboardView,
  taskTimeBucket,
  type TaskDashboardItem,
  type TaskDashboardView,
} from "@/lib/task-dashboard";
import { capitaliseSentenceStarts } from "@/lib/text";

type Task = TaskDashboardItem & {
  company_id: string | null;
  company: string | null;
  text: string;
  kind: string;
  link_kind: string | null;
  meeting_url?: string | null;
  intent?: string | null;
  due_soon?: boolean;
  payload?: {
    pinned?: boolean;
    scheduledTime?: boolean;
    outreachProspectId?: string | null;
    prospectName?: string | null;
    companyName?: string | null;
    approaches?: string[];
    [key: string]: unknown;
  } | null;
};

type TaskTypeFilter = "all" | "task" | "call" | "email";

const TASKS_URL = "/api/crm/tasks?view=dashboard";
const input =
  "min-h-11 w-full rounded-lg border border-edge bg-ink/55 px-3 py-2.5 text-sm text-bone outline-none placeholder:text-muted/55 focus:border-amber/60";
const button =
  "min-h-10 rounded-lg border border-edge px-3 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:border-amber/55 hover:text-amber disabled:cursor-wait disabled:opacity-40";

const taskType = (task: Task): Exclude<TaskTypeFilter, "all"> => {
  if (task.upcoming_id || task.link_kind === "call") return "call";
  if (task.link_kind === "email" || task.link_kind === "drafts") return "email";
  return "task";
};

const taskTypeLabel = (task: Task) => {
  if (task.upcoming_id) return "call prep";
  if (task.link_kind === "call") return "call";
  if (task.link_kind === "email") return "email";
  if (task.link_kind === "drafts") return "draft";
  return "task";
};

const formatWhen = (value: string, includeTime: boolean) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "No date";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    ...(includeTime
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : {}),
  });
};

const dueLabel = (task: Task, now: Date) => {
  const value = taskDueValue(task);
  if (!value) return { label: "No date", tone: "muted" as const };
  const bucket = taskTimeBucket(task, now);
  const includeTime =
    Boolean(task.upcoming_id) || task.payload?.scheduledTime === true;
  const when = formatWhen(value, includeTime);
  if (bucket === "overdue") {
    return { label: `Overdue · ${when}`, tone: "rust" as const };
  }
  if (bucket === "today") {
    return { label: `Today · ${when}`, tone: "amber" as const };
  }
  return { label: when, tone: "muted" as const };
};

const dueParts = (task: Task) => {
  if (!task.due_at) return { date: "", time: "" };
  const due = new Date(task.due_at);
  if (!Number.isFinite(due.getTime())) return { date: "", time: "" };
  return {
    date: localDateInputValue(due),
    time:
      task.payload?.scheduledTime === true
        ? `${String(due.getHours()).padStart(2, "0")}:${String(
            due.getMinutes()
          ).padStart(2, "0")}`
        : "",
  };
};

const contextHref = (task: Task) =>
  task.payload?.outreachProspectId
    ? task.kind === "reply_alert" ||
      (task.kind === "email_alert" && task.payload?.replyRecommended === true)
      ? outreachReplyHref(task.payload.outreachProspectId)
      : outreachProspectHref({ id: task.payload.outreachProspectId })
    : task.company_id
      ? `/crm/${task.company_id}`
      : null;

export default function TaskDashboard() {
  const router = useRouter();
  const cached = getCached<{ tasks: Task[] }>(TASKS_URL);
  const [tasks, setTasks] = useState<Task[]>(cached?.tasks || []);
  const [loading, setLoading] = useState(!cached);
  const [view, setView] = useState<TaskDashboardView>("open");
  const [typeFilter, setTypeFilter] = useState<TaskTypeFilter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [clock, setClock] = useState(() => new Date());
  const [busyId, setBusyId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editText, setEditText] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const showTasks = useCallback((next: Task[]) => {
    setTasks(next);
  }, []);

  useEffect(() => {
    setCached(TASKS_URL, { tasks });
  }, [tasks]);

  const load = useCallback(async () => {
    try {
      const result = await crmFetch<{ tasks: Task[] }>(TASKS_URL);
      showTasks(result.tasks || []);
      setError("");
    } catch (reason: any) {
      setError(reason?.message || "Your tasks could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [showTasks]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onTasksUpdated = (event: Event) => {
      if (
        event instanceof CustomEvent &&
        event.detail?.source === "tasks-dashboard"
      ) {
        return;
      }
      void load();
    };
    const onFocus = () => void load();
    window.addEventListener("lc:tasks-updated", onTasksUpdated);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("lc:tasks-updated", onTasksUpdated);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const savedEverywhere = () => {
    window.dispatchEvent(
      new CustomEvent("lc:tasks-updated", {
        detail: { source: "tasks-dashboard" },
      })
    );
    window.dispatchEvent(new CustomEvent("lc:crm-updated"));
  };

  const mergeTask = (saved: Partial<Task> & { id: string }) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === saved.id ? { ...task, ...saved } : task
      )
    );
  };

  const changeStatus = async (task: Task) => {
    if (busyId) return;
    setBusyId(task.id);
    setError("");
    setNotice("");
    try {
      if (task.upcoming_id) {
        const result = await crmFetch<{ call: { prepped: boolean } }>(
          `/api/crm/upcoming/${task.upcoming_id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ prepped: true }),
          }
        );
        if (result.call?.prepped !== true) {
          throw crmConfirmationError({
            url: `/api/crm/upcoming/${task.upcoming_id}`,
            method: "PATCH",
            reason: "LiveCoach did not confirm that the call preparation was completed",
          });
        }
        setTasks((current) =>
          current.filter((item) => item.id !== task.id)
        );
        setNotice("Call preparation marked complete everywhere.");
      } else {
        const status = task.status === "done" ? "open" : "done";
        const result = await crmFetch<{ task: Task }>(
          `/api/crm/tasks/${task.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({ status }),
          }
        );
        if (result.task?.status !== status) {
          throw crmConfirmationError({
            url: `/api/crm/tasks/${task.id}`,
            method: "PATCH",
            reason: "LiveCoach returned a different task status",
          });
        }
        mergeTask(result.task);
        setNotice(
          status === "done"
            ? "Task completed. Today and every linked CRM view are updated."
            : "Task reopened and returned to the live work list."
        );
      }
      savedEverywhere();
    } catch (reason: any) {
      setError(reason?.message || "That task status did not save.");
    } finally {
      setBusyId("");
    }
  };

  const toggleFlag = async (task: Task) => {
    if (busyId || task.upcoming_id) return;
    const pinned = task.payload?.pinned !== true;
    const payload = { ...(task.payload || {}), pinned };
    setBusyId(task.id);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{ task: Task }>(
        `/api/crm/tasks/${task.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ payload }),
        }
      );
      if (Boolean(result.task?.payload?.pinned) !== pinned) {
        throw crmConfirmationError({
          url: `/api/crm/tasks/${task.id}`,
          method: "PATCH",
          reason: "LiveCoach returned a different priority flag",
        });
      }
      mergeTask(result.task);
      setNotice(
        pinned
          ? "Task flagged as a priority everywhere."
          : "Priority flag removed everywhere."
      );
      savedEverywhere();
    } catch (reason: any) {
      setError(reason?.message || "That priority flag did not save.");
    } finally {
      setBusyId("");
    }
  };

  const beginEdit = (task: Task) => {
    const parts = dueParts(task);
    setEditingId(task.id);
    setEditText(task.text);
    setEditDate(parts.date);
    setEditTime(parts.time);
    setError("");
    setNotice("");
  };

  const cancelEdit = () => {
    setEditingId("");
    setEditText("");
    setEditDate("");
    setEditTime("");
  };

  const saveEdit = async (task: Task) => {
    if (busyId) return;
    const text = editText.trim();
    if (text.length < 3) {
      setError("Add what needs to be done before saving.");
      return;
    }
    if (editTime && !editDate) {
      setError("Choose a due date for that time.");
      return;
    }
    const dueAt = editDate
      ? editTime
        ? followUpAtFromLocalParts(editDate, editTime)
        : editDate
      : null;
    if (editDate && !dueAt) {
      setError("Choose a valid due date and time.");
      return;
    }
    if (dueAt && editTime && followUpAtIsPast(dueAt)) {
      setError("Choose a due time that has not already passed.");
      return;
    }
    setBusyId(task.id);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<{ task: Task }>(
        `/api/crm/tasks/${task.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ text, dueAt }),
        }
      );
      if (!result.task?.id || result.task.text !== text) {
        throw crmConfirmationError({
          url: `/api/crm/tasks/${task.id}`,
          method: "PATCH",
          reason: "LiveCoach did not confirm the edited task",
        });
      }
      mergeTask(result.task);
      cancelEdit();
      setNotice("Task and timing updated everywhere.");
      savedEverywhere();
    } catch (reason: any) {
      setError(reason?.message || "That task edit did not save.");
    } finally {
      setBusyId("");
    }
  };

  const startTask = (task: Task) => {
    const prospectHref = task.payload?.outreachProspectId
      ? task.kind === "reply_alert" ||
        (task.kind === "email_alert" && task.payload?.replyRecommended === true)
        ? outreachReplyHref(task.payload.outreachProspectId)
        : outreachProspectHref({ id: task.payload.outreachProspectId })
      : null;
    if (task.link_kind === "email" || task.link_kind === "drafts") {
      if (!task.company_id && prospectHref) return router.push(prospectHref);
      window.dispatchEvent(
        new CustomEvent("lc:draft-email", {
          detail: {
            companyId: task.company_id,
            companyName: task.company,
            text: task.text,
            taskId: task.id,
          },
        })
      );
      return;
    }
    if (task.upcoming_id || task.link_kind === "call") {
      if (!task.company_id && prospectHref) return router.push(prospectHref);
      const query = new URLSearchParams();
      if (task.company_id) query.set("company", task.company_id);
      if (task.company) query.set("companyName", task.company);
      const intent = task.intent || (task.upcoming_id ? "" : task.text);
      if (intent) query.set("intent", intent);
      if (task.meeting_url) query.set("meetingUrl", task.meeting_url);
      if (task.upcoming_id) query.set("upcoming", task.upcoming_id);
      return router.push(`/call?${query.toString()}`);
    }
    const href = contextHref(task);
    if (href) router.push(href);
  };

  const counts = useMemo(
    () => countTaskDashboard(tasks, clock),
    [clock, tasks]
  );

  const shown = useMemo(() => {
    const matching = tasks.filter((task) => {
      if (!taskMatchesDashboardView(task, view, clock)) return false;
      if (typeFilter !== "all" && taskType(task) !== typeFilter) return false;
      if (!deferredSearch) return true;
      const haystack = [
        task.text,
        task.company,
        task.payload?.prospectName,
        task.payload?.companyName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(deferredSearch);
    });
    return sortTaskDashboard(matching);
  }, [clock, deferredSearch, tasks, typeFilter, view]);

  const viewOptions: {
    id: TaskDashboardView;
    label: string;
    count: number;
  }[] = [
    { id: "open", label: "All open", count: counts.open },
    { id: "flagged", label: "Flagged", count: counts.flagged },
    { id: "overdue", label: "Overdue", count: counts.overdue },
    { id: "today", label: "Today", count: counts.today },
    { id: "upcoming", label: "Upcoming", count: counts.upcoming },
    { id: "no_date", label: "No date", count: counts.no_date },
    { id: "completed", label: "Completed", count: counts.completed },
  ];

  const headlineCards: {
    id: TaskDashboardView;
    label: string;
    count: number;
    note: string;
    tone: string;
  }[] = [
    {
      id: "open",
      label: "Open tasks",
      count: counts.open,
      note: "Your complete live list",
      tone: "text-bone",
    },
    {
      id: "overdue",
      label: "Overdue",
      count: counts.overdue,
      note: counts.overdue ? "Needs a decision" : "Nothing slipping",
      tone: counts.overdue ? "text-rust" : "text-sage",
    },
    {
      id: "today",
      label: "Due today",
      count: counts.today,
      note: `${counts.completedToday} completed today`,
      tone: "text-amber",
    },
    {
      id: "flagged",
      label: "Flagged",
      count: counts.flagged,
      note: "Protected priorities",
      tone: "text-sky",
    },
  ];

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Task summary">
        {headlineCards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => setView(card.id)}
            aria-pressed={view === card.id}
            className={`rounded-xl border p-4 text-left transition ${
              view === card.id
                ? "border-amber/60 bg-amber/[0.08]"
                : "border-edge bg-panel/45 hover:border-amber/35"
            }`}
          >
            <p className="font-mono text-[0.53rem] uppercase tracking-[0.16em] text-muted">
              {card.label}
            </p>
            <p className={`mt-2 font-display text-3xl ${card.tone}`}>
              {card.count}
            </p>
            <p className="mt-1 text-xs text-muted">{card.note}</p>
          </button>
        ))}
      </section>

      <section className="mt-4 rounded-2xl border border-edge bg-panel/35 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-bone">Your task list</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              This is the same live list used by Today, Calls, clients, opportunities and Outreach. Complete, flag or edit it here and every view follows.
            </p>
          </div>
          <TaskComposer />
        </div>

        <div className="mt-4 flex flex-wrap gap-2" aria-label="Task views">
          {viewOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              aria-pressed={view === option.id}
              className={`min-h-10 rounded-full border px-3 font-mono text-[0.54rem] uppercase tracking-wider transition ${
                view === option.id
                  ? "border-amber/60 bg-amber/15 text-amber"
                  : "border-edge text-muted hover:border-amber/35 hover:text-bone"
              }`}
            >
              {option.label} · {option.count}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
          <label>
            <span className="sr-only">Search tasks</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search task, client or prospect…"
              className={input}
            />
          </label>
          <label>
            <span className="sr-only">Filter by task type</span>
            <select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value as TaskTypeFilter)
              }
              className={input}
            >
              <option value="all">All task types</option>
              <option value="task">General tasks</option>
              <option value="call">Calls and follow-ups</option>
              <option value="email">Emails and drafts</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={button}
          >
            Refresh
          </button>
        </div>

        {notice ? (
          <p role="status" className="mt-3 rounded-lg border border-sage/35 bg-sage/10 px-3 py-2 text-sm text-sage">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm text-rust">
            {error}
          </p>
        ) : null}

        {loading ? (
          <MatrixRain
            size="panel"
            className="mt-4"
            messages={["loading your task dashboard", "checking the live work list"]}
          />
        ) : shown.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-edge px-5 py-10 text-center">
            <p className="font-mono text-[0.62rem] uppercase tracking-wider text-bone">
              No matching tasks
            </p>
            <p className="mt-2 text-sm text-muted">
              Change the filter or log a task above. Nothing has been removed.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {shown.map((task) => {
              const done = task.status === "done";
              const pinned = task.payload?.pinned === true;
              const due = dueLabel(task, clock);
              const href = contextHref(task);
              const person = task.payload?.prospectName;
              const company = task.company || task.payload?.companyName;
              const canStart = Boolean(
                href ||
                  task.upcoming_id ||
                  task.link_kind === "call" ||
                  task.link_kind === "email" ||
                  task.link_kind === "drafts"
              );
              return (
                <article
                  key={task.id}
                  className={`rounded-xl border px-3 py-3 transition sm:px-4 ${
                    pinned && !done
                      ? "border-amber/45 bg-amber/[0.055]"
                      : "border-edge bg-ink/25"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => void changeStatus(task)}
                      disabled={busyId === task.id}
                      aria-label={
                        done
                          ? `Reopen ${task.text}`
                          : `Mark ${task.text} complete`
                      }
                      aria-pressed={done}
                      className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full border font-mono text-xs transition ${
                        done
                          ? "border-sage bg-sage text-ink"
                          : "border-muted text-transparent hover:border-sage hover:text-sage"
                      } disabled:opacity-40`}
                    >
                      ✓
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-[0.94rem] leading-6 ${
                              done ? "text-muted line-through" : "text-bone"
                            }`}
                          >
                            {capitaliseSentenceStarts(task.text)}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                              {taskTypeLabel(task)}
                            </span>
                            {!done ? (
                              <span
                                className={`rounded-full border px-2 py-0.5 font-mono text-[0.5rem] uppercase tracking-wider ${
                                  due.tone === "rust"
                                    ? "border-rust/55 bg-rust/10 text-rust"
                                    : due.tone === "amber"
                                      ? "border-amber/50 bg-amber/10 text-amber"
                                      : "border-edge text-muted"
                                }`}
                              >
                                {due.label}
                              </span>
                            ) : task.done_at ? (
                              <span className="font-mono text-[0.52rem] uppercase tracking-wider text-sage">
                                Completed {formatWhen(task.done_at, true)}
                              </span>
                            ) : null}
                            {person ? (
                              <span className="text-xs text-sky">{person}</span>
                            ) : null}
                            {company ? (
                              href ? (
                                <Link
                                  href={href}
                                  className="text-xs text-sky hover:text-amber hover:underline"
                                >
                                  {company}
                                </Link>
                              ) : (
                                <span className="text-xs text-muted">{company}</span>
                              )
                            ) : null}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {!done && !task.upcoming_id ? (
                            <button
                              type="button"
                              onClick={() => void toggleFlag(task)}
                              disabled={busyId === task.id}
                              aria-label={
                                pinned
                                  ? `Remove priority flag from ${task.text}`
                                  : `Flag ${task.text} as a priority`
                              }
                              aria-pressed={pinned}
                              className={`min-h-10 rounded-lg border px-3 font-mono text-sm transition ${
                                pinned
                                  ? "border-amber/55 bg-amber/10 text-amber"
                                  : "border-edge text-muted hover:border-amber/45 hover:text-amber"
                              } disabled:opacity-40`}
                              title={pinned ? "Remove priority flag" : "Flag as priority"}
                            >
                              {pinned ? "★" : "☆"}
                            </button>
                          ) : null}
                          {!done && !task.upcoming_id ? (
                            <button
                              type="button"
                              onClick={() => beginEdit(task)}
                              disabled={busyId === task.id}
                              className={button}
                            >
                              Edit
                            </button>
                          ) : null}
                          {!done && canStart ? (
                            <button
                              type="button"
                              onClick={() => startTask(task)}
                              disabled={busyId === task.id}
                              className="min-h-10 rounded-lg border border-sky/45 bg-sky/10 px-3 font-mono text-[0.56rem] uppercase tracking-wider text-sky transition hover:bg-sky/15 disabled:opacity-40"
                            >
                              Start ↗
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {editingId === task.id ? (
                        <div className="mt-3 rounded-lg border border-amber/35 bg-ink/50 p-3">
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_9rem]">
                            <label>
                              <span className="mb-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                                What needs to be done
                              </span>
                              <input
                                value={editText}
                                onChange={(event) => setEditText(event.target.value)}
                                maxLength={500}
                                className={input}
                              />
                            </label>
                            <label>
                              <span className="mb-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                                Due date
                              </span>
                              <input
                                type="date"
                                min={localDateInputValue()}
                                value={editDate}
                                onChange={(event) => setEditDate(event.target.value)}
                                className={input}
                              />
                            </label>
                            <label>
                              <span className="mb-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                                Due time
                              </span>
                              <input
                                type="time"
                                value={editTime}
                                onChange={(event) => setEditTime(event.target.value)}
                                className={input}
                              />
                            </label>
                          </div>
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={busyId === task.id}
                              className={button}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void saveEdit(task)}
                              disabled={busyId === task.id}
                              className="min-h-10 rounded-lg border border-amber/55 bg-amber/10 px-4 font-mono text-[0.56rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:opacity-40"
                            >
                              {busyId === task.id ? "Saving…" : "Save changes"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
