"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import ThemeToggle from "@/components/ThemeToggle";
import InitialCalendarSync from "@/components/InitialCalendarSync";

type AccountStatus = {
  workspace: string;
  role: string;
  status: string;
  google: { connected: boolean; email: string | null };
  microsoft: {
    connected: boolean;
    email: string | null;
    configured: boolean;
  };
  connector: {
    provider: "google" | "microsoft" | null;
    email: string | null;
  };
  crmAccess: boolean;
};

export default function JoinTeamPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");

  const loadStatus = async () => {
    const response = await fetch("/api/auth/team/status", { cache: "no-store" });
    if (!response.ok) return null;
    const nextStatus = (await response.json()) as AccountStatus;
    setStatus(nextStatus);
    return nextStatus;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invitationToken = params.get("invite") || "";
    const googleResult = params.get("google") || "";
    const microsoftResult = params.get("microsoft") || "";
    if (googleResult === "account_in_use") {
      setError(
        "That Google account already belongs to another LiveCoach user. Choose your own separate work account."
      );
    } else if (googleResult === "identity_missing") {
      setError("Google did not return an account identity. Try connecting again.");
    } else if (microsoftResult === "account_in_use") {
      setError(
        "That Microsoft account already belongs to another LiveCoach user. Choose your own separate work account."
      );
    } else if (microsoftResult === "identity_missing") {
      setError("Microsoft did not return an account identity. Try connecting again.");
    } else if (microsoftResult === "error") {
      setError("Microsoft could not be connected. Try again or continue without email and calendar.");
    }
    setToken(invitationToken);
    if (invitationToken) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("invite");
      window.history.replaceState({}, "", clean.toString());
    }
    supabase.auth.getUser().then(async ({ data }) => {
      setEmail(data.user?.email || "");
      setDisplayName(
        typeof data.user?.user_metadata?.display_name === "string"
          ? data.user.user_metadata.display_name
          : ""
      );
      if (data.user) await loadStatus();
      setChecked(true);
    });
  }, [supabase]);

  const finishSetup = async () => {
    if (!token) {
      setError("Open the secure invitation email again to finish setup.");
      return;
    }
    if (!displayName.trim()) {
      setError("Enter your name.");
      return;
    }
    if (password.length < 8) {
      setError("Choose your own password with at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: passwordError } = await supabase.auth.updateUser({
        password,
        data: { display_name: displayName.trim() },
      });
      if (passwordError) throw passwordError;
      const response = await fetch("/api/auth/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, displayName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Invitation was not accepted");
      setToken("");
      setPassword("");
      await loadStatus();
    } catch (err: any) {
      setError(err?.message || "Account setup failed");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[560px] flex-col justify-center px-5 py-10">
      <ThemeToggle className="absolute right-5 top-5" />
      <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-amber">Interviewa workspace</p>
      <h1 className="mt-2 font-display text-[2.35rem] leading-none text-bone">Set up LiveCoach</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Your account is separate from Lee's private calls, email, calendar, investors, documents and Brain memory.
      </p>

      <div className="mt-5">
        <InitialCalendarSync enabled={status?.crmAccess === true} />
      </div>

      <section className="mt-6 rounded-2xl border border-edge bg-panel/55 p-6">
        {!checked ? <p className="text-sm text-muted">Checking the secure invitation…</p> : null}
        {checked && !email ? (
          <div>
            <p className="text-sm text-bone">This invitation needs a signed in account.</p>
            <button type="button" onClick={() => router.push("/login")} className="mt-4 rounded-full bg-amber px-5 py-2.5 font-mono text-xs uppercase text-ink">Go to login</button>
          </div>
        ) : null}

        {checked && email && !status ? (
          <div className="space-y-4">
            <p className="text-sm text-bone">Signed in as <span className="text-amber">{email}</span></p>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.6rem] uppercase tracking-wider text-muted">Your name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="w-full rounded-xl border border-edge bg-ink/60 px-4 py-3 text-sm text-bone outline-none focus:border-amber/60" />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.6rem] uppercase tracking-wider text-muted">Create password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-edge bg-ink/60 px-4 py-3 text-sm text-bone outline-none focus:border-amber/60" placeholder="Choose any password with 8 or more characters" />
            </label>
            <button type="button" onClick={finishSetup} disabled={busy} className="w-full rounded-full bg-amber px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-ink disabled:opacity-50">{busy ? "Securing account…" : "Create my account"}</button>
          </div>
        ) : null}

        {status ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-bone">{status.workspace}</p>
                <p className="mt-1 text-xs text-muted">{status.role} account · {status.status}</p>
              </div>
              <span className="rounded-full border border-amber/50 bg-amber/10 px-3 py-1 font-mono text-[0.58rem] uppercase tracking-wider text-amber">Private onboarding</span>
            </div>
            <div className="mt-5 rounded-xl border border-edge bg-ink/35 p-4">
              <p className="font-mono text-[0.6rem] uppercase tracking-wider text-muted">Your email and calendar</p>
              <p className="mt-2 text-sm text-bone">
                {status.connector.provider
                  ? `${status.connector.provider === "google" ? "Google" : "Microsoft"} connected as ${status.connector.email || email}`
                  : "Optional. Connect your own Google or Microsoft account for calendar sync, email context and outreach. Lee's connection is never used."}
              </p>
              {!status.connector.provider ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={() => { window.location.href = "/api/auth/google/start"; }} className="rounded-full bg-amber px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-ink">Connect Google</button>
                  {status.microsoft.configured ? (
                    <button type="button" onClick={() => { window.location.href = "/api/auth/microsoft/start"; }} className="rounded-full border border-sky/50 bg-sky/10 px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-wider text-sky">Connect Microsoft</button>
                  ) : (
                    <span className="self-center text-xs text-muted">Microsoft setup is being configured</span>
                  )}
                </div>
              ) : null}
            </div>
            {status.crmAccess ? (
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => router.push("/settings/sales-profile")} className="w-full rounded-full bg-amber px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-ink">Set up my coaching</button>
                <button type="button" onClick={() => router.push("/crm/outreach")} className="w-full rounded-full border border-sage/50 bg-sage/10 px-5 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-sage">Open LiveCoach</button>
              </div>
            ) : (
              <p className="mt-5 rounded-xl border border-sage/40 bg-sage/[0.06] px-4 py-3 text-sm leading-relaxed text-sage">Your separate login is ready. Email and calendar are optional. CRM access stays locked until Lee presses Activate in Team access.</p>
            )}
          </div>
        ) : null}

        {error ? <p role="alert" className="mt-4 text-sm text-rust">{error}</p> : null}
        {email ? <button type="button" onClick={logout} className="mt-5 font-mono text-[0.6rem] uppercase tracking-wider text-muted hover:text-bone">Sign out</button> : null}
      </section>
    </main>
  );
}
