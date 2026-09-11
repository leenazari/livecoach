"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Mount a fresh viewport (keyed by conversation) so opening any chat starts at
// the latest message. Polls must never drag someone away from older messages.
export default function ChatMessageViewport({ ready, latestMessageId, latestMessageIsMine, children }: {
  ready: boolean;
  latestMessageId: string;
  latestMessageIsMine: boolean;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const initialized = useRef(false);
  const followingLatest = useRef(true);
  const previousLatestId = useRef("");
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  const scrollToLatest = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    followingLatest.current = true;
    // Move only the message list, never the document or composer. Instant
    // positioning also avoids a long animation through the entire history.
    element.scrollTop = element.scrollHeight;
    setAwayFromLatest(false);
    setHasNewMessages(false);
  }, []);

  useLayoutEffect(() => {
    if (!ready) return;
    const incomingMessage = latestMessageId !== previousLatestId.current;
    if (!initialized.current || followingLatest.current || (incomingMessage && latestMessageIsMine)) {
      scrollToLatest();
    } else if (incomingMessage) {
      setHasNewMessages(true);
    }
    previousLatestId.current = latestMessageId;
    initialized.current = true;
  }, [latestMessageId, latestMessageIsMine, ready, scrollToLatest]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (initialized.current && followingLatest.current) scrollToLatest();
    });
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [scrollToLatest]);

  return <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={viewport} role="log" aria-label="Conversation messages" aria-relevant="additions text" tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget;
        const nearLatest = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
        followingLatest.current = nearLatest;
        setAwayFromLatest(!nearLatest);
        if (nearLatest) setHasNewMessages(false);
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-ink/20 p-3 outline-none focus-visible:ring-1 focus-visible:ring-amber/60 sm:p-4">
      <div ref={content} className="flex min-h-full flex-col gap-3">{children}</div>
    </div>
    {awayFromLatest ? <button type="button" onClick={scrollToLatest}
      className="absolute bottom-3 left-1/2 z-10 min-h-11 -translate-x-1/2 whitespace-nowrap rounded-full border border-amber/55 bg-panel px-4 text-xs font-semibold text-amber shadow-lg">
      {hasNewMessages ? "New messages · Jump to latest ↓" : "Jump to latest ↓"}
    </button> : null}
  </div>;
}
