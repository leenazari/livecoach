"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const STORAGE_KEY = "lc_theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Theme preference can still work for this tab when storage is blocked.
  }
  window.dispatchEvent(new CustomEvent("lc:theme-change", { detail: theme }));
}

export default function ThemeToggle({
  className = "",
  showLabel = true,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(saved);
  }, []);

  const nextTheme: Theme = theme === "dark" ? "light" : "dark";
  const nextLabel = nextTheme === "light" ? "Light mode" : "Dark mode";

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(nextTheme);
        setTheme(nextTheme);
      }}
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === "light"}
      title={`Switch to ${nextTheme} mode`}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-edge bg-ink/40 px-3 font-mono text-[0.62rem] uppercase tracking-wider text-muted transition hover:border-amber/60 hover:text-amber ${className}`}
    >
      <span aria-hidden="true" className="text-[0.95rem] leading-none">
        {nextTheme === "light" ? "☀" : "◐"}
      </span>
      {showLabel ? <span>{nextLabel}</span> : null}
    </button>
  );
}
