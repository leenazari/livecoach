"use client";

import Link from "next/link";
import { useState } from "react";
import { crmConfirmationError, crmFetch } from "@/lib/crm";

export type CrmProspectCandidate = {
  companyId: string;
  companyName: string;
  createdAt: string;
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    role: string | null;
  }>;
};

type ManualProspectDraft = {
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  jobTitle: string;
  crmCompanyId: string;
};

type ManualProspectResult = {
  prospect: {
    id: string;
    first_name?: string | null;
    email?: string | null;
  };
  created: boolean;
  duplicatePrevented: boolean;
};

const emptyDraft: ManualProspectDraft = {
  firstName: "",
  lastName: "",
  email: "",
  companyName: "",
  jobTitle: "",
  crmCompanyId: "",
};

const input =
  "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-bone placeholder:text-muted focus:border-amber/60 focus:outline-none read-only:text-muted";
const button =
  "min-h-11 rounded-lg border border-edge px-3 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-bone transition hover:border-amber/60 hover:text-amber disabled:cursor-not-allowed disabled:opacity-40";
const primary =
  "min-h-11 rounded-lg border border-amber/60 bg-amber/15 px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:opacity-40";

function splitContactName(value: string): { firstName: string; lastName: string } {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

export default function ManualProspectEntry({
  candidates,
  onSaved,
}: {
  candidates: CrmProspectCandidate[];
  onSaved: (result: ManualProspectResult) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ManualProspectDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const begin = (candidate?: CrmProspectCandidate) => {
    const savedContact = candidate?.contacts.find((contact) => contact.email) ||
      candidate?.contacts[0];
    const name = splitContactName(savedContact?.name || "");
    setDraft(candidate ? {
      firstName: name.firstName,
      lastName: name.lastName,
      email: savedContact?.email || "",
      companyName: candidate.companyName,
      jobTitle: savedContact?.role || "",
      crmCompanyId: candidate.companyId,
    } : emptyDraft);
    setError("");
    setOpen(true);
  };

  const cancel = () => {
    setOpen(false);
    setDraft(emptyDraft);
    setError("");
  };

  const update = (field: keyof ManualProspectDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const save = async () => {
    if (
      !draft.firstName.trim() ||
      !draft.companyName.trim() ||
      !draft.email.trim()
    ) return;
    setSaving(true);
    setError("");
    try {
      const result = await crmFetch<ManualProspectResult>("/api/crm/outreach", {
        method: "POST",
        body: JSON.stringify(draft),
      });
      if (!result.prospect?.id) {
        throw crmConfirmationError({
          url: "/api/crm/outreach",
          method: "POST",
          reason: "LiveCoach did not return the saved prospect",
        });
      }
      cancel();
      await onSaved(result);
    } catch (saveError: any) {
      setError(saveError?.message || "The prospect could not be added. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-3 rounded-xl border border-amber/35 bg-panel p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-base text-bone">Add a person to Outreach</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
            A client is a company record. An outreach prospect is a named person with an exact work email. LiveCoach checks the whole workspace before it creates one.
          </p>
        </div>
        <button type="button" onClick={() => open ? cancel() : begin()} className={`${primary} shrink-0`}>
          {open ? "Cancel" : "+ Add prospect"}
        </button>
      </div>

      {candidates.length ? (
        <div className="mt-3 border-t border-edge/60 pt-3">
          <p className="font-mono text-[0.53rem] uppercase tracking-wider text-amber">
            Recent clients waiting for a person
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">
            These were saved correctly under Clients but do not yet have a linked Outreach prospect.
          </p>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            {candidates.map((candidate) => {
              const exactEmailContacts = candidate.contacts.filter((contact) => contact.email);
              return (
                <article key={candidate.companyId} className="rounded-lg border border-edge bg-ink/35 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-sm text-bone">{candidate.companyName}</h3>
                      <p className="mt-1 text-xs text-muted">
                        {exactEmailContacts.length
                          ? `${exactEmailContacts.length} saved contact${exactEmailContacts.length === 1 ? "" : "s"} with an email`
                          : "No named contact with a work email yet"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link href={`/crm/${candidate.companyId}`} className={button}>Open client</Link>
                      <button type="button" onClick={() => begin(candidate)} className={primary}>
                        Add contact
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      {open ? (
        <div className="mt-3 border-t border-edge/60 pt-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="grid gap-1 text-xs text-muted">
              First name
              <input autoFocus className={input} value={draft.firstName} onChange={(event) => update("firstName", event.target.value)} placeholder="Required" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Last name
              <input className={input} value={draft.lastName} onChange={(event) => update("lastName", event.target.value)} placeholder="Optional" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Exact work email
              <input type="email" className={input} value={draft.email} onChange={(event) => update("email", event.target.value)} placeholder="Required for duplicate checks" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Company
              <input className={input} value={draft.companyName} onChange={(event) => update("companyName", event.target.value)} readOnly={Boolean(draft.crmCompanyId)} placeholder="Required" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Job title
              <input className={input} value={draft.jobTitle} onChange={(event) => update("jobTitle", event.target.value)} placeholder="Optional" />
            </label>
            <div className="flex items-end gap-2">
              <button type="button" onClick={save} disabled={saving || !draft.firstName.trim() || !draft.companyName.trim() || !draft.email.trim()} className={`${primary} flex-1`}>
                {saving ? "Checking and saving…" : "Save prospect"}
              </button>
              <button type="button" onClick={cancel} disabled={saving} className={button}>Cancel</button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            This creates a private prospect assigned to you. It does not research the person, enrol them in a campaign, or send anything.
          </p>
          {error ? <p className="mt-2 rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm text-rust">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
