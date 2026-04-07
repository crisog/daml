import type { ReactNode } from "react";
import type { SandboxState } from "@/lib/use-sandbox-status";

type Props = {
  state: SandboxState;
  sandboxReady: boolean;
  children: (sandboxReady: boolean) => ReactNode;
};

export function SandboxLoader({ state, sandboxReady, children }: Props) {
  return (
    <>
      {children(sandboxReady)}
      {!sandboxReady && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-page/80">
          <div className="max-w-sm space-y-4 rounded-lg border border-stone bg-surface p-6 text-center">
            {(state.kind === "loading" || state.kind === "idle") && (
              <p className="text-sm text-ink-muted">Connecting to sandbox...</p>
            )}

            {(state.kind === "starting" || state.kind === "restoring") && (
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
      )}
    </>
  );
}
