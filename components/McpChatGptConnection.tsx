"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { crmFetch } from "@/lib/crm";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { isAllowedOpenAiUrl } from "@/lib/staff-mcp-client-policy";

type McpStatus = {
  endpoint: string;
  pluginEndpoint: string;
  actionSchemaUrl: string;
  actionConfigured: boolean;
  oauthEnabled: boolean;
  toolCount: number;
  access: string;
  role: "owner" | "manager" | "sales";
};

type Grant = {
  client: { id: string; name: string; uri: string };
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

  const copyValue = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
      setError("");
    } catch {
      setError(`Copy failed. Select the ${label.toLowerCase()} and copy it manually.`);
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
            {grants.length ? "✓" : "◇"} ChatGPT connections
          </p>
          <h2 className="mt-2 font-display text-xl text-bone">
            Use LiveCoach safely from ChatGPT
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            ChatGPT Plus staff can add the narrow LiveCoach CRM plugin individually. The workspace
            owner can use the larger Brain connector in a managed ChatGPT workspace. Every person
            signs in with their own LiveCoach login, so the same role, assignment and approval
            rules still apply.
          </p>
          <p className="mt-2 text-xs leading-5 text-moss">
            Another person&apos;s private records stay blocked. Neither route can change code,
            credentials or permissions.
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

      <div className="mt-6 rounded-xl border border-amber/40 bg-amber/[0.05] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-amber">
              Route 1 · ChatGPT Plus
            </p>
            <h3 className="mt-1 font-display text-lg text-bone">Personal LiveCoach CRM plugin</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Each member creates one private plugin connection in their own ChatGPT account and
              signs in with their own LiveCoach login. It can find or add their assigned leads,
              add verified context, create their follow-ups and read their tasks. It cannot send
              outreach, run campaigns, book meetings or change permissions.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-amber/50 px-3 py-1.5 font-mono text-[0.54rem] uppercase tracking-wider text-amber">
            One-time setup per person
          </span>
        </div>

        {status?.pluginEndpoint ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              readOnly
              value={status.pluginEndpoint}
              aria-label="LiveCoach ChatGPT plugin MCP address"
              className="min-h-11 min-w-0 rounded-lg border border-edge bg-ink/60 px-3 font-mono text-xs text-bone"
            />
            <button
              type="button"
              onClick={() => void copyValue(status.pluginEndpoint, "Plugin MCP address")}
              className="min-h-11 rounded-lg border border-amber/55 bg-amber/10 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-amber"
            >
              Copy plugin MCP address
            </button>
          </div>
        ) : null}

        <ol className="mt-4 space-y-2 text-sm leading-6 text-muted">
          <li>1. In ChatGPT, open Plugins.</li>
          <li>2. Choose Add, then Add custom MCP server.</li>
          <li>3. Name it LiveCoach CRM and paste the plugin MCP address above.</li>
          <li>4. Use OAuth discovery, review the six tools and create the private plugin.</li>
          <li>5. Sign in with your own LiveCoach account and approve the connection.</li>
        </ol>
        <p className="mt-3 text-xs leading-5 text-moss">
          Repeat this once in each staff member&apos;s own ChatGPT account. Never connect Kamm,
          Sharon or another salesperson using Lee&apos;s LiveCoach login.
        </p>
      </div>

      <div className="mt-5 rounded-xl border border-sky/35 bg-sky/[0.04] p-4">
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-sky">
          Route 2 · Workspace owner only
        </p>
        <h3 className="mt-1 font-display text-lg text-bone">Full LiveCoach MCP connector</h3>
        <p className="mt-2 text-sm leading-6 text-muted">
          This is the larger Brain and CRM connection for the LiveCoach workspace owner using a
          ChatGPT Business, Enterprise or Education workspace with MCP access enabled. Salespeople
          cannot approve or use this route.
        </p>

        {status?.endpoint ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              readOnly
              value={status.endpoint}
              aria-label="LiveCoach MCP server address"
              className="min-h-11 min-w-0 rounded-lg border border-edge bg-ink/60 px-3 font-mono text-xs text-bone"
            />
            <button
              type="button"
              onClick={() => void copyValue(status.endpoint, "MCP address")}
              className="min-h-11 rounded-lg border border-sky/55 bg-sky/10 px-4 font-mono text-[0.58rem] uppercase tracking-wider text-sky"
            >
              Copy MCP address
            </button>
          </div>
        ) : null}

        <ol className="mt-4 space-y-2 text-sm leading-6 text-muted">
          <li>1. On ChatGPT web, enable Developer mode in workspace settings.</li>
          <li>2. Add the MCP address above as an OAuth connector.</li>
          <li>3. Connect using your own LiveCoach login and approve the personal account connection.</li>
          <li>4. Select LiveCoach in a chat and review every exact proposed action before approval.</li>
        </ol>
      </div>

      {!loading && status && !status.oauthEnabled ? (
        <p className="mt-4 rounded-lg border border-amber/45 bg-amber/10 px-3 py-2 text-sm text-amber">
          The connector code is installed, but the LiveCoach OAuth service is not responding. A
          workspace owner needs to resolve that before either route can connect.
        </p>
      ) : null}

      {grants.length ? (
        <div className="mt-5 space-y-2">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-muted">
            My connected ChatGPT clients
          </p>
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
