"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LiveCoachLogo from "@/components/LiveCoachLogo";
import ThemeToggle from "@/components/ThemeToggle";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import {
  isAllowedChatGptOAuthClient,
  safeChatGptOAuthRedirect,
} from "@/lib/staff-mcp-client-policy";

type ConsentDetails = {
  authorization_id: string;
  redirect_uri: string;
  scope: string;
  client: {
    id: string;
    name: string;
    uri: string;
  };
  user: {
    id: string;
    email: string;
  };
};

export default function OAuthConsentPage() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | "">("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      const authorizationId = new URLSearchParams(window.location.search).get(
        "authorization_id"
      );
      if (!authorizationId) {
        if (active) setError("This connection request is incomplete. Start again from ChatGPT.");
        return;
      }
      const { data, error: requestError } =
        await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (requestError || !data) {
        setError(
          requestError?.message ||
            "LiveCoach could not read this connection request. Start again from ChatGPT."
        );
        return;
      }
      if ("redirect_url" in data) {
        const safeRedirect = safeChatGptOAuthRedirect(data.redirect_url);
        if (!safeRedirect) {
          setError("LiveCoach blocked an unapproved OAuth destination.");
          return;
        }
        window.location.assign(safeRedirect);
        return;
      }
      const next = data as ConsentDetails;
      if (
        !isAllowedChatGptOAuthClient({
          clientUri: next.client.uri,
          redirectUri: next.redirect_uri,
        })
      ) {
        setError(
          "LiveCoach only permits this staff connector to be linked from an official ChatGPT or OpenAI address."
        );
        setDetails(next);
        return;
      }
      setDetails(next);
    };
    void load();
    return () => {
      active = false;
    };
  }, [supabase]);

  const approvedClient = Boolean(
    details &&
      isAllowedChatGptOAuthClient({
        clientUri: details.client.uri,
        redirectUri: details.redirect_uri,
      })
  );
  const redirectHost = (() => {
    try {
      return details ? new URL(details.redirect_uri).hostname : "";
    } catch {
      return "";
    }
  })();

  const decide = async (decision: "approve" | "deny") => {
    if (!details) return;
    if (decision === "approve" && !approvedClient) {
      setError("This is not an approved ChatGPT connection request.");
      return;
    }
    setBusy(decision);
    setError("");
    const result =
      decision === "approve"
        ? await supabase.auth.oauth.approveAuthorization(details.authorization_id, {
            skipBrowserRedirect: true,
          })
        : await supabase.auth.oauth.denyAuthorization(details.authorization_id, {
            skipBrowserRedirect: true,
          });
    if (result.error || !result.data?.redirect_url) {
      setError(
        result.error?.message ||
          `LiveCoach could not ${decision === "approve" ? "approve" : "decline"} this request.`
      );
      setBusy("");
      return;
    }
    const safeRedirect = safeChatGptOAuthRedirect(result.data.redirect_url);
    if (!safeRedirect) {
      setError("LiveCoach blocked an unapproved OAuth destination.");
      setBusy("");
      return;
    }
    window.location.assign(safeRedirect);
  };

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[720px] flex-col justify-center px-5 py-10">
      <ThemeToggle className="absolute right-5 top-5" />
      <LiveCoachLogo
        markClassName="h-11 w-11"
        wordmarkClassName="font-display text-[2.1rem] leading-none tracking-tight"
      />

      <section className="mt-8 rounded-2xl border border-edge bg-panel/70 p-5 sm:p-7">
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.22em] text-sky">
          Staff ChatGPT connection
        </p>
        <h1 className="mt-2 font-display text-3xl text-bone">
          Connect ChatGPT to your LiveCoach work
        </h1>

        {!details && !error ? (
          <p className="mt-5 text-sm text-muted">Checking the secure connection request…</p>
        ) : null}

        {details ? (
          <div className="mt-5 rounded-xl border border-edge bg-ink/45 p-4">
            <p className="text-sm text-bone">
              <strong>{details.client.name || "ChatGPT"}</strong> is asking to connect as{" "}
              <span className="text-amber">{details.user.email}</span>.
            </p>
            <p className="mt-2 font-mono text-[0.56rem] uppercase tracking-wider text-muted">
              Returning to {redirectHost || "a blocked destination"}
            </p>
            <p className="mt-1 font-mono text-[0.56rem] uppercase tracking-wider text-muted">
              Identity access requested {details.scope || "email"}
            </p>
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-moss/35 bg-moss/[0.06] p-4">
            <h2 className="font-display text-lg text-bone">ChatGPT can</h2>
            <ul className="mt-2 space-y-2 text-sm leading-5 text-muted">
              <li>Find and list leads assigned to you</li>
              <li>Add one private lead with exact email deduplication</li>
              <li>Add verified context to your own lead</li>
              <li>Create or reschedule your own follow-up</li>
              <li>List your own tasks</li>
            </ul>
          </div>
          <div className="rounded-xl border border-rust/35 bg-rust/[0.06] p-4">
            <h2 className="font-display text-lg text-bone">ChatGPT cannot</h2>
            <ul className="mt-2 space-y-2 text-sm leading-5 text-muted">
              <li>Read another salesperson&apos;s private records</li>
              <li>Assign work to another person</li>
              <li>Send email or LinkedIn outreach</li>
              <li>Start or change campaigns</li>
              <li>Change LiveCoach code, roles or permissions</li>
            </ul>
          </div>
        </div>

        <p className="mt-4 text-xs leading-5 text-muted">
          Every action is checked against your current LiveCoach membership and recorded with
          a receipt. Disconnecting the grant stops future access. Your LiveCoach password is
          never shared with ChatGPT.
        </p>

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-rust/45 bg-rust/10 px-3 py-2 text-sm text-rust">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Link
            href="/settings#chatgpt-mcp"
            className="min-h-11 rounded-full border border-edge px-5 py-3 text-center font-mono text-[0.62rem] uppercase tracking-wider text-muted"
          >
            Return to settings
          </Link>
          {details ? (
            <button
              type="button"
              onClick={() => void decide("deny")}
              disabled={Boolean(busy)}
              className="min-h-11 rounded-full border border-rust/55 px-5 py-3 font-mono text-[0.62rem] uppercase tracking-wider text-rust disabled:opacity-40"
            >
              {busy === "deny" ? "Declining…" : "Decline"}
            </button>
          ) : null}
          {details && approvedClient ? (
            <button
              type="button"
              onClick={() => void decide("approve")}
              disabled={Boolean(busy)}
              className="min-h-11 rounded-full bg-amber px-6 py-3 font-mono text-[0.62rem] font-semibold uppercase tracking-wider text-ink disabled:opacity-40"
            >
              {busy === "approve" ? "Connecting…" : "Allow this connection"}
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
