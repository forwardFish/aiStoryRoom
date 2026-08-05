import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  createActionPreviewV1,
  ManeuverValidationError,
  parseCreateActionPreviewCommandV1,
  projectContactsV1,
  projectEvidenceHandV1,
  projectInvestigationLeadsV1,
  projectRuleCardsV1,
  resolveInvestigationV1,
  stablePreviewRequestHashV1,
  type ActionPreviewPresentationV1,
  type ActionTargetV1,
  type CompiledManeuverActionV1,
  type ContactDefinitionV1,
  type CreateActionPreviewCommandV1,
  type EvidenceCardStateV1,
  type GameDefinition,
  type InvestigationRouteV1,
  type ManeuverCompileContextV1,
  type ManeuverDraftV1,
  type RuleCardDefinitionV1,
  type RuleCardHoldingV1,
  type WorldTraceV1,
} from "@ai-story/templates";
import type { ManeuverRulesProjectionV1, StoryTimelineEntryV2 } from "@ai-story/shared";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { sha256Canonical } from "../continuous-strategy/canonical";
import { PrismaService } from "../prisma.service";
import type { OpenNovelProjectionRun } from "../openovel-adapter/openovel-game-projection";
import type { OpenNovelPublicRun } from "../openovel-adapter/openovel-runtime.client";
import {
  SANGTIAN_MVP_ACTION_BINDINGS,
  SANGTIAN_MVP_CONTACTS,
  SANGTIAN_MVP_INVESTIGATION_ROUTES,
  SANGTIAN_MVP_RULE_CARDS,
  SANGTIAN_MVP_TARGETS,
  initialSangtianMvpRuleCardHoldings,
  initialSangtianMvpTraces,
} from "./sangtian-mvp-package";
import {
  signManeuverPreviewTokenV1,
  verifyManeuverPreviewTokenV1,
  type ManeuverPreviewTokenPayloadV1,
} from "./preview-token";

const MAX_MANEUVERS_PER_TURN = 2;
const PREVIEW_TTL_SECONDS = 5 * 60;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/u;
const STATE_KEY = "openNovelManeuverRulesV1";

type Tx = Prisma.TransactionClient;

export type OpenNovelManeuverRunV1 = OpenNovelProjectionRun & {
  selectedRoleKey: string | null;
  version: number;
  stateJson: unknown;
  currentNodeId?: string | null;
};

type OpenNovelManeuverActionV1 = {
  actionId: string;
  turnNumber: number;
  turnId: string;
  kind: CompiledManeuverActionV1["actionKind"];
  slot: "MANEUVER_1" | "MANEUVER_2" | "REACTION";
  title: string;
  narrative: string;
  status: "PENDING" | "ARMED" | "RESOLVED" | "EXPIRED";
  traceId?: string;
  routeId?: string;
  evidenceId?: string;
  resultNarrative?: string;
  sourcePreviewId: string;
  previewRequestHash: string;
  commitIdempotencyKey: string;
  draft: ManeuverDraftV1;
  compiledAction: CompiledManeuverActionV1;
  presentation: ActionPreviewPresentationV1;
  createdAt: string;
  resolvedAt?: string;
};

type OpenNovelArmedCardV1 = {
  actionId: string;
  turnNumber: number;
  cardAssetKey: string;
  targetId: string;
  triggerPatternId: string;
  status: "ARMED" | "TRIGGERED" | "EXPIRED";
  createdAt: string;
  resolvedAt?: string;
};

export type OpenNovelManeuverStateV1 = {
  schemaVersion: "openovel_maneuver_rules_state_v1";
  enabled: true;
  turnNumber: number;
  windowVersion: number;
  conversationUsed: number;
  investigationUsed: number;
  traces: WorldTraceV1[];
  evidenceCards: EvidenceCardStateV1[];
  ruleCardHoldings: RuleCardHoldingV1[];
  actions: OpenNovelManeuverActionV1[];
  armedCards: OpenNovelArmedCardV1[];
};

type Context = {
  run: OpenNovelManeuverRunV1;
  runtimeRun: OpenNovelPublicRun;
  game: GameDefinition;
  role: NonNullable<OpenNovelManeuverRunV1["players"][number]["role"]>;
  state: OpenNovelManeuverStateV1;
  compileContext: ManeuverCompileContextV1;
};

@Injectable()
export class OpenNovelSoloManeuverService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  enabledForRun(templateKey: string) {
    const explicit = String(process.env.MANEUVER_RULES_V1_ENABLED || "").trim().toLowerCase();
    if (["0", "false", "off", "disabled"].includes(explicit)) return false;
    // A missing flag is convenient for local/test runs, but production must
    // opt in explicitly.  This prevents a newly deployed build from silently
    // enabling an unfinished world package.
    if (!explicit && String(process.env.NODE_ENV || "").trim().toLowerCase() === "production") return false;
    const allowlist = String(process.env.MANEUVER_RULES_V1_WORLD_ALLOWLIST || "sangtian")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (explicit && !["1", "true", "on", "enabled"].includes(explicit)) return false;
    return (allowlist.includes("*") || allowlist.includes(templateKey)) && templateKey === "sangtian";
  }

  projection(input: {
    user: AuthenticatedUser;
    run: OpenNovelManeuverRunV1;
    runtimeRun: OpenNovelPublicRun;
    game: GameDefinition;
  }): ManeuverRulesProjectionV1 | undefined {
    if (!this.enabledForRun(input.run.templateKey) || input.runtimeRun.status === "COMPLETED") return undefined;
    const context = this.context(input);
    return projectState(context);
  }

  timeline(input: {
    user: AuthenticatedUser;
    run: OpenNovelManeuverRunV1;
    runtimeRun: OpenNovelPublicRun;
    game: GameDefinition;
  }): StoryTimelineEntryV2[] {
    if (!this.enabledForRun(input.run.templateKey)) return [];
    const context = this.context(input);
    return context.state.actions
      .filter((action) => action.turnNumber <= input.runtimeRun.turnNumber)
      .slice(-24)
      .map((action) => ({
        id: `maneuver:${action.actionId}`,
        kind: action.status === "RESOLVED" ? "MANEUVER_RESULT" as const : "MANEUVER_ACTION" as const,
        title: action.title,
        content: action.resultNarrative || action.narrative,
        worldSequence: action.turnNumber,
        createdAt: action.resolvedAt || action.createdAt,
        sourceActionId: action.actionId,
        decisionForm: decisionForm(action.kind),
      }));
  }

  async preview(input: {
    user: AuthenticatedUser;
    run: OpenNovelManeuverRunV1;
    runtimeRun: OpenNovelPublicRun;
    game: GameDefinition;
    turnId: string;
    command: unknown;
  }) {
    if (!this.enabledForRun(input.run.templateKey)) {
      throw new ConflictException({ code: "MANEUVER_PREVIEW_UNAVAILABLE", message: "当前故事局尚未启用有限谋划规则。" });
    }
    const context = this.context(input);
    this.assertTurn(context, input.turnId);
    let command: CreateActionPreviewCommandV1;
    try {
      command = parseCreateActionPreviewCommandV1(input.command);
    } catch (error) {
      if (error instanceof ManeuverValidationError) {
        throw new BadRequestException({ code: error.code, message: error.message, path: error.path });
      }
      throw error;
    }
    this.assertDraftAvailable(context.state, command.draft);
    if (command.draft.kind === "REACTION") {
      throw new ConflictException({
        code: "REACTION_WINDOW_CLOSED",
        message: "当前 OpenNovel Solo 场景没有可感知的应变事件。",
      });
    }
    let result;
    try {
      result = createActionPreviewV1(command, context.compileContext);
    } catch (error) {
      if (error instanceof ManeuverValidationError) {
        throw new BadRequestException({ code: error.code, message: error.message, path: error.path });
      }
      throw error;
    }
    if (result.decision !== "READY" || !result.previewId || !result.expiresAt || !result.compiledAction || !result.presentation) {
      return result;
    }
    const previewToken = signManeuverPreviewTokenV1({
      schemaVersion: "maneuver_preview_token_v1",
      previewId: result.previewId,
      runId: input.run.id,
      actorTurnId: context.compileContext.actorTurnId,
      turnVersion: context.compileContext.turnRevision,
      stateRevision: context.compileContext.stateRevision,
      maneuverWindowVersion: context.compileContext.maneuverWindowVersion,
      controlEpoch: context.compileContext.controlEpoch,
      contextHash: context.compileContext.contextHash,
      requestHash: stablePreviewRequestHashV1(command),
      previewIdempotencyKey: command.idempotencyKey,
      expiresAt: result.expiresAt,
      draft: command.draft,
      compiledAction: result.compiledAction,
      presentation: result.presentation,
    });
    const { compiledAction: _serverOwned, ...safe } = result;
    return { ...safe, previewToken };
  }

  async commit(input: {
    user: AuthenticatedUser;
    run: OpenNovelManeuverRunV1;
    runtimeRun: OpenNovelPublicRun;
    game: GameDefinition;
    previewId: string;
    command: unknown;
  }) {
    const body = commitCommand(input.command);
    let token: ManeuverPreviewTokenPayloadV1;
    try {
      token = verifyManeuverPreviewTokenV1(body.previewToken);
    } catch (error) {
      const code = objectCode(error) || "ACTION_PREVIEW_TOKEN_INVALID";
      const message = error instanceof Error ? error.message : "行动预演凭证无效，请重新预演。";
      if (code === "ACTION_PREVIEW_EXPIRED") throw new ConflictException({ code, message });
      throw new BadRequestException({ code, message });
    }
    if (token.previewId !== input.previewId || token.runId !== input.run.id) {
      throw new BadRequestException({ code: "ACTION_PREVIEW_TOKEN_INVALID", message: "行动预演不属于当前故事局。" });
    }

    const replayState = normalizeState(input.run, input.runtimeRun);
    const prior = replayState.actions.find((action) => action.commitIdempotencyKey === body.idempotencyKey);
    if (prior) {
      if (prior.sourcePreviewId !== input.previewId) {
        throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "同一个幂等键不能确认不同的行动预演。" });
      }
      return this.commitResponse(input, prior, replayState, true);
    }

    const expectedRunVersion = input.run.version;
    const context = this.context(input);
    this.assertTurn(context, token.actorTurnId);
    this.assertDraftAvailable(context.state, token.draft);
    assertTokenFresh(token, context, body);

    const action = token.compiledAction;
    if (action.actionKind === "REACTION") {
      throw new ConflictException({ code: "REACTION_WINDOW_CLOSED", message: "当前 OpenNovel Solo 场景没有可回应的应变窗口。" });
    }

    const now = new Date().toISOString();
    const slotIndex = activeTurnActions(context.state, input.runtimeRun.turnNumber).length + 1;
    const actionId = `ovl_mnv_${createHash("sha256")
      .update(`${input.run.id}\0${input.runtimeRun.turnNumber}\0${body.idempotencyKey}`)
      .digest("hex")
      .slice(0, 24)}`;
    const record: OpenNovelManeuverActionV1 = {
      actionId,
      turnNumber: input.runtimeRun.turnNumber,
      turnId: context.compileContext.actorTurnId,
      kind: action.actionKind,
      slot: slotIndex === 1 ? "MANEUVER_1" : "MANEUVER_2",
      title: token.presentation.title,
      narrative: token.presentation.narrative,
      status: "PENDING",
      sourcePreviewId: token.previewId,
      previewRequestHash: token.requestHash,
      commitIdempotencyKey: body.idempotencyKey,
      draft: token.draft,
      compiledAction: action,
      presentation: token.presentation,
      createdAt: now,
    };

    const nextState = structuredClone(context.state);
    nextState.windowVersion += 1;
    if (token.draft.kind === "CONVERSATION") nextState.conversationUsed += 1;
    if (token.draft.kind === "INVESTIGATION") nextState.investigationUsed += 1;
    applyCommittedAction(nextState, record, context);
    nextState.actions.push(record);
    if (nextState.actions.length > 80) nextState.actions = nextState.actions.slice(-80);

    await this.prisma.$transaction(async (tx: Tx) => {
      const fresh = await tx.storyRun.findUnique({
        where: { id: input.run.id },
        select: { version: true, stateJson: true },
      });
      if (!fresh || fresh.version !== expectedRunVersion) {
        throw new ConflictException({ code: "ACTION_PREVIEW_STALE", message: "局势已经发生变化，请重新预演。" });
      }
      const currentState = normalizeState({ ...input.run, version: fresh.version, stateJson: fresh.stateJson }, input.runtimeRun);
      if (currentState.actions.some((item) => item.commitIdempotencyKey === body.idempotencyKey)) return;
      if (contextHash(input.run, input.runtimeRun, currentState) !== token.contextHash
        || currentState.windowVersion !== token.maneuverWindowVersion) {
        throw new ConflictException({ code: "ACTION_PREVIEW_STALE", message: "局势已经发生变化，请重新预演。" });
      }

      const nodeId = maneuverNodeId(input.run.id, input.runtimeRun.turnNumber);
      await tx.sceneNode.upsert({
        where: { id: nodeId },
        update: { publicNarration: input.runtimeRun.recentCanon },
        create: {
          id: nodeId,
          runId: input.run.id,
          chapterIndex: 1,
          nodeIndex: 900_000_000 + input.runtimeRun.turnNumber,
          title: `OpenNovel Maneuver ${context.compileContext.actorTurnId}`,
          publicNarration: input.runtimeRun.recentCanon,
          nodeGoal: "场景内有限谋划",
          status: "open_for_actions",
          actionOptionsJson: [],
        },
      });
      await tx.playerAction.create({
        data: {
          id: actionId,
          runId: input.run.id,
          nodeId,
          chapterIndex: 1,
          userId: input.user.id,
          roleId: context.role.id,
          playerType: "human",
          actionType: `MANEUVER_${action.actionKind}_V1`,
          targetType: action.target.type,
          targetId: action.target.id,
          targetText: action.target.label,
          method: action.method,
          intent: action.objective,
          riskLevel: action.reactionPolicy.mode === "ALWAYS" ? "high" : action.tracePolicy.leavesTrace ? "normal" : "low",
          freeText: token.draft.kind === "CUSTOM_PLAN" ? token.draft.rawText : token.draft.kind === "CONVERSATION" ? token.draft.message : null,
          normalizedJson: {
            schemaVersion: "openovel_maneuver_action_v1",
            draft: token.draft,
            compiledAction: action,
            presentation: token.presentation,
            sourcePreviewId: token.previewId,
          } as unknown as Prisma.InputJsonValue,
          guardStatus: "ok",
          guardReason: "Maneuver preview confirmed",
          auditStatus: "ok",
          status: record.status,
          actionSlot: `MANEUVER:${context.compileContext.actorTurnId}:${slotIndex}`,
          actorKind: "HUMAN",
          controlEpoch: 1,
          policyVersion: "maneuver_rules_v1",
          provider: "deterministic",
          modelName: "maneuver-rules-v1",
          actionKey: action.settlementBindingId,
          idempotencyKey: `openovel-maneuver:${input.run.id}:${body.idempotencyKey}`,
          requestHash: sha256Canonical({ previewId: token.previewId, requestHash: token.requestHash, idempotencyKey: body.idempotencyKey }),
          visibility: action.visibility.scope,
          leverageKey: action.attachedAssetKeys[0] || null,
          sealedAt: new Date(),
          immediateJson: { title: record.title, narrative: record.narrative } as unknown as Prisma.InputJsonValue,
          resolvedJson: { status: record.status, turnNumber: record.turnNumber } as unknown as Prisma.InputJsonValue,
          resolvedAt: record.status === "RESOLVED" ? new Date() : null,
        },
      });
      const stateRoot = recordObject(fresh.stateJson);
      const updated = await tx.storyRun.updateMany({
        where: { id: input.run.id, version: expectedRunVersion },
        data: {
          stateJson: { ...stateRoot, [STATE_KEY]: nextState } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: "ACTION_PREVIEW_STALE", message: "局势已经被另一项行动更新，请重新预演。" });
      }
      await tx.narrativeEntry.create({
        data: {
          runId: input.run.id,
          nodeId,
          roleId: context.role.id,
          entryType: "OPENOVEL_MANEUVER_V1",
          visibility: "private",
          content: record.resultNarrative || record.narrative,
          factKeysJson: [],
          threadKeysJson: [],
          sourceEventIdsJson: [actionId],
          worldSequence: input.runtimeRun.turnNumber,
          dedupeKey: `OPENOVEL_MANEUVER:${actionId}`,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });

    return this.commitResponse(input, record, nextState, false);
  }

  /**
   * BEFORE_MAIN_LOCK investigations are settled before the main decision is
   * accepted. Returning true tells the adapter to refresh the player context
   * instead of silently submitting against information that just changed.
   */
  async settleBeforeMainDecision(input: {
    user: AuthenticatedUser;
    run: OpenNovelManeuverRunV1;
    runtimeRun: OpenNovelPublicRun;
    game: GameDefinition;
  }): Promise<boolean> {
    return this.settleDue(input, "BEFORE_MAIN_LOCK");
  }

  /** NEXT_ACTOR_TURN routes become visible when a later OpenNovel turn opens. */
  async settleOnProjection(input: {
    user: AuthenticatedUser;
    run: OpenNovelManeuverRunV1;
    runtimeRun: OpenNovelPublicRun;
    game: GameDefinition;
  }): Promise<OpenNovelManeuverRunV1> {
    const changed = await this.settleDue(input, "NEXT_ACTOR_TURN");
    if (!changed) return input.run;
    const fresh = await this.prisma.storyRun.findUnique({
      where: { id: input.run.id },
      include: { players: { where: { userId: input.user.id }, include: { role: true } } },
    });
    return (fresh || input.run) as OpenNovelManeuverRunV1;
  }

  /**
   * Produces a bounded, server-authored context block for the OpenNovel main
   * runtime. It contains only already committed side actions and never claims
   * that contested outcomes succeeded.
   */
  mainDecisionContext(input: {
    user: AuthenticatedUser;
    run: OpenNovelManeuverRunV1;
    runtimeRun: OpenNovelPublicRun;
    game: GameDefinition;
  }) {
    if (!this.enabledForRun(input.run.templateKey)) return "";
    const context = this.context(input);
    const actions = activeTurnActions(context.state, input.runtimeRun.turnNumber);
    if (!actions.length) return "";
    const lines = actions.map((action) => {
      const starts = action.compiledAction.guaranteedStart.map((item) => item.statement).join("；");
      const limits = action.compiledAction.notGuaranteed.map((item) => item.statement).join("；");
      return `- ${action.title}：已确认开始——${starts || action.narrative}；仍不得视为已发生——${limits || "争议结果尚未结算"}`;
    });
    return [
      "【本场景已确认的有限谋划】",
      ...lines,
      "以上内容只说明玩家已经采取的手段；不得把尚未结算的结果写成既成事实。",
    ].join("\n");
  }

  private async settleDue(input: {
    user: AuthenticatedUser;
    run: OpenNovelManeuverRunV1;
    runtimeRun: OpenNovelPublicRun;
    game: GameDefinition;
  }, moment: "BEFORE_MAIN_LOCK" | "NEXT_ACTOR_TURN") {
    if (!this.enabledForRun(input.run.templateKey)) return false;
    const context = this.context(input);
    const due = context.state.actions.filter((action) => {
      if (action.kind !== "INVESTIGATION" || action.status !== "PENDING") return false;
      const route = context.compileContext.investigationRoutes.find((item) => item.routeId === action.routeId && item.traceId === action.traceId);
      if (!route) return false;
      if (moment === "BEFORE_MAIN_LOCK") return action.turnNumber === input.runtimeRun.turnNumber && route.settlementMoment.kind === "BEFORE_MAIN_LOCK";
      return action.turnNumber < input.runtimeRun.turnNumber && route.settlementMoment.kind === "NEXT_ACTOR_TURN";
    });
    if (!due.length) return false;

    const nextState = structuredClone(context.state);
    for (const action of due) {
      const target = nextState.actions.find((item) => item.actionId === action.actionId)!;
      const trace = nextState.traces.find((item) => item.traceId === target.traceId);
      const route = context.compileContext.investigationRoutes.find((item) => item.routeId === target.routeId && item.traceId === target.traceId);
      if (!trace || !route) {
        target.status = "EXPIRED";
        target.resultNarrative = "调查返回时，原痕迹已经无法继续核验。";
        target.resolvedAt = new Date().toISOString();
        continue;
      }
      resolveInvestigationRecord(nextState, target, route, trace, context.role.id, input.run.version + 1);
    }
    nextState.windowVersion += 1;
    return this.prisma.$transaction(async (tx: Tx) => {
      const fresh = await tx.storyRun.findUnique({
        where: { id: input.run.id },
        select: { version: true, stateJson: true },
      });
      if (!fresh || fresh.version !== input.run.version) return false;
      const root = recordObject(fresh.stateJson);
      const updated = await tx.storyRun.updateMany({
        where: { id: input.run.id, version: input.run.version },
        data: {
          stateJson: { ...root, [STATE_KEY]: nextState } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return false;
      for (const action of due) {
        const resolved = nextState.actions.find((item) => item.actionId === action.actionId);
        if (!resolved) continue;
        await tx.playerAction.updateMany({
          where: { id: resolved.actionId, status: "PENDING" },
          data: {
            status: resolved.status,
            resolvedJson: {
              status: resolved.status,
              evidenceId: resolved.evidenceId,
              resultNarrative: resolved.resultNarrative,
            } as unknown as Prisma.InputJsonValue,
            resolvedAt: resolved.resolvedAt ? new Date(resolved.resolvedAt) : new Date(),
          },
        });
        await tx.narrativeEntry.create({
          data: {
            runId: input.run.id,
            nodeId: maneuverNodeId(input.run.id, resolved.turnNumber),
            roleId: context.role.id,
            entryType: "OPENOVEL_MANEUVER_RESULT_V1",
            visibility: "private",
            content: resolved.resultNarrative || resolved.narrative,
            factKeysJson: [],
            threadKeysJson: [],
            sourceEventIdsJson: [resolved.actionId],
            worldSequence: input.runtimeRun.turnNumber,
            dedupeKey: `OPENOVEL_MANEUVER_RESULT:${resolved.actionId}`,
          },
        });
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
  }

  private context(input: {
    user: AuthenticatedUser;
    run: OpenNovelManeuverRunV1;
    runtimeRun: OpenNovelPublicRun;
    game: GameDefinition;
  }): Context {
    const membership = input.run.players.find((player) => player.userId === input.user.id);
    const role = membership?.role;
    if (!role || role.roleKey !== input.runtimeRun.roleId) {
      throw new ForbiddenException({ code: "OPENOVEL_ROLE_REQUIRED", message: "当前用户没有控制这条故事线的角色。" });
    }
    const state = normalizeState(input.run, input.runtimeRun);
    const packageData = packageForOpenNovel(input.run.id, role, input.game, input.runtimeRun, state);
    const actions = activeTurnActions(state, input.runtimeRun.turnNumber);
    const compileContext: ManeuverCompileContextV1 = {
      runId: input.run.id,
      actorTurnId: turnId(input.runtimeRun.turnNumber),
      actorRoleId: role.id,
      actorRoleKey: role.roleKey,
      actorId: `actor.${role.roleKey}`,
      actorLabel: role.roleName,
      slot: actions.length === 0 ? "MANEUVER_1" : "MANEUVER_2",
      turnRevision: input.runtimeRun.turnNumber,
      stateRevision: input.runtimeRun.turnNumber,
      maneuverWindowVersion: state.windowVersion,
      controlEpoch: 1,
      contextHash: contextHash(input.run, input.runtimeRun, state),
      contacts: packageData.contacts,
      traces: packageData.traces,
      investigationRoutes: packageData.routes,
      ruleCards: packageData.ruleCards,
      ruleCardHoldings: state.ruleCardHoldings,
      actionBindings: packageData.actionBindings,
      targets: packageData.targets,
      evidence: state.evidenceCards,
      capabilityIds: packageData.capabilityIds,
      resourceAmounts: packageData.resourceAmounts,
      currentStage: Math.min(7, Math.floor(input.runtimeRun.turnNumber / 3) + 1),
      nowIso: new Date().toISOString(),
      previewTtlSeconds: PREVIEW_TTL_SECONDS,
    };
    return { run: input.run, runtimeRun: input.runtimeRun, game: input.game, role, state, compileContext };
  }

  private assertTurn(context: Context, requestedTurnId: string) {
    if (context.runtimeRun.status === "COMPLETED" || requestedTurnId !== context.compileContext.actorTurnId) {
      throw new ConflictException({ code: "TURN_MOVED", message: "故事已经进入新的场景。" });
    }
  }

  private assertDraftAvailable(state: OpenNovelManeuverStateV1, draft: ManeuverDraftV1) {
    const actions = activeTurnActions(state, state.turnNumber);
    if (draft.kind !== "REACTION" && actions.length >= MAX_MANEUVERS_PER_TURN) {
      throw new ConflictException({ code: "MANEUVER_OPPORTUNITY_EXHAUSTED", message: "本场景的谋划机会已经用尽。" });
    }
    if (draft.kind === "CONVERSATION" && state.conversationUsed >= 1) {
      throw new ConflictException({ code: "MANEUVER_FORM_LIMIT_REACHED", message: "本场景已经主动发起过一次人物交谈。" });
    }
    if (draft.kind === "INVESTIGATION" && state.investigationUsed >= 1) {
      throw new ConflictException({ code: "MANEUVER_FORM_LIMIT_REACHED", message: "本场景已经派遣过一次调查。" });
    }
  }

  private commitResponse(
    input: { user: AuthenticatedUser; run: OpenNovelManeuverRunV1; runtimeRun: OpenNovelPublicRun; game: GameDefinition },
    action: OpenNovelManeuverActionV1,
    state: OpenNovelManeuverStateV1,
    idempotentReplay: boolean,
  ) {
    const run = { ...input.run, version: input.run.version + (idempotentReplay ? 0 : 1), stateJson: { ...recordObject(input.run.stateJson), [STATE_KEY]: state } };
    return {
      accepted: true as const,
      idempotentReplay,
      action: { actionId: action.actionId, kind: action.kind, slot: action.slot, status: action.status },
      immediateReceipt: {
        title: action.title,
        narrative: action.resultNarrative || action.narrative,
        visibility: action.compiledAction.visibility.scope,
      },
      maneuverRulesV1: this.projection({ ...input, run }),
    };
  }
}

function packageForOpenNovel(
  runId: string,
  role: NonNullable<OpenNovelManeuverRunV1["players"][number]["role"]>,
  game: GameDefinition,
  runtimeRun: OpenNovelPublicRun,
  state: OpenNovelManeuverStateV1,
) {
  const contacts: ContactDefinitionV1[] = SANGTIAN_MVP_CONTACTS
    .filter((contact) => contact.actorId !== `actor.${role.roleKey}`)
    .map((contact) => {
      const roleKey = contact.actorId.replace(/^actor\./u, "");
      const definition = game.roles.find((item) => item.roleKey === roleKey);
      return {
        ...contact,
        roleId: definition?.roleKey || contact.roleId,
        displayName: definition?.roleName || contact.displayName,
        accessibleByRoleIds: [role.id],
      };
    });
  const targets: ActionTargetV1[] = [
    ...SANGTIAN_MVP_TARGETS,
    ...game.roles
      .filter((item) => item.roleKey !== role.roleKey)
      .map((item) => ({ type: "ACTOR" as const, id: `actor.${item.roleKey}`, label: item.roleName })),
  ];
  const traces = state.traces.map((trace) => ({
    ...trace,
    runId,
    accessRoleIds: [role.id],
    visibility: trace.visibility.scope === "PUBLIC" ? trace.visibility : { ...trace.visibility, roleIds: [role.id] },
  }));
  return {
    contacts,
    targets,
    traces,
    routes: SANGTIAN_MVP_INVESTIGATION_ROUTES,
    ruleCards: SANGTIAN_MVP_RULE_CARDS,
    actionBindings: SANGTIAN_MVP_ACTION_BINDINGS,
    capabilityIds: [
      "capability.governor.inspect_records",
      "capability.governor.dispatch_agent",
      "capability.governor.seal_archive",
      "capability.governor.use_county_letter",
      "capability.governor.secret_memorial",
      "capability.governor.move_document",
      "capability.governor.protect_person",
      "capability.governor.submit_memorial",
    ],
    resourceAmounts: resourcesForRole(game, role.roleKey),
    runtimeRun,
  };
}

function projectState(context: Context): ManeuverRulesProjectionV1 {
  const state = context.state;
  const actions = activeTurnActions(state, context.runtimeRun.turnNumber);
  const cards = projectRuleCardsV1({ cards: context.compileContext.ruleCards, holdings: state.ruleCardHoldings, roleId: context.role.id })
    .map((card) => {
      const definition = context.compileContext.ruleCards.find((item) => item.cardKey === card.cardKey)!;
      return {
        ...card,
        legalTargets: context.compileContext.targets
          .filter((target) => definition.legalTargetTypes.includes(target.type))
          .map((target) => ({ id: target.id, label: target.label, type: target.type })),
        triggerOptions: definition.triggerPatternIds.map((triggerPatternId) => ({
          triggerPatternId,
          label: triggerPatternId === "document_transfer_attempt" ? "有人试图转移相关文件" : triggerPatternId,
        })),
      };
    });
  return {
    schemaVersion: "maneuver_rules_projection_v1",
    enabled: true,
    window: {
      windowId: `${context.run.id}:${context.compileContext.actorTurnId}`,
      status: context.runtimeRun.status === "COMPLETED" ? "CLOSED" : "OPEN",
      totalOpportunities: MAX_MANEUVERS_PER_TURN,
      remainingOpportunities: Math.max(0, MAX_MANEUVERS_PER_TURN - actions.length),
      usedSlots: actions.map((action) => ({ slot: action.slot === "MANEUVER_1" ? "MANEUVER_1" as const : "MANEUVER_2" as const, actionId: action.actionId, kind: action.kind, status: action.status })),
      formLimits: {
        conversationRemaining: Math.max(0, 1 - state.conversationUsed),
        investigationRemaining: Math.max(0, 1 - state.investigationUsed),
      },
      version: state.windowVersion,
      closesWhen: "MAIN_DECISION_COMMITS",
    },
    contacts: projectContactsV1(context.compileContext.contacts, context.role.id),
    investigationLeads: projectInvestigationLeadsV1({
      traces: context.compileContext.traces,
      routes: context.compileContext.investigationRoutes,
      roleId: context.role.id,
      currentStage: context.compileContext.currentStage,
    }),
    ruleCards: cards,
    evidenceCards: projectEvidenceHandV1(state.evidenceCards, context.role.id),
    pendingActions: state.actions.slice(-12).map((action) => ({
      actionId: action.actionId,
      kind: action.kind,
      slot: action.slot,
      title: action.title,
      status: action.status,
      revealAtLabel: action.status === "PENDING" ? action.compiledAction.timing.playerLabel : null,
      evidenceId: action.evidenceId,
      evidenceTitle: state.evidenceCards.find((item) => item.evidenceId === action.evidenceId)?.title,
      resultNarrative: action.resultNarrative,
    })),
    reactions: [],
  };
}

function applyCommittedAction(state: OpenNovelManeuverStateV1, record: OpenNovelManeuverActionV1, context: Context) {
  const effect = record.compiledAction.primaryEffect;
  if (effect.kind === "OPEN_INTERACTION") {
    record.status = "PENDING";
    record.resultNarrative = `${record.narrative}\n\n对方已经收到这段话；他的回答、沉默或反条件将在后续剧情中出现。`;
    return;
  }
  if (effect.kind === "START_INVESTIGATION") {
    record.traceId = effect.traceId;
    record.routeId = effect.routeId;
    const trace = state.traces.find((item) => item.traceId === effect.traceId);
    const route = context.compileContext.investigationRoutes.find((item) => item.routeId === effect.routeId && item.traceId === effect.traceId);
    if (!trace || !route) throw new ConflictException({ code: "TRACE_NOT_FOUND", message: "这条调查路线已经不可用。" });
    if (route.settlementMoment.kind === "IMMEDIATE_AFTER_COMMIT") {
      resolveInvestigationRecord(state, record, route, trace, context.role.id, context.run.version + 1);
    } else {
      record.status = "PENDING";
      record.resultNarrative = `调查已经开始，将在“${record.compiledAction.timing.playerLabel}”返回。`;
    }
    return;
  }
  if (effect.kind === "PLAY_RULE_CARD") {
    const holding = state.ruleCardHoldings.find((item) => item.cardAssetKey === effect.cardAssetKey);
    const card = holding && context.compileContext.ruleCards.find((item) => item.cardKey === holding.cardKey);
    if (!holding || !card || holding.status !== "AVAILABLE") {
      throw new ConflictException({ code: "CARD_NOT_OWNED", message: "这张规则筹码当前不可用。" });
    }
    if (effect.playMode === "SET") {
      holding.status = "LOCKED";
      state.armedCards.push({
        actionId: record.actionId,
        turnNumber: record.turnNumber,
        cardAssetKey: holding.cardAssetKey,
        targetId: record.compiledAction.target.id,
        triggerPatternId: effect.triggerPatternId || "",
        status: "ARMED",
        createdAt: record.createdAt,
      });
      record.status = "ARMED";
      record.resultNarrative = `“${card.label}”已经伏置，触发前不会被当作公开事实。`;
    } else {
      consumeCard(holding, card, record.turnNumber);
      record.status = "RESOLVED";
      record.resolvedAt = record.createdAt;
      record.resultNarrative = `“${card.label}”已经按牌面落子：${card.guaranteedEffects.join("；")} 牌面之外的结果仍需后续剧情结算。`;
    }
    return;
  }
  if (effect.kind === "DISCLOSE_EVIDENCE") {
    for (const evidenceId of effect.evidenceAssetIds) {
      const evidence = state.evidenceCards.find((item) => item.evidenceId === evidenceId && item.ownerRoleId === context.role.id);
      if (!evidence) throw new ForbiddenException({ code: "EVIDENCE_NOT_OWNED", message: "当前角色没有这份证据。" });
      evidence.visibility = effect.audience === "PUBLIC" ? "PUBLIC" : "SHARED";
    }
    record.status = "RESOLVED";
    record.resolvedAt = record.createdAt;
    record.resultNarrative = "你已经按预演范围出示证据；公开的是牌面写明的有限命题，而不是整件事情的全部真相。";
    return;
  }
  record.status = "PENDING";
  record.resultNarrative = `${record.narrative}\n\n这项行动已经开始，但争议结果要与主线决定一同进入 OpenNovel 结算。`;
}

function resolveInvestigationRecord(
  state: OpenNovelManeuverStateV1,
  action: OpenNovelManeuverActionV1,
  route: InvestigationRouteV1,
  trace: WorldTraceV1,
  roleId: string,
  revision: number,
) {
  const evidenceId = `evidence_${createHash("sha256").update(action.actionId).digest("hex").slice(0, 24)}`;
  const outcome = resolveInvestigationV1({
    trace,
    route,
    actorRoleId: roleId,
    actorCapabilityIds: [
      "capability.governor.inspect_records",
      "capability.governor.dispatch_agent",
    ],
    availableResources: { staff: 4, guards: 4 },
    evidenceId,
    evidenceTitle: `${trace.title} · ${route.label}`,
    acquiredAtRevision: revision,
  });
  action.status = "RESOLVED";
  action.resolvedAt = new Date().toISOString();
  action.resultNarrative = outcome.processNarrative;
  if (outcome.evidence) {
    action.evidenceId = outcome.evidence.evidenceId;
    if (!state.evidenceCards.some((item) => item.evidenceId === outcome.evidence!.evidenceId)) {
      state.evidenceCards.push(outcome.evidence);
    }
  }
}

function normalizeState(run: OpenNovelManeuverRunV1, runtimeRun: OpenNovelPublicRun): OpenNovelManeuverStateV1 {
  const root = recordObject(run.stateJson);
  const raw = recordObject(root[STATE_KEY]);
  const role = run.players.find((player) => player.userId !== null)?.role;
  const roleId = role?.id || "role.zhejiang_governor";
  const initialHoldings = initialSangtianMvpRuleCardHoldings().map((holding) => ({ ...holding, ownerRoleId: roleId }));
  const initialTraces = initialSangtianMvpTraces(run.id).map((trace) => ({
    ...trace,
    accessRoleIds: [roleId],
    visibility: trace.visibility.scope === "PUBLIC" ? trace.visibility : { ...trace.visibility, roleIds: [roleId] },
  }));
  const previousActions = Array.isArray(raw.actions) ? raw.actions as unknown as OpenNovelManeuverActionV1[] : [];
  const previousTurn = Number(raw.turnNumber ?? runtimeRun.turnNumber);
  const turnChanged = previousTurn !== runtimeRun.turnNumber;
  const actions = previousActions.map((action) => {
    if (!turnChanged || action.turnNumber >= runtimeRun.turnNumber || action.status !== "PENDING") return action;
    if (action.kind === "INVESTIGATION") {
      const route = SANGTIAN_MVP_INVESTIGATION_ROUTES.find((item) => (
        item.routeId === action.routeId && item.traceId === action.traceId
      ));
      // NEXT_ACTOR_TURN investigations must remain pending until settleDue() has
      // atomically created their evidence result. Marking them resolved here
      // would silently erase the player's delayed reward.
      if (route?.settlementMoment.kind === "NEXT_ACTOR_TURN") return action;
      return {
        ...action,
        status: "EXPIRED" as const,
        resultNarrative: action.resultNarrative || "这条调查路线错过了约定的揭晓时机，未能形成可用证据。",
        resolvedAt: action.resolvedAt || runtimeRun.updatedAt,
      };
    }
    return {
      ...action,
      status: "RESOLVED" as const,
      resultNarrative: action.resultNarrative || "这项谋划已经随上一场景进入叙事结算；其可确认后果以当前剧情为准。",
      resolvedAt: action.resolvedAt || runtimeRun.updatedAt,
    };
  });
  const holdings = Array.isArray(raw.ruleCardHoldings)
    ? raw.ruleCardHoldings as unknown as RuleCardHoldingV1[]
    : initialHoldings;
  for (const holding of holdings) {
    if (holding.status === "COOLDOWN" && Number(holding.cooldownUntilStage || Infinity) <= runtimeRun.turnNumber) {
      holding.status = "AVAILABLE";
      delete holding.cooldownUntilStage;
    }
  }
  return {
    schemaVersion: "openovel_maneuver_rules_state_v1",
    enabled: true,
    turnNumber: runtimeRun.turnNumber,
    windowVersion: Math.max(1, Number(raw.windowVersion || 1) + (turnChanged ? 1 : 0)),
    conversationUsed: turnChanged ? 0 : Math.max(0, Number(raw.conversationUsed || 0)),
    investigationUsed: turnChanged ? 0 : Math.max(0, Number(raw.investigationUsed || 0)),
    traces: Array.isArray(raw.traces) ? raw.traces as unknown as WorldTraceV1[] : initialTraces,
    evidenceCards: Array.isArray(raw.evidenceCards) ? raw.evidenceCards as unknown as EvidenceCardStateV1[] : [],
    ruleCardHoldings: holdings,
    actions,
    armedCards: Array.isArray(raw.armedCards) ? raw.armedCards as unknown as OpenNovelArmedCardV1[] : [],
  };
}

function assertTokenFresh(token: ManeuverPreviewTokenPayloadV1, context: Context, body: ReturnType<typeof commitCommand>) {
  const current = context.compileContext;
  const expectedHash = stablePreviewRequestHashV1({
    idempotencyKey: token.previewIdempotencyKey,
    turnRevision: token.turnVersion,
    expectedStateRevision: token.stateRevision,
    expectedManeuverWindowVersion: token.maneuverWindowVersion,
    controlEpoch: token.controlEpoch,
    draft: token.draft,
  });
  const stale = token.actorTurnId !== current.actorTurnId
    || token.turnVersion !== current.turnRevision
    || token.stateRevision !== current.stateRevision
    || token.maneuverWindowVersion !== current.maneuverWindowVersion
    || token.controlEpoch !== current.controlEpoch
    || token.contextHash !== current.contextHash
    || token.compiledAction.contextHash !== current.contextHash
    || token.requestHash !== expectedHash
    || body.expectedTurnRevision !== current.turnRevision
    || body.expectedStateRevision !== current.stateRevision
    || body.expectedManeuverWindowVersion !== current.maneuverWindowVersion
    || body.controlEpoch !== current.controlEpoch;
  if (stale) {
    throw new ConflictException({
      code: "ACTION_PREVIEW_STALE",
      message: "局势已经发生变化。这项谋划没有执行，请根据最新剧情重新预演。",
      latest: {
        turnRevision: current.turnRevision,
        stateRevision: current.stateRevision,
        maneuverWindowVersion: current.maneuverWindowVersion,
        controlEpoch: current.controlEpoch,
      },
    });
  }
}

function activeTurnActions(state: OpenNovelManeuverStateV1, turnNumber: number) {
  return state.actions.filter((action) => action.turnNumber === turnNumber && action.slot !== "REACTION");
}

function resourcesForRole(game: GameDefinition, roleKey: string) {
  const profile = game.roles.find((role) => role.roleKey === roleKey)?.gameplayProfile;
  const values: Record<string, number> = { staff: 4, guards: 4 };
  for (const item of profile?.resources || []) {
    const numeric = Number(String(item.value || "").match(/\d+/u)?.[0] || 0);
    if (/幕僚/u.test(item.label)) values.staff = numeric;
    if (/兵丁/u.test(item.label)) values.guards = numeric;
  }
  return values;
}

function consumeCard(holding: RuleCardHoldingV1, card: RuleCardDefinitionV1, turnNumber: number) {
  if (card.consumption === "CONSUME") holding.status = "CONSUMED";
  else if (card.consumption === "COOLDOWN") {
    holding.status = "COOLDOWN";
    holding.cooldownUntilStage = turnNumber + Math.max(1, card.cooldownStages || 1);
  } else if (card.consumption === "LOCK") holding.status = "LOCKED";
  else holding.status = "AVAILABLE";
}

function contextHash(run: OpenNovelManeuverRunV1, runtimeRun: OpenNovelPublicRun, state: OpenNovelManeuverStateV1) {
  return sha256Canonical({
    runId: run.id,
    runVersion: run.version,
    runtimeTurn: runtimeRun.turnNumber,
    runtimeUpdatedAt: runtimeRun.updatedAt,
    windowVersion: state.windowVersion,
    conversationUsed: state.conversationUsed,
    investigationUsed: state.investigationUsed,
    actions: activeTurnActions(state, runtimeRun.turnNumber).map((action) => [action.actionId, action.status, action.kind]),
    evidence: state.evidenceCards.map((evidence) => [evidence.evidenceId, evidence.visibility, evidence.authenticity]),
    cards: state.ruleCardHoldings.map((card) => [card.cardAssetKey, card.status, card.cooldownUntilStage]),
  });
}

function commitCommand(raw: unknown) {
  const value = recordObject(raw);
  const idempotencyKey = String(value.idempotencyKey || "").trim();
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new BadRequestException({ code: "INVALID_IDEMPOTENCY_KEY", message: "确认行动需要 8—200 个字符的稳定 idempotencyKey。" });
  }
  const previewToken = String(value.previewToken || "").trim();
  if (!previewToken) throw new BadRequestException({ code: "ACTION_PREVIEW_TOKEN_REQUIRED", message: "确认行动需要预演凭证。" });
  return {
    idempotencyKey,
    previewToken,
    expectedTurnRevision: integer(value.expectedTurnRevision, "expectedTurnRevision"),
    expectedStateRevision: integer(value.expectedStateRevision, "expectedStateRevision"),
    expectedManeuverWindowVersion: integer(value.expectedManeuverWindowVersion, "expectedManeuverWindowVersion"),
    controlEpoch: integer(value.controlEpoch, "controlEpoch"),
  };
}

function integer(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new BadRequestException({ code: "MANEUVER_DRAFT_INVALID", message: `${field} 必须是非负整数。` });
  return number;
}

function recordObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function objectCode(value: unknown) {
  return value && typeof value === "object" && "code" in value ? String((value as { code?: unknown }).code || "") : "";
}

function maneuverNodeId(runId: string, turnNumber: number) {
  return `ovl_mnv_node_${createHash("sha256").update(`${runId}\0${turnNumber}`).digest("hex").slice(0, 24)}`;
}

function turnId(turnNumber: number) {
  return `T${String(turnNumber + 1).padStart(2, "0")}`;
}

function decisionForm(kind: CompiledManeuverActionV1["actionKind"]): "CONVERSATION" | "INVESTIGATION" | "LEVERAGE" | "CUSTOM_PLAN" {
  if (kind === "CONVERSATION") return "CONVERSATION";
  if (kind === "INVESTIGATION") return "INVESTIGATION";
  if (kind === "CARD_LAYOUT") return "LEVERAGE";
  return "CUSTOM_PLAN";
}
