"use client";

import { useState } from "react";
import ClientAssistant from "@/components/crm/ClientAssistant";
import CompanyLinkPicker from "@/components/crm/CompanyLinkPicker";

// A floating, always-available assistant. Pass the current client for context
// (e.g. the call you're on); with none, you pick or name a client to ask about.
// Reuses the same grounded ClientAssistant under the hood.
export default function GlobalAssistant({
  companyId,
  companyName,
}: {
  companyId?: string;
  companyName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(
    companyId && companyName ? { id: companyId, name: companyName } : null
  );

  const active =
    picked || (companyId && companyName ? { id: companyId, name: companyName } : null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ask your assistant"
        className="fixed left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber/70 bg-amber px-5 py-2.5 font-mono text-[0.66rem] font-medium uppercase tracking-wider text-ink shadow-[0_8px_26px_rgba(232,163,61,0.4)] transition hover:brightness-110"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ink" />
        </span>
        {"▤"} Ask the assistant
      </button>
    );
  }

  // Top-anchored panel, height-capped with internal scroll, so it can never run
  // off the bottom of the page.
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-3">
      <div className="mt-3 flex max-h-[86vh] w-[min(480px,96vw)] flex-col overflow-hidden rounded-2xl border border-amber/40 bg-panel shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-edge bg-ink/50 px-4 py-2.5">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-amber">
            {"▤"} Assistant{active ? ` · ${active.name}` : ""}
          </span>
          <div className="flex items-center gap-3">
            {active && (
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="font-mono text-[0.56rem] uppercase tracking-wider text-muted transition hover:text-amber"
              >
                change client
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="font-mono text-sm text-muted transition hover:text-bone"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-3">
          {active ? (
            <ClientAssistant
              key={active.id}
              companyId={active.id}
              companyName={active.name}
              autoListen
            />
          ) : (
            <div className="flex flex-col gap-3 py-2">
              <p className="font-sans text-[0.82rem] leading-relaxed text-bone/75">
                Which client do you want to ask about?
              </p>
              <CompanyLinkPicker value={null} onChange={(v) => setPicked(v)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
