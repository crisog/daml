import { DurableObject } from "cloudflare:workers";

type ContainerStatus = "stopped" | "starting" | "running" | "error";

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

    const container = this.getContainerStub();

    try {
      const response = await container.fetch(request);

      this.state.lastActivityAt = Date.now();
      this.state.requestCount += 1;
      await this.persistState();

      return response;
    } catch (err) {
      // Attempt one restart
      if (this.state.containerStatus === "running") {
        this.state.containerStatus = "stopped";
        await this.persistState();

        try {
          await this.start();
          const retryResponse = await container.fetch(request);

          this.state.lastActivityAt = Date.now();
          this.state.requestCount += 1;
          await this.persistState();

          return retryResponse;
        } catch (retryErr) {
          this.state.containerStatus = "error";
          this.state.errorLog =
            retryErr instanceof Error
              ? retryErr.message
              : "Container restart failed";
          await this.persistState();

          // Release gatekeeper slot on permanent failure
          const gatekeeper = this.env.GATEKEEPER.getByName("global");
          await gatekeeper.release(this.ctx.id.toString());
        }
      }

      return new Response("Sandbox unavailable", { status: 502 });
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
