"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import LiveCoachLogo from "@/components/LiveCoachLogo";
import { passwordResetRedirect } from "@/lib/password-reset";
import { createSupabasePasswordResetClient } from "@/lib/supabase-browser";

const GENERIC_SENT_MESSAGE =
  "If that email belongs to a LiveCoach account, a secure reset link is on its way. Check the newest email and your junk folder.";

export default function ForgotPasswordPage() {
  const supabase = useMemo(() => createSupabasePasswordResetClient(), []);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "error") {
      setError("That reset link is invalid or has expired. Request a fresh one below.");
    }
  }, []);

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("Enter the email address used for your LiveCoach account.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo: passwordResetRedirect(window.location.origin) }
      );
      if (resetError) throw resetError;
      setSent(true);
    } catch {
      setError("The reset email could not be sent right now. Wait a minute and try again.");
    } finally {
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
        secure password recovery
      </p>

      <section className="rounded-2xl border border-edge bg-panel/50 p-6">
        <h2 className="font-display text-2xl text-bone">Reset your password</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Enter the email address you normally use to sign in. The newest reset link works once.
        </p>

        {sent ? (
          <div className="mt-5 rounded-xl border border-sage/45 bg-sage/10 p-4">
            <p role="status" className="text-sm leading-6 text-sage">
              {GENERIC_SENT_MESSAGE}
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              className="mt-4 font-mono text-[0.62rem] uppercase tracking-wider text-bone hover:text-amber"
            >
              Send another link
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                Account email
              </span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
                className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
                placeholder="you@company.com"
              />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="w-full rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-50"
            >
              {busy ? "Sending secure link…" : "Email me a reset link"}
            </button>
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-4 text-sm leading-6 text-rust">
            {error}
          </p>
        ) : null}

        <Link
          href="/login"
          className="mt-6 inline-block font-mono text-[0.62rem] uppercase tracking-wider text-muted hover:text-bone"
        >
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
