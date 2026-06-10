"use client";

import { useEffect, useRef } from "react";

// Ambient classic-green "digital rain" behind the whole console. Fixed,
// full-viewport, pointer-events-none, low opacity, sitting at z-1: above the
// warm gradient (body::before, z-0) and below the content (<main>, z-10), so it
// frames the design in the margins without hurting readability.
export default function MatrixBackground({
  color = "#2BE06A", // classic matrix green
  opacity = 0.16,
}: {
  color?: string;
  opacity?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches;

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
        ctx!.fillStyle = "rgba(14, 13, 11, 0.10)";
        ctx!.fillRect(0, 0, w, h);
        ctx!.font = `${fontSize}px "IBM Plex Mono", monospace`;
        for (let i = 0; i < cols; i++) {
          const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;
          ctx!.fillStyle = Math.random() > 0.985 ? "#CFFFE0" : color;
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
  }, [color]);

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
