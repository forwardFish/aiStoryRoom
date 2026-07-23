import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { EVENT_DELIVERY_PAGE_SCHEMA_VERSION, type ControlCommandV1, type DecisionCandidateV2, type HeartbeatCommandV1, type TurnDecisionCommandV2, type TurnDecisionResponseV2 } from "@ai-story/shared";
import {
  buildStoryPackageRoleView,
  buildPartOneRuntimeWorkingSet,
  buildPartOneTurnProgressReport,
  createInitialPartOneState,
  evaluateStoryPackageDirector,
  finalizePartOneSettlement,
  loadPartOneRuntimePackage,
  loadStoryPackage,
  partOneRuntimeTargets,
  settlePartOneAction,
  type LoadedRuntimeStoryPackage,
  type LoadedPartOneRuntimePackage,
  type PartOneActionSettlement,
  type PartOneRuntimeWorkingSet,
  type PartOneState,
  type StoryPackageCard,
  type StoryPackageNode
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
import { executeSoloStoryTurn } from "./two-stage-executor";
import { fixedOpeningOutput, loadFixedStoryOpening } from "./fixed-opening";
import { extractStoryPreview, type SoloStoryPreview } from "./streamed-story-preview";
import { normalizePlayerIntent } from "./player-intent";
import { validatePlayerIntent } from "./local-validator";
import { buildDecisionCandidates, commandToRawPlayerAction, type SoloAvailableTarget } from "./runtime-mapper";
import {
  buildActionAvailability,
  rawActionLockReason,
  type SoloActionAffordances
} from "./action-availability";
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
  StoryProviderStage,
  StoryTurnClarificationOutput,
  StoryTurnPublishedOutput
} from "./types";

type JsonRecord = Record<string, any>;

type RuntimeInput = {
  loaded: LoadedRuntimeStoryPackage;
  loadedPartOne: LoadedPartOneRuntimePackage;
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
  actionAffordances: SoloActionAffordances;
  nextAvailableTargets: SoloAvailableTarget[];
  nextActionAffordances: SoloActionAffordances;
  activeAssetKeys: string[];
  visibleFactKeys: string[];
  partOneState: PartOneState;
  partOneSettlement: PartOneActionSettlement | null;
  partOneWorkingSet: PartOneRuntimeWorkingSet;
};

type ActionReservation = {
  attempt: any;
  submission: any;
  playerAction: any;
  turn: any;
  rawAction: RawPlayerAction;
  creditChargeId: string | null;
  runtime: RuntimeInput;
};

const MAX_PLAYER_ACTIONS = 20;
const LEASE_MS = 120_000;
const PUBLISH_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

@Injectable()
export class SoloStoryEngineService {
  private readonly logger = new Logger(SoloStoryEngineService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditConsumptionService) private readonly creditConsumption: CreditConsumptionService
  ) {}

  async activateNewRun(user: AuthenticatedUser, runId: string) {
    const loaded = loadStoryPackage("sangtian");
    const loadedPartOne = loadPartOneRuntimePackage("sangtian");
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
    if (
      run.engineVersion === SOLO_STORY_ENGINE_VERSION &&
      existingSolo.storyPackageHash === loaded.storyPackageSha256 &&
      existingSolo.authoringPackageHash === loadedPartOne.contentHash &&
      asRecord(state.partOne).partId === "PART-01"
    ) return;

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
              authoringPackageVersion: loadedPartOne.package.authoringReleaseVersion,
              authoringPackageHash: loadedPartOne.contentHash,
              currentSectionId: loadedPartOne.package.worldStart.sectionId,
              currentNodeId: loaded.storyPackage.openingNodeId,
              pendingConsequences: [],
              openingPublished: false,
              lastAttemptId: null,
              lastFailure: null
            },
            partOne: createInitialPartOneState(loadedPartOne.package)
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
      // A run can have legacy V2 tasks left behind when room creation reached
      // the old engine before Solo activation. They must never wake up and
      // compete with the isolated Solo action pipeline.
      await tx.storyTaskOutbox.updateMany({
        where: {
          runId,
          taskType: { in: ["ACTOR_OPENING_V2", "ACTOR_AGENT_TURN_V2", "ACTOR_RESULT_V2", "ACTOR_IMPACT_V2", "CONDITIONAL_ACTION_V2"] },
          status: { in: ["PENDING", "RUNNING"] }
        },
        data: {
          status: "COMPLETED",
          outcome: "NO_OP",
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null
        }
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

    const runtime = await this.buildRuntimeInput(actor.run, actor.role, 1);
    const previous = await this.latestAttempt(runId, "OPENING");
    const attempt = await this.createAttempt({ runId, triggerType: "OPENING", supersedesAttemptId: previous?.id || null, runtime });
    const authored = loadFixedStoryOpening(actor.run.templateKey, runtime.loaded);
    const output = fixedOpeningOutput(authored.opening);
    try {
      await this.publishOpening({ actor, runtime, attempt, output, contextHash: authored.contentHash });
    } catch (error) {
      await this.markPublishFailure(attempt.id, error);
      throw new ServiceUnavailableException({ code: "OPENING_PUBLISH_FAILED", message: "The authored opening could not be published. Please try again.", attemptId: attempt.id });
    }
    return { gameProjection: await this.game(user, runId) };
  }

  async game(user: AuthenticatedUser, runId: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      run: any;
      player: any;
      role: any;
      control: any | null;
      thread: any | null;
      turn: any | null;
      decisionSet: any | null;
      facts: any[];
      assets: any[];
      narratives: any[];
      runAllowanceAvailable: number;
      personalAvailable: number;
    }>>(Prisma.sql`
      SELECT
        to_jsonb(run_row) AS "run",
        to_jsonb(player_row) AS "player",
        to_jsonb(role_row) AS "role",
        CASE WHEN control_row.id IS NULL THEN NULL ELSE to_jsonb(control_row) END AS "control",
        CASE WHEN thread_row.id IS NULL THEN NULL ELSE to_jsonb(thread_row) END AS "thread",
        CASE WHEN turn_row.id IS NULL THEN NULL ELSE to_jsonb(turn_row) END AS "turn",
        CASE WHEN decision_row.id IS NULL THEN NULL ELSE to_jsonb(decision_row) END AS "decisionSet",
        COALESCE((
          SELECT jsonb_agg(to_jsonb(fact) ORDER BY fact."createdAt")
          FROM "CanonFact" fact
          WHERE fact."runId" = run_row.id AND fact.status = 'confirmed'
        ), '[]'::jsonb) AS "facts",
        COALESCE((
          SELECT jsonb_agg(to_jsonb(asset) ORDER BY asset."createdAt")
          FROM "RoleAsset" asset
          WHERE asset."runId" = run_row.id
            AND (asset."ownerRoleId" = role_row.id OR asset.visibility = 'PUBLIC')
        ), '[]'::jsonb) AS "assets",
        COALESCE((
          SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry."worldSequence", entry."createdAt")
          FROM "NarrativeEntry" entry
          WHERE entry."runId" = run_row.id
            AND (entry.visibility = 'public' OR (entry.visibility = 'role_private' AND entry."roleId" = role_row.id))
        ), '[]'::jsonb) AS "narratives",
        COALESCE((
          SELECT SUM(allowance."remainingAmount")::int
          FROM "RunCreditAllowance" allowance
          WHERE allowance."runId" = run_row.id
            AND allowance."beneficiaryUserId" = ${user.id}
            AND allowance.status = 'ACTIVE'
            AND allowance."remainingAmount" > 0
            AND (allowance."expiresAt" IS NULL OR allowance."expiresAt" > CURRENT_TIMESTAMP)
        ), 0)::int AS "runAllowanceAvailable",
        COALESCE(wallet."purchasedBalance", 0)::int + COALESCE(wallet."bonusBalance", 0)::int - COALESCE(wallet."debtBalance", 0)::int AS "personalAvailable"
      FROM "StoryPlayer" player_row
      JOIN "StoryRun" run_row ON run_row.id = player_row."runId"
      JOIN "StoryRole" role_row ON role_row.id = player_row."roleId"
      LEFT JOIN "RoleControl" control_row ON control_row."runId" = run_row.id AND control_row."roleId" = role_row.id
      LEFT JOIN "ActorThread" thread_row ON thread_row."runId" = run_row.id AND thread_row."roleId" = role_row.id
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM "ActorTurn" candidate
        WHERE candidate."threadId" = thread_row.id
        ORDER BY candidate."turnIndex" DESC, candidate.revision DESC
        LIMIT 1
      ) turn_row ON TRUE
      LEFT JOIN "DecisionSet" decision_row ON decision_row."turnId" = turn_row.id
      LEFT JOIN "CreditWallet" wallet ON wallet."userId" = ${user.id}
      WHERE player_row."runId" = ${runId} AND player_row."userId" = ${user.id}
      LIMIT 1
    `);
    const snapshot = rows[0];
    if (!snapshot) {
      const runExists = await this.prisma.storyRun.findUnique({ where: { id: runId }, select: { id: true } });
      if (!runExists) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership required" });
    }
    const actor = { run: snapshot.run, player: snapshot.player, role: snapshot.role };
    if (actor.run.engineVersion !== SOLO_STORY_ENGINE_VERSION) throw new ConflictException({ code: "SOLO_ENGINE_NOT_ACTIVE", message: "这局游戏没有使用新的 Solo 剧情引擎。" });
    if (actor.role.roleKey !== "zhejiang_governor") throw new ForbiddenException({ code: "SOLO_ROLE_UNSUPPORTED", message: "当前验收只开放浙江总督视角。" });
    const creditConfig = readCreditConsumptionConfig();
    const billing = parseRunBilling(actor.run, creditConfig.prices);
    const authoredOpening = loadFixedStoryOpening(actor.run.templateKey, loadStoryPackage(actor.run.templateKey));
    const creditAvailability = {
      runAllowanceAvailable: Number(snapshot.runAllowanceAvailable || 0),
      personalAvailable: Number(snapshot.personalAvailable || 0),
      available: Number(snapshot.runAllowanceAvailable || 0) + Number(snapshot.personalAvailable || 0)
    };
    // Solo does not support sponsorship requests. Keep the shared sponsorship
    // tables for multiplayer, but do not query them while building a Solo
    // projection.
    return buildSoloStoryProjection({
      run: actor.run,
      player: actor.player,
      role: actor.role,
      control: snapshot.control,
      thread: snapshot.thread,
      turn: snapshot.turn,
      decisionSet: snapshot.decisionSet,
      narratives: snapshot.narratives,
      facts: snapshot.facts,
      assets: snapshot.assets,
      prologueNarrative: authoredOpening.opening.prologueNarrative,
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
        sponsorshipRequestStatus: "NONE"
      }
    });
  }

  async submit(
    user: AuthenticatedUser,
    runId: string,
    turnId: string,
    command: TurnDecisionCommandV2,
    onPreview?: (preview: SoloStoryPreview) => void | Promise<void>
  ): Promise<TurnDecisionResponseV2> {
    const actor = await this.requireActor(user, runId);
    if (actor.run.status === "chapter_generated") throw new ConflictException({ code: "STORY_COMPLETED", message: "这条故事已经结束。" });
    const snapshots = await this.prisma.$queryRaw<Array<{ turn: any; control: any | null }>>(Prisma.sql`
      SELECT
        to_jsonb(turn_row)
          || jsonb_build_object(
            'decisionSet', CASE WHEN decision_row.id IS NULL THEN NULL ELSE to_jsonb(decision_row) END,
            'submission', CASE WHEN submission_row.id IS NULL THEN NULL ELSE
              to_jsonb(submission_row) || jsonb_build_object(
                'resolution', CASE WHEN resolution_row.id IS NULL THEN NULL ELSE to_jsonb(resolution_row) END
              ) END
          ) AS turn,
        CASE WHEN control_row.id IS NULL THEN NULL ELSE to_jsonb(control_row) END AS control
      FROM "ActorTurn" turn_row
      LEFT JOIN "DecisionSet" decision_row ON decision_row."turnId" = turn_row.id
      LEFT JOIN "DecisionSubmission" submission_row ON submission_row."turnId" = turn_row.id
      LEFT JOIN "ActionResolution" resolution_row ON resolution_row."submissionId" = submission_row.id
      LEFT JOIN "RoleControl" control_row
        ON control_row."runId" = turn_row."runId" AND control_row."roleId" = turn_row."roleId"
      WHERE turn_row.id = ${turnId}
      LIMIT 1
    `);
    const turn = snapshots[0]?.turn;
    if (!turn || turn.runId !== runId || turn.roleId !== actor.role.id) throw new NotFoundException({ code: "TURN_NOT_FOUND", message: "当前剧情节点不存在。" });
    const control = snapshots[0]?.control;
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
    const runtimeForValidation = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex, rawAction);
    const validation = validatePlayerIntent(normalized.intent, runtimeForValidation.role, runtimeForValidation.availableTargets);
    if (!validation.ok) throw actionRejected(validation.issues);
    const actionAvailability = buildActionAvailability({
      turnStatus: normalizeAvailabilityTurnStatus(turn.status),
      canHumanAct: true,
      completed: false,
      storyPublished: Boolean(turn.situationNarrative),
      decisions: candidates as any,
      availableTargets: runtimeForValidation.availableTargets,
      activeAssetKeys: runtimeForValidation.activeAssetKeys,
      affordances: runtimeForValidation.actionAffordances,
      storyChoiceOnly: runtimeForValidation.partOneWorkingSet.partId === "PART-01"
    });
    const lockReason = rawActionLockReason(rawAction, actionAvailability);
    if (lockReason) throw new BadRequestException({ code: "ACTION_FORM_NOT_AVAILABLE", message: lockReason });
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
      return this.executeActionReservation(user, actor, retry, onPreview);
    }

    if (turn.status !== "OPEN") throw new ConflictException({ code: "TURN_MOVED", message: "局势已经变化，请刷新后继续。" });
    const reservation = await this.reserveAction(actor, turn, command, rawAction, normalized.intent, requestHash, runtimeForValidation);
    return this.executeActionReservation(user, actor, reservation, onPreview);
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
      const runtime = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex, submission.rawIntentJson as unknown as RawPlayerAction);
      const resolution = asRecord(failed.confirmedResolutionJson) as ConfirmedResolution;
      const playerAction = await this.prisma.playerAction.findUniqueOrThrow({ where: { id: submission.playerActionId! } });
      const charge = await (this.prisma as any).creditCharge.findUnique({ where: { playerActionId: playerAction.id } });
      const response = await this.publishAction({ actor, runtime, reservation: { attempt: failed, submission, playerAction, turn, rawAction: submission.rawIntentJson as unknown as RawPlayerAction, creditChargeId: charge?.id || null, runtime }, output: failed.parsedOutput as unknown as StoryTurnPublishedOutput, actionResolution: resolution, contextHash: failed.contextSnapshotHash || "recovered" });
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
      chapter: { title: "浙江总督的二十次落子", content: entries.map((entry) => entry.content).join("\n\n"), highlights: entries.filter((entry) => entry.entryType === "RESULT").slice(-3).map((entry) => entry.content) },
      player: { roleName: actor.role.roleName, personalGoal: actor.role.personalGoal },
      completedNodes: actor.run.completedNodeCount
    };
  }

  async events(user: AuthenticatedUser, runId: string, afterSequence = 0) {
    const actor = await this.requireActor(user, runId);
    const normalizedAfter = Number.isSafeInteger(afterSequence) && afterSequence >= 0 ? afterSequence : 0;
    const resolutions = await this.prisma.actionResolution.findMany({
      where: { runId, appliedWorldSequence: { gt: normalizedAfter } },
      orderBy: { appliedWorldSequence: "asc" },
      take: 101,
      select: { id: true, appliedWorldSequence: true, outcomeJson: true, resolvedAt: true }
    });
    const hasMore = resolutions.length > 100;
    const page = resolutions.slice(0, 100);
    const deliveries = page.map((row) => {
      const outcome = asRecord(row.outcomeJson);
      const event = asRecord(outcome.partOneEvent);
      return {
        deliverySequence: row.appliedWorldSequence,
        eventId: String(event.eventId || row.id),
        eventType: "PART_ONE_COMMITTED_EVENT",
        payload: {
          event,
          endingState: outcome.endingState || null,
          retrievalTrace: outcome.partOneRetrievalTrace || null
        },
        createdAt: row.resolvedAt.toISOString()
      };
    });
    return {
      schemaVersion: EVENT_DELIVERY_PAGE_SCHEMA_VERSION,
      deliveries,
      nextAfterDeliverySequence: page.at(-1)?.appliedWorldSequence ?? Math.min(normalizedAfter, Number(actor.run.worldSequence || 0)),
      hasMore
    };
  }

  async heartbeat(user: AuthenticatedUser, runId: string, command: HeartbeatCommandV1) {
    const actor = await this.requireActor(user, runId);
    // Solo has no other human participant waiting on presence. Keep this
    // endpoint compatible with an older cached client, but do not turn an idle
    // Solo page into a periodic database write.
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
    const runtime = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex, submission.rawIntentJson as unknown as RawPlayerAction);
    const published = await this.publishAction({
      actor,
      runtime,
      reservation: {
        attempt,
        submission,
        playerAction,
        turn,
        rawAction: submission.rawIntentJson as unknown as RawPlayerAction,
        creditChargeId: charge?.id || null,
        runtime
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
    const decisionKernelId = decisionMarker(candidate.effectHooks, "decisionKernel:");
    const affordanceTemplateId = decisionMarker(candidate.effectHooks, "affordance:");
    const rawAction: RawPlayerAction = {
      source: "RECOMMENDED",
      decisionId: String(candidate.id),
      label: String(candidate.label),
      targetId: String(candidate.intentDraft?.target?.id || ""),
      targetLabel: String(candidate.intentDraft?.target?.label || ""),
      actionText: String(affordanceTemplateId
        ? candidate.intentDraft?.objective || candidate.description || candidate.intentDraft?.method || candidate.label
        : candidate.intentDraft?.method || candidate.intentDraft?.objective || candidate.description || candidate.label),
      decisionKernelId,
      affordanceTemplateId
    };
    const normalized = normalizePlayerIntent(rawAction);
    if (!normalized.ok) throw actionRejected(normalized.issues);
    const runtime = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex, rawAction);
    const validation = validatePlayerIntent(normalized.intent, runtime.role, runtime.availableTargets);
    if (!validation.ok) throw actionRejected(validation.issues);
    const targetRoleId = await this.resolveRoleTargetId(
      runId,
      String(candidate.intentDraft?.target?.type || "ROLE"),
      normalized.intent.targetId
    );
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
          targetRoleId,
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
      return { attempt, submission, playerAction, turn, rawAction, creditChargeId: null, runtime };
    });
    if (!reservation) return { outcome: "LEASE_LOST" };
    const result = await this.executeActionReservation(user, actor, reservation);
    if (!result.accepted) throw new Error("SOLO_AI_ACTION_NEEDS_RETRY");
    return { outcome: "SOLO_AI_TURN_PUBLISHED", turnId: turn.id };
  }

  private async executeActionReservation(
    user: AuthenticatedUser,
    actor: Awaited<ReturnType<SoloStoryEngineService["requireActor"]>>,
    reservation: ActionReservation,
    onPreview?: (preview: SoloStoryPreview) => void | Promise<void>
  ): Promise<TurnDecisionResponseV2> {
    const startedAt = Date.now();
    const runtime = reservation.runtime;
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
    let lastPreviewSignature = "";
    let lastPreviewAt = 0;
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
      nextAvailableTargets: runtime.nextAvailableTargets,
      partOneRuntime: runtime.partOneWorkingSet,
      partOneSettlement: runtime.partOneSettlement,
      rawAction: reservation.rawAction,
      transport,
      onBeforeProviderCall: (stage) => this.reserveProviderCall(reservation.attempt.id, stage),
      onProviderTextDelta: onPreview ? async (_delta, accumulated) => {
        const preview = extractStoryPreview(accumulated);
        if (!preview?.text) return;
        const signature = `${preview.title}\u0000${preview.text}`;
        if (signature === lastPreviewSignature) return;
        const now = Date.now();
        const reachesReadingPause = /[。！？；：\n]$/.test(preview.text);
        if (!reachesReadingPause && now - lastPreviewAt < 80) return;
        lastPreviewSignature = signature;
        lastPreviewAt = now;
        await onPreview(preview);
      } : undefined
    });
    if (!result.ok) {
      await this.failAttempt(reservation.attempt.id, result, startedAt, reservation.turn.id);
      throw generationFailure(actor.run.id, reservation.attempt.id, result);
    }
    try {
      await this.persistSuccessfulGeneration(reservation.attempt.id, result, startedAt);
    } catch (error) {
      await this.markResultPersistenceFailure(reservation.attempt.id, reservation.turn.id, error, startedAt);
      throw new ServiceUnavailableException({
        code: "GENERATION_FAILED_RETRYABLE",
        message: "The story model returned, but the result could not be saved. Retry the same action; the system will not retry automatically.",
        runId: actor.run.id,
        attemptId: reservation.attempt.id
      });
    }
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
    const config = readCreditConsumptionConfig();
    const billing = parseRunBilling(actor.run, config.prices);
    const targetRoleId = await this.resolveRoleTargetId(
      actor.run.id,
      String(command.intent.target.type || ""),
      String(intent.targetId || "")
    );
    const playerActionId = `solo_action_${randomUUID().replace(/-/g, "")}`;
    const submissionId = `solo_submission_${randomUUID().replace(/-/g, "")}`;
    const attemptId = `solo_attempt_${randomUUID().replace(/-/g, "")}`;
    const attemptData = attemptCreateData({ runId: actor.run.id, triggerType: "PLAYER_ACTION", actorTurnId: turn.id, submissionId, supersedesAttemptId: null, runtime });
    const outcome = await this.prisma.$transaction(async (tx) => {
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
        const reservation = await this.creditConsumption.reserveSoloActionCharge({
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
          return { insufficient: reservation } as const;
        }
        if (reservation.kind === "replay" && reservation.charge?.status === "RELEASED") {
          throw new ConflictException({
            code: "CREDIT_ACTION_ALREADY_FAILED",
            message: "This action request already ended without publication; submit a new action with a new idempotency key"
          });
        }
        creditChargeId = reservation.charge?.id || null;
      }
      const records = await tx.$queryRaw<Array<{ playerAction: any; submission: any; attempt: any }>>(Prisma.sql`
        WITH moved_turn AS (
          UPDATE "ActorTurn"
          SET status = 'RESOLVING', "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = ${turn.id} AND status = 'OPEN' AND revision = ${turn.revision}
          RETURNING *
        ), inserted_action AS (
          INSERT INTO "PlayerAction" (
            id, "runId", "nodeId", "chapterIndex", "userId", "roleId", "playerType",
            "actionType", "targetType", "targetId", "targetText", method, intent,
            "riskLevel", "freeText", "normalizedJson", "guardStatus", "guardReason",
            "auditStatus", status, "actionSlot", "actorKind", "controlEpoch", "policyVersion",
            "actionKey", "idempotencyKey", "requestHash", visibility, "targetRoleId", "leverageKey",
            "sealedAt", "createdAt", "updatedAt"
          )
          SELECT ${playerActionId}, ${actor.run.id}, ${actor.run.currentNodeId}, 1,
            ${actor.player.userId}, ${actor.role.id}, 'human', ${rawAction.source},
            ${command.intent.target.type}, ${intent.targetId || null}, ${intent.targetLabel || null},
            ${intent.method}, ${intent.objective}, ${String(command.intent.riskTolerance || "MEDIUM").toLowerCase()},
            ${intent.userFacingText || null}, ${JSON.stringify(intent)}::jsonb, 'accepted',
            'solo_story_local_validator', 'pending', 'accepted', ${`SOLO:${turn.id}`}, 'HUMAN',
            ${command.controlEpoch}, ${SOLO_STORY_ENGINE_VERSION}, ${command.candidateId || null},
            ${`solo-action:${command.idempotencyKey}`}, ${requestHash}, ${command.intent.visibility},
            ${targetRoleId},
            ${command.intent.leverageKeys?.[0] || null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM moved_turn
          RETURNING *
        ), inserted_submission AS (
          INSERT INTO "DecisionSubmission" (
            id, "runId", "threadId", "turnId", "roleId", "userId", "playerActionId",
            "candidateId", "customAction", "normalizedActionJson", "rawIntentJson",
            "normalizedIntentJson", "immutableIntentHash", "guardDecisionJson",
            "selectedLeverageKeysJson", "controlEpoch", "idempotencyKey", "requestHash", status, "submittedAt"
          )
          SELECT ${submissionId}, ${actor.run.id}, ${turn.threadId}, ${turn.id}, ${actor.role.id},
            ${actor.player.userId}, inserted_action.id, ${command.candidateId || null}, ${command.customAction || null},
            ${JSON.stringify(intent)}::jsonb, ${JSON.stringify(rawAction)}::jsonb, ${JSON.stringify(command.intent)}::jsonb,
            ${intent.immutableIntentHash}, ${JSON.stringify({ decision: "ACCEPT", validator: "solo_story_local_validator" })}::jsonb,
            ${JSON.stringify(command.intent.leverageKeys || [])}::jsonb, ${command.controlEpoch},
            ${command.idempotencyKey}, ${requestHash}, 'ACCEPTED', CURRENT_TIMESTAMP
          FROM inserted_action
          RETURNING *
        ), attached_charge AS (
          UPDATE "CreditCharge"
          SET "playerActionId" = ${playerActionId}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = ${creditChargeId}
            AND ("playerActionId" IS NULL OR "playerActionId" = ${playerActionId})
          RETURNING id
        ), inserted_attempt AS (
          INSERT INTO "SoloGenerationAttempt" (
            id, "runId", "actorTurnId", "submissionId", "supersedesAttemptId", "triggerType", status,
            "contextSnapshotHash", "promptContractVersion", "storyPackageVersion", "storyPackageHash",
            "idempotencyKey", "issueCodesJson", "providerCallCount", "createdAt", "updatedAt"
          )
          SELECT ${attemptId}, ${actor.run.id}, ${turn.id}, inserted_submission.id, NULL, 'PLAYER_ACTION',
            'ACTION_RESERVED', ${attemptData.contextSnapshotHash}, ${attemptData.promptContractVersion},
            ${attemptData.storyPackageVersion}, ${attemptData.storyPackageHash}, ${attemptData.idempotencyKey},
            '[]'::jsonb, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM inserted_submission
          WHERE ${creditChargeId}::text IS NULL OR EXISTS (SELECT 1 FROM attached_charge)
          RETURNING *
        ), updated_run AS (
          UPDATE "StoryRun"
          SET status = 'resolving', version = version + 1, "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = ${actor.run.id} AND EXISTS (SELECT 1 FROM inserted_attempt)
          RETURNING id
        )
        SELECT to_jsonb(inserted_action) AS "playerAction",
               to_jsonb(inserted_submission) AS submission,
               to_jsonb(inserted_attempt) AS attempt
        FROM inserted_action, inserted_submission, inserted_attempt, updated_run
      `);
      const record = records[0];
      if (!record) {
        throw new ConflictException({
          code: creditChargeId ? "TURN_MOVED_OR_CREDIT_CHARGE_MISMATCH" : "TURN_MOVED",
          message: "局势已经变化，请刷新后继续。"
        });
      }
      return { ...record, turn, rawAction, creditChargeId, runtime };
    }, PUBLISH_TRANSACTION_OPTIONS);
    if ("insufficient" in outcome && outcome.insufficient) {
      const insufficient = outcome.insufficient;
      throw new HttpException({
        code: "PLAYER_CREDITS_REQUIRED",
        message: "Not enough World Credits to submit this action",
        requiredCredits: insufficient.required,
        availableCredits: insufficient.available,
        canRequestSponsor: false,
        purchaseUrl: `/credits?intent=PLAYER_RECLAIM&runId=${encodeURIComponent(actor.run.id)}&returnTo=${encodeURIComponent(`/game?runId=${actor.run.id}`)}`
      }, HttpStatus.PAYMENT_REQUIRED);
    }
    return outcome;
  }

  private async resolveRoleTargetId(runId: string, targetType: string, targetId: string): Promise<string | null> {
    if (targetType !== "ROLE" || !targetId) return null;
    const roleKey = targetId.startsWith("actor.") ? targetId.slice("actor.".length) : null;
    const target = await this.prisma.storyRole.findFirst({
      where: {
        runId,
        OR: [
          { id: targetId },
          ...(roleKey ? [{ roleKey }] : [])
        ]
      },
      select: { id: true }
    });
    return target?.id || null;
  }

  private async reserveRetry(actor: Awaited<ReturnType<SoloStoryEngineService["requireActor"]>>, turn: any, submission: any, rawAction: RawPlayerAction, previous: any): Promise<ActionReservation> {
    const runtime = await this.buildRuntimeInput(actor.run, actor.role, turn.turnIndex, rawAction);
    return this.prisma.$transaction(async (tx) => {
      await tx.soloGenerationAttempt.updateMany({ where: { id: previous?.id, status: { in: ["FAILED_RETRYABLE", "REJECTED", "GENERATING"] } }, data: { status: "SUPERSEDED", finishedAt: new Date() } });
      const attempt = await tx.soloGenerationAttempt.create({
        data: attemptCreateData({ runId: actor.run.id, triggerType: "PLAYER_ACTION", actorTurnId: turn.id, submissionId: submission.id, supersedesAttemptId: previous?.id || null, runtime })
      });
      await tx.actorTurn.update({ where: { id: turn.id }, data: { status: "RESOLVING" } });
      await tx.storyRun.update({ where: { id: actor.run.id }, data: { status: "resolving", version: { increment: 1 } } });
      const playerAction = await tx.playerAction.findUniqueOrThrow({ where: { id: submission.playerActionId } });
      const charge = await (tx as any).creditCharge.findUnique({ where: { playerActionId: playerAction.id } });
      return { attempt, submission, playerAction, turn, rawAction, creditChargeId: charge?.id || null, runtime };
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
          contextJson: turnContext(runtime, attempt.id, output, runtime.availableTargets, runtime.nodeId, runtime.actionAffordances),
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
    const partOnePendingIds = new Set(runtime.partOneSettlement?.proposedState.pendingConsequences.map((item) => item.consequenceId) || []);
    const paidPartOneConsequenceIds = (output.grounding.paidPendingConsequenceIds || []).filter((id) => partOnePendingIds.has(id));
    const finalizedPartOneSettlement = runtime.partOneSettlement
      ? finalizePartOneSettlement(runtime.partOneSettlement, paidPartOneConsequenceIds)
      : null;
    const nextPartOneState = finalizedPartOneSettlement?.proposedState || runtime.partOneState;
    const partOneProgressReport = finalizedPartOneSettlement
      ? buildPartOneTurnProgressReport(runtime.loadedPartOne.package, finalizedPartOneSettlement, {
          runId: actor.run.id,
          playerActionId: reservation.playerAction.id,
          paidPendingConsequenceIds: paidPartOneConsequenceIds
        })
      : null;
    const nextTurnIndex = reservation.turn.turnIndex + 1;
    const nextStageIndex = Math.min(MAX_PLAYER_ACTIONS, nextTurnIndex);
    const decisionForm = decisionFormFor(reservation.rawAction);
    const decisions = buildDecisionCandidates(output.decisions, runtime.role, runtime.nextAvailableTargets);
    const terminalHandoff = completed ? buildPartOneTerminalHandoff(nextPartOneState, runtime.role) : null;
    const publishedNextNarrative = terminalHandoff?.narrative || output.story.nextSituationNarrative;
    const surfaced = new Set(output.grounding.paidPendingConsequenceIds || []);
    const factKeys = [...runtime.visibleFactKeys, ...derivedFactKeys(reservation.rawAction, reservation.turn.turnIndex)];
    const existingState = asRecord(actor.run.stateJson);
    const existingSolo = asRecord(existingState.soloStory);
    const pending = [...readPending(existingSolo.pendingConsequences), ...actionResolution.pendingConsequences]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.consequenceId === item.consequenceId) === index)
      .filter((item) => !surfaced.has(item.consequenceId));
    const visibleFacts = output.endingState.visibleChanges
      .map((value, index) => ({ content: String(value || "").trim(), index }))
      .filter((item) => item.content)
      .map((item) => ({
        id: randomUUID(),
        factKey: `solo_${reservation.attempt.id.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}_change_${item.index + 1}`,
        content: item.content,
        visibility: "role_private",
        sourceEventIds: [reservation.attempt.id],
        sourceActionIds: [reservation.playerAction.id],
        knownByRoleIds: [actor.role.id]
      }));
    const derivedFacts = derivedFactKeys(reservation.rawAction, reservation.turn.turnIndex).map((factKey) => ({
      id: randomUUID(),
      factKey,
      content: `浙江总督第 ${reservation.turn.turnIndex} 次行动已经开始执行，并进入本局可追溯的因果记录；具体结果以已发布剧情为准。`,
      visibility: "public",
      sourceEventIds: [],
      sourceActionIds: [reservation.playerAction.id],
      knownByRoleIds: [actor.role.id]
    }));
    const factsToWrite = [...visibleFacts, ...derivedFacts];
    const resolutionId = randomUUID();
    const nextTurnId = randomUUID();
    const decisionSetId = randomUUID();
    const resultNarrativeId = randomUUID();
    const nextNarrativeId = randomUUID();
    const reclaimTransitionId = randomUUID();
    const aiTaskId = randomUUID();
    const leverageMutationRows = actionResolution.consumedLeverageKeys.map((assetKey) => ({ assetKey, mutationId: randomUUID() }));
    const nextContext = turnContext(runtime, reservation.attempt.id, output, runtime.nextAvailableTargets, runtime.nextNodeId, runtime.nextActionAffordances);
    const nextSoloState = {
      currentNodeId: runtime.nextNodeId,
      currentSectionId: nextPartOneState.sectionId,
      authoringPackageVersion: runtime.loadedPartOne.package.authoringReleaseVersion,
      authoringPackageHash: runtime.loadedPartOne.contentHash,
      pendingConsequences: pending,
      ...(terminalHandoff ? { terminalHandoff } : {}),
      lastAttemptId: reservation.attempt.id,
      lastFailure: null
    };

    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      appliedWorldSequence: number;
      resultNarrative: string;
      nextHook: string;
      reclaimEffective: boolean;
      leverageApplied: number;
    }>>(Prisma.sql`
      WITH run_context AS (
        SELECT run.id, run."currentNodeId", run."worldSequence" + 1 AS "nextWorldSequence"
        FROM "StoryRun" run
        WHERE run.id = ${actor.run.id}
        FOR UPDATE
      ), existing_resolution AS (
        SELECT resolution.*
        FROM "ActionResolution" resolution
        WHERE resolution."submissionId" = ${reservation.submission.id}
      ), requested_leverage AS (
        SELECT item."assetKey", item."mutationId"
        FROM jsonb_to_recordset(${JSON.stringify(leverageMutationRows)}::jsonb)
          AS item("assetKey" text, "mutationId" text)
      ), held_leverage AS (
        SELECT asset.*, requested."mutationId"
        FROM requested_leverage requested
        JOIN "RoleAsset" asset
          ON asset."runId" = ${actor.run.id}
         AND asset."assetKey" = requested."assetKey"
         AND asset."ownerRoleId" = ${actor.role.id}
         AND asset.status = 'ACTIVE'
         AND asset.quantity > 0
      ), inserted_resolution AS (
        INSERT INTO "ActionResolution" (
          id, "runId", "threadId", "turnId", "submissionId", "roleId", "playerActionId",
          "baseWorldSequence", "appliedWorldSequence", "outcomeJson", "statePatchJson",
          "resultNarrative", "nextHook", "qualityStatus", "resolvedAt", "createdAt"
        )
        SELECT ${resolutionId}, ${actor.run.id}, ${reservation.turn.threadId}, ${reservation.turn.id},
          ${reservation.submission.id}, ${actor.role.id}, ${reservation.playerAction.id},
          ${reservation.turn.baseWorldSequence}, run_context."nextWorldSequence",
          ${JSON.stringify({ endingState: output.endingState, actionResolution, modelResolution: output.resolution, decisionForm, partOneEvent: finalizedPartOneSettlement?.event || null, partOneProgressReport, partOneRetrievalTrace: runtime.partOneWorkingSet.retrievalTrace, partOneTerminalHandoff: terminalHandoff })}::jsonb,
          ${JSON.stringify({ visibleChanges: output.endingState.visibleChanges, pendingConsequences: pending, partOneState: nextPartOneState, changedStatePaths: finalizedPartOneSettlement?.event.changedStatePaths || [], partOneProgressReport })}::jsonb,
          ${output.story.resultNarrative}, ${publishedNextNarrative}, 'PASSED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM run_context
        WHERE NOT EXISTS (SELECT 1 FROM existing_resolution)
          AND (SELECT COUNT(*) FROM requested_leverage) = (SELECT COUNT(*) FROM held_leverage)
        RETURNING *
      ), effective_resolution AS (
        SELECT * FROM existing_resolution
        UNION ALL
        SELECT * FROM inserted_resolution
      ), updated_action AS (
        UPDATE "PlayerAction"
        SET "auditStatus" = 'ok', status = 'resolved',
            "resolvedJson" = ${JSON.stringify({ endingState: output.endingState })}::jsonb,
            "resolvedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${reservation.playerAction.id} AND EXISTS (SELECT 1 FROM effective_resolution)
        RETURNING id
      ), updated_submission AS (
        UPDATE "DecisionSubmission"
        SET status = 'RESOLVED', "resolvedAt" = CURRENT_TIMESTAMP
        WHERE id = ${reservation.submission.id} AND EXISTS (SELECT 1 FROM effective_resolution)
        RETURNING id
      ), updated_turn AS (
        UPDATE "ActorTurn"
        SET status = 'RESOLVED', "resolvedAt" = CURRENT_TIMESTAMP,
            "qualityStatus" = 'PASSED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${reservation.turn.id} AND EXISTS (SELECT 1 FROM effective_resolution)
        RETURNING id
      ), inserted_result_narrative AS (
        INSERT INTO "NarrativeEntry" (
          id, "runId", "nodeId", "roleId", "entryType", visibility, content,
          "factKeysJson", "threadKeysJson", "sourceEventIdsJson", "worldSequence", "dedupeKey", "createdAt"
        )
        SELECT ${resultNarrativeId}, ${actor.run.id}, run_context."currentNodeId", ${actor.role.id},
          'RESULT', 'role_private', ${output.story.resultNarrative}, ${JSON.stringify(factKeys)}::jsonb,
          '["main_pressure"]'::jsonb,
          ${JSON.stringify({ title: output.story.title, attemptId: reservation.attempt.id, decisionForm, partOneEventId: finalizedPartOneSettlement?.event.eventId || null })}::jsonb,
          run_context."nextWorldSequence", ${`solo:${reservation.attempt.id}:result`}, CURRENT_TIMESTAMP
        FROM run_context
        WHERE EXISTS (SELECT 1 FROM inserted_resolution)
        ON CONFLICT ("dedupeKey") DO NOTHING
        RETURNING id
      ), inserted_next_narrative AS (
        INSERT INTO "NarrativeEntry" (
          id, "runId", "nodeId", "roleId", "entryType", visibility, content,
          "factKeysJson", "threadKeysJson", "sourceEventIdsJson", "worldSequence", "dedupeKey", "createdAt"
        )
        SELECT ${nextNarrativeId}, ${actor.run.id}, run_context."currentNodeId", ${actor.role.id},
          ${completed ? "ENDING" : "NEXT_SITUATION"}, 'role_private', ${publishedNextNarrative},
          ${JSON.stringify(factKeys)}::jsonb, '["main_pressure"]'::jsonb,
          ${JSON.stringify({ title: completed ? "你的故事结局" : "新的局势", attemptId: reservation.attempt.id })}::jsonb,
          run_context."nextWorldSequence", ${`solo:${reservation.attempt.id}:next`}, CURRENT_TIMESTAMP
        FROM run_context
        WHERE EXISTS (SELECT 1 FROM inserted_resolution)
        ON CONFLICT ("dedupeKey") DO NOTHING
        RETURNING id
      ), fact_input AS (
        SELECT fact.*
        FROM jsonb_to_recordset(${JSON.stringify(factsToWrite)}::jsonb)
          AS fact(id text, "factKey" text, content text, visibility text,
                  "sourceEventIds" jsonb, "sourceActionIds" jsonb, "knownByRoleIds" jsonb)
      ), inserted_facts AS (
        INSERT INTO "CanonFact" (
          id, "runId", "sourceNodeId", "factKey", content, status, visibility,
          "sourceEventIdsJson", "sourceActionIdsJson", "knownByRoleIdsJson", "createdAt", "updatedAt"
        )
        SELECT fact.id, ${actor.run.id}, run_context."currentNodeId", fact."factKey", fact.content,
          'confirmed', fact.visibility, fact."sourceEventIds", fact."sourceActionIds", fact."knownByRoleIds",
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM fact_input fact CROSS JOIN run_context
        WHERE EXISTS (SELECT 1 FROM inserted_resolution)
        ON CONFLICT ("runId", "factKey") DO NOTHING
        RETURNING id
      ), updated_assets AS (
        UPDATE "RoleAsset" asset
        SET quantity = asset.quantity - 1,
            status = CASE WHEN asset.quantity - 1 = 0 THEN 'SPENT' ELSE 'ACTIVE' END,
            version = asset.version + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        FROM held_leverage held
        WHERE asset.id = held.id AND EXISTS (SELECT 1 FROM inserted_resolution)
        RETURNING asset.id, asset."assetKey", held."mutationId", held.quantity AS "beforeQuantity", asset.quantity AS "afterQuantity"
      ), inserted_mutations AS (
        INSERT INTO "RoleAssetMutation" (
          id, "assetId", "actionId", "mutationType", delta, "fromRoleId",
          "beforeJson", "afterJson", "idempotencyKey", "createdAt"
        )
        SELECT updated."mutationId", updated.id, ${reservation.playerAction.id}, 'CONSUME', -1, ${actor.role.id},
          jsonb_build_object('quantity', updated."beforeQuantity", 'status', 'ACTIVE'),
          jsonb_build_object('quantity', updated."afterQuantity", 'status', CASE WHEN updated."afterQuantity" = 0 THEN 'SPENT' ELSE 'ACTIVE' END),
          'solo:' || ${reservation.playerAction.id} || ':consume:' || updated."assetKey", CURRENT_TIMESTAMP
        FROM updated_assets updated
        ON CONFLICT ("idempotencyKey") DO NOTHING
        RETURNING id
      ), inserted_next_turn AS (
        INSERT INTO "ActorTurn" (
          id, "runId", "threadId", "roleId", "stageIndex", "turnIndex", status,
          "baseWorldSequence", revision, "situationTitle", "situationNarrative",
          "visibleFactKeysJson", "activeThreadKeysJson", "contextJson", "qualityStatus",
          "dedupeKey", "openedAt", "createdAt", "updatedAt"
        )
        SELECT ${nextTurnId}, ${actor.run.id}, ${reservation.turn.threadId}, ${actor.role.id},
          ${nextStageIndex}, ${nextTurnIndex}, 'OPEN', run_context."nextWorldSequence", 1,
          ${output.story.title}, ${output.story.nextSituationNarrative}, ${JSON.stringify(factKeys)}::jsonb,
          '["main_pressure"]'::jsonb, ${JSON.stringify(nextContext)}::jsonb, 'PASSED',
          ${`solo:${actor.run.id}:turn:${nextTurnIndex}`}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM run_context
        WHERE NOT ${completed} AND EXISTS (SELECT 1 FROM inserted_resolution)
        ON CONFLICT ("dedupeKey") DO NOTHING
        RETURNING id
      ), effective_next_turn AS (
        SELECT id FROM inserted_next_turn
        UNION ALL
        SELECT turn.id FROM "ActorTurn" turn
        WHERE turn."dedupeKey" = ${`solo:${actor.run.id}:turn:${nextTurnIndex}`}
          AND NOT EXISTS (SELECT 1 FROM inserted_next_turn)
        LIMIT 1
      ), inserted_decision_set AS (
        INSERT INTO "DecisionSet" (
          id, "runId", "turnId", "roleId", "contextHash", framing, "candidatesJson",
          "qualityStatus", "qualityJson", revision, "generatedAt"
        )
        SELECT ${decisionSetId}, ${actor.run.id}, next_turn.id, ${actor.role.id}, ${input.contextHash},
          ${output.endingState.tension || "局势已经给出回应，你准备如何继续？"}, ${JSON.stringify(decisions)}::jsonb,
          'PASSED', ${JSON.stringify({ validator: "solo_story_output_validator", attemptId: reservation.attempt.id })}::jsonb,
          1, CURRENT_TIMESTAMP
        FROM effective_next_turn next_turn
        WHERE NOT ${completed} AND EXISTS (SELECT 1 FROM inserted_resolution)
        ON CONFLICT ("turnId") DO NOTHING
        RETURNING id
      ), updated_thread AS (
        UPDATE "ActorThread"
        SET status = CASE WHEN ${completed} THEN 'COMPLETED' ELSE status END,
            "currentTurnIndex" = CASE WHEN ${completed} THEN ${reservation.turn.turnIndex} ELSE ${nextTurnIndex} END,
            "currentStageIndex" = CASE WHEN ${completed} THEN ${MAX_PLAYER_ACTIONS} ELSE ${nextStageIndex} END,
            "lastAppliedSequence" = (SELECT "nextWorldSequence" FROM run_context),
            "completedAt" = CASE WHEN ${completed} THEN CURRENT_TIMESTAMP ELSE NULL END,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${reservation.turn.threadId} AND EXISTS (SELECT 1 FROM inserted_resolution)
        RETURNING id
      ), updated_run AS (
        UPDATE "StoryRun" run
        SET status = ${completed ? "chapter_generated" : "playing"},
            "worldSequence" = run_context."nextWorldSequence",
            "currentDay" = ${completed ? MAX_PLAYER_ACTIONS : nextStageIndex},
            "completedNodeCount" = ${completed ? MAX_PLAYER_ACTIONS : reservation.turn.turnIndex},
            "stateJson" = jsonb_set(
              jsonb_set(
                COALESCE(run."stateJson", '{}'::jsonb), '{soloStory}',
                COALESCE(run."stateJson"->'soloStory', '{}'::jsonb) || ${JSON.stringify(nextSoloState)}::jsonb,
                true
              ),
              '{partOne}', ${JSON.stringify(nextPartOneState)}::jsonb, true
            ),
            version = run.version + 1,
            "updatedAt" = CURRENT_TIMESTAMP
        FROM run_context
        WHERE run.id = run_context.id AND EXISTS (SELECT 1 FROM inserted_resolution)
        RETURNING run.id
      ), reclaimed_control AS (
        UPDATE "RoleControl" control
        SET mode = 'HUMAN_ACTIVE', reason = 'RECLAIM_EFFECTIVE_NEXT_SOLO_TURN',
            "lastHeartbeatAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE control."runId" = ${actor.run.id} AND control."roleId" = ${actor.role.id}
          AND control.mode = 'HUMAN_RECLAIM_PENDING'
          AND EXISTS (SELECT 1 FROM inserted_resolution)
        RETURNING control.id, control.epoch
      ), inserted_reclaim_transition AS (
        INSERT INTO "RoleControlTransition" (
          id, "roleControlId", "fromMode", "toMode", "fromEpoch", "toEpoch", reason,
          "initiatedByUserId", "effectiveSlot", "idempotencyKey", "createdAt"
        )
        SELECT ${reclaimTransitionId}, control.id, 'HUMAN_RECLAIM_PENDING', 'HUMAN_ACTIVE',
          control.epoch, control.epoch, 'RECLAIM_EFFECTIVE_NEXT_SOLO_TURN', ${actor.player.userId},
          ${completed ? "SOLO:COMPLETED" : `SOLO:TURN:${nextTurnIndex}`},
          'solo-reclaim-effective:' || ${reservation.turn.id} || ':' || control.epoch::text,
          CURRENT_TIMESTAMP
        FROM reclaimed_control control
        ON CONFLICT ("idempotencyKey") DO NOTHING
        RETURNING id
      ), inserted_ai_task AS (
        INSERT INTO "StoryTaskOutbox" (
          id, "runId", "nodeId", "roleId", "inputRefId", "actionSlot", "controlEpoch",
          "taskType", status, "dedupeKey", "maxAttempts", "nextRetryAt", "createdAt", "updatedAt"
        )
        SELECT ${aiTaskId}, ${actor.run.id}, run_context."currentNodeId", ${actor.role.id}, next_turn.id,
          'SOLO_TURN', control.epoch, 'SOLO_AI_WORLD_TICK_V1', 'PENDING',
          'SOLO_AI_WORLD_TICK_V1:' || next_turn.id || ':' || control.epoch::text,
          3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM run_context
        CROSS JOIN effective_next_turn next_turn
        JOIN "RoleControl" control ON control."runId" = ${actor.run.id} AND control."roleId" = ${actor.role.id}
        WHERE NOT ${completed} AND control.mode = 'AI_ACTIVE' AND EXISTS (SELECT 1 FROM inserted_resolution)
        ON CONFLICT ("dedupeKey") DO NOTHING
        RETURNING id
      ), updated_attempt AS (
        UPDATE "SoloGenerationAttempt"
        SET status = 'PUBLISHED', "parsedOutput" = ${JSON.stringify(output)}::jsonb,
            "confirmedResolutionJson" = ${JSON.stringify(actionResolution)}::jsonb,
            "issueCodesJson" = '[]'::jsonb, "failureReason" = NULL,
            "finishedAt" = CURRENT_TIMESTAMP, "leaseOwner" = NULL, "leaseExpiresAt" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${reservation.attempt.id} AND EXISTS (SELECT 1 FROM effective_resolution)
        RETURNING id
      ), committed_allocations AS (
        UPDATE "CreditChargeAllocation"
        SET status = 'COMMITTED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "chargeId" = ${reservation.creditChargeId} AND status = 'RESERVED'
          AND EXISTS (SELECT 1 FROM effective_resolution)
        RETURNING id
      ), committed_charge AS (
        UPDATE "CreditCharge"
        SET status = 'COMMITTED', "committedAt" = CURRENT_TIMESTAMP,
            "expiresAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${reservation.creditChargeId} AND status = 'RESERVED'
          AND EXISTS (SELECT 1 FROM effective_resolution)
        RETURNING id
      ), completed_recovery_task AS (
        UPDATE "StoryTaskOutbox"
        SET status = 'COMPLETED', outcome = 'ALREADY_PUBLISHED', "completedAt" = CURRENT_TIMESTAMP,
            "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "dedupeKey" = ${`SOLO_PUBLISH_RECOVERY_V1:${reservation.attempt.id}`}
          AND status IN ('PENDING', 'RUNNING')
        RETURNING id
      )
      SELECT resolution.id,
             resolution."appliedWorldSequence",
             resolution."resultNarrative",
             resolution."nextHook",
             EXISTS (SELECT 1 FROM reclaimed_control) AS "reclaimEffective",
             (SELECT COUNT(*)::int FROM updated_assets) AS "leverageApplied"
      FROM effective_resolution resolution
      LIMIT 1
    `);
    const published = rows[0];
    if (!published) {
      if (actionResolution.consumedLeverageKeys.length) {
        throw new ConflictException({ code: "LEVERAGE_NOT_HELD", message: "这项筹码已经不在你手中。" });
      }
      throw new ConflictException({ code: "SOLO_PUBLISH_CONFLICT", message: "局势已经变化，请刷新后继续。" });
    }
    return published;
  }

  private async buildRuntimeInput(run: any, roleRow: any, turnIndex: number, rawAction: RawPlayerAction | null = null): Promise<RuntimeInput> {
    const loaded = loadStoryPackage(run.templateKey);
    const loadedPartOne = loadPartOneRuntimePackage(run.templateKey);
    const state = asRecord(run.stateJson);
    const solo = asRecord(state.soloStory);
    const storedPartOne = asRecord(state.partOne);
    const currentPartOneState = (storedPartOne.partId === "PART-01"
      ? structuredClone(storedPartOne)
      : createInitialPartOneState(loadedPartOne.package)) as PartOneState;
    const currentPartOneWorkingSet = buildPartOneRuntimeWorkingSet(
      loadedPartOne.package,
      currentPartOneState,
      Math.max(0, turnIndex - 1)
    );
    if (rawAction?.source === "RECOMMENDED" && !["opening_d1", "opening_d2"].includes(rawAction.decisionId)) {
      const isCurrentAffordance = currentPartOneWorkingSet.decisionAffordances.some((affordance) =>
        rawAction.decisionKernelId === currentPartOneWorkingSet.retrievalTrace.decisionKernelId
        && rawAction.affordanceTemplateId === affordance.affordanceTemplateId
        && rawAction.label === affordance.title
        && rawAction.actionText === affordance.actionText
      );
      if (!isCurrentAffordance) {
        throw new BadRequestException({
          code: "PART_ONE_CURRENT_AFFORDANCE_REQUIRED",
          message: "这项剧情选择不属于当前屏幕开放的两个决定，不能用其他回合的选择替换。"
        });
      }
    }
    const partOneSettlement = rawAction
      ? settlePartOneAction(loadedPartOne.package, currentPartOneState, partOneIncomingAction(rawAction), turnIndex)
      : null;
    if (
      rawAction?.source === "RECOMMENDED" &&
      !["opening_d1", "opening_d2"].includes(rawAction.decisionId) &&
      !partOneSettlement?.appliedAffordance
    ) {
      throw new BadRequestException({
        code: "PART_ONE_AFFORDANCE_BINDING_REQUIRED",
        message: "这项剧情选择没有绑定当前回合开放的决策内核，不能结算。"
      });
    }
    const partOneState = partOneSettlement?.proposedState || currentPartOneState;
    const partOneWorkingSet = buildPartOneRuntimeWorkingSet(loadedPartOne.package, partOneState, turnIndex);
    const currentNodeId = String(solo.currentNodeId || loaded.storyPackage.openingNodeId);
    const [runtimeRows] = await this.prisma.$queryRaw<Array<{
      facts: any[];
      narratives: any[];
      assets: any[];
      roles: any[];
    }>>(Prisma.sql`
      SELECT
        COALESCE((
          SELECT jsonb_agg(to_jsonb(fact) ORDER BY fact."createdAt")
          FROM "CanonFact" fact
          WHERE fact."runId" = ${run.id} AND fact.status = 'confirmed'
        ), '[]'::jsonb) AS facts,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(entry) ORDER BY entry."createdAt" DESC)
          FROM (
            SELECT candidate.*
            FROM "NarrativeEntry" candidate
            WHERE candidate."runId" = ${run.id}
              AND (candidate.visibility = 'public'
                OR (candidate.visibility = 'role_private' AND candidate."roleId" = ${roleRow.id}))
            ORDER BY candidate."createdAt" DESC
            LIMIT 3
          ) entry
        ), '[]'::jsonb) AS narratives,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(asset) ORDER BY asset."createdAt")
          FROM "RoleAsset" asset
          WHERE asset."runId" = ${run.id} AND asset."ownerRoleId" = ${roleRow.id}
            AND asset.status = 'ACTIVE' AND asset.quantity > 0
        ), '[]'::jsonb) AS assets,
        COALESCE((
          SELECT jsonb_agg(to_jsonb(role) ORDER BY role."createdAt")
          FROM "StoryRole" role
          WHERE role."runId" = ${run.id}
        ), '[]'::jsonb) AS roles
    `);
    const factsRows = runtimeRows?.facts || [];
    const narrativeRows = runtimeRows?.narratives || [];
    const assets = runtimeRows?.assets || [];
    const roles = runtimeRows?.roles || [];
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
      sceneId: partOneWorkingSet.section.sectionId,
      title: partOneWorkingSet.section.title,
      timeLabel: labels[0] || "嘉靖三十五年五月初八",
      locationLabel: labels[1] || "杭州总督府",
      situation: roleView.currentSituationText,
      mainlineQuestion: partOneWorkingSet.section.dramaticPurpose,
      mainlineQuestionIds: roleView.mainlineQuestions.map((question) => question.questionId),
      directedBeat: director.directedBeat ? { beatId: director.directedBeat.beatId, summary: director.directedBeat.externalWorldMove } : null
    };
    const runtimeCards: ScriptCard[] = partOneWorkingSet.institutionCapabilities.slice(0, 3).map((asset) => ({
      cardId: asset.assetId,
      title: asset.assetId,
      summary: String(asset.payload.dramaticFunction || asset.payload.goal || "本节获批制度与因果机制"),
      tags: [...asset.retrievalTags],
      priority: "P1",
      groundedFactIds: [...asset.sourceClaimIds]
    }));
    const relevantScriptCards: ScriptCard[] = [
      ...roleView.cards.map((card) => ({ cardId: card.cardId, title: card.title, summary: card.summary, tags: card.tags || [], priority: card.kind === "role" || card.kind === "evidence" || card.kind === "material" ? "P1" as const : "P2" as const, groundedFactIds: card.sourceIds })),
      ...runtimeCards
    ];
    const activePressures: ActivePressure[] = [
      ...roleView.pressures.map((pressure) => ({ pressureId: pressure.pressureId, summary: pressure.summary, priority: pressure.urgency === "high" ? "P0" as const : pressure.urgency === "medium" ? "P1" as const : "P2" as const })),
      { pressureId: `section:${partOneWorkingSet.section.sectionId}`, summary: partOneWorkingSet.section.dramaticPurpose, priority: "P0" }
    ];
    const recentCanon: RecentCanonEntry[] = recentRows.map((entry, index) => ({ entryId: entry.id, narrative: entry.content, chronologicalOrder: index + 1 }));
    const currentScope = buildNodeActionScope(node, roles, roleView.cards, roleRow.id);
    const currentTargets = mergeAvailableTargets(currentScope.availableTargets, partOneRuntimeTargets(currentPartOneWorkingSet));
    const nextNode = loaded.storyPackage.nodes.find((item) => item.nodeId === nextNodeId) || node;
    const nextRoleView = buildStoryPackageRoleView(run.templateKey, {
      roleKey: roleRow.roleKey,
      currentNodeId: nextNode.nodeId,
      currentTurn: turnIndex + 1,
      canonFactKeys: factsRows.map((fact) => fact.factKey)
    });
    const nextScope = buildNodeActionScope(nextNode, roles, nextRoleView.cards, roleRow.id);
    const nextTargets = mergeAvailableTargets(nextScope.availableTargets, partOneRuntimeTargets(partOneWorkingSet));
    const duePartOneConsequences: PendingConsequence[] = (partOneSettlement?.dueConsequences || []).map((item) => ({
      consequenceId: item.consequenceId,
      summary: item.summary,
      priority: item.priority,
      dueLabel: `第${item.dueTurn}回合`
    }));
    return {
      loaded,
      loadedPartOne,
      nodeId: currentNodeId,
      nextNodeId,
      role,
      scene,
      facts,
      recentCanon,
      pendingConsequences: [...readPending(solo.pendingConsequences), ...duePartOneConsequences]
        .filter((item, index, all) => all.findIndex((candidate) => candidate.consequenceId === item.consequenceId) === index),
      activePressures,
      relevantScriptCards,
      availableTargets: currentTargets,
      actionAffordances: currentScope.actionAffordances,
      nextAvailableTargets: nextTargets,
      nextActionAffordances: nextScope.actionAffordances,
      activeAssetKeys: assets.map((asset) => String(asset.assetKey)),
      visibleFactKeys,
      partOneState,
      partOneSettlement,
      partOneWorkingSet
    };
  }

  private async requireActor(user: AuthenticatedUser, runId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ run: any; player: any; role: any }>>(Prisma.sql`
      SELECT to_jsonb(run_row) AS run,
             to_jsonb(player_row) AS player,
             to_jsonb(role_row) AS role
      FROM "StoryPlayer" player_row
      JOIN "StoryRun" run_row ON run_row.id = player_row."runId"
      JOIN "StoryRole" role_row ON role_row.id = player_row."roleId"
      WHERE player_row."runId" = ${runId} AND player_row."userId" = ${user.id}
      LIMIT 1
    `);
    const snapshot = rows[0];
    if (!snapshot) {
      const runExists = await this.prisma.storyRun.findUnique({ where: { id: runId }, select: { id: true } });
      if (!runExists) throw new NotFoundException({ code: "ROOM_NOT_FOUND", message: "Room not found" });
      throw new ForbiddenException({ code: "ROOM_MEMBERSHIP_REQUIRED", message: "Room membership required" });
    }
    const { run, player, role } = snapshot;
    if (run.engineVersion !== SOLO_STORY_ENGINE_VERSION) throw new ConflictException({ code: "SOLO_ENGINE_NOT_ACTIVE", message: "这局游戏没有使用新的 Solo 剧情引擎。" });
    if (role.roleKey !== "zhejiang_governor") throw new ForbiddenException({ code: "SOLO_ROLE_UNSUPPORTED", message: "当前验收只开放浙江总督视角。" });
    return { run, player, role };
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

  /** A crashed request must never leave the player on an endless resolving
   * screen. GENERATING owns a bounded lease; once it expires there is no
   * durable provider result, so reopen the same reserved turn for an explicit
   * retry. This path never calls the provider. */
  private async recoverExpiredGeneration(runId: string) {
    const expired = await this.prisma.soloGenerationAttempt.findFirst({
      where: { runId, status: "GENERATING", leaseExpiresAt: { lt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, actorTurnId: true }
    });
    if (!expired) return false;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.soloGenerationAttempt.updateMany({
        where: { id: expired.id, status: "GENERATING", leaseExpiresAt: { lt: new Date() } },
        data: {
          status: "FAILED_RETRYABLE",
          issueCodesJson: ["GENERATION_LEASE_EXPIRED"],
          failureReason: "GENERATION_LEASE_EXPIRED_BEFORE_RESULT_PERSISTED",
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null
        }
      });
      if (updated.count !== 1) return false;
      if (expired.actorTurnId) {
        await tx.actorTurn.updateMany({ where: { id: expired.actorTurnId, status: "RESOLVING" }, data: { status: "OPEN" } });
      }
      await tx.storyRun.updateMany({ where: { id: runId, status: "resolving" }, data: { status: "playing", version: { increment: 1 } } });
      return true;
    });
  }

  private async reserveProviderCall(attemptId: string, stage: StoryProviderStage) {
    if (stage === "DECISION") {
      const updated = await this.prisma.soloGenerationAttempt.updateMany({
        where: { id: attemptId, status: "GENERATING", providerCallCount: 1 },
        data: {
          providerCallCount: 2,
          leaseOwner: `api:${process.pid}`,
          leaseExpiresAt: new Date(Date.now() + LEASE_MS)
        }
      });
      if (updated.count !== 1) throw new Error("DECISION_PROVIDER_CALL_RESERVATION_CONFLICT");
      return;
    }
    const updated = await this.prisma.soloGenerationAttempt.updateMany({
      where: { id: attemptId, status: "ACTION_RESERVED", providerCallCount: 0 },
      data: { status: "GENERATING", providerCallCount: 1, startedAt: new Date(), leaseOwner: `api:${process.pid}`, leaseExpiresAt: new Date(Date.now() + LEASE_MS) }
    });
    if (updated.count !== 1) throw new Error("PROVIDER_CALL_RESERVATION_CONFLICT");
  }

  private async persistSuccessfulGeneration(attemptId: string, result: Extract<Awaited<ReturnType<typeof executeSoloStoryTurn>>, { ok: true }>, startedAt: number) {
    const taskId = `solo_outbox_${randomUUID().replace(/-/g, "")}`;
    const timings = {
      totalMs: Date.now() - startedAt,
      providerCallCount: 2,
      narrationProviderCallCount: 1,
      decisionProviderCallCount: 1,
      narrator: {
        timings: result.narratorProvider.timings,
        usage: result.narratorProvider.usage,
        model: result.narratorProvider.model,
        providerRequestId: result.narratorProvider.providerRequestId || null
      },
      decision: {
        timings: result.decisionProvider.timings,
        usage: result.decisionProvider.usage,
        model: result.decisionProvider.model,
        providerRequestId: result.decisionProvider.providerRequestId || null
      }
    };
    const rawOutput = JSON.stringify({
      schemaVersion: "solo-two-stage-raw-v1",
      narrator: result.narratorProvider.rawText,
      decision: result.decisionProvider.rawText
    });
    const persisted = await this.prisma.$queryRaw<Array<{ attemptId: string; nodeId: string | null }>>(Prisma.sql`
      WITH updated_attempt AS (
        UPDATE "SoloGenerationAttempt"
        SET status = 'SUCCEEDED',
            "contextSnapshotHash" = ${result.context.snapshotHash},
            "providerRequestId" = ${result.decisionProvider.providerRequestId || result.narratorProvider.providerRequestId || null},
            "confirmedResolutionJson" = ${JSON.stringify(result.actionResolution)}::jsonb,
            "contextReportJson" = ${JSON.stringify(contextReport(result.context))}::jsonb,
            "rawOutput" = ${rawOutput},
            "parsedOutput" = ${JSON.stringify(result.output)}::jsonb,
            "issueCodesJson" = '[]'::jsonb,
            "timingsJson" = ${JSON.stringify(timings)}::jsonb,
            "finishedAt" = CURRENT_TIMESTAMP,
            "leaseOwner" = NULL,
            "leaseExpiresAt" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${attemptId}
        RETURNING id, "runId"
      ), run_context AS (
        SELECT updated_attempt.id AS "attemptId", updated_attempt."runId", run."currentNodeId"
        FROM updated_attempt
        JOIN "StoryRun" run ON run.id = updated_attempt."runId"
      ), inserted_outbox AS (
        INSERT INTO "StoryTaskOutbox" (
          id, "runId", "nodeId", "dedupeKey", "actionSlot", "taskType", status,
          "inputRefId", "maxAttempts", "nextRetryAt", "createdAt", "updatedAt"
        )
        SELECT ${taskId}, "runId", "currentNodeId",
               'SOLO_PUBLISH_RECOVERY_V1:' || "attemptId", 'SOLO_PUBLISH',
               'SOLO_PUBLISH_RECOVERY_V1', 'PENDING', "attemptId", 5,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM run_context
        WHERE "currentNodeId" IS NOT NULL
        ON CONFLICT ("dedupeKey") DO NOTHING
        RETURNING id
      )
      SELECT "attemptId", "currentNodeId" AS "nodeId" FROM run_context
    `);
    if (!persisted[0]?.nodeId) throw new Error(`SOLO_PUBLISH_RECOVERY_NODE_MISSING:${attemptId}`);
  }

  private async failAttempt(attemptId: string, failure: ExecuteSoloStoryFailure, startedAt: number, turnId?: string) {
    const failureRawOutput = failure.narratorProvider || failure.decisionProvider
      ? JSON.stringify({
          schemaVersion: "solo-two-stage-raw-v1",
          narrator: failure.narratorProvider?.rawText || null,
          decision: failure.decisionProvider?.rawText || null
        })
      : null;
    const cleanup = await this.prisma.$transaction(async (tx) => {
      const failedAttempt = await tx.soloGenerationAttempt.update({
        where: { id: attemptId },
        data: {
          status: failure.attempt.status === "REJECTED" ? "REJECTED" : "FAILED_RETRYABLE",
          contextSnapshotHash: failure.context?.snapshotHash || null,
          providerRequestId: failure.decisionProvider?.providerRequestId
            || failure.narratorProvider?.providerRequestId
            || null,
          confirmedResolutionJson: failure.actionResolution as any,
          contextReportJson: failure.context ? contextReport(failure.context) as any : undefined,
          rawOutput: failureRawOutput,
          issueCodesJson: failure.issues.map((issue) => issue.code),
          failureReason: failure.issues.map((issue) => issue.message).join("；").slice(0, 2000),
          timingsJson: {
            totalMs: Date.now() - startedAt,
            providerCallCount: failure.attempt.providerCallCount,
            narrationProviderCallCount: failure.attempt.narrationProviderCallCount,
            decisionProviderCallCount: failure.attempt.decisionProviderCallCount,
            failedStage: failure.failedStage || null,
            narrator: failure.narratorProvider?.timings || null,
            decision: failure.decisionProvider?.timings || null
          },
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null
        },
        select: { runId: true, submissionId: true }
      });
      let chargeId: string | null = null;
      if (failedAttempt.submissionId) {
        const submission = await tx.decisionSubmission.findUnique({ where: { id: failedAttempt.submissionId }, select: { playerActionId: true } });
        const charge = submission?.playerActionId ? await (tx as any).creditCharge.findUnique({ where: { playerActionId: submission.playerActionId } }) : null;
        if (charge?.status === "RESERVED") chargeId = charge.id;
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
      return { chargeId };
    });
    if (cleanup.chargeId) {
      try {
        // Failure-state durability must not depend on a second subsystem's
        // refund transaction. If refunding races the reconciler or the wallet
        // is temporarily unavailable, the attempt and turn are already in a
        // safe retryable state and the normal reconciler can release the
        // still-reserved charge later.
        await this.creditConsumption.releaseCharge(cleanup.chargeId, "GENERATION_NOT_PUBLISHED");
      } catch (error) {
        this.logger.error(
          `Solo generation failure was persisted but credit release is pending for attempt ${attemptId}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined
        );
      }
    }
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

  private async markResultPersistenceFailure(attemptId: string, turnId: string, error: unknown, startedAt: number) {
    await this.prisma.$transaction(async (tx) => {
      const providerCounts = await tx.soloGenerationAttempt.findUnique({
        where: { id: attemptId },
        select: { providerCallCount: true }
      });
      const providerCallCount = providerCounts?.providerCallCount || 0;
      const attempt = await tx.soloGenerationAttempt.update({
        where: { id: attemptId },
        data: {
          status: "FAILED_RETRYABLE",
          issueCodesJson: ["RESULT_PERSIST_FAILED"],
          failureReason: `RESULT_PERSIST_FAILED:${error instanceof Error ? error.message : String(error)}`.slice(0, 2000),
          timingsJson: {
            totalMs: Date.now() - startedAt,
            providerCallCount,
            narrationProviderCallCount: providerCallCount >= 1 ? 1 : 0,
            decisionProviderCallCount: providerCallCount >= 2 ? 1 : 0
          },
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null
        },
        select: { runId: true }
      });
      await tx.actorTurn.updateMany({ where: { id: turnId, status: "RESOLVING" }, data: { status: "OPEN" } });
      await tx.storyRun.update({ where: { id: attempt.runId }, data: { status: "playing", version: { increment: 1 } } });
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

  private async writeVisibleChanges(tx: any, runId: string, nodeId: string | null, roleId: string, attemptId: string, changes: string[], sourceActionIds: string[]) {
    const data = changes
      .map((value, index) => ({ content: String(value || "").trim(), index }))
      .filter((item) => item.content)
      .map((item) => ({
        runId,
        sourceNodeId: nodeId,
        factKey: `solo_${attemptId.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}_change_${item.index + 1}`,
        content: item.content,
        status: "confirmed",
        visibility: "role_private",
        sourceEventIdsJson: [attemptId],
        sourceActionIdsJson: sourceActionIds,
        knownByRoleIdsJson: [roleId]
      }));
    if (data.length) await tx.canonFact.createMany({ data, skipDuplicates: true });
  }

  private async writeDerivedFacts(tx: any, runId: string, nodeId: string | null, roleId: string, actionId: string, raw: RawPlayerAction, turnIndex: number) {
    const data = derivedFactKeys(raw, turnIndex).map((factKey) => ({
      runId,
      sourceNodeId: nodeId,
      factKey,
      content: `浙江总督第 ${turnIndex} 次行动已经开始执行，并进入本局可追溯的因果记录；具体结果以已发布剧情为准。`,
      status: "confirmed",
      visibility: "public",
      sourceEventIdsJson: [],
      sourceActionIdsJson: [actionId],
      knownByRoleIdsJson: [roleId]
    }));
    if (data.length) await tx.canonFact.createMany({ data, skipDuplicates: true });
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

  private async commitSoloCharge(tx: any, chargeId: string) {
    await tx.$executeRaw(Prisma.sql`
      WITH committed_allocations AS (
        UPDATE "CreditChargeAllocation"
        SET status = 'COMMITTED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE "chargeId" = ${chargeId} AND status = 'RESERVED'
        RETURNING id
      )
      UPDATE "CreditCharge"
      SET status = 'COMMITTED', "committedAt" = CURRENT_TIMESTAMP,
          "expiresAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${chargeId} AND status = 'RESERVED'
    `);
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
    contextSnapshotHash: sha256Canonical({
      nodeId: input.runtime.nodeId,
      visibleFactKeys: input.runtime.visibleFactKeys,
      recentCanon: input.runtime.recentCanon.map((entry) => entry.entryId),
      authoringPackageHash: input.runtime.loadedPartOne.contentHash,
      sectionId: input.runtime.partOneWorkingSet.section.sectionId,
      decisionKernelId: input.runtime.partOneWorkingSet.retrievalTrace.decisionKernelId,
      partOneEventId: input.runtime.partOneSettlement?.event.eventId || null
    }),
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

function buildNodeActionScope(
  node: StoryPackageNode,
  roles: any[],
  cards: StoryPackageCard[],
  playerRoleId: string
): { availableTargets: SoloAvailableTarget[]; actionAffordances: SoloActionAffordances } {
  const roleTargets = roles
    .filter((role) => role.id !== playerRoleId && node.actionAffordances.conversationRoleKeys.includes(String(role.roleKey)))
    .map((role) => ({ type: "ROLE" as const, id: String(role.id), label: String(role.roleName) }));
  const investigationTargets = cards.flatMap((card): SoloAvailableTarget[] => {
    if (!node.actionAffordances.investigationCardIds.includes(card.cardId)) return [];
    const type = card.kind === "location" ? "LOCATION" : card.kind === "institution" ? "INSTITUTION" : card.kind === "evidence" ? "EVIDENCE" : card.kind === "material" ? "RESOURCE" : null;
    return type ? [{ type, id: card.cardId, label: card.title }] : [];
  });
  const publicFrame: SoloAvailableTarget = { type: "PUBLIC_FRAME", id: "public_frame", label: "当前局势" };
  const availableTargets = [...roleTargets, ...investigationTargets, publicFrame];
  return {
    availableTargets,
    actionAffordances: {
      conversationTargetIds: roleTargets.map((target) => target.id),
      investigationTargetIds: investigationTargets.map((target) => target.id),
      leverageAssetKeys: [...node.actionAffordances.leverageAssetKeys],
      customPlanPressureIds: node.actionAffordances.customPlanPressureIds.filter((pressureId) => node.activePressureIds.includes(pressureId))
    }
  };
}

function buildPartOneTerminalHandoff(state: PartOneState, role: StoryRole) {
  const reportStatus = String(state.report?.dispatchStatus || "NOT_STARTED");
  const reportOpening = reportStatus === "DISPATCHED" || reportStatus === "SPLIT"
    ? "首份奏报已经离开浙江。"
    : reportStatus === "READY"
      ? "首份奏报已经写定，只待离开浙江。"
      : "首份奏报的第一版说法已经落定。";
  const publicFrame = { type: "PUBLIC_FRAME" as const, id: "public_frame", label: "第二部分入口局势" };
  const candidate = (
    id: string,
    label: string,
    description: string,
    cost: string,
    countermove: string
  ): DecisionCandidateV2 => ({
    id,
    actionKey: null,
    label,
    description,
    intent: description,
    targetRoleId: null,
    targetRoleName: null,
    risk: "NORMAL",
    basisFactKeys: ["part-one-handoff"],
    requiredAssetKeys: [],
    authorityBasis: role.permissions.join("、"),
    intendedOutcome: description,
    concreteCost: cost,
    expectedCountermove: countermove,
    visibility: "PRIVATE",
    effectHooks: ["partTwoHandoffPreview:readonly"],
    intentDraft: {
      objective: description,
      target: publicFrame,
      method: description,
      leverageKeys: [],
      visibility: "PRIVATE",
      riskTolerance: "MEDIUM",
      fallback: null,
      condition: null
    }
  });
  const decisions = [
    candidate(
      "part_two_handoff_grain",
      "先查粮路",
      "进入第二部分后，先核清官粮、借调粮与商会粮源各能维持多久，再决定由谁承担开仓和运输。",
      "能先压住断粮风险，但限制急售田地的处置会晚一步",
      "商会可能把粮量、担保与后续权利重新绑在一起"
    ),
    candidate(
      "part_two_handoff_land",
      "先查卖田",
      "进入第二部分后，先核查急售田契、购田人和粮债关系，阻止救急粮变成兼并民田的入口。",
      "能先守住民田边界，但粮食调度和米市安抚会承受更大压力",
      "掌握粮源的一方可能缩减供给，迫使官府放松购田限制"
    )
  ];
  return {
    schemaVersion: "sangtian-part-one-terminal-handoff-v1",
    title: "第一部分收束：急令与暗册",
    framing: "如果继续进入第二部分，你最想先处理哪一道正在逼近的危机？",
    narrative: [
      reportOpening,
      "它带走的是总督愿意让京师先看见的一版浙江事实，却带不走城里的粮食压力、百姓可能失田的风险，也带不走商会已经获得的谈判位置。",
      "县册疑云至此只有一条可追溯的入口，还没有查成完整罪案；督抚之间也只是各自留下了可以追责的文字，远未到御前裁决。",
      "第二部分将从粮荒与卖田展开。下面两项是尚未执行的入口方向，只供玩家判断下一步最关心什么；本回合不会提交，也不会生成 T21。"
    ].join("\n\n"),
    decisions
  };
}

function mergeAvailableTargets(
  left: SoloAvailableTarget[],
  right: Array<{ type: SoloAvailableTarget["type"]; id: string; label: string }>
): SoloAvailableTarget[] {
  const values = [...left, ...right];
  const seen = new Set<string>();
  return values.filter((target) => {
    const key = `${target.type}:${target.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function partOneIncomingAction(raw: RawPlayerAction) {
  if (raw.source === "RECOMMENDED") {
    return {
      source: raw.source,
      decisionId: raw.decisionId,
      decisionKernelId: raw.decisionKernelId || null,
      affordanceTemplateId: raw.affordanceTemplateId || null,
      label: raw.label,
      actionText: raw.actionText,
      targetRef: raw.targetId
    };
  }
  if (raw.source === "TALK") return { source: raw.source, actionText: raw.prompt, targetRef: raw.personId };
  if (raw.source === "INVESTIGATE") return { source: raw.source, actionText: raw.task, targetRef: raw.locationId };
  if (raw.source === "USE_LEVERAGE") return { source: raw.source, actionText: raw.task, targetRef: raw.targetId };
  return { source: raw.source, actionText: raw.text, targetRef: "public_frame" };
}

function decisionMarker(values: unknown, prefix: string) {
  if (!Array.isArray(values)) return null;
  const value = values.find((item) => typeof item === "string" && item.startsWith(prefix));
  return typeof value === "string" ? value.slice(prefix.length) : null;
}

function turnContext(
  runtime: RuntimeInput,
  attemptId: string,
  output: StoryTurnPublishedOutput,
  availableTargets: SoloAvailableTarget[],
  nodeId = runtime.nodeId,
  actionAffordances: SoloActionAffordances = runtime.actionAffordances
) {
  return {
    schemaVersion: SOLO_STORY_CONTEXT_VERSION,
    storyPackageVersion: runtime.loaded.storyPackage.packageVersion,
    storyPackageHash: runtime.loaded.storyPackageSha256,
    sourceMapHash: runtime.loaded.sourceMapSha256,
    authoringPackageVersion: runtime.loadedPartOne.package.authoringReleaseVersion,
    authoringPackageHash: runtime.loadedPartOne.contentHash,
    partId: runtime.partOneWorkingSet.partId,
    sectionId: runtime.partOneWorkingSet.section.sectionId,
    decisionKernelId: runtime.partOneWorkingSet.retrievalTrace.decisionKernelId,
    retrievalTrace: runtime.partOneWorkingSet.retrievalTrace,
    nodeId,
    attemptId,
    endingState: output.endingState,
    availableTargets,
    actionAffordances,
    framing: output.endingState.tension
  };
}

function normalizeAvailabilityTurnStatus(value: unknown): "OPEN" | "RESOLVING" | "RESOLVED" | "COMPLETED" {
  const normalized = String(value || "OPEN").toUpperCase();
  if (normalized === "RESOLVING") return "RESOLVING";
  if (normalized === "RESOLVED") return "RESOLVED";
  if (normalized === "COMPLETED") return "COMPLETED";
  return "OPEN";
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
