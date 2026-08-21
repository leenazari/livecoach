"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import NavMenu from "@/components/crm/NavMenu";
import MatrixRain from "@/components/MatrixRain";
import { crmFetch } from "@/lib/crm";

type Member = {
  user_id: string;
  role: "owner" | "manager" | "sales";
  status: "active" | "onboarding" | "suspended" | "removed";
  displayName: string | null;
  email: string | null;
  googleConnected: boolean;
  googleEmail: string | null;
  transcriberName: string;
  created_at: string;
};

type Invitation = {
  id: string;
  email: string;
  role: "manager" | "sales";
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string | null;
  created_at: string;
  accepted_at: string | null;
};

type TeamData = {
  members: Member[];
  invitations: Invitation[];
  sharedData: {
    outreachProspects: number;
    companies: number;
    opportunities: number;
  };
  activation: { ready: boolean; reason: string };
};

const badge = (status: string) => {
  if (status === "active") return "border-sage/50 bg-sage/10 text-sage";
  if (status === "onboarding" || status === "pending")
    return "border-amber/50 bg-amber/10 text-amber";
  return "border-edge bg-ink/40 text-muted";
};

export default function TeamAccessPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"sales" | "manager">("sales");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await crmFetch<TeamData>("/api/crm/team"));
    } catch (err: any) {
      setError(err?.message || "Team access could not be loaded");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const invite = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      await crmFetch("/api/crm/team", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
      setNote(`Invitation sent to ${email.trim().toLowerCase()}.`);
      setEmail("");
      await load();
    } catch (err: any) {
      setError(err?.message || "The invitation was not sent");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invitationId: string) => {
    setBusy(true);
    setError("");
    try {
      await crmFetch("/api/crm/team", {
        method: "DELETE",
        body: JSON.stringify({ invitationId }),
      });
      await load();
    } catch (err: any) {
      setError(err?.message || "The invitation was not revoked");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative z-10 mx-auto max-w-[1050px] px-4 py-8 sm:px-6 sm:py-10">
      <NavMenu />
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-4">
        <div>
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-amber">
            Owner controls
          </p>
          <h1 className="mt-1 font-display text-2xl text-bone">Team access</h1>
        </div>
        <Link
          href="/settings"
          className="rounded-full border border-edge px-4 py-2 font-mono text-[0.62rem] uppercase tracking-wider text-muted hover:border-amber/50 hover:text-amber"
        >
          Back to settings
        </Link>
      </header>

      {!data && !error ? (
        <MatrixRain size="panel" messages={["checking access boundaries", "counting shared records"]} />
      ) : null}

      {error ? (
        <p role="alert" className="mb-4 rounded-xl border border-rust/50 bg-rust/10 px-4 py-3 text-sm text-rust">
          {error}
        </p>
      ) : null}
      {note ? (
        <p role="status" className="mb-4 rounded-xl border border-sage/50 bg-sage/10 px-4 py-3 text-sm text-sage">
          {note}
        </p>
      ) : null}

      {data ? (
        <div className="space-y-5">
          <section className="rounded-2xl border border-sage/40 bg-sage/[0.06] p-5">
            <h2 className="font-display text-lg text-bone">What a colleague can see</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
              Only records deliberately marked for the sales team. Private calls, transcripts, calendar events, Gmail, documents, investors, personal clients and Brain memory remain owner only.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ["Shared outreach", data.sharedData.outreachProspects],
                ["Shared client records", data.sharedData.companies],
                ["Shared opportunities", data.sharedData.opportunities],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-edge bg-ink/35 p-4">
                  <p className="font-mono text-[0.58rem] uppercase tracking-wider text-muted">{label}</p>
                  <p className="mt-2 font-display text-2xl text-bone">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-amber/40 bg-amber/[0.06] p-5">
            <h2 className="font-display text-lg text-bone">Invite account setup</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The invite lets your salesperson create their login and connect their own Google account. CRM access remains locked during onboarding, so sending an invite cannot expose Lee's data.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_150px_auto]">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") invite();
                }}
                placeholder="salesperson@company.com"
                className="min-h-12 rounded-xl border border-edge bg-ink/60 px-4 text-sm text-bone outline-none focus:border-amber/60"
              />
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as "sales" | "manager")}
                className="min-h-12 rounded-xl border border-edge bg-ink/60 px-3 font-mono text-xs uppercase text-bone outline-none focus:border-amber/60"
              >
                <option value="sales">Sales</option>
                <option value="manager">Manager</option>
              </select>
              <button
                type="button"
                onClick={invite}
                disabled={busy || !email.trim()}
                className="min-h-12 rounded-full bg-amber px-5 font-mono text-xs font-semibold uppercase tracking-wider text-ink disabled:opacity-50"
              >
                {busy ? "Working…" : "Send invite"}
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-amber/85">{data.activation.reason}</p>
          </section>

          <section className="rounded-2xl border border-edge bg-panel/45 p-5">
            <h2 className="font-display text-lg text-bone">Accounts</h2>
            <div className="mt-4 space-y-3">
              {data.members.map((member) => (
                <div key={member.user_id} className="flex flex-col gap-3 rounded-xl border border-edge bg-ink/35 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-sans text-sm font-semibold text-bone">{member.displayName || member.email || "Invited account"}</p>
                    <p className="mt-1 text-xs text-muted">{member.email || "Email pending"}</p>
                    <p className="mt-1 text-xs text-muted">
                      {member.googleConnected
                        ? `Google connected as ${member.googleEmail || member.email || "this account"}`
                        : "Google not connected"}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Notetaker ready as {member.transcriberName}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-edge px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-muted">{member.role}</span>
                    <span className={`rounded-full border px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider ${badge(member.status)}`}>{member.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-edge bg-panel/45 p-5">
            <h2 className="font-display text-lg text-bone">Invitation history</h2>
            <div className="mt-4 space-y-3">
              {data.invitations.length ? data.invitations.map((invitation) => (
                <div key={invitation.id} className="flex flex-col gap-3 rounded-xl border border-edge bg-ink/35 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-bone">{invitation.email}</p>
                    <p className="mt-1 text-xs text-muted">{invitation.role} · sent {new Date(invitation.created_at).toLocaleString("en-GB")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider ${badge(invitation.status)}`}>{invitation.status}</span>
                    {invitation.status === "pending" ? (
                      <button type="button" onClick={() => revoke(invitation.id)} disabled={busy} className="rounded-full border border-rust/50 px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-rust disabled:opacity-50">Revoke</button>
                    ) : null}
                  </div>
                </div>
              )) : (
                <p className="text-sm text-muted">No invitations have been sent.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
