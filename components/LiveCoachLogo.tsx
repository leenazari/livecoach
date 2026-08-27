import type { SVGProps } from "react";

export function LiveCoachMark({ className = "h-8 w-8", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path
        d="M49 15.5a25 25 0 1 0 .7 32"
        stroke="currentColor"
        strokeWidth="7.5"
        strokeLinecap="round"
      />
      <path
        d="M25.5 21.5v21h17"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M35 34v2M41 30v6M47 26v10"
        stroke="rgb(var(--lc-sage))"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

type LiveCoachLogoProps = {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
  showName?: boolean;
};

export default function LiveCoachLogo({
  className = "",
  markClassName = "h-8 w-8",
  wordmarkClassName = "font-display text-xl tracking-tight",
  showName = true,
}: LiveCoachLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-amber ${className}`} aria-label="LiveCoach">
      <LiveCoachMark className={`shrink-0 ${markClassName}`} />
      {showName ? (
        <span className={wordmarkClassName}>
          <span className="italic text-amber">Live</span>
          <span className="text-bone">Coach</span>
        </span>
      ) : null}
    </span>
  );
}
