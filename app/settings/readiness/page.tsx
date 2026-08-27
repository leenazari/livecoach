"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import MatrixRain from "@/components/MatrixRain";
import NavMenu from "@/components/crm/NavMenu";
import type {
  AccountReadiness,
  AccountReadinessCheck,
} from "@/lib/account-readiness";
import { crmFetch, getCached } from "@/lib/crm";

type ReadinessData = {
  account: AccountReadiness;
  team?: AccountReadiness[];
  generatedAt: string;
  aiUsed: false;
};

const READINESS_URL = "/api/crm/account-readiness";

function StatusPill({ state }: { state: AccountReadinessCheck["state"] }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-3 py-1 font-mono text-[0.55rem] uppercase tracking-wider ${
        state === "ready"
          ? "border-sage/50 bg-sage/10 text-sage"
          : "border-amber/55 bg-amber/10 text-amber"
      }`}
    >
      {state === "ready" ? "✓ Ready" : "Action"}
    </span>
  );
}

function CheckRow({
  check,
  ownerReview = false,
}: {
  check: AccountReadinessCheck;
  ownerReview?: boolean;
}) {
  const ownerCanFix = ["account", "leads", "privacy", "transcriber"].includes(
    check.id
  );
  const actionHref = ownerReview
    ? ownerCanFix
      ? "/settings/team"
      : undefined
    : check.href;
  const actionLabel = ownerReview
    ? ownerCanFix
      ? "Open team controls"
      : "Ask this person to complete it"
    : check.actionLabel || "Fix this";
  return (
    <details className="group rounded-xl border border-edge bg-ink/35 open:border-amber/35">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden">
        <span
          aria-hidden="true"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs ${
            check.state === "ready"
              ? "border-sage/45 bg-sage/10 text-sage"
              : "border-amber/50 bg-amber/10 text-amber"
          }`}
        >
          {check.state === "ready" ? "✓" : "!"}
        </span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-bone">
          {check.label}
        </span>
        <StatusPill state={check.state} />
        <span className="text-xs text-muted transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-edge px-4 py-3 sm:pl-14">
        <p className="text-sm leading-6 text-muted">{check.detail}</p>
        {check.state === "action" ? (
          actionHref ? (
            <Link
              href={actionHref}
              className="mt-3 inline-flex min-h-10 items-center rounded-full border border-amber/50 bg-amber/10 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-amber transition hover:bg-amber/20"
            >
              {actionLabel}
            </Link>
          ) : (
            <span className="mt-3 inline-flex min-h-10 items-center rounded-full border border-edge px-4 font-mono text-[0.58rem] uppercase tracking-wider text-muted">
              {actionLabel}
            </span>
          )
        ) : null}
      </div>
    </details>
  );
}

function AccountCard({ account }: { account: AccountReadiness }) {
  const percentage = Math.round(
    (account.readyCount / Math.max(1, account.totalCount)) * 100
  );
  return (
    <section className="rounded-2xl border border-edge bg-panel/50 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl text-bone">
              {account.displayName}
            </h2>
            <span className="rounded-full border border-edge px-2 py-1 font-mono text-[0.52rem] uppercase tracking-wider text-muted">
              {account.role}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted">{account.email}</p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p
            className={`font-display text-2xl ${
              account.isReady ? "text-sage" : "text-amber"
            }`}
          >
            {account.readyCount} of {account.totalCount}
          </p>
          <p className="font-mono text-[0.52rem] uppercase tracking-wider text-muted">
            checks ready
          </p>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink">
        <div
          className={`h-full rounded-full ${
            account.isReady ? "bg-sage" : "bg-amber"
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="mt-4 space-y-2">
        {account.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </div>
    </section>
  );
}

export default function AccountReadinessPage() {
  const cached = getCached<ReadinessData>(READINESS_URL);
  const [data, setData] = useState<ReadinessData | null>(cached || null);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      setData(await crmFetch<ReadinessData>(READINESS_URL));
    } catch (err: any) {
      setError(err?.message || "Account readiness could not be loaded");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <main className="relative z-10 mx-auto max-w-[1050px] px-4 py-8 sm:px-6 sm:py-10">
      <NavMenu />
      <header className="mb-6 flex flex-col gap-4 border-b border-edge pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-amber">
            Your setup in one place
          </p>
          <h1 className="mt-1 font-display text-3xl text-bone">
            Account readiness
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Confirm your login, mailbox, calendar, personal notetaker, leads and
            privacy boundary before live sales work. These are database and
            permission checks, so refreshing this page uses no AI tokens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="min-h-11 rounded-full border border-amber/50 bg-amber/10 px-5 font-mono text-[0.6rem] uppercase tracking-wider text-amber transition hover:bg-amber/20 disabled:opacity-40"
          >
            {refreshing ? "Checking…" : "Refresh checks"}
          </button>
          <Link
            href="/settings"
            className="inline-flex min-h-11 items-center rounded-full border border-edge px-5 font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:border-amber/45 hover:text-amber"
          >
            Settings
          </Link>
        </div>
      </header>

      {loading && !data ? (
        <MatrixRain
          size="panel"
          messages={[
            "checking your account",
            "verifying private connections",
            "counting your available leads",
          ]}
        />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-rust/50 bg-rust/10 px-4 py-3 text-sm text-rust"
        >
          {error}
        </p>
      ) : null}

      {data ? (
        <div className="space-y-7">
          <AccountCard account={data.account} />

          {Array.isArray(data.team) ? (
            <section className="rounded-2xl border border-sky/35 bg-sky/[0.04] p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-sky">
                    Lee only
                  </p>
                  <h2 className="mt-1 font-display text-xl text-bone">
                    Team readiness
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                    This shows setup evidence only. It never exposes another
                    person&apos;s email content, calendar details, call transcripts
                    or private CRM records.
                  </p>
                </div>
                <Link
                  href="/settings/team"
                  className="inline-flex min-h-10 items-center self-start rounded-full border border-sky/45 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-sky hover:bg-sky/10 sm:self-auto"
                >
                  Manage team
                </Link>
              </div>

              <div className="mt-4 space-y-3">
                {data.team.length ? (
                  data.team.map((member) => {
                    const nextAction = member.checks.find(
                      (check) => check.state === "action"
                    );
                    return (
                      <details
                        key={member.userId}
                        className="group rounded-xl border border-edge bg-ink/35 open:border-sky/40"
                      >
                        <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 marker:hidden sm:flex-row sm:items-center">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-bone">
                              {member.displayName}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted">
                              {member.email}
                            </p>
                            {nextAction ? (
                              <p className="mt-2 text-xs text-amber">
                                Next. {nextAction.label}
                              </p>
                            ) : (
                              <p className="mt-2 text-xs text-sage">
                                All setup checks are complete.
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full border px-3 py-1 font-mono text-[0.55rem] uppercase tracking-wider ${
                                member.isReady
                                  ? "border-sage/50 bg-sage/10 text-sage"
                                  : "border-amber/50 bg-amber/10 text-amber"
                              }`}
                            >
                              {member.readyCount} of {member.totalCount}
                            </span>
                            <span className="text-xs text-muted transition group-open:rotate-180">
                              ⌄
                            </span>
                          </div>
                        </summary>
                        <div className="space-y-2 border-t border-edge p-3">
                          {member.checks.map((check) => (
                            <CheckRow
                              key={check.id}
                              check={check}
                              ownerReview
                            />
                          ))}
                        </div>
                      </details>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-edge px-4 py-6 text-center text-sm text-muted">
                    No other team accounts have been added yet.
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
