import type { EventMirror, MirrorEvent } from "./types.js";

export class NoopMirror implements EventMirror {
  async publish(_event: MirrorEvent) {
    // Local/runtime-only mode. Workspace remains authoritative.
  }
}

export class HttpEventMirror implements EventMirror {
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
