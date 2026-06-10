"use client";

import { useEffect, useRef, useState } from "react";

// Matrix-style "digital rain" shown while a plan is building. Self-contained:
// a canvas animation tinted to the brand (amber, not green) plus a cycling
// status caption. Cleans up its animation frame + interval on unmount.
export default function MatrixRain({
  messages = ["building plan"],
  color = "#E8A33D", // amber
}: {
  messages?: string[];
  color?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [msgIdx, setMsgIdx] = useState(0);

  // Cycle the caption.
  useEffect(() => {
    if (messages.length < 2) return;
    const id = setInterval(
      () => setMsgIdx((i) => (i + 1) % messages.length),
      1400
    );
    return () => clearInterval(id);
  }, [messages.length]);

  // Canvas rain.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const GLYPHS =
      "アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789<>/\\{}[]=+*ABCDEFGHJKLMNPQRSTUVWXYZ";
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cols = 0;
    let drops: number[] = [];
    const fontSize = 16;

    function resize() {
      const w = wrap!.clientWidth;
      const h = wrap!.clientHeight;
      canvas!.width = Math.max(1, Math.floor(w * dpr));
      canvas!.height = Math.max(1, Math.floor(h * dpr));
      canvas!.style.width = w + "px";
      canvas!.style.height = h + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(1, Math.floor(w / fontSize));
      drops = new Array(cols)
        .fill(0)
        .map(() => Math.floor((Math.random() * h) / fontSize));
    }
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    let last = 0;
    // Throttle to ~70% of the 60fps fall speed (advance every ~24ms instead of
    // every frame) so the rain falls more slowly.
    const STEP_MS = 1000 / 60 / 0.7;
    function frame(now: number) {
      if (now - last >= STEP_MS) {
        last = now;
        const w = wrap!.clientWidth;
        const h = wrap!.clientHeight;
        // Trailing fade.
        ctx!.fillStyle = "rgba(10, 10, 12, 0.12)";
        ctx!.fillRect(0, 0, w, h);
        ctx!.font = `${fontSize}px "IBM Plex Mono", monospace`;
        for (let i = 0; i < cols; i++) {
          const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;
          // Bright leading glyph, dimmer trail.
          ctx!.fillStyle = Math.random() > 0.975 ? "#FBE4BE" : color;
          ctx!.fillText(ch, x, y);
          if (y > h && Math.random() > 0.975) drops[i] = 0;
          drops[i]++;
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color]);

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-[460px] w-full overflow-hidden rounded-xl border border-amber/30 bg-ink"
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
        <div className="rounded-full border border-amber/40 bg-ink/70 px-5 py-2 backdrop-blur-sm">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-amber">
            {messages[msgIdx]}
            <span className="ml-1 animate-pulse">_</span>
          </span>
        </div>
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.25em] text-amber/50">
          livecoach
        </span>
      </div>
    </div>
  );
}
