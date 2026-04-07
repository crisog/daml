import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { ensureSession } from "@/lib/auth.functions";

type SandboxStatus =
  | { kind: "ready"; needsRestore: boolean }
  | { kind: "starting"; message: string }
  | { kind: "at-capacity"; active: number; max: number }
  | { kind: "error"; message: string };

export const getSandboxStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SandboxStatus> => {
    const session = await ensureSession();
    const userId = session.user.id;

    // Check capacity
    const gatekeeper = env.GATEKEEPER.getByName("global");
    const capacity = await gatekeeper.acquire(userId);

    if (!capacity.granted) {
      return {
        kind: "at-capacity",
        active: capacity.active,
        max: capacity.max,
      };
    }

    // Get sandbox status via Session DO
    const sessionDO = env.SESSION.getByName(userId);
    const status = await sessionDO.status();

    if (status.containerStatus === "running") {
      // Container port 8081 is up, but Canton may still be booting.
      // Check connected synchronizers to confirm Canton is fully ready.
      // Verified locally: field is camelCase "connectedSynchronizers"
      try {
        const container = env.SANDBOX.getByName(userId);
        const res = await container.fetch(
          "http://container/v2/state/connected-synchronizers"
        );
        if (res.ok) {
          const data = (await res.json()) as {
            connectedSynchronizers?: unknown[];
          };
          if (
            data.connectedSynchronizers &&
            data.connectedSynchronizers.length > 0
          ) {
            const needsRestore = await sessionDO.needsRestore();
            return { kind: "ready", needsRestore };
          }
        }
      } catch {
        // Container up but Canton not ready yet
      }
      return {
        kind: "starting",
        message: "Canton is booting, this usually takes ~2 minutes...",
      };
    }

    if (status.containerStatus === "starting") {
      return { kind: "starting", message: "Provisioning your sandbox..." };
    }

    // Container is stopped or errored, trigger start
    await sessionDO.start();
    return { kind: "starting", message: "Provisioning your sandbox..." };
  }
);

export const clearRestore = createServerFn({ method: "POST" }).handler(
  async () => {
    const session = await ensureSession();
    const sessionDO = env.SESSION.getByName(session.user.id);
    await sessionDO.clearNeedsRestore();
  }
);
