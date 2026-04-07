import { useEffect, useRef, useState } from "react";
import { getSandboxStatus } from "@/lib/sandbox.functions";

export type SandboxState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "starting"; message: string }
  | { kind: "restoring"; message: string }
  | { kind: "ready" }
  | { kind: "at-capacity"; active: number; max: number }
  | { kind: "error"; message: string };

export function useSandboxStatus(enabled: boolean) {
  const [state, setState] = useState<SandboxState>({ kind: "idle" });
  const readyFired = useRef(false);
  const startedAt = useRef<number | null>(null);
  const bootTimeMs = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState({ kind: "idle" });
      readyFired.current = false;
      startedAt.current = null;
      bootTimeMs.current = null;
      return;
    }

    let cancelled = false;
    startedAt.current = Date.now();

    async function poll() {
      try {
        const status = await getSandboxStatus();
        if (cancelled) return;

        if (status.kind === "ready") {
          if (startedAt.current) {
            bootTimeMs.current = Date.now() - startedAt.current;
          }
          setState({ kind: "ready" });
          readyFired.current = true;
          return;
        }

        if (status.kind === "restoring") {
          setState({ kind: "restoring", message: status.message });
          setTimeout(poll, 2_000);
          return;
        }

        if (status.kind === "at-capacity") {
          setState({
            kind: "at-capacity",
            active: status.active,
            max: status.max,
          });
          setTimeout(poll, 15_000);
          return;
        }

        if (status.kind === "starting") {
          setState({ kind: "starting", message: status.message });
          setTimeout(poll, 2_000);
          return;
        }

        setState({
          kind: "error",
          message: status.message ?? "Unknown error",
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              err instanceof Error ? err.message : "Failed to reach sandbox",
          });
        }
      }
    }

    setState({ kind: "loading" });
    poll();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const sandboxReady = state.kind === "ready";

  return { state, sandboxReady, bootTimeMs: bootTimeMs.current } as const;
}
