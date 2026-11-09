"use client";

import { useEffect, useState } from "react";
import { crmFetch } from "@/lib/crm";
import { ADAM_CAMPAIGN_SLUG } from "@/lib/adam-outbound";

type AdamStatus = {
  migrationReady: boolean;
  sheetsConnected: boolean;
  sheetsGranted: boolean;
  reconnectUrl: string;
  campaign: {
    id: string;
    name: string;
    slug: string;
    playbook?: {
      product?: { name?: string; summary?: string; price?: string };
      emailPrompt?: string;
    };
  } | null;
};

type SyncResult = {
  notice?: string;
  scanned?: number;
  created?: number;
  updated?: number;
  held?: number;
  skipped?: number;
  failed?: number;
  leadClash?: string;
  truncated?: boolean;
};

const button =
  "min-h-11 rounded-lg border border-edge px-3 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber disabled:cursor-not-allowed disabled:opacity-40";
const primary =
  "min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40";

export default function AdamOutboundPanel({
  campaignId,
  canEditPrompt,
  selected,
  onShowCampaign,
  onSynced,
}: {
  campaignId: string | null;
  canEditPrompt: boolean;
  selected: boolean;
  onShowCampaign: (campaignId: string) => void;
  onSynced: () => Promise<void> | void;
}) {
  const [status, setStatus] = useState<AdamStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    let cancelled = false;
    crmFetch<AdamStatus>("/api/crm/outreach/adam")
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setPrompt(next.campaign?.playbook?.emailPrompt || "");
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message || "Adam outbound could not be loaded");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sync = async () => {
    setBusy("sync");
    setError("");
    setNotice("");
    try {
      const result = await crmFetch<SyncResult>("/api/crm/outreach/adam/sync", {
        method: "POST",
        body: "{}",
      });
      setNotice(result.notice || "Sync finished. Nothing was emailed.");
      if (result.leadClash === "not_installed") {
        setNotice((current) => `${current} Company clash warnings from pull request 411 are not installed yet, so only SendPilot, contacts, and outreach matches were checked.`);
      }
      await onSynced();
    } catch (syncError: any) {
      setError(syncError.message || "The Adam sync did not finish");
    } finally {
      setBusy("");
    }
  };

  const savePrompt = async () => {
    setBusy("prompt");
    setError("");
    try {
      const saved = await crmFetch<{ playbook?: { emailPrompt?: string } }>("/api/crm/outreach/adam", {
        method: "PATCH",
        body: JSON.stringify({ emailPrompt: prompt }),
      });
      setPrompt(saved.playbook?.emailPrompt || prompt);
      setNotice("Prompt saved on the Adam outbound campaign. Nothing was sent.");
    } catch (saveError: any) {
      setError(saveError.message || "The prompt was not saved");
    } finally {
      setBusy("");
    }
  };

  const product = status?.campaign?.playbook?.product;
  const readyId = status?.campaign?.id || campaignId;

  return (
    <section className="mb-4 rounded-xl border border-amber/40 bg-amber/[0.06] p-4" aria-label="Adam outbound">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-[0.55rem] uppercase tracking-wider text-amber">{ADAM_CAMPAIGN_SLUG}</p>
          <h2 className="mt-1 font-display text-lg text-bone">Adam outbound</h2>
          <p className="mt-1 text-sm leading-6 text-bone/80">
            {product?.summary || "AI website greeter and sales avatar"}
            {product?.price ? `. ${product.price}.` : ""}
            {" "}Drafts stay here until a person approves them and presses send.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {readyId ? (
            <button type="button" className={selected ? primary : button} onClick={() => onShowCampaign(readyId)}>
              {selected ? "Showing Adam leads" : "Show Adam leads"}
            </button>
          ) : null}
          <button type="button" className={primary} onClick={() => void sync()} disabled={!!busy || status?.migrationReady === false}>
            {busy === "sync" ? "Syncing sheet…" : "Sync sheet"}
          </button>
        </div>
      </div>
      {status && !status.migrationReady ? (
        <p className="mt-3 text-sm leading-6 text-amber" role="status">
          The Adam migration is not on this database yet. Sync stays off until Lee applies it on a preview database.
        </p>
      ) : null}
      {status && status.migrationReady && !status.sheetsGranted ? (
        <p className="mt-3 text-sm leading-6 text-bone/80" role="status">
          Google Sheets is not on this account yet. The current Google connection does not include it.
          {" "}
          <a className="text-amber underline underline-offset-4" href={status.reconnectUrl || "/api/auth/google/start?sheets=1"}>
            Reconnect Google with Sheets
          </a>
          {" "}after the Sheets scope is added to the existing Google Cloud client, and share the Adam daily leads spreadsheet with that account.
        </p>
      ) : null}
      {notice ? <p className="mt-3 text-sm leading-6 text-moss" role="status">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm leading-6 text-rust" role="alert">{error}</p> : null}
      {canEditPrompt && status?.campaign ? (
        <details className="mt-3">
          <summary className="cursor-pointer font-mono text-[0.55rem] uppercase tracking-wider text-amber">Email prompt stored on this campaign</summary>
          <textarea
            className="mt-2 min-h-40 w-full rounded-lg border border-edge bg-ink/50 px-3 py-2 text-sm leading-6 text-bone"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            aria-label="Adam email prompt"
          />
          <button type="button" className={`${button} mt-2`} onClick={() => void savePrompt()} disabled={!!busy}>
            {busy === "prompt" ? "Saving prompt…" : "Save prompt"}
          </button>
        </details>
      ) : null}
    </section>
  );
}

export function AdamLeadFacts({
  prospect,
  busy,
  canDraft,
  onDraft,
}: {
  prospect: {
    id: string;
    email?: string | null;
    source_metadata?: Record<string, any> | null;
  };
  busy: string;
  canDraft: boolean;
  onDraft: (prospectId: string) => void;
}) {
  const meta = prospect.source_metadata || {};
  const hold = meta.adam_hold;
  return (
    <div className="rounded-lg border border-amber/30 bg-ink/30 p-3 sm:col-span-7">
      <p className="font-mono text-[0.5rem] uppercase tracking-wider text-amber">
        {meta.audience === "decision_maker" ? "Decision maker email" : "General inbox"}
        {meta.page_status ? ` · page ${meta.page_status}` : ""}
      </p>
      <dl className="mt-2 grid gap-2 text-xs leading-5 text-bone/80 sm:grid-cols-2">
        <div>
          <dt className="text-muted">General inbox</dt>
          <dd>{meta.general_email || "Not on the sheet"}</dd>
        </div>
        <div>
          <dt className="text-muted">Decision maker</dt>
          <dd>{meta.decision_maker_email || "Not on the sheet"}</dd>
        </div>
        <div>
          <dt className="text-muted">Demo link</dt>
          <dd>{meta.demo_link ? <a className="break-all text-amber underline underline-offset-4" href={meta.demo_link} target="_blank" rel="noreferrer">{meta.demo_link}</a> : "No demo link yet"}</dd>
        </div>
        <div>
          <dt className="text-muted">Why Adam fits</dt>
          <dd>{meta.why_adam_fits || "Not recorded"}</dd>
        </div>
        {meta.sector || meta.company_size || meta.location ? (
          <div>
            <dt className="text-muted">Client details</dt>
            <dd>{[meta.sector, meta.company_size, meta.location].filter(Boolean).join(" · ")}</dd>
          </div>
        ) : null}
      </dl>
      {hold?.reason ? <p className="mt-2 text-sm leading-6 text-amber" role="status">{hold.reason} {hold.nextAction}</p> : null}
      {canDraft && !hold ? (
        <button type="button" className={`${primary} mt-3`} onClick={() => onDraft(prospect.id)} disabled={!!busy}>
          {busy === `adam-draft:${prospect.id}` ? "Drafting…" : "Draft Adam email"}
        </button>
      ) : null}
    </div>
  );
}
