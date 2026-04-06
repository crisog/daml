import { DurableObject } from "cloudflare:workers";

const DEFAULT_MAX = 50;
const RECONCILE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

interface ActiveEntry {
  userId: string;
  startedAt: number;
}

export class GatekeeperDO extends DurableObject {
  private activeContainers: Map<string, ActiveEntry> = new Map();
  private maxAllowed: number = DEFAULT_MAX;
  private initialized = false;

  private async ensureInitialized() {
    if (this.initialized) return;

    const stored = await this.ctx.storage.get<number>("maxAllowed");
    if (stored !== undefined) {
      this.maxAllowed = stored;
    }

    const entries =
      await this.ctx.storage.get<[string, ActiveEntry][]>("activeEntries");
    if (entries) {
      this.activeContainers = new Map(entries);
    }

    // Schedule reconciliation alarm
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + RECONCILE_INTERVAL_MS);
    }

    this.initialized = true;
  }

  private async persistActive() {
    await this.ctx.storage.put(
      "activeEntries",
      Array.from(this.activeContainers.entries())
    );
  }

  async acquire(
    userId: string
  ): Promise<{ granted: boolean; active: number; max: number }> {
    await this.ensureInitialized();

    // Idempotent: if user already has a slot, grant without incrementing
    if (this.activeContainers.has(userId)) {
      return {
        granted: true,
        active: this.activeContainers.size,
        max: this.maxAllowed,
      };
    }

    if (this.activeContainers.size >= this.maxAllowed) {
      return {
        granted: false,
        active: this.activeContainers.size,
        max: this.maxAllowed,
      };
    }

    this.activeContainers.set(userId, {
      userId,
      startedAt: Date.now(),
    });
    await this.persistActive();

    return {
      granted: true,
      active: this.activeContainers.size,
      max: this.maxAllowed,
    };
  }

  async release(userId: string): Promise<void> {
    await this.ensureInitialized();
    this.activeContainers.delete(userId);
    await this.persistActive();
  }

  async status(): Promise<{ active: number; max: number }> {
    await this.ensureInitialized();
    return {
      active: this.activeContainers.size,
      max: this.maxAllowed,
    };
  }

  async setMax(n: number): Promise<void> {
    await this.ensureInitialized();
    this.maxAllowed = n;
    await this.ctx.storage.put("maxAllowed", n);
  }

  async alarm() {
    await this.ensureInitialized();

    // Prune entries older than 1 hour (safety net for missed releases)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let pruned = false;
    for (const [userId, entry] of this.activeContainers) {
      if (entry.startedAt < oneHourAgo) {
        this.activeContainers.delete(userId);
        pruned = true;
      }
    }
    if (pruned) {
      await this.persistActive();
    }

    // Reschedule
    await this.ctx.storage.setAlarm(Date.now() + RECONCILE_INTERVAL_MS);
  }
}
