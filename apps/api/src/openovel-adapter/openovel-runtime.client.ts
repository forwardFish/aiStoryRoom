import { Injectable, ServiceUnavailableException } from "@nestjs/common";

export const OPENOVEL_ENGINE_VERSION = "openovel_v1";
export const OPENOVEL_RUNTIME_MODE = "OPENOVEL_V1";
export const OPENOVEL_PROJECTION_SCHEMA = "openovel_game_projection_v1";

export type OpenNovelVisibleOption = {
  id: string;
  label: string;
  key?: boolean;
};

export type OpenNovelPublicRun = {
  runId: string;
  worldId: string;
  roleId: string;
  runtimeMode: typeof OPENOVEL_RUNTIME_MODE;
  turnNumber: number;
  status: string;
  canon: string;
  recentCanon: string;
  options: OpenNovelVisibleOption[];
  updatedAt: string;
};

export type OpenNovelTurnEvent = {
  type: "narration.delta" | "narration.complete" | "options.complete" | "runtime.warning" | "turn.committed";
  data: any;
};

@Injectable()
export class OpenNovelRuntimeClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = String(process.env.OPENOVEL_RUNTIME_URL || "http://127.0.0.1:3110").replace(/\/+$/, "");
    this.token = String(process.env.OPENOVEL_INTERNAL_TOKEN || "").trim();
  }

  async health() {
    return this.requestJson("/internal/openovel/health", { method: "GET" });
  }

  async createRun(input: {
    runId: string;
    worldId: string;
    roleId: string;
    storyPackageVersion: string;
    openingVersion: string;
  }): Promise<OpenNovelPublicRun> {
    return this.requestJson("/internal/openovel/runs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getRun(runId: string): Promise<OpenNovelPublicRun> {
    return this.requestJson(`/internal/openovel/runs/${encodeURIComponent(runId)}`, { method: "GET" });
  }

  async streamAction(
    input: {
      runId: string;
      action: string;
      submissionId: string;
      expectedStateRevision?: number;
      boundOption?: { id: string; label: string } | null;
    },
    onEvent: (event: OpenNovelTurnEvent) => void | Promise<void>,
  ) {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/openovel/runs/${encodeURIComponent(input.runId)}/actions`, {
        method: "POST",
        headers: this.headers({ accept: "text/event-stream" }),
        body: JSON.stringify({
          action: input.action,
          submissionId: input.submissionId,
          expectedStateRevision: input.expectedStateRevision,
          boundOption: input.boundOption || null,
        }),
      });
    } catch (error) {
      throw unavailable(error);
    }
    if (!response.ok) throw await runtimeHttpError(response);
    if (!response.body) throw new ServiceUnavailableException({
      code: "OPENOVEL_STREAM_UNAVAILABLE",
      message: "The story runtime did not return a readable stream.",
    });

    let committed: any = null;
    await readSse(response.body, async (event) => {
      if (event.type === "turn.committed") committed = event.data;
      await onEvent(event);
    });
    if (!committed) {
      throw new ServiceUnavailableException({
        code: "OPENOVEL_TURN_NOT_COMMITTED",
        message: "The story runtime ended before committing the turn.",
      });
    }
    return committed;
  }

  private async requestJson(path: string, init: RequestInit) {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: this.headers(init.headers),
      });
    } catch (error) {
      throw unavailable(error);
    }
    if (!response.ok) throw await runtimeHttpError(response);
    return response.json();
  }

  private headers(extra?: HeadersInit) {
    const headers = new Headers(extra || {});
    headers.set("content-type", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    return headers;
  }
}

export async function readSse(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: OpenNovelTurnEvent) => void | Promise<void>,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSseBlock(block);
      if (event) await onEvent(event);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  const trailing = parseSseBlock(buffer);
  if (trailing) await onEvent(trailing);
}

function parseSseBlock(block: string): OpenNovelTurnEvent | null {
  let type = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!type || !data.length) return null;
  return { type: type as OpenNovelTurnEvent["type"], data: JSON.parse(data.join("\n")) };
}

async function runtimeHttpError(response: Response) {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  return new ServiceUnavailableException({
    code: String(payload.error || "OPENOVEL_RUNTIME_ERROR"),
    message: String(payload.message || payload.error || `Story runtime HTTP ${response.status}`),
    runtimeStatus: response.status,
  });
}

function unavailable(error: unknown) {
  return new ServiceUnavailableException({
    code: "OPENOVEL_RUNTIME_UNAVAILABLE",
    message: String((error as Error)?.message || error || "The story runtime is unavailable."),
  });
}
