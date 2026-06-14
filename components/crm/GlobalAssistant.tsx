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
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 rounded-full border border-amber/70 bg-amber px-6 py-4 font-mono text-[0.74rem] font-medium uppercase tracking-wider text-ink shadow-[0_10px_34px_rgba(232,163,61,0.45)] transition hover:scale-[1.03] hover:brightness-110"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ink" />
        </span>
        {"▤"} Ask the assistant
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex max-h-[80vh] w-[min(430px,94vw)] flex-col overflow-hidden rounded-2xl border border-amber/40 bg-panel shadow-2xl">
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
  );
}
