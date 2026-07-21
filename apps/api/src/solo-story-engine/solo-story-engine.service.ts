import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ControlCommandV1, HeartbeatCommandV1, TurnDecisionCommandV2, TurnDecisionResponseV2 } from "@ai-story/shared";
import {
  buildStoryPackageRoleView,
  evaluateStoryPackageDirector,
  loadStoryPackage,
  type LoadedRuntimeStoryPackage,
  type StoryPackageCard
} from "@ai-story/templates";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { sha256Canonical } from "../continuous-strategy/canonical";
import { PrismaService } from "../prisma.service";
import { readCreditConsumptionConfig } from "../config/credit-consumption.config";
import { CreditConsumptionService } from "../credits/credit-consumption.service";
import { classifyCreditAction, parseRunBilling, priceForCreditAction } from "../credits/credit-policy";
import {
  SOLO_STORY_CONTEXT_VERSION,
  SOLO_STORY_ENGINE_VERSION,
  SOLO_STORY_PROMPT_CONTRACT_VERSION,
  SOLO_STORY_STRATEGY_VERSION
} from "./constants";
import { SoloDeepSeekTransport } from "./deepseek-transport";
import { operationalMetrics } from "../observability/operational-metrics";
import { executeSoloStoryOpening, executeSoloStoryTurn } from "./single-call-executor";
import { normalizePlayerIntent } from "./player-intent";
import { validatePlayerIntent } from "./local-validator";
import { buildDecisionCandidates, commandToRawPlayerAction, type SoloAvailableTarget } from "./runtime-mapper";
import { buildSoloStoryProjection } from "./solo-story-projection";
import type {
  ActivePressure,
  CompiledStoryContext,
  ConfirmedResolution,
  ExecuteSoloStoryFailure,
  PendingConsequence,
  RawPlayerAction,
  RecentCanonEntry,
  ScriptCard,
  StoryFact,
  StoryRole,
  StoryScene,
  StoryTurnClarificationOutput,
  StoryTurnPublishedOutput
} from "./types";

type JsonRecord = Record<string, any>;

type RuntimeInput = {
  loaded: LoadedRuntimeStoryPackage;
  nodeId: string;
  nextNodeId: string;
  role: StoryRole;
  scene: StoryScene;
  facts: StoryFact[];
  recentCanon: RecentCanonEntry[];
  pendingConsequences: PendingConsequence[];
  activePressures: ActivePressure[];
  relevantScriptCards: ScriptCard[];
  availableTargets: SoloAvailableTarget[];
  visibleFactKeys: string[];
};

type ActionReservation = {
  attempt: any;
  submission: any;
  playerAction: any;
  turn: any;
  rawAction: RawPlayerAction;
  creditChargeId: string | null;
};

const OPENING_TRIGGER = {
  triggerId: "sangtian_governor_opening",
  summary: "嘉靖财政危局已经压到杭州总督府案前。把已经在场的人、文书、期限和压力写成浙江总督能亲眼看见的开场；不要替他作出决定。"
};
const MAX_PLAYER_ACTIONS = 7;
const LEASE_MS = 120_000;
const PUBLISH_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

@Injectable()
export class SoloStoryEngineService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditConsumptionService) private readonly creditConsumption: CreditConsumptionService
  ) {}

  async activateNewRun(user: AuthenticatedUser, runId: string) {
    const loaded = loadStoryPackage("sangtian");
    const run = await this.prisma.storyRun.findUnique({
      where: { id: runId },
      include: { players: { where: { userId: user.id }, include: { role: true } }, roles: true }
    });
    if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    const player = run.players[0];
    const role = player?.role;
    if (run.ownerUserId !== user.id || !player || !role) {
      throw new ForbiddenException({ code: "SOLO_OWNER_REQUIRED", message: "只有这局 Solo 的玩家可以启动故事。" });
    }
    if (run.templateKey !== "sangtian" || role.roleKey !== "zhejiang_governor") {
      throw new BadRequestException({ code: "SOLO_STORY_SCOPE_UNSUPPORTED", message: "当前新引擎只开放《嘉靖财政危局》的浙江总督视角。" });
    }
    const state = asRecord(run.stateJson);
    const existingSolo = asRecord(state.soloStory);
    if (run.engineVersion === SOLO_STORY_ENGINE_VERSION && existingSolo.storyPackageHash === loaded.storyPackageSha256) return;

    const seedFacts = [
      { key: "prefact_county_registers_exist", content: "清流县县册与田契档房真实存在，可以依法查验。", visibility: "public" },
      { key: "prefact_governor_can_dispatch", content: "浙江总督有权派遣亲随或幕僚持总督令牌查验地方档房。", visibility: "role_private" },
      { key: "fact_deadline_three_days", content: "朝廷要求浙江总督在三日内交出可以复核的改桑执行方案。", visibility: "public" },
      { key: "fact_grain_price_rising", content: "杭州粮价已连续上涨，米行闭门和百姓聚集正在加重。", visibility: "public" },
      { key: "fact_secret_letter_held", content: "浙江总督亲自看过并持有清流县令密信；密信只暗示县册存在改痕，不等于暗账实物。", visibility: "role_private" }
    ];
    const assets = [
      { key: "county_letter", kind: "DOCUMENT", label: "清流县令密信", quantity: 1 },
      { key: "governor_archive_order", kind: "AUTHORITY", label: "总督封缄令牌", quantity: 1 },
      { key: "governor_memorial_channel", kind: "CHANNEL", label: "总督密奏渠道", quantity: 1 }
    ];
    await this.prisma.$transaction(async (tx) => {
      await tx.storyRun.update({
        where: { id: runId },
        data: {
          engineVersion: SOLO_STORY_ENGINE_VERSION,
          strategyVersion: SOLO_STORY_STRATEGY_VERSION,
          status: "waiting_players",
          maxPlayers: 1,
          activeHumanCount: 1,
          aiPlayerCount: 0,
          stateJson: {
            ...state,
            soloStory: {
              schemaVersion: "solo_story_state_v2",
              storyPackageId: loaded.storyPackage.packageId,
              storyPackageVersion: loaded.storyPackage.packageVersion,
              storyPackageHash: loaded.storyPackageSha256,
              sourceMapHash: loaded.sourceMapSha256,
              currentNodeId: loaded.storyPackage.openingNodeId,
              pendingConsequences: [],
              openingPublished: false,
              lastAttemptId: null,
              lastFailure: null
            }
          } as any,
          version: { increment: 1 }
        }
      });
      await tx.storyRole.updateMany({
        where: { runId, id: { not: role.id } },
        data: { isAiControlled: true, status: "npc" }
      });
      await tx.storyRole.update({ where: { id: role.id }, data: { isAiControlled: false, status: "claimed" } });
      await tx.roleControl.upsert({
        where: { runId_roleId: { runId, roleId: role.id } },
        create: { runId, roleId: role.id, humanPlayerId: player.id, mode: "HUMAN_ACTIVE", epoch: 1, reason: "ROOM_STARTED", lastHeartbeatAt: new Date() },
        update: { humanPlayerId: player.id, mode: "HUMAN_ACTIVE", reason: "ROOM_STARTED", lastHeartbeatAt: new Date() }
      });
      for (const fact of seedFacts) {
        await tx.canonFact.upsert({
          where: { runId_factKey: { runId, factKey: fact.key } },
          create: {
            runId,
            sourceNodeId: run.currentNodeId,
            factKey: fact.key,
            content: fact.content,
            status: "confirmed",
            visibility: fact.visibility,
            sourceEventIdsJson: ["story-package:seed"],
            sourceActionIdsJson: [],
            knownByRoleIdsJson: fact.visibility === "public" ? run.roles.map((item) => item.id) : [role.id]
          },
          update: { content: fact.content, status: "confirmed" }
        });
      }
      for (const asset of assets) {
        await tx.roleAsset.upsert({
          where: { runId_assetKey: { runId, assetKey: asset.key } },
          create: {
            runId,
            assetKey: asset.key,
            kind: asset.kind,
            ownerRoleId: role.id,
            quantity: asset.quantity,
            status: "ACTIVE",
            visibility: "PRIVATE",
            stateJson: { label: asset.label, seededBy: "solo_story_v2" }
          },
          update: { ownerRoleId: role.id, kind: asset.kind, status: "ACTIVE", stateJson: { label: asset.label, seededBy: "solo_story_v2" } }
        });
      }
    });
  }

  async start(user: AuthenticatedUser, runId: string) {
    const actor = await this.requireActor(user, runId);
    const existingTurn = await this.prisma.actorTurn.findFirst({
      where: { runId, roleId: actor.role.id, status: { in: ["OPEN", "RESOLVING"] } },
      orderBy: { turnIndex: "desc" }
    });
    if (existingTurn || actor.run.status === "chapter_generated") return { gameProjection: await this.game(user, runId) };

    const latestFailedOpening = await this.prisma.soloGenerationAttempt.findFirst({
      where: { runId, triggerType: "OPENING", status: "FAILED_RETRYABLE" },
      orderBy: { createdAt: "desc" }
    });
    const failedWithOutput = latestFailedOpening?.parsedOutput ? latestFailedOpening : null;
    const runtime = await this.buildRuntimeInput(actor.run, actor.role, 1);
    if (failedWithOutput) {
      const output = failedWithOutput.parsedOutput as unknown as StoryTurnPublishedOutput;
      await this.publishOpening({ actor, runtime, attempt: failedWithOutput, output, contextHash: failedWithOutput.contextSnapshotHash || "recovered" });
      return { gameProjection: await this.game(user, runId) };
    }

    const previous = await this.latestAttempt(runId, "OPENING");
    if (previous?.status === "GENERATING" && !leaseExpired(previous.leaseExpiresAt)) {
      throw new ConflictException({ code: "STORY_GENERATION_IN_PROGRESS", message: "开场剧情正在生成，请稍候。", attemptId: previous.id });
    }
    const transport = this.createTransportOrThrow();
    const attempt = await this.createAttempt({ runId, triggerType: "OPENING", supersedesAttemptId: previous?.id || null, runtime });
    const startedAt = Date.now();
    const result = await executeSoloStoryOpening({
      attemptId: attempt.id,
      role: runtime.role,
      scene: runtime.scene,
      facts: runtime.facts,
      recentCanon: runtime.recentCanon,
      pendingConsequences: runtime.pendingConsequences,
      activePressures: runtime.activePressures,
      relevantScriptCards: runtime.relevantScriptCards,
      availableTargets: runtime.availableTargets,
      openingTrigger: OPENING_TRIGGER,
      transport,
      onBeforeProviderCall: () => this.reserveProviderCall(attempt.id)
    });
    if (!result.ok) await this.failAttempt(attempt.id, result, startedAt);
    if (!result.ok) throw generationFailure(runId, attempt.id, result);
    await this.persistSuccessfulGeneration(attempt.id, result, startedAt);
    try {
      if (result.output.resultType !== "PUBLISHED_TURN") {
        throw new Error("Opening generation returned a clarification result");
      }
      await this.publishOpening({ actor, runtime, attempt, output: result.output, contextHash: result.context.snapshotHash });
    } catch (error) {
      await this.markPublishFailure(attempt.id, error);
      throw new ServiceUnavailableException({ code: "GENERATION_FAILED_RETRYABLE", message: "剧情已经生成，但发布没有完成；再次确认进入时会直接发布，不会重复调用 DeepSeek。", attemptId: attempt.id });
    }
    return { gameProjection: await this.game(user, runId) };
  }

  async game(user: AuthenticatedUser, runId: string) {
    const actor = await this.requireActor(user, runId);
    const [control, thread, roles, facts, assets, narratives, latestAttempt] = await Promise.all([
      this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId, roleId: actor.role.id } } }),
      this.prisma.actorThread.findUnique({ where: { roleId: actor.role.id } }),
      this.prisma.storyRole.findMany({ where: { runId }, orderBy: { createdAt: "asc" } }),
      this.prisma.canonFact.findMany({ where: { runId, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
      this.prisma.roleAsset.findMany({ where: { runId, OR: [{ ownerRoleId: actor.role.id }, { visibility: "PUBLIC" }] }, orderBy: { createdAt: "asc" } }),
      this.prisma.narrativeEntry.findMany({
        where: { runId, OR: [{ visibility: "public" }, { visibility: "role_private", roleId: actor.role.id }] },
        orderBy: [{ worldSequence: "asc" }, { createdAt: "asc" }]
      }),
      this.prisma.soloGenerationAttempt.findFirst({ where: { runId }, orderBy: { createdAt: "desc" } })
    ]);
    const turn = thread ? await this.prisma.actorTurn.findFirst({
      where: { threadId: thread.id },
      include: { decisionSet: true },
      orderBy: { turnIndex: "desc" }
    }) : null;
    const creditConfig = readCreditConsumptionConfig();
    const billing = parseRunBilling(actor.run, creditConfig.prices);
    const [creditAvailability, sponsorshipRequest] = await Promise.all([
      this.creditConsumption.availableForRun(runId, user.id),
      (this.prisma as any).sponsorshipRequest.findFirst({ where: { runId, beneficiaryUserId: user.id }, orderBy: { createdAt: "desc" } })
    ]);
    return buildSoloStoryProjection({
      run: actor.run,
      player: actor.player,
      role: actor.role,
      control,
      thread,
      turn,
      decisionSet: turn?.decisionSet || null,
      narratives,
      facts,
      assets,
      roles,
      latestAttempt,
      creditControl: {
        policyVersion: billing.policyVersion,
        meteringMode: creditConfig.meteringMode,
        available: creditAvailability.available,
        personalAvailable: creditAvailability.personalAvailable,
        runAllowanceAvailable: creditAvailability.runAllowanceAvailable,
        minimumActionCost: billing.prices.standardAction,
        standardActionCost: billing.prices.standardAction,
        customActionCost: billing.prices.customAction,
        canRequestSponsor: false,
        sponsorshipRequestStatus: sponsorshipRequest?.status || "NONE"
      }
    });
  }

  async submit(user: AuthenticatedUser, runId: string, turnId: string, command: TurnDecisionCommandV2): Promise<TurnDecisionResponseV2> {
    const actor = await this.requireActor(user, runId);
    if (actor.run.status === "chapter_generated") throw new ConflictException({ code: "STORY_COMPLETED", message: "这条故事已经结束。" });
    const turn = await this.prisma.actorTurn.findUnique({ where: { id: turnId }, include: { decisionSet: true, submission: { include: { resolution: true } } } });
    if (!turn || turn.runId !== runId || turn.roleId !== actor.role.id) throw new NotFoundException({ code: "TURN_NOT_FOUND", message: "当前剧情节点不存在。" });
    const control = await this.prisma.roleControl.findUnique({ where: { runId_roleId: { runId, roleId: actor.role.id } } });
    if (!control || control.mode !== "HUMAN_ACTIVE") throw new ForbiddenException({ code: "HUMAN_CONTROL_REQUIRED", message: "当前角色不由玩家控制。" });
    if (Number(command.turnRevision) !== turn.revision || Number(command.controlEpoch) !== control.epoch) {
      throw new ConflictException({ code: "TURN_MOVED", message: "局势已经变化，请按最新剧情重新决定。" });
    }
    const candidates = Array.isArray(turn.decisionSet?.candidatesJson) ? turn.decisionSet.candidatesJson as any[] : [];
    let rawAction: RawPlayerAction;
    try {
      rawAction = commandToRawPlayerAction(command, candidates);
    } catch {
      throw new BadRequestException({ code: "DECISION_CANDIDATE_NOT_FOUND", message: "这个决策已经不属于当前剧情。" });
    }
    const normalized = normalizePlayerIntent(rawAction);
    if (!normalized.ok) throw actionRejected(normalized.issues);
    const runtimeForValidation = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex);
    const validation = validatePlayerIntent(normalized.intent, runtimeForValidation.role, runtimeForValidation.availableTargets);
    if (!validation.ok) throw actionRejected(validation.issues);
    this.assertTargetIsAvailable(rawAction, runtimeForValidation.availableTargets);
    const requestHash = sha256Canonical({ turnId, turnRevision: command.turnRevision, controlEpoch: command.controlEpoch, rawAction });

    if (turn.submission) {
      if (turn.submission.resolution) return this.resolutionResponse(user, runId, turn.submission.resolution);
      if (turn.submission.requestHash !== requestHash) {
        throw new ConflictException({ code: "TURN_ACTION_ALREADY_RESERVED", message: "这一步已经提交过另一项行动；请重试原行动，不能在失败后悄悄改写决定。" });
      }
      const latest = await this.prisma.soloGenerationAttempt.findFirst({ where: { runId, submissionId: turn.submission.id }, orderBy: { createdAt: "desc" } });
      if (latest?.status === "GENERATING" && !leaseExpired(latest.leaseExpiresAt)) {
        throw new ConflictException({ code: "STORY_GENERATION_IN_PROGRESS", message: "这项行动正在推演。", attemptId: latest.id });
      }
      if (turn.submission.idempotencyKey === command.idempotencyKey) {
        throw new ServiceUnavailableException({ code: "GENERATION_FAILED_RETRYABLE", message: "上一次请求失败且没有重复调用模型；请再次点击同一行动或使用明确重试。", attemptId: latest?.id });
      }
      const retry = await this.reserveRetry(actor, turn, turn.submission, rawAction, latest);
      return this.executeActionReservation(user, actor, retry);
    }

    if (turn.status !== "OPEN") throw new ConflictException({ code: "TURN_MOVED", message: "局势已经变化，请刷新后继续。" });
    const reservation = await this.reserveAction(actor, turn, command, rawAction, normalized.intent, requestHash, runtimeForValidation);
    return this.executeActionReservation(user, actor, reservation);
  }

  async retryLatest(user: AuthenticatedUser, runId: string) {
    const actor = await this.requireActor(user, runId);
    const failed = await this.prisma.soloGenerationAttempt.findFirst({ where: { runId, status: "FAILED_RETRYABLE" }, orderBy: { createdAt: "desc" } });
    if (!failed) throw new ConflictException({ code: "NO_RETRYABLE_GENERATION", message: "当前没有需要重试的剧情生成。" });
    if (failed.triggerType === "OPENING") return this.start(user, runId);
    if (!failed.submissionId || !failed.actorTurnId) throw new ConflictException({ code: "RETRY_CONTEXT_MISSING", message: "失败记录缺少行动上下文。" });
    const submission = await this.prisma.decisionSubmission.findUnique({ where: { id: failed.submissionId } });
    const turn = await this.prisma.actorTurn.findUnique({ where: { id: failed.actorTurnId } });
    if (!submission || !turn) throw new ConflictException({ code: "RETRY_CONTEXT_MISSING", message: "失败记录关联的行动已经不存在。" });
    if (failed.parsedOutput) {
      const runtime = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex);
      const resolution = asRecord(failed.confirmedResolutionJson) as ConfirmedResolution;
      const playerAction = await this.prisma.playerAction.findUniqueOrThrow({ where: { id: submission.playerActionId! } });
      const charge = await (this.prisma as any).creditCharge.findUnique({ where: { playerActionId: playerAction.id } });
      const response = await this.publishAction({ actor, runtime, reservation: { attempt: failed, submission, playerAction, turn, rawAction: submission.rawIntentJson as unknown as RawPlayerAction, creditChargeId: charge?.id || null }, output: failed.parsedOutput as unknown as StoryTurnPublishedOutput, actionResolution: resolution, contextHash: failed.contextSnapshotHash || "recovered" });
      return { accepted: true, resolution: response, gameProjection: await this.game(user, runId) };
    }
    const reservation = await this.reserveRetry(actor, turn, submission, submission.rawIntentJson as unknown as RawPlayerAction, failed);
    return this.executeActionReservation(user, actor, reservation);
  }

  async result(user: AuthenticatedUser, runId: string) {
    const actor = await this.requireActor(user, runId);
    if (actor.run.status !== "chapter_generated") throw new ConflictException({ code: "RESULT_NOT_READY", message: "故事尚未结束。" });
    const entries = await this.prisma.narrativeEntry.findMany({
      where: { runId, OR: [{ visibility: "public" }, { visibility: "role_private", roleId: actor.role.id }] },
      orderBy: [{ worldSequence: "asc" }, { createdAt: "asc" }]
    });
    return {
      room: { id: actor.run.id, title: actor.run.title, worldId: actor.run.templateKey, completedAt: actor.run.updatedAt },
      chapter: { title: "浙江总督的七次落子", content: entries.map((entry) => entry.content).join("\n\n"), highlights: entries.filter((entry) => entry.entryType === "RESULT").slice(-3).map((entry) => entry.content) },
      player: { roleName: actor.role.roleName, personalGoal: actor.role.personalGoal },
      completedNodes: actor.run.completedNodeCount
    };
  }

  async events(user: AuthenticatedUser, runId: string, afterSequence = 0) {
    const actor = await this.requireActor(user, runId);
    return { events: [], worldSequence: actor.run.worldSequence, nextAfterDeliverySequence: Math.max(afterSequence, actor.run.worldSequence) };
  }

  async heartbeat(user: AuthenticatedUser, runId: string, command: HeartbeatCommandV1) {
    const actor = await this.requireActor(user, runId);
    await this.prisma.roleControl.updateMany({ where: { runId, roleId: actor.role.id, mode: "HUMAN_ACTIVE" }, data: { lastHeartbeatAt: new Date(), offlineSince: null } });
    return { applied: true, heartbeatSequence: Number(command.heartbeatSequence || 0), worldSequence: actor.run.worldSequence };
  }

  async reclaim(user: AuthenticatedUser, runId: string, command: ControlCommandV1) {
    const actor = await this.requireActor(user, runId);
    requireControlCommand(command);
    let result: { mode: string; epoch: number };
    try {
      result = await this.prisma.$transaction(async (tx) => {
      const run = await tx.storyRun.findUniqueOrThrow({ where: { id: runId } });
      const control = await tx.roleControl.findUniqueOrThrow({ where: { runId_roleId: { runId, roleId: actor.role.id } } });
      const existing = await tx.roleControlTransition.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (existing) {
        if (existing.roleControlId !== control.id || existing.fromEpoch !== command.expectedControlEpoch) throw idempotencyReused();
        return { mode: existing.toMode, epoch: existing.toEpoch };
      }
      if (control.humanPlayerId !== actor.player.id) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "Only the original player can reclaim this role" });
      if (control.epoch !== command.expectedControlEpoch || !["AI_ACTIVE", "HUMAN_RECLAIM_PENDING"].includes(control.mode)) {
        throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control changed before reclaim" });
      }
      const billing = parseRunBilling(run, readCreditConsumptionConfig().prices);
      if (billing.policyVersion === "active_action_v1") {
        const available = await this.creditConsumption.availableForRun(runId, user.id, tx);
        if (available.available < billing.prices.standardAction) {
          throw new HttpException({
            code: "PLAYER_CREDITS_REQUIRED",
            message: "At least one available World Credit is required before reclaiming this role",
            requiredCredits: billing.prices.standardAction,
            availableCredits: available.available,
            canRequestSponsor: true
          }, HttpStatus.PAYMENT_REQUIRED);
        }
      }
      const thread = await tx.actorThread.findUnique({ where: { roleId: actor.role.id } });
      const currentTurn = thread ? await tx.actorTurn.findFirst({ where: { threadId: thread.id }, orderBy: [{ turnIndex: "desc" }, { revision: "desc" }] }) : null;
      const aiAlreadySealed = currentTurn ? await tx.playerAction.findFirst({
        where: { runId, roleId: actor.role.id, actionSlot: `SOLO:${currentTurn.id}`, actorKind: "AI_TAKEOVER", sealedAt: { not: null }, status: { in: ["accepted", "resolved"] } }
      }) : null;
      const immediate = !aiAlreadySealed || aiAlreadySealed.status === "resolved";
      const nextEpoch = control.epoch + 1;
      const toMode = immediate ? "HUMAN_ACTIVE" : "HUMAN_RECLAIM_PENDING";
      await tx.roleControl.update({
        where: { id: control.id },
        data: { mode: toMode, epoch: nextEpoch, reason: immediate ? "PLAYER_RECLAIMED" : "PLAYER_RECLAIM_SCHEDULED", reclaimAfterWindowId: null, lastHeartbeatAt: new Date() }
      });
      await tx.roleControlTransition.create({
        data: {
          roleControlId: control.id,
          fromMode: control.mode,
          toMode,
          fromEpoch: control.epoch,
          toEpoch: nextEpoch,
          reason: immediate ? "PLAYER_RECLAIMED" : "PLAYER_RECLAIM_SCHEDULED",
          initiatedByUserId: user.id,
          effectiveSlot: immediate ? `SOLO:${currentTurn?.id || "NEXT"}` : "SOLO:NEXT_TURN",
          idempotencyKey: command.idempotencyKey
        }
      });
      await tx.eventLog.create({ data: { userId: user.id, runId, eventName: "role_control_changed", source: "solo_control", payload: { roleId: actor.role.id, fromMode: control.mode, toMode, epoch: nextEpoch } } });
      return { mode: toMode, epoch: nextEpoch };
      });
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.PAYMENT_REQUIRED) {
        operationalMetrics.increment("credit_reclaim_total", { result: "insufficient" });
      }
      throw error;
    }
    operationalMetrics.increment("credit_reclaim_total", { result: result.mode === "HUMAN_RECLAIM_PENDING" ? "pending" : "reclaimed" });
    return { accepted: true, control: result, gameProjection: await this.game(user, runId) };
  }

  async handoff(user: AuthenticatedUser, runId: string, command: ControlCommandV1) {
    const actor = await this.requireActor(user, runId);
    requireControlCommand(command);
    await this.prisma.$transaction(async (tx) => {
      const control = await tx.roleControl.findUniqueOrThrow({ where: { runId_roleId: { runId, roleId: actor.role.id } } });
      const existing = await tx.roleControlTransition.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (existing) {
        if (existing.roleControlId !== control.id || existing.fromEpoch !== command.expectedControlEpoch || existing.toMode !== "AI_ACTIVE") throw idempotencyReused();
        return;
      }
      if (control.humanPlayerId !== actor.player.id) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "Only the original player can hand off this role" });
      if (control.epoch !== command.expectedControlEpoch || control.mode !== "HUMAN_ACTIVE") {
        throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control changed before handoff" });
      }
      const nextEpoch = control.epoch + 1;
      await tx.roleControl.update({ where: { id: control.id }, data: { mode: "AI_ACTIVE", epoch: nextEpoch, reason: "EXPLICIT_HANDOFF", takeoverAt: new Date(), offlineSince: null } });
      await tx.roleControlTransition.create({
        data: {
          roleControlId: control.id,
          fromMode: control.mode,
          toMode: "AI_ACTIVE",
          fromEpoch: control.epoch,
          toEpoch: nextEpoch,
          reason: "EXPLICIT_HANDOFF",
          initiatedByUserId: user.id,
          effectiveSlot: "SOLO:NEXT_OPEN_TURN",
          idempotencyKey: command.idempotencyKey
        }
      });
      await tx.eventLog.create({ data: { userId: user.id, runId, eventName: "role_control_changed", source: "solo_control", payload: { roleId: actor.role.id, fromMode: control.mode, toMode: "AI_ACTIVE", epoch: nextEpoch } } });
      const thread = await tx.actorThread.findUnique({ where: { roleId: actor.role.id } });
      const currentTurn = thread ? await tx.actorTurn.findFirst({ where: { threadId: thread.id, status: { in: ["OPEN", "RESOLVING"] } }, orderBy: [{ turnIndex: "desc" }, { revision: "desc" }] }) : null;
      if (currentTurn) {
        await this.enqueueAiWorldTick(tx, {
          runId,
          nodeId: actor.run.currentNodeId!,
          roleId: actor.role.id,
          turnId: currentTurn.id,
          controlEpoch: nextEpoch
        });
      }
    });
    return { accepted: true, gameProjection: await this.game(user, runId) };
  }

  async executeAiWorldTickTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    const task = await this.prisma.storyTaskOutbox.findFirst({
      where: {
        id: taskId,
        taskType: "SOLO_AI_WORLD_TICK_V1",
        status: "RUNNING",
        leaseOwner: fence.leaseOwner,
        leaseVersion: fence.leaseVersion,
        leaseExpiresAt: { gt: new Date() }
      }
    });
    if (!task?.roleId || !task.inputRefId || task.controlEpoch === null) return { outcome: "LEASE_LOST" };
    const player = await this.prisma.storyPlayer.findFirst({
      where: { runId: task.runId, roleId: task.roleId, userId: { not: null } },
      orderBy: { joinedAt: "asc" }
    });
    if (!player?.userId) return { outcome: "ORIGINAL_PLAYER_MISSING" };
    operationalMetrics.set("ai_batch_size", { engine: "solo_story_v2" }, 1);
    return this.advanceAiTurn({ id: player.userId } as AuthenticatedUser, task.runId, {
      ...fence,
      turnId: task.inputRefId,
      controlEpoch: task.controlEpoch
    });
  }

  /** Publishes a provider result that was durably stored before an API/worker
   * process exited. The provider is never called here: the frozen parsed
   * output and confirmed resolution are the only inputs. */
  async executePublishRecoveryTask(taskId: string, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId } });
    if (!task || task.status !== "RUNNING" || task.leaseOwner !== fence.leaseOwner || task.leaseVersion !== fence.leaseVersion) {
      return { outcome: "LEASE_LOST" };
    }
    const attempt = await this.prisma.soloGenerationAttempt.findUnique({ where: { id: task.inputRefId || "" } });
    if (!attempt) return { outcome: "ATTEMPT_MISSING" };
    if (attempt.status === "PUBLISHED") return { outcome: "ALREADY_PUBLISHED" };
    if (!["SUCCEEDED", "FAILED_RETRYABLE"].includes(attempt.status) || !attempt.parsedOutput) {
      return { outcome: "NOTHING_TO_PUBLISH" };
    }
    const player = await this.prisma.storyPlayer.findFirst({
      where: { runId: attempt.runId, playerType: "human", userId: { not: null } },
      orderBy: { joinedAt: "asc" }
    });
    if (!player?.userId) throw new Error(`SOLO_PUBLISH_RECOVERY_PLAYER_MISSING:${attempt.id}`);
    const user = { id: player.userId } as AuthenticatedUser;
    const actor = await this.requireActor(user, attempt.runId);
    const output = attempt.parsedOutput as unknown as StoryTurnPublishedOutput;
    if (attempt.triggerType === "OPENING") {
      const runtime = await this.buildRuntimeInput(actor.run, actor.role, 1);
      await this.publishOpening({ actor, runtime, attempt, output, contextHash: attempt.contextSnapshotHash || "recovered" });
      return { outcome: "SOLO_OPENING_RECOVERED", attemptId: attempt.id };
    }
    if (!attempt.submissionId || !attempt.actorTurnId || !attempt.confirmedResolutionJson) {
      throw new Error(`SOLO_PUBLISH_RECOVERY_CONTEXT_MISSING:${attempt.id}`);
    }
    const [submission, turn] = await Promise.all([
      this.prisma.decisionSubmission.findUnique({ where: { id: attempt.submissionId } }),
      this.prisma.actorTurn.findUnique({ where: { id: attempt.actorTurnId } })
    ]);
    if (!submission?.playerActionId || !turn) throw new Error(`SOLO_PUBLISH_RECOVERY_CONTEXT_MISSING:${attempt.id}`);
    const [playerAction, charge] = await Promise.all([
      this.prisma.playerAction.findUnique({ where: { id: submission.playerActionId } }),
      (this.prisma as any).creditCharge.findUnique({ where: { playerActionId: submission.playerActionId } })
    ]);
    if (!playerAction) throw new Error(`SOLO_PUBLISH_RECOVERY_ACTION_MISSING:${attempt.id}`);
    const runtime = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex);
    const published = await this.publishAction({
      actor,
      runtime,
      reservation: {
        attempt,
        submission,
        playerAction,
        turn,
        rawAction: submission.rawIntentJson as unknown as RawPlayerAction,
        creditChargeId: charge?.id || null
      },
      output,
      actionResolution: attempt.confirmedResolutionJson as unknown as ConfirmedResolution,
      contextHash: attempt.contextSnapshotHash || "recovered"
    });
    if (published.reclaimEffective) operationalMetrics.increment("credit_reclaim_total", { result: "effective" });
    return { outcome: "SOLO_ACTION_RECOVERED", attemptId: attempt.id, resolutionId: published.id };
  }

  /** Final compensation after a stored Solo result could not be published
   * within the bounded worker retry budget. No generated mutation is applied. */
  async failPublishRecoveryTask(taskId: string, failureCode: string) {
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId } });
    if (!task?.inputRefId) return { released: false, reason: "TASK_CONTEXT_MISSING" };
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.soloGenerationAttempt.findUnique({ where: { id: task.inputRefId! } });
      if (!attempt || attempt.status === "PUBLISHED") return { released: false, reason: attempt ? "ALREADY_PUBLISHED" : "ATTEMPT_MISSING" };
      if (attempt.triggerType === "OPENING") {
        const charge = await (tx as any).creditCharge.findFirst({
          where: { runId: attempt.runId, chargeType: "RUN_CREATE", status: "RESERVED" },
          orderBy: { createdAt: "asc" }
        });
        if (charge) await this.creditConsumption.releaseCharge(charge.id, failureCode, tx);
        await tx.soloGenerationAttempt.update({
          where: { id: attempt.id },
          data: { status: "FAILED_FINAL", failureReason: failureCode, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }
        });
        await tx.storyRun.update({ where: { id: attempt.runId }, data: { status: "creation_failed", version: { increment: 1 } } });
        return { released: Boolean(charge), reason: failureCode };
      }
      const submission = attempt.submissionId
        ? await tx.decisionSubmission.findUnique({ where: { id: attempt.submissionId } })
        : null;
      const playerActionId = submission?.playerActionId || null;
      const charge = playerActionId
        ? await (tx as any).creditCharge.findUnique({ where: { playerActionId } })
        : null;
      if (charge?.status === "RESERVED") await this.creditConsumption.releaseCharge(charge.id, failureCode, tx);
      if (playerActionId) {
        await tx.playerAction.update({
          where: { id: playerActionId },
          data: { status: "failed", auditStatus: "publish_not_completed", actionSlot: `SOLO:FAILED:${attempt.id}` }
        });
      }
      if (submission) await tx.decisionSubmission.delete({ where: { id: submission.id } });
      if (attempt.actorTurnId) {
        await tx.actorTurn.updateMany({ where: { id: attempt.actorTurnId, status: "RESOLVING" }, data: { status: "OPEN" } });
      }
      await tx.soloGenerationAttempt.update({
        where: { id: attempt.id },
        data: { status: "FAILED_FINAL", failureReason: failureCode, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }
      });
      await tx.storyRun.update({ where: { id: attempt.runId }, data: { status: "playing", version: { increment: 1 } } });
      return { released: charge?.status === "RESERVED", reason: failureCode };
    }, PUBLISH_TRANSACTION_OPTIONS);
  }

  /** Advance exactly one already-published Solo decision while AI controls
   * the role. AI actions are auditable but never create a personal charge. */
  private async advanceAiTurn(
    user: AuthenticatedUser,
    runId: string,
    taskFence?: { taskId: string; leaseOwner: string; leaseVersion: number; turnId: string; controlEpoch: number }
  ) {
    const actor = await this.requireActor(user, runId);
    if (actor.run.status === "chapter_generated") return { outcome: "STORY_COMPLETED" };
    const control = await this.prisma.roleControl.findUniqueOrThrow({ where: { runId_roleId: { runId, roleId: actor.role.id } } });
    if (control.mode !== "AI_ACTIVE" || (taskFence && control.epoch !== taskFence.controlEpoch)) return { outcome: "CONTROL_CHANGED" };
    const thread = await this.prisma.actorThread.findUnique({ where: { roleId: actor.role.id } });
    if (!thread) return { outcome: "THREAD_MISSING" };
    const turn = await this.prisma.actorTurn.findFirst({
      where: { threadId: thread.id },
      include: { decisionSet: true, submission: true },
      orderBy: [{ turnIndex: "desc" }, { revision: "desc" }]
    });
    if (!turn || turn.status === "RESOLVED") return { outcome: "TURN_ALREADY_RESOLVED" };
    if (taskFence && turn.id !== taskFence.turnId) return { outcome: "TURN_MOVED" };
    if (turn.submission) {
      const latest = await this.prisma.soloGenerationAttempt.findFirst({ where: { submissionId: turn.submission.id }, orderBy: { createdAt: "desc" } });
      if (latest?.status === "FAILED_RETRYABLE") {
        const retry = await this.reserveRetry(actor, turn, turn.submission, turn.submission.rawIntentJson as unknown as RawPlayerAction, latest);
        await this.executeActionReservation(user, actor, retry);
      }
      return { outcome: "TURN_ALREADY_RESERVED" };
    }
    const candidates = Array.isArray(turn.decisionSet?.candidatesJson) ? turn.decisionSet.candidatesJson as any[] : [];
    const candidate = candidates[0];
    if (!candidate) throw new ConflictException({ code: "AI_ACTION_UNAVAILABLE", message: "No published Solo action is available for AI control" });
    const rawAction: RawPlayerAction = {
      source: "RECOMMENDED",
      decisionId: String(candidate.id),
      label: String(candidate.label),
      targetId: String(candidate.intentDraft?.target?.id || ""),
      targetLabel: String(candidate.intentDraft?.target?.label || ""),
      actionText: String(candidate.intentDraft?.method || candidate.label)
    };
    const normalized = normalizePlayerIntent(rawAction);
    if (!normalized.ok) throw actionRejected(normalized.issues);
    const runtime = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex);
    const validation = validatePlayerIntent(normalized.intent, runtime.role, runtime.availableTargets);
    if (!validation.ok) throw actionRejected(validation.issues);
    const requestHash = sha256Canonical({ runId, turnId: turn.id, revision: turn.revision, controlEpoch: control.epoch, actorKind: "AI_TAKEOVER", rawAction });
    const reservation: ActionReservation | null = await this.prisma.$transaction(async (tx) => {
      if (taskFence) {
        const held = await tx.storyTaskOutbox.findFirst({
          where: {
            id: taskFence.taskId,
            taskType: "SOLO_AI_WORLD_TICK_V1",
            status: "RUNNING",
            leaseOwner: taskFence.leaseOwner,
            leaseVersion: taskFence.leaseVersion,
            leaseExpiresAt: { gt: new Date() },
            inputRefId: taskFence.turnId,
            controlEpoch: taskFence.controlEpoch
          },
          select: { id: true }
        });
        if (!held) return null;
      }
      const currentControl = await tx.roleControl.findUniqueOrThrow({ where: { runId_roleId: { runId, roleId: actor.role.id } } });
      if (currentControl.mode !== "AI_ACTIVE" || currentControl.epoch !== control.epoch) throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control changed before AI action sealing" });
      const moved = await tx.actorTurn.updateMany({ where: { id: turn.id, status: "OPEN", revision: turn.revision }, data: { status: "RESOLVING" } });
      if (moved.count !== 1) throw new ConflictException({ code: "TURN_MOVED", message: "The Solo turn moved before AI action sealing" });
      const playerAction = await tx.playerAction.create({
        data: {
          runId,
          nodeId: actor.run.currentNodeId!,
          chapterIndex: 1,
          userId: null,
          roleId: actor.role.id,
          playerType: "ai",
          actionType: rawAction.source,
          targetType: candidate.intentDraft?.target?.type || "ROLE",
          targetId: normalized.intent.targetId,
          targetText: normalized.intent.targetLabel,
          method: normalized.intent.method,
          intent: normalized.intent.objective,
          riskLevel: String(candidate.intentDraft?.riskTolerance || "MEDIUM").toLowerCase(),
          normalizedJson: normalized.intent as any,
          guardStatus: "accepted",
          guardReason: "solo_ai_takeover_policy",
          auditStatus: "pending",
          status: "accepted",
          actionSlot: `SOLO:${turn.id}`,
          actorKind: "AI_TAKEOVER",
          controlEpoch: control.epoch,
          policyVersion: SOLO_STORY_ENGINE_VERSION,
          actionKey: String(candidate.id),
          idempotencyKey: `solo-ai-action:${runId}:${turn.id}:${control.epoch}`,
          requestHash,
          visibility: candidate.intentDraft?.visibility || "PRIVATE",
          targetRoleId: candidate.intentDraft?.target?.type === "ROLE" ? candidate.intentDraft.target.id : null,
          leverageKey: candidate.intentDraft?.leverageKeys?.[0] || null,
          sealedAt: new Date()
        }
      });
      const submission = await tx.decisionSubmission.create({
        data: {
          runId,
          threadId: turn.threadId,
          turnId: turn.id,
          roleId: actor.role.id,
          userId: null,
          playerActionId: playerAction.id,
          candidateId: String(candidate.id),
          normalizedActionJson: normalized.intent as any,
          rawIntentJson: rawAction as any,
          normalizedIntentJson: candidate.intentDraft as any,
          immutableIntentHash: normalized.intent.immutableIntentHash,
          guardDecisionJson: { decision: "ACCEPT", validator: "solo_ai_takeover_policy" },
          selectedLeverageKeysJson: candidate.intentDraft?.leverageKeys || [],
          controlEpoch: control.epoch,
          idempotencyKey: `solo-ai-submission:${runId}:${turn.id}:${control.epoch}`,
          requestHash,
          status: "ACCEPTED"
        }
      });
      const attempt = await tx.soloGenerationAttempt.create({
        data: attemptCreateData({ runId, triggerType: "PLAYER_ACTION", actorTurnId: turn.id, submissionId: submission.id, supersedesAttemptId: null, runtime })
      });
      await tx.storyRun.update({ where: { id: runId }, data: { status: "resolving", version: { increment: 1 } } });
      return { attempt, submission, playerAction, turn, rawAction, creditChargeId: null };
    });
    if (!reservation) return { outcome: "LEASE_LOST" };
    const result = await this.executeActionReservation(user, actor, reservation);
    if (!result.accepted) throw new Error("SOLO_AI_ACTION_NEEDS_RETRY");
    return { outcome: "SOLO_AI_TURN_PUBLISHED", turnId: turn.id };
  }

  private async executeActionReservation(user: AuthenticatedUser, actor: Awaited<ReturnType<SoloStoryEngineService["requireActor"]>>, reservation: ActionReservation): Promise<TurnDecisionResponseV2> {
    const startedAt = Date.now();
    const runtime = await this.buildRuntimeInput(actor.run, actor.role, reservation.turn.turnIndex);
    let transport: SoloDeepSeekTransport;
    try {
      transport = SoloDeepSeekTransport.fromEnv();
    } catch (error) {
      await this.failBeforeProvider(reservation.attempt.id, reservation.turn.id, error, startedAt);
      throw new ServiceUnavailableException({
        code: "STORY_PROVIDER_UNAVAILABLE",
        message: "剧情模型当前没有正确配置；本次没有调用 DeepSeek，也没有推进剧情。",
        runId: actor.run.id,
        attemptId: reservation.attempt.id
      });
    }
    const result = await executeSoloStoryTurn({
      attemptId: reservation.attempt.id,
      role: runtime.role,
      scene: runtime.scene,
      facts: runtime.facts,
      recentCanon: runtime.recentCanon,
      pendingConsequences: runtime.pendingConsequences,
      activePressures: runtime.activePressures,
      relevantScriptCards: runtime.relevantScriptCards,
      availableTargets: runtime.availableTargets,
      rawAction: reservation.rawAction,
      transport,
      onBeforeProviderCall: () => this.reserveProviderCall(reservation.attempt.id)
    });
    if (!result.ok) {
      await this.failAttempt(reservation.attempt.id, result, startedAt, reservation.turn.id);
      throw generationFailure(actor.run.id, reservation.attempt.id, result);
    }
    await this.persistSuccessfulGeneration(reservation.attempt.id, result, startedAt);
    if (result.output.resultType === "ACTION_NEEDS_CLARIFICATION") {
      return this.returnClarification(user, actor.run.id, reservation, result.output);
    }
    try {
      const published = await this.publishAction({ actor, runtime, reservation, output: result.output, actionResolution: result.actionResolution, contextHash: result.context.snapshotHash });
      if (published.reclaimEffective) operationalMetrics.increment("credit_reclaim_total", { result: "effective" });
      const resolution = {
        id: published.id,
        appliedWorldSequence: published.appliedWorldSequence,
        resultNarrative: published.resultNarrative,
        nextHook: published.nextHook
      };
      return { accepted: true, resolution, gameProjection: await this.game(user, actor.run.id) };
    } catch (error) {
      await this.markPublishFailure(reservation.attempt.id, error, reservation.turn.id);
      throw new ServiceUnavailableException({ code: "GENERATION_FAILED_RETRYABLE", message: "剧情已经生成，但发布没有完成；明确重试会直接发布，不会再次调用 DeepSeek。", runId: actor.run.id, attemptId: reservation.attempt.id });
    }
  }

  private async returnClarification(
    user: AuthenticatedUser,
    runId: string,
    reservation: ActionReservation,
    output: StoryTurnClarificationOutput
  ): Promise<TurnDecisionResponseV2> {
    await this.prisma.$transaction(async (tx) => {
      await tx.soloGenerationAttempt.update({
        where: { id: reservation.attempt.id },
        data: {
          status: "REJECTED",
          issueCodesJson: ["ACTION_NEEDS_CLARIFICATION"],
          failureReason: output.clarification.reason.slice(0, 2000),
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null
        }
      });
      await tx.playerAction.update({
        where: { id: reservation.playerAction.id },
        data: {
          status: "rejected",
          auditStatus: "clarification_required",
          actionSlot: "SOLO_CLARIFICATION:" + reservation.attempt.id
        }
      });
      await tx.decisionSubmission.delete({
        where: { id: reservation.submission.id }
      });
      await tx.actorTurn.update({
        where: { id: reservation.turn.id },
        data: { status: "OPEN" }
      });
      await tx.storyRun.update({
        where: { id: runId },
        data: { status: "playing", version: { increment: 1 } }
      });
      if (reservation.creditChargeId) await this.creditConsumption.releaseCharge(reservation.creditChargeId, "ACTION_NEEDS_CLARIFICATION", tx);
    }, PUBLISH_TRANSACTION_OPTIONS);

    return {
      accepted: false,
      reason: output.clarification.reason,
      suggestedRewrite: output.clarification.question,
      attemptId: reservation.attempt.id,
      gameProjection: await this.game(user, runId)
    };
  }

  private async reserveAction(actor: Awaited<ReturnType<SoloStoryEngineService["requireActor"]>>, turn: any, command: TurnDecisionCommandV2, rawAction: RawPlayerAction, intent: any, requestHash: string, runtime: RuntimeInput): Promise<ActionReservation> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const run = await tx.storyRun.findUniqueOrThrow({ where: { id: actor.run.id } });
      const config = readCreditConsumptionConfig();
      const billing = parseRunBilling(run, config.prices);
      let creditChargeId: string | null = null;
      if (billing.policyVersion === "active_action_v1") {
        const actionClass = classifyCreditAction({
          actorKind: "HUMAN",
          candidateId: command.candidateId,
          customAction: command.customAction,
          decisionForm: command.decisionForm,
          operation: "TURN"
        });
        const amount = priceForCreditAction(actionClass, billing.prices);
        const reservation = await this.creditConsumption.reserveCharge({
          runId: actor.run.id,
          beneficiaryUserId: String(actor.player.userId),
          chargeType: "PLAYER_ACTION",
          actionClass,
          amount,
          idempotencyKey: `player-action:${actor.run.id}:${actor.player.userId}:${command.idempotencyKey}`,
          requestHash,
          metadata: { engine: SOLO_STORY_ENGINE_VERSION, policyVersion: billing.policyVersion, turnId: turn.id, decisionForm: command.decisionForm || decisionFormFor(rawAction) },
          meteringMode: config.meteringMode,
          tx
        });
        if (reservation.kind === "insufficient") {
          const control = await tx.roleControl.findUnique({ where: { runId_roleId: { runId: actor.run.id, roleId: actor.role.id } } });
          if (!control || control.mode !== "HUMAN_ACTIVE" || control.epoch !== command.controlEpoch) {
            throw new ConflictException({ code: "ROLE_CONTROL_CHANGED", message: "Role control changed before the credit check completed" });
          }
          const nextEpoch = control.epoch + 1;
          await tx.roleControl.update({ where: { id: control.id }, data: { mode: "AI_ACTIVE", epoch: nextEpoch, reason: "CREDITS_INSUFFICIENT", takeoverAt: new Date(), offlineSince: null } });
          await tx.roleControlTransition.create({
            data: {
              roleControlId: control.id,
              fromMode: control.mode,
              toMode: "AI_ACTIVE",
              fromEpoch: control.epoch,
              toEpoch: nextEpoch,
              reason: "CREDITS_INSUFFICIENT",
              initiatedByUserId: actor.player.userId,
              effectiveSlot: `SOLO:${turn.id}`,
              idempotencyKey: `credits-insufficient:${actor.run.id}:${turn.id}:${control.epoch}`
            }
          });
          await tx.eventLog.create({ data: { userId: actor.player.userId, runId: actor.run.id, eventName: "role_control_changed", source: "credits", payload: { roleId: actor.role.id, fromMode: control.mode, toMode: "AI_ACTIVE", epoch: nextEpoch, reason: "CREDITS_INSUFFICIENT" } } });
          await this.enqueueAiWorldTick(tx, {
            runId: actor.run.id,
            nodeId: actor.run.currentNodeId!,
            roleId: actor.role.id,
            turnId: turn.id,
            controlEpoch: nextEpoch
          });
          return { insufficient: reservation, control: { mode: "AI_ACTIVE", epoch: nextEpoch } } as const;
        }
        if (reservation.kind === "replay" && reservation.charge?.status === "RELEASED") {
          throw new ConflictException({
            code: "CREDIT_ACTION_ALREADY_FAILED",
            message: "This action request already ended without publication; submit a new action with a new idempotency key"
          });
        }
        creditChargeId = reservation.charge?.id || null;
      }
      const moved = await tx.actorTurn.updateMany({ where: { id: turn.id, status: "OPEN", revision: turn.revision }, data: { status: "RESOLVING" } });
      if (moved.count !== 1) throw new ConflictException({ code: "TURN_MOVED", message: "局势已经变化，请刷新后继续。" });
      const playerAction = await tx.playerAction.create({
        data: {
          runId: actor.run.id,
          nodeId: actor.run.currentNodeId!,
          chapterIndex: 1,
          userId: actor.player.userId,
          roleId: actor.role.id,
          playerType: "human",
          actionType: rawAction.source,
          targetType: command.intent.target.type,
          targetId: intent.targetId,
          targetText: intent.targetLabel,
          method: intent.method,
          intent: intent.objective,
          riskLevel: String(command.intent.riskTolerance || "MEDIUM").toLowerCase(),
          freeText: intent.userFacingText,
          normalizedJson: intent as any,
          guardStatus: "accepted",
          guardReason: "solo_story_local_validator",
          auditStatus: "pending",
          status: "accepted",
          actionSlot: `SOLO:${turn.id}`,
          actorKind: "HUMAN",
          controlEpoch: command.controlEpoch,
          policyVersion: SOLO_STORY_ENGINE_VERSION,
          actionKey: command.candidateId || null,
          idempotencyKey: `solo-action:${command.idempotencyKey}`,
          requestHash,
          visibility: command.intent.visibility,
          targetRoleId: command.intent.target.type === "ROLE" ? command.intent.target.id : null,
          leverageKey: command.intent.leverageKeys?.[0] || null,
          sealedAt: new Date()
        }
      });
      const submission = await tx.decisionSubmission.create({
        data: {
          runId: actor.run.id,
          threadId: turn.threadId,
          turnId: turn.id,
          roleId: actor.role.id,
          userId: actor.player.userId,
          playerActionId: playerAction.id,
          candidateId: command.candidateId || null,
          customAction: command.customAction || null,
          normalizedActionJson: intent as any,
          rawIntentJson: rawAction as any,
          normalizedIntentJson: command.intent as any,
          immutableIntentHash: intent.immutableIntentHash,
          guardDecisionJson: { decision: "ACCEPT", validator: "solo_story_local_validator" },
          selectedLeverageKeysJson: command.intent.leverageKeys || [],
          controlEpoch: command.controlEpoch,
          idempotencyKey: command.idempotencyKey,
          requestHash,
          status: "ACCEPTED"
        }
      });
      if (creditChargeId) await this.creditConsumption.attachPlayerAction(creditChargeId, playerAction.id, tx);
      const attempt = await tx.soloGenerationAttempt.create({
        data: attemptCreateData({ runId: actor.run.id, triggerType: "PLAYER_ACTION", actorTurnId: turn.id, submissionId: submission.id, supersedesAttemptId: null, runtime })
      });
      await tx.storyRun.update({ where: { id: actor.run.id }, data: { status: "resolving", version: { increment: 1 } } });
      return { attempt, submission, playerAction, turn, rawAction, creditChargeId };
    });
    if ("insufficient" in outcome && outcome.insufficient) {
      const insufficient = outcome.insufficient;
      throw new HttpException({
        code: "PLAYER_CREDITS_REQUIRED",
        message: "Not enough World Credits to submit this action; the character is continuing under AI control",
        requiredCredits: insufficient.required,
        availableCredits: insufficient.available,
        canRequestSponsor: true,
        control: { ...outcome.control, reason: "CREDITS_INSUFFICIENT" },
        purchaseUrl: `/credits?intent=PLAYER_RECLAIM&runId=${encodeURIComponent(actor.run.id)}&returnTo=${encodeURIComponent(`/game?runId=${actor.run.id}`)}`
      }, HttpStatus.PAYMENT_REQUIRED);
    }
    return outcome;
  }

  private async reserveRetry(actor: Awaited<ReturnType<SoloStoryEngineService["requireActor"]>>, turn: any, submission: any, rawAction: RawPlayerAction, previous: any): Promise<ActionReservation> {
    const runtime = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex);
    return this.prisma.$transaction(async (tx) => {
      await tx.soloGenerationAttempt.updateMany({ where: { id: previous?.id, status: { in: ["FAILED_RETRYABLE", "REJECTED", "GENERATING"] } }, data: { status: "SUPERSEDED", finishedAt: new Date() } });
      const attempt = await tx.soloGenerationAttempt.create({
        data: attemptCreateData({ runId: actor.run.id, triggerType: "PLAYER_ACTION", actorTurnId: turn.id, submissionId: submission.id, supersedesAttemptId: previous?.id || null, runtime })
      });
      await tx.actorTurn.update({ where: { id: turn.id }, data: { status: "RESOLVING" } });
      await tx.storyRun.update({ where: { id: actor.run.id }, data: { status: "resolving", version: { increment: 1 } } });
      const playerAction = await tx.playerAction.findUniqueOrThrow({ where: { id: submission.playerActionId } });
      const charge = await (tx as any).creditCharge.findUnique({ where: { playerActionId: playerAction.id } });
      return { attempt, submission, playerAction, turn, rawAction, creditChargeId: charge?.id || null };
    });
  }

  private async publishOpening(input: { actor: Awaited<ReturnType<SoloStoryEngineService["requireActor"]>>; runtime: RuntimeInput; attempt: any; output: StoryTurnPublishedOutput; contextHash: string }) {
    const { actor, runtime, attempt, output } = input;
    const story = `${output.story.resultNarrative.trim()}\n\n${output.story.nextSituationNarrative.trim()}`;
    const decisions = buildDecisionCandidates(output.decisions, runtime.role, runtime.availableTargets);
    await this.prisma.$transaction(async (tx) => {
      const openingTurnKey = `solo:${actor.run.id}:turn:1`;
      const existingTurn = await tx.actorTurn.findUnique({ where: { dedupeKey: openingTurnKey } });
      if (existingTurn) {
        await tx.soloGenerationAttempt.update({
          where: { id: attempt.id },
          data: { status: "PUBLISHED", actorTurnId: existingTurn.id, parsedOutput: output as any, issueCodesJson: [], failureReason: null, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }
        });
        await tx.storyRun.update({ where: { id: actor.run.id }, data: { status: "playing" } });
        const creationCharge = await (tx as any).creditCharge.findFirst({ where: { runId: actor.run.id, chargeType: "RUN_CREATE", status: "RESERVED" }, orderBy: { createdAt: "asc" } });
        if (creationCharge) await this.creditConsumption.commitCharge(creationCharge.id, tx);
        return;
      }
      const currentRun = await tx.storyRun.findUniqueOrThrow({ where: { id: actor.run.id }, select: { stateJson: true, currentNodeId: true } });
      const thread = await tx.actorThread.upsert({
        where: { roleId: actor.role.id },
        create: { runId: actor.run.id, roleId: actor.role.id, status: "ACTIVE", currentTurnIndex: 1, currentStageIndex: 1, lastAppliedSequence: 1 },
        update: { status: "ACTIVE", currentTurnIndex: 1, currentStageIndex: 1, lastAppliedSequence: 1, completedAt: null }
      });
      const turn = await tx.actorTurn.create({
        data: {
          runId: actor.run.id,
          threadId: thread.id,
          roleId: actor.role.id,
          stageIndex: 1,
          turnIndex: 1,
          status: "OPEN",
          baseWorldSequence: 1,
          situationTitle: output.story.title,
          situationNarrative: story,
          visibleFactKeysJson: runtime.visibleFactKeys,
          activeThreadKeysJson: ["main_pressure"],
          contextJson: turnContext(runtime, attempt.id, output, runtime.availableTargets),
          qualityStatus: "PASSED",
          dedupeKey: openingTurnKey
        }
      });
      await tx.decisionSet.create({
        data: {
          runId: actor.run.id,
          turnId: turn.id,
          roleId: actor.role.id,
          contextHash: input.contextHash,
          framing: output.endingState.tension || "眼前的人与期限都已经到场，你准备先做哪一步？",
          candidatesJson: decisions as any,
          qualityStatus: "PASSED",
          qualityJson: { validator: "solo_story_output_validator", attemptId: attempt.id }
        }
      });
      await tx.narrativeEntry.create({
        data: {
          runId: actor.run.id,
          nodeId: currentRun.currentNodeId,
          roleId: actor.role.id,
          entryType: "OPENING",
          visibility: "role_private",
          content: story,
          factKeysJson: runtime.visibleFactKeys,
          threadKeysJson: ["main_pressure"],
          sourceEventIdsJson: { title: output.story.title, attemptId: attempt.id },
          worldSequence: 1,
          dedupeKey: `solo:${actor.run.id}:opening`
        }
      });
      await this.writeVisibleChanges(tx, actor.run.id, currentRun.currentNodeId, actor.role.id, attempt.id, output.endingState.visibleChanges, []);
      const state = asRecord(currentRun.stateJson);
      const solo = asRecord(state.soloStory);
      await tx.storyRun.update({
        where: { id: actor.run.id },
        data: {
          status: "playing",
          worldSequence: 1,
          currentDay: 1,
          stateJson: { ...state, soloStory: { ...solo, openingPublished: true, currentNodeId: runtime.nodeId, lastAttemptId: attempt.id, lastFailure: null } } as any,
          version: { increment: 1 }
        }
      });
      await tx.soloGenerationAttempt.update({
        where: { id: attempt.id },
        data: { status: "PUBLISHED", actorTurnId: turn.id, parsedOutput: output as any, issueCodesJson: [], failureReason: null, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }
      });
      const creationCharge = await (tx as any).creditCharge.findFirst({ where: { runId: actor.run.id, chargeType: "RUN_CREATE", status: "RESERVED" }, orderBy: { createdAt: "asc" } });
      if (creationCharge) await this.creditConsumption.commitCharge(creationCharge.id, tx);
    }, PUBLISH_TRANSACTION_OPTIONS);
  }

  private async publishAction(input: { actor: Awaited<ReturnType<SoloStoryEngineService["requireActor"]>>; runtime: RuntimeInput; reservation: ActionReservation; output: StoryTurnPublishedOutput; actionResolution: ConfirmedResolution; contextHash: string }) {
    const { actor, runtime, reservation, output, actionResolution } = input;
    const completed = reservation.turn.turnIndex >= MAX_PLAYER_ACTIONS;
    const nextTurnIndex = reservation.turn.turnIndex + 1;
    const nextStageIndex = Math.min(MAX_PLAYER_ACTIONS, nextTurnIndex);
    const decisionForm = decisionFormFor(reservation.rawAction);
    const decisions = buildDecisionCandidates(output.decisions, runtime.role, runtime.availableTargets);
    const surfaced = new Set(output.grounding.paidPendingConsequenceIds || []);
    const factKeys = [...runtime.visibleFactKeys, ...derivedFactKeys(reservation.rawAction, reservation.turn.turnIndex)];

    return this.prisma.$transaction(async (tx) => {
      const existingResolution = await tx.actionResolution.findUnique({ where: { submissionId: reservation.submission.id } });
      if (existingResolution) {
        await tx.soloGenerationAttempt.update({
          where: { id: reservation.attempt.id },
          data: { status: "PUBLISHED", parsedOutput: output as any, confirmedResolutionJson: actionResolution as any, issueCodesJson: [], failureReason: null, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }
        });
        if (reservation.creditChargeId) await this.creditConsumption.commitCharge(reservation.creditChargeId, tx);
        return { id: existingResolution.id, appliedWorldSequence: existingResolution.appliedWorldSequence, resultNarrative: existingResolution.resultNarrative, nextHook: existingResolution.nextHook, reclaimEffective: false };
      }
      const currentRun = await tx.storyRun.findUniqueOrThrow({ where: { id: actor.run.id }, select: { worldSequence: true, stateJson: true, currentNodeId: true } });
      const worldSequence = currentRun.worldSequence + 1;
      const state = asRecord(currentRun.stateJson);
      const solo = asRecord(state.soloStory);
      const existingPending = readPending(solo.pendingConsequences);
      const pending = [...existingPending, ...actionResolution.pendingConsequences]
        .filter((item, index, all) => all.findIndex((candidate) => candidate.consequenceId === item.consequenceId) === index)
        .filter((item) => !surfaced.has(item.consequenceId));
      const resolution = await tx.actionResolution.create({
        data: {
          runId: actor.run.id,
          threadId: reservation.turn.threadId,
          turnId: reservation.turn.id,
          submissionId: reservation.submission.id,
          roleId: actor.role.id,
          playerActionId: reservation.playerAction.id,
          baseWorldSequence: reservation.turn.baseWorldSequence,
          appliedWorldSequence: worldSequence,
          outcomeJson: { endingState: output.endingState, actionResolution, modelResolution: output.resolution, decisionForm },
          statePatchJson: { visibleChanges: output.endingState.visibleChanges, pendingConsequences: pending },
          resultNarrative: output.story.resultNarrative,
          nextHook: output.story.nextSituationNarrative,
          qualityStatus: "PASSED"
        }
      });
      await tx.playerAction.update({ where: { id: reservation.playerAction.id }, data: { auditStatus: "ok", status: "resolved", resolvedJson: { endingState: output.endingState } as any, resolvedAt: new Date() } });
      await tx.decisionSubmission.update({ where: { id: reservation.submission.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
      await tx.actorTurn.update({ where: { id: reservation.turn.id }, data: { status: "RESOLVED", resolvedAt: new Date(), qualityStatus: "PASSED" } });
      await tx.narrativeEntry.createMany({
        data: [
          {
            runId: actor.run.id,
            nodeId: currentRun.currentNodeId,
            roleId: actor.role.id,
            entryType: "RESULT",
            visibility: "role_private",
            content: output.story.resultNarrative,
            factKeysJson: factKeys,
            threadKeysJson: ["main_pressure"],
            sourceEventIdsJson: { title: output.story.title, attemptId: reservation.attempt.id, decisionForm },
            worldSequence,
            dedupeKey: `solo:${reservation.attempt.id}:result`
          },
          {
            runId: actor.run.id,
            nodeId: currentRun.currentNodeId,
            roleId: actor.role.id,
            entryType: completed ? "ENDING" : "NEXT_SITUATION",
            visibility: "role_private",
            content: output.story.nextSituationNarrative,
            factKeysJson: factKeys,
            threadKeysJson: ["main_pressure"],
            sourceEventIdsJson: { title: completed ? "你的故事结局" : "新的局势", attemptId: reservation.attempt.id },
            worldSequence,
            dedupeKey: `solo:${reservation.attempt.id}:next`
          }
        ] as any
      });
      await this.writeVisibleChanges(tx, actor.run.id, currentRun.currentNodeId, actor.role.id, reservation.attempt.id, output.endingState.visibleChanges, [reservation.playerAction.id]);
      await this.writeDerivedFacts(tx, actor.run.id, currentRun.currentNodeId, actor.role.id, reservation.playerAction.id, reservation.rawAction, reservation.turn.turnIndex);
      await this.consumeLeverage(tx, actor.run.id, actor.role.id, reservation.playerAction.id, actionResolution.consumedLeverageKeys);

      let nextTurnForAi: { id: string } | null = null;
      if (completed) {
        await tx.actorThread.update({ where: { id: reservation.turn.threadId }, data: { status: "COMPLETED", currentTurnIndex: reservation.turn.turnIndex, currentStageIndex: MAX_PLAYER_ACTIONS, lastAppliedSequence: worldSequence, completedAt: new Date() } });
      } else {
        const nextTurn = await tx.actorTurn.create({
          data: {
            runId: actor.run.id,
            threadId: reservation.turn.threadId,
            roleId: actor.role.id,
            stageIndex: nextStageIndex,
            turnIndex: nextTurnIndex,
            status: "OPEN",
            baseWorldSequence: worldSequence,
            situationTitle: output.story.title,
            situationNarrative: output.story.nextSituationNarrative,
            visibleFactKeysJson: factKeys,
            activeThreadKeysJson: ["main_pressure"],
            contextJson: turnContext(runtime, reservation.attempt.id, output, runtime.availableTargets, runtime.nextNodeId),
            qualityStatus: "PASSED",
            dedupeKey: `solo:${actor.run.id}:turn:${nextTurnIndex}`
          }
        });
        nextTurnForAi = nextTurn;
        await tx.decisionSet.create({
          data: {
            runId: actor.run.id,
            turnId: nextTurn.id,
            roleId: actor.role.id,
            contextHash: input.contextHash,
            framing: output.endingState.tension || "局势已经给出回应，你准备如何继续？",
            candidatesJson: decisions as any,
            qualityStatus: "PASSED",
            qualityJson: { validator: "solo_story_output_validator", attemptId: reservation.attempt.id }
          }
        });
        await tx.actorThread.update({ where: { id: reservation.turn.threadId }, data: { currentTurnIndex: nextTurnIndex, currentStageIndex: nextStageIndex, lastAppliedSequence: worldSequence } });
      }
      await tx.storyRun.update({
        where: { id: actor.run.id },
        data: {
          status: completed ? "chapter_generated" : "playing",
          worldSequence,
          currentDay: completed ? MAX_PLAYER_ACTIONS : nextStageIndex,
          completedNodeCount: completed ? MAX_PLAYER_ACTIONS : reservation.turn.turnIndex,
          stateJson: { ...state, soloStory: { ...solo, currentNodeId: runtime.nextNodeId, pendingConsequences: pending, lastAttemptId: reservation.attempt.id, lastFailure: null } } as any,
          version: { increment: 1 }
        }
      });
      const pendingReclaim = await tx.roleControl.findUnique({ where: { runId_roleId: { runId: actor.run.id, roleId: actor.role.id } } });
      let reclaimEffective = false;
      if (pendingReclaim?.mode === "HUMAN_RECLAIM_PENDING") {
        await tx.roleControl.update({
          where: { id: pendingReclaim.id },
          data: { mode: "HUMAN_ACTIVE", reason: "RECLAIM_EFFECTIVE_NEXT_SOLO_TURN", lastHeartbeatAt: new Date() }
        });
        await tx.roleControlTransition.upsert({
          where: { idempotencyKey: `solo-reclaim-effective:${reservation.turn.id}:${pendingReclaim.epoch}` },
          update: {},
          create: {
            roleControlId: pendingReclaim.id,
            fromMode: "HUMAN_RECLAIM_PENDING",
            toMode: "HUMAN_ACTIVE",
            fromEpoch: pendingReclaim.epoch,
            toEpoch: pendingReclaim.epoch,
            reason: "RECLAIM_EFFECTIVE_NEXT_SOLO_TURN",
            initiatedByUserId: actor.player.userId,
            effectiveSlot: completed ? "SOLO:COMPLETED" : `SOLO:TURN:${nextTurnIndex}`,
            idempotencyKey: `solo-reclaim-effective:${reservation.turn.id}:${pendingReclaim.epoch}`
          }
        });
        reclaimEffective = true;
      }
      if (!completed && nextTurnForAi && pendingReclaim?.mode === "AI_ACTIVE") {
        await this.enqueueAiWorldTick(tx, {
          runId: actor.run.id,
          nodeId: currentRun.currentNodeId!,
          roleId: actor.role.id,
          turnId: nextTurnForAi.id,
          controlEpoch: pendingReclaim.epoch
        });
      }
      await tx.soloGenerationAttempt.update({ where: { id: reservation.attempt.id }, data: { status: "PUBLISHED", parsedOutput: output as any, confirmedResolutionJson: actionResolution as any, issueCodesJson: [], failureReason: null, finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } });
      if (reservation.creditChargeId) await this.creditConsumption.commitCharge(reservation.creditChargeId, tx);
      return { id: resolution.id, appliedWorldSequence: worldSequence, resultNarrative: output.story.resultNarrative, nextHook: output.story.nextSituationNarrative, reclaimEffective };
    }, PUBLISH_TRANSACTION_OPTIONS);
  }

  private async buildRuntimeInput(run: any, roleRow: any, turnIndex: number): Promise<RuntimeInput> {
    const loaded = loadStoryPackage(run.templateKey);
    const state = asRecord(run.stateJson);
    const solo = asRecord(state.soloStory);
    const currentNodeId = String(solo.currentNodeId || loaded.storyPackage.openingNodeId);
    const [factsRows, narrativeRows, assets, roles] = await Promise.all([
      this.prisma.canonFact.findMany({ where: { runId: run.id, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
      this.prisma.narrativeEntry.findMany({
        where: { runId: run.id, OR: [{ visibility: "public" }, { visibility: "role_private", roleId: roleRow.id }] },
        orderBy: { createdAt: "desc" },
        take: 3
      }),
      this.prisma.roleAsset.findMany({ where: { runId: run.id, ownerRoleId: roleRow.id, status: "ACTIVE", quantity: { gt: 0 } } }),
      this.prisma.storyRole.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } })
    ]);
    const recentRows = narrativeRows.reverse();
    const roleView = buildStoryPackageRoleView(run.templateKey, {
      roleKey: roleRow.roleKey,
      currentNodeId,
      currentTurn: turnIndex,
      recentCanon: recentRows.length ? {
        sceneLabel: loaded.storyPackage.nodes.find((node) => node.nodeId === currentNodeId)?.sceneLabel || "杭州总督府",
        situationText: recentRows.at(-1)!.content,
        sourceCanonIds: recentRows.map((entry) => entry.id)
      } : null,
      canonFactKeys: factsRows.map((fact) => fact.factKey),
      pendingConsequences: readPending(solo.pendingConsequences).map((item) => item.summary)
    });
    const director = evaluateStoryPackageDirector(run.templateKey, { currentNodeId, currentTurn: turnIndex, canonFactKeys: factsRows.map((fact) => fact.factKey), recentCanonIds: recentRows.map((entry) => entry.id) });
    const node = loaded.storyPackage.nodes.find((item) => item.nodeId === currentNodeId)!;
    const nextNodeId = director.directedBeat?.targetNodeId || director.allowedAdjacentNodeIds[0] || currentNodeId;
    const labels = node.sceneLabel.split("·").map((value) => value.trim());
    const facts: StoryFact[] = factsRows.map((fact) => ({
      factId: fact.factKey,
      content: fact.content,
      visibility: fact.visibility === "public" ? "PUBLIC" : "ROLE_PRIVATE",
      knownByRoleIds: readStringArray(fact.knownByRoleIdsJson),
      priority: /^(prefact_|fact_deadline|fact_secret|fact_grain)/.test(fact.factKey) ? "P0" : "P1"
    }));
    const visibleFactKeys = factsRows.filter((fact) => fact.visibility === "public" || readStringArray(fact.knownByRoleIdsJson).includes(roleRow.id)).map((fact) => fact.factKey);
    const role: StoryRole = {
      roleId: roleRow.id,
      roleName: roleRow.roleName,
      identity: roleRow.identity,
      goal: roleRow.personalGoal,
      permissions: [String(roleRow.abilityText || roleRow.identity)],
      knownFactIds: visibleFactKeys,
      heldLeverageKeys: assets.map((asset) => asset.assetKey)
    };
    const scene: StoryScene = {
      sceneId: currentNodeId,
      title: node.title,
      timeLabel: labels[0] || "嘉靖三十五年五月初八",
      locationLabel: labels[1] || "杭州总督府",
      situation: roleView.currentSituationText,
      mainlineQuestion: roleView.mainlineQuestions.map((question) => question.prompt).join(" "),
      mainlineQuestionIds: roleView.mainlineQuestions.map((question) => question.questionId),
      directedBeat: director.directedBeat ? { beatId: director.directedBeat.beatId, summary: director.directedBeat.externalWorldMove } : null
    };
    const relevantScriptCards: ScriptCard[] = roleView.cards.map((card) => ({ cardId: card.cardId, title: card.title, summary: card.summary, tags: card.tags || [], priority: card.kind === "role" || card.kind === "evidence" || card.kind === "material" ? "P1" : "P2", groundedFactIds: card.sourceIds }));
    const activePressures: ActivePressure[] = roleView.pressures.map((pressure) => ({ pressureId: pressure.pressureId, summary: pressure.summary, priority: pressure.urgency === "high" ? "P0" : pressure.urgency === "medium" ? "P1" : "P2" }));
    const recentCanon: RecentCanonEntry[] = recentRows.map((entry, index) => ({ entryId: entry.id, narrative: entry.content, chronologicalOrder: index + 1 }));
    const availableTargets = buildAvailableTargets(roles, roleView.cards, roleRow.id);
    return { loaded, nodeId: currentNodeId, nextNodeId, role, scene, facts, recentCanon, pendingConsequences: readPending(solo.pendingConsequences), activePressures, relevantScriptCards, availableTargets, visibleFactKeys };
  }

  private async requireActor(user: AuthenticatedUser, runId: string) {
    const run = await this.prisma.storyRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
    if (run.engineVersion !== SOLO_STORY_ENGINE_VERSION) throw new ConflictException({ code: "SOLO_ENGINE_NOT_ACTIVE", message: "这局游戏没有使用新的 Solo 剧情引擎。" });
    const player = await this.prisma.storyPlayer.findUnique({ where: { runId_userId: { runId, userId: user.id } }, include: { role: true } });
    if (!player?.role) throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "你不属于这局 Solo。" });
    if (player.role.roleKey !== "zhejiang_governor") throw new ForbiddenException({ code: "SOLO_ROLE_UNSUPPORTED", message: "当前验收只开放浙江总督视角。" });
    return { run, player, role: player.role };
  }

  private async enqueueAiWorldTick(
    tx: any,
    input: { runId: string; nodeId: string; roleId: string; turnId: string; controlEpoch: number }
  ) {
    await tx.storyTaskOutbox.createMany({
      data: [{
        runId: input.runId,
        nodeId: input.nodeId,
        roleId: input.roleId,
        inputRefId: input.turnId,
        actionSlot: "SOLO_TURN",
        controlEpoch: input.controlEpoch,
        taskType: "SOLO_AI_WORLD_TICK_V1",
        status: "PENDING",
        dedupeKey: `SOLO_AI_WORLD_TICK_V1:${input.turnId}:${input.controlEpoch}`,
        maxAttempts: 3
      }],
      skipDuplicates: true
    });
  }

  private async createAttempt(input: { runId: string; triggerType: "OPENING" | "PLAYER_ACTION"; supersedesAttemptId: string | null; runtime: RuntimeInput }) {
    return this.prisma.$transaction(async (tx) => {
      if (input.supersedesAttemptId) {
        await tx.soloGenerationAttempt.updateMany({
          where: { id: input.supersedesAttemptId, status: { in: ["ACTION_RESERVED", "GENERATING", "FAILED_RETRYABLE", "REJECTED"] } },
          data: { status: "SUPERSEDED", finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }
        });
      }
      return tx.soloGenerationAttempt.create({ data: attemptCreateData({ ...input, actorTurnId: null, submissionId: null }) });
    });
  }

  private createTransportOrThrow() {
    try {
      return SoloDeepSeekTransport.fromEnv();
    } catch (error) {
      throw new ServiceUnavailableException({
        code: "STORY_PROVIDER_UNAVAILABLE",
        message: "剧情模型当前没有正确配置；系统尚未创建生成任务，也没有推进剧情。",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async latestAttempt(runId: string, triggerType?: string) {
    return this.prisma.soloGenerationAttempt.findFirst({ where: { runId, ...(triggerType ? { triggerType } : {}) }, orderBy: { createdAt: "desc" } });
  }

  private async reserveProviderCall(attemptId: string) {
    const updated = await this.prisma.soloGenerationAttempt.updateMany({
      where: { id: attemptId, status: "ACTION_RESERVED", providerCallCount: 0 },
      data: { status: "GENERATING", providerCallCount: 1, startedAt: new Date(), leaseOwner: `api:${process.pid}`, leaseExpiresAt: new Date(Date.now() + LEASE_MS) }
    });
    if (updated.count !== 1) throw new Error("PROVIDER_CALL_RESERVATION_CONFLICT");
  }

  private async persistSuccessfulGeneration(attemptId: string, result: Extract<Awaited<ReturnType<typeof executeSoloStoryTurn>> | Awaited<ReturnType<typeof executeSoloStoryOpening>>, { ok: true }>, startedAt: number) {
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.soloGenerationAttempt.update({
        where: { id: attemptId },
        data: {
          status: "SUCCEEDED",
          contextSnapshotHash: result.context.snapshotHash,
          providerRequestId: result.provider.providerRequestId || null,
          confirmedResolutionJson: result.actionResolution as any,
          contextReportJson: contextReport(result.context) as any,
          rawOutput: result.provider.rawText,
          parsedOutput: result.output as any,
          issueCodesJson: [],
          timingsJson: { totalMs: Date.now() - startedAt, providerCallCount: 1, usage: result.provider.usage, model: result.provider.model },
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null
        },
        select: { id: true, runId: true }
      });
      const run = await tx.storyRun.findUniqueOrThrow({ where: { id: attempt.runId }, select: { currentNodeId: true } });
      if (!run.currentNodeId) throw new Error(`SOLO_PUBLISH_RECOVERY_NODE_MISSING:${attempt.id}`);
      await tx.storyTaskOutbox.createMany({
        data: [{
          runId: attempt.runId,
          nodeId: run.currentNodeId,
          inputRefId: attempt.id,
          actionSlot: "SOLO_PUBLISH",
          taskType: "SOLO_PUBLISH_RECOVERY_V1",
          status: "PENDING",
          dedupeKey: `SOLO_PUBLISH_RECOVERY_V1:${attempt.id}`,
          maxAttempts: 5
        }],
        skipDuplicates: true
      });
    });
  }

  private async failAttempt(attemptId: string, failure: ExecuteSoloStoryFailure, startedAt: number, turnId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const failedAttempt = await tx.soloGenerationAttempt.update({
        where: { id: attemptId },
        data: {
          status: failure.attempt.status === "REJECTED" ? "REJECTED" : "FAILED_RETRYABLE",
          contextSnapshotHash: failure.context?.snapshotHash || null,
          providerRequestId: failure.provider?.providerRequestId || null,
          confirmedResolutionJson: failure.actionResolution as any,
          contextReportJson: failure.context ? contextReport(failure.context) as any : undefined,
          rawOutput: failure.provider?.rawText || null,
          issueCodesJson: failure.issues.map((issue) => issue.code),
          failureReason: failure.issues.map((issue) => issue.message).join("；").slice(0, 2000),
          timingsJson: { totalMs: Date.now() - startedAt, providerCallCount: failure.attempt.providerCallCount },
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null
        },
        select: { runId: true, submissionId: true }
      });
      if (failedAttempt.submissionId) {
        const submission = await tx.decisionSubmission.findUnique({ where: { id: failedAttempt.submissionId }, select: { playerActionId: true } });
        const charge = submission?.playerActionId ? await (tx as any).creditCharge.findUnique({ where: { playerActionId: submission.playerActionId } }) : null;
        if (charge?.status === "RESERVED") await this.creditConsumption.releaseCharge(charge.id, "GENERATION_NOT_PUBLISHED", tx);
        if (turnId && submission?.playerActionId) {
          await tx.playerAction.update({
            where: { id: submission.playerActionId },
            data: {
              status: "failed",
              auditStatus: "generation_not_published",
              actionSlot: `SOLO:FAILED:${attemptId}`
            }
          });
          await tx.decisionSubmission.delete({ where: { id: failedAttempt.submissionId } });
        }
      }
      if (turnId) await tx.actorTurn.updateMany({ where: { id: turnId, status: "RESOLVING" }, data: { status: "OPEN" } });
      const run = await tx.soloGenerationAttempt.findUniqueOrThrow({ where: { id: attemptId }, select: { runId: true } });
      const storyRun = await tx.storyRun.findUniqueOrThrow({ where: { id: run.runId }, select: { stateJson: true } });
      const state = asRecord(storyRun.stateJson);
      const solo = asRecord(state.soloStory);
      await tx.storyRun.update({ where: { id: run.runId }, data: { status: turnId ? "playing" : "waiting_players", stateJson: { ...state, soloStory: { ...solo, lastAttemptId: attemptId, lastFailure: failure.issues } } as any } });
    });
  }

  private async failBeforeProvider(attemptId: string, turnId: string, error: unknown, startedAt: number) {
    await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.soloGenerationAttempt.update({
        where: { id: attemptId },
        data: {
          status: "FAILED_RETRYABLE",
          providerCallCount: 0,
          issueCodesJson: ["STORY_PROVIDER_UNAVAILABLE"],
          failureReason: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
          timingsJson: { totalMs: Date.now() - startedAt, providerCallCount: 0 },
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null
        },
        select: { runId: true }
      });
      await tx.actorTurn.updateMany({ where: { id: turnId, status: "RESOLVING" }, data: { status: "OPEN" } });
      await tx.storyRun.update({ where: { id: attempt.runId }, data: { status: "playing" } });
    });
  }

  private async markPublishFailure(attemptId: string, error: unknown, turnId?: string) {
    const attempt = await this.prisma.soloGenerationAttempt.findUnique({ where: { id: attemptId }, select: { runId: true, status: true } });
    if (!attempt || attempt.status === "PUBLISHED") return;
    const operations = [
      this.prisma.soloGenerationAttempt.updateMany({
        where: { id: attemptId, status: { not: "PUBLISHED" } },
        data: { status: "FAILED_RETRYABLE", failureReason: `PUBLISH_FAILED:${error instanceof Error ? error.message : String(error)}`.slice(0, 2000), finishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }
      }),
      // The model result is already durable at this point. Keep an action turn
      // resolving until the outbox publishes that exact result. Reopening the
      // turn would invite a second, different action into the reserved slot.
      this.prisma.storyRun.update({ where: { id: attempt.runId }, data: { status: turnId ? "resolving" : "waiting_players" } })
    ];
    await this.prisma.$transaction(operations);
  }

  private async resolutionResponse(user: AuthenticatedUser, runId: string, resolution: any): Promise<TurnDecisionResponseV2> {
    return { accepted: true, resolution: { id: resolution.id, appliedWorldSequence: resolution.appliedWorldSequence, resultNarrative: resolution.resultNarrative, nextHook: resolution.nextHook }, gameProjection: await this.game(user, runId) };
  }

  private assertTargetIsAvailable(raw: RawPlayerAction, targets: SoloAvailableTarget[]) {
    if (raw.source === "CUSTOM") return;
    const targetId = raw.source === "TALK" ? raw.personId : raw.source === "INVESTIGATE" ? raw.locationId : raw.targetId;
    if (!targets.some((target) => target.id === targetId) && raw.source !== "RECOMMENDED") {
      throw new BadRequestException({ code: "TARGET_NOT_AVAILABLE", message: "这个人物、地点或对象不在当前剧情允许的行动范围内。" });
    }
  }

  private async writeVisibleChanges(tx: any, runId: string, nodeId: string | null, roleId: string, attemptId: string, changes: string[], sourceActionIds: string[]) {
    for (let index = 0; index < changes.length; index += 1) {
      const content = String(changes[index] || "").trim();
      if (!content) continue;
      const factKey = `solo_${attemptId.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}_change_${index + 1}`;
      await tx.canonFact.upsert({
        where: { runId_factKey: { runId, factKey } },
        create: { runId, sourceNodeId: nodeId, factKey, content, status: "confirmed", visibility: "role_private", sourceEventIdsJson: [attemptId], sourceActionIdsJson: sourceActionIds, knownByRoleIdsJson: [roleId] },
        update: {}
      });
    }
  }

  private async writeDerivedFacts(tx: any, runId: string, nodeId: string | null, roleId: string, actionId: string, raw: RawPlayerAction, turnIndex: number) {
    for (const factKey of derivedFactKeys(raw, turnIndex)) {
      const content = `浙江总督第 ${turnIndex} 次行动已经开始执行，并进入本局可追溯的因果记录；具体结果以已发布剧情为准。`;
      await tx.canonFact.upsert({
        where: { runId_factKey: { runId, factKey } },
        create: { runId, sourceNodeId: nodeId, factKey, content, status: "confirmed", visibility: "public", sourceEventIdsJson: [], sourceActionIdsJson: [actionId], knownByRoleIdsJson: [roleId] },
        update: {}
      });
    }
  }

  private async consumeLeverage(tx: any, runId: string, roleId: string, actionId: string, keys: string[]) {
    for (const assetKey of keys) {
      const asset = await tx.roleAsset.findUnique({ where: { runId_assetKey: { runId, assetKey } } });
      if (!asset || asset.ownerRoleId !== roleId || asset.status !== "ACTIVE" || asset.quantity <= 0) throw new ConflictException({ code: "LEVERAGE_NOT_HELD", message: "这项筹码已经不在你手中。" });
      const afterQuantity = Math.max(0, asset.quantity - 1);
      const after = { quantity: afterQuantity, status: afterQuantity === 0 ? "SPENT" : "ACTIVE" };
      await tx.roleAsset.update({ where: { id: asset.id }, data: { quantity: after.quantity, status: after.status, version: { increment: 1 } } });
      await tx.roleAssetMutation.create({ data: { assetId: asset.id, actionId, mutationType: "CONSUME", delta: -1, fromRoleId: roleId, beforeJson: { quantity: asset.quantity, status: asset.status }, afterJson: after, idempotencyKey: `solo:${actionId}:consume:${assetKey}` } });
    }
  }
}

function attemptCreateData(input: { runId: string; triggerType: string; actorTurnId: string | null; submissionId: string | null; supersedesAttemptId: string | null; runtime: RuntimeInput }) {
  return {
    runId: input.runId,
    actorTurnId: input.actorTurnId,
    submissionId: input.submissionId,
    supersedesAttemptId: input.supersedesAttemptId,
    triggerType: input.triggerType,
    status: "ACTION_RESERVED",
    contextSnapshotHash: sha256Canonical({ nodeId: input.runtime.nodeId, visibleFactKeys: input.runtime.visibleFactKeys, recentCanon: input.runtime.recentCanon.map((entry) => entry.entryId) }),
    promptContractVersion: SOLO_STORY_PROMPT_CONTRACT_VERSION,
    storyPackageVersion: input.runtime.loaded.storyPackage.packageVersion,
    storyPackageHash: input.runtime.loaded.storyPackageSha256,
    idempotencyKey: `solo-attempt:${randomUUID()}`,
    issueCodesJson: []
  } as any;
}

function contextReport(context: CompiledStoryContext) {
  return {
    schemaVersion: SOLO_STORY_CONTEXT_VERSION,
    snapshotHash: context.snapshotHash,
    triggerType: context.triggerType,
    included: context.included.map((item) => ({ itemId: item.itemId, section: item.section, priority: item.priority, tokenEstimate: item.tokenEstimate })),
    dropped: context.dropped,
    tokenEstimate: context.included.reduce((sum, item) => sum + item.tokenEstimate, 0),
    playerActionLast: context.included.at(-1)?.section === "PLAYER_ACTION"
  };
}

function buildAvailableTargets(roles: any[], cards: StoryPackageCard[], playerRoleId: string): SoloAvailableTarget[] {
  const roleTargets = roles.filter((role) => role.id !== playerRoleId).map((role) => ({ type: "ROLE" as const, id: String(role.id), label: String(role.roleName) }));
  const cardTargets = cards.flatMap((card): SoloAvailableTarget[] => {
    const type = card.kind === "location" ? "LOCATION" : card.kind === "institution" ? "INSTITUTION" : card.kind === "evidence" ? "EVIDENCE" : card.kind === "material" ? "RESOURCE" : null;
    return type ? [{ type, id: card.cardId, label: card.title }] : [];
  });
  return [...roleTargets, ...cardTargets, { type: "PUBLIC_FRAME", id: "public_frame", label: "当前局势" }];
}

function turnContext(runtime: RuntimeInput, attemptId: string, output: StoryTurnPublishedOutput, availableTargets: SoloAvailableTarget[], nodeId = runtime.nodeId) {
  return {
    schemaVersion: SOLO_STORY_CONTEXT_VERSION,
    storyPackageVersion: runtime.loaded.storyPackage.packageVersion,
    storyPackageHash: runtime.loaded.storyPackageSha256,
    sourceMapHash: runtime.loaded.sourceMapSha256,
    nodeId,
    attemptId,
    endingState: output.endingState,
    availableTargets,
    framing: output.endingState.tension
  };
}

function readPending(value: unknown): PendingConsequence[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as PendingConsequence[] : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function leaseExpired(value: unknown) {
  return !value || new Date(value as any).getTime() <= Date.now();
}

function decisionFormFor(raw: RawPlayerAction) {
  return ({ RECOMMENDED: "STORY_CHOICE", TALK: "CONVERSATION", INVESTIGATE: "INVESTIGATION", USE_LEVERAGE: "LEVERAGE", CUSTOM: "CUSTOM_PLAN" } as const)[raw.source];
}

function derivedFactKeys(raw: RawPlayerAction, turnIndex: number) {
  void raw;
  return [`fact_player_action_${turnIndex}_started`];
}

function actionRejected(issues: Array<{ code: string; message: string }>) {
  return new BadRequestException({ code: issues[0]?.code || "ACTION_REJECTED", message: issues[0]?.message || "这项行动目前无法执行。", issues });
}

function requireControlCommand(command: ControlCommandV1) {
  if (!command || typeof command.idempotencyKey !== "string" || command.idempotencyKey.length < 8 || command.idempotencyKey.length > 160) {
    throw new BadRequestException({ code: "INVALID_IDEMPOTENCY_KEY", message: "A valid idempotency key is required" });
  }
  if (!Number.isInteger(command.expectedControlEpoch) || command.expectedControlEpoch < 1) {
    throw new BadRequestException({ code: "INVALID_CONTROL_EPOCH", message: "A valid expected control epoch is required" });
  }
}

function idempotencyReused() {
  return new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "The idempotency key was already used for another control transition" });
}

function generationFailure(runId: string, attemptId: string, result: ExecuteSoloStoryFailure) {
  return new ServiceUnavailableException({
    code: "GENERATION_FAILED_RETRYABLE",
    message: "这次剧情没有通过发布条件，系统没有伪造固定剧情，也没有自动重复调用 DeepSeek。请明确重试。",
    runId,
    attemptId,
    issues: result.issues
  });
}
