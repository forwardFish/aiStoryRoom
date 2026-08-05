import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { getGameDefinition } from "@ai-story/templates";
import type { TurnDecisionCommandV2 } from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { readCreditConsumptionConfig, policyForNewRun } from "../config/credit-consumption.config";
import {
  classifyCreditAction,
  creditRequestHash,
  parseRunBilling,
  priceForCreditAction,
} from "../credits/credit-policy";
import { CreditConsumptionService } from "../credits/credit-consumption.service";
import { PrismaService } from "../prisma.service";
import { StoryService } from "../story.service";
import {
  OPENOVEL_ENGINE_VERSION,
  OPENOVEL_PROJECTION_SCHEMA,
  OPENOVEL_RUNTIME_MODE,
  OpenNovelRuntimeClient,
  type OpenNovelPublicRun,
  type OpenNovelTurnEvent,
} from "./openovel-runtime.client";
import { openNovelGameProjection } from "./openovel-game-projection";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,160}$/;
const STRATEGY_VERSION = "openovel_first_v1";

type CreateRunInput = {
  idempotencyKey?: string;
  worldId?: string;
  roleKey?: string;
};

type SubmitActionInput = {
  action?: string;
  idempotencyKey?: string;
  boundOption?: {
    id?: string;
    label?: string;
  } | null;
  expectedStateRevision?: number;
};

export type OpenNovelMirrorEvent = {
  kind?: string;
  runId?: string;
  payload?: unknown;
};

@Injectable()
export class OpenNovelAdapterService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StoryService) private readonly story: StoryService,
    @Inject(CreditConsumptionService) private readonly creditConsumption: CreditConsumptionService,
    @Inject(OpenNovelRuntimeClient) private readonly runtime: OpenNovelRuntimeClient,
  ) {}

  async createRun(user: AuthenticatedUser, input: CreateRunInput) {
    this.assertEnabled();
    const product = resolveProduct(input.worldId, input.roleKey);
    const idempotencyKey = requiredIdempotency(input.idempotencyKey);
    const runId = openNovelRunId(user.id, idempotencyKey);
    const existing = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: {
        players: { where: { userId: user.id }, include: { role: true } },
      },
    });
    if (existing) {
      this.assertRunOwner(existing, user);
      const runtimeRun = await this.runtime.createRun(runtimeCreateInput(runId, product));
      await this.persistRunMirror(existing, runtimeRun);
      return this.projection(existing, runtimeRun);
    }

    // The file workspace is the OpenNovel story authority. Seeding it before
    // database creation also means a retry can reuse the same deterministic
    // run id without ever invoking the legacy Solo narrator.
    await this.runtime.health();
    const runtimeRun = await this.runtime.createRun(runtimeCreateInput(runId, product));
    const creditConfig = readCreditConsumptionConfig();
    const billingPolicyVersion = policyForNewRun(creditConfig.defaultPolicy, OPENOVEL_ENGINE_VERSION);
    const billingPriceJson = creditConfig.prices;
    let runCharge: any = null;
    if (billingPolicyVersion === "active_action_v1") {
      runCharge = await this.creditConsumption.reserveCharge({
        runId,
        beneficiaryUserId: user.id,
        chargeType: "RUN_CREATE",
        actionClass: "RUN_CREATE",
        amount: billingPriceJson.runCreate,
        idempotencyKey: `openovel-run:${user.id}:${idempotencyKey}`,
        requestHash: creditRequestHash({ runId, worldId: product.worldId, roleKey: product.roleKey }),
        metadata: {
          engine: OPENOVEL_ENGINE_VERSION,
          worldId: product.worldId,
          roleKey: product.roleKey,
          policyVersion: billingPolicyVersion,
        },
        meteringMode: creditConfig.meteringMode,
      });
      if (runCharge.kind === "insufficient") throw creditsRequired(runCharge);
    }

    try {
      const created = await this.story.createRun(
        user.openid,
        {
          templateId: product.templateId,
          mode: "room",
          maxPlayers: 1,
          aiPlayerCount: 0,
          ownerAsPlayer: true,
        },
        {
          engineVersion: OPENOVEL_ENGINE_VERSION,
          strategyVersion: STRATEGY_VERSION,
          runId,
          billingPolicyVersion,
          billingPriceJson,
        },
      );
      const role = created.roles.find((item: any) => item.roleKey === product.roleKey);
      if (!role) throw new Error("OPENOVEL_GOVERNOR_ROLE_MISSING");
      await this.story.claimRole(user.openid, runId, role.id);
      const saved = await this.prisma.storyRun.update({
        where: { id: runId },
        data: {
          selectedRoleKey: product.roleKey,
          status: "playing",
          currentDay: 0,
          completedNodeCount: 0,
          stateJson: openNovelState(created.stateJson, runtimeRun) as any,
        },
        include: {
          players: { where: { userId: user.id }, include: { role: true } },
        },
      });
      await this.prisma.eventLog.create({
        data: {
          userId: user.id,
          runId,
          eventName: "openovel_run_created",
          source: OPENOVEL_ENGINE_VERSION,
          payload: {
            runtimeMode: OPENOVEL_RUNTIME_MODE,
            upstreamRunStatus: runtimeRun.status,
            turnNumber: 0,
          },
        },
      });
      if (runCharge?.kind === "reserved") await this.creditConsumption.commitCharge(runCharge.charge.id);
      return this.projection(saved, runtimeRun);
    } catch (error) {
      if (runCharge?.kind === "reserved") {
        await this.creditConsumption.releaseCharge(runCharge.charge.id, errorCode(error)).catch(() => undefined);
      }
      throw error;
    }
  }

  async getRun(user: AuthenticatedUser, runId: string) {
    this.assertEnabled();
    const run = await this.authorizedRun(user, runId);
    const runtimeRun = await this.runtime.getRun(runId);
    if (mirrorTurn(run.stateJson) !== runtimeRun.turnNumber) {
      await this.persistRunMirror(run, runtimeRun);
    }
    return this.projection(run, runtimeRun);
  }

  async createProductRun(user: AuthenticatedUser, input: CreateRunInput) {
    const created = await this.createRun(user, input);
    return {
      id: created.runId,
      runId: created.runId,
      roomId: created.runId,
      gameProjection: await this.game(user, created.runId),
    };
  }

  async game(user: AuthenticatedUser, runId: string) {
    this.assertEnabled();
    const run = await this.authorizedRun(user, runId);
    const [runtimeRun, nodes, creditAvailability] = await Promise.all([
      this.runtime.getRun(runId),
      this.prisma.sceneNode.findMany({
        where: { runId, status: "resolved" },
        orderBy: [{ nodeIndex: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          nodeIndex: true,
          title: true,
          publicNarration: true,
          resolvedAt: true,
          createdAt: true,
        },
      }),
      this.creditConsumption.availableForRun(runId, user.id),
    ]);
    const creditConfig = readCreditConsumptionConfig();
    const billing = parseRunBilling(run, creditConfig.prices);
    return openNovelGameProjection({
      userId: user.id,
      run,
      runtimeRun,
      game: getGameDefinition(run.templateKey),
      nodes,
      credits: {
        policyVersion: billing.policyVersion,
        meteringMode: creditConfig.meteringMode,
        available: creditAvailability.available,
        personalAvailable: creditAvailability.personalAvailable,
        runAllowanceAvailable: creditAvailability.runAllowanceAvailable,
        standardActionCost: billing.prices.standardAction,
        customActionCost: billing.prices.customAction,
      },
    });
  }

  async result(user: AuthenticatedUser, runId: string) {
    this.assertEnabled();
    const run = await this.authorizedRun(user, runId);
    const runtimeRun = await this.runtime.getRun(runId);
    if (runtimeRun.status !== "COMPLETED" || !runtimeRun.ending) {
      throw new ConflictException({
        code: "RESULT_NOT_READY",
        message: "The protagonist ending is available after the story is complete.",
      });
    }
    const membership = run.players.find((player: any) => player.userId === user.id);
    const role = membership?.role;
    const ending = runtimeRun.ending;
    return {
      room: {
        id: run.id,
        title: run.title,
        worldId: run.templateKey,
        completedAt: runtimeRun.updatedAt,
      },
      chapter: {
        title: ending.title,
        content: [
          ending.finalSceneNarrative,
          `主角命运：${ending.protagonistFate}`,
          ...ending.aftermath,
        ].filter(Boolean).join("\n\n"),
        highlights: [],
      },
      player: role ? {
        roleName: role.roleName,
        personalGoal: role.personalGoal,
        endingTitle: ending.title,
        protagonistFate: ending.protagonistFate,
      } : null,
      ending,
      completedNodes: runtimeRun.turnNumber,
    };
  }

  async submitDecision(
    user: AuthenticatedUser,
    runId: string,
    turnId: string,
    command: TurnDecisionCommandV2,
  ) {
    const idempotencyKey = requiredIdempotency(command.idempotencyKey);
    const replayKey = `openovel-action:${runId}:${user.id}:${idempotencyKey}`;
    const replay = await this.prisma.playerAction.findUnique({ where: { idempotencyKey: replayKey } });
    if (replay) {
      await this.authorizedRun(user, runId);
      const customAction = String(command.customAction || "").trim();
      const storedBoundOption = normalizeBoundOption(asRecord(replay.immediateJson).boundOption);
      const matchesOriginalRequest = replay.runId === runId
        && replay.userId === user.id
        && String(asRecord(replay.resolvedJson).turnId || turnId) === turnId
        && (customAction
          ? !storedBoundOption && String(replay.freeText || replay.method || "") === customAction
          : Boolean(storedBoundOption) && storedBoundOption!.id === String(command.candidateId || ""));
      if (!matchesOriginalRequest) {
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "That action key belongs to a different request.",
        });
      }
      if (replay.status === "resolved" && replay.resolvedJson) {
        const result = replay.resolvedJson as any;
        return {
          accepted: true as const,
          resolution: {
            id: String(result.turnId || turnId),
            appliedWorldSequence: Number(result.turnNumber || 0),
            resultNarrative: String(result.narration || ""),
            nextHook: "",
          },
          gameProjection: await this.game(user, runId),
        };
      }
      throw new ConflictException({
        code: "OPENOVEL_ACTION_IN_PROGRESS",
        message: "That action is still being processed.",
      });
    }

    const runtimeBefore = await this.runtime.getRun(runId);
    const expectedTurnId = `T${String(runtimeBefore.turnNumber + 1).padStart(2, "0")}`;
    if (turnId !== expectedTurnId || command.turnRevision !== runtimeBefore.turnNumber) {
      throw new ConflictException({
        code: "TURN_MOVED",
        message: "The story has already moved to a newer turn.",
      });
    }
    const customAction = String(command.customAction || "").trim();
    const selected = customAction
      ? null
      : runtimeBefore.options.find((option) => option.id === command.candidateId) || null;
    if (!customAction && !selected) {
      throw new BadRequestException({
        code: "OPENOVEL_OPTION_INVALID",
        message: "Choose one of the current story actions.",
      });
    }
    const action = customAction || selected!.label;
    const result = await this.submitAction(user, runId, {
      action,
      idempotencyKey,
      expectedStateRevision: command.turnRevision,
      boundOption: selected ? { id: selected.id, label: selected.label } : null,
    }, () => undefined);
    return {
      accepted: true as const,
      resolution: {
        id: String(result.turnId || expectedTurnId),
        appliedWorldSequence: Number(result.turnNumber || runtimeBefore.turnNumber + 1),
        resultNarrative: String(result.narration || ""),
        nextHook: "",
      },
      gameProjection: await this.game(user, runId),
    };
  }

  async submitAction(
    user: AuthenticatedUser,
    runId: string,
    input: SubmitActionInput,
    onEvent: (event: OpenNovelTurnEvent) => void | Promise<void>,
  ) {
    this.assertEnabled();
    const run = await this.authorizedRun(user, runId);
    const action = String(input.action || "").trim();
    if (!action) throw new BadRequestException({ code: "OPENOVEL_ACTION_REQUIRED", message: "Choose or enter an action." });
    if (action.length > 2_000) throw new BadRequestException({ code: "OPENOVEL_ACTION_TOO_LONG", message: "The action is too long." });
    const idempotencyKey = requiredIdempotency(input.idempotencyKey);
    const boundOption = normalizeBoundOption(input.boundOption);
    const requestHash = creditRequestHash({ runId, action, boundOption });
    const actionIdempotencyKey = `openovel-action:${runId}:${user.id}:${idempotencyKey}`;
    const replay = await this.prisma.playerAction.findUnique({ where: { idempotencyKey: actionIdempotencyKey } });
    if (replay) {
      if (replay.runId !== runId || replay.userId !== user.id || replay.requestHash !== requestHash) {
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "That action key belongs to a different request." });
      }
      if (replay.status === "resolved" && replay.resolvedJson) {
        const result = replay.resolvedJson as any;
        await onEvent({ type: "turn.committed", data: result });
        return result;
      }
      throw new ConflictException({ code: "OPENOVEL_ACTION_IN_PROGRESS", message: "That action is still being processed." });
    }

    const runtimeBefore = await this.runtime.getRun(runId);
    const nextTurn = runtimeBefore.turnNumber + 1;
    const role = run.players[0]?.role;
    if (!role || role.roleKey !== run.selectedRoleKey || runtimeBefore.roleId !== role.roleKey) {
      throw new ForbiddenException({
        code: "OPENOVEL_ROLE_REQUIRED",
        message: "The player must control the role selected for this story run.",
      });
    }
    const syntheticNode = await this.prisma.sceneNode.create({
      data: {
        runId,
        chapterIndex: 1,
        nodeIndex: syntheticNodeIndex(nextTurn, idempotencyKey),
        title: `OpenNovel Turn ${nextTurn}`,
        publicNarration: runtimeBefore.recentCanon,
        nodeGoal: action,
        status: "resolving",
        actionOptionsJson: runtimeBefore.options as any,
      },
    });
    const playerAction = await this.prisma.playerAction.create({
      data: {
        runId,
        nodeId: syntheticNode.id,
        chapterIndex: 1,
        userId: user.id,
        roleId: role.id,
        playerType: "human",
        actionType: boundOption ? "openovel_option" : "openovel_free_text",
        method: action,
        intent: action,
        freeText: boundOption ? null : action,
        riskLevel: "normal",
        guardStatus: "shadow",
        auditStatus: "shadow",
        status: "generating",
        actionSlot: "MAIN",
        actorKind: "HUMAN",
        provider: OPENOVEL_ENGINE_VERSION,
        actionKey: boundOption?.id || null,
        idempotencyKey: actionIdempotencyKey,
        requestHash,
        immediateJson: { boundOption } as any,
      },
    });

    const creditConfig = readCreditConsumptionConfig();
    const billing = parseRunBilling(run, creditConfig.prices);
    const actionClass = classifyCreditAction({
      actorKind: "HUMAN",
      candidateId: boundOption?.id,
      customAction: boundOption ? undefined : action,
      decisionForm: "STORY_CHOICE",
      operation: "MAIN",
    });
    const amount = billing.policyVersion === "active_action_v1"
      ? priceForCreditAction(actionClass, billing.prices)
      : 0;
    let charge: any = null;
    if (amount > 0) {
      charge = await this.creditConsumption.reserveCharge({
        runId,
        beneficiaryUserId: user.id,
        playerActionId: playerAction.id,
        chargeType: "PLAYER_ACTION",
        actionClass,
        amount,
        idempotencyKey: `openovel-charge:${runId}:${shortHash(`${user.id}\0${idempotencyKey}`)}`,
        requestHash,
        metadata: {
          engine: OPENOVEL_ENGINE_VERSION,
          turnNumber: nextTurn,
          boundOptionId: boundOption?.id || null,
        },
        meteringMode: creditConfig.meteringMode,
      });
      if (charge.kind === "insufficient") {
        await this.prisma.$transaction([
          this.prisma.playerAction.update({ where: { id: playerAction.id }, data: { status: "rejected" } }),
          this.prisma.sceneNode.update({ where: { id: syntheticNode.id }, data: { status: "open_for_actions" } }),
        ]);
        throw creditsRequired(charge);
      }
    }

    let committed: any = null;
    try {
      committed = await this.runtime.streamAction(
        {
          runId,
          action,
          submissionId: playerAction.id,
          expectedStateRevision: input.expectedStateRevision,
          boundOption,
        },
        async (event) => {
          // Hold the final commit marker until the database mirror and charge
          // are settled. Narration and options remain truly streamed.
          if (event.type !== "turn.committed") await onEvent(event);
        },
      );
      const runtimeAfter = await this.runtime.getRun(runId);
      await this.persistCommittedTurn({
        userId: user.id,
        run,
        runtimeAfter,
        result: committed,
        nodeId: syntheticNode.id,
        playerActionId: playerAction.id,
      });
      if (charge?.kind === "reserved") await this.creditConsumption.commitCharge(charge.charge.id);
      await onEvent({ type: "turn.committed", data: committed });
      return committed;
    } catch (error) {
      if (!committed) {
        await this.prisma.$transaction([
          this.prisma.playerAction.updateMany({
            where: { id: playerAction.id, status: "generating" },
            data: { status: "failed", resolvedJson: { code: errorCode(error) } as any },
          }),
          this.prisma.sceneNode.updateMany({
            where: { id: syntheticNode.id, status: "resolving" },
            data: { status: "generation_failed" },
          }),
        ]).catch(() => undefined);
        if (charge?.kind === "reserved") {
          await this.creditConsumption.releaseCharge(charge.charge.id, errorCode(error)).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async applyMirrorEvent(input: OpenNovelMirrorEvent) {
    const kind = String(input.kind || "").trim();
    const runId = String(input.runId || "").trim();
    if (!runId || !/^solo_ovl_[a-f0-9]{32}$/.test(runId)) {
      throw new BadRequestException({
        code: "OPENOVEL_MIRROR_RUN_INVALID",
        message: "The mirror event has an invalid run id.",
      });
    }
    if (kind === "run.created" || kind === "runtime.warning") {
      return { accepted: true, applied: false, kind };
    }
    if (kind !== "turn.committed") {
      throw new BadRequestException({
        code: "OPENOVEL_MIRROR_KIND_INVALID",
        message: "The mirror event kind is not supported.",
      });
    }

    const payload = asRecord(input.payload);
    const submissionId = String(payload.submissionId || "").trim();
    const result = publicTurnResult(asRecord(payload.result));
    if (
      !submissionId
      || String(result.runId || "") !== runId
      || !/^T\d{2,}$/.test(String(result.turnId || ""))
      || !Number.isInteger(Number(result.turnNumber))
    ) {
      throw new BadRequestException({
        code: "OPENOVEL_MIRROR_PAYLOAD_INVALID",
        message: "The committed turn mirror payload is incomplete.",
      });
    }

    const [run, action, runtimeAfter] = await Promise.all([
      this.prisma.storyRun.findUnique({ where: { id: runId } }),
      this.prisma.playerAction.findUnique({ where: { id: submissionId } }),
      this.runtime.getRun(runId),
    ]);
    if (!run) {
      throw new NotFoundException({
        code: "OPENOVEL_MIRROR_RUN_NOT_FOUND",
        message: "The mirrored run is not yet available.",
      });
    }
    if (!action || action.runId !== runId) {
      throw new NotFoundException({
        code: "OPENOVEL_MIRROR_ACTION_NOT_FOUND",
        message: "The mirrored player action is not yet available.",
      });
    }
    if (runtimeAfter.turnNumber < Number(result.turnNumber)) {
      throw new ConflictException({
        code: "OPENOVEL_MIRROR_RUNTIME_BEHIND",
        message: "The runtime has not exposed the committed turn yet.",
      });
    }

    const applied = await this.persistCommittedTurn({
      userId: run.ownerUserId,
      run,
      runtimeAfter,
      result,
      nodeId: action.nodeId,
      playerActionId: action.id,
    });
    const charge = await this.prisma.creditCharge?.findUnique?.({
      where: { playerActionId: action.id },
    });
    if (charge?.status === "RESERVED") {
      await this.creditConsumption.commitCharge(charge.id);
    }
    return {
      accepted: true,
      applied,
      kind,
      runId,
      turnId: result.turnId,
    };
  }

  private async authorizedRun(user: AuthenticatedUser, runId: string) {
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: {
        players: { where: { userId: user.id }, include: { role: true } },
      },
    });
    if (!run) throw new NotFoundException({ code: "OPENOVEL_RUN_NOT_FOUND", message: "Story run not found." });
    this.assertRunOwner(run, user);
    return run;
  }

  private assertRunOwner(run: any, user: AuthenticatedUser) {
    if (run.ownerUserId !== user.id || !run.players?.some((item: any) => item.userId === user.id)) {
      throw new ForbiddenException({ code: "OPENOVEL_RUN_ACCESS_DENIED", message: "This story belongs to another player." });
    }
    if (run.engineVersion !== OPENOVEL_ENGINE_VERSION) {
      throw new ConflictException({ code: "OPENOVEL_RUNTIME_MISMATCH", message: "This run does not use OpenNovel-First." });
    }
  }

  private async persistRunMirror(run: any, runtimeRun: OpenNovelPublicRun) {
    return this.prisma.storyRun.update({
      where: { id: run.id },
      data: {
        status: productRunStatus(runtimeRun.status),
        currentDay: runtimeRun.turnNumber,
        completedNodeCount: runtimeRun.turnNumber,
        stateJson: openNovelState(run.stateJson, runtimeRun) as any,
        version: { increment: 1 },
      },
    });
  }

  private async persistCommittedTurn(input: {
    userId: string;
    run: any;
    runtimeAfter: OpenNovelPublicRun;
    result: any;
    nodeId: string;
    playerActionId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.storyRun.findUnique({ where: { id: input.run.id }, select: { stateJson: true } });
      if (!fresh) throw new Error("OPENOVEL_RUN_DISAPPEARED");
      const claimed = await tx.playerAction.updateMany({
        where: {
          id: input.playerActionId,
          status: { in: ["generating", "failed"] },
        },
        data: {
          status: "resolved",
          resolvedJson: input.result as any,
          resolvedAt: new Date(input.result.committedAt || Date.now()),
        },
      });
      if (claimed.count === 0) {
        const existing = await tx.playerAction.findUnique({
          where: { id: input.playerActionId },
          select: { status: true },
        });
        if (existing?.status === "resolved") return false;
        throw new Error("OPENOVEL_MIRROR_ACTION_NOT_RECOVERABLE");
      }
      await tx.sceneNode.update({
        where: { id: input.nodeId },
        data: {
          publicNarration: String(input.result.narration || input.runtimeAfter.recentCanon),
          actionOptionsJson: input.runtimeAfter.options as any,
          status: "resolved",
          resolvedAt: new Date(input.result.committedAt || Date.now()),
        },
      });
      await tx.storyRun.update({
        where: { id: input.run.id },
        data: {
          status: productRunStatus(input.runtimeAfter.status),
          currentDay: input.runtimeAfter.turnNumber,
          completedNodeCount: input.runtimeAfter.turnNumber,
          currentNodeId: input.nodeId,
          stateJson: openNovelState(fresh.stateJson, input.runtimeAfter) as any,
          version: { increment: 1 },
        },
      });
      await tx.eventLog.create({
        data: {
          userId: input.userId,
          runId: input.run.id,
          nodeId: input.nodeId,
          actionId: input.playerActionId,
          eventName: "openovel_turn_committed",
          source: OPENOVEL_ENGINE_VERSION,
          payload: {
            turnId: input.result.turnId,
            turnNumber: input.result.turnNumber,
            narration: input.result.narration,
            options: input.runtimeAfter.options,
            warnings: input.result.warnings || [],
            narrator: publicModelUsage(input.result.narrator),
            optionsProvider: publicModelUsage(input.result.optionsProvider),
            committedAt: input.result.committedAt,
          },
        },
      });
      return true;
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  private projection(run: any, runtimeRun: OpenNovelPublicRun) {
    return {
      schemaVersion: OPENOVEL_PROJECTION_SCHEMA,
      runId: run.id,
      worldId: runtimeRun.worldId,
      roleId: runtimeRun.roleId,
      runtimeMode: runtimeRun.runtimeMode,
      turnNumber: runtimeRun.turnNumber,
      status: runtimeRun.status,
      canon: runtimeRun.canon,
      recentCanon: runtimeRun.recentCanon,
      prologueNarrative: runtimeRun.prologueNarrative,
      ending: runtimeRun.ending || null,
      options: runtimeRun.options,
      updatedAt: runtimeRun.updatedAt,
      billing: {
        policyVersion: run.billingPolicyVersion,
        prices: run.billingPriceJson,
      },
    };
  }

  private assertEnabled() {
    if (process.env.NODE_ENV === "production" && String(process.env.OPENOVEL_V1_ENABLED || "") !== "1") {
      throw new ForbiddenException({ code: "OPENOVEL_V1_DISABLED", message: "OpenNovel-First is not enabled." });
    }
  }
}

export function openNovelRunId(userId: string, idempotencyKey: string) {
  return `solo_ovl_${createHash("sha256").update(`${userId}\0${idempotencyKey}`).digest("hex").slice(0, 32)}`;
}

function productRunStatus(runtimeStatus: string) {
  if (runtimeStatus === "COMPLETED") return "chapter_generated";
  if (runtimeStatus === "FAILED") return "resolving";
  return "playing";
}

function runtimeCreateInput(runId: string, product: ReturnType<typeof resolveProduct>) {
  return {
    runId,
    worldId: product.worldId,
    roleId: product.roleKey,
    storyPackageVersion: product.storyPackageVersion,
    openingVersion: product.openingVersion,
  };
}

function resolveProduct(worldIdValue: unknown, roleKeyValue: unknown) {
  const worldId = String(worldIdValue || "sangtian");
  const game = getGameDefinition(worldId);
  if (game.engine.soloEngineVersion !== OPENOVEL_ENGINE_VERSION || !game.engine.soloRuntime) {
    throw new ConflictException({
      code: "OPENOVEL_PRODUCT_NOT_CONFIGURED",
      message: "This world is not configured for the OpenNovel Solo runtime.",
    });
  }
  const roleKey = String(roleKeyValue || game.roles[0]?.roleKey || "");
  if (!game.roles.some((role) => role.roleKey === roleKey && role.canBeHumanControlled)) {
    throw new BadRequestException({ code: "ROLE_NOT_FOUND", message: "That Solo role is not available." });
  }
  return {
    worldId,
    roleKey,
    templateId: game.templateId,
    storyPackageVersion: game.engine.soloRuntime.storyPackageVersion,
    openingVersion: game.engine.soloRuntime.openingVersion,
  };
}

function syntheticNodeIndex(turnNumber: number, idempotencyKey: string) {
  const suffix = Number.parseInt(shortHash(idempotencyKey).slice(0, 6), 16) % 997;
  return 10_000 + (turnNumber * 1_000) + suffix;
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function requiredIdempotency(value: unknown) {
  const key = String(value || "").trim();
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new BadRequestException({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "A stable idempotencyKey of 8–160 characters is required.",
    });
  }
  return key;
}

function normalizeBoundOption(value: SubmitActionInput["boundOption"]) {
  if (!value) return null;
  const id = String(value.id || "").trim();
  const label = String(value.label || "").trim();
  if (!id || !label) throw new BadRequestException({ code: "OPENOVEL_OPTION_INVALID", message: "The selected action is incomplete." });
  return { id, label };
}

function openNovelState(previous: unknown, runtimeRun: OpenNovelPublicRun) {
  const root = asRecord(previous);
  return {
    ...root,
    openovel: {
      runtimeMode: runtimeRun.runtimeMode,
      turnNumber: runtimeRun.turnNumber,
      status: runtimeRun.status,
      canon: runtimeRun.canon,
      recentCanon: runtimeRun.recentCanon,
      prologueNarrative: runtimeRun.prologueNarrative || "",
      ending: runtimeRun.ending || null,
      options: runtimeRun.options,
      updatedAt: runtimeRun.updatedAt,
    },
  };
}

function mirrorTurn(state: unknown) {
  return Number(asRecord(asRecord(state).openovel).turnNumber || -1);
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function creditsRequired(result: any) {
  return new HttpException({
    code: "WORLD_CREDITS_REQUIRED",
    message: "More World Credits are required for this action.",
    required: result.required,
    available: result.available,
    runAllowanceAvailable: result.runAllowanceAvailable,
    personalAvailable: result.personalAvailable,
  }, 402);
}

function publicModelUsage(value: any) {
  if (!value) return null;
  return {
    model: value.model,
    requestId: value.requestId,
    usage: value.usage,
    latencyMs: value.latencyMs,
  };
}

function publicTurnResult(value: Record<string, any>): Record<string, any> {
  return {
    ...value,
    options: Array.isArray(value.options)
      ? value.options.map((option: unknown) => {
          const record = asRecord(option);
          return {
            id: String(record.id || ""),
            label: String(record.label || ""),
            ...(record.key === true ? { key: true } : {}),
          };
        })
      : [],
  };
}

function errorCode(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === "object" && "code" in response) return String((response as any).code);
  }
  return String((error as any)?.code || (error as Error)?.message || "OPENOVEL_ACTION_FAILED").slice(0, 120);
}
