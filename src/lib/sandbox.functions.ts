import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { ensureSession } from "@/lib/auth.functions";

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
      // Container port 8081 is up, but Canton JVM may still be booting.
      // Ping /v2/packages through the proxy to confirm Canton is ready.
      try {
        const container = env.SANDBOX.getByName(userId);
        const cantonRes = await container.fetch("http://container/v2/packages");
        if (cantonRes.ok) {
          return { kind: "ready" };
        }
      } catch {
        // Container is up but Canton not ready yet
      }
      return { kind: "starting", message: "Canton sandbox is booting..." };
    }

    if (status.containerStatus === "starting") {
      return { kind: "starting", message: "Starting your sandbox..." };
    }

    // Container is stopped or errored, trigger start
    await sessionDO.start();
    return { kind: "starting", message: "Starting your sandbox..." };
  }
);
