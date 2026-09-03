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
            Add your own CRM leads and follow-ups from ChatGPT
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Each salesperson connects their own ChatGPT account to their own LiveCoach login.
            ChatGPT can add a private lead, add verified context, create a follow-up, and read
            only that salesperson&apos;s assigned leads and tasks.
          </p>
          <p className="mt-2 text-xs leading-5 text-moss">
            It cannot send outreach, start campaigns, assign colleagues, see another person&apos;s
            private records, or change code and permissions. Every action returns an audit receipt.
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
        <li>1. A ChatGPT workspace owner creates the LiveCoach app once in Workspace settings, Apps, Create, using the address above.</li>
        <li>2. Scan the six tools, complete the test connection, then publish the app to the approved staff group.</li>
        <li>3. Each salesperson opens ChatGPT Settings, Apps, Enabled Apps, selects LiveCoach, and connects with their own LiveCoach login.</li>
        <li>4. Ask ChatGPT to add a lead. It must have an exact email and verified company name.</li>
      </ol>

      <p className="mt-4 text-xs leading-5 text-amber">
        ChatGPT currently limits custom apps with write actions to Business, Enterprise, and Edu workspaces.
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
