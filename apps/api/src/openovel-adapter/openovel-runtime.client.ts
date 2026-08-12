import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, createHmac } from "node:crypto";
import {
  appendOpenNovelConfirmedManeuverContext,
  type OpenNovelConfirmedManeuverContextV1,
} from "@ai-story/shared";
import { PrismaService } from "../prisma.service";
import {
  compileConfirmedManeuverContext,
  hydrateOpenNovelManeuverStateFromEvents,
  markConfirmedManeuverContextConsumed,
  OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE,
  OPENOVEL_MANEUVER_RESULT_EVENT_TYPE,
} from "./openovel-maneuver-context";
import { ensureOpenNovelManeuverState } from "./openovel-maneuver";
import { openNovelManeuverPackages } from "./openovel-maneuver-packages";

export const OPENOVEL_ENGINE_VERSION = "openovel_v1";
export const OPENOVEL_RUNTIME_MODE = "OPENOVEL_V1";
export const OPENOVEL_PROJECTION_SCHEMA = "openovel_game_projection_v1";

export type OpenNovelVisibleOption = {
  id: string;
  label: string;
  key?: boolean;
};

export type OpenNovelNarrativeStatus =
  | "PENDING"
  | "GENERATING"
  | "VALIDATING"
  | "PUBLISHED"
  | "FALLBACK_PUBLISHED"
  | "FAILED_RETRYABLE";

export type OpenNovelAuthoritativeCommit = {
  schema: string;
  sourceCommitHash: string;
  artifactDirectory: string;
  previousSourceCommitHash: string | null;
  committedAt: string;
  turnId: string;
  turnNumber: number;
};

export type OpenNovelCommittedTurn = {
  runId: string;
  turnId: string;
  turnNumber: number;
  narration: string;
  options: OpenNovelVisibleOption[];
  framing: string;
  tension: string;
  storyComplete: boolean;
  committedAt: string;
  authoritativeResultStatus: "FINALIZED";
  narrativeStatus: OpenNovelNarrativeStatus;
  sourceCommitHash: string;
  artifactDirectory: string;
  authoritativeCommit: OpenNovelAuthoritativeCommit;
  [key: string]: unknown;
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

export type OpenNovelTurnEvent =
  | { type: "turn.committed"; data: OpenNovelCommittedTurn }
  | {
      type: "narration.delta" | "narration.complete" | "options.complete" | "runtime.warning";
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

    let committed: OpenNovelCommittedTurn | null = null;
    await readSse(response.body, async (event) => {
      if (event.type === "turn.committed") committed = event.data;
      await onEvent(event);
    });
    const committedTurn = committed as OpenNovelCommittedTurn | null;
    if (!committedTurn) {
      throw new ServiceUnavailableException({
        code: "OPENOVEL_TURN_NOT_COMMITTED",
        message: "The story runtime ended before committing the turn.",
      });
    }
    if (bridge?.context?.sourceResultIds?.length) {
      // Canon is already committed at this point. A transient mirror update
      // must not make the product report the main turn as failed. Persist a
      // private acknowledgement event with the state mirror so event-ledger
      // recovery cannot inject the same maneuver context a second time.
      await this.consumeConfirmedManeuverBridge(
        input.runId,
        Math.max(0, Number(committedTurn.turnNumber || input.expectedStateRevision || 0)),
        bridge.context.sourceResultIds,
      ).catch(() => undefined);
    }
    return committedTurn;
  }

  private async prepareConfirmedManeuverBridge(
    runId: string,
    turnNumberValue: unknown,
  ) {
    if (!this.prisma) return null;
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      select: { templateKey: true, stateJson: true, version: true },
    });
    if (!run) return null;
    const maneuverPackage = openNovelManeuverPackages.get(run.templateKey);
    if (!maneuverPackage) return null;
    const events = await this.prisma.storyEvent.findMany({
      where: {
        runId,
        type: {
          in: [
            OPENOVEL_MANEUVER_RESULT_EVENT_TYPE,
            OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE,
          ],
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { type: true, payloadJson: true },
    });
    const turnNumber = Math.max(0, Math.floor(Number(turnNumberValue) || 0));
    const hydrated = hydrateOpenNovelManeuverStateFromEvents({
      stateJson: run.stateJson,
      eventPayloads: events
        .filter((event) => event.type === OPENOVEL_MANEUVER_RESULT_EVENT_TYPE)
        .map((event) => event.payloadJson),
      consumptionPayloads: events
        .filter((event) => event.type === OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE)
        .map((event) => event.payloadJson),
      turnNumber,
      maneuverPackage,
    });
    if (hydrated.needsPersistence) {
      await this.prisma.storyRun.updateMany({
        where: { id: runId, version: run.version },
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
    const normalizedTurn = Math.max(0, Math.floor(turnNumber));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const run = await this.prisma.storyRun.findUnique({
        where: { id: runId },
        select: {
          templateKey: true,
          stateJson: true,
          version: true,
          currentDay: true,
          selectedRoleKey: true,
        },
      });
      if (!run) return;
      const maneuverPackage = openNovelManeuverPackages.get(run.templateKey);
      if (!maneuverPackage) return;
      const state = ensureOpenNovelManeuverState(
        run.stateJson,
        normalizedTurn,
        maneuverPackage,
      );
      const existingResultIds = new Set(state.results.map((result) => result.id));
      const pendingIds = [...new Set(resultIds)]
        .filter((id) => existingResultIds.has(id))
        .sort();
      if (!pendingIds.length) return;
      const stateJson = markConfirmedManeuverContextConsumed({
        stateJson: run.stateJson,
        turnNumber: normalizedTurn,
        maneuverPackage,
        resultIds: pendingIds,
      });
      const acknowledgementHash = createHash("sha256")
        .update(JSON.stringify({ runId, turnNumber: normalizedTurn, sourceResultIds: pendingIds }))
        .digest("hex")
        .slice(0, 24);
      const acknowledgementId = `ovl_maneuver_canon_${acknowledgementHash}`;
      const dedupeKey = `openovel-maneuver-canon:${runId}:${normalizedTurn}:${acknowledgementHash}`;

      try {
        const outcome = await this.prisma.$transaction(async (tx) => {
          const existing = await tx.storyEvent.findUnique({ where: { dedupeKey } });
          const updated = await tx.storyRun.updateMany({
            where: { id: runId, version: run.version },
            data: { stateJson: stateJson as any },
          });
          if (updated.count !== 1) return { retry: true as const };
          if (!existing) {
            await tx.storyEvent.create({
              data: {
                id: acknowledgementId,
                runId,
                day: Math.max(1, Number(run.currentDay || 1)),
                type: OPENOVEL_MANEUVER_CANON_CONSUMED_EVENT_TYPE,
                messageType: "system",
                roleKey: run.selectedRoleKey,
                visibility: "private_system",
                payloadJson: {
                  sourceResultIds: pendingIds,
                  turnNumber: normalizedTurn,
                } as any,
                dedupeKey,
              },
            });
          }
          return { retry: false as const };
        }, { maxWait: 10_000, timeout: 30_000 });
        if (!outcome.retry) return;
      } catch (error) {
        const existing = await this.prisma.storyEvent.findUnique({ where: { dedupeKey } });
        if (existing) {
          // The acknowledgement is authoritative. A later GET can repair a
          // stale stateJson mirror from it without reinjecting the context.
          return;
        }
        if (attempt === 2) throw error;
      }
    }
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
