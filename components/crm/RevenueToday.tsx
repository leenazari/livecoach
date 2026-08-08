"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { crmFetch } from "@/lib/crm";

type TodayItem = {
  id: string;
  text: string;
  company?: string | null;
  at?: string | number | null;
  href: string;
  reason?: string;
  entity?: "task";
};

type TodayData = {
  today?: {
    topActions?: TodayItem[];
    interestedReplies?: TodayItem[];
    approvedOutreach?: TodayItem[];
    callsToPrep?: TodayItem[];
    primaryOpportunityActions?: TodayItem[];
    overduePromises?: TodayItem[];
    coolingDeals?: TodayItem[];
  };
};

const taskGroups = [
  "topActions",
  "interestedReplies",
  "approvedOutreach",
  "callsToPrep",
  "primaryOpportunityActions",
  "overduePromises",
  "coolingDeals",
] as const;

const changeTask = (
  current: TodayData | null,
  id: string,
  change: (item: TodayItem) => TodayItem | null
) => {
  if (!current?.today) return current;
  const today = { ...current.today };
  for (const key of taskGroups) {
    today[key] = (today[key] || [])
      .map((item) => (item.id === id && item.entity === "task" ? change(item) : item))
      .filter(Boolean) as TodayItem[];
  }
  return { ...current, today };
};

const shortDate = (value?: string | number | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function RevenueToday() {
  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");
  const loadSeq = useRef(0);
  const closedIds = useRef(new Set<string>());

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      let next: TodayData | null = await crmFetch<TodayData>("/api/crm/dashboard?light=1");
      if (seq !== loadSeq.current) return;
      for (const id of closedIds.current) next = changeTask(next, id, () => null);
      setData(next);
      setError("");
    } catch {
      setError("The combined priority list could not refresh.");
    }
  }, []);

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener("lc:tasks-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("lc:tasks-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const saveTask = async (
    item: TodayItem,
    change: { text?: string; status?: "done" | "dismissed" }
  ) => {
    const previous = data;
    loadSeq.current += 1;
    if (change.status) {
      closedIds.current.add(item.id);
      setData((current) => changeTask(current, item.id, () => null));
    } else if (change.text) {
      setData((current) => changeTask(current, item.id, (task) => ({ ...task, text: change.text! })));
    }
    setSavingId(item.id);
    setError("");
    try {
      const result = await crmFetch<{ task: { id: string; text: string; status: string } }>(`/api/crm/tasks/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      });
      if (change.status && result.task?.status !== change.status)
        throw new Error("status not saved");
      if (change.text && result.task?.text !== change.text)
        throw new Error("text not saved");
      setEditingId("");
      window.dispatchEvent(new CustomEvent("lc:tasks-updated"));
    } catch {
      closedIds.current.delete(item.id);
      setData(previous);
      setError("That change did not save. Please try again.");
    } finally {
      setSavingId("");
    }
  };

  const groups = data?.today
    ? [
        ["Interested replies", data.today.interestedReplies || [], "text-moss"],
        ["Approved to send", data.today.approvedOutreach || [], "text-amber"],
        ["Calls to prepare", data.today.callsToPrep || [], "text-sky"],
        ["Deal next actions", data.today.primaryOpportunityActions || [], "text-amber"],
        ["Overdue promises", data.today.overduePromises || [], "text-rust"],
        ["Cooling deals", data.today.coolingDeals || [], "text-muted"],
      ] as const
    : [];
  const actions = data?.today?.topActions || [];

  return (
    <section className="mb-4 rounded-2xl border border-amber/45 bg-gradient-to-br from-amber/[0.09] to-transparent p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-amber">
            ◆ Revenue today
          </p>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-bone/65">
            One ranked list across outreach, replies, calls, promises and live opportunities.
          </p>
        </div>
        <span className="rounded-full border border-edge px-2.5 py-1 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
          no AI cost
        </span>
      </div>

      {error ? (
        <p className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">
          {error}
        </p>
      ) : null}

      {!data ? (
        <p className="rounded-xl border border-edge bg-ink/30 p-4 font-mono text-xs text-muted">
          Ranking today’s work…
        </p>
      ) : actions.length ? (
        <ol className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {actions.map((item, index) => (
            <li key={`${item.reason || "action"}-${item.id}`}>
              <article className="flex h-full flex-col rounded-xl border border-edge bg-ink/55 p-3 transition hover:border-amber/60">
                <p className="mb-1 font-mono text-[0.53rem] uppercase tracking-wider text-amber">
                  {index + 1}. {item.reason || "Priority"}
                </p>
                {editingId === item.id ? (
                  <input
                    autoFocus
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") setEditingId("");
                    }}
                    onBlur={() => {
                      const text = editingText.trim();
                      if (text && text !== item.text) saveTask(item, { text });
                      else setEditingId("");
                    }}
                    className="w-full rounded-md border border-amber/50 bg-ink px-2 py-1 text-sm text-bone outline-none"
                  />
                ) : (
                  <Link href={item.href} className="text-sm leading-5 text-bone hover:text-amber">
                    {item.text}
                  </Link>
                )}
                <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                  <p className="font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                    {item.company || "General"}
                    {item.at ? ` · ${shortDate(item.at)}` : ""}
                  </p>
                  {item.entity === "task" ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={savingId === item.id}
                        onClick={() => {
                          setEditingId(item.id);
                          setEditingText(item.text);
                        }}
                        className="min-h-8 rounded px-2 font-mono text-[0.5rem] uppercase text-muted hover:text-amber disabled:opacity-40"
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        disabled={savingId === item.id}
                        onClick={() => saveTask(item, { status: "done" })}
                        aria-label={`Mark ${item.text} done`}
                        className="min-h-8 min-w-8 rounded text-muted hover:text-sage disabled:opacity-40"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        disabled={savingId === item.id}
                        onClick={() => saveTask(item, { status: "dismissed" })}
                        aria-label={`Dismiss ${item.text}`}
                        className="min-h-8 min-w-8 rounded text-muted hover:text-rust disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </span>
                  ) : null}
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mb-4 rounded-xl border border-sage/30 bg-sage/[0.06] p-3 text-sm text-sage">
          Nothing urgent is waiting. Focus on the planned outreach queue.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        {groups.map(([label, items, colour]) => (
          <Link
            key={label}
            href={items[0]?.href || "/crm/outreach"}
            className="rounded-lg border border-edge/80 bg-panel/35 p-3 transition hover:border-amber/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`font-mono text-[0.49rem] uppercase tracking-wider ${colour}`}>
                {label}
              </span>
              <span className="font-mono text-sm tabular-nums text-bone">{items.length}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-4 text-bone/65">
              {items[0] ? `${items[0].company ? `${items[0].company}: ` : ""}${items[0].text}` : "Clear"}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
