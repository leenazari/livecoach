"use client";

import { useMemo, useState } from "react";
import {
  crmFetch,
  type Contact,
  type Department,
  type Workstream,
  type WorkstreamContact,
} from "@/lib/crm";

export default function RelationshipStructure({
  companyId,
  contacts,
  departments,
  workstreams,
  links,
  onContactSaved,
  onLinksSaved,
  onStructureSaved,
}: {
  companyId: string;
  contacts: Contact[];
  departments: Department[];
  workstreams: Workstream[];
  links: WorkstreamContact[];
  onContactSaved: (contact: Contact) => void;
  onLinksSaved: (links: WorkstreamContact[]) => void;
  onStructureSaved: () => Promise<void>;
}) {
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [newDepartment, setNewDepartment] = useState("");
  const [newWorkstream, setNewWorkstream] = useState("");
  const [newPurpose, setNewPurpose] = useState("");
  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts]
  );

  const saveDepartment = async (contact: Contact, departmentId: string) => {
    if (savingId) return;
    const previous = contact;
    const optimistic = { ...contact, department_id: departmentId || null };
    setSavingId(contact.id);
    setError("");
    onContactSaved(optimistic);
    try {
      const { contact: saved } = await crmFetch<{ contact: Contact }>(
        `/api/crm/contacts/${contact.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ departmentId: departmentId || null }),
        }
      );
      onContactSaved(saved);
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
    } catch {
      onContactSaved(previous);
      setError(`The department change for ${contact.name} did not save.`);
    } finally {
      setSavingId("");
    }
  };

  const createWorkstream = async () => {
    if (!newDepartment.trim() || !newWorkstream.trim() || savingId) return;
    setSavingId("new-workstream");
    setError("");
    try {
      await crmFetch(`/api/crm/companies/${companyId}/workstreams`, {
        method: "POST",
        body: JSON.stringify({
          departmentName: newDepartment.trim(),
          name: newWorkstream.trim(),
          purpose: newPurpose.trim(),
        }),
      });
      setNewDepartment("");
      setNewWorkstream("");
      setNewPurpose("");
      setAdding(false);
      await onStructureSaved();
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
    } catch (err: any) {
      setError(err?.message || "The new workstream did not save.");
    } finally {
      setSavingId("");
    }
  };

  const toggleWorkstreamContact = async (
    workstream: Workstream,
    contact: Contact
  ) => {
    if (savingId) return;
    const key = `${workstream.id}:${contact.id}`;
    const isAssigned = links.some(
      (link) =>
        link.workstream_id === workstream.id && link.contact_id === contact.id
    );
    setSavingId(key);
    setError("");
    try {
      await crmFetch(`/api/crm/workstreams/${workstream.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          contactId: contact.id,
          assigned: !isAssigned,
        }),
      });
      const nextLinks = isAssigned
        ? links.filter(
            (link) =>
              !(
                link.workstream_id === workstream.id &&
                link.contact_id === contact.id
              )
          )
        : [
            ...links,
            {
              workstream_id: workstream.id,
              contact_id: contact.id,
              company_id: workstream.company_id,
              relationship_role: null,
              is_primary: false,
            },
          ];
      onLinksSaved(nextLinks);
      window.dispatchEvent(new CustomEvent("lc:crm-updated"));
    } catch {
      setError(
        `The workstream assignment for ${contact.name} did not save.`
      );
    } finally {
      setSavingId("");
    }
  };

  return (
    <section className="mb-4 rounded-xl border border-edge bg-panel/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">
            ◇ Departments and workstreams
          </p>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-muted">
            Company facts are shared. Calls, emails, actions and Brain memory stay inside their workstream.
          </p>
        </div>
        <span className="rounded-full border border-sage/35 bg-sage/[0.08] px-2.5 py-1 font-mono text-[0.52rem] uppercase tracking-wider text-sage">
          {workstreams.filter((thread) => thread.status === "active").length} active threads
        </span>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className="rounded-full border border-edge px-3 py-1.5 font-mono text-[0.52rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber"
        >
          {adding ? "Cancel" : "+ New relationship"}
        </button>
        {adding ? (
          <div className="mt-2 grid gap-2 rounded-xl border border-edge bg-ink/35 p-3 md:grid-cols-3">
            <input
              value={newDepartment}
              onChange={(event) => setNewDepartment(event.target.value)}
              placeholder="Department, for example Admissions"
              className="rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-bone outline-none focus:border-amber/60"
            />
            <input
              value={newWorkstream}
              onChange={(event) => setNewWorkstream(event.target.value)}
              placeholder="Workstream, for example Pilot rollout"
              className="rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-bone outline-none focus:border-amber/60"
            />
            <input
              value={newPurpose}
              onChange={(event) => setNewPurpose(event.target.value)}
              placeholder="Purpose, outcome or relationship"
              className="rounded-lg border border-edge bg-ink px-3 py-2 text-sm text-bone outline-none focus:border-amber/60"
            />
            <button
              type="button"
              disabled={
                !newDepartment.trim() ||
                !newWorkstream.trim() ||
                !!savingId
              }
              onClick={createWorkstream}
              className="rounded-lg border border-sage/50 bg-sage/10 px-3 py-2 font-mono text-[0.56rem] uppercase tracking-wider text-sage disabled:opacity-40 md:col-span-3"
            >
              {savingId === "new-workstream"
                ? "Saving…"
                : "Create relationship"}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm text-rust">
          {error}
        </p>
      ) : null}

      {departments.length ? (
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {departments.map((department) => {
          const departmentContacts = contacts.filter(
            (contact) => contact.department_id === department.id
          );
          const departmentThreads = workstreams.filter(
            (thread) => thread.department_id === department.id
          );
          return (
            <article key={department.id} className="rounded-xl border border-edge bg-ink/45 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-sans text-sm font-semibold text-bone">
                    {department.name}
                  </h3>
                  {department.description ? (
                    <p className="mt-0.5 text-xs leading-4 text-muted">
                      {department.description}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 font-mono text-[0.5rem] uppercase tracking-wider text-muted">
                  {departmentContacts.length} people
                </span>
              </div>

              <div className="mt-3 space-y-2">
                {departmentThreads.map((thread) => {
                  const threadContacts = links
                    .filter((link) => link.workstream_id === thread.id)
                    .map((link) => contactById.get(link.contact_id))
                    .filter(Boolean) as Contact[];
                  return (
                    <div key={thread.id} className="rounded-lg border border-sage/25 bg-sage/[0.05] p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-sans text-sm font-medium text-bone">
                          {thread.name}
                        </span>
                        <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-[0.46rem] uppercase tracking-wider text-muted">
                          {thread.kind}
                        </span>
                        <span className="ml-auto rounded-full border border-sage/30 px-2 py-0.5 font-mono text-[0.46rem] uppercase tracking-wider text-sage">
                          {thread.status}
                        </span>
                      </div>
                      {thread.purpose ? (
                        <p className="mt-1 text-xs leading-4 text-muted">{thread.purpose}</p>
                      ) : null}
                      <p className="mt-2 font-mono text-[0.5rem] uppercase tracking-wider text-sky">
                        {threadContacts.length
                          ? threadContacts.map((contact) => contact.name).join(" · ")
                          : "No contacts assigned"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
      ) : null}

      {contacts.length && departments.length ? (
      <div className="mt-4 border-t border-edge pt-3">
        <p className="mb-2 font-mono text-[0.52rem] uppercase tracking-[0.14em] text-muted">
          Assign each person to their department
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {contacts.map((contact) => (
            <label key={contact.id} className="rounded-lg border border-edge bg-ink/35 p-2.5">
              <span className="block truncate text-xs font-medium text-bone">
                {contact.name}
              </span>
              <select
                aria-label={`Department for ${contact.name}`}
                value={contact.department_id || ""}
                disabled={!!savingId}
                onChange={(event) => saveDepartment(contact, event.target.value)}
                className="mt-1.5 w-full rounded-md border border-edge bg-ink px-2 py-1.5 text-xs text-bone outline-none focus:border-amber/60 disabled:opacity-50"
              >
                <option value="">Department not set</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      ) : null}

      {contacts.length && workstreams.length ? (
      <div className="mt-4 border-t border-edge pt-3">
        <p className="mb-2 font-mono text-[0.52rem] uppercase tracking-[0.14em] text-muted">
          Keep each person in the right workstream
        </p>
        <div className="grid gap-2 lg:grid-cols-2">
          {workstreams
            .filter((thread) => thread.status === "active")
            .map((thread) => (
              <fieldset
                key={thread.id}
                className="rounded-lg border border-edge bg-ink/35 p-2.5"
              >
                <legend className="px-1 text-xs font-medium text-bone">
                  {thread.name}
                </legend>
                <div className="mt-1 flex flex-wrap gap-2">
                  {contacts.map((contact) => {
                    const checked = links.some(
                      (link) =>
                        link.workstream_id === thread.id &&
                        link.contact_id === contact.id
                    );
                    return (
                      <label
                        key={contact.id}
                        className={`flex min-h-9 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                          checked
                            ? "border-sage/50 bg-sage/[0.08] text-bone"
                            : "border-edge text-muted"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!!savingId}
                          onChange={() =>
                            toggleWorkstreamContact(thread, contact)
                          }
                          className="accent-[var(--sage)]"
                        />
                        {contact.name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
        </div>
      </div>
      ) : null}
    </section>
  );
}
