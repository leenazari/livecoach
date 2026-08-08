"use client";

import { useMemo, useState } from "react";
import { crmFetch } from "@/lib/crm";

export type CloseMilestone = {
  id: string;
  label: string;
  owner: "us" | "buyer" | "joint";
  dueAt: string | null;
  status: "pending" | "done";
};

export type ClosePlan = {
  targetCloseDate: string | null;
  milestones: CloseMilestone[];
};

const DEFAULT_MILESTONES = [
  "Confirm the business problem and measurable value",
  "Meet the economic decision-maker",
  "Agree the solution, demo or pilot",
  "Complete technical and security approval",
  "Send and review the commercial proposal",
  "Complete legal and procurement",
  "Confirm the decision and signature date",
];

const normalizePlan = (value: any): ClosePlan => ({
  targetCloseDate:
    typeof value?.targetCloseDate === "string" ? value.targetCloseDate : null,
  milestones: Array.isArray(value?.milestones)
    ? value.milestones
        .filter((m: any) => m && typeof m.label === "string")
        .map((m: any) => ({
          id: String(m.id || crypto.randomUUID()),
          label: String(m.label).trim(),
          owner: ["us", "buyer", "joint"].includes(m.owner)
            ? m.owner
            : "joint",
          dueAt: typeof m.dueAt === "string" ? m.dueAt : null,
          status: m.status === "done" ? "done" : "pending",
        }))
    : [],
});

export default function OpportunityClosePlan({
  opportunityId,
  initialPlan,
  onSaved,
}: {
  opportunityId: string;
  initialPlan: any;
  onSaved?: (plan: ClosePlan) => void;
}) {
  const [plan, setPlan] = useState<ClosePlan>(() => normalizePlan(initialPlan));
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const progress = useMemo(() => {
    if (!plan.milestones.length) return 0;
    return Math.round(
      (plan.milestones.filter((m) => m.status === "done").length /
        plan.milestones.length) *
        100
    );
  }, [plan.milestones]);

  const persist = async (next: ClosePlan, success = "Close plan saved") => {
    const previous = plan;
    setPlan(next);
    setSaving(true);
    setNote("");
    try {
      const result = await crmFetch<{ opportunity: { close_plan: ClosePlan } }>(
        `/api/crm/opportunities/${opportunityId}`,
        { method: "PATCH", body: JSON.stringify({ closePlan: next }) }
      );
      const confirmed = normalizePlan(result.opportunity?.close_plan);
      setPlan(confirmed);
      onSaved?.(confirmed);
      setNote(success);
      setTimeout(() => setNote(""), 1800);
    } catch {
      setPlan(previous);
      setNote("That change did not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const createTemplate = () => {
    const target = plan.targetCloseDate;
    const milestones = DEFAULT_MILESTONES.map((label, index) => ({
      id: crypto.randomUUID(),
      label,
      owner: "joint" as const,
      dueAt: index === DEFAULT_MILESTONES.length - 1 ? target : null,
      status: "pending" as const,
    }));
    persist({ ...plan, milestones }, "Close plan created");
  };

  const updateMilestone = (id: string, patch: Partial<CloseMilestone>) => {
    persist({
      ...plan,
      milestones: plan.milestones.map((m) =>
        m.id === id ? { ...m, ...patch } : m
      ),
    });
  };

  const addMilestone = () => {
    const label = newLabel.trim();
    if (!label) return;
    setNewLabel("");
    persist({
      ...plan,
      milestones: [
        ...plan.milestones,
        {
          id: crypto.randomUUID(),
          label,
          owner: "joint",
          dueAt: null,
          status: "pending",
        },
      ],
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-amber/35 bg-amber/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-[0.56rem] uppercase tracking-[0.18em] text-amber">
            Mutual close plan · {progress}% complete
          </p>
          <p className="mt-0.5 font-sans text-[0.72rem] text-bone/55">
            The agreed route from today to a signed decision.
          </p>
        </div>
        {!plan.milestones.length ? (
          <button
            type="button"
            onClick={createTemplate}
            disabled={saving}
            className="rounded-full border border-amber/55 bg-amber/10 px-3 py-1 font-mono text-[0.53rem] uppercase tracking-wider text-amber disabled:opacity-40"
          >
            create close plan
          </button>
        ) : null}
      </div>

      <label className="mt-3 block sm:max-w-[13rem]">
        <span className="mb-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted">
          Target signature date
        </span>
        <input
          type="date"
          value={plan.targetCloseDate || ""}
          disabled={saving}
          onChange={(e) =>
            persist({ ...plan, targetCloseDate: e.target.value || null })
          }
          className="w-full rounded-md border border-edge bg-ink/70 px-2.5 py-1.5 font-sans text-[0.75rem] text-bone outline-none focus:border-amber/60"
        />
      </label>

      {plan.milestones.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {plan.milestones.map((m) => (
            <li
              key={m.id}
              className="grid gap-2 rounded-md border border-edge/70 bg-ink/35 p-2 sm:grid-cols-[auto_1fr_7rem_8.5rem_auto] sm:items-center"
            >
              <button
                type="button"
                aria-label={m.status === "done" ? "mark pending" : "mark done"}
                onClick={() =>
                  updateMilestone(m.id, {
                    status: m.status === "done" ? "pending" : "done",
                  })
                }
                disabled={saving}
                className={`h-4 w-4 rounded border text-[0.62rem] ${
                  m.status === "done"
                    ? "border-sage bg-sage/20 text-sage"
                    : "border-muted text-transparent"
                }`}
              >
                ✓
              </button>
              <input
                value={m.label}
                disabled={saving}
                onChange={(e) =>
                  setPlan((p) => ({
                    ...p,
                    milestones: p.milestones.map((x) =>
                      x.id === m.id ? { ...x, label: e.target.value } : x
                    ),
                  }))
                }
                onBlur={(e) => updateMilestone(m.id, { label: e.target.value })}
                className={`min-w-0 bg-transparent font-sans text-[0.76rem] outline-none ${
                  m.status === "done" ? "text-muted line-through" : "text-bone"
                }`}
              />
              <select
                value={m.owner}
                disabled={saving}
                onChange={(e) =>
                  updateMilestone(m.id, {
                    owner: e.target.value as CloseMilestone["owner"],
                  })
                }
                className="rounded border border-edge bg-ink px-1.5 py-1 font-mono text-[0.5rem] uppercase text-muted"
              >
                <option value="us">we own</option>
                <option value="buyer">buyer owns</option>
                <option value="joint">joint</option>
              </select>
              <input
                type="date"
                value={m.dueAt || ""}
                disabled={saving}
                onChange={(e) =>
                  updateMilestone(m.id, { dueAt: e.target.value || null })
                }
                className="rounded border border-edge bg-ink px-1.5 py-1 font-sans text-[0.68rem] text-muted"
              />
              <button
                type="button"
                aria-label="remove milestone"
                disabled={saving}
                onClick={() =>
                  persist({
                    ...plan,
                    milestones: plan.milestones.filter((x) => x.id !== m.id),
                  })
                }
                className="font-mono text-[0.7rem] text-muted hover:text-rust"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex gap-2">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addMilestone()}
          placeholder="Add an agreed milestone…"
          className="min-w-0 flex-1 rounded-md border border-edge bg-ink/50 px-2.5 py-1.5 font-sans text-[0.72rem] text-bone outline-none placeholder:text-muted/50"
        />
        <button
          type="button"
          onClick={addMilestone}
          disabled={!newLabel.trim() || saving}
          className="rounded-full border border-edge px-3 py-1 font-mono text-[0.52rem] uppercase text-muted disabled:opacity-35"
        >
          add
        </button>
      </div>
      {note ? (
        <p className={`mt-2 font-mono text-[0.52rem] uppercase ${note.startsWith("That") ? "text-rust" : "text-sage"}`}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
