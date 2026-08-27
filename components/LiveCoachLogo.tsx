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
        d="M14 10v42h39"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M49 27.5a13.5 13.5 0 1 0 0 15"
        stroke="currentColor"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <path
        d="M36 36v1M41 33.5v4M46 31v6.5"
        stroke="rgb(var(--lc-sage))"
        strokeWidth="3"
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
