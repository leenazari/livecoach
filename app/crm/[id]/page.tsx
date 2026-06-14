"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  crmFetch,
  type Company,
  type Contact,
  type FieldDefinition,
} from "@/lib/crm";
import CustomFieldEditor from "@/components/crm/CustomFieldEditor";
import AddFieldForm from "@/components/crm/AddFieldForm";

const inputCls =
  "w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 font-sans text-sm text-bone outline-none transition placeholder:text-muted/50 focus:border-amber/60";
const labelCls =
  "mb-1 block font-mono text-[0.58rem] uppercase tracking-[0.16em] text-muted";

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [opps, setOpps] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [copiedId, setCopiedId] = useState<string>("");
  const [attrs, setAttrs] = useState<Record<string, any>>({});
  const [core, setCore] = useState({
    name: "",
    sector: "",
    stage: "",
    website: "",
    domain: "",
    notes: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [savedAt, setSavedAt] = useState("");

  // New-contact form.
  const [cName, setCName] = useState("");
  const [cRole, setCRole] = useState("");
  const [cEmail, setCEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [{ company, contacts }, { fields }, { calls }, pipeline] =
        await Promise.all([
        crmFetch<{ company: Company; contacts: Contact[] }>(
          `/api/crm/companies/${id}`
        ),
        crmFetch<{ fields: FieldDefinition[] }>(
          `/api/crm/fields?entity=company`
        ),
        crmFetch<{ calls: any[] }>(`/api/crm/companies/${id}/calls`).catch(
          () => ({ calls: [] as any[] })
        ),
        crmFetch<{ opportunities: any[]; followUps: any[] }>(
          `/api/crm/companies/${id}/pipeline`
        ).catch(() => ({ opportunities: [] as any[], followUps: [] as any[] })),
      ]);
      setCompany(company);
      setContacts(contacts);
      setFields(fields);
      setCalls(calls || []);
      setOpps(pipeline.opportunities || []);
      setFollowUps(pipeline.followUps || []);
      setAttrs(company.attributes || {});
      setCore({
        name: company.name || "",
        sector: company.sector || "",
        stage: company.stage || "",
        website: company.website || "",
        domain: company.domain || "",
        notes: company.notes || "",
      });
    } catch (e: any) {
      setErr(e.message || "could not load this company");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const { company } = await crmFetch<{ company: Company }>(
        `/api/crm/companies/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...core, attributes: attrs }),
        }
      );
      setCompany(company);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e: any) {
      setErr(e.message || "could not save");
    } finally {
      setSaving(false);
    }
  };

  const addContact = async () => {
    if (!cName.trim()) return;
    try {
      const { contact } = await crmFetch<{ contact: Contact }>(
        `/api/crm/contacts`,
        {
          method: "POST",
          body: JSON.stringify({
            company_id: id,
            name: cName.trim(),
            role: cRole.trim() || undefined,
            email: cEmail.trim() || undefined,
          }),
        }
      );
      setContacts((prev) => [...prev, contact]);
      setCName("");
      setCRole("");
      setCEmail("");
    } catch (e: any) {
      setErr(e.message || "could not add the contact");
    }
  };

  const deleteContact = async (contactId: string) => {
    try {
      await crmFetch(`/api/crm/contacts/${contactId}`, { method: "DELETE" });
      setContacts((prev) => prev.filter((c) => c.id !== contactId));
    } catch (e: any) {
      setErr(e.message || "could not delete the contact");
    }
  };

  const deleteCompany = async () => {
    if (!confirm("Delete this company and all its contacts?")) return;
    try {
      await crmFetch(`/api/crm/companies/${id}`, { method: "DELETE" });
      router.push("/crm");
    } catch (e: any) {
      setErr(e.message || "could not delete the company");
    }
  };

  const setOppStatus = async (oppId: string, status: string) => {
    setOpps((prev) =>
      prev.map((o) => (o.id === oppId ? { ...o, status } : o))
    );
    crmFetch(`/api/crm/opportunities/${oppId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch(() => {});
  };

  const setFollowUpStatus = async (fuId: string, status: string) => {
    setFollowUps((prev) =>
      prev.map((f) => (f.id === fuId ? { ...f, status } : f))
    );
    crmFetch(`/api/crm/follow-ups/${fuId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }).catch(() => {});
  };

  const copyDraft = async (fu: any) => {
    const text = `Subject: ${fu.draft_subject || ""}\n\n${fu.draft_body || ""}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(fu.id);
      setTimeout(() => setCopiedId(""), 1500);
    } catch {
      /* clipboard blocked - ignore */
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-[1000px] px-5 py-10">
        <p className="font-mono text-sm text-muted">loading…</p>
      </main>
    );
  }

  if (!company) {
    return (
      <main className="mx-auto max-w-[1000px] px-5 py-10">
        <p className="font-mono text-sm text-rust">{err || "not found"}</p>
        <Link
          href="/crm"
          className="mt-3 inline-block font-mono text-[0.66rem] uppercase tracking-wider text-amber"
        >
          ◂ all companies
        </Link>
      </main>
    );
  }

  return (
    <main className="relative z-10 mx-auto max-w-[1000px] px-5 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <div className="flex items-baseline gap-3">
          <Link
            href="/crm"
            className="font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:text-amber"
          >
            ◂ clients
          </Link>
          <h1 className="font-display text-[1.4rem] leading-none tracking-tight text-bone">
            {company.name}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="font-mono text-[0.58rem] uppercase tracking-wider text-sage">
              saved {savedAt}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-full border border-amber/60 bg-amber/15 px-5 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-amber transition hover:bg-amber/25 disabled:opacity-40"
          >
            {saving ? "saving…" : "save"}
          </button>
        </div>
      </header>

      {err && <p className="mb-3 font-mono text-[0.66rem] text-rust">{err}</p>}

      {company.profile &&
        typeof company.profile === "object" &&
        typeof (company.profile as any).brief === "string" &&
        (company.profile as any).brief.trim() && (
          <div className="mb-5 rounded-xl border border-sky/40 bg-sky/[0.06] p-4">
            <p className="mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-sky">
              {"◆"} What we know{" "}
              <span className="text-muted">- learned from your calls</span>
            </p>
            <p className="font-sans text-sm leading-relaxed text-bone/85">
              {(company.profile as any).brief}
            </p>
          </div>
        )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* CORE + CUSTOM FIELDS */}
        <section className="flex flex-col gap-4">
          <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
              Details
            </p>
            <div className="flex flex-col gap-3">
              <label className="block">
                <span className={labelCls}>Name</span>
                <input
                  value={core.name}
                  onChange={(e) => setCore({ ...core, name: e.target.value })}
                  className={inputCls}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={labelCls}>Sector</span>
                  <input
                    value={core.sector}
                    onChange={(e) =>
                      setCore({ ...core, sector: e.target.value })
                    }
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>Stage</span>
                  <input
                    value={core.stage}
                    onChange={(e) => setCore({ ...core, stage: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>Website</span>
                  <input
                    value={core.website}
                    onChange={(e) =>
                      setCore({ ...core, website: e.target.value })
                    }
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className={labelCls}>Domain</span>
                  <input
                    value={core.domain}
                    onChange={(e) =>
                      setCore({ ...core, domain: e.target.value })
                    }
                    className={inputCls}
                  />
                </label>
              </div>
              <label className="block">
                <span className={labelCls}>Notes</span>
                <textarea
                  value={core.notes}
                  onChange={(e) => setCore({ ...core, notes: e.target.value })}
                  rows={4}
                  className={`${inputCls} resize-y`}
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
                Custom fields
              </p>
              <AddFieldForm
                entity="company"
                onAdded={(f) => setFields((prev) => [...prev, f])}
              />
            </div>
            {fields.length === 0 ? (
              <p className="font-mono text-[0.6rem] text-muted">
                Add any field you want to track on every company - net worth,
                deal size, renewal date. No migration, it just appears.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {fields.map((f) => (
                  <CustomFieldEditor
                    key={f.id}
                    field={f}
                    value={attrs[f.key]}
                    onChange={(v) => setAttrs((p) => ({ ...p, [f.key]: v }))}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* CONTACTS */}
        <section className="flex flex-col gap-4">
          <div className="rounded-xl border border-edge bg-panel/40 p-4">
            <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
              Contacts{" "}
              <span className="text-muted">({contacts.length})</span>
            </p>

            <div className="mb-3 flex flex-col gap-2">
              {contacts.length === 0 && (
                <p className="font-mono text-[0.6rem] text-muted">
                  No people yet. Add who you speak with at this company.
                </p>
              )}
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-sans text-sm text-bone">
                      {c.name}
                    </p>
                    <p className="truncate font-mono text-[0.58rem] uppercase tracking-wider text-muted">
                      {[c.role, c.email].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteContact(c.id)}
                    title="remove contact"
                    className="shrink-0 rounded px-2 py-1 font-mono text-[0.7rem] text-muted transition hover:text-rust"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 border-t border-edge/60 pt-3">
              <span className={labelCls}>Add a contact</span>
              <input
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                placeholder="Name"
                className={inputCls}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={cRole}
                  onChange={(e) => setCRole(e.target.value)}
                  placeholder="Role"
                  className={inputCls}
                />
                <input
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                  placeholder="Email"
                  className={inputCls}
                />
              </div>
              <button
                type="button"
                onClick={addContact}
                disabled={!cName.trim()}
                className="self-start rounded-full border border-sage/60 bg-sage/15 px-4 py-1.5 font-mono text-[0.6rem] uppercase tracking-wider text-sage transition hover:bg-sage/25 disabled:opacity-40"
              >
                + add contact
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={deleteCompany}
            className="self-start rounded-full border border-rust/50 px-4 py-1.5 font-mono text-[0.58rem] uppercase tracking-wider text-rust/80 transition hover:bg-rust/10 hover:text-rust"
          >
            delete company
          </button>
        </section>
      </div>

      {/* CALL HISTORY - scorecards from calls linked to this company. */}
      <section className="mt-5 rounded-xl border border-edge bg-panel/40 p-4">
        <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          Call history{" "}
          <span className="text-muted">({calls.length})</span>
        </p>
        {calls.length === 0 ? (
          <p className="font-mono text-[0.6rem] text-muted">
            No calls linked yet. On the call screen, set this company in the
            “Client” bar before you go live and the scorecard lands here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {calls.map((c) => {
              const overview =
                c?.summary && typeof c.summary.overview === "string"
                  ? c.summary.overview
                  : "";
              const score =
                c?.summary &&
                (typeof c.summary.score === "number"
                  ? c.summary.score
                  : typeof c.summary.overallScore === "number"
                  ? c.summary.overallScore
                  : null);
              const date = c?.created_at
                ? new Date(c.created_at).toLocaleDateString()
                : "";
              return (
                <li
                  key={c.id}
                  className="rounded-lg border border-edge bg-ink/40 px-4 py-3"
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="font-mono text-[0.6rem] uppercase tracking-wider text-muted">
                      {date}
                      {c.candidate ? ` · ${c.candidate}` : ""}
                    </span>
                    {score !== null && (
                      <span className="font-mono text-[0.62rem] text-sage">
                        {Math.round(score)}%
                      </span>
                    )}
                  </div>
                  {overview && (
                    <p className="font-sans text-[0.82rem] leading-snug text-bone/80">
                      {overview.length > 240
                        ? overview.slice(0, 240) + "…"
                        : overview}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* OPPORTUNITIES - AI-surfaced from calls. */}
      <section className="mt-5 rounded-xl border border-edge bg-panel/40 p-4">
        <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          Opportunities{" "}
          <span className="text-muted">
            ({opps.filter((o) => o.status === "open").length} open)
          </span>
        </p>
        {opps.length === 0 ? (
          <p className="font-mono text-[0.6rem] text-muted">
            Opportunities the AI spots in your calls land here. Link a call to
            this client and run it.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {opps.map((o) => (
              <li
                key={o.id}
                className={`rounded-lg border border-edge bg-ink/40 px-4 py-3 ${
                  o.status !== "open" ? "opacity-55" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-sans text-[0.9rem] text-bone">
                      {o.title}
                      {typeof o.value === "number" && (
                        <span className="ml-2 font-mono text-[0.62rem] text-sage">
                          ~£{Number(o.value).toLocaleString()}
                        </span>
                      )}
                    </p>
                    {o.detail && (
                      <p className="mt-0.5 font-sans text-[0.8rem] leading-snug text-bone/70">
                        {o.detail}
                      </p>
                    )}
                  </div>
                  <select
                    value={o.status}
                    onChange={(e) => setOppStatus(o.id, e.target.value)}
                    className="shrink-0 rounded-md border border-edge bg-ink/60 px-2 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-bone outline-none focus:border-amber/60"
                  >
                    <option value="open">open</option>
                    <option value="won">won</option>
                    <option value="lost">lost</option>
                    <option value="dismissed">dismissed</option>
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* FOLLOW-UP DRAFTS - AI-written, you review and send yourself. */}
      <section className="mt-5 rounded-xl border border-edge bg-panel/40 p-4">
        <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
          Follow-up drafts{" "}
          <span className="text-muted">- review &amp; send yourself</span>
        </p>
        {followUps.filter((f) => f.status !== "dismissed").length === 0 ? (
          <p className="font-mono text-[0.6rem] text-muted">
            After a linked call, a ready-to-send draft email appears here for you
            to review.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {followUps
              .filter((f) => f.status !== "dismissed")
              .map((f) => (
                <li
                  key={f.id}
                  className={`rounded-lg border border-edge bg-ink/40 p-3.5 ${
                    f.status === "sent" ? "opacity-60" : ""
                  }`}
                >
                  <p className="mb-1 font-sans text-[0.86rem] font-medium text-bone">
                    {f.draft_subject || "(no subject)"}
                    {f.status === "sent" && (
                      <span className="ml-2 font-mono text-[0.56rem] uppercase tracking-wider text-sage">
                        sent
                      </span>
                    )}
                  </p>
                  <p className="whitespace-pre-wrap font-sans text-[0.82rem] leading-relaxed text-bone/80">
                    {f.draft_body}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyDraft(f)}
                      className="rounded-full border border-amber/50 bg-amber/10 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
                    >
                      {copiedId === f.id ? "copied" : "copy"}
                    </button>
                    {f.status !== "sent" && (
                      <button
                        type="button"
                        onClick={() => setFollowUpStatus(f.id, "sent")}
                        className="rounded-full border border-sage/50 bg-sage/10 px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-sage transition hover:bg-sage/20"
                      >
                        mark sent
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setFollowUpStatus(f.id, "dismissed")}
                      className="rounded-full border border-edge px-3 py-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-rust"
                    >
                      dismiss
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}
