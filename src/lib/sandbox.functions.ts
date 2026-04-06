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
      return { kind: "ready" };
    }

    if (status.containerStatus === "starting") {
      return { kind: "starting", message: "Starting your sandbox..." };
    }

    if (status.containerStatus === "error") {
      return { kind: "error", message: status.errorLog ?? "Container failed" };
    }

    // Container is stopped, trigger start
    await sessionDO.start();
    return { kind: "starting", message: "Starting your sandbox..." };
  }
);
