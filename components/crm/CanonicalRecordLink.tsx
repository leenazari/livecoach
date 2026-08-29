"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import Link from "next/link";

type Props = {
  href: string | null | undefined;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  stopPropagation?: boolean;
  title?: string;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

const focusStyle =
  "rounded-md transition-colors hover:text-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

export default function CanonicalRecordLink({
  href,
  children,
  className = "",
  ariaLabel,
  stopPropagation = false,
  title,
  onNavigate,
}: Props) {
  if (!href) return <span className={className}>{children}</span>;

  const stopClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (stopPropagation) event.stopPropagation();
    onNavigate?.(event);
  };
  const stopKey = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (stopPropagation) event.stopPropagation();
  };

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      title={title}
      onClick={stopClick}
      onKeyDown={stopKey}
      className={`${focusStyle} ${className}`.trim()}
    >
      {children}
    </Link>
  );
}
