import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import {
  appendOpenNovelConfirmedManeuverContext,
  type OpenNovelConfirmedManeuverContextV1,
} from "@ai-story/shared";
import { PrismaService } from "../prisma.service";
import {
  compileConfirmedManeuverContext,
  hydrateOpenNovelManeuverStateFromEvents,
  markConfirmedManeuverContextConsumed,
} from "./openovel-maneuver-context";
import { openNovelManeuverPackages } from "./openovel-maneuver-packages";

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
  prologueNarrative?: string;
  ending?: {
    schemaVersion: "openovel_ending_v1";
    scope: "STORY" | "PART";
    endingKey: string;
    title: string;
    finalSceneNarrative: string;
    protagonistFate: string;
    aftermath: string[];
    sourceTurnId: string;
    sourceRevision: number;
  } | null;
  options: OpenNovelVisibleOption[];
  updatedAt: string;
};

export type OpenNovelTurnEvent = {
  type: "narration.delta" | "narration.complete" | "options.complete" | "runtime.warning" | "turn.committed";
  data: any;
};

export type OpenNovelSharedRun = {
  schemaVersion: "openovel_shared_run_v1";
  runId: string;
  worldId: string;
  actorIds: string[];
  stateRevision: number;
  latestWorldTurnId: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class OpenNovelRuntimeClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {
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

  async createSharedRun(input: {
    runId: string;
    worldId: string;
    roleKeys: string[];
  }): Promise<OpenNovelSharedRun> {
    return this.requestJson("/internal/openovel/shared-runs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getSharedRun(runId: string): Promise<OpenNovelSharedRun> {
    return this.requestJson(`/internal/openovel/shared-runs/${encodeURIComponent(runId)}`, {
      method: "GET",
    });
  }

  async submitSharedAction(input: {
    runId: string;
    roleKey: string;
    rawText: string;
    expectedStateRevision: number;
    idempotencyKey: string;
    candidateId?: string;
  }): Promise<any> {
    const { runId, ...body } = input;
    return this.requestJson(
      `/internal/openovel/shared-runs/${encodeURIComponent(runId)}/actions`,
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  async getSharedRoleView(
    runId: string,
    roleKey: string,
    capability: "feed" | "projection" | "impact" | "clues" | "destiny-net",
  ): Promise<any> {
    return this.requestJson(
      `/internal/openovel/shared-runs/${encodeURIComponent(runId)}/roles/${encodeURIComponent(roleKey)}/${capability}`,
      { method: "GET" },
    );
  }

  async getSharedRoleActions(runId: string, roleKey: string): Promise<Array<{ id: string; label: string }>> {
    return this.requestJson(
      `/internal/openovel/shared-runs/${encodeURIComponent(runId)}/roles/${encodeURIComponent(roleKey)}/actions`,
      { method: "GET" },
    );
  }

  async streamAction(
    input: {
      runId: string;
      action: string;
      submissionId: string;
      expectedStateRevision?: number;
      boundOption?: { id: string; label: string } | null;
      confirmedManeuverContext?: OpenNovelConfirmedManeuverContextV1 | null;
    },
    onEvent: (event: OpenNovelTurnEvent) => void | Promise<void>,
  ) {
    const bridge = input.confirmedManeuverContext
      ? { context: input.confirmedManeuverContext }
      : await this.prepareConfirmedManeuverBridge(
        input.runId,
        input.expectedStateRevision,
      );
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/internal/openovel/runs/${encodeURIComponent(input.runId)}/actions`, {
        method: "POST",
        headers: this.headers({ accept: "text/event-stream" }),
        body: JSON.stringify({
          action: signedRuntimeAction(input.action, bridge?.context),
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
    if (bridge?.context?.sourceResultIds?.length) {
      await this.consumeConfirmedManeuverBridge(
        input.runId,
        Math.max(0, Number(committed.turnNumber || input.expectedStateRevision || 0)),
        bridge.context.sourceResultIds,
      );
    }
    return committed;
  }

  private async prepareConfirmedManeuverBridge(
    runId: string,
    turnNumberValue: unknown,
  ) {
    if (!this.prisma) return null;
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      select: { templateKey: true, stateJson: true },
    });
    if (!run) return null;
    const maneuverPackage = openNovelManeuverPackages.get(run.templateKey);
    if (!maneuverPackage) return null;
    const events = await this.prisma.storyEvent.findMany({
      where: { runId, type: "openovel_maneuver_result" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { payloadJson: true },
    });
    const turnNumber = Math.max(0, Math.floor(Number(turnNumberValue) || 0));
    const hydrated = hydrateOpenNovelManeuverStateFromEvents({
      stateJson: run.stateJson,
      eventPayloads: events.map((event) => event.payloadJson),
      turnNumber,
      maneuverPackage,
    });
    if (hydrated.recoveredEventCount > 0) {
      await this.prisma.storyRun.update({
        where: { id: runId },
        data: { stateJson: hydrated.stateJson as any },
      });
    }
    const context = compileConfirmedManeuverContext({
      stateJson: hydrated.stateJson,
      turnNumber,
      maneuverPackage,
    });
    return context ? { context } : null;
  }

  private async consumeConfirmedManeuverBridge(
    runId: string,
    turnNumber: number,
    resultIds: string[],
  ) {
    if (!this.prisma || !resultIds.length) return;
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      select: { templateKey: true, stateJson: true },
    });
    if (!run) return;
    const maneuverPackage = openNovelManeuverPackages.get(run.templateKey);
    if (!maneuverPackage) return;
    const stateJson = markConfirmedManeuverContextConsumed({
      stateJson: run.stateJson,
      turnNumber,
      maneuverPackage,
      resultIds,
    });
    await this.prisma.storyRun.update({
      where: { id: runId },
      data: { stateJson: stateJson as any },
    });
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

export function signedRuntimeAction(
  actionValue: unknown,
  context?: OpenNovelConfirmedManeuverContextV1 | null,
) {
  const action = String(actionValue || "").trim();
  if (!context?.sourceResultIds?.length) return action;
  const payloadJson = JSON.stringify(context);
  const signature = createHmac("sha256", maneuverContextSecret())
    .update(payloadJson)
    .digest("base64url");
  return appendOpenNovelConfirmedManeuverContext(action, context, signature);
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

function maneuverContextSecret() {
  const configured = String(process.env.OPENOVEL_INTERNAL_TOKEN || "").trim();
  if (configured.length >= 24) return configured;
  if (process.env.NODE_ENV !== "production") {
    return "openovel-confirmed-maneuver-development-secret-v1";
  }
  throw new Error("OPENOVEL_INTERNAL_TOKEN_REQUIRED_FOR_MANEUVER_CONTEXT");
}

function unavailable(error: unknown) {
  return new ServiceUnavailableException({
    code: "OPENOVEL_RUNTIME_UNAVAILABLE",
    message: String((error as Error)?.message || error || "The story runtime is unavailable."),
  });
}
