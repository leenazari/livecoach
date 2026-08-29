"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  valueClassName?: string;
  className?: string;
  compact?: boolean;
};

export default function MetricDrilldown({
  label,
  value,
  note,
  href,
  onClick,
  active = false,
  valueClassName = "text-bone",
  className = "",
  compact = false,
}: Props) {
  const classes = [
    "group block w-full rounded-xl border bg-panel text-left transition",
    "hover:border-amber/60 hover:bg-amber/[0.05]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70",
    compact ? "min-h-16 p-2.5" : "min-h-20 p-3",
    active ? "border-amber/65 bg-amber/[0.08]" : "border-edge",
    className,
  ].join(" ");
  const content = (
    <>
      <strong className={`block font-display ${compact ? "text-xl" : "text-2xl"} ${valueClassName}`}>
        {value}
      </strong>
      <span className="mt-1 block font-mono text-[0.5rem] uppercase tracking-wider text-muted transition group-hover:text-amber">
        {label} ↘
      </span>
      {note ? <span className="mt-1 block text-[0.69rem] leading-4 text-muted">{note}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-current={active ? "location" : undefined}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes} aria-pressed={active}>
      {content}
    </button>
  );
}
