"use client";

import { useEffect, useState } from "react";
import ClientAssistant from "@/components/crm/ClientAssistant";

// The assistant trigger + panel. A top-centre pill opens a top-anchored,
// height-capped panel (never runs off the page). With a client context it's
// that client; with none it's the GLOBAL assistant - open and just talk, it
// resolves who you mean or answers across your whole pipeline. No picking first.
export default function GlobalAssistant({
  companyId,
  companyName,
}: {
  companyId?: string;
  companyName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const active = companyId && companyName ? { id: companyId, name: companyName } : null;

  // A "draft email" next step (anywhere) opens the assistant and asks it to
  // draft that email, so the task actually starts the action.
  useEffect(() => {
    const h = (e: Event) => {
      const text = (e as CustomEvent)?.detail?.text || "";
      setOpen(true);
      setSeed(
        text
          ? `Draft a short, warm, ready-to-send email for this next step: ${text}`
          : ""
      );
    };
    window.addEventListener("lc:draft-email", h);
    return () => window.removeEventListener("lc:draft-email", h);
  }, []);

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

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-3">
      <div className="mt-3 flex max-h-[86vh] w-[min(624px,96vw)] flex-col overflow-hidden rounded-2xl border border-amber/40 bg-panel shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-edge bg-ink/50 px-4 py-2.5">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-amber">
            {"▤"} Assistant{active ? ` · ${active.name}` : ""}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="font-mono text-sm text-muted transition hover:text-bone"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-3">
          <ClientAssistant
            key={active ? active.id : "global"}
            companyId={active?.id}
            companyName={active?.name}
            autoListen={!seed}
            initialPrompt={seed}
          />
        </div>
      </div>
    </div>
  );
}
