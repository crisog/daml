import { DurableObject } from "cloudflare:workers";
import { retry, AbortError } from "./retry";

type ContainerStatus = "stopped" | "starting" | "running" | "error";

const FETCH_TIMEOUT_MS = 120_000;

export interface UserSessionData {
  source: string;
  partyNames: string[];
  deployed: boolean;
}

interface SessionState {
  containerStatus: ContainerStatus;
  startedAt: number | null;
  lastActivityAt: number | null;
  requestCount: number;
  errorLog: string | null;
}

interface Env {
  SANDBOX: DurableObjectNamespace;
  GATEKEEPER: DurableObjectNamespace;
}

export class SessionDO extends DurableObject<Env> {
  private state: SessionState = {
    containerStatus: "stopped",
    startedAt: null,
    lastActivityAt: null,
    requestCount: 0,
    errorLog: null,
  };
  private initialized = false;

  private async ensureInitialized() {
    if (this.initialized) return;

    const stored = await this.ctx.storage.get<SessionState>("state");
    if (stored) {
      this.state = stored;
    }

    this.initialized = true;
  }

  private async persistState() {
    await this.ctx.storage.put("state", this.state);
  }

  private getContainerStub() {
    // Use the same name as this DO so there's a 1:1 mapping
    const name = this.ctx.id.toString();
    return this.env.SANDBOX.getByName(name);
  }

  async start(): Promise<void> {
    await this.ensureInitialized();

    if (this.state.containerStatus === "running") return;
    if (this.state.containerStatus === "starting") return;

    this.state.containerStatus = "starting";
    this.state.errorLog = null;
    await this.persistState();

    try {
      const container = this.getContainerStub();
      // Register this SessionDO so the container can push status changes back
      await (container as unknown as { setSessionId(id: string): Promise<void> })
        .setSessionId(this.ctx.id.toString());
      // startAndWaitForPorts waits until the container's defaultPort is reachable
      await container.startAndWaitForPorts();

      this.state.containerStatus = "running";
      this.state.startedAt = Date.now();
      await this.persistState();

      // Container disk is ephemeral: flag that Canton state needs restoring
      await this.ctx.storage.put("needsRestore", true);
    } catch (err) {
      this.state.containerStatus = "error";
      this.state.errorLog =
        err instanceof Error ? err.message : "Failed to start container";
      await this.persistState();
      throw err;
    }
  }

  async restart(): Promise<void> {
    await this.ensureInitialized();
    this.state.containerStatus = "stopped";
    await this.persistState();
    await this.start();
  }

  /** Called by SandboxContainer status hooks when the container stops or errors. */
  async reportContainerDown(reason: string): Promise<void> {
    await this.ensureInitialized();
    this.state.containerStatus = "stopped";
    this.state.errorLog = reason;
    await this.persistState();
    console.log(`SessionDO: container reported down: ${reason}`);
  }

  async proxy(request: Request): Promise<Response> {
    await this.ensureInitialized();

    // Start container if not running
    if (this.state.containerStatus !== "running") {
      try {
        await this.start();
      } catch {
        return new Response("Sandbox failed to start", { status: 502 });
      }
    }

    // Buffer the body upfront so retries can resend it
    const body = request.body ? await request.arrayBuffer() : null;
    const makeRequest = () =>
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });

    const container = this.getContainerStub();

    try {
      const response = await retry(
        async () => {
          const res = await this.fetchWithTimeout(container, makeRequest());
          return res;
        },
        {
          retries: 1,
          minTimeout: 500,
          shouldRetry: async ({ error }) => {
            // Ask the container if it's actually alive via status hooks
            const healthy = await (
              container as unknown as { isHealthy(): Promise<boolean> }
            ).isHealthy();

            if (healthy) {
              // Transient error, worth retrying without restart
              return true;
            }

            // Container is confirmed down. Restart it before the retry.
            if (this.state.containerStatus !== "stopped") {
              this.state.containerStatus = "stopped";
              await this.persistState();
            }

            try {
              await this.start();
              return true;
            } catch {
              // Restart failed, abort retries
              throw new AbortError(error);
            }
          },
          onFailedAttempt: ({ attemptNumber, error }) => {
            console.log(
              `SessionDO proxy attempt ${attemptNumber} failed: ${error.message}`
            );
          },
        }
      );

      this.state.lastActivityAt = Date.now();
      this.state.requestCount += 1;
      await this.persistState();

      return response;
    } catch (err) {
      this.state.containerStatus = "error";
      this.state.errorLog =
        err instanceof Error ? err.message : "Sandbox request failed";
      await this.persistState();

      // Release gatekeeper slot on permanent failure
      const gatekeeper = this.env.GATEKEEPER.getByName("global");
      await gatekeeper.release(this.ctx.id.toString());

      return new Response("Sandbox unavailable", { status: 502 });
    }
  }

  private async fetchWithTimeout(
    container: DurableObjectStub,
    request: Request
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const req = new Request(request, { signal: controller.signal });
      return await container.fetch(req);
    } finally {
      clearTimeout(timeout);
    }
  }

  async status(): Promise<{
    containerStatus: ContainerStatus;
    startedAt: number | null;
    lastActivityAt: number | null;
    requestCount: number;
    errorLog: string | null;
  }> {
    await this.ensureInitialized();
    return { ...this.state };
  }

  async saveUserSession(data: UserSessionData): Promise<void> {
    await this.ctx.storage.put("userSession", data);
  }

  async loadUserSession(): Promise<UserSessionData | null> {
    return (await this.ctx.storage.get<UserSessionData>("userSession")) ?? null;
  }

  async needsRestore(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>("needsRestore")) ?? false;
  }

  async clearNeedsRestore(): Promise<void> {
    await this.ctx.storage.put("needsRestore", false);
  }

  async stop(): Promise<void> {
    await this.ensureInitialized();

    try {
      const container = this.getContainerStub();
      await container.stop();
    } catch {
      // Container may already be stopped
    }

    this.state.containerStatus = "stopped";
    await this.persistState();

    // Release gatekeeper slot
    const gatekeeper = this.env.GATEKEEPER.getByName("global");
    await gatekeeper.release(this.ctx.id.toString());
  }
}
