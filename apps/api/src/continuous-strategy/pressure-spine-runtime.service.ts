import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  assertFrozenNodeResultIntegrity,
  assertPressureRootEventLedger,
  beginPrepareResolutionPhase,
  buildDefaultPressureAction,
  completePressureFinale,
  confirmCompiledPressureAction,
  confirmPressureActionIntent,
  initializePressureRuntime,
  loadPressureRuntimeContent,
  lockCommitPhase,
  lockPreparePhase,
  lockReactionPhase,
  openReactionOrSettlement,
  pressureActionRequestFingerprint,
  pressureRuntimeReplayHash,
  projectNextPressureNode,
  projectP0ToN1,
  recoverPressureRuntime,
  resolvePreparePhase,
  settlePressureNode,
  validatePressureActionIntent,
  type FrozenNodeResultV1,
  type PressureActionType,
  type PressureActionIntentCommandV1,
  type PressureActionPreview,
  type PressureRootEvent,
  type PressureRuntimeContent,
  type PressureRuntimeState,
  isPressureRootEventType,
} from "@ai-story/templates";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { PrismaService } from "../prisma.service";
import { sha256Canonical } from "./canonical";
import { ContinuousEventDeliveryService } from "./event-delivery.service";
import { roomSerializableTransaction } from "./room-transaction";
import { buildPressureGameProjection, classifyPressureFreeText } from "./pressure-spine-viewer";
import { RoleAgentTaskService, type PressureRoleAgentCandidate, type PressureRoleAgentInput } from "./role-agent-task.service";
import { PressureNarrativeRuntimeService } from "./pressure-narrative-runtime.service";

type Tx = Prisma.TransactionClient;

export const PRESSURE_SPINE_STRATEGY_VERSION = "sangtian_pressure_v1_0";
export const PRESSURE_RUNTIME_CHECKPOINT_SCHEMA = "pressure_runtime_checkpoint_v1" as const;
export const PRESSURE_RESOLUTION_OUTPUT_SCHEMA = "pressure_resolution_output_v1" as const;

const LEGACY_TO_PRESSURE_ROLE_KEY: Record<string, string> = {
  zhejiang_governor: "zhejiang_governor",
  xunfu: "zhejiang_administration",
  county_magistrate: "qingliu_law",
  merchant: "jiangnan_merchant",
  sili_jian: "sili_weaving",
  clerk: "cabinet_finance",
};

const PRESSURE_ROLE_DISPLAY: Record<string, string> = {
  zhejiang_governor: "浙江总督",
  zhejiang_administration: "浙江省府",
  qingliu_law: "清流法度",
  jiangnan_merchant: "江南商会",
  sili_weaving: "司礼监织造",
  cabinet_finance: "内阁财政",
};

type PressurePrologueAckCommand = {
  idempotencyKey: string;
  expectedRunVersion: number;
  expectedProjectionRevision: number;
};

export type PressureRuntimeCheckpointV1 = {
  schemaVersion: typeof PRESSURE_RUNTIME_CHECKPOINT_SCHEMA;
  state: PressureRuntimeState;
  stateHash: string;
  lastRootEventSequence: number;
  persistedAt: string;
};

export type PressureResolutionOutputV1 = {
  schemaVersion: typeof PRESSURE_RESOLUTION_OUTPUT_SCHEMA;
  inputStateHash: string;
  settledState: PressureRuntimeState;
  settledStateHash: string;
  frozenResult: FrozenNodeResultV1 | null;
  frozenResultHash: string | null;
};

export type PressureRuntimeFaultPoint =
  | "AFTER_ACTION_SEALED_COMMIT"
  | "AFTER_RULES_APPLIED_COMMIT"
  | "BEFORE_DOMAIN_TRANSACTION_COMMIT";

export type PressureRuntimeFaultInjector = (point: PressureRuntimeFaultPoint) => void | Promise<void>;

export type PressureConfirmPersistenceResult = {
  replayed: boolean;
  actionId: string;
  requestHash: string;
  stateHash: string;
  phase: PressureRuntimeState["phase"];
};

export type PressureResolutionPersistenceResult = {
  outcome: "WAITING" | "CHECKPOINTED" | "FROZEN" | "PROJECTED" | "FINALE_COMPUTING" | "COMPLETED";
  stateHash: string;
  frozenResultId: string | null;
  frozenResultHash: string | null;
  phase: PressureRuntimeState["phase"];
};

type PressureViewerPreviewCommand = {
  idempotencyKey: string;
  expectedRunVersion: number;
  expectedProjectionRevision: number;
  expectedNodeId: string;
  expectedPhase: "PREPARE" | "COMMIT" | "REACTION";
  expectedSeatId: string;
  input: {
    freeText: string;
    actionType?: string | null;
    targetIds?: string[];
    objectVersionIds?: string[];
    resourceCommitments?: Array<{ resourceId: string; amount: number }>;
    visibility?: string;
    condition?: unknown;
  };
};

type PressureViewerConfirmCommand = {
  idempotencyKey: string;
  previewToken: string;
  requestFingerprint: string;
  normalizedIntent: PressureActionIntentCommandV1;
  expectedRunVersion: number;
  expectedProjectionRevision: number;
  expectedNodeId: string;
  expectedPhase: "PREPARE" | "COMMIT" | "REACTION";
  expectedSeatId: string;
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

export function createPressureRuntimeCheckpoint(state: PressureRuntimeState, persistedAt = new Date(0).toISOString()): PressureRuntimeCheckpointV1 {
  assertPressureRootEventLedger(state.rootEvents);
  for (const frozen of state.frozenResults) assertFrozenNodeResultIntegrity(frozen);
  return {
    schemaVersion: PRESSURE_RUNTIME_CHECKPOINT_SCHEMA,
    state: deepClone(state),
    stateHash: pressureRuntimeReplayHash(state),
    lastRootEventSequence: state.rootEvents.at(-1)?.sequence || 0,
    persistedAt,
  };
}

export function assertPressureRuntimeCheckpoint(value: unknown): PressureRuntimeCheckpointV1 {
  const checkpoint = record(value) as PressureRuntimeCheckpointV1;
  if (checkpoint.schemaVersion !== PRESSURE_RUNTIME_CHECKPOINT_SCHEMA || !checkpoint.state || typeof checkpoint.stateHash !== "string") {
    throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: "Pressure runtime checkpoint is malformed" });
  }
  assertPressureRootEventLedger(checkpoint.state.rootEvents);
  for (const frozen of checkpoint.state.frozenResults) assertFrozenNodeResultIntegrity(frozen);
  const actual = pressureRuntimeReplayHash(checkpoint.state);
  if (actual !== checkpoint.stateHash) {
    throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: "Pressure runtime checkpoint hash mismatch" });
  }
  const sequence = checkpoint.state.rootEvents.at(-1)?.sequence || 0;
  if (sequence !== checkpoint.lastRootEventSequence) {
    throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: "Pressure runtime event cursor mismatch" });
  }
  return deepClone(checkpoint);
}

export function mergePressureCheckpointIntoStateJson(stateJson: unknown, checkpoint: PressureRuntimeCheckpointV1): Prisma.InputJsonValue {
  const root = record(stateJson);
  return {
    ...root,
    pressureRuntimeV1: checkpoint,
  } as Prisma.InputJsonValue;
}

function pressureCheckpointFromRun(run: { stateJson: unknown }): PressureRuntimeCheckpointV1 | null {
  const value = record(run.stateJson).pressureRuntimeV1;
  return value ? assertPressureRuntimeCheckpoint(value) : null;
}

function pressureResolutionOutput(value: unknown): PressureResolutionOutputV1 | null {
  const output = record(value) as PressureResolutionOutputV1;
  if (!output || output.schemaVersion !== PRESSURE_RESOLUTION_OUTPUT_SCHEMA) return null;
  assertPressureRootEventLedger(output.settledState.rootEvents);
  for (const frozen of output.settledState.frozenResults) assertFrozenNodeResultIntegrity(frozen);
  const actualStateHash = pressureRuntimeReplayHash(output.settledState);
  if (actualStateHash !== output.settledStateHash) {
    throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: "Resolution output state hash mismatch" });
  }
  if (output.frozenResult) {
    assertFrozenNodeResultIntegrity(output.frozenResult);
    if (output.frozenResult.contentHash !== output.frozenResultHash) {
      throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: "Resolution frozen hash mismatch" });
    }
  }
  return deepClone(output);
}

function changedRootEvents(previous: PressureRuntimeState, next: PressureRuntimeState): PressureRootEvent[] {
  const previousSequence = previous.rootEvents.at(-1)?.sequence || 0;
  const events = next.rootEvents.filter((event) => event.sequence > previousSequence);
  assertPressureRootEventLedger(events.length ? [...previous.rootEvents, ...events] : previous.rootEvents);
  return events;
}

function roleIdBySeatId(content: PressureRuntimeContent, roles: Array<{ id: string; roleKey: string }>): Record<string, string> {
  const roleByKey = new Map(roles.map((role) => [role.roleKey, role.id]));
  return Object.fromEntries(content.seatIds.map((seatId) => {
    const seat = content.nodes.N1.seats.find((entry) => entry.seatId === seatId)
      || content.nodes.P0.seats.find((entry) => entry.seatId === seatId);
    const roleId = seat ? roleByKey.get(seat.roleKey) : null;
    if (!roleId) throw new ConflictException({ code: "CONTINUOUS_ROLE_SET_INVALID", message: `No StoryRole row for ${seatId}` });
    return [seatId, roleId];
  }));
}

function actionSlotToLegacy(slot: PressureActionIntentCommandV1["slot"]): string {
  return slot === "PREPARE" ? "MAIN" : slot === "COMMIT" ? "MANEUVER" : "REACTION";
}

function participantPatch(slot: PressureActionIntentCommandV1["slot"]): Record<string, unknown> {
  if (slot === "PREPARE") return { mainStatus: "SUBMITTED", maneuverStatus: "AVAILABLE", version: { increment: 1 } };
  if (slot === "COMMIT") return { maneuverStatus: "SUBMITTED", maneuverUsedAt: new Date(), doneAt: new Date(), version: { increment: 1 } };
  return { reactionStatus: "RESPONDED", reactionUsedAt: new Date(), version: { increment: 1 } };
}

function safeActionJson(action: PressureRuntimeState["sealedActions"][string]): Prisma.InputJsonValue {
  return {
    schemaVersion: "pressure_persisted_action_v1",
    normalizedIntent: action.command.sourceIntent,
    compiledCommand: action.command,
    snapshotHash: action.snapshotHash,
    actionHash: sha256Canonical(action),
  } as Prisma.InputJsonValue;
}

@Injectable()
export class PressureSpineRuntimeService {
  private readonly contentCache = new Map<string, PressureRuntimeContent>();
  private faultInjector: PressureRuntimeFaultInjector | null = null;
  private nowProvider: () => number = () => Date.now();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousEventDeliveryService) private readonly deliveries: ContinuousEventDeliveryService,
    @Inject(RoleAgentTaskService) private readonly roleAgents: RoleAgentTaskService = null as never,
    @Inject(PressureNarrativeRuntimeService) private readonly pressureNarrative: PressureNarrativeRuntimeService = null as never,
  ) {}

  setFaultInjectorForTest(injector: PressureRuntimeFaultInjector | null): void {
    this.faultInjector = injector;
  }

  setNowProviderForTest(provider: (() => number) | null): void {
    this.nowProvider = provider || (() => Date.now());
  }

  supportsStrategy(strategyVersion: string): boolean {
    return strategyVersion === PRESSURE_SPINE_STRATEGY_VERSION;
  }

  async supportsWindow(windowId: string): Promise<boolean> {
    const window = await this.prisma.actionWindow.findUnique({
      where: { id: windowId },
      select: { run: { select: { strategyVersion: true } } },
    });
    return Boolean(window && this.supportsStrategy(window.run.strategyVersion));
  }

  async startRun(user: AuthenticatedUser, roomId: string) {
    await roomSerializableTransaction(this.prisma, roomId, async (tx) => {
      const run = await tx.storyRun.findUnique({
        where: { id: roomId },
        include: { roles: true, players: { where: { status: "active" } }, roleControls: true },
      });
      if (!run || run.mode !== "room") throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      if (!this.supportsStrategy(run.strategyVersion)) throw new ConflictException({ code: "PRESSURE_RUNTIME_REQUIRED", message: "Run does not use the pressure runtime" });
      if (run.ownerUserId !== user.id) throw new ForbiddenException({ code: "HOST_REQUIRED", message: "Only the host can start this run" });
      if (!["waiting_players", "playing"].includes(run.status)) throw new ConflictException({ code: "ROOM_NOT_WAITING", message: "Run cannot be started from its current state" });

      const content = this.content(run.strategyVersion);
      await this.ensurePressureRoleKeys(tx, run.id, content);
      const roles = await tx.storyRole.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } });
      const players = await tx.storyPlayer.findMany({ where: { runId: run.id, status: "active" } });
      const roleMap = roleIdBySeatId(content, roles);
      const now = new Date(this.nowProvider());

      for (const seatId of content.seatIds) {
        const roleId = roleMap[seatId]!;
        const human = players.find((player) => player.roleId === roleId && player.userId);
        if (!human) {
          await tx.storyPlayer.upsert({
            where: { runId_roleId: { runId: run.id, roleId } },
            update: { userId: null, playerType: "ai", status: "active", lastActiveAt: now },
            create: { runId: run.id, roleId, userId: null, playerType: "ai", status: "active", lastActiveAt: now },
          });
        }
        await tx.storyRole.update({
          where: { id: roleId },
          data: { isAiControlled: !human, status: human ? "claimed" : "ai_controlled" },
        });
        await tx.roleControl.upsert({
          where: { runId_roleId: { runId: run.id, roleId } },
          update: {
            humanPlayerId: human?.id || null,
            mode: human ? "HUMAN_ACTIVE" : "AI_ACTIVE",
            reason: human ? "PRESSURE_RUN_STARTED" : "PRESSURE_AI_SEAT",
            takeoverAt: human ? null : now,
          },
          create: {
            runId: run.id, roleId, humanPlayerId: human?.id || null,
            mode: human ? "HUMAN_ACTIVE" : "AI_ACTIVE", epoch: 1,
            lastHeartbeatAt: human ? now : null, takeoverAt: human ? null : now,
            reason: human ? "PRESSURE_RUN_STARTED" : "PRESSURE_AI_SEAT",
          },
        });
      }

      let p0Node = await tx.sceneNode.findFirst({ where: { runId: run.id, chapterIndex: 1, nodeIndex: 0 } });
      if (!p0Node) {
        p0Node = await tx.sceneNode.create({
          data: {
            runId: run.id, chapterIndex: 1, nodeIndex: 0, title: content.nodes.P0.title,
            publicNarration: "Viewer-safe P0 projection",
            nodeGoal: "Acknowledge the immutable prologue before N1 opens",
            status: "prologue", actionOptionsJson: [] as Prisma.InputJsonValue,
          },
        });
      }

      let checkpoint = pressureCheckpointFromRun(run);
      if (!checkpoint) {
        checkpoint = createPressureRuntimeCheckpoint(initializePressureRuntime(content, {
          runId: run.id,
          runSeed: sha256Canonical({ runId: run.id, packageSha256: content.packageSha256 }),
          nowEpochMs: this.nowProvider(),
        }), now.toISOString());
      }
      const stateJson = record(run.stateJson);
      await tx.storyRun.update({
        where: { id: run.id },
        data: {
          status: "playing", currentDay: checkpoint.state.phase === "P0_PROJECTING" ? 0 : Math.max(1, checkpoint.state.nodeSequence),
          currentNodeId: checkpoint.state.phase === "P0_PROJECTING" ? p0Node.id : run.currentNodeId,
          activeHumanCount: players.filter((player) => player.userId).length,
          aiPlayerCount: content.seatIds.length - players.filter((player) => player.userId).length,
          stateJson: { ...stateJson, pressureRuntimeV1: checkpoint, pressurePrologueAckV1: stateJson.pressurePrologueAckV1 || null } as Prisma.InputJsonValue,
          version: { increment: run.status === "playing" ? 0 : 1 },
        },
      });
      await this.ensurePersistedRootEventMirror(
        tx, checkpoint.state, players.map((player) => player.userId).filter((value): value is string => Boolean(value)), roleMap,
      );
    });
    return { gameProjection: await this.gameProjection(user, roomId) };
  }

  async acknowledgePrologue(user: AuthenticatedUser, roomId: string, rawCommand: unknown) {
    const command = record(rawCommand) as PressurePrologueAckCommand;
    const idempotencyKey = String(command.idempotencyKey || "").trim();
    if (!idempotencyKey) throw new BadRequestException({ code: "ACTION_SCHEMA_INVALID", message: "idempotencyKey is required" });
    await roomSerializableTransaction(this.prisma, roomId, async (tx) => {
      const run = await tx.storyRun.findUnique({
        where: { id: roomId },
        include: { roles: true, players: { where: { status: "active" } }, roleControls: true },
      });
      if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      if (!this.supportsStrategy(run.strategyVersion)) throw new ConflictException({ code: "PRESSURE_RUNTIME_REQUIRED", message: "Run does not use the pressure runtime" });
      const membership = run.players.find((player) => player.userId === user.id && player.roleId);
      if (!membership) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "A playable seat is required" });
      const stateJson = record(run.stateJson);
      const existing = record(stateJson.pressurePrologueAckV1);
      // P0 is a room-wide, once-only projection boundary. After it has been
      // acknowledged, retries from the same tab, another tab, or a recovered
      // client return the already-projected state instead of attempting a
      // second P0 -> N1 transition. The original key remains audit metadata;
      // it is not reused to authorize any world action.
      if (existing.acknowledgedAt || existing.idempotencyKey) return;
      const content = this.content(run.strategyVersion);
      const checkpoint = await this.loadOrRebuildCheckpoint(tx, run, content);
      if (checkpoint.state.phase !== "P0_PROJECTING") return;
      if (Number(command.expectedRunVersion) !== run.version || Number(command.expectedProjectionRevision) !== run.version) {
        throw new ConflictException({ code: "RUN_VERSION_CONFLICT", message: "Prologue projection changed; refresh before continuing" });
      }
      const nowEpochMs = this.nowProvider();
      const projected = projectP0ToN1(content, checkpoint.state, nowEpochMs, nowEpochMs + 600_000).state;
      const roles = run.roles;
      const roleMap = roleIdBySeatId(content, roles);
      const node = await this.ensurePressureWindow(tx, run, projected, content);
      const nextCheckpoint = createPressureRuntimeCheckpoint(projected, new Date(nowEpochMs).toISOString());
      const updatedStateJson = {
        ...stateJson,
        pressureRuntimeV1: nextCheckpoint,
        pressurePrologueAckV1: {
          idempotencyKey, viewerRoleId: membership.roleId, acknowledgedAt: new Date(nowEpochMs).toISOString(),
          frozenResultId: projected.frozenResults.find((item) => item.nodeId === "P0")?.frozenResultId || null,
        },
      } as Prisma.InputJsonValue;
      const updated = await tx.storyRun.updateMany({
        where: { id: run.id, version: run.version },
        data: { status: "playing", currentDay: 1, currentNodeId: node.id, stateJson: updatedStateJson, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException({ code: "RUN_VERSION_CONFLICT", message: "Run changed while acknowledging P0" });
      await tx.sceneNode.updateMany({
        where: { runId: run.id, nodeIndex: 0, status: "prologue" },
        data: { status: "resolved", resolvedAt: new Date(nowEpochMs) },
      });
      await this.ensurePersistedRootEventMirror(
        tx, projected, run.players.map((player) => player.userId).filter((value): value is string => Boolean(value)), roleMap,
      );
    });
    return { accepted: true, gameProjection: await this.gameProjection(user, roomId) };
  }

  async gameProjection(user: AuthenticatedUser, roomId: string) {
    const context = await this.viewerContext(user, roomId);
    const viewerRoleId = roleIdBySeatId(context.content, context.run.roles)[context.viewerSeatId];
    const latestWindow = await this.prisma.actionWindow.findFirst({
      where: { runId: roomId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const [latestNarrative, decisions, narrativeTask] = await Promise.all([
      viewerRoleId ? this.prisma.narrativeEntry.findFirst({
        where: {
          runId: roomId,
          roleId: viewerRoleId,
          entryType: { in: ["pressure_scene", "pressure_finale_scene"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, content: true, threadKeysJson: true, sourceEventIdsJson: true, createdAt: true },
      }) : Promise.resolve(null),
      latestWindow ? this.prisma.roleAgentDecision.findMany({
        where: { runId: roomId, windowId: latestWindow.id },
        select: { status: true, provider: true, modelName: true, lastError: true },
      }) : Promise.resolve([]),
      this.prisma.aiTask.findFirst({
        where: { runId: roomId, taskType: "PRESSURE_NARRATIVE" },
        orderBy: { createdAt: "desc" },
        select: { status: true, provider: true, modelName: true, errorMessage: true },
      }),
    ]);
    const aiCounts = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const decision of decisions) {
      const status = String(decision.status || "").toUpperCase();
      if (status === "PENDING") aiCounts.pending += 1;
      else if (["RUNNING", "LEASED"].includes(status)) aiCounts.running += 1;
      else if (["SEALED_ACT", "SEALED_FALLBACK", "PASS"].includes(status)) aiCounts.completed += 1;
      else aiCounts.failed += 1;
    }
    const narrativeMeta = record(latestNarrative?.threadKeysJson);
    const narrativeStatus = String(narrativeTask?.status || "").toLowerCase() === "running"
      ? "GENERATING"
      : latestNarrative
        ? String(narrativeMeta.source || "MODEL") === "AUTHORED_FALLBACK" ? "AUTHORED_FALLBACK" : "MODEL"
        : narrativeTask?.errorMessage ? "FAILED" : "IDLE";
    return buildPressureGameProjection({
      run: context.run,
      state: context.checkpoint.state,
      content: context.content,
      viewerSeatId: context.viewerSeatId,
      latestNarrative,
      liveGeneration: {
        aiSeats: aiCounts,
        narrative: { status: narrativeStatus as any, source: latestNarrative ? String(narrativeMeta.source || "MODEL") : null },
      },
    });
  }

  async resultProjection(user: AuthenticatedUser, roomId: string) {
    const projection = await this.gameProjection(user, roomId) as Record<string, unknown>;
    const run = record(projection.run);
    if (run.phase !== "COMPLETED") {
      throw new ConflictException({ code: "RESULT_NOT_READY", message: "The result is available after N7 is frozen" });
    }
    return { ...projection, completed: true };
  }

  async previewViewerAction(user: AuthenticatedUser, roomId: string, rawCommand: unknown) {
    const command = record(rawCommand) as PressureViewerPreviewCommand;
    const context = await this.viewerContext(user, roomId);
    this.assertViewerGuards(command, context, false);
    const intent = this.compileViewerIntent(command, context);
    this.assertServerDeadline(context.checkpoint.state, this.nowProvider());
    const preview = validatePressureActionIntent(context.content, context.checkpoint.state, intent);
    const timeCost = intent.type === "REST" || intent.type === "DELAY" ? 360 : 60;
    const opportunityCost = intent.type === "REST" || intent.type === "DELAY" ? 1 : 0;
    return {
      previewId: sha256Canonical({ roomId, seatId: context.viewerSeatId, fingerprint: preview.actionFingerprint }).slice(0, 32),
      previewToken: preview.previewToken,
      requestFingerprint: preview.actionFingerprint,
      normalizedIntent: preview.normalizedIntent,
      compiledAction: {
        actionType: preview.normalizedIntent.type,
        slot: preview.normalizedIntent.slot,
        intentText: preview.normalizedIntent.intentText,
      },
      validation: preview.accepted
        ? opportunityCost > 0 ? "ACCEPT_WITH_COST" : "ACCEPT"
        : "REJECT_NO_SIDE_EFFECT",
      validationCode: preview.errorCode,
      validationMessage: preview.safeMessage,
      timeCost,
      opportunityCost,
      expiresAt: new Date(context.checkpoint.state.phaseDeadlineEpochMs || this.nowProvider() + 600_000).toISOString(),
      currentProjectionRevision: context.run.version,
    };
  }

  async confirmViewerAction(user: AuthenticatedUser, roomId: string, rawCommand: unknown) {
    const command = record(rawCommand) as PressureViewerConfirmCommand;
    const context = await this.viewerContext(user, roomId);
    this.assertViewerGuards(command, context, true);
    const intent = record(command.normalizedIntent) as PressureActionIntentCommandV1;
    if (!intent || pressureActionRequestFingerprint(intent) !== String(command.requestFingerprint || "")) {
      throw new ConflictException({ code: "PREVIEW_TAMPERED", message: "Confirmed action no longer matches its preview" });
    }
    const result = await this.confirm(user, roomId, intent, String(command.previewToken || ""));
    await this.advanceSinglePlayerWorld(roomId, intent.slot, intent.nodeId, intent.seatId);
    return {
      accepted: true,
      replayed: result.replayed,
      actionId: result.actionId,
      projection: await this.gameProjection(user, roomId),
    };
  }

  private content(strategyVersion = PRESSURE_SPINE_STRATEGY_VERSION): PressureRuntimeContent {
    let content = this.contentCache.get(strategyVersion);
    if (!content) {
      const registryPath = path.resolve(process.cwd(), "packages/templates/config/sangtian/strategy-registry.json");
      content = loadPressureRuntimeContent(registryPath, strategyVersion);
      this.contentCache.set(strategyVersion, content);
    }
    return content;
  }

  private async viewerContext(user: AuthenticatedUser, roomId: string): Promise<{
    run: any;
    content: PressureRuntimeContent;
    checkpoint: PressureRuntimeCheckpointV1;
    viewerSeatId: string;
  }> {
    const load = () => this.prisma.storyRun.findUnique({
      where: { id: roomId },
      include: {
        roles: true,
        players: { where: { status: "active" } },
        roleControls: true,
      },
    });
    let run = await load();
    if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (!this.supportsStrategy(run.strategyVersion)) throw new ConflictException({ code: "PRESSURE_RUNTIME_REQUIRED", message: "Run does not use the pressure runtime" });
    const content = this.content(run.strategyVersion);
    if (!pressureCheckpointFromRun(run)) {
      await roomSerializableTransaction(this.prisma, roomId, async (tx) => {
        const current = await tx.storyRun.findUnique({ where: { id: roomId }, include: { roles: true, players: { where: { status: "active" } } } });
        if (!current || pressureCheckpointFromRun(current)) return;
        const checkpoint = await this.loadOrRebuildCheckpoint(tx, current, content);
        await tx.storyRun.update({
          where: { id: roomId },
          data: { stateJson: mergePressureCheckpointIntoStateJson(current.stateJson, checkpoint), version: { increment: 1 } },
        });
      });
      run = await load();
      if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    }
    const checkpoint = await this.loadOrRebuildCheckpoint(this.prisma as any, run as any, content);
    const membership = run.players.find((player: any) => player.userId === user.id && player.roleId);
    const role = run.roles.find((entry: any) => entry.id === membership?.roleId);
    const seat = Object.values(content.nodes)
      .flatMap((node) => node.seats)
      .find((entry) => entry.roleKey === role?.roleKey);
    if (!membership || !role || !seat) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "User does not control a pressure seat" });
    return { run, content, checkpoint, viewerSeatId: seat.seatId };
  }

  private assertViewerGuards(
    command: Partial<PressureViewerPreviewCommand & PressureViewerConfirmCommand>,
    context: { run: any; checkpoint: PressureRuntimeCheckpointV1; viewerSeatId: string },
    requireNormalizedIntent: boolean,
  ): void {
    const state = context.checkpoint.state;
    const phaseByRuntime: Partial<Record<PressureRuntimeState["phase"], "PREPARE" | "COMMIT" | "REACTION">> = {
      PREPARE_OPEN: "PREPARE",
      COMMIT_OPEN: "COMMIT",
      REACTION_OPEN: "REACTION",
    };
    const expectedPhase = phaseByRuntime[state.phase];
    if (!expectedPhase) throw new ConflictException({ code: "ACTION_WINDOW_CLOSED", message: `Pressure phase ${state.phase} does not accept player actions` });
    if (
      Number(command.expectedRunVersion) !== Number(context.run.version)
      || Number(command.expectedProjectionRevision) !== Number(context.run.version)
      || command.expectedNodeId !== state.nodeId
      || command.expectedPhase !== expectedPhase
      || command.expectedSeatId !== context.viewerSeatId
    ) {
      throw new ConflictException({ code: "RUN_VERSION_CONFLICT", message: "Viewer projection changed; refresh before submitting" });
    }
    if (!String(command.idempotencyKey || "").trim()) throw new BadRequestException({ code: "ACTION_SCHEMA_INVALID", message: "idempotencyKey is required" });
    if (requireNormalizedIntent && !record(command.normalizedIntent).schemaVersion) {
      throw new BadRequestException({ code: "PREVIEW_REQUIRED", message: "A server-normalized preview intent is required" });
    }
  }

  private compileViewerIntent(
    command: PressureViewerPreviewCommand,
    context: { run: any; checkpoint: PressureRuntimeCheckpointV1; viewerSeatId: string; content: PressureRuntimeContent },
  ): PressureActionIntentCommandV1 {
    const state = context.checkpoint.state;
    const input = record(command.input);
    const freeText = String(input.freeText || "").trim();
    if (!freeText) throw new BadRequestException({ code: "FREE_TEXT_UNPARSEABLE", message: "Action text is required" });
    let type = classifyPressureFreeText(freeText);
    if (command.expectedPhase === "REACTION" && type !== "PASS" && !state.reactionWindow?.allowedActionTypes.includes(type as any)) type = "PASS";
    const seat = state.seats[context.viewerSeatId];
    return {
      schemaVersion: "pressure_action_intent_v1",
      runId: state.runId,
      nodeId: state.nodeId,
      slot: command.expectedPhase,
      seatId: context.viewerSeatId,
      currentActorId: seat.currentActorId,
      controlEpoch: seat.controlEpoch,
      type: type as PressureActionType,
      intentText: freeText.slice(0, 600),
      targetObjectId: null,
      expectedObjectVersionId: null,
      resourceCommitments: [],
      parameters: {},
      visibility: "PUBLIC",
      submittedAtEpochMs: this.nowProvider(),
      expectedRunVersion: state.phaseSnapshotVersion,
      expectedSnapshotHash: state.inputSnapshotHash,
      idempotencyKey: String(command.idempotencyKey),
    };
  }

  private async advanceSinglePlayerWorld(
    roomId: string,
    submittedSlot: PressureActionIntentCommandV1["slot"],
    submittedNodeId: string,
    viewerSeatId: string,
  ): Promise<void> {
    const activeHumans = await this.prisma.storyPlayer.count({ where: { runId: roomId, status: "active", userId: { not: null } } });
    if (activeHumans !== 1) return;

    await this.resolveAiSeatsForCurrentSlot(roomId);
    const latest = await this.prisma.actionWindow.findFirst({ where: { runId: roomId }, orderBy: { createdAt: "desc" } });
    if (!latest) return;
    await this.advanceWindow(latest.id, new Date(this.nowProvider()));

    let run = await this.prisma.storyRun.findUnique({ where: { id: roomId }, include: { roles: true, players: { where: { status: "active" } } } });
    if (!run) return;
    const content = this.content(run.strategyVersion);
    let checkpoint = await this.loadOrRebuildCheckpoint(this.prisma as any, run as any, content);

    if (submittedSlot === "PREPARE" && checkpoint.state.phase === "COMMIT_OPEN") {
      await this.pressureNarrative.publish({ runId: roomId, state: checkpoint.state, content, generationKind: "AFTER_PREPARE" });
      return;
    }

    for (let guard = 0; guard < 8; guard += 1) {
      if (checkpoint.state.nodeId !== submittedNodeId || ["FINALE_COMPUTING", "COMPLETED"].includes(checkpoint.state.phase)) {
        if (["FINALE_COMPUTING", "COMPLETED"].includes(checkpoint.state.phase)) {
          await this.pressureNarrative.publish({ runId: roomId, state: checkpoint.state, content, generationKind: "FINALE" });
        }
        return;
      }
      if (checkpoint.state.phase === "REACTION_OPEN") {
        await this.resolveAiSeatsForCurrentSlot(roomId);
        run = await this.prisma.storyRun.findUnique({ where: { id: roomId }, include: { roles: true, players: { where: { status: "active" } } } });
        if (!run) return;
        checkpoint = await this.loadOrRebuildCheckpoint(this.prisma as any, run as any, content);
        if (checkpoint.state.reactionWindow?.eligibleSeatIds.includes(viewerSeatId)
          && !checkpoint.state.actionIdBySeatSlot[`${checkpoint.state.nodeId}:${viewerSeatId}:REACTION`]) return;
        await this.advanceWindow(latest.id, new Date(this.nowProvider()));
      }
      run = await this.prisma.storyRun.findUnique({ where: { id: roomId }, include: { roles: true, players: { where: { status: "active" } } } });
      if (!run) return;
      checkpoint = await this.loadOrRebuildCheckpoint(this.prisma as any, run as any, content);
      if (["SETTLING", "FROZEN", "PROJECTING"].includes(checkpoint.state.phase)) {
        const outcome = await this.resolveWindow(latest.id);
        const refreshed = await this.prisma.storyRun.findUnique({ where: { id: roomId }, include: { roles: true, players: { where: { status: "active" } } } });
        if (!refreshed) return;
        const settledCheckpoint = await this.loadOrRebuildCheckpoint(this.prisma as any, refreshed as any, content);
        await this.pressureNarrative.publish({ runId: roomId, state: settledCheckpoint.state, content, generationKind: settledCheckpoint.state.phase === "COMPLETED" ? "FINALE" : "AFTER_SETTLEMENT" });
        if (["PROJECTED", "FINALE_COMPUTING", "COMPLETED"].includes(outcome.outcome)) return;
      } else {
        return;
      }
    }
  }

  private async resolveAiSeatsForCurrentSlot(roomId: string): Promise<void> {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: roomId },
      include: {
        roles: true, players: { where: { status: "active" } }, roleControls: true,
        actionWindows: { orderBy: { createdAt: "desc" }, take: 1, include: { participants: true } },
      },
    });
    if (!run || !run.actionWindows[0] || !this.supportsStrategy(run.strategyVersion)) return;
    const content = this.content(run.strategyVersion);
    const checkpoint = await this.loadOrRebuildCheckpoint(this.prisma as any, run as any, content);
    const slot = checkpoint.state.phase === "PREPARE_OPEN" ? "PREPARE"
      : checkpoint.state.phase === "COMMIT_OPEN" ? "COMMIT"
        : checkpoint.state.phase === "REACTION_OPEN" ? "REACTION" : null;
    if (!slot) return;
    const roleMap = roleIdBySeatId(content, run.roles);
    const controlByRoleId = new Map(run.roleControls.map((control) => [control.roleId, control]));
    const roleById = new Map(run.roles.map((role) => [role.id, role]));
    const pendingSeatIds = content.seatIds.filter((seatId) => {
      const roleId = roleMap[seatId]!;
      const control = controlByRoleId.get(roleId);
      const eligible = slot !== "REACTION" || checkpoint.state.reactionWindow?.eligibleSeatIds.includes(seatId);
      return control?.mode === "AI_ACTIVE" && eligible && !checkpoint.state.actionIdBySeatSlot[`${checkpoint.state.nodeId}:${seatId}:${slot}`];
    });
    if (!pendingSeatIds.length) return;

    const candidatesBySeat = new Map<string, PressureRoleAgentCandidate[]>();
    const inputs: PressureRoleAgentInput[] = [];
    for (const seatId of pendingSeatIds) {
      const candidates = this.buildAiCandidates(content, checkpoint.state, seatId, slot);
      if (!candidates.length) continue;
      candidatesBySeat.set(seatId, candidates);
      const roleId = roleMap[seatId]!;
      const role = roleById.get(roleId)!;
      const seat = content.nodes[checkpoint.state.nodeId].seats.find((entry) => entry.seatId === seatId)!;
      const visibleObjects = Object.values(checkpoint.state.objects)
        .filter((object) => ["PUBLIC", "OBSERVABLE"].includes(object.visibility) || object.knownBySeatIds.includes(seatId) || object.custodySeatId === seatId)
        .map((object) => ({ objectId: object.objectId, versionId: object.versionId, status: object.status, custodySeatId: object.custodySeatId }));
      inputs.push({
        runId: roomId, windowId: run.actionWindows[0].id, nodeId: checkpoint.state.nodeId, slot, roleId, roleKey: role.roleKey, seatId,
        currentActorId: checkpoint.state.seats[seatId].currentActorId, controlEpoch: checkpoint.state.seats[seatId].controlEpoch,
        snapshotHash: checkpoint.state.inputSnapshotHash,
        policyVersion: `pressure:${content.packageVersion}:${checkpoint.state.nodeId}:${seatId}:${slot}:v1`,
        viewerSafeContext: {
          institutionalMission: seat.institutionalMission,
          privatePressure: seat.privatePressure,
          misbeliefs: [...seat.misbeliefs],
          ruleHint: seat.ruleHint,
          dialogueSeeds: seat.dialogueSeeds.map((seed) => ({
            dialogueSeedId: seed.dialogueSeedId,
            text: seed.text,
            purpose: seed.purpose,
            applicableObjectIds: [...seed.applicableObjectIds],
          })),
          authoredPolicy: slot === "PREPARE" ? seat.defaultPrepare : seat.defaultCommit,
          knownFactIds: [...checkpoint.state.seats[seatId].knownFactIds],
          permissions: [...checkpoint.state.seats[seatId].permissions],
          resources: { ...checkpoint.state.seats[seatId].resourceBalances },
          visibleObjects, pressureLevel: checkpoint.state.pressureLevel, worldTimeMinutes: checkpoint.state.worldTimeMinutes,
          deadlineEpochMs: checkpoint.state.phaseDeadlineEpochMs,
        },
        candidates, authoredDefaultCandidateId: candidates[0]!.candidateId,
      });
    }
    if (!inputs.length) return;
    const selections = await this.roleAgents.decidePressureBatch(inputs);

    await roomSerializableTransaction(this.prisma, roomId, async (tx) => {
      const currentRun = await tx.storyRun.findUnique({
        where: { id: roomId },
        include: { roles: true, players: { where: { status: "active" } }, roleControls: true, actionWindows: { orderBy: { createdAt: "desc" }, take: 1, include: { participants: true } } },
      });
      if (!currentRun || !currentRun.actionWindows[0]) return;
      const current = await this.loadOrRebuildCheckpoint(tx, currentRun, content);
      if (current.state.inputSnapshotHash !== checkpoint.state.inputSnapshotHash || current.state.phase !== checkpoint.state.phase) return;
      let state = current.state;
      const roleIds = roleIdBySeatId(content, currentRun.roles);
      const node = await tx.sceneNode.findFirst({ where: { runId: roomId, nodeIndex: state.nodeSequence } });
      if (!node || currentRun.actionWindows[0].nodeId !== node.id) throw new ConflictException({ code: "ACTION_WINDOW_NOT_READY", message: "Pressure AI window moved" });

      for (const selection of [...selections].sort((left, right) => left.seatId.localeCompare(right.seatId))) {
        if (state.actionIdBySeatSlot[`${state.nodeId}:${selection.seatId}:${slot}`]) continue;
        const candidates = candidatesBySeat.get(selection.seatId) || [];
        let effectiveSelection = selection;
        let confirmed;
        if (effectiveSelection.fallback) {
          const defaultCommand = buildDefaultPressureAction(content, state, effectiveSelection.seatId, slot, this.nowProvider());
          confirmed = confirmCompiledPressureAction(content, state, defaultCommand);
        } else {
          const candidate = candidates.find((entry) => entry.candidateId === effectiveSelection.candidateId);
          const preview = candidate ? validatePressureActionIntent(content, state, candidate.normalizedIntent) : null;
          if (!preview?.accepted) {
            const defaultCommand = buildDefaultPressureAction(content, state, effectiveSelection.seatId, slot, this.nowProvider());
            confirmed = confirmCompiledPressureAction(content, state, defaultCommand);
            effectiveSelection = {
              ...selection,
              candidateId: candidates[0]?.candidateId || effectiveSelection.candidateId,
              provider: effectiveSelection.provider || "rules",
              modelName: effectiveSelection.modelName || "authored-default-v1",
              fallback: true,
              fallbackReason: preview?.errorCode || "ROLE_AGENT_SELECTION_FAILED_SERVER_REVALIDATION",
              rationale: "The provider choice failed authoritative validation; the authored default policy was applied.",
            };
          } else {
            confirmed = confirmPressureActionIntent(content, state, preview.normalizedIntent, preview.previewToken);
          }
        }
        const action = confirmed.action;
        state = confirmed.state;
        const roleId = roleIds[effectiveSelection.seatId]!;
        const projectionInput = inputs.find((entry) => entry.seatId === effectiveSelection.seatId)!;
        const projectionPayload = projectionInput.viewerSafeContext;
        const projection = await tx.roleAgentProjection.upsert({
          where: { windowId_roleId_actionSlot_controlEpoch: { windowId: currentRun.actionWindows[0].id, roleId, actionSlot: slot, controlEpoch: action.command.controlEpoch } },
          update: {},
          create: {
            runId: roomId, windowId: currentRun.actionWindows[0].id, roleId, actionSlot: slot, controlEpoch: action.command.controlEpoch,
            policyVersion: projectionInput.policyVersion, openingSnapshotVersion: state.phaseSnapshotVersion,
            projectionJson: projectionPayload as Prisma.InputJsonValue, contentHash: sha256Canonical(projectionPayload),
          },
        });
        const taskDedupeKey = `PRESSURE_ROLE_AGENT:${currentRun.actionWindows[0].id}:${roleId}:${slot}:${action.command.controlEpoch}`;
        const playerAction = await tx.playerAction.upsert({
          where: { idempotencyKey: action.command.idempotencyKey },
          update: {},
          create: {
            id: action.command.actionId, runId: roomId, nodeId: node.id, chapterIndex: node.chapterIndex, roleId, playerType: "ai",
            actionType: "pressure_action", targetType: action.command.targetObjectId ? "object" : "pressure", targetId: action.command.targetObjectId,
            targetText: action.command.targetObjectId, method: action.command.intentText, intent: action.command.intentText, riskLevel: "normal",
            normalizedJson: { actionId: action.command.actionId, publicIntent: action.command.sourceIntent, compiled: safeActionJson(action) } as Prisma.InputJsonValue,
            guardStatus: "ok", auditStatus: "ok", status: "accepted", actionSlot: actionSlotToLegacy(slot),
            actorKind: effectiveSelection.fallback ? "TIMEOUT_FALLBACK" : "AI_TAKEOVER", controlEpoch: action.command.controlEpoch,
            policyVersion: projectionInput.policyVersion, provider: effectiveSelection.provider, modelName: effectiveSelection.modelName, actionKey: action.command.type,
            idempotencyKey: action.command.idempotencyKey, requestHash: pressureActionRequestFingerprint(action.command.sourceIntent),
            visibility: action.command.visibility, sealedAt: new Date(action.sealedAt),
            immediateJson: { schemaVersion: "pressure_action_receipt_v1", actionId: action.command.actionId, provider: effectiveSelection.provider, modelName: effectiveSelection.modelName, fallback: effectiveSelection.fallback, fallbackReason: effectiveSelection.fallbackReason } as Prisma.InputJsonValue,
          },
        });
        const decision = await tx.roleAgentDecision.upsert({
          where: { taskDedupeKey },
          update: {},
          create: {
            runId: roomId, windowId: currentRun.actionWindows[0].id, roleId, actionSlot: slot, controlEpoch: action.command.controlEpoch,
            policyVersion: projectionInput.policyVersion, openingSnapshotVersion: state.phaseSnapshotVersion, taskDedupeKey, projectionId: projection.id,
            status: effectiveSelection.fallback ? "SEALED_FALLBACK" : "SEALED_ACT", visibleFactIdsJson: (projectionPayload as any).knownFactIds || [],
            chosenActionKey: action.command.type, shortRationale: effectiveSelection.rationale, provider: effectiveSelection.provider, modelName: effectiveSelection.modelName,
            providerAttempts: effectiveSelection.attempts, providerResponseHash: effectiveSelection.responseHash,
            guardDecisionJson: {
              status: "ok", fallback: effectiveSelection.fallback, providerCandidateId: effectiveSelection.candidateId,
              providerRequestId: effectiveSelection.providerRequestId,
            } as Prisma.InputJsonValue, playerActionId: playerAction.id,
            lastError: effectiveSelection.fallbackReason, startedAt: new Date(), completedAt: new Date(),
          },
        });
        await tx.actionWindowParticipant.update({
          where: { windowId_roleId: { windowId: currentRun.actionWindows[0].id, roleId } },
          data: participantPatch(slot),
        });
        const contextSnapshot = await tx.storyContextSnapshotV2.create({
          data: {
            runId: roomId, roleId, actorTurnId: null, purpose: "PRESSURE_ROLE_AGENT", baseWorldSequence: state.rootEvents.at(-1)?.sequence || 0,
            turnRevision: state.version, controlEpoch: action.command.controlEpoch, contextVersion: "pressure-role-agent-v1",
            snapshotJson: projectionPayload as Prisma.InputJsonValue, reportJson: { viewerSafe: true, snapshotHash: checkpoint.state.inputSnapshotHash } as Prisma.InputJsonValue,
            snapshotHash: sha256Canonical(projectionPayload), status: "READY",
          },
        });
        const executionId = randomUUID();
        await tx.promptExecutionRecord.create({
          data: {
            id: executionId, runId: roomId, roleId, actorTurnId: null, actionResolutionId: null, contextSnapshotId: contextSnapshot.id,
            pipelineStep: "AGENT_DECIDER", promptVersion: "pressure-role-agent-v1", schemaVersion: "pressure-role-agent-audit-v1",
            provider: effectiveSelection.provider, modelName: effectiveSelection.modelName, systemPromptHash: sha256Canonical("pressure-role-agent-v1"),
            contextSnapshotHash: contextSnapshot.snapshotHash!, inputHash: sha256Canonical({ projectionPayload, candidates: candidates.map((entry) => entry.candidateId) }),
            outputHash: effectiveSelection.responseHash, attempt: Math.max(1, effectiveSelection.attempts),
            inputJson: { seatId: effectiveSelection.seatId, slot, candidateIds: candidates.map((entry) => entry.candidateId) } as Prisma.InputJsonValue,
            outputJson: { candidateId: effectiveSelection.candidateId, rationale: effectiveSelection.rationale, fallback: effectiveSelection.fallback, providerRequestId: effectiveSelection.providerRequestId } as Prisma.InputJsonValue,
            issueCodesJson: (effectiveSelection.fallbackReason ? [effectiveSelection.fallbackReason] : []) as Prisma.InputJsonValue,
            tokenUsageJson: (effectiveSelection.tokenUsage || {}) as Prisma.InputJsonValue, status: effectiveSelection.fallback ? "FAILED" : "SUCCESS",
            supersededReason: null, startedAt: new Date(), finishedAt: new Date(), latencyMs: 0,
          },
        });
        await tx.aiTask.create({
          data: {
            runId: roomId, nodeId: node.id, actionId: playerAction.id, taskType: "PRESSURE_ROLE_AGENT_DECISION", modelType: "role_agent",
            promptVersion: "pressure-role-agent-v1", status: "completed", inputJson: { seatId: effectiveSelection.seatId, slot, snapshotHash: checkpoint.state.inputSnapshotHash } as Prisma.InputJsonValue,
            resultJson: { candidateId: effectiveSelection.candidateId, rationale: effectiveSelection.rationale, fallback: effectiveSelection.fallback, fallbackReason: effectiveSelection.fallbackReason, providerRequestId: effectiveSelection.providerRequestId } as Prisma.InputJsonValue,
            rawResponse: effectiveSelection.rawResponse, provider: effectiveSelection.provider, modelName: effectiveSelection.modelName, tokenUsageJson: (effectiveSelection.tokenUsage || {}) as Prisma.InputJsonValue,
            startedAt: new Date(), completedAt: new Date(), errorMessage: effectiveSelection.fallbackReason,
          },
        });
        await tx.storyTaskOutbox.upsert({
          where: { dedupeKey: taskDedupeKey },
          update: { status: "completed", outcome: effectiveSelection.fallback ? "FALLBACK" : "ACT", completedAt: new Date(), resultJson: { playerActionId: playerAction.id, roleAgentDecisionId: decision.id } as Prisma.InputJsonValue, lastError: effectiveSelection.fallbackReason },
          create: {
            runId: roomId, nodeId: node.id, windowId: currentRun.actionWindows[0].id, roleId, actionSlot: slot, controlEpoch: action.command.controlEpoch,
            dedupeKey: taskDedupeKey, taskType: "ROLE_AGENT_DECISION", status: "completed", outcome: effectiveSelection.fallback ? "FALLBACK" : "ACT",
            inputRefId: decision.id, maxAttempts: 1, attempt: effectiveSelection.attempts, completedAt: new Date(),
            resultJson: { playerActionId: playerAction.id, roleAgentDecisionId: decision.id } as Prisma.InputJsonValue, lastError: effectiveSelection.fallbackReason,
          },
        });
      }
      const nextCheckpoint = createPressureRuntimeCheckpoint(state, new Date(this.nowProvider()).toISOString());
      const updated = await tx.storyRun.updateMany({
        where: { id: roomId, version: currentRun.version },
        data: { stateJson: mergePressureCheckpointIntoStateJson(currentRun.stateJson, nextCheckpoint), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException({ code: "RUN_VERSION_CONFLICT", message: "Run changed while sealing AI pressure actions" });
      await this.deliveries.publishPressureRootEvents(tx, {
        events: changedRootEvents(current.state, state),
        audienceUserIds: currentRun.players.map((player) => player.userId).filter((value): value is string => Boolean(value)),
        roleIdBySeatId: roleIds, day: current.state.nodeSequence,
      });
    });
  }

  private buildAiCandidates(
    content: PressureRuntimeContent,
    state: PressureRuntimeState,
    seatId: string,
    slot: "PREPARE" | "COMMIT" | "REACTION",
  ): PressureRoleAgentCandidate[] {
    const node = content.nodes[state.nodeId];
    const seat = node.seats.find((entry) => entry.seatId === seatId)!;
    const authoredText = slot === "PREPARE" ? seat.defaultPrepare : slot === "COMMIT" ? seat.defaultCommit : "按当前可见事实作出有限应变";
    const runtimeSeat = state.seats[seatId];
    const result: PressureRoleAgentCandidate[] = [];
    const seen = new Set<string>();
    const add = (type: PressureActionType, intentText: string, targetObjectId: string | null = null, parameters: Record<string, unknown> = {}, resourceCommitments: Array<{ resourceId: string; amount: number }> = []) => {
      const object = targetObjectId ? state.objects[targetObjectId] : null;
      const raw: PressureActionIntentCommandV1 = {
        schemaVersion: "pressure_action_intent_v1", runId: state.runId, nodeId: state.nodeId, slot, seatId,
        currentActorId: runtimeSeat.currentActorId, controlEpoch: runtimeSeat.controlEpoch, type, intentText: intentText.slice(0, 600),
        targetObjectId, expectedObjectVersionId: object?.versionId || null, resourceCommitments, parameters, visibility: "LIMITED",
        submittedAtEpochMs: this.nowProvider(), expectedRunVersion: state.phaseSnapshotVersion, expectedSnapshotHash: state.inputSnapshotHash,
        idempotencyKey: `pressure-agent:${state.runId}:${state.nodeId}:${seatId}:${slot}:${type}:${targetObjectId || "none"}:${sha256Canonical({ intentText, parameters, resourceCommitments }).slice(0, 12)}`,
      };
      const preview = validatePressureActionIntent(content, state, raw);
      if (!preview.accepted || seen.has(preview.actionFingerprint)) return;
      seen.add(preview.actionFingerprint);
      result.push({
        candidateId: `candidate:${seatId}:${slot}:${result.length + 1}`, displayText: intentText,
        sourceRefs: [`default-policy:${state.nodeId}:${seatId}:${slot}`], normalizedIntent: preview.normalizedIntent as unknown as Record<string, unknown>,
      });
    };
    add(slot === "REACTION" ? "PASS" : "PLAN", authoredText);
    if (slot === "PREPARE") {
      add("INVESTIGATE", `${authoredText}，先核验当前可见材料`);
      add("NEGOTIATE", `${authoredText}，并与相关席位交涉条件`);
    } else if (slot === "COMMIT") {
      const objects = [...node.contestedObjectIds, ...node.secondaryObjectIds, ...seat.keyLeverageObjectIds].filter((id, index, list) => list.indexOf(id) === index);
      const nextSeatId = content.seatIds[(content.seatIds.indexOf(seatId) + 1) % content.seatIds.length]!;
      for (const objectId of objects) {
        add("SIGN", authoredText, objectId, { desiredDisposition: "UPDATE", signatureId: `signature:${seatId}:${state.nodeId}` });
        add("TRANSFER", authoredText, objectId, { desiredDisposition: "TRANSFER", targetSeatId: nextSeatId });
        add("SEIZE", authoredText, objectId, { desiredDisposition: "SEIZE" });
        add("DISPATCH", authoredText, objectId, { desiredDisposition: "UPDATE", destinationId: `route:${state.nodeId}:${seatId}` });
        if (result.length >= 3) break;
      }
      const knownFactId = runtimeSeat.knownFactIds[0];
      if (knownFactId) add("DISCLOSE", authoredText, null, { factIds: [knownFactId], targetSeatId: nextSeatId });
      const resourceId = Object.keys(runtimeSeat.resourceBalances).find((id) => runtimeSeat.resourceBalances[id] > 0);
      if (resourceId) add("ALLOCATE", authoredText, null, {}, [{ resourceId, amount: 1 }]);
    } else {
      for (const type of state.reactionWindow?.allowedActionTypes || []) add(type, authoredText);
    }
    if (result.length < 2 && slot !== "REACTION") add("DELAY", `${authoredText}，暂缓直接介入并承担失去先手的代价`);
    return result.slice(0, 3);
  }

  async preview(user: AuthenticatedUser, roomId: string, rawIntent: unknown): Promise<PressureActionPreview> {
    const context = await this.prisma.storyRun.findUnique({
      where: { id: roomId },
      include: {
        roles: true,
        players: { where: { userId: user.id, status: "active" } },
      },
    });
    if (!context) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (!this.supportsStrategy(context.strategyVersion)) throw new ConflictException({ code: "PRESSURE_RUNTIME_REQUIRED", message: "Run does not use the pressure runtime" });
    const content = this.content(context.strategyVersion);
    const checkpoint = await this.loadOrRebuildCheckpoint(this.prisma as any, context as any, content);
    this.assertUserSeat(user, rawIntent, context.players, context.roles, content);
    this.assertServerDeadline(checkpoint.state, this.nowProvider());
    return validatePressureActionIntent(content, checkpoint.state, rawIntent);
  }

  async confirm(
    user: AuthenticatedUser,
    roomId: string,
    rawIntent: unknown,
    previewToken: string,
  ): Promise<PressureConfirmPersistenceResult> {
    const result = await roomSerializableTransaction(this.prisma, roomId, async (tx) => {
      const context = await tx.storyRun.findUnique({
        where: { id: roomId },
        include: {
          roles: true,
          players: { where: { status: "active" } },
          actionWindows: { orderBy: { createdAt: "desc" }, take: 1, include: { participants: true } },
        },
      });
      if (!context) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      if (!this.supportsStrategy(context.strategyVersion)) throw new ConflictException({ code: "PRESSURE_RUNTIME_REQUIRED", message: "Run does not use the pressure runtime" });
      const content = this.content(context.strategyVersion);
      this.assertUserSeat(user, rawIntent, context.players, context.roles, content);
      const checkpoint = await this.loadOrRebuildCheckpoint(tx, context, content);
      const normalizedPreview = validatePressureActionIntent(content, checkpoint.state, rawIntent);
      const requestHash = pressureActionRequestFingerprint(normalizedPreview.normalizedIntent);
      const existing = await tx.playerAction.findUnique({ where: { idempotencyKey: normalizedPreview.normalizedIntent.idempotencyKey } });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "Idempotency key belongs to a different payload" });
        }
        const actionId = String(record(existing.normalizedJson).actionId || existing.id);
        return {
          replayed: true,
          actionId,
          requestHash,
          stateHash: checkpoint.stateHash,
          phase: checkpoint.state.phase,
        };
      }
      this.assertServerDeadline(checkpoint.state, this.nowProvider());
      await this.ensurePersistedRootEventMirror(tx, checkpoint.state, context.players.map((player: any) => player.userId).filter(Boolean), roleIdBySeatId(content, context.roles));
      const confirmed = confirmPressureActionIntent(content, checkpoint.state, normalizedPreview.normalizedIntent, previewToken);
      const action = confirmed.action;
      const roleMap = roleIdBySeatId(content, context.roles);
      const roleId = roleMap[action.command.seatId];
      const node = await tx.sceneNode.findFirst({ where: { runId: roomId, nodeIndex: checkpoint.state.nodeSequence } });
      const window = context.actionWindows[0];
      if (!node || !window || window.nodeId !== node.id) {
        throw new ConflictException({ code: "ACTION_WINDOW_NOT_READY", message: "Pressure action window is not ready" });
      }
      await tx.playerAction.create({
        data: {
          id: action.command.actionId,
          runId: roomId,
          nodeId: node.id,
          chapterIndex: node.chapterIndex,
          userId: user.id,
          roleId,
          playerType: "human",
          actionType: "pressure_action",
          targetType: action.command.targetObjectId ? "object" : "pressure",
          targetId: action.command.targetObjectId,
          targetText: action.command.targetObjectId,
          method: action.command.intentText,
          intent: action.command.intentText,
          riskLevel: "normal",
          normalizedJson: {
            actionId: action.command.actionId,
            publicIntent: action.command.sourceIntent,
            compiled: safeActionJson(action),
          } as Prisma.InputJsonValue,
          guardStatus: "ok",
          auditStatus: "ok",
          status: "accepted",
          actionSlot: actionSlotToLegacy(action.command.slot),
          actorKind: "HUMAN",
          controlEpoch: action.command.controlEpoch,
          policyVersion: action.command.policyVersion,
          provider: "rules",
          modelName: "pressure-kernel-v1",
          actionKey: action.command.type,
          idempotencyKey: action.command.idempotencyKey,
          requestHash,
          visibility: action.command.visibility,
          targetRoleId: action.command.targetSeatId ? roleMap[action.command.targetSeatId] || null : null,
          sealedAt: new Date(action.sealedAt),
          immediateJson: {
            schemaVersion: "pressure_action_receipt_v1",
            actionId: action.command.actionId,
            phase: confirmed.state.phase,
            worldTimeMinutes: confirmed.state.worldTimeMinutes,
            pressureLevel: confirmed.state.pressureLevel,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.actionWindowParticipant.update({
        where: { windowId_roleId: { windowId: window.id, roleId } },
        data: participantPatch(action.command.slot),
      });
      const nextCheckpoint = createPressureRuntimeCheckpoint(confirmed.state, new Date().toISOString());
      const updated = await tx.storyRun.updateMany({
        where: { id: roomId, version: context.version },
        data: {
          stateJson: mergePressureCheckpointIntoStateJson(context.stateJson, nextCheckpoint),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ConflictException({ code: "RUN_VERSION_CONFLICT", message: "Run changed while sealing pressure action" });
      await this.deliveries.publishPressureRootEvents(tx, {
        events: changedRootEvents(checkpoint.state, confirmed.state),
        audienceUserIds: context.players.map((player: any) => player.userId).filter(Boolean),
        roleIdBySeatId: roleMap,
        day: checkpoint.state.nodeSequence,
      });
      return {
        replayed: false,
        actionId: action.command.actionId,
        requestHash,
        stateHash: nextCheckpoint.stateHash,
        phase: confirmed.state.phase,
      };
    });
    await this.faultInjector?.("AFTER_ACTION_SEALED_COMMIT");
    return result;
  }

  async advanceWindow(windowId: string, now = new Date()) {
    const identity = await this.prisma.actionWindow.findUnique({ where: { id: windowId }, select: { runId: true } });
    if (!identity) return { windowId, outcome: "MISSING" };
    return roomSerializableTransaction(this.prisma, identity.runId, async (tx) => {
      const window = await tx.actionWindow.findUnique({
        where: { id: windowId },
        include: { run: { include: { roles: true, players: { where: { status: "active" } } } }, node: true },
      });
      if (!window || !this.supportsStrategy(window.run.strategyVersion)) return { windowId, outcome: "NOT_PRESSURE_RUNTIME" };
      const content = this.content(window.run.strategyVersion);
      const checkpoint = await this.loadOrRebuildCheckpoint(tx, window.run, content);
      const before = checkpoint.state;
      let after = deepClone(before);
      const nowEpochMs = now.getTime();
      let outcome = "NO_OP";
      if (after.phase === "PREPARE_OPEN") {
        after = lockPreparePhase(content, after, nowEpochMs);
        if (after.phase === "PREPARE_OPEN") return { windowId, outcome: "PREPARE_REMAINS_OPEN" };
        after = beginPrepareResolutionPhase(after);
        const commitSeconds = Math.max(1, Number(record(window.configJson).commitSeconds || 180));
        after = resolvePreparePhase(content, after, nowEpochMs, nowEpochMs + commitSeconds * 1_000).state;
        outcome = "COMMIT_OPEN";
      } else if (after.phase === "COMMIT_OPEN") {
        after = lockCommitPhase(content, after, nowEpochMs);
        if (after.phase === "COMMIT_OPEN") return { windowId, outcome: "COMMIT_REMAINS_OPEN" };
        const reactionSeconds = Math.max(1, content.nodes[after.nodeId].reaction?.windowSeconds || 60);
        after = openReactionOrSettlement(content, after, nowEpochMs);
        outcome = after.phase === "REACTION_OPEN" ? "REACTION_OPEN" : "SETTLEMENT_READY";
      } else if (after.phase === "REACTION_OPEN") {
        after = lockReactionPhase(content, after, nowEpochMs);
        if (after.phase === "REACTION_OPEN") return { windowId, outcome: "REACTION_REMAINS_OPEN" };
        outcome = "SETTLEMENT_READY";
      } else {
        return { windowId, outcome: "NO_OP", phase: after.phase };
      }
      await this.persistMissingSealedActions(tx, window, content, before, after);
      await this.persistDomainOutput(tx, window, content, before, after);
      const nextCheckpoint = createPressureRuntimeCheckpoint(after, now.toISOString());
      const updated = await tx.storyRun.updateMany({
        where: { id: window.runId, version: window.run.version },
        data: { stateJson: mergePressureCheckpointIntoStateJson(window.run.stateJson, nextCheckpoint), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException({ code: "RUN_VERSION_CONFLICT", message: "Run changed while advancing pressure phase" });
      await tx.actionWindow.update({
        where: { id: window.id },
        data: {
          status: after.phase === "SETTLING" ? "CLOSING" : after.phase,
          version: { increment: 1 },
          projectionVersion: { increment: 1 },
        },
      });
      return { windowId, outcome, phase: after.phase, stateHash: nextCheckpoint.stateHash };
    });
  }

  async resolveWindow(windowId: string): Promise<PressureResolutionPersistenceResult> {
    const identity = await this.prisma.actionWindow.findUnique({ where: { id: windowId }, select: { runId: true } });
    if (!identity) throw new NotFoundException({ code: "WINDOW_NOT_FOUND", message: "Action window not found" });
    for (let phase = 0; phase < 8; phase += 1) {
      const result = await roomSerializableTransaction(this.prisma, identity.runId, (tx) => this.resolvePhaseTx(tx, windowId));
      if (result.outcome === "CHECKPOINTED") {
        await this.faultInjector?.("AFTER_RULES_APPLIED_COMMIT");
        continue;
      }
      if (result.outcome === "FROZEN") continue;
      return result;
    }
    throw new Error(`PRESSURE_RESOLUTION_LOOP_EXCEEDED:${windowId}`);
  }

  async recoverRun(runId: string): Promise<PressureRuntimeCheckpointV1> {
    return roomSerializableTransaction(this.prisma, runId, async (tx) => {
      const run = await tx.storyRun.findUnique({ where: { id: runId }, include: { roles: true, players: true } });
      if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      if (!this.supportsStrategy(run.strategyVersion)) throw new ConflictException({ code: "PRESSURE_RUNTIME_REQUIRED", message: "Run does not use the pressure runtime" });
      const content = this.content(run.strategyVersion);
      const checkpoint = await this.loadOrRebuildCheckpoint(tx, run, content);
      const recoveredState = checkpoint.state.phase === "FAILED_RECOVERABLE"
        ? recoverPressureRuntime(checkpoint.state, {
            nowEpochMs: this.nowProvider(),
            expectedPackageSha256: content.packageSha256,
            expectedInputSnapshotHash: checkpoint.state.inputSnapshotHash,
          })
        : checkpoint.state;
      const updatedCheckpoint = createPressureRuntimeCheckpoint(recoveredState, new Date(this.nowProvider()).toISOString());
      await tx.storyRun.update({
        where: { id: run.id },
        data: { stateJson: mergePressureCheckpointIntoStateJson(run.stateJson, updatedCheckpoint) },
      });
      await this.ensurePersistedRootEventMirror(
        tx,
        recoveredState,
        run.players.map((player: any) => player.userId).filter(Boolean),
        roleIdBySeatId(content, run.roles),
      );
      return updatedCheckpoint;
    });
  }

  private async resolvePhaseTx(tx: Tx, windowId: string): Promise<PressureResolutionPersistenceResult> {
    const window = await tx.actionWindow.findUnique({
      where: { id: windowId },
      include: {
        run: { include: { roles: true, players: { where: { status: "active" } } } },
        node: true,
      },
    });
    if (!window) throw new NotFoundException({ code: "WINDOW_NOT_FOUND", message: "Action window not found" });
    if (!this.supportsStrategy(window.run.strategyVersion)) throw new ConflictException({ code: "PRESSURE_RUNTIME_REQUIRED", message: "Run does not use the pressure runtime" });
    const content = this.content(window.run.strategyVersion);
    const checkpoint = await this.loadOrRebuildCheckpoint(tx, window.run, content);
    let workflow = await tx.resolutionWorkflow.findUnique({ where: { windowId }, include: { checkpoints: true } });
    const existingProjectionCheckpoint = workflow?.checkpoints?.find((entry: any) => entry.checkpointKey === "PROJECTION_INPUT_PERSISTED");
    if (existingProjectionCheckpoint) {
      if (checkpoint.stateHash !== existingProjectionCheckpoint.contentHash) {
        throw new ConflictException({ code: "PROJECTION_INPUT_DRIFT", message: "Projected pressure checkpoint drifted" });
      }
      const existingOutput = pressureResolutionOutput(workflow?.rulesOutputJson);
      return {
        outcome: checkpoint.state.phase === "COMPLETED" ? "COMPLETED" : checkpoint.state.phase === "FINALE_COMPUTING" ? "FINALE_COMPUTING" : "PROJECTED",
        stateHash: checkpoint.stateHash,
        frozenResultId: existingOutput?.frozenResult?.frozenResultId || null,
        frozenResultHash: existingOutput?.frozenResultHash || null,
        phase: checkpoint.state.phase,
      };
    }
    if (!["SETTLING", "FROZEN", "PROJECTING"].includes(checkpoint.state.phase)) {
      return {
        outcome: "WAITING",
        stateHash: checkpoint.stateHash,
        frozenResultId: null,
        frozenResultHash: null,
        phase: checkpoint.state.phase,
      };
    }
    const actionRows = await tx.playerAction.findMany({
      where: { runId: window.runId, nodeId: window.nodeId, actionType: "pressure_action", status: { in: ["accepted", "resolved"] } },
      orderBy: [{ id: "asc" }],
    });
    const rulesInput = actionRows.map((row: any) => ({ id: row.id, requestHash: row.requestHash, normalizedJson: row.normalizedJson }));
    const rulesInputHash = sha256Canonical(rulesInput);
    if (!workflow) {
      workflow = await tx.resolutionWorkflow.create({
        data: {
          runId: window.runId,
          windowId,
          nodeId: window.nodeId,
          status: "RUNNING",
          rulesInputHash,
        },
        include: { checkpoints: true },
      });
    } else if (workflow.rulesInputHash !== rulesInputHash) {
      throw new ConflictException({ code: "SETTLEMENT_INPUT_DRIFT", message: "Sealed pressure input changed" });
    }
    const checkpoints = new Map<string, any>(workflow.checkpoints.map((entry: any) => [entry.checkpointKey, entry]));
    const rulesCheckpoint = checkpoints.get("RULES_APPLIED");
    if (!rulesCheckpoint) {
      const outcome = this.computeResolution(content, checkpoint.state, this.nowProvider());
      const output: PressureResolutionOutputV1 = {
        schemaVersion: PRESSURE_RESOLUTION_OUTPUT_SCHEMA,
        inputStateHash: checkpoint.stateHash,
        settledState: outcome.state,
        settledStateHash: pressureRuntimeReplayHash(outcome.state),
        frozenResult: outcome.frozenResult,
        frozenResultHash: outcome.frozenResult?.contentHash || null,
      };
      await tx.resolutionWorkflow.update({ where: { id: workflow.id }, data: { rulesOutputJson: output as unknown as Prisma.InputJsonValue } });
      await tx.resolutionCheckpoint.create({
        data: {
          workflowId: workflow.id,
          checkpointKey: "RULES_APPLIED",
          contentHash: sha256Canonical(output),
          outputRefType: "RESOLUTION_WORKFLOW",
          outputRefId: workflow.id,
        },
      });
      return {
        outcome: "CHECKPOINTED",
        stateHash: output.settledStateHash,
        frozenResultId: output.frozenResult?.frozenResultId || null,
        frozenResultHash: output.frozenResultHash,
        phase: output.settledState.phase,
      };
    }
    const output = pressureResolutionOutput(workflow.rulesOutputJson);
    if (!output || sha256Canonical(output) !== rulesCheckpoint.contentHash) {
      throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: "RULES_APPLIED checkpoint drifted" });
    }
    if (!checkpoints.has("DOMAIN_PERSISTED")) {
      await this.faultInjector?.("BEFORE_DOMAIN_TRANSACTION_COMMIT");
      await this.persistDomainOutput(tx, window, content, checkpoint.state, output.settledState);
      const persistedCheckpoint = createPressureRuntimeCheckpoint(output.settledState, new Date().toISOString());
      const updated = await tx.storyRun.updateMany({
        where: { id: window.runId, version: window.run.version },
        data: {
          stateJson: mergePressureCheckpointIntoStateJson(window.run.stateJson, persistedCheckpoint),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new ConflictException({ code: "RUN_VERSION_CONFLICT", message: "Run changed while applying pressure resolution" });
      await tx.resolutionCheckpoint.create({
        data: {
          workflowId: workflow.id,
          checkpointKey: "DOMAIN_PERSISTED",
          contentHash: persistedCheckpoint.stateHash,
          outputRefType: "STORY_RUN_CHECKPOINT",
          outputRefId: window.runId,
        },
      });
      return {
        outcome: output.frozenResult ? "FROZEN" : "WAITING",
        stateHash: persistedCheckpoint.stateHash,
        frozenResultId: output.frozenResult?.frozenResultId || null,
        frozenResultHash: output.frozenResultHash,
        phase: output.settledState.phase,
      };
    }
    const projectedCheckpointRow = checkpoints.get("PROJECTION_INPUT_PERSISTED");
    if (projectedCheckpointRow) {
      const currentRun = await tx.storyRun.findUniqueOrThrow({ where: { id: window.runId } });
      const currentCheckpoint = pressureCheckpointFromRun(currentRun);
      if (!currentCheckpoint || currentCheckpoint.stateHash !== projectedCheckpointRow.contentHash) {
        throw new ConflictException({ code: "PROJECTION_INPUT_DRIFT", message: "Projected pressure checkpoint drifted" });
      }
      return {
        outcome: currentCheckpoint.state.phase === "COMPLETED" ? "COMPLETED" : currentCheckpoint.state.phase === "FINALE_COMPUTING" ? "FINALE_COMPUTING" : "PROJECTED",
        stateHash: currentCheckpoint.stateHash,
        frozenResultId: output.frozenResult?.frozenResultId || null,
        frozenResultHash: output.frozenResultHash,
        phase: currentCheckpoint.state.phase,
      };
    }
    const projectedState = this.projectIfFrozen(content, output.settledState, this.nowProvider());
    const projectedCheckpoint = createPressureRuntimeCheckpoint(projectedState, new Date().toISOString());
    const currentRun = await tx.storyRun.findUniqueOrThrow({ where: { id: window.runId } });
    const projectedNode = ["FINALE_COMPUTING", "COMPLETED"].includes(projectedState.phase)
      ? null
      : await this.ensureProjectedPressureWindow(tx, window, projectedState, content);
    await tx.storyRun.update({
      where: { id: window.runId },
      data: {
        stateJson: mergePressureCheckpointIntoStateJson(currentRun.stateJson, projectedCheckpoint),
        currentDay: projectedState.nodeSequence,
        currentNodeId: projectedNode?.id || currentRun.currentNodeId,
        status: projectedState.phase === "COMPLETED" ? "chapter_generated" : projectedState.phase === "FINALE_COMPUTING" ? "finale_computing" : "playing",
        version: { increment: 1 },
      },
    });
    if (!checkpoints.has("PROJECTION_INPUT_PERSISTED")) {
      await tx.resolutionCheckpoint.create({
        data: {
          workflowId: workflow.id,
          checkpointKey: "PROJECTION_INPUT_PERSISTED",
          contentHash: projectedCheckpoint.stateHash,
          outputRefType: "STORY_RUN_CHECKPOINT",
          outputRefId: window.runId,
        },
      });
    }
    await tx.resolutionWorkflow.update({
      where: { id: workflow.id },
      data: { status: "COMPLETED", completedAt: new Date(), version: { increment: 1 } },
    });
    await tx.actionWindow.update({ where: { id: window.id }, data: { status: "RESOLVED", version: { increment: 1 } } });
    return {
      outcome: projectedState.phase === "COMPLETED" ? "COMPLETED" : projectedState.phase === "FINALE_COMPUTING" ? "FINALE_COMPUTING" : "PROJECTED",
      stateHash: projectedCheckpoint.stateHash,
      frozenResultId: output.frozenResult?.frozenResultId || null,
      frozenResultHash: output.frozenResultHash,
      phase: projectedState.phase,
    };
  }

  private computeResolution(
    content: PressureRuntimeContent,
    source: PressureRuntimeState,
    nowEpochMs: number,
  ): { state: PressureRuntimeState; frozenResult: FrozenNodeResultV1 | null } {
    let state = deepClone(source);
    if (state.phase === "PREPARE_OPEN") {
      state = lockPreparePhase(content, state, nowEpochMs);
      if (state.phase === "PREPARE_OPEN") return { state, frozenResult: null };
      state = beginPrepareResolutionPhase(state);
      state = resolvePreparePhase(content, state, nowEpochMs, nowEpochMs + 600_000).state;
      return { state, frozenResult: null };
    }
    if (state.phase === "COMMIT_OPEN") {
      state = lockCommitPhase(content, state, nowEpochMs);
      if (state.phase === "COMMIT_OPEN") return { state, frozenResult: null };
      state = openReactionOrSettlement(content, state, nowEpochMs);
      if (state.phase === "REACTION_OPEN") return { state, frozenResult: null };
    } else if (state.phase === "REACTION_OPEN") {
      state = lockReactionPhase(content, state, nowEpochMs);
      if (state.phase === "REACTION_OPEN") return { state, frozenResult: null };
    }
    if (state.phase !== "SETTLING") return { state, frozenResult: null };
    const result = settlePressureNode(content, state, nowEpochMs);
    return { state: result.state, frozenResult: result.frozenResult };
  }

  private projectIfFrozen(content: PressureRuntimeContent, state: PressureRuntimeState, nowEpochMs: number): PressureRuntimeState {
    if (state.phase !== "FROZEN" && state.phase !== "PROJECTING") return deepClone(state);
    const projected = projectNextPressureNode(content, state, nowEpochMs, nowEpochMs + 600_000).state;
    return projected.phase === "FINALE_COMPUTING"
      ? completePressureFinale(content, projected, nowEpochMs + 1)
      : projected;
  }

  private async ensureProjectedPressureWindow(
    tx: Tx,
    priorWindow: any,
    state: PressureRuntimeState,
    content: PressureRuntimeContent,
  ): Promise<{ id: string }> {
    return this.ensurePressureWindow(tx, priorWindow.run, state, content);
  }

  private async ensurePressureRoleKeys(tx: Tx, runId: string, content: PressureRuntimeContent): Promise<void> {
    const roles = await tx.storyRole.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });
    const byKey = new Map(roles.map((role) => [role.roleKey, role]));
    for (const role of roles) {
      const targetKey = LEGACY_TO_PRESSURE_ROLE_KEY[role.roleKey];
      if (!targetKey || targetKey === role.roleKey) continue;
      const collision = byKey.get(targetKey);
      if (collision && collision.id !== role.id) {
        throw new ConflictException({ code: "CONTINUOUS_ROLE_SET_INVALID", message: `Pressure role key collision: ${targetKey}` });
      }
      await tx.storyRole.update({
        where: { id: role.id },
        data: { roleKey: targetKey, roleName: PRESSURE_ROLE_DISPLAY[targetKey] || role.roleName },
      });
      byKey.delete(role.roleKey);
      byKey.set(targetKey, { ...role, roleKey: targetKey });
    }
    const refreshed = await tx.storyRole.findMany({ where: { runId } });
    const expected = new Set(content.nodes.N1.seats.map((seat) => seat.roleKey));
    const actual = new Set(refreshed.map((role) => role.roleKey).filter((key) => expected.has(key)));
    if (actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
      throw new ConflictException({ code: "CONTINUOUS_ROLE_SET_INVALID", message: "Pressure run does not contain the six registered institutional seats" });
    }
  }

  private async ensurePressureWindow(
    tx: Tx,
    run: any,
    state: PressureRuntimeState,
    content: PressureRuntimeContent,
  ): Promise<{ id: string }> {
    if (state.nodeSequence < 1 || state.nodeId === "P0") {
      throw new ConflictException({ code: "ACTION_WINDOW_CLOSED", message: "P0 does not accept world actions" });
    }
    let node = await tx.sceneNode.findFirst({
      where: { runId: run.id, chapterIndex: 1, nodeIndex: state.nodeSequence },
    });
    if (!node) {
      node = await tx.sceneNode.create({
        data: {
          runId: run.id, chapterIndex: 1, nodeIndex: state.nodeSequence,
          title: content.nodes[state.nodeId]?.title || state.nodeId,
          publicNarration: `Viewer-safe pressure projection for ${state.nodeId}`,
          nodeGoal: `Resolve the accepted pressure content for ${state.nodeId}`,
          status: "open_for_actions", actionOptionsJson: [] as Prisma.InputJsonValue,
        },
      });
    }
    const legacyStatus = state.phase === "PREPARE_OPEN" ? "MAIN_OPEN"
      : ["COMMIT_OPEN", "REACTION_OPEN"].includes(state.phase) ? "INTERACTION_GRACE"
        : ["FROZEN", "PROJECTING", "COMPLETED"].includes(state.phase) ? "RESOLVED" : "RESOLVING";
    let window = await tx.actionWindow.findUnique({ where: { nodeId: node.id } });
    if (!window) {
      window = await tx.actionWindow.create({
        data: {
          runId: run.id, nodeId: node.id, status: legacyStatus,
          mainOpenedAt: new Date(this.nowProvider()),
          mainClosesAt: state.phaseDeadlineEpochMs ? new Date(state.phaseDeadlineEpochMs) : null,
          graceOpenedAt: state.phase === "COMMIT_OPEN" || state.phase === "REACTION_OPEN" ? new Date(this.nowProvider()) : null,
          graceClosesAt: state.phase === "COMMIT_OPEN" || state.phase === "REACTION_OPEN"
            ? state.phaseDeadlineEpochMs ? new Date(state.phaseDeadlineEpochMs) : null : null,
          openingSnapshotVersion: state.phaseSnapshotVersion, projectionVersion: 1,
          configJson: {
            runtimeProfile: state.runtimeProfile, strategyVersion: state.strategyVersion, nodeId: state.nodeId,
            phase: state.phase, inputSnapshotHash: state.inputSnapshotHash, contentVersion: content.packageVersion,
          } as Prisma.InputJsonValue,
        },
      });
    } else {
      window = await tx.actionWindow.update({
        where: { id: window.id },
        data: {
          status: legacyStatus, mainClosesAt: state.phaseDeadlineEpochMs ? new Date(state.phaseDeadlineEpochMs) : null,
          graceClosesAt: ["COMMIT_OPEN", "REACTION_OPEN"].includes(state.phase) && state.phaseDeadlineEpochMs ? new Date(state.phaseDeadlineEpochMs) : window.graceClosesAt,
          openingSnapshotVersion: state.phaseSnapshotVersion, projectionVersion: { increment: 1 },
          configJson: {
            runtimeProfile: state.runtimeProfile, strategyVersion: state.strategyVersion, nodeId: state.nodeId,
            phase: state.phase, inputSnapshotHash: state.inputSnapshotHash, contentVersion: content.packageVersion,
          } as Prisma.InputJsonValue,
        },
      });
    }

    const roles = await tx.storyRole.findMany({ where: { runId: run.id } });
    const roleMap = roleIdBySeatId(content, roles);
    const publicProjection = state.projections[`${state.nodeId}:PUBLIC`];
    for (const seatId of content.seatIds) {
      const roleId = roleMap[seatId]!;
      const prepareAction = state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:PREPARE`];
      const commitAction = state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:COMMIT`];
      const reactionAction = state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:REACTION`];
      await tx.actionWindowParticipant.upsert({
        where: { windowId_roleId: { windowId: window.id, roleId } },
        update: {
          mainStatus: prepareAction ? "SUBMITTED" : "PENDING",
          maneuverStatus: commitAction ? "SUBMITTED" : state.phase === "COMMIT_OPEN" ? "AVAILABLE" : state.phase === "PREPARE_OPEN" ? "LOCKED" : "LOCKED",
          reactionStatus: reactionAction ? "RESPONDED" : state.phase === "REACTION_OPEN" && state.reactionWindow?.eligibleSeatIds.includes(seatId) ? "PENDING" : "NOT_OPEN",
          doneAt: commitAction ? new Date() : null,
          version: { increment: 1 },
        },
        create: {
          windowId: window.id, roleId,
          mainStatus: prepareAction ? "SUBMITTED" : "PENDING",
          maneuverStatus: commitAction ? "SUBMITTED" : state.phase === "COMMIT_OPEN" ? "AVAILABLE" : "LOCKED",
          reactionStatus: reactionAction ? "RESPONDED" : state.phase === "REACTION_OPEN" && state.reactionWindow?.eligibleSeatIds.includes(seatId) ? "PENDING" : "NOT_OPEN",
          doneAt: commitAction ? new Date() : null,
        },
      });
      const privateProjection = state.projections[`${state.nodeId}:${seatId}`];
      const projectionPayload = {
        schemaVersion: "pressure_opening_projection_v1",
        nodeId: state.nodeId, seatId, phase: state.phase,
        publicProjection: publicProjection || null, privateProjection: privateProjection || null,
        knownFactIds: [...state.seats[seatId].knownFactIds],
        knownObjectVersionIds: [...state.seats[seatId].knownObjectVersionIds],
        currentActorId: state.seats[seatId].currentActorId,
      };
      await tx.actionWindowOpeningProjection.upsert({
        where: { windowId_roleId: { windowId: window.id, roleId } },
        update: { snapshotVersion: state.phaseSnapshotVersion, projectionJson: projectionPayload as Prisma.InputJsonValue, contentHash: sha256Canonical(projectionPayload) },
        create: { windowId: window.id, roleId, snapshotVersion: state.phaseSnapshotVersion, projectionJson: projectionPayload as Prisma.InputJsonValue, contentHash: sha256Canonical(projectionPayload) },
      });

      const seat = content.nodes[state.nodeId]?.seats.find((item) => item.seatId === seatId);
      const defaultPolicy = content.nodes[state.nodeId]?.defaultPolicies.find((item) => item.seatId === seatId);
      const provider = String(process.env.ROLE_AGENT_PROVIDER || (process.env.DEEPSEEK_API_KEY ? "deepseek" : "rules"));
      const modelName = provider === "deepseek" ? String(process.env.ROLE_AGENT_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat") : "authored-default-v1";
      const policyVersion = `pressure:${content.packageVersion}:${state.nodeId}:${seatId}:v1`;
      await tx.roleAgentPolicy.upsert({
        where: { runId_roleId_policyVersion: { runId: run.id, roleId, policyVersion } },
        update: {},
        create: {
          runId: run.id, roleId, policyVersion, promptVersion: "pressure-role-agent-v1", provider, modelName,
          goalsJson: { institutionalMission: seat?.defaultPrepare || "", defaultCommit: seat?.defaultCommit || "" } as Prisma.InputJsonValue,
          riskProfileJson: { pressureLevel: state.pressureLevel } as Prisma.InputJsonValue,
          assetPriorityJson: (seat?.keyLeverageObjectIds || []) as Prisma.InputJsonValue,
          actionWeightsJson: [] as Prisma.InputJsonValue,
          fallbackBySlotJson: { PREPARE: defaultPolicy?.prepareText || seat?.defaultPrepare || "", COMMIT: defaultPolicy?.commitText || seat?.defaultCommit || "" } as Prisma.InputJsonValue,
        },
      });
    }
    return { id: node.id };
  }

  private async persistDomainOutput(
    tx: Tx,
    window: any,
    content: PressureRuntimeContent,
    before: PressureRuntimeState,
    after: PressureRuntimeState,
  ): Promise<void> {
    const roleMap = roleIdBySeatId(content, window.run.roles);
    const actionIds = new Set(Object.keys(after.sealedActions));
    for (const actionId of actionIds) {
      const sealed = after.sealedActions[actionId];
      if (!sealed.resolution) continue;
      await tx.playerAction.updateMany({
        where: { id: actionId, resolvedAt: null },
        data: {
          resolvedJson: sealed.resolution as unknown as Prisma.InputJsonValue,
          resolvedAt: sealed.resolvedAt ? new Date(sealed.resolvedAt) : new Date(),
          status: sealed.resolution.status === "REJECTED" ? "rejected" : "resolved",
        },
      });
    }
    for (const [objectId, next] of Object.entries(after.objects)) {
      const previous = before.objects[objectId];
      if (previous && previous.versionId === next.versionId) continue;
      const ownerRoleId = next.custodySeatId ? roleMap[next.custodySeatId] || null : null;
      const existingAsset = await tx.roleAsset.findUnique({
        where: { runId_assetKey: { runId: window.runId, assetKey: objectId } },
      });
      let asset: { id: string };
      if (!existingAsset) {
        asset = await tx.roleAsset.create({
          data: {
            runId: window.runId,
            assetKey: objectId,
            kind: next.kind,
            ownerRoleId,
            ownerActorKey: next.custodyActorId,
            quantity: next.quantity,
            status: next.status,
            visibility: next.visibility,
            stateJson: next as unknown as Prisma.InputJsonValue,
            version: next.version,
          },
          select: { id: true },
        });
      } else {
        const persisted = record(existingAsset.stateJson);
        const persistedVersionId = String(persisted.versionId || "");
        if (previous && persistedVersionId && persistedVersionId !== previous.versionId) {
          throw new ConflictException({ code: "OBJECT_VERSION_CONFLICT", message: `Persisted object ${objectId} is stale` });
        }
        if (!previous && persistedVersionId && persistedVersionId !== next.predecessorVersionId && persistedVersionId !== next.versionId) {
          throw new ConflictException({ code: "OBJECT_VERSION_CONFLICT", message: `Persisted object ${objectId} has an unknown predecessor` });
        }
        const updated = await tx.roleAsset.updateMany({
          where: { id: existingAsset.id, version: existingAsset.version },
          data: {
            kind: next.kind,
            ownerRoleId,
            ownerActorKey: next.custodyActorId,
            quantity: next.quantity,
            status: next.status,
            visibility: next.visibility,
            stateJson: next as unknown as Prisma.InputJsonValue,
            version: next.version,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({ code: "OBJECT_VERSION_CONFLICT", message: `Concurrent object mutation lost for ${objectId}` });
        }
        asset = { id: existingAsset.id };
      }
      const actionId = next.lastMutationActionId;
      if (actionId && after.sealedActions[actionId]) {
        await tx.roleAssetMutation.upsert({
          where: { idempotencyKey: `pressure-object:${window.runId}:${next.versionId}` },
          update: {},
          create: {
            assetId: asset.id,
            actionId,
            mutationType: next.status === "DESTROYED" ? "DESTROY" : "SET_STATE",
            delta: next.quantity - (previous?.quantity || 0),
            fromRoleId: previous?.custodySeatId ? roleMap[previous.custodySeatId] || null : null,
            toRoleId: ownerRoleId,
            beforeJson: (previous || {}) as unknown as Prisma.InputJsonValue,
            afterJson: next as unknown as Prisma.InputJsonValue,
            idempotencyKey: `pressure-object:${window.runId}:${next.versionId}`,
          },
        });
      }
    }
    await this.deliveries.publishPressureRootEvents(tx, {
      events: changedRootEvents(before, after),
      audienceUserIds: window.run.players.map((player: any) => player.userId).filter(Boolean),
      roleIdBySeatId: roleMap,
      day: before.nodeSequence,
    });
  }

  private async loadOrRebuildCheckpoint(tx: any, run: any, content: PressureRuntimeContent): Promise<PressureRuntimeCheckpointV1> {
    const existing = pressureCheckpointFromRun(run);
    if (existing) return existing;
    const workflow = await tx.resolutionWorkflow.findFirst({
      where: { runId: run.id, status: { in: ["RUNNING", "COMPLETED"] } },
      orderBy: { updatedAt: "desc" },
      include: { checkpoints: true },
    });
    const output = pressureResolutionOutput(workflow?.rulesOutputJson);
    if (output && workflow.checkpoints.some((entry: any) => entry.checkpointKey === "RULES_APPLIED")) {
      return createPressureRuntimeCheckpoint(output.settledState);
    }
    const initializedAt = this.nowProvider();
    let state = initializePressureRuntime(content, {
      runId: run.id,
      runSeed: sha256Canonical({ runId: run.id, packageSha256: content.packageSha256 }),
      nowEpochMs: initializedAt,
    });
    const actions = await tx.playerAction.findMany({
      where: { runId: run.id, actionType: "pressure_action", status: { in: ["accepted", "resolved"] } },
      orderBy: [{ id: "asc" }],
    });
    const prologueAcknowledged = Boolean(record(run.stateJson).pressurePrologueAckV1);
    if (prologueAcknowledged || actions.length > 0 || Number(run.currentDay || 0) >= 1) {
      state = projectP0ToN1(content, state, initializedAt + 1, initializedAt + 600_000).state;
    }
    for (const row of actions) {
      const normalized = record(row.normalizedJson);
      const publicIntent = normalized.publicIntent;
      const compiled = record(record(normalized.compiled).compiledCommand || record(normalized.compiled).command || record(normalized.compiled));
      const previewToken = String(compiled.previewToken || "");
      if (!publicIntent || !previewToken) throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: `Cannot replay action ${row.id}` });
      const confirmed = confirmPressureActionIntent(content, state, publicIntent as PressureActionIntentCommandV1, previewToken);
      if (confirmed.action.command.actionId !== row.id || row.requestHash !== pressureActionRequestFingerprint(publicIntent as PressureActionIntentCommandV1)) {
        throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: `Action replay identity mismatch ${row.id}` });
      }
      state = confirmed.state;
    }
    return createPressureRuntimeCheckpoint(state);
  }

  private assertServerDeadline(state: PressureRuntimeState, nowEpochMs: number): void {
    if (state.phaseDeadlineEpochMs !== null && nowEpochMs >= state.phaseDeadlineEpochMs) {
      throw new ConflictException({ code: "DEADLINE_EXPIRED", message: "The pressure action deadline has passed" });
    }
  }

  private async ensurePersistedRootEventMirror(
    tx: any,
    state: PressureRuntimeState,
    audienceUserIds: string[],
    roleIdBySeat: Record<string, string>,
  ): Promise<void> {
    assertPressureRootEventLedger(state.rootEvents);
    const rows = await tx.storyEvent.findMany({
      where: { runId: state.runId, messageType: "pressure_runtime" },
      orderBy: { sequence: "asc" },
    });
    const byPressureSequence = new Map<number, any>();
    for (const row of rows) {
      if (!isPressureRootEventType(row.type)) {
        throw new ConflictException({ code: "ROOT_EVENT_TYPE_INVALID", message: `Persisted non-root pressure event ${row.type}` });
      }
      const payload = record(row.payloadJson);
      const sequence = Number(payload.pressureEventSequence);
      if (!Number.isSafeInteger(sequence) || sequence < 1 || byPressureSequence.has(sequence)) {
        throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: "Persisted pressure event sequence is invalid" });
      }
      byPressureSequence.set(sequence, row);
    }
    for (const event of state.rootEvents) {
      const row = byPressureSequence.get(event.sequence);
      if (!row) continue;
      const payload = record(row.payloadJson);
      if (
        row.type !== event.type
        || row.dedupeKey !== event.dedupeKey
        || String(payload.pressureEventId || "") !== event.eventId
        || String(payload.phase || "") !== event.phase
        || sha256Canonical(payload.payload || {}) !== sha256Canonical(event.payload)
        || sha256Canonical(payload.sourceActionIds || []) !== sha256Canonical(event.sourceActionIds)
      ) {
        throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: `Persisted pressure event drift at ${event.sequence}` });
      }
    }
    const unknownSequences = [...byPressureSequence.keys()].filter((sequence) => sequence > state.rootEvents.length);
    if (unknownSequences.length) {
      throw new ConflictException({ code: "RECOVERY_CHECKPOINT_INVALID", message: "Persisted pressure ledger is ahead of checkpoint" });
    }
    const missing = state.rootEvents.filter((event) => !byPressureSequence.has(event.sequence));
    for (const event of missing) {
      await this.deliveries.publishPressureRootEvents(tx, {
        events: [event],
        audienceUserIds,
        roleIdBySeatId: roleIdBySeat,
        day: state.nodeSequence,
      });
    }
  }

  private async persistMissingSealedActions(
    tx: any,
    window: any,
    content: PressureRuntimeContent,
    before: PressureRuntimeState,
    after: PressureRuntimeState,
  ): Promise<void> {
    const roleMap = roleIdBySeatId(content, window.run.roles);
    for (const actionId of Object.keys(after.sealedActions).sort()) {
      if (before.sealedActions[actionId]) continue;
      const action = after.sealedActions[actionId];
      const command = action.command;
      const existing = await tx.playerAction.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (existing) {
        if (existing.id !== actionId || existing.requestHash !== command.requestFingerprint) {
          throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "Persisted default action identity drifted" });
        }
        continue;
      }
      const roleId = roleMap[command.seatId];
      await tx.playerAction.create({
        data: {
          id: actionId,
          runId: window.runId,
          nodeId: window.nodeId,
          chapterIndex: window.node.chapterIndex,
          userId: null,
          roleId,
          playerType: command.isDefault ? "timeout" : "ai",
          actionType: "pressure_action",
          targetType: command.targetObjectId ? "object" : "pressure",
          targetId: command.targetObjectId,
          targetText: command.targetObjectId,
          method: command.intentText,
          intent: command.intentText,
          riskLevel: "normal",
          normalizedJson: {
            actionId,
            publicIntent: command.sourceIntent,
            compiled: safeActionJson(action),
          } as Prisma.InputJsonValue,
          guardStatus: "ok",
          auditStatus: "ok",
          status: "accepted",
          actionSlot: actionSlotToLegacy(command.slot),
          actorKind: command.isDefault ? "TIMEOUT_FALLBACK" : "AI_TAKEOVER",
          controlEpoch: command.controlEpoch,
          policyVersion: command.policyVersion,
          provider: "rules",
          modelName: "pressure-kernel-v1",
          actionKey: command.type,
          idempotencyKey: command.idempotencyKey,
          requestHash: command.requestFingerprint,
          visibility: command.visibility,
          targetRoleId: command.targetSeatId ? roleMap[command.targetSeatId] || null : null,
          sealedAt: new Date(action.sealedAt),
          immediateJson: {
            schemaVersion: "pressure_action_receipt_v1",
            actionId,
            defaultPolicyId: command.defaultPolicyId || null,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.actionWindowParticipant.update({
        where: { windowId_roleId: { windowId: window.id, roleId } },
        data: participantPatch(command.slot),
      });
    }
  }

  private assertUserSeat(
    user: AuthenticatedUser,
    rawIntent: unknown,
    memberships: Array<{ userId: string | null; roleId: string | null }>,
    roles: Array<{ id: string; roleKey: string }>,
    content: PressureRuntimeContent,
  ): void {
    const preview = record(rawIntent);
    const seatId = String(preview.seatId || "");
    const seat = content.nodes.N1.seats.find((entry) => entry.seatId === seatId)
      || content.nodes.P0.seats.find((entry) => entry.seatId === seatId);
    if (!seat) throw new BadRequestException({ code: "ROLE_FORBIDDEN", message: "Unknown pressure seat" });
    const role = roles.find((entry) => entry.roleKey === seat.roleKey);
    const membership = memberships.find((entry) => entry.userId === user.id && entry.roleId === role?.id);
    if (!role || !membership) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "User does not control this pressure seat" });
  }
}
