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
  microsoftConnected: boolean;
  microsoftEmail: string | null;
  mailboxProvider: "google" | "microsoft" | null;
  mailboxConnected: boolean;
  transcriberName: string;
  outreachSenderName: string | null;
  outreachSenderEmail: string | null;
  canActivate: boolean;
  activationIssues: string[];
  transcriber_daily_minutes_limit: number;
  transcriberUsage: {
    usedMinutes: number;
    remainingMinutes: number;
    dailyLimitMinutes: number;
    activeBot: boolean;
    botCount: number;
  };
  setup: {
    separateIdentity: boolean;
    outreachSenderReady: boolean;
    assignedProspects: number;
    sentMessages: number;
    transcribedCalls: number;
    privacyTestConfirmed: boolean;
    privacyTestConfirmedAt: string | null;
    canConfirmPrivacy: boolean;
  };
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
  ownerIdentities: string[];
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
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const normalizedInviteEmail = email.trim().toLowerCase();
  const ownerIdentityConflict =
    !!normalizedInviteEmail &&
    !!data?.ownerIdentities?.some(
      (identity) => identity.toLowerCase() === normalizedInviteEmail
    );

  const load = useCallback(async () => {
    setError("");
    try {
      const nextData = await crmFetch<TeamData>("/api/crm/team");
      setData(nextData);
      setLimitDrafts(
        Object.fromEntries(
          nextData.members.map((member) => [
            member.user_id,
            String(member.transcriber_daily_minutes_limit),
          ])
        )
      );
    } catch (err: any) {
      setError(err?.message || "Team access could not be loaded");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sendInvitation = async (
    inviteEmail: string,
    inviteRole: "sales" | "manager",
    replacement = false
  ) => {
    if (!inviteEmail.trim() || busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      await crmFetch("/api/crm/team", {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setNote(
        `${replacement ? "Fresh invitation" : "Invitation"} sent to ${inviteEmail.trim().toLowerCase()}.`
      );
      setEmail("");
      await load();
    } catch (err: any) {
      setError(err?.message || "The invitation was not sent");
    } finally {
      setBusy(false);
    }
  };

  const invite = async () => sendInvitation(email, role);

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

  const setMemberAccess = async (userId: string, action: "activate" | "suspend") => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await crmFetch("/api/crm/team", {
        method: "PATCH",
        body: JSON.stringify({ userId, action }),
      });
      setNote(action === "activate" ? "Account activated." : "Account suspended immediately.");
      await load();
    } catch (err: any) {
      setError(err?.message || "The account was not updated");
    } finally {
      setBusy(false);
    }
  };

  const setPrivacyTest = async (
    userId: string,
    action: "confirm_privacy_test" | "reset_privacy_test"
  ) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await crmFetch("/api/crm/team", {
        method: "PATCH",
        body: JSON.stringify({ userId, action }),
      });
      setNote(
        action === "confirm_privacy_test"
          ? "Privacy rehearsal confirmed. This account is ready for controlled live work."
          : "Privacy rehearsal sign off reset."
      );
      await load();
    } catch (err: any) {
      setError(err?.message || "The privacy rehearsal was not updated");
    } finally {
      setBusy(false);
    }
  };

  const saveTranscriberLimit = async (member: Member) => {
    const dailyMinutes = Number(limitDrafts[member.user_id]);
    if (!Number.isInteger(dailyMinutes) || dailyMinutes < 30 || dailyMinutes > 720) {
      setError("Choose a daily notetaker allowance from 30 to 720 minutes.");
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      await crmFetch("/api/crm/team", {
        method: "PATCH",
        body: JSON.stringify({
          userId: member.user_id,
          action: "update_transcriber_limit",
          dailyMinutes,
        }),
      });
      setNote(
        `${member.displayName || member.email || "Account"} now has ${dailyMinutes} notetaker minutes per day.`
      );
      await load();
    } catch (err: any) {
      setError(err?.message || "The notetaker allowance was not updated");
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
              Only records deliberately marked for the sales team. Private calls, transcripts, calendar events, email, documents, investors, personal clients and Brain memory remain owner only.
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
              The invite works with any real email address. Google or Microsoft can be connected later for that person's email and calendar. CRM access remains locked until you activate it.
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
                disabled={busy || !email.trim() || ownerIdentityConflict}
                className="min-h-12 rounded-full bg-amber px-5 font-mono text-xs font-semibold uppercase tracking-wider text-ink disabled:opacity-50"
              >
                {busy ? "Working…" : "Send invite"}
              </button>
            </div>
            {ownerIdentityConflict ? (
              <p role="alert" className="mt-3 rounded-xl border border-rust/50 bg-rust/10 px-4 py-3 text-sm leading-relaxed text-rust">
                This is your owner identity, so it cannot test privacy separation. Use a genuinely separate address belonging to the test user or salesperson.
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-amber/85">{data.activation.reason}</p>
          </section>

          <section className="rounded-2xl border border-edge bg-panel/45 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.16em] text-sage">
                  Safe onboarding
                </p>
                <h2 className="mt-1 font-display text-lg text-bone">Salesperson setup checklist</h2>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
                  Automatic checks turn green from real account activity. The final privacy sign off stays manual because you must personally challenge the Brain and confirm that private information is unavailable.
                </p>
              </div>
            </div>

            {data.members.some((member) => member.role !== "owner") ? (
              <div className="mt-5 space-y-4">
                {data.members
                  .filter((member) => member.role !== "owner")
                  .map((member) => {
                    const steps = [
                      {
                        id: "login",
                        label: "Separate login accepted",
                        detail: member.email || "Account email recorded",
                        complete: true,
                      },
                      {
                        id: "mailbox",
                        label: "Own email and calendar connected",
                        detail: member.mailboxConnected
                          ? `${member.mailboxProvider === "microsoft" ? "Microsoft" : "Google"} connected as ${member.microsoftEmail || member.googleEmail || "this user"}`
                          : "Optional for CRM access. Required before outreach sending and automatic calendar sync",
                        complete: member.mailboxConnected && member.setup.separateIdentity,
                      },
                      {
                        id: "sender",
                        label: "Outreach sender ready",
                        detail: member.setup.outreachSenderReady
                          ? member.outreachSenderEmail || "Sender verified"
                          : "Created when this user connects their own mailbox",
                        complete: member.setup.outreachSenderReady,
                      },
                      {
                        id: "active",
                        label: "Isolated CRM access activated",
                        detail: member.status === "active"
                          ? "Account can enter its own CRM workspace"
                          : "Activate after the separate identity checks pass",
                        complete: member.status === "active",
                      },
                      {
                        id: "prospect",
                        label: "Test prospect assigned",
                        detail: `${member.setup.assignedProspects} shared prospect${member.setup.assignedProspects === 1 ? "" : "s"} assigned`,
                        complete: member.setup.assignedProspects > 0,
                      },
                      {
                        id: "email",
                        label: "Test outreach email sent",
                        detail: `${member.setup.sentMessages} sent from this account`,
                        complete: member.setup.sentMessages > 0,
                      },
                      {
                        id: "call",
                        label: "Test call transcribed",
                        detail: `${member.setup.transcribedCalls} call transcript${member.setup.transcribedCalls === 1 ? "" : "s"} saved to this account`,
                        complete: member.setup.transcribedCalls > 0,
                      },
                      {
                        id: "privacy",
                        label: "Privacy rehearsal signed off",
                        detail: member.setup.privacyTestConfirmed
                          ? `Confirmed ${new Date(member.setup.privacyTestConfirmedAt || Date.now()).toLocaleString("en-GB")}`
                          : "Ask the Brain about Lee's private investors, calls, emails and transcripts. Every answer must report no access",
                        complete: member.setup.privacyTestConfirmed,
                      },
                    ];
                    const completed = steps.filter((step) => step.complete).length;
                    const ready = completed === steps.length;
                    return (
                      <article key={member.user_id} className={`rounded-2xl border p-4 ${ready ? "border-sage/50 bg-sage/[0.06]" : "border-edge bg-ink/35"}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-bone">
                              {member.displayName || member.email || "Team account"}
                            </h3>
                            <p className="mt-1 text-xs text-muted">
                              {completed} of {steps.length} checks complete
                            </p>
                          </div>
                          <span className={`rounded-full border px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider ${ready ? "border-sage/50 bg-sage/10 text-sage" : "border-amber/50 bg-amber/10 text-amber"}`}>
                            {ready
                              ? "Ready for live outreach"
                              : member.status === "active"
                                ? "CRM active, setup pending"
                                : "Test only"}
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel">
                          <div
                            className={`h-full rounded-full ${ready ? "bg-sage" : "bg-amber"}`}
                            style={{ width: `${Math.round((completed / steps.length) * 100)}%` }}
                          />
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {steps.map((step, index) => (
                            <div key={step.id} className={`rounded-xl border p-3 ${step.complete ? "border-sage/35 bg-sage/[0.05]" : "border-edge bg-panel/45"}`}>
                              <div className="flex items-start gap-3">
                                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[0.6rem] ${step.complete ? "border-sage/60 bg-sage/10 text-sage" : "border-edge text-muted"}`}>
                                  {step.complete ? "✓" : index + 1}
                                </span>
                                <div className="min-w-0">
                                  <p className={`text-xs font-semibold ${step.complete ? "text-sage" : "text-bone"}`}>{step.label}</p>
                                  <p className="mt-1 break-words text-[0.68rem] leading-relaxed text-muted">{step.detail}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          {!member.setup.privacyTestConfirmed ? (
                            <button
                              type="button"
                              onClick={() => setPrivacyTest(member.user_id, "confirm_privacy_test")}
                              disabled={busy || !member.setup.canConfirmPrivacy}
                              className="min-h-10 rounded-full border border-sage/50 bg-sage/10 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-sage disabled:cursor-not-allowed disabled:opacity-35"
                            >
                              I tested isolation and confirm
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPrivacyTest(member.user_id, "reset_privacy_test")}
                              disabled={busy}
                              className="min-h-10 rounded-full border border-edge px-4 font-mono text-[0.58rem] uppercase tracking-wider text-muted disabled:opacity-40"
                            >
                              Reset sign off
                            </button>
                          )}
                          {!member.setup.canConfirmPrivacy && !member.setup.privacyTestConfirmed ? (
                            <p className="text-xs text-muted">Finish the automatic checks before signing off privacy.</p>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-edge bg-ink/25 p-5">
                <p className="text-sm font-semibold text-bone">No separate test account yet</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Use any genuinely separate email address, then send the invitation above. Google and Microsoft connections are optional for CRM access and can be tested afterwards.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-edge bg-panel/45 p-5">
            <h2 className="font-display text-lg text-bone">Accounts</h2>
            <div className="mt-4 space-y-3">
              {data.members.map((member) => (
                <div key={member.user_id} className="grid gap-4 rounded-xl border border-edge bg-ink/35 p-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
                  <div className="min-w-0">
                    <p className="font-sans text-sm font-semibold text-bone">{member.displayName || member.email || "Invited account"}</p>
                    <p className="mt-1 text-xs text-muted">{member.email || "Email pending"}</p>
                    <p className="mt-1 text-xs text-muted">
                      {member.mailboxConnected
                        ? `${member.mailboxProvider === "microsoft" ? "Microsoft" : "Google"} connected as ${member.microsoftEmail || member.googleEmail || member.email || "this account"}`
                        : "No email or calendar connected. Core CRM access still works"}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Notetaker ready as {member.transcriberName}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {member.outreachSenderEmail
                        ? <>Outreach sends as {member.outreachSenderName || member.displayName || "this user"} &lt;{member.outreachSenderEmail}&gt;</>
                        : "Outreach sending waits for Google or Microsoft"}
                    </p>
                    {member.activationIssues?.length && member.status !== "active" ? (
                      <p className="mt-2 text-xs text-amber">{member.activationIssues.join(". ")}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-edge px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-muted">{member.role}</span>
                      <span className={`rounded-full border px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider ${badge(member.status)}`}>{member.status}</span>
                      {member.role !== "owner" && member.status !== "active" ? (
                        <button type="button" onClick={() => setMemberAccess(member.user_id, "activate")} disabled={busy || !member.canActivate} className="rounded-full border border-sage/50 bg-sage/10 px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-sage disabled:opacity-40">Activate</button>
                      ) : null}
                      {member.role !== "owner" && member.status === "active" ? (
                        <button type="button" onClick={() => setMemberAccess(member.user_id, "suspend")} disabled={busy} className="rounded-full border border-rust/50 px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-rust disabled:opacity-40">Suspend</button>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-xl border border-edge bg-panel/55 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-mono text-[0.58rem] uppercase tracking-wider text-muted">Notetaker today</p>
                      <span className={`rounded-full border px-2 py-1 font-mono text-[0.54rem] uppercase tracking-wider ${member.transcriberUsage.activeBot ? "border-sage/50 bg-sage/10 text-sage" : "border-edge text-muted"}`}>
                        {member.transcriberUsage.activeBot ? "Live now" : "One bot max"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-bone">
                      {member.transcriberUsage.usedMinutes} of {member.transcriberUsage.dailyLimitMinutes} minutes used
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink">
                      <div
                        className={`h-full rounded-full ${member.transcriberUsage.usedMinutes >= member.transcriberUsage.dailyLimitMinutes ? "bg-rust" : "bg-sage"}`}
                        style={{
                          width: `${Math.min(100, (member.transcriberUsage.usedMinutes / Math.max(1, member.transcriberUsage.dailyLimitMinutes)) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {member.transcriberUsage.remainingMinutes} minutes remain. Resets at midnight UK time.
                    </p>
                    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <label className="sr-only" htmlFor={`limit-${member.user_id}`}>Daily notetaker minutes</label>
                      <input
                        id={`limit-${member.user_id}`}
                        type="number"
                        min={30}
                        max={720}
                        step={30}
                        inputMode="numeric"
                        value={limitDrafts[member.user_id] ?? ""}
                        onChange={(event) =>
                          setLimitDrafts((current) => ({
                            ...current,
                            [member.user_id]: event.target.value,
                          }))
                        }
                        className="min-h-10 min-w-0 rounded-lg border border-edge bg-ink/70 px-3 text-sm text-bone outline-none focus:border-amber/60"
                      />
                      <button
                        type="button"
                        onClick={() => saveTranscriberLimit(member)}
                        disabled={busy || !limitDrafts[member.user_id]}
                        className="min-h-10 rounded-full border border-amber/50 px-3 font-mono text-[0.58rem] uppercase tracking-wider text-amber disabled:opacity-40"
                      >
                        Save limit
                      </button>
                    </div>
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
                      <>
                        <button type="button" onClick={() => sendInvitation(invitation.email, invitation.role, true)} disabled={busy} className="rounded-full border border-amber/50 bg-amber/10 px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-amber disabled:opacity-50">Resend</button>
                        <button type="button" onClick={() => revoke(invitation.id)} disabled={busy} className="rounded-full border border-rust/50 px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-rust disabled:opacity-50">Revoke</button>
                      </>
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
