"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type OutreachResource = "core" | "prospects" | "metrics" | "campaignStats" | "suppressions";

export const OUTREACH_RESOURCE_LABELS: Record<OutreachResource, string> = {
  core: "Queue and campaigns",
  prospects: "Prospects",
  metrics: "Activity and replies",
  campaignStats: "Campaign results",
  suppressions: "Safety list",
};

// Read failures are independent of action receipts. Refreshing one resource
// must neither clear another resource's failure nor dismiss a failed send.
export function useOutreachLoads() {
  const [errors, setErrors] = useState<Partial<Record<OutreachResource, string>>>({});
  const [pending, setPending] = useState<Partial<Record<OutreachResource, boolean>>>({});
  const revisions = useRef<Partial<Record<OutreachResource, number>>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async <T,>(
    resource: OutreachResource,
    request: () => Promise<T>,
    apply: (data: T) => void
  ): Promise<void> => {
    const revision = (revisions.current[resource] || 0) + 1;
    revisions.current[resource] = revision;
    const current = () => mounted.current && revisions.current[resource] === revision;
    setPending((state) => ({ ...state, [resource]: true }));
    try {
      const data = await request();
      if (!current()) return;
      apply(data);
      setErrors((state) => ({ ...state, [resource]: undefined }));
    } catch (error: any) {
      if (!current()) return;
      const message = String(error?.message || "");
      // Older deployments return a mutation-shaped generic blocker even on GET.
      setErrors((state) => ({
        ...state,
        [resource]: !message || /action not confirmed|^bad request$/i.test(message)
          ? "The server could not retrieve this list. Retry to load it again. No records have been changed."
          : message,
      }));
    } finally {
      if (current()) setPending((state) => ({ ...state, [resource]: false }));
    }
  }, []);

  return { load, errors, pending };
}
