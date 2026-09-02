"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import MatrixRain from "@/components/MatrixRain";

// The assistant contains voice capture, playback and the full action UI. Most
// visits only need the small floating trigger, so keep that large bundle out
// of every CRM page until the user actually opens the Brain.
const ClientAssistant = dynamic(
  () => import("@/components/crm/ClientAssistant"),
  {
    ssr: false,
    loading: () => (
      <MatrixRain size="compact" messages={["opening the Brain", "loading screen context"]} />
    ),
  }
);

type PanelPosition = { x: number; y: number };

const BRAIN_POSITION_KEY = "livecoach:brain-position:v1";
const DESKTOP_EDGE_GAP = 12;

function clampPanelPosition(
  position: PanelPosition,
  panelWidth: number,
  panelHeight: number
): PanelPosition {
  const maxX = Math.max(DESKTOP_EDGE_GAP, window.innerWidth - panelWidth - DESKTOP_EDGE_GAP);
  const maxY = Math.max(DESKTOP_EDGE_GAP, window.innerHeight - panelHeight - DESKTOP_EDGE_GAP);
  return {
    x: Math.min(Math.max(position.x, DESKTOP_EDGE_GAP), maxX),
    y: Math.min(Math.max(position.y, DESKTOP_EDGE_GAP), maxY),
  };
}

function describeScreen(pathname: string | null, hasClient: boolean, tab: string) {
  const path = pathname || "/crm";
  if (path === "/call") return { section: "live_call", label: "Call workspace", path };
  if (hasClient) return { section: "client", label: "Client profile", path };
  if (path.startsWith("/crm/outreach"))
    return { section: "outreach", label: "Outreach", path };
  if (path.startsWith("/crm/inbox"))
    return { section: "work_inbox", label: "Work Inbox", path };
  if (path.startsWith("/crm/documents"))
    return { section: "documents", label: "Documents", path };
  if (path.startsWith("/crm/revenue"))
    return { section: "revenue", label: "Revenue", path };
  if (path.startsWith("/crm/costs"))
    return { section: "costs", label: "Costs", path };
  if (path.startsWith("/crm/tasks"))
    return { section: "tasks", label: "Tasks dashboard", path };
  if (path.startsWith("/crm/board")) {
    if (tab === "clients") return { section: "client_portfolio", label: "Clients", path: `${path}?tab=clients` };
    if (tab === "opportunities") return { section: "opportunities", label: "Opportunities", path: `${path}?tab=opportunities` };
    if (tab === "drafts") return { section: "drafts", label: "Drafts", path: `${path}?tab=drafts` };
    return { section: "tasks", label: "To-do list", path: `${path}?tab=${tab || "tasks"}` };
  }
  if (path.startsWith("/crm/call-coach"))
    return { section: "call_coach", label: "Call coach", path };
  if (path.startsWith("/crm/calls"))
    return { section: "calls", label: "Call history", path };
  if (path.startsWith("/crm/prep"))
    return { section: "prep", label: "Call prep", path };
  return { section: "dashboard", label: "CRM dashboard", path };
}

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
  const [isDesktop, setIsDesktop] = useState(false);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
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
  const searchParams = useSearchParams();
  const pathMatch = pathname
    ? pathname.match(/\/crm\/([0-9a-fA-F-]{36})/)
    : null;
  const pathFocusId = pathMatch ? pathMatch[1] : null;
  const focusId = eventClient?.id || pathFocusId || undefined;
  const screenContext = describeScreen(
    pathname,
    Boolean(pathFocusId),
    searchParams.get("tab") || ""
  );

  // Desktop remembers where the user placed the Brain. Mobile deliberately
  // ignores this and stays full-screen, so dragging can never break the phone UI.
  useEffect(() => {
    const media = window.matchMedia("(min-width: 640px)");
    const syncViewport = () => setIsDesktop(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(BRAIN_POSITION_KEY) || "null"
      );
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
        setPanelPosition({ x: saved.x, y: saved.y });
      }
    } catch {
      window.localStorage.removeItem(BRAIN_POSITION_KEY);
    }
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  const persistPosition = useCallback((position: PanelPosition | null) => {
    if (position) {
      window.localStorage.setItem(BRAIN_POSITION_KEY, JSON.stringify(position));
    } else {
      window.localStorage.removeItem(BRAIN_POSITION_KEY);
    }
  }, []);

  const movePanel = useCallback((x: number, y: number) => {
    const panel = panelRef.current;
    if (!panel) return null;
    const rect = panel.getBoundingClientRect();
    const next = clampPanelPosition({ x, y }, rect.width, rect.height);
    setPanelPosition(next);
    return next;
  }, []);

  const startDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!isDesktop || !panelRef.current) return;
      event.preventDefault();
      const rect = panelRef.current.getBoundingClientRect();
      dragRef.current = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      // Convert the centred CSS position into explicit coordinates on the first
      // movement, avoiding any visual jump when the drag begins.
      setPanelPosition({ x: rect.left, y: rect.top });
    },
    [isDesktop]
  );

  const continueDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      movePanel(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    },
    [movePanel]
  );

  const finishDrag = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* The pointer may already have been released by the browser. */
      }
      const panel = panelRef.current;
      if (panel) {
        const rect = panel.getBoundingClientRect();
        const next = clampPanelPosition(
          { x: rect.left, y: rect.top },
          rect.width,
          rect.height
        );
        setPanelPosition(next);
        persistPosition(next);
      }
    },
    [persistPosition]
  );

  const nudgePanel = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!isDesktop || !panelRef.current) return;
      const movement: Record<string, [number, number]> = {
        ArrowLeft: [-24, 0],
        ArrowRight: [24, 0],
        ArrowUp: [0, -24],
        ArrowDown: [0, 24],
      };
      const delta = movement[event.key];
      if (!delta) return;
      event.preventDefault();
      const rect = panelRef.current.getBoundingClientRect();
      const next = movePanel(rect.left + delta[0], rect.top + delta[1]);
      if (next) persistPosition(next);
    },
    [isDesktop, movePanel, persistPosition]
  );

  // A saved position may no longer fit after a resize or after the panel grows.
  useEffect(() => {
    if (!open || !isDesktop) return;
    const keepInView = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      setPanelPosition((current) => {
        if (!current) return current;
        const next = clampPanelPosition(current, rect.width, rect.height);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    };
    const frame = window.requestAnimationFrame(keepInView);
    window.addEventListener("resize", keepInView);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", keepInView);
    };
  }, [open, isDesktop]);

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

  // Open the brain from anywhere (e.g. the "Talk to brain" item in the side
  // menu) - just show the panel.
  useEffect(() => {
    const openIt = (event: Event) => {
      const detail = (event as CustomEvent)?.detail || {};
      setOpen(true);
      if (typeof detail.prompt === "string" && detail.prompt.trim())
        setSeed(detail.prompt.trim());
    };
    window.addEventListener("lc:open-brain", openIt);
    return () => window.removeEventListener("lc:open-brain", openIt);
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ask the brain"
        className="fixed bottom-20 right-4 z-[60] flex items-center gap-2 rounded-full border border-amber/70 bg-amber px-5 py-3 font-mono text-[0.66rem] font-medium uppercase tracking-wider text-ink shadow-[0_8px_26px_rgba(232,163,61,0.4)] transition hover:brightness-110 sm:bottom-4"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ink/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ink" />
        </span>
        {"▤"} Ask the brain
      </button>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div
        ref={panelRef}
        style={
          isDesktop && panelPosition
            ? { left: panelPosition.x, top: panelPosition.y }
            : undefined
        }
        className={`pointer-events-auto absolute left-0 top-0 flex h-[100dvh] w-full flex-col overflow-hidden border border-amber/40 bg-panel shadow-2xl sm:top-3 sm:h-auto sm:max-h-[86vh] sm:w-[min(624px,96vw)] sm:rounded-2xl ${
          isDesktop && panelPosition ? "" : "sm:left-1/2 sm:-translate-x-1/2"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-edge bg-ink/50 px-4 py-2.5">
          <span className="min-w-0 truncate font-mono text-[0.62rem] uppercase tracking-[0.16em] text-amber">
            {"▤"} The brain{active ? ` · ${active.name}` : ""}
            <span className="text-muted"> · {screenContext.label}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Move the Brain window. Use arrow keys for precise movement."
              title="Drag to move. Double click to centre."
              onPointerDown={startDrag}
              onPointerMove={continueDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onKeyDown={nudgePanel}
              onDoubleClick={() => {
                setPanelPosition(null);
                persistPosition(null);
              }}
              className={`hidden min-h-8 cursor-grab touch-none items-center gap-1.5 rounded-lg border border-edge px-2.5 font-mono text-[0.55rem] uppercase tracking-wider text-muted transition hover:border-amber/50 hover:text-amber sm:flex ${
                dragging ? "cursor-grabbing border-amber/60 text-amber" : ""
              }`}
            >
              <span aria-hidden="true">⠿</span> move
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close the brain"
              className="flex min-h-8 min-w-8 items-center justify-center rounded-lg font-mono text-sm text-muted transition hover:bg-bone/5 hover:text-bone"
            >
              ✕
            </button>
          </div>
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
            screenContext={screenContext}
          />
        </div>
      </div>
    </div>
  );
}
