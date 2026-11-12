"use client";
import { useEffect, useRef, useState } from "react";

export type RequestState<T> =
  | { status: "idle" | "loading" }
  | { status: "success"; data: T }
  | { status: "error"; message: string };

/** One request per scope. Ignore stale completions even when the transport ignores abort. */
export function useRequest<T>(scope: string) {
  const [snapshot, setSnapshot] = useState<{ scope: string; state: RequestState<T> }>();
  const [lastSuccess,setLastSuccess]=useState<{scope:string;data:T}>();
  const active = useRef<{ scope: string; controller: AbortController } | null>(null);
  const current = useRef(scope);
  current.current = scope;
  useEffect(() => {
    return () => {
      if (active.current?.scope === scope) {
        active.current.controller.abort();
        active.current = null;
      }
    };
  }, [scope]);

  async function run(work: (signal: AbortSignal) => Promise<T>, onSuccess?: (data: T) => void) {
    if (active.current?.scope === scope) return;
    active.current?.controller.abort();
    const request = { scope, controller: new AbortController() };
    active.current = request;
    const publish = (state: RequestState<T>) => setSnapshot({ scope, state });
    const isCurrent = () => active.current === request && current.current === scope;
    publish({ status: "loading" });
    try {
      const data = await work(request.controller.signal);
      if (!isCurrent()) return;
      onSuccess?.(data);
      setLastSuccess({scope,data});
      publish({ status: "success", data });
    } catch (error) {
      if (isCurrent()) publish({ status: "error", message: error instanceof Error ? error.message : "Request failed. Please try again." });
    } finally {
      if (active.current === request) active.current = null;
    }
  }

  const state: RequestState<T> = snapshot?.scope === scope ? snapshot.state : { status: "idle" };
  return { state, run, previous:lastSuccess?.scope===scope?lastSuccess.data:undefined };
}
