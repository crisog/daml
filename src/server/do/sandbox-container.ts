import { Container } from "@cloudflare/containers";

interface Env {
  SESSION: DurableObjectNamespace;
}

export class SandboxContainer extends Container<Env> {
  defaultPort = 8081;
  sleepAfter = "5m";

  private alive = false;

  override onStart(): void {
    this.alive = true;
    console.log(`Sandbox container started: ${this.ctx.id}`);
  }

  override onStop(stopParams: { exitCode: number; reason: string }): void {
    this.alive = false;
    console.log(
      `Sandbox container stopped: ${this.ctx.id}, exit=${stopParams.exitCode}, reason=${stopParams.reason}`
    );
    this.notifySessionDown(
      `stopped (exit=${stopParams.exitCode}, reason=${stopParams.reason})`
    );
  }

  override onError(error: string): void {
    this.alive = false;
    console.error(`Sandbox container error: ${this.ctx.id}, error=${error}`);
    this.notifySessionDown(`error: ${error}`);
  }

  /** Called by SessionDO to check if the container process is actually alive. */
  async isHealthy(): Promise<boolean> {
    return this.alive;
  }

  private async notifySessionDown(reason: string): Promise<void> {
    try {
      const sessionId = await this.ctx.storage.get<string>("sessionDoId");
      if (!sessionId) return;
      const sessionDO = this.env.SESSION.getByName(sessionId);
      await (sessionDO as unknown as { reportContainerDown(reason: string): Promise<void> })
        .reportContainerDown(reason);
    } catch (err) {
      console.error(`Failed to notify SessionDO of container down: ${err}`);
    }
  }

  /** Called by SessionDO to register itself for status callbacks. */
  async setSessionId(sessionDoId: string): Promise<void> {
    await this.ctx.storage.put("sessionDoId", sessionDoId);
  }
}
