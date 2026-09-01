"use client";

import { useMemo, useState } from "react";
import { crmConfirmationError, crmFetch, type Contact } from "@/lib/crm";

type StakeholderRole =
  | "decision_maker"
  | "champion"
  | "user"
  | "influencer"
  | "blocker"
  | "unknown";
type Influence = "high" | "medium" | "low";
type Engagement = "warm" | "neutral" | "cold";

const ROLES: { value: StakeholderRole; label: string }[] = [
  { value: "unknown", label: "Role unknown" },
  { value: "decision_maker", label: "Decision-maker" },
  { value: "champion", label: "Champion" },
  { value: "user", label: "User" },
  { value: "influencer", label: "Influencer" },
  { value: "blocker", label: "Blocker" },
];
const INFLUENCE: { value: Influence; label: string }[] = [
  { value: "high", label: "High influence" },
  { value: "medium", label: "Medium influence" },
  { value: "low", label: "Low influence" },
];
const ENGAGEMENT: { value: Engagement; label: string }[] = [
  { value: "warm", label: "Warm" },
  { value: "neutral", label: "Neutral" },
  { value: "cold", label: "Cold" },
];

const roleOf = (contact: Contact): StakeholderRole => {
  const value = contact.attributes?.stakeholderRole;
  return ROLES.some((option) => option.value === value)
    ? (value as StakeholderRole)
    : "unknown";
};
const influenceOf = (contact: Contact): Influence => {
  const value = contact.attributes?.stakeholderInfluence;
  return INFLUENCE.some((option) => option.value === value)
    ? (value as Influence)
    : "medium";
};
const engagementOf = (contact: Contact): Engagement => {
  const value = contact.attributes?.stakeholderEngagement;
  return ENGAGEMENT.some((option) => option.value === value)
    ? (value as Engagement)
    : "neutral";
};

const roleStyle: Record<StakeholderRole, string> = {
  decision_maker: "border-sage/50 bg-sage/[0.08] text-sage",
  champion: "border-sky/50 bg-sky/[0.08] text-sky",
  user: "border-edge bg-ink/35 text-bone",
  influencer: "border-amber/45 bg-amber/[0.07] text-amber",
  blocker: "border-rust/50 bg-rust/[0.08] text-rust",
  unknown: "border-edge bg-ink/35 text-muted",
};

const engagementDot: Record<Engagement, string> = {
  warm: "bg-sage",
  neutral: "bg-amber",
  cold: "bg-rust",
};

const selectClass =
  "min-h-10 w-full rounded-lg border border-edge bg-ink/70 px-2.5 py-2 font-mono text-[0.54rem] uppercase tracking-wider text-bone outline-none focus:border-amber/60 disabled:opacity-45";

export default function StakeholderMap({
  contacts,
  onSaved,
}: {
  contacts: Contact[];
  onSaved: (contact: Contact) => void;
}) {
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");

  const sorted = useMemo(() => {
    const roleRank: Record<StakeholderRole, number> = {
      decision_maker: 0,
      champion: 1,
      influencer: 2,
      user: 3,
      blocker: 4,
      unknown: 5,
    };
    const influenceRank: Record<Influence, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    return [...contacts].sort(
      (a, b) =>
        roleRank[roleOf(a)] - roleRank[roleOf(b)] ||
        influenceRank[influenceOf(a)] - influenceRank[influenceOf(b)] ||
        a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" })
    );
  }, [contacts]);

  const hasDecisionMaker = contacts.some(
    (contact) => roleOf(contact) === "decision_maker"
  );
  const hasChampion = contacts.some(
    (contact) => roleOf(contact) === "champion"
  );
  const assigned = contacts.filter((contact) => roleOf(contact) !== "unknown").length;

  const save = async (
    contact: Contact,
    patch: {
      stakeholderRole?: StakeholderRole;
      stakeholderInfluence?: Influence;
      stakeholderEngagement?: Engagement;
    }
  ) => {
    if (savingId) return;
    const previous = contact;
    const optimistic: Contact = {
      ...contact,
      attributes: { ...(contact.attributes || {}), ...patch },
    };
    setSavingId(contact.id);
    setError("");
    onSaved(optimistic);
    try {
      const { contact: saved } = await crmFetch<{ contact: Contact }>(
        `/api/crm/contacts/${contact.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ attributes: optimistic.attributes }),
        }
      );
      if (!saved?.id)
        throw crmConfirmationError({
          url: `/api/crm/contacts/${contact.id}`,
          method: "PATCH",
          reason: `LiveCoach did not return the saved stakeholder change for ${contact.name}`,
        });
      onSaved(saved);
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
    } catch {
      onSaved(previous);
      setError(`The stakeholder change for ${contact.name} did not save.`);
    } finally {
      setSavingId("");
    }
  };

  if (!contacts.length) {
    return (
      <section className="mb-3 rounded-xl border border-edge bg-panel/40 p-4">
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">
          ◇ Stakeholder map
        </p>
        <p className="mt-1 text-sm leading-5 text-muted">
          Add a contact in Details to identify the buyer, champion and blockers.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-3 rounded-xl border border-edge bg-panel/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">
            ◇ Stakeholder map
          </p>
          <p className="mt-1 text-sm leading-5 text-muted">
            Who can approve, advocate for, use or block the deal. Changes save instantly.
          </p>
        </div>
        <span className="rounded-full border border-edge px-2.5 py-1 font-mono text-[0.52rem] uppercase tracking-wider text-muted">
          {assigned}/{contacts.length} assigned
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span
          className={`rounded-full border px-2.5 py-1 font-mono text-[0.51rem] uppercase tracking-wider ${
            hasDecisionMaker
              ? "border-sage/45 bg-sage/[0.08] text-sage"
              : "border-rust/50 bg-rust/[0.08] text-rust"
          }`}
        >
          {hasDecisionMaker ? "✓ Decision-maker known" : "▲ No decision-maker identified"}
        </span>
        <span
          className={`rounded-full border px-2.5 py-1 font-mono text-[0.51rem] uppercase tracking-wider ${
            hasChampion
              ? "border-sky/45 bg-sky/[0.08] text-sky"
              : "border-amber/45 bg-amber/[0.07] text-amber"
          }`}
        >
          {hasChampion ? "✓ Champion known" : "◇ No champion identified"}
        </span>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-rust/50 bg-rust/10 px-3 py-2 text-sm text-rust">
          {error}
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {sorted.map((contact) => {
          const role = roleOf(contact);
          const influence = influenceOf(contact);
          const engagement = engagementOf(contact);
          const saving = savingId === contact.id;
          return (
            <article
              key={contact.id}
              className={`rounded-xl border p-3 ${roleStyle[role]}`}
            >
              <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-sans text-sm font-medium text-bone">
                    {contact.name}
                  </h3>
                  <p className="truncate text-xs text-muted">
                    {[contact.role, contact.email].filter(Boolean).join(" · ") ||
                      "No job title or email recorded"}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[0.49rem] uppercase tracking-wider text-bone/70">
                  <span className={`h-2 w-2 rounded-full ${engagementDot[engagement]}`} />
                  {saving ? "saving…" : engagement}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label>
                  <span className="mb-1 block font-mono text-[0.47rem] uppercase tracking-wider text-muted">
                    Buying role
                  </span>
                  <select
                    aria-label={`Buying role for ${contact.name}`}
                    value={role}
                    disabled={!!savingId}
                    onChange={(event) =>
                      save(contact, {
                        stakeholderRole: event.target.value as StakeholderRole,
                      })
                    }
                    className={selectClass}
                  >
                    {ROLES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mb-1 block font-mono text-[0.47rem] uppercase tracking-wider text-muted">
                    Influence
                  </span>
                  <select
                    aria-label={`Influence for ${contact.name}`}
                    value={influence}
                    disabled={!!savingId}
                    onChange={(event) =>
                      save(contact, {
                        stakeholderInfluence: event.target.value as Influence,
                      })
                    }
                    className={selectClass}
                  >
                    {INFLUENCE.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mb-1 block font-mono text-[0.47rem] uppercase tracking-wider text-muted">
                    Engagement
                  </span>
                  <select
                    aria-label={`Engagement for ${contact.name}`}
                    value={engagement}
                    disabled={!!savingId}
                    onChange={(event) =>
                      save(contact, {
                        stakeholderEngagement: event.target.value as Engagement,
                      })
                    }
                    className={selectClass}
                  >
                    {ENGAGEMENT.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
