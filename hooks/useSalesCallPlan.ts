"use client";
import { useEffect, useRef, useState } from "react";
import { crmFetch } from "@/lib/crm";
import {
  cleanProducts,
  cleanStage,
  type SalesProduct,
} from "@/lib/sales-call-script";

type Options = {
  room: string;
  companyId: string | null;
  upcomingId: string | null;
  live: boolean;
  ended: boolean;
  ready: boolean;
  prep: Record<string, any>;
  transcript: string;
  hydrate: (prep: any) => void;
};
export function useSalesCallPlan(options: Options) {
  const [products, setProducts] = useState<SalesProduct[]>([]);
  const [stage, setStage] = useState("hook");
  const [status, setStatus] = useState("Loading saved preparation…");
  const [ready, setReady] = useState(false);
  const [improvement, setImprovement] = useState("");
  const [nonce, setNonce] = useState(0);
  const [loadNonce, setLoadNonce] = useState(0);
  const loadedContext = useRef("");
  const draftKey = `draft:${options.upcomingId || options.companyId || "unscheduled"}`;
  const contextKey =
    options.live || options.ended ? `session:${options.room}` : draftKey;
  const latest = useRef(options);
  latest.current = options;
  const identity = useRef("");
  const version = useRef<string | null>(null);
  const saveChain = useRef(Promise.resolve());
  const generation = useRef(0);
  const dirtyClient = useRef(false);
  const started = useRef<number>(0);
  const hydrateRef = useRef(options.hydrate);
  hydrateRef.current = options.hydrate;
  const scriptRef = useRef({ products, stage });
  scriptRef.current = { products, stage };
  const prepSignature = JSON.stringify(options.prep);
  useEffect(() => {
    if (!options.ready) return;
    const current = ++generation.current;
    const previousContext = loadedContext.current;
    const currentSelection = {
      ...scriptRef.current,
      prep: latest.current.prep,
    };
    const carrySelection =
      !!identity.current &&
      previousContext.startsWith("draft:") &&
      (contextKey.startsWith("session:") || dirtyClient.current);
    setReady(false);
    setStatus("Loading saved preparation…");
    const url = `/api/interview/sales-plan?${new URLSearchParams({ key: contextKey, draftKey, ...(options.companyId ? { companyId: options.companyId } : {}) })}`;
    crmFetch<any>(url)
      .then((data) => {
        if (generation.current !== current) return;
        identity.current = `${data.workspaceId}:${data.userId}`;
        version.current = data.plan?.updated_at || null;
        let cached: any = null;
        try {
          cached = JSON.parse(
            localStorage.getItem(
              `lc:sales-prep:${identity.current}:${contextKey}`,
            ) || "null",
          );
        } catch {
          /* storage unavailable */
        }
        const seed = data.seedPlan;
        const useCache =
          cached?.savedAt &&
          (!data.plan || cached.savedAt > data.plan.updated_at);
        const carry = carrySelection && !data.plan;
        const choice = carry
          ? currentSelection
          : useCache
            ? cached
            : { products: data.products, stage: seed?.stage, prep: seed?.prep };
        loadedContext.current = contextKey;
        setProducts(cleanProducts(choice.products));
        setStage(cleanStage(choice.stage));
        if (choice.prep && !latest.current.live)
          hydrateRef.current(choice.prep);
        setImprovement(
          typeof data.improvement === "string" ? data.improvement : "",
        );
        dirtyClient.current =
          (carry && dirtyClient.current) ||
          (!!useCache &&
            JSON.stringify(cleanProducts(choice.products)) !==
              JSON.stringify(cleanProducts(data.products)));
        setReady(true);
        setStatus(
          useCache
            ? "Recovered your on-device draft"
            : "Saved preparation loaded",
        );
      })
      .catch((error) => {
        if (generation.current !== current) return;
        setStatus(
          error.message ||
            "Saved preparation could not load. Keep your draft and reopen this call.",
        );
      });
    return () => {
      generation.current++;
    };
  }, [contextKey, draftKey, options.companyId, options.ready, loadNonce]);
  useEffect(() => {
    started.current = 0;
  }, [options.room]);
  useEffect(() => {
    if (!ready || !options.ready || loadedContext.current !== contextKey)
      return;
    if (options.live && !started.current) started.current = Date.now();
    const current = generation.current;
    const savedAt = new Date().toISOString();
    const snapshot = { products, stage, prep: latest.current.prep, savedAt };
    const writeCache = (value: typeof snapshot) => {
      try {
        localStorage.setItem(
          `lc:sales-prep:${identity.current}:${contextKey}`,
          JSON.stringify(value),
        );
        if (options.live || options.ended)
          localStorage.setItem(
            `lc:sales-prep:${identity.current}:${draftKey}`,
            JSON.stringify(value),
          );
      } catch {
        /* server save still runs */
      }
    };
    writeCache(snapshot);
    setStatus("Saving…");
    const timer = setTimeout(
      () => {
        saveChain.current = saveChain.current
          .catch(() => {})
          .then(async () => {
            if (current !== generation.current) return;
            const info = latest.current;
            const saveClientProducts = dirtyClient.current;
            const response = await crmFetch<any>("/api/interview/sales-plan", {
              method: "POST",
              body: JSON.stringify({
                key: contextKey,
                companyId: info.companyId,
                sessionId: info.live || info.ended ? info.room : null,
                products: snapshot.products,
                stage: snapshot.stage,
                prep: snapshot.prep,
                expectedUpdatedAt: version.current,
                elapsedSeconds: started.current
                  ? Math.floor((Date.now() - started.current) / 1000)
                  : 0,
                transcriptChars: info.transcript.length,
                saveClientProducts,
              }),
            });
            if (current !== generation.current) return;
            version.current = response.updatedAt;
            if (
              info.companyId &&
              response.clientSaved &&
              saveClientProducts &&
              JSON.stringify(scriptRef.current.products) ===
                JSON.stringify(snapshot.products)
            )
              dirtyClient.current = false;
            const stillCurrent =
              JSON.stringify(scriptRef.current) ===
                JSON.stringify({
                  products: snapshot.products,
                  stage: snapshot.stage,
                }) &&
              JSON.stringify(latest.current.prep) ===
                JSON.stringify(snapshot.prep);
            if (stillCurrent) {
              setStatus(response.notice || "Saved");
              writeCache({ ...snapshot, savedAt: response.updatedAt });
            }
          })
          .catch((error) => {
            if (current === generation.current)
              setStatus(
                error.message ||
                  "Save not confirmed. Your on-device draft is kept.",
              );
          });
      },
      options.live ? 100 : 400,
    );
    return () => clearTimeout(timer);
  }, [
    ready,
    contextKey,
    draftKey,
    products,
    stage,
    prepSignature,
    options.live,
    options.ended,
    options.ready,
    nonce,
  ]);
  const choose = (value: SalesProduct[]) => {
    dirtyClient.current = true;
    scriptRef.current = { products: value, stage };
    setProducts(value);
  };
  return {
    products,
    choose,
    stage,
    setStage,
    status,
    ready,
    improvement,
    scriptRef,
    retry: () => (ready ? setNonce((n) => n + 1) : setLoadNonce((n) => n + 1)),
  };
}
