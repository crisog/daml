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
  sessionDO: DurableObjectStub
): Promise<void> {
  const session = await sessionDO.loadUserSession();
  if (!session) return;

  const doId = sessionDO.id.toString();
  const container = env.SANDBOX.getByName(doId);

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
        const doId = sessionDO.id.toString();
        const container = env.SANDBOX.getByName(doId);

        // Check 1: synchronizers connected
        const syncRes = await container.fetch(
          "http://container/v2/state/connected-synchronizers"
        );
        if (!syncRes.ok) {
          return {
            kind: "starting",
            message: "Canton is booting, this usually takes ~2 minutes...",
          };
        }
        const syncData = (await syncRes.json()) as {
          connectedSynchronizers?: unknown[];
        };
        if (
          !syncData.connectedSynchronizers ||
          syncData.connectedSynchronizers.length === 0
        ) {
          return {
            kind: "starting",
            message: "Canton is booting, this usually takes ~2 minutes...",
          };
        }

        // Check 2: ledger API initialized (offset > 0)
        const ledgerRes = await container.fetch(
          "http://container/v2/state/ledger-end"
        );
        if (!ledgerRes.ok) {
          return {
            kind: "starting",
            message: "Ledger API is initializing...",
          };
        }
        const ledger = (await ledgerRes.json()) as { offset?: number };
        if (!ledger.offset || ledger.offset <= 0) {
          return {
            kind: "starting",
            message: "Ledger API is initializing...",
          };
        }

        // Check 3: package service accepting requests
        const pkgRes = await container.fetch("http://container/v2/packages");
        if (!pkgRes.ok) {
          return {
            kind: "starting",
            message: "Package service is initializing...",
          };
        }

        // All checks passed
        const needs = await sessionDO.needsRestore();
        if (needs) {
          await restoreOnSandbox(sessionDO);
          return {
            kind: "restoring",
            message: "Restoring your previous session...",
          };
        }
        return { kind: "ready" };
      } catch {
        // Container slept or crashed; restart it
        await sessionDO.restart().catch(() => {});
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
