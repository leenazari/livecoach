"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import ThemeToggle from "@/components/ThemeToggle";
import { clearCrmCache } from "@/lib/crm";
import LiveCoachLogo from "@/components/LiveCoachLogo";
import {
  EMAIL_OTP_LENGTH,
  emailOtpErrorMessage,
  emailOtpRedirect,
  normalizeEmailOtp,
} from "@/lib/email-otp";
import { safeLocalRedirect } from "@/lib/safe-local-redirect";

type LoginMethod = "email" | "password";
const EMAIL_RESEND_WAIT_SECONDS = 60;

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("email");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [postLoginPath, setPostLoginPath] = useState("/crm");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setSessionEmail(data.user?.email ?? null);
      setChecked(true);
    });
    const params = new URLSearchParams(window.location.search);
    setPostLoginPath(safeLocalRedirect(params.get("redirect"), "/crm"));
    if (params.get("invite") === "error") {
      setError(
        "That invitation link has expired or was already used. Ask Lee to resend it, then open the newest email. Do not use this login form until account setup is complete."
      );
    } else if (params.get("access") === "denied") {
      setError("This account has not been invited to an active workspace.");
    } else if (params.get("email") === "error") {
      setError(
        "That one-time login has expired or was already used. Request one new email below."
      );
    } else if (params.get("password") === "updated") {
      setLoginMethod("password");
      setNotice("Password updated. Sign in with your new password.");
    }
  }, [supabase]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setResendSeconds((current) => Math.max(0, current - 1)),
      1000
    );
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  const submitPassword = async () => {
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      clearCrmCache();
      router.push(postLoginPath);
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const requestEmailLogin = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("Enter the email address used for your LiveCoach account.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: emailOtpRedirect(window.location.origin, postLoginPath),
        },
      });
      if (otpError) throw otpError;
      setEmail(normalizedEmail);
      setOtpCode("");
      setOtpSent(true);
      setResendSeconds(EMAIL_RESEND_WAIT_SECONDS);
      setNotice(
        "A one-time login is on its way. Use the secure sign-in button in the newest email. If the email shows a code, enter it below."
      );
    } catch (caught) {
      setError(emailOtpErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const verifyEmailLogin = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (otpCode.length !== EMAIL_OTP_LENGTH) {
      setError(`Enter the ${EMAIL_OTP_LENGTH}-digit code from the newest email.`);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { error: otpError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: otpCode,
        type: "email",
      });
      if (otpError) throw otpError;
      clearCrmCache();
      router.replace(postLoginPath);
      router.refresh();
    } catch (caught) {
      setError(emailOtpErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    clearCrmCache();
    await supabase.auth.signOut();
    setSessionEmail(null);
    router.refresh();
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
      <p className="mt-2 mb-8 font-mono text-xs uppercase tracking-[0.25em] text-muted">
        invite only access
      </p>

      {checked && sessionEmail ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-edge bg-panel/50 p-6">
          <p className="font-sans text-sm text-bone">
            Signed in as <span className="text-amber">{sessionEmail}</span>
          </p>
          {error && <p className="font-mono text-xs text-rust">! {error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => router.push(postLoginPath)}
              className="rounded-full bg-amber px-6 py-2.5 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow"
            >
              Open LiveCoach
            </button>
            <button
              onClick={logout}
              className="rounded-full border border-rust px-5 py-2.5 font-mono text-[0.7rem] uppercase tracking-wider text-rust transition hover:bg-rust hover:text-ink"
            >
              Log out
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 rounded-2xl border border-edge bg-panel/50 p-6">
          <div>
            <p className="font-display text-2xl text-bone">
              {loginMethod === "email" ? "Email login" : "Password login"}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted">
              {loginMethod === "email"
                ? "No password needed. We will email you a one-time secure login."
                : "Use your password as a backup way to sign in."}
            </p>
          </div>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
              Email
            </span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (otpSent) {
                  setOtpSent(false);
                  setOtpCode("");
                  setResendSeconds(0);
                  setNotice("");
                }
              }}
              className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
              placeholder="you@company.com"
            />
          </label>

          {loginMethod === "email" ? (
            <>
              {otpSent ? (
                <label className="block">
                  <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                    One-time code
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otpCode}
                    onChange={(event) =>
                      setOtpCode(normalizeEmailOtp(event.target.value))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") verifyEmailLogin();
                    }}
                    className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-3 text-center font-mono text-xl tracking-[0.45em] text-bone outline-none transition placeholder:text-muted/40 focus:border-amber/60"
                    placeholder="000000"
                    aria-label="One-time code"
                  />
                </label>
              ) : null}

              <button
                type="button"
                onClick={otpSent ? verifyEmailLogin : requestEmailLogin}
                disabled={busy}
                className="rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-50"
              >
                {busy
                  ? "working..."
                  : otpSent
                    ? "Verify code"
                    : "Email my login"}
              </button>

              {otpSent ? (
                <button
                  type="button"
                  onClick={requestEmailLogin}
                  disabled={busy || resendSeconds > 0}
                  className="text-center font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:text-bone disabled:opacity-50"
                >
                  {resendSeconds > 0
                    ? `Send one new email in ${resendSeconds}s`
                    : "Send one new email"}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  setLoginMethod("password");
                  setError("");
                  setNotice("");
                }}
                className="text-center font-mono text-[0.65rem] uppercase tracking-wider text-amber transition hover:text-amberglow"
              >
                Use password instead
              </button>
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
                  Password
                </span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitPassword();
                  }}
                  className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
                  placeholder="********"
                />
              </label>

              <button
                type="button"
                onClick={submitPassword}
                disabled={busy}
                className="rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-50"
              >
                {busy ? "working..." : "Sign in"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setLoginMethod("email");
                  setError("");
                  setNotice("");
                }}
                className="text-center font-mono text-[0.65rem] uppercase tracking-wider text-amber transition hover:text-amberglow"
              >
                Use email login instead
              </button>

              <Link
                href="/forgot-password"
                className="text-center font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:text-bone"
              >
                Reset password
              </Link>
            </>
          )}

          {error && <p className="font-mono text-xs text-rust">! {error}</p>}
          {notice && (
            <p role="status" className="rounded-lg border border-sage/40 bg-sage/10 px-3 py-2 text-sm text-sage">
              {notice}
            </p>
          )}
          <p className="font-mono text-[0.65rem] leading-relaxed text-muted">
            Accounts are created by invitation so private CRM information stays
            isolated.
          </p>
          <Link
            href="/privacy"
            className="text-center font-mono text-[0.6rem] uppercase tracking-wider text-muted transition hover:text-bone"
          >
            Privacy policy
          </Link>
        </div>
      )}
    </main>
  );
}
