"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import LiveCoachLogo from "@/components/LiveCoachLogo";
import { clearCrmCache } from "@/lib/crm";
import { PASSWORD_MIN_LENGTH, passwordValidationError } from "@/lib/password-reset";
import { createSupabaseBrowser } from "@/lib/supabase-browser";

type RecoveryStatus = "checking" | "ready" | "invalid";

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [status, setStatus] = useState<RecoveryStatus>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session?.user) {
        setEmail(session.user.email || "");
        setStatus("ready");
      }
    });

    supabase.auth.getUser().then(({ data, error: userError }) => {
      if (!active) return;
      if (userError || !data.user) {
        setStatus("invalid");
        return;
      }
      setEmail(data.user.email || "");
      setStatus("ready");
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const submit = async () => {
    const validationError = passwordValidationError(password, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      clearCrmCache();
      const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
      if (signOutError) {
        await supabase.auth.signOut({ scope: "local" });
      }
      window.location.assign("/login?password=updated");
    } catch (caught: any) {
      setError(caught?.message || "The password could not be updated. Request a fresh reset link and try again.");
      setBusy(false);
    }
  };

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[440px] flex-col justify-center px-5 py-10">
      <ThemeToggle className="absolute right-5 top-5" />
      <h1>
        <LiveCoachLogo
          markClassName="h-12 w-12"
          wordmarkClassName="font-display text-[2.4rem] leading-none tracking-tight"
        />
      </h1>
      <p className="mb-8 mt-2 font-mono text-xs uppercase tracking-[0.25em] text-muted">
        choose a new password
      </p>

      <section className="rounded-2xl border border-edge bg-panel/50 p-6">
        {status === "checking" ? (
          <p className="text-sm text-muted">Checking the secure reset link…</p>
        ) : null}

        {status === "invalid" ? (
          <div>
            <h2 className="font-display text-2xl text-bone">This link cannot be used</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              It may have expired or already been used. Request a fresh link to continue safely.
            </p>
            <Link
              href="/forgot-password"
              className="mt-5 inline-flex rounded-full bg-amber px-6 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-ink"
            >
              Request another link
            </Link>
          </div>
        ) : null}

        {status === "ready" ? (
          <div>
            <h2 className="font-display text-2xl text-bone">Create your new password</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Updating {email || "this account"}. Use any password with at least {PASSWORD_MIN_LENGTH} characters.
            </p>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                  New password
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 text-sm text-bone outline-none transition focus:border-amber/60"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                  Confirm new password
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                  className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 text-sm text-bone outline-none transition focus:border-amber/60"
                />
              </label>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="w-full rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-50"
              >
                {busy ? "Securing account…" : "Save new password"}
              </button>
            </div>

            <p className="mt-4 text-xs leading-5 text-muted">
              For security, saving your new password signs this account out on its other devices.
            </p>
            {error ? (
              <p role="alert" className="mt-4 text-sm leading-6 text-rust">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
