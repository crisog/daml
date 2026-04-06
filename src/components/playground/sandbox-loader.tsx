import { useEffect, useState, type ReactNode } from "react";
import { getSandboxStatus } from "@/lib/sandbox.functions";

type SandboxState =
  | { kind: "loading" }
  | { kind: "starting"; message: string }
  | { kind: "ready" }
  | { kind: "at-capacity"; active: number; max: number }
  | { kind: "error"; message: string };

export function SandboxLoader({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SandboxState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const status = await getSandboxStatus();

        if (cancelled) return;

        if (status.kind === "ready") {
          setState({ kind: "ready" });
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

        setState({ kind: "error", message: status.message ?? "Unknown error" });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Failed to reach sandbox",
          });
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "ready") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page text-ink">
      <div className="max-w-sm space-y-4 text-center">
        {state.kind === "loading" && (
          <p className="text-sm text-ink-muted">Connecting to sandbox...</p>
        )}

        {state.kind === "starting" && (
          <>
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-stone border-t-accent" />
            <p className="text-sm text-ink-muted">{state.message}</p>
          </>
        )}

        {state.kind === "at-capacity" && (
          <>
            <p className="text-sm font-medium text-ink">
              All sandboxes are in use
            </p>
            <p className="text-xs text-ink-muted">
              {state.active}/{state.max} active. Retrying automatically...
            </p>
          </>
        )}

        {state.kind === "error" && (
          <>
            <p className="text-sm font-medium text-red-400">
              Sandbox error
            </p>
            <p className="text-xs text-ink-muted">{state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-stone px-3 py-1 text-xs text-ink hover:bg-stone/30"
            >
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}
