import { Container } from "@cloudflare/containers";

export class SandboxContainer extends Container {
  defaultPort = 8081;
  sleepAfter = "5m";

  override onStart(): void {
    console.log(`Sandbox container started: ${this.ctx.id}`);
  }

  override onStop(stopParams: { exitCode: number; reason: string }): void {
    console.log(
      `Sandbox container stopped: ${this.ctx.id}, exit=${stopParams.exitCode}, reason=${stopParams.reason}`
    );
  }

  override onError(error: string): void {
    console.error(`Sandbox container error: ${this.ctx.id}, error=${error}`);
  }
}
