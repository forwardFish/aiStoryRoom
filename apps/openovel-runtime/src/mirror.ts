import type { EventMirror, MirrorEvent } from "./types.js";
import type { FileStoryWorkspace } from "./workspace.js";

export class NoopMirror implements EventMirror {
  readonly configured = false;

  async publish(_event: MirrorEvent) {
    // Local/runtime-only mode. Workspace remains authoritative.
  }
}

export class HttpEventMirror implements EventMirror {
  readonly configured = true;

  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): EventMirror {
    const endpoint = String(env.OPENOVEL_MIRROR_URL || "").trim();
    if (!endpoint) return new NoopMirror();
    return new HttpEventMirror(
      endpoint.replace(/\/+$/, ""),
      String(env.OPENOVEL_MIRROR_TOKEN || "").trim(),
      fetchImpl,
    );
  }

  async publish(event: MirrorEvent) {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(`Mirror HTTP ${response.status}`);
  }
}

/**
 * Canon is committed before product-database projection. Keep every configured
 * mirror event in the authoritative Run Workspace until the receiver
 * acknowledges it. Delivery remains non-blocking for the player and is retried
 * on the next publish or runtime restart.
 */
export class DurableEventMirror implements EventMirror {
  readonly configured = true;
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly workspace: FileStoryWorkspace,
    private readonly transport: EventMirror,
  ) {}

  async publish(event: MirrorEvent) {
    await this.workspace.enqueueMirror(event);
    void this.kick(event.runId);
  }

  kick(runId: string) {
    const active = this.running.get(runId);
    if (active) return active;
    const task = this.drain(runId)
      .catch(() => {})
      .finally(() => this.running.delete(runId));
    this.running.set(runId, task);
    return task;
  }

  isRunning(runId: string) {
    return this.running.has(runId);
  }

  private async drain(runId: string) {
    let releaseLease: (() => Promise<void>) | undefined;
    try {
      releaseLease = await this.workspace.acquireMirrorLease(runId);
    } catch (error) {
      if (String((error as Error).message || error) === "RUN_MIRROR_BUSY") return;
      throw error;
    }
    try {
      while (true) {
        const { items, state } = await this.workspace.mirrorOutbox(runId);
        const item = items.find((candidate) => !state.processed.includes(candidate.id));
        if (!item) return;
        try {
          await this.transport.publish({
            kind: item.kind,
            runId: item.runId,
            payload: item.payload,
          });
          await this.workspace.markMirror(runId, item.id, { processed: true });
        } catch (error) {
          await this.workspace.markMirror(runId, item.id, {
            processed: false,
            error: String((error as Error).message || error),
          });
          return;
        }
      }
    } finally {
      await releaseLease().catch(() => {});
    }
  }
}
