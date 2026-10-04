"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { crmFetch } from "@/lib/crm";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { isAllowedOpenAiUrl } from "@/lib/staff-mcp-client-policy";

type McpStatus = {
  endpoint: string;
  oauthEnabled: boolean;
  toolCount: number;
  access: string;
};

type Grant = {
  client: {
    id: string;
    name: string;
    uri: string;
  };
  scopes: string[];
  granted_at: string;
};

export default function McpChatGptConnection() {
  const supabase = useMemo(() => createSupabaseBrowser(), []);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyClient, setBusyClient] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextStatus = await crmFetch<McpStatus>("/api/crm/mcp/status");
      setStatus(nextStatus);
      if (nextStatus.oauthEnabled) {
        const { data, error: grantError } = await supabase.auth.oauth.listGrants();
        if (grantError) throw grantError;
        setGrants(
          ((data || []) as Grant[]).filter((grant) =>
            isAllowedOpenAiUrl(grant.client.uri)
          )
        );
      } else {
        setGrants([]);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The ChatGPT connector status could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyEndpoint = async () => {
    if (!status?.endpoint) return;
    try {
      await navigator.clipboard.writeText(status.endpoint);
      setNotice("LiveCoach MCP address copied.");
      setError("");
    } catch {
      setError("Copy failed. Select the address and copy it manually.");
    }
  };

  const disconnect = async (grant: Grant) => {
    setBusyClient(grant.client.id);
    setError("");
    setNotice("");
    const { error: revokeError } = await supabase.auth.oauth.revokeGrant({
      clientId: grant.client.id,
    });
    if (revokeError) {
      setError(revokeError.message || "The ChatGPT connection was not removed.");
      setBusyClient("");
      return;
    }
    setNotice(`${grant.client.name || "ChatGPT"} disconnected from your LiveCoach account.`);
    setBusyClient("");
    await load();
  };

  return (
    <section
      id="chatgpt-mcp"
      className={`mb-5 rounded-xl border p-5 ${
        grants.length
          ? "border-moss/45 bg-moss/[0.06]"
          : status?.oauthEnabled
            ? "border-sky/40 bg-sky/[0.05]"
            : "border-amber/40 bg-amber/[0.05]"
      }`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className={`font-mono text-[0.62rem] uppercase tracking-[0.2em] ${grants.length ? "text-moss" : "text-sky"}`}>
            {grants.length ? "✓" : "◇"} ChatGPT staff connector
          </p>
          <h2 className="mt-2 font-display text-xl text-bone">
            Query and update your own LiveCoach work from ChatGPT
          </h2>
          <p className="text-xs text-muted">Your Brain is personal. The workspace owner can review server audit copies for 30 days.</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            Each person connects their own ChatGPT account to their own LiveCoach login.
            Ask for your to-do list, marketing records, calls, calendar, documents, Brain history
            and connected email. Ask your existing Brain to advise, coach and prepare any action your
            normal role allows. Review the exact change before approving it.
          </p>
          <p className="mt-2 text-xs leading-5 text-moss">
            The same Brain role, assignment and approval rules apply here. Messages, calendar changes,
            paid work and destructive actions need separate approval. Another person&apos;s private
            records and connections stay blocked. It cannot change code, credentials or permissions.
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-4 py-2 font-mono text-[0.58rem] uppercase tracking-wider ${grants.length ? "border-moss/55 bg-moss/10 text-moss" : status?.oauthEnabled ? "border-sky/55 bg-sky/10 text-sky" : "border-amber/55 bg-amber/10 text-amber"}`}>
          {loading
            ? "Checking…"
            : grants.length
              ? `${grants.length} connected`
              : status?.oauthEnabled
                ? "Ready to connect"
                : "Owner setup needed"}
        </span>
      </div>

      {status?.endpoint ? (
        <div className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            readOnly
            value={status.endpoint}
            aria-label="LiveCoach MCP server address"
            className="min-h-11 min-w-0 rounded-lg border border-edge bg-ink/60 px-3 font-mono text-xs text-bone"
          />
          <button
            type="button"
            onClick={() => void copyEndpoint()}
            className="min-h-11 rounded-lg border border-sky/55 bg-sky/10 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-sky"
          >
            Copy address
          </button>
        </div>
      ) : null}

      <ol className="mt-5 space-y-2 text-sm leading-6 text-muted">
        <li>1. On ChatGPT web, enable Developer mode in Settings, Security and login. Your managed workspace may require admin access.</li>
        <li>2. In ChatGPT Plugins, use the plus button and add the address above with OAuth authentication. Existing connections can refresh tools.</li>
        <li>3. Connect using your own LiveCoach login and approve the personal account connection.</li>
        <li>4. Select LiveCoach in your chat and ask “Ask my Brain what I should focus on today” or “Ask my Brain to update my call prep”. Review each exact proposed action before approving it.</li>
      </ol>

      <p className="mt-4 text-xs leading-5 text-amber">
        Developer mode is available on ChatGPT web for Plus, Pro, Business, Enterprise and Education. Workspace administrators may control access. This connects CRM tools; it does not import your ChatGPT history into LiveCoach.
      </p>

      {!loading && status && !status.oauthEnabled ? (
        <p className="mt-4 rounded-lg border border-amber/45 bg-amber/10 px-3 py-2 text-sm text-amber">
          The connector code is installed, but the LiveCoach OAuth switch still needs enabling by
          the workspace owner before staff can connect.
        </p>
      ) : null}

      {grants.length ? (
        <div className="mt-5 space-y-2">
          {grants.map((grant) => (
            <div key={grant.client.id} className="flex flex-col gap-3 rounded-lg border border-edge bg-ink/35 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-bone">{grant.client.name || "ChatGPT"}</p>
                <p className="mt-1 font-mono text-[0.54rem] uppercase tracking-wider text-muted">
                  Connected {new Date(grant.granted_at).toLocaleString("en-GB")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void disconnect(grant)}
                disabled={Boolean(busyClient)}
                className="min-h-10 rounded-full border border-rust/50 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-rust disabled:opacity-40"
              >
                {busyClient === grant.client.id ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {notice ? <p aria-live="polite" className="mt-3 text-sm text-moss">{notice}</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-rust">{error}</p> : null}
    </section>
  );
}
