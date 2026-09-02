"use client";

import { useEffect, useMemo, useState } from "react";

import { crmFetch } from "@/lib/crm";
import {
  defaultOutreachCampaignCtaConfig,
  effectiveOutreachCtaConfig,
  sanitizeOutreachCampaignCtaConfig,
  type OutreachCampaignCtaConfig,
  type OutreachCampaignCtaType,
} from "@/lib/outreach-demo-reply-cta";

type SavedResult = {
  enrolment: {
    id: string;
    cta_config: OutreachCampaignCtaConfig | null;
  };
  draftNeedsRefresh?: boolean;
  lockedHistoricalMessage?: boolean;
};

type Props = {
  enrolmentId: string;
  value?: unknown;
  campaignValue?: unknown;
  disabled?: boolean;
  hasEditableDraft?: boolean;
  onSaved?: (
    value: OutreachCampaignCtaConfig | null,
    result: SavedResult
  ) => void;
  onBlockingChange?: (blocked: boolean) => void;
};

const OPTIONS: Array<{ type: OutreachCampaignCtaType; label: string }> = [
  { type: "reply_demo", label: "Reply to book a demo" },
  { type: "personal_booking_link", label: "Click my demo booking link" },
  { type: "reply_call", label: "Reply for a quick call" },
  { type: "voice_note", label: "Listen to the voice note" },
  { type: "video", label: "Watch a video" },
  { type: "link", label: "Open a link" },
  { type: "custom", label: "Custom action" },
  { type: "none", label: "No call to action" },
];

function savedOverride(value: unknown): OutreachCampaignCtaConfig | null {
  if (!value || typeof value !== "object") return null;
  const validated = sanitizeOutreachCampaignCtaConfig(value, "auto");
  if (validated.error || validated.config.type === "auto") return null;
  return validated.config;
}

function selectionLabel(config: OutreachCampaignCtaConfig): string {
  if (config.type === "auto") return "Best fit from campaign wording";
  if (config.type === "none") return "No call to action";
  return OPTIONS.find((option) => option.type === config.type)?.label ||
    config.label ||
    "Campaign default";
}

export default function ProspectCtaSelector({
  enrolmentId,
  value,
  campaignValue,
  disabled = false,
  hasEditableDraft = false,
  onSaved,
  onBlockingChange,
}: Props) {
  const currentOverride = useMemo(() => savedOverride(value), [value]);
  const recommended = useMemo(
    () =>
      effectiveOutreachCtaConfig({ campaignCtaConfig: campaignValue }).config,
    [campaignValue]
  );
  const [config, setConfig] = useState<OutreachCampaignCtaConfig | null>(
    currentOverride
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setConfig(currentOverride);
    setDirty(false);
    setError("");
  }, [currentOverride]);

  const type = config?.type || "inherit";
  const needsDetails = Boolean(
    config && ["link", "video", "custom"].includes(config.type)
  );
  const validation = config
    ? sanitizeOutreachCampaignCtaConfig(config, "auto")
    : { error: null, config: recommended };

  const save = async (next: OutreachCampaignCtaConfig | null) => {
    setSaving(true);
    setError("");
    setNotice("");
    onBlockingChange?.(true);
    let didSave = false;
    try {
      const result = await crmFetch<SavedResult>(
        `/api/crm/outreach/enrolments/${enrolmentId}/cta`,
        {
          method: "PATCH",
          body: JSON.stringify({ ctaConfig: next }),
        }
      );
      const saved = result.enrolment.cta_config || null;
      setConfig(saved);
      setDirty(false);
      onSaved?.(saved, result);
      setNotice(
        result.draftNeedsRefresh || hasEditableDraft
          ? "Saved. Refresh the draft to apply it."
          : result.lockedHistoricalMessage
            ? "Saved for the next email. The sent email is unchanged."
            : "Saved for research and drafting."
      );
      didSave = true;
    } catch (cause: any) {
      setError(cause?.message || "The call to action could not be saved");
    } finally {
      setSaving(false);
      onBlockingChange?.(!didSave);
    }
  };

  const choose = (nextType: string) => {
    setError("");
    setNotice("");
    if (nextType === "inherit") {
      setConfig(null);
      setDirty(false);
      void save(null);
      return;
    }

    const next = defaultOutreachCampaignCtaConfig(
      nextType as OutreachCampaignCtaType
    );
    setConfig(next);
    if (["link", "video", "custom"].includes(next.type)) {
      setDirty(true);
      onBlockingChange?.(true);
      return;
    }
    setDirty(false);
    void save(next);
  };

  const input =
    "min-h-10 w-full rounded-lg border border-edge bg-ink/70 px-3 py-2 text-xs text-bone outline-none transition focus:border-sky/65 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="rounded-lg border border-sky/30 bg-sky/[0.045] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.48rem] uppercase tracking-wider text-sky">
            Call to action for this email
          </p>
          <select
            aria-label="Call to action for this prospect"
            className={`${input} mt-1`}
            value={type}
            disabled={disabled || saving}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="inherit">
              Recommended · {selectionLabel(recommended)}
            </option>
            {OPTIONS.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <span className="shrink-0 rounded-full border border-sky/35 px-2 py-1 font-mono text-[0.44rem] uppercase text-sky">
          {config ? "Person choice" : "Campaign recommendation"}
        </span>
      </div>

      {needsDetails && config ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            className={input}
            value={config.label}
            disabled={disabled || saving}
            maxLength={180}
            placeholder={config.type === "custom" ? "Exact next step" : "Button wording"}
            onChange={(event) => {
              setConfig({ ...config, label: event.target.value });
              setDirty(true);
              setNotice("");
              onBlockingChange?.(true);
            }}
          />
          <input
            type="url"
            inputMode="url"
            className={input}
            value={config.url}
            disabled={disabled || saving}
            maxLength={1200}
            placeholder={config.type === "custom" ? "Secure link if needed" : "https://"}
            onChange={(event) => {
              setConfig({ ...config, url: event.target.value });
              setDirty(true);
              setNotice("");
              onBlockingChange?.(true);
            }}
          />
          <button
            type="button"
            className="min-h-10 rounded-lg border border-sky/45 bg-sky/10 px-3 font-mono text-[0.52rem] uppercase tracking-wider text-sky disabled:opacity-40"
            disabled={disabled || saving || Boolean(validation.error) || !dirty}
            onClick={() => void save(config)}
          >
            {saving ? "Saving…" : "Save action"}
          </button>
        </div>
      ) : null}

      {config?.type === "personal_booking_link" ? (
        <p className="mt-2 text-xs leading-5 text-bone/70">
          The email shows your own booking link. The voice note tells them to use that same link.
        </p>
      ) : config?.type === "voice_note" ? (
        <p className="mt-2 text-xs leading-5 text-bone/70">
          The voice player is the main action, so the email will not compete with a demo link.
        </p>
      ) : null}

      {validation.error ? (
        <p className="mt-2 text-xs text-rust">{validation.error}</p>
      ) : error ? (
        <p className="mt-2 text-xs text-rust">{error}</p>
      ) : notice ? (
        <p className="mt-2 text-xs text-moss">{notice}</p>
      ) : saving ? (
        <p className="mt-2 text-xs text-muted">Saving your choice…</p>
      ) : null}
    </div>
  );
}
