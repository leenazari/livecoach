"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
  // When a draft is started from a task, remember which client + task so the
  // assistant scopes to that client (its drafts save there) and the task can
  // auto-complete once the draft is saved.
  const [eventClient, setEventClient] = useState<{ id: string; name: string } | null>(null);
  const [draftTaskId, setDraftTaskId] = useState<string>("");
  const propClient =
    companyId && companyName ? { id: companyId, name: companyName } : null;
  const active = eventClient || propClient;

  // Which client the user is currently viewing, from the page URL (/crm/<id>).
  // Used to LEAD the answer, without scoping the conversation thread, so the
  // chat stays one continuous thread as you move between pages.
  const pathname = usePathname();
  const pathMatch = pathname
    ? pathname.match(/\/crm\/([0-9a-fA-F-]{36})/)
    : null;
  const pathFocusId = pathMatch ? pathMatch[1] : null;
  const focusId = eventClient?.id || pathFocusId || undefined;

  // A "draft email" next step (anywhere) opens the assistant, scopes it to that
  // client, and asks it to draft the email - so the task actually starts the
  // action and the resulting draft can be saved + tick the task.
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent)?.detail || {};
      setOpen(true);
      if (d.companyId && d.companyName)
        setEventClient({ id: d.companyId, name: d.companyName });
      setDraftTaskId(d.taskId || "");
      setSeed(
        d.text
          ? `Draft a short, warm, ready-to-send email for this next step: ${d.text}`
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
            key="lc-assistant"
            companyId={propClient?.id}
            companyName={propClient?.name}
            focusCompanyId={focusId}
            autoListen={!seed}
            initialPrompt={seed}
            draftTaskId={draftTaskId}
          />
        </div>
      </div>
    </div>
  );
}
