"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_MESSAGES = ["loading livecoach"];

type MatrixRainSize = "inline" | "compact" | "panel" | "page";

const sizeClasses: Record<MatrixRainSize, string> = {
  inline: "min-h-20",
  compact: "min-h-[9rem]",
  panel: "min-h-72",
  page: "min-h-[460px]",
};

// Matrix-style "digital rain" shown while a plan is building. Self-contained:
// a canvas animation tinted to the brand (amber, not green) plus a cycling
// status caption. Cleans up its animation frame + interval on unmount.
export default function MatrixRain({
  messages = DEFAULT_MESSAGES,
  color,
  size = "page",
  className = "",
}: {
  messages?: string[];
  color?: string;
  size?: MatrixRainSize;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [msgIdx, setMsgIdx] = useState(0);
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setThemeRevision((value) => value + 1);
    window.addEventListener("lc:theme-change", refresh);
    return () => window.removeEventListener("lc:theme-change", refresh);
  }, []);

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

    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;
    const rootStyle = getComputedStyle(document.documentElement);
    const cssRgb = (name: string, fallback: string) => {
      const channels = rootStyle.getPropertyValue(name).trim();
      return channels ? `rgb(${channels.split(/\s+/).join(", ")})` : fallback;
    };
    const light = document.documentElement.dataset.theme === "light";
    const rainColor = color || cssRgb("--lc-amber", "#E8A33D");
    const highlightColor = cssRgb("--lc-amberglow", "#FBE4BE");
    const trailColor = light ? "rgba(247, 244, 237, 0.16)" : "rgba(10, 10, 12, 0.12)";
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

    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) drawFrame();
    });
    ro.observe(wrap);

    let raf = 0;
    let last = 0;
    // Throttle to ~70% of the 60fps fall speed (advance every ~24ms instead of
    // every frame) so the rain falls more slowly.
    const STEP_MS = 1000 / 60 / 0.7;
    function drawFrame() {
      const w = wrap!.clientWidth;
      const h = wrap!.clientHeight;
      ctx!.fillStyle = trailColor;
      ctx!.fillRect(0, 0, w, h);
      ctx!.font = `${fontSize}px "IBM Plex Mono", monospace`;
      for (let i = 0; i < cols; i++) {
        const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        ctx!.fillStyle = Math.random() > 0.975 ? highlightColor : rainColor;
        ctx!.fillText(ch, x, y);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    }
    function frame(now: number) {
      if (now - last >= STEP_MS) {
        last = now;
        drawFrame();
      }
      raf = requestAnimationFrame(frame);
    }
    if (reduce) drawFrame();
    else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [color, themeRevision]);

  return (
    <div
      ref={wrapRef}
      role="status"
      aria-live="polite"
      aria-label={messages[msgIdx] || "Loading"}
      className={`relative h-full w-full overflow-hidden rounded-xl border border-amber/30 bg-ink ${sizeClasses[size]} ${className}`}
    >
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2">
        <div className="rounded-full border border-amber/40 bg-ink/70 px-5 py-2 backdrop-blur-sm">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-amber">
            {messages[msgIdx]}
            <span className="ml-1 motion-safe:animate-pulse">_</span>
          </span>
        </div>
        <span className="font-mono text-[0.55rem] uppercase tracking-[0.25em] text-amber/50">
          livecoach
        </span>
      </div>
    </div>
  );
}
