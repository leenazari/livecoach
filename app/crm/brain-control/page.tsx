"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import MatrixRain from "@/components/MatrixRain";
import NavMenu from "@/components/crm/NavMenu";
import { BRAIN_WIDGETS } from "@/lib/brain-control-shared";
import { crmFetch, getCached } from "@/lib/crm";

type Tab =
  | "overview"
  | "routines"
  | "plays"
  | "trust"
  | "work"
  | "pages"
  | "learning"
  | "costs";

type BrainSnapshot = {
  generatedAt: string;
  currentUserId: string;
  role: "owner" | "manager" | "sales";
  members: Array<{
    userId: string;
    role: "owner" | "manager" | "sales";
    displayName: string;
    email: string | null;
  }>;
  plays: any[];
  trustRules: any[];
  routines: any[];
  runs: any[];
  pages: any[];
  learnings: any[];
  actionReceipts: any[];
  actionExecutions: any[];
  costs: {
    currency: "GBP";
    forecastThisMonth: number;
    actualThisMonth: number;
    routines: Array<{
      routineId: string;
      name: string;
      scheduleMode: string;
      runsPerMonth: number;
      estimatedPerRun: number;
      hardCapPerRun: number;
      forecastPerMonth: number;
    }>;
  };
};

const API = "/api/crm/brain-control";
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "routines", label: "Routines", icon: "↻" },
  { id: "plays", label: "Sales plays", icon: "◇" },
  { id: "trust", label: "Trust", icon: "✓" },
  { id: "work", label: "Background work", icon: "◌" },
  { id: "pages", label: "Live pages", icon: "▤" },
  { id: "learning", label: "Learning", icon: "◎" },
  { id: "costs", label: "Forecast", icon: "£" },
];

const WIDGET_COPY: Record<string, string> = {
  reply_drafts: "Reply drafts",
  overdue_tasks: "Overdue commitments",
  upcoming_calls: "Calls in the next 48 hours",
  stalled_opportunities: "Stalled opportunities",
  outreach_inventory: "Ready outreach",
  pending_approvals: "Human approvals",
  background_runs: "Background work",
  cost_forecast: "Cost forecast",
  team_workload: "Team workload",
};

const TRUST_COPY: Record<string, string> = {
  read_and_analyse: "Read and analyse allowed records",
  create_internal_draft: "Create an internal draft",
  update_internal_crm: "Change an internal CRM record",
  customer_communication: "Contact a customer",
  paid_generation: "Create paid AI or audio output",
  destructive_action: "Delete or destructively rewrite data",
  shared_learning: "Publish learning to the team",
};

const button =
  "min-h-11 rounded-lg border border-amber/55 bg-amber/10 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:cursor-wait disabled:opacity-40";
const secondaryButton =
  "min-h-11 rounded-lg border border-edge px-4 font-mono text-[0.58rem] uppercase tracking-wider text-bone transition hover:border-amber/50 hover:text-amber disabled:opacity-40";
const field =
  "min-h-11 w-full rounded-lg border border-edge bg-ink px-3 text-sm text-bone outline-none placeholder:text-muted/60 focus:border-amber/55";

const gbp = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number(value) || 0);

const when = (value: string | null | undefined) => {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const tone = (status: string) => {
  if (["completed", "approved_personal", "approved_team", "auto", "active"].includes(status)) {
    return "border-sage/40 bg-sage/10 text-sage";
  }
  if (["failed", "blocked", "rejected"].includes(status)) {
    return "border-rust/45 bg-rust/10 text-rust";
  }
  if (["queued", "running", "proposed", "approval_required"].includes(status)) {
    return "border-amber/45 bg-amber/10 text-amber";
  }
  return "border-edge bg-ink/40 text-muted";
};

const label = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

function Status({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-[0.48rem] uppercase tracking-wider ${tone(
        value
      )}`}
    >
      {label(value)}
    </span>
  );
}

export default function BrainControlPage() {
  const cached = getCached<BrainSnapshot>(API);
  const [data, setData] = useState<BrainSnapshot | null>(cached || null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(!cached);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [routineDrafts, setRoutineDrafts] = useState<Record<string, any>>({});
  const [newPlay, setNewPlay] = useState({
    name: "",
    description: "",
    triggerSummary: "",
    steps: "",
  });
  const [newPage, setNewPage] = useState({
    title: "",
    description: "",
    widgets: ["reply_drafts", "overdue_tasks", "upcoming_calls"],
  });
  const [newLearning, setNewLearning] = useState({
    instruction: "",
    expectedImpact: "",
  });
  const [trustUserId, setTrustUserId] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await crmFetch<BrainSnapshot>(API);
      setData(next);
      setTrustUserId((current) =>
        current && next.members.some((member) => member.userId === current)
          ? current
          : next.currentUserId
      );
      setRoutineDrafts(
        Object.fromEntries(
          next.routines.map((routine) => [
            routine.id,
            {
              id: routine.id,
              name: routine.name,
              description: routine.description,
              scheduleMode: routine.schedule_mode,
              scheduledLocalTime: String(routine.scheduled_local_time || "07:30").slice(0, 5),
              status: routine.status,
              approvalMode: routine.approval_mode,
              estimatedCostGbp: Number(routine.estimated_cost_gbp || 0),
              hardCostCapGbp: Number(routine.hard_cost_cap_gbp || 0),
            },
          ])
        )
      );
      setError("");
    } catch (reason: any) {
      setError(reason?.message || "Brain Control could not be loaded.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeWork = useMemo(
    () =>
      (data?.runs || []).some((run) =>
        ["queued", "running"].includes(run.status)
      ),
    [data?.runs]
  );

  useEffect(() => {
    if (!activeWork) return;
    const timer = window.setInterval(() => void load(true), 2_500);
    return () => window.clearInterval(timer);
  }, [activeWork, load]);

  const mutate = async (key: string, payload: any, success: string) => {
    if (saving) return null;
    setSaving(key);
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<any>(API, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setNotice(success);
      await load(true);
      return result;
    } catch (reason: any) {
      setError(reason?.message || "That change could not be saved.");
      return null;
    } finally {
      setSaving("");
    }
  };

  const runRoutine = async (routineId: string) => {
    const result = await mutate(
      `run:${routineId}`,
      {
        action: "run_routine",
        routineId,
        idempotencyKey: crypto.randomUUID(),
      },
      "The routine is running. No customer action will happen automatically."
    );
    if (result) setTab("work");
  };

  const latestRun = data?.runs?.[0] || null;
  const latestOutput = latestRun?.output || {};
  const proposedActions = Array.isArray(latestRun?.proposed_actions)
    ? latestRun.proposed_actions
    : [];

  return (
    <main className="relative z-10 mx-auto max-w-[1320px] px-3 py-5 pb-24 sm:px-5 sm:py-8 sm:pb-10">
      <NavMenu />
      <header className="mb-4 border-b border-edge pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[0.56rem] uppercase tracking-[0.18em] text-amber">
              Human-controlled AI operations
            </p>
            <h1 className="mt-1 font-display text-2xl tracking-tight text-bone sm:text-3xl">
              Brain <span className="italic text-amber">Control</span>
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Routines, reusable sales plays, trust rules, visible background work, internal live pages, cost forecasts and approved learning in one place.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButton}>
            {loading ? "Refreshing…" : "Refresh control centre"}
          </button>
        </div>
      </header>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Brain Control sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`min-h-11 shrink-0 rounded-full border px-4 font-mono text-[0.55rem] uppercase tracking-wider transition ${
              tab === item.id
                ? "border-amber/60 bg-amber/15 text-amber"
                : "border-edge bg-panel text-muted hover:text-bone"
            }`}
          >
            <span className="mr-2">{item.icon}</span>{item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mb-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mb-3 rounded-lg border border-sage/40 bg-sage/10 px-3 py-2 text-sm text-sage">
          {notice}
        </p>
      ) : null}

      {!data ? (
        <MatrixRain
          size="panel"
          messages={["binding one exact account", "loading trust rules", "checking visible work"]}
        />
      ) : null}

      {data && tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-xl border border-amber/35 bg-amber/[0.05] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[0.54rem] uppercase tracking-wider text-amber">Daily control loop</p>
                <h2 className="mt-1 font-display text-2xl text-bone">Your next safe sales moves</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                  The morning routine reads your current queues and prepares links to act. It does not send messages, update records, create audio or start research.
                </p>
              </div>
              {data.routines[0] ? (
                <button
                  type="button"
                  onClick={() => void runRoutine(data.routines[0].id)}
                  disabled={!!saving || activeWork}
                  className={button}
                >
                  {activeWork ? "Routine running…" : "Run morning control"}
                </button>
              ) : null}
            </div>

            {latestRun ? (
              <div className="mt-5 border-t border-amber/20 pt-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm text-bone">Latest run · {when(latestRun.created_at)}</p>
                    <p className="mt-1 text-xs text-muted">{latestRun.progress_message}</p>
                  </div>
                  <Status value={latestRun.status} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    ["Reply drafts", latestOutput.counts?.replyDrafts || 0],
                    ["Overdue", latestOutput.counts?.overdueTasks || 0],
                    ["Calls", latestOutput.counts?.upcomingCalls || 0],
                    ["Stalled", latestOutput.counts?.stalledOpportunities || 0],
                    ["Ready outreach", latestOutput.counts?.readyOutreach || 0],
                  ].map(([title, value]) => (
                    <div key={String(title)} className="rounded-lg border border-edge bg-ink/40 p-3">
                      <strong className="block font-display text-2xl tabular-nums text-bone">{value}</strong>
                      <span className="mt-1 block text-xs text-muted">{title}</span>
                    </div>
                  ))}
                </div>
                {proposedActions.length ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {proposedActions.map((action: any) => (
                      <Link
                        key={action.kind}
                        href={action.href}
                        className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-edge bg-panel px-3 text-sm text-bone transition hover:border-amber/50"
                      >
                        <span>{action.label}</span><span className="text-amber">→</span>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-5 rounded-lg border border-edge bg-ink/35 p-3 text-sm text-muted">
                Run the morning control once to create your first live operating view.
              </p>
            )}
          </section>

          <div className="grid gap-4">
            <Link href="/crm/chat" className="rounded-xl border border-sky/40 bg-sky/[0.06] p-4 transition hover:border-sky/70">
              <p className="font-mono text-[0.53rem] uppercase tracking-wider text-sky">Brain inside Team Chat</p>
              <h2 className="mt-1 font-display text-xl text-bone">Mention @Brain in any conversation</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                It uses only that chat, shared card snapshots, file metadata and approved team learning. It cannot browse private CRM records from chat.
              </p>
              <span className="mt-3 inline-flex text-sm text-sky">Open Team Chat →</span>
            </Link>
            <section className="rounded-xl border border-edge bg-panel p-4">
              <p className="font-mono text-[0.53rem] uppercase tracking-wider text-sage">Control status</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  ["Active routines", data.routines.filter((row) => row.status === "active").length],
                  ["Saved plays", data.plays.filter((row) => row.status === "active").length],
                  ["Live pages", data.pages.length],
                  ["Learning proposals", data.learnings.filter((row) => row.status === "proposed").length],
                ].map(([title, value]) => (
                  <div key={String(title)} className="rounded-lg border border-edge bg-ink/35 p-3">
                    <strong className="font-display text-xl text-bone">{value}</strong>
                    <p className="mt-1 text-xs text-muted">{title}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-edge bg-ink/35 p-3">
                <span className="text-sm text-muted">Forecast this month</span>
                <strong className="tabular-nums text-sage">{gbp(data.costs.forecastThisMonth)}</strong>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {data && tab === "routines" ? (
        <section className="grid gap-4">
          <div>
            <h2 className="font-display text-xl text-bone">Brain Routines</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Every scheduled run is tied to one salesperson. The first routine is deterministic and costs nothing.
            </p>
          </div>
          {data.routines.map((routine) => {
            const draft = routineDrafts[routine.id] || {};
            return (
              <article key={routine.id} className="rounded-xl border border-edge bg-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-xl text-bone">{routine.name}</h3>
                      <Status value={routine.status} />
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted">{routine.description}</p>
                    <p className="mt-2 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                      Next run · {when(routine.next_run_at)} · London time
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runRoutine(routine.id)}
                    disabled={!!saving || activeWork}
                    className={button}
                  >
                    Run now
                  </button>
                </div>
                <div className="mt-4 grid gap-3 border-t border-edge pt-4 sm:grid-cols-4">
                  <label className="text-xs text-muted">
                    Schedule
                    <select
                      value={draft.scheduleMode || "manual"}
                      onChange={(event) =>
                        setRoutineDrafts((current) => ({
                          ...current,
                          [routine.id]: { ...draft, scheduleMode: event.target.value },
                        }))
                      }
                      className={`${field} mt-1`}
                    >
                      <option value="manual">Manual only</option>
                      <option value="weekdays">Every weekday</option>
                      <option value="daily">Every day</option>
                    </select>
                  </label>
                  <label className="text-xs text-muted">
                    London time
                    <input
                      type="time"
                      value={draft.scheduledLocalTime || "07:30"}
                      onChange={(event) =>
                        setRoutineDrafts((current) => ({
                          ...current,
                          [routine.id]: { ...draft, scheduledLocalTime: event.target.value },
                        }))
                      }
                      className={`${field} mt-1`}
                    />
                  </label>
                  <label className="text-xs text-muted">
                    State
                    <select
                      value={draft.status || "active"}
                      onChange={(event) =>
                        setRoutineDrafts((current) => ({
                          ...current,
                          [routine.id]: { ...draft, status: event.target.value },
                        }))
                      }
                      className={`${field} mt-1`}
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                    </select>
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() =>
                        void mutate(
                          `routine:${routine.id}`,
                          { action: "save_routine", routine: draft },
                          "Routine schedule saved."
                        )
                      }
                      disabled={!!saving}
                      className={`${secondaryButton} w-full`}
                    >
                      Save schedule
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {data && tab === "plays" ? (
        <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="grid content-start gap-3">
            <div>
              <h2 className="font-display text-xl text-bone">Saved Sales Plays</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                Reviewable, versioned methods. A team play is shared deliberately, not learned silently.
              </p>
            </div>
            {data.plays.map((play) => (
              <article key={play.id} className="rounded-xl border border-edge bg-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg text-bone">{play.name}</h3>
                      <Status value={play.visibility === "team" ? "approved_team" : "private"} />
                      <span className="font-mono text-[0.47rem] uppercase text-muted">v{play.version}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted">{play.description}</p>
                    <p className="mt-2 text-xs text-amber">Trigger · {play.trigger_summary || "Manual"}</p>
                  </div>
                  {play.owner_id === data.currentUserId && ["owner", "manager"].includes(data.role) ? (
                    <button
                      type="button"
                      onClick={() =>
                        void mutate(
                          `play:${play.id}`,
                          {
                            action: "save_play",
                            play: {
                              id: play.id,
                              name: play.name,
                              description: play.description,
                              triggerSummary: play.trigger_summary,
                              steps: play.steps,
                              visibility: play.visibility === "team" ? "private" : "team",
                              estimatedCostGbp: play.estimated_cost_gbp,
                              hardCostCapGbp: play.hard_cost_cap_gbp,
                            },
                          },
                          play.visibility === "team" ? "Play made private." : "Play shared with the team."
                        )
                      }
                      disabled={!!saving}
                      className={secondaryButton}
                    >
                      {play.visibility === "team" ? "Make private" : "Share with team"}
                    </button>
                  ) : null}
                </div>
                <ol className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(play.steps || []).map((step: string, index: number) => (
                    <li key={`${play.id}:${index}`} className="flex gap-2 rounded-lg border border-edge bg-ink/35 p-3 text-sm text-bone/85">
                      <span className="text-amber">{index + 1}</span><span>{step}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </section>
          <section className="h-fit rounded-xl border border-amber/35 bg-amber/[0.04] p-4 lg:sticky lg:top-4">
            <h2 className="font-display text-lg text-bone">Create a play</h2>
            <div className="mt-3 grid gap-3">
              <input
                value={newPlay.name}
                onChange={(event) => setNewPlay((current) => ({ ...current, name: event.target.value }))}
                placeholder="Play name"
                className={field}
              />
              <input
                value={newPlay.triggerSummary}
                onChange={(event) => setNewPlay((current) => ({ ...current, triggerSummary: event.target.value }))}
                placeholder="When this play applies"
                className={field}
              />
              <textarea
                value={newPlay.description}
                onChange={(event) => setNewPlay((current) => ({ ...current, description: event.target.value }))}
                placeholder="What this play achieves"
                rows={3}
                className={`${field} py-3`}
              />
              <textarea
                value={newPlay.steps}
                onChange={(event) => setNewPlay((current) => ({ ...current, steps: event.target.value }))}
                placeholder="One step per line"
                rows={7}
                className={`${field} py-3`}
              />
              <button
                type="button"
                onClick={async () => {
                  const result = await mutate(
                    "new-play",
                    {
                      action: "save_play",
                      play: {
                        ...newPlay,
                        steps: newPlay.steps.split("\n").map((step) => step.trim()).filter(Boolean),
                        visibility: "private",
                        estimatedCostGbp: 0,
                        hardCostCapGbp: 0,
                      },
                    },
                    "Private sales play created."
                  );
                  if (result) setNewPlay({ name: "", description: "", triggerSummary: "", steps: "" });
                }}
                disabled={!!saving || !newPlay.name.trim() || !newPlay.steps.trim()}
                className={button}
              >
                Save private play
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {data && tab === "trust" ? (
        <section>
          <h2 className="font-display text-xl text-bone">Action Trust Centre</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            These rules are enforced on the server. Only the workspace owner can change them. Staff can use their approved day-to-day actions but cannot change Brain authority, application code or workspace permissions.
          </p>
          {data.role === "owner" ? (
            <label className="mt-4 block max-w-sm text-xs text-muted">
              Brain permissions for
              <select
                value={trustUserId || data.currentUserId}
                onChange={(event) => setTrustUserId(event.target.value)}
                className={`${field} mt-1`}
              >
                {data.members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName} · {label(member.role)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {data.trustRules
              .filter((rule) => rule.owner_id === (trustUserId || data.currentUserId))
              .map((rule) => {
              const choices = rule.action_kind === "destructive_action"
                ? ["blocked"]
                : rule.hard_locked
                  ? ["approval_required", "blocked"]
                  : ["auto", "approval_required", "blocked"];
              return (
                <article key={rule.id} className="rounded-xl border border-edge bg-panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium text-bone">{TRUST_COPY[rule.action_kind] || label(rule.action_kind)}</h3>
                      <p className="mt-1 text-xs leading-5 text-muted">{rule.reason}</p>
                    </div>
                    {rule.hard_locked ? (
                      <span className="shrink-0 font-mono text-[0.48rem] uppercase tracking-wider text-rust">Hard lock</span>
                    ) : null}
                  </div>
                  <select
                    value={rule.mode}
                    disabled={!!saving || data.role !== "owner"}
                    onChange={(event) =>
                      void mutate(
                        `trust:${rule.id}`,
                        {
                          action: "update_trust",
                          actionKind: rule.action_kind,
                          mode: event.target.value,
                          targetUserId: rule.owner_id,
                        },
                        "Trust rule updated."
                      )
                    }
                    className={`${field} mt-3`}
                  >
                    {choices.map((choice) => (
                      <option key={choice} value={choice}>{label(choice)}</option>
                    ))}
                  </select>
                  {data.role !== "owner" ? (
                    <p className="mt-2 text-xs text-muted">Owner controlled</p>
                  ) : null}
                </article>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl border border-edge bg-panel p-4">
            <h3 className="font-display text-lg text-bone">Recent Brain action receipts</h3>
            {data.actionReceipts.length ? (
              <ul className="mt-3 divide-y divide-edge">
                {data.actionReceipts.slice(0, 10).map((receipt, index) => (
                  <li key={`${receipt.messageId}:${index}`} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <span className="text-bone/85">{receipt.label || receipt.description || receipt.type || "Brain action"}</span>
                    <span className="text-xs text-muted">{when(receipt.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">No recent action receipts.</p>
            )}
          </div>
        </section>
      ) : null}

      {data && tab === "work" ? (
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl text-bone">Visible Background Work Centre</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Every run shows its progress, output, cost and failure reason.</p>
            </div>
            <button type="button" onClick={() => void load()} className={secondaryButton}>Refresh work</button>
          </div>
          <div className="mt-4 grid gap-3">
            {data.runs.length ? data.runs.map((run) => {
              const width = Math.min(100, Math.round((Number(run.current_step || 0) / Number(run.total_steps || 1)) * 100));
              return (
                <article key={run.id} className="rounded-xl border border-edge bg-panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-bone">Morning sales control</h3>
                        <Status value={run.status} />
                      </div>
                      <p className="mt-1 text-sm text-muted">{run.progress_message}</p>
                      <p className="mt-1 font-mono text-[0.47rem] uppercase tracking-wider text-muted">
                        {label(run.trigger_kind)} · {when(run.created_at)} · Actual {gbp(run.actual_cost_gbp)}
                      </p>
                    </div>
                    <span className="font-mono text-[0.52rem] text-muted">Step {run.current_step} of {run.total_steps}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink">
                    <div className={`h-full rounded-full ${run.status === "failed" ? "bg-rust" : "bg-amber"}`} style={{ width: `${width}%` }} />
                  </div>
                  {run.error ? <p className="mt-3 text-sm text-rust">{run.error}</p> : null}
                  {Array.isArray(run.proposed_actions) && run.proposed_actions.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {run.proposed_actions.map((action: any) => (
                        <Link key={action.kind} href={action.href} className={secondaryButton}>{action.label} →</Link>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            }) : (
              <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-muted">No routines have run yet.</p>
            )}
          </div>
          <div className="mt-6">
            <h3 className="font-display text-lg text-bone">Audited Brain actions</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Every confirmed action is bound to one account, one exact request and one retry key. Lee can see the workspace audit. Other users see only their own actions.
            </p>
            <div className="mt-3 grid gap-2">
              {data.actionExecutions?.length ? data.actionExecutions.slice(0, 25).map((execution) => (
                <article key={execution.id} className="rounded-xl border border-edge bg-panel p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm text-bone">{execution.label || label(execution.action_type)}</p>
                        <Status value={execution.undone_at ? "undone" : execution.status} />
                        {execution.owner_override_applied ? (
                          <span className="rounded-full border border-amber/45 bg-amber/10 px-2 py-1 font-mono text-[0.47rem] uppercase tracking-wider text-amber">Owner override used</span>
                        ) : null}
                      </div>
                      <p className="mt-1 font-mono text-[0.47rem] uppercase tracking-wider text-muted">
                        {label(execution.action_kind)} · {label(execution.actor_role)} · Attempt {execution.attempt_count} · {when(execution.created_at)}
                      </p>
                      {Number(execution.estimated_cost_gbp || 0) > 0 ||
                      Number(execution.actual_cost_gbp || 0) > 0 ? (
                        <p className="mt-1 font-mono text-[0.47rem] uppercase tracking-wider text-muted">
                          Estimated {gbp(execution.estimated_cost_gbp)} · Recorded {gbp(execution.actual_cost_gbp)}
                        </p>
                      ) : null}
                    </div>
                    {execution.recovery?.canRetry ? (
                      <span className="font-mono text-[0.48rem] uppercase tracking-wider text-amber">Retry available on the action card</span>
                    ) : null}
                    {execution.recovery?.canUndo ? (
                      <span className="font-mono text-[0.48rem] uppercase tracking-wider text-sky">Ten minute undo available on the action card</span>
                    ) : null}
                  </div>
                  {execution.error ? <p className="mt-2 text-sm text-rust">{execution.error}</p> : null}
                  {execution.recovery?.nextAction ? <p className="mt-1 text-xs text-muted">{execution.recovery.nextAction}</p> : null}
                </article>
              )) : (
                <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-muted">No audited Brain actions yet.</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {data && tab === "pages" ? (
        <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="grid content-start gap-3">
            <div>
              <h2 className="font-display text-xl text-bone">Internal Live Pages</h2>
              <p className="mt-1 text-sm leading-6 text-muted">Persistent operating views built from approved widgets and the latest visible run.</p>
            </div>
            {data.pages.map((page) => (
              <article key={page.id} className="rounded-xl border border-edge bg-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-lg text-bone">{page.title}</h3>
                      {page.is_default ? <span className="font-mono text-[0.47rem] uppercase text-amber">Default</span> : null}
                      <Status value={page.visibility === "team" ? "approved_team" : "private"} />
                    </div>
                    <p className="mt-1 text-sm text-muted">{page.description}</p>
                  </div>
                  {page.owner_id === data.currentUserId && ["owner", "manager"].includes(data.role) ? (
                    <button
                      type="button"
                      onClick={() =>
                        void mutate(
                          `page:${page.id}`,
                          {
                            action: "save_page",
                            page: {
                              id: page.id,
                              title: page.title,
                              description: page.description,
                              widgets: page.widgets,
                              visibility: page.visibility === "team" ? "private" : "team",
                            },
                          },
                          page.visibility === "team" ? "Live page made private." : "Live page shared with the team."
                        )
                      }
                      disabled={!!saving}
                      className={secondaryButton}
                    >
                      {page.visibility === "team" ? "Make private" : "Share with team"}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(page.widgets || []).map((widget: string) => (
                    <div key={widget} className="rounded-lg border border-edge bg-ink/35 p-3">
                      <p className="text-xs text-muted">{WIDGET_COPY[widget] || label(widget)}</p>
                      <strong className="mt-1 block font-display text-xl text-bone">
                        {widget === "reply_drafts"
                          ? latestOutput.counts?.replyDrafts || 0
                          : widget === "overdue_tasks"
                            ? latestOutput.counts?.overdueTasks || 0
                            : widget === "upcoming_calls"
                              ? latestOutput.counts?.upcomingCalls || 0
                              : widget === "stalled_opportunities"
                                ? latestOutput.counts?.stalledOpportunities || 0
                                : widget === "outreach_inventory"
                                  ? latestOutput.counts?.readyOutreach || 0
                                  : widget === "pending_approvals"
                                    ? proposedActions.length
                                    : widget === "background_runs"
                                      ? data.runs.filter((run) => ["queued", "running"].includes(run.status)).length
                                      : widget === "cost_forecast"
                                        ? gbp(data.costs.forecastThisMonth)
                                        : "—"}
                      </strong>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </section>
          <section className="h-fit rounded-xl border border-amber/35 bg-amber/[0.04] p-4 lg:sticky lg:top-4">
            <h2 className="font-display text-lg text-bone">Create a live page</h2>
            <div className="mt-3 grid gap-3">
              <input value={newPage.title} onChange={(event) => setNewPage((current) => ({ ...current, title: event.target.value }))} placeholder="Page title" className={field} />
              <textarea value={newPage.description} onChange={(event) => setNewPage((current) => ({ ...current, description: event.target.value }))} placeholder="What this page controls" rows={3} className={`${field} py-3`} />
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {BRAIN_WIDGETS.map((widget) => (
                  <label key={widget} className="flex min-h-11 items-center gap-3 rounded-lg border border-edge bg-ink/35 px-3 text-sm text-bone">
                    <input
                      type="checkbox"
                      checked={newPage.widgets.includes(widget)}
                      onChange={() =>
                        setNewPage((current) => ({
                          ...current,
                          widgets: current.widgets.includes(widget)
                            ? current.widgets.filter((item) => item !== widget)
                            : [...current.widgets, widget],
                        }))
                      }
                    />
                    {WIDGET_COPY[widget]}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const result = await mutate(
                    "new-page",
                    { action: "save_page", page: { ...newPage, visibility: "private" } },
                    "Private live page created."
                  );
                  if (result) setNewPage({ title: "", description: "", widgets: ["reply_drafts", "overdue_tasks", "upcoming_calls"] });
                }}
                disabled={!!saving || !newPage.title.trim() || !newPage.widgets.length}
                className={button}
              >
                Save private page
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {data && tab === "learning" ? (
        <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
          <section className="h-fit rounded-xl border border-amber/35 bg-amber/[0.04] p-4">
            <h2 className="font-display text-lg text-bone">Propose a learning</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Nothing becomes learned until a person reviews it.</p>
            <textarea value={newLearning.instruction} onChange={(event) => setNewLearning((current) => ({ ...current, instruction: event.target.value }))} placeholder="The exact instruction Brain should remember" rows={5} className={`${field} mt-3 py-3`} />
            <textarea value={newLearning.expectedImpact} onChange={(event) => setNewLearning((current) => ({ ...current, expectedImpact: event.target.value }))} placeholder="Expected impact and why it matters" rows={3} className={`${field} mt-3 py-3`} />
            <button
              type="button"
              onClick={async () => {
                const result = await mutate(
                  "new-learning",
                  { action: "propose_learning", learning: { ...newLearning, sourceKind: "manual" } },
                  "Learning added for human review."
                );
                if (result) setNewLearning({ instruction: "", expectedImpact: "" });
              }}
              disabled={!!saving || !newLearning.instruction.trim()}
              className={`${button} mt-3 w-full`}
            >
              Add to review queue
            </button>
          </section>
          <section>
            <h2 className="font-display text-xl text-bone">Human-Approved Shared Learning</h2>
            <div className="mt-3 grid gap-3">
              {data.learnings.length ? data.learnings.map((learning) => (
                <article key={learning.id} className="rounded-xl border border-edge bg-panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-3xl">
                      <div className="flex items-center gap-2"><Status value={learning.status} /><span className="text-xs text-muted">{label(learning.source_kind)}</span></div>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-bone">{learning.instruction}</p>
                      {learning.expected_impact ? <p className="mt-2 text-xs leading-5 text-muted">Expected impact · {learning.expected_impact}</p> : null}
                    </div>
                    {learning.status === "proposed" ? (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => void mutate(`learn-personal:${learning.id}`, { action: "review_learning", learning: { id: learning.id, decision: "approved_personal" } }, "Learning approved for you.")} disabled={!!saving} className={secondaryButton}>Approve for me</button>
                        {["owner", "manager"].includes(data.role) ? <button type="button" onClick={() => void mutate(`learn-team:${learning.id}`, { action: "review_learning", learning: { id: learning.id, decision: "approved_team" } }, "Learning approved for the team.")} disabled={!!saving} className={button}>Approve for team</button> : null}
                        <button type="button" onClick={() => void mutate(`learn-reject:${learning.id}`, { action: "review_learning", learning: { id: learning.id, decision: "rejected" } }, "Learning rejected.")} disabled={!!saving} className={secondaryButton}>Reject</button>
                      </div>
                    ) : null}
                  </div>
                </article>
              )) : <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-muted">No learning proposals yet.</p>}
            </div>
          </section>
        </div>
      ) : null}

      {data && tab === "costs" ? (
        <section>
          <h2 className="font-display text-xl text-bone">Cost Forecasting</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">Forecasts are based on each routine schedule and its explicit per-run estimate. A hard cap is checked before every run.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-sage/40 bg-sage/[0.06] p-4">
              <p className="font-mono text-[0.53rem] uppercase tracking-wider text-sage">Forecast this month</p>
              <strong className="mt-1 block font-display text-3xl tabular-nums text-bone">{gbp(data.costs.forecastThisMonth)}</strong>
            </div>
            <div className="rounded-xl border border-edge bg-panel p-4">
              <p className="font-mono text-[0.53rem] uppercase tracking-wider text-muted">Actual routine spend this month</p>
              <strong className="mt-1 block font-display text-3xl tabular-nums text-bone">{gbp(data.costs.actualThisMonth)}</strong>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-edge bg-panel">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-edge bg-ink/35 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                <tr><th className="px-4 py-3">Routine</th><th className="px-4 py-3">Schedule</th><th className="px-4 py-3">Runs per month</th><th className="px-4 py-3">Per run</th><th className="px-4 py-3">Hard cap</th><th className="px-4 py-3">Monthly forecast</th></tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {data.costs.routines.map((routine) => (
                  <tr key={routine.routineId}>
                    <td className="px-4 py-3 text-bone">{routine.name}</td><td className="px-4 py-3 text-muted">{label(routine.scheduleMode)}</td><td className="px-4 py-3 tabular-nums text-muted">{routine.runsPerMonth.toFixed(1)}</td><td className="px-4 py-3 tabular-nums text-muted">{gbp(routine.estimatedPerRun)}</td><td className="px-4 py-3 tabular-nums text-muted">{gbp(routine.hardCapPerRun)}</td><td className="px-4 py-3 tabular-nums text-sage">{gbp(routine.forecastPerMonth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link href="/crm/costs" className={`${secondaryButton} mt-4 inline-flex items-center justify-center`}>Open all recorded LiveCoach costs →</Link>
        </section>
      ) : null}
    </main>
  );
}
