"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Reserve the dock's actual height in its own workspace. Wrapped labels,
// browser text scaling and live/prep controls can all change that height.
export default function CallActionDock({ children, className }: { children: ReactNode; className: string }) {
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = dock.current;
    const workspace = element?.closest<HTMLElement>(".lc-call-workspace");
    if (!element || !workspace) return;
    const measure = () => workspace.style.setProperty("--lc-call-dock-height", `${Math.ceil(element.getBoundingClientRect().height)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      workspace.style.removeProperty("--lc-call-dock-height");
    };
  }, []);
  return <div ref={dock} className={className} role="region" aria-label="Call actions">{children}</div>;
}
