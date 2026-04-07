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
      // Container port 8081 is up, but Canton may still be booting.
      // The only reliable readiness test: try an actual compile.
      // A trivial Daml module that compiles instantly.
      try {
        const container = env.SANDBOX.getByName(userId);
        const probeRes = await container.fetch("http://container/compile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: { "Probe.daml": "module Probe where" },
          }),
        });
        if (probeRes.ok) {
          const result = await probeRes.json() as { success?: boolean };
          if (result.success) {
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
