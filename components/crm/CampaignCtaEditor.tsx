"use client";

import {
  defaultOutreachCampaignCtaConfig,
  OUTREACH_CAMPAIGN_CTA_TYPES,
  sanitizeOutreachCampaignCtaConfig,
  type OutreachCampaignCtaConfig,
  type OutreachCampaignCtaType,
} from "@/lib/outreach-demo-reply-cta";

const CTA_OPTIONS: Array<{
  type: OutreachCampaignCtaType;
  label: string;
  description: string;
}> = [
  {
    type: "reply_demo",
    label: "Reply to book a demo",
    description: "Invite the prospect to reply so the salesperson can arrange it.",
  },
  {
    type: "reply_call",
    label: "Reply for a quick call",
    description: "Use a lighter conversation based next step.",
  },
  {
    type: "personal_booking_link",
    label: "Use my booking link",
    description: "Use the exact signed in salesperson's own link from My Sales Setup.",
  },
  {
    type: "link",
    label: "Open a link",
    description: "Send the prospect to a campaign page, trial or other shared destination.",
  },
  {
    type: "video",
    label: "Watch a video",
    description: "Make a short campaign video the next step.",
  },
  {
    type: "voice_note",
    label: "Listen to the voice note",
    description: "Use the personal voice player in the email as the main next step.",
  },
  {
    type: "custom",
    label: "Custom action",
    description: "Write a different approved next step for this campaign.",
  },
  {
    type: "none",
    label: "No CTA",
    description: "Deliberately leave the next step open for this campaign.",
  },
  {
    type: "auto",
    label: "Use existing campaign wording",
    description: "Keep the current free text behaviour for an older campaign.",
  },
];

function editableConfig(value: unknown): OutreachCampaignCtaConfig {
  const source = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  const requestedType = String(source.type || "auto").trim();
  const type = (OUTREACH_CAMPAIGN_CTA_TYPES as readonly string[]).includes(
    requestedType
  )
    ? (requestedType as OutreachCampaignCtaType)
    : "auto";
  const defaults = defaultOutreachCampaignCtaConfig(type);
  return {
    type,
    label:
      Object.prototype.hasOwnProperty.call(source, "label")
        ? String(source.label || "")
        : defaults.label,
    url:
      Object.prototype.hasOwnProperty.call(source, "url")
        ? String(source.url || "")
        : defaults.url,
  };
}

export default function CampaignCtaEditor({
  value,
  disabled = false,
  onChange,
}: {
  value: unknown;
  disabled?: boolean;
  onChange: (value: OutreachCampaignCtaConfig) => void;
}) {
  const config = editableConfig(value);
  const selected = CTA_OPTIONS.find((option) => option.type === config.type);
  const validation = sanitizeOutreachCampaignCtaConfig(config, "auto");
  const needsLabel = [
    "reply_demo",
    "reply_call",
    "personal_booking_link",
    "link",
    "video",
    "voice_note",
    "custom",
  ].includes(config.type);
  const needsUrl = ["link", "video"].includes(config.type);
  const supportsOptionalUrl = config.type === "custom";

  const input =
    "min-h-11 w-full rounded-lg border border-edge bg-ink/70 px-3 py-2 text-sm text-bone outline-none transition placeholder:text-muted/65 focus:border-amber/65 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <section className="rounded-xl border border-sky/35 bg-sky/[0.045] p-3 sm:p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="font-mono text-[0.52rem] uppercase tracking-wider text-sky">
            Call to action
          </p>
          <h5 className="mt-1 font-display text-base text-bone">
            What should the prospect do next?
          </h5>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            This choice guides both the email and voice script. It remains editable on every individual draft.
          </p>
        </div>
        <span className="self-start rounded-full border border-sky/35 bg-sky/10 px-2.5 py-1 font-mono text-[0.46rem] uppercase text-sky">
          Campaign default
        </span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <label>
          <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
            Action
          </span>
          <select
            className={input}
            value={config.type}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                defaultOutreachCampaignCtaConfig(
                  event.target.value as OutreachCampaignCtaType
                )
              )
            }
          >
            {CTA_OPTIONS.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs leading-5 text-bone/70">
            {selected?.description}
          </p>
        </label>

        <div className="grid gap-3">
          {needsLabel ? (
            <label>
              <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                {config.type === "custom" ? "Exact next step" : "CTA label"}
              </span>
              <input
                className={input}
                value={config.label}
                disabled={disabled}
                maxLength={180}
                placeholder={defaultOutreachCampaignCtaConfig(config.type).label}
                onChange={(event) =>
                  onChange({ ...config, label: event.target.value })
                }
              />
            </label>
          ) : null}

          {needsUrl || supportsOptionalUrl ? (
            <label>
              <span className="mb-1 block font-mono text-[0.5rem] uppercase text-muted">
                {supportsOptionalUrl ? "Secure link, optional" : "Secure link"}
              </span>
              <input
                type="url"
                inputMode="url"
                className={input}
                value={config.url}
                disabled={disabled}
                maxLength={1200}
                placeholder="https://"
                onChange={(event) =>
                  onChange({ ...config, url: event.target.value })
                }
              />
            </label>
          ) : null}

          {config.type === "personal_booking_link" ? (
            <p className="rounded-lg border border-moss/35 bg-moss/[0.06] px-3 py-2 text-xs leading-5 text-moss">
              The link is resolved from the signed in salesperson at draft time. A teammate&apos;s calendar link can never be substituted.
            </p>
          ) : null}
          {config.type === "voice_note" ? (
            <p className="rounded-lg border border-amber/35 bg-amber/[0.06] px-3 py-2 text-xs leading-5 text-bone/80">
              The listening card becomes the email CTA once the voice note is generated. The spoken pitch can still finish by inviting a reply for a demo.
            </p>
          ) : null}
          {config.type === "none" ? (
            <p className="rounded-lg border border-edge bg-ink/35 px-3 py-2 text-xs leading-5 text-muted">
              LiveCoach will not add a CTA warning for drafts in this campaign. Safety checks still apply.
            </p>
          ) : null}
          {validation.error && config.type !== "auto" ? (
            <p className="rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-xs leading-5 text-rust">
              {validation.error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
