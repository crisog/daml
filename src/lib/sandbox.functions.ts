import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { ensureSession } from "@/lib/auth.functions";
import type { UserSessionData } from "@/server/do/session-do";

type SandboxStatus =
  | { kind: "ready" }
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
      // Container port 8081 is up, but Canton JVM may still be booting or
      // the synchronizer may not be connected yet. Check the connected
      // synchronizers endpoint to confirm the sandbox is fully operational.
      try {
        const container = env.SANDBOX.getByName(userId);
        const syncRes = await container.fetch("http://container/v2/state/connected-synchronizers");
        if (syncRes.ok) {
          const data = await syncRes.json() as Record<string, unknown>;
          // Canton may use camelCase or snake_case depending on version
          const syncs = (data.connectedSynchronizers ?? data.connected_synchronizers) as unknown[] | undefined;
          if (syncs && syncs.length > 0) {
            return { kind: "ready" };
          }
        }
      } catch {
        // Container is up but Canton not fully ready yet
      }
      return { kind: "starting", message: "Canton is booting, this usually takes ~2 minutes..." };
    }

    if (status.containerStatus === "starting") {
      return { kind: "starting", message: "Provisioning your sandbox..." };
    }

    // Container is stopped or errored, trigger start
    await sessionDO.start();
    return { kind: "starting", message: "Provisioning your sandbox..." };
  }
);

export const saveUserSession = createServerFn({ method: "POST" })
  .validator((data: UserSessionData) => data)
  .handler(async ({ data }) => {
    const session = await ensureSession();
    const sessionDO = env.SESSION.getByName(session.user.id);
    await sessionDO.saveUserSession(data);
  });

export const loadUserSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<UserSessionData | null> => {
    const session = await ensureSession();
    const sessionDO = env.SESSION.getByName(session.user.id);
    return sessionDO.loadUserSession();
  }
);
