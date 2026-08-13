"use client";

import { useEffect, useRef, useState } from "react";

// Ambient classic-green "digital rain" behind the whole console. Fixed,
// full-viewport, pointer-events-none, low opacity, sitting at z-1: above the
// warm gradient (body::before, z-0) and below the content (<main>, z-10), so it
// frames the design in the margins without hurting readability.
export default function MatrixBackground({
  color,
  opacity = 0.16,
}: {
  color?: string;
  opacity?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [themeRevision, setThemeRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setThemeRevision((value) => value + 1);
    window.addEventListener("lc:theme-change", refresh);
    return () => window.removeEventListener("lc:theme-change", refresh);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    const rainColor = color || cssRgb("--lc-moss", "#2BE06A");
    const highlightColor = cssRgb("--lc-sage", "#CFFFE0");
    const trailColor = light ? "rgba(247, 244, 237, 0.12)" : "rgba(14, 13, 11, 0.10)";

    const GLYPHS =
      "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789:.\"=*+-<>";
    const fontSize = 16;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cols = 0;
    let drops: number[] = [];

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = w + "px";
      canvas!.style.height = h + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(1, Math.floor(w / fontSize));
      drops = new Array(cols)
        .fill(0)
        .map(() => Math.floor((Math.random() * h) / fontSize));
    }
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = 0;
    function frame(now: number) {
      // ~20fps is plenty for a background and saves battery.
      if (now - last > 50) {
        last = now;
        const w = window.innerWidth;
        const h = window.innerHeight;
        ctx!.fillStyle = trailColor;
        ctx!.fillRect(0, 0, w, h);
        ctx!.font = `${fontSize}px "IBM Plex Mono", monospace`;
        for (let i = 0; i < cols; i++) {
          const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;
          ctx!.fillStyle = Math.random() > 0.985 ? highlightColor : rainColor;
          ctx!.fillText(ch, x, y);
          if (y > h && Math.random() > 0.975) drops[i] = 0;
          drops[i]++;
        }
      }
      raf = requestAnimationFrame(frame);
    }

    if (!reduce) raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [color, themeRevision]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1,
        pointerEvents: "none",
        opacity,
      }}
    />
  );
}
