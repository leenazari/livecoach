"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import ThemeToggle from "@/components/ThemeToggle";
import { clearCrmCache } from "@/lib/crm";

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowser(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setSessionEmail(data.user?.email ?? null);
      setChecked(true);
    });
    const params = new URLSearchParams(window.location.search);
    if (params.get("invite") === "error") {
      setError(
        "That invitation link has expired or was already used. Ask Lee to resend it, then open the newest email. Do not use this login form until account setup is complete."
      );
    } else if (params.get("access") === "denied") {
      setError("This account has not been invited to an active workspace.");
    }
  }, [supabase]);

  const submit = async () => {
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
      router.push("/call");
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Authentication failed");
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
      <h1 className="font-display text-[2.4rem] leading-none tracking-tight text-bone">
        <span className="italic text-amber">Live</span>Coach
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
              onClick={() => router.push("/call")}
              className="rounded-full bg-amber px-6 py-2.5 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow"
            >
              Go to console
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
          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
              placeholder="you@company.com"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
              Password
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none transition placeholder:text-muted/60 focus:border-amber/60"
              placeholder="********"
            />
          </label>

          <button
            onClick={submit}
            disabled={busy}
            className="rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-50"
          >
            {busy ? "working..." : "Sign in"}
          </button>

          {error && <p className="font-mono text-xs text-rust">! {error}</p>}
          <p className="font-mono text-[0.65rem] leading-relaxed text-muted">
            Accounts are created by invitation so private CRM information stays
            isolated.
          </p>
        </div>
      )}
    </main>
  );
}
