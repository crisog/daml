import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { ensureSession } from "@/lib/auth.functions";

type SandboxStatus =
  | { kind: "ready" }
  | { kind: "starting"; message: string }
  | { kind: "restoring"; message: string }
  | { kind: "at-capacity"; active: number; max: number }
  | { kind: "error"; message: string };

async function restoreOnSandbox(
  userId: string,
  sessionDO: DurableObjectStub
): Promise<void> {
  const session = await sessionDO.loadUserSession();
  if (!session) return;

  const container = env.SANDBOX.getByName(userId);

  if (session.deployed && session.source) {
    const res = await container.fetch("http://container/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: { "Main.daml": session.source } }),
    });
    const result = (await res.json()) as { success?: boolean };
    if (!result.success) {
      console.error("Failed to restore contract on sandbox");
    }
  }

  for (const name of session.partyNames) {
    try {
      await container.fetch("http://container/v2/parties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyIdHint: name, identityProviderId: "" }),
      });
    } catch {
      console.error(`Failed to restore party: ${name}`);
    }
  }

  await sessionDO.clearNeedsRestore();
}

export const getSandboxStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SandboxStatus> => {
    const session = await ensureSession();
    const userId = session.user.id;

    const gatekeeper = env.GATEKEEPER.getByName("global");
    const capacity = await gatekeeper.acquire(userId);

    if (!capacity.granted) {
      return {
        kind: "at-capacity",
        active: capacity.active,
        max: capacity.max,
      };
    }

    const sessionDO = env.SESSION.getByName(userId);
    const status = await sessionDO.status();

    if (status.containerStatus === "running") {
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
            const needs = await sessionDO.needsRestore();
            if (needs) {
              // Restore server-side before telling the client we're ready
              await restoreOnSandbox(userId, sessionDO);
              return {
                kind: "restoring",
                message: "Restoring your previous session...",
              };
            }
            return { kind: "ready" };
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

    await sessionDO.start();
    return { kind: "starting", message: "Provisioning your sandbox..." };
  }
);
