"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import CallStage from "@/components/CallStage";

export default function JoinPage() {
  const params = useParams();
  const room = Array.isArray(params.room) ? params.room[0] : params.room || "";
  const [name, setName] = useState("");
  const [entered, setEntered] = useState(false);
  const [inviteToken, setInviteToken] = useState("");
  const [inviteLoaded, setInviteLoaded] = useState(false);

  useEffect(() => {
    if (!room) return;
    const storageKey = `livecoach-candidate-invite:${room}`;
    const fragment = new URLSearchParams(window.location.hash.slice(1)).get(
      "invite"
    );
    const saved = window.sessionStorage.getItem(storageKey) || "";
    const token = fragment || saved;
    if (fragment) {
      window.sessionStorage.setItem(storageKey, fragment);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    }
    setInviteToken(token);
    setInviteLoaded(true);
  }, [room]);

  const candidateSessionReady = useCallback(() => {
    if (!room) return;
    window.sessionStorage.removeItem(`livecoach-candidate-invite:${room}`);
    setInviteToken("");
  }, [room]);

  return (
    <main className="relative z-10 mx-auto max-w-[700px] px-5 py-10">
      <h1 className="font-display text-[2.4rem] leading-none tracking-tight text-bone">
        Join the interview
      </h1>
      <p className="mt-2 mb-7 font-mono text-xs uppercase tracking-[0.25em] text-muted">
        room {room}
      </p>

      {!entered ? (
        <div className="flex flex-col items-start gap-4 rounded-2xl border border-edge bg-panel/50 p-6">
          {inviteLoaded && !inviteToken && (
            <p className="font-mono text-[0.7rem] leading-relaxed text-muted">
              Continue if you already joined this secure call on this device.
              Otherwise ask the host for a fresh invitation link.
            </p>
          )}
          <label className="block w-full max-w-sm">
            <span className="mb-1.5 block font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted">
              Your name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya"
              className="w-full rounded-lg border border-edge bg-ink/60 px-3.5 py-2.5 font-sans text-sm text-bone outline-none focus:border-amber/60"
            />
          </label>
          <button
            onClick={() => setEntered(true)}
            disabled={!name.trim()}
            className="rounded-full bg-amber px-7 py-3 font-mono text-sm font-medium uppercase tracking-wider text-ink transition hover:bg-amberglow disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      ) : (
        <CallStage
          room={room}
          identity={name.trim() || "Candidate"}
          role="candidate"
          inviteToken={inviteToken || undefined}
          onCandidateSessionReady={candidateSessionReady}
        />
      )}
    </main>
  );
}
