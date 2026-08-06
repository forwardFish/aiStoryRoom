import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type ActorTurn, type CanonFact, type NarrativeEntry, type PlayerAction, type RoleAsset, type RoleControl, type StoryPlayer, type StoryRole, type StoryRun } from "@prisma/client";
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
  type ActionPreviewResponseV1,
  type ActionTargetV1,
  type CompiledManeuverActionV1,
  type CreateActionPreviewCommandV1,
  type EvidenceCardStateV1,
  type InvestigationRouteV1,
  type ManeuverCompileContextV1,
  type ManeuverDraftV1,
  type ManeuverKindV1,
  type RuleCardDefinitionV1,
  type RuleCardHoldingV1,
  type WorldTraceV1,
} from "@ai-story/templates";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { sha256Canonical } from "../continuous-strategy/canonical";
import { ContinuousEventDeliveryService } from "../continuous-strategy/event-delivery.service";
import { assetDisplayName } from "../continuous-story-v2/asset-language";
import { PrismaService } from "../prisma.service";
import { signManeuverPreviewTokenV1, verifyManeuverPreviewTokenV1, type ManeuverPreviewTokenPayloadV1 } from "./preview-token";
import { buildContinuousStoryV2ManeuverPackageV1 } from "./continuous-story-v2-package";

const PREVIEW_TTL_SECONDS = 5 * 60;
const MAX_MANEUVERS_PER_TURN = 2;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;

type Tx = Prisma.TransactionClient;

type ActivePlayerRef = Pick<StoryPlayer, "userId" | "roleId">;
type ReactionSourceAction = PlayerAction & { role?: StoryRole | null };
type ManeuverReactionProjection = {
  reactionId: string;
  storyNotice: { title: string; narrative: string };
  options: Array<{ optionId: string; label: string; description: string }>;
  eligibleCardAssetKeys: string[];
  customAllowed: boolean;
  holdAllowed: boolean;
  expiresAt: string | null;
  turnId: string;
};

type ProjectionInput = {
  run: Pick<StoryRun, "id" | "templateKey" | "worldSequence" | "currentNodeId">;
  role: StoryRole;
  roles: StoryRole[];
  control: RoleControl;
  turn: ActorTurn | null;
  visibleFacts: Array<Pick<CanonFact, "factKey" | "content">>;
  entries: NarrativeEntry[];
  assets: RoleAsset[];
  availableTargets: ActionTargetV1[];
};

const NOOP_EVENT_DELIVERIES = {
  publish: async () => ({ event: null, deliveries: [] }),
} as unknown as ContinuousEventDeliveryService;

@Injectable()
export class ContinuousStoryV2ManeuverService {
  private readonly deliveries: ContinuousEventDeliveryService;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContinuousEventDeliveryService) deliveries?: ContinuousEventDeliveryService,
  ) {
    this.deliveries = deliveries ?? NOOP_EVENT_DELIVERIES;
  }

  /**
   * MANEUVER_RULES_V1 is intentionally capability-gated instead of being
   * inferred from a world id in the browser. Local and test runs default to the
   * Sangtian allow-list; production must opt in explicitly and can narrow the
   * allow-list without changing code.
   */
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
    return allowlist.includes("*") || allowlist.includes(templateKey);
  }

  /**
   * Builds the role-scoped maneuver capability for the real V2 /game page.
   * The method deliberately starts from the authenticated membership and only
   * loads facts, entries and assets already visible to that role.
   */
  async projection(user: AuthenticatedUser, roomId: string) {
    const membership = await this.prisma.storyPlayer.findFirst({
      where: { runId: roomId, userId: user.id, status: "active", roleId: { not: null } },
      include: { role: true },
    });
    if (!membership?.roleId || !membership.role) return undefined;
    const turn = await this.prisma.actorTurn.findFirst({
      where: { runId: roomId, roleId: membership.roleId, status: "OPEN" },
      orderBy: { turnIndex: "desc" },
      select: { id: true },
    });
    if (!turn) return undefined;

    // NEXT_ACTOR_TURN investigations are resolved before the new projection is
    // returned. The operation is idempotent and never discloses another role's
    // evidence.
    await this.resolveDueInvestigations(user, roomId, turn.id, "NEXT_ACTOR_TURN");
    const context = await this.loadContext(user, roomId, turn.id);
    return this.buildProjectionAsync({
      run: context.run,
      role: context.role,
      roles: context.roles,
      control: context.control,
      turn: context.turn,
      visibleFacts: context.visibleFacts,
      entries: context.entries,
      assets: context.assets,
      availableTargets: context.availableTargets,
    });
  }

  /**
   * Resolves investigations explicitly promised to return before the player
   * locks the current main decision. Callers use the return value to force a
   * projection refresh instead of silently submitting a decision against an
   * older information state.
   */
  async settleBeforeMainDecision(user: AuthenticatedUser, roomId: string, turnId: string) {
    return this.resolveDueInvestigations(user, roomId, turnId, "BEFORE_MAIN_LOCK");
  }

  async settleOnTurnProjection(user: AuthenticatedUser, roomId: string, turnId: string) {
    return this.resolveDueInvestigations(user, roomId, turnId, "NEXT_ACTOR_TURN");
  }

  async preview(user: AuthenticatedUser, roomId: string, turnId: string, raw: unknown) {
    const command = this.previewCommand(raw);
    const context = await this.loadContext(user, roomId, turnId);
    this.assertNoWorldReservation(context.run);
    if (!this.enabledForRun(context.run.templateKey)) {
      throw new ConflictException({ code: "MANEUVER_PREVIEW_UNAVAILABLE", message: "当前故事局尚未启用有限谋划规则。" });
    }
    this.assertReactionDraft(context, command.draft);
    this.assertWindow(context.actions, command.draft.kind);
    const compileContext = command.draft.kind === "REACTION"
      ? { ...context.compileContext, slot: "REACTION" as const }
      : context.compileContext;
    let result: ActionPreviewResponseV1;
    try {
      result = createActionPreviewV1(command, compileContext);
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
      runId: roomId,
      actorTurnId: context.turn.id,
      turnVersion: context.turn.revision,
      stateRevision: context.run.worldSequence,
      maneuverWindowVersion: context.windowVersion,
      controlEpoch: context.control.epoch,
      contextHash: context.compileContext.contextHash,
      requestHash: stablePreviewRequestHashV1(command),
      previewIdempotencyKey: command.idempotencyKey,
      expiresAt: result.expiresAt,
      draft: command.draft,
      compiledAction: result.compiledAction,
      presentation: result.presentation,
    });
    const { compiledAction: _serverOwnedAction, ...playerSafe } = result;
    return { ...playerSafe, previewToken };
  }

  async commit(user: AuthenticatedUser, roomId: string, previewId: string, raw: unknown) {
    const input = this.commitCommand(raw);
    let token: ManeuverPreviewTokenPayloadV1;
    try {
      token = verifyManeuverPreviewTokenV1(input.previewToken);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
      const message = error instanceof Error ? error.message : "行动预演凭证无效，请重新预演。";
      if (code === "ACTION_PREVIEW_EXPIRED") {
        throw new ConflictException({ code, message });
      }
      throw new BadRequestException({ code: code || "ACTION_PREVIEW_TOKEN_INVALID", message });
    }
    if (token.previewId !== previewId || token.runId !== roomId) {
      throw new BadRequestException({ code: "ACTION_PREVIEW_TOKEN_INVALID", message: "行动预演不属于当前故事局，请重新预演。" });
    }
    const result = await this.serializable(async (tx) => {
      const replay = await tx.playerAction.findUnique({ where: { idempotencyKey: `v2-maneuver:${input.idempotencyKey}` } });
      if (replay) {
        const normalized = record(replay.normalizedJson);
        if (normalized.sourcePreviewId !== previewId) {
          throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED", message: "同一个幂等键不能确认不同的行动预演。" });
        }
        return this.replayResult(replay);
      }

      const action = token.compiledAction;
      if (isReactionHold(action)) {
        const replayedHold = await this.replayReactionHold(tx, user, roomId, previewId, input.idempotencyKey, action);
        if (replayedHold) return replayedHold;
      }

      const context = await this.loadContextTx(tx, user, roomId, token.actorTurnId);
      this.assertNoWorldReservation(context.run);
      if (!this.enabledForRun(context.run.templateKey)) {
        throw new ConflictException({ code: "MANEUVER_PREVIEW_UNAVAILABLE", message: "当前故事局尚未启用有限谋划规则。" });
      }
      this.assertReactionDraft(context, token.draft);
      const actions = context.actions;
      this.assertWindow(actions, token.draft.kind);
      const windowVersion = actions.length + 1;
      if (context.turn.id !== token.actorTurnId
        || context.turn.revision !== token.turnVersion
        || context.turn.revision !== action.turnRevision
        || context.run.worldSequence !== token.stateRevision
        || context.run.worldSequence !== action.stateRevision
        || windowVersion !== token.maneuverWindowVersion
        || windowVersion !== action.maneuverWindowVersion
        || context.control.epoch !== token.controlEpoch
        || context.control.epoch !== action.controlEpoch
        || context.compileContext.contextHash !== token.contextHash
        || context.compileContext.contextHash !== action.contextHash
        || token.requestHash !== stablePreviewRequestHashV1({
          idempotencyKey: token.previewIdempotencyKey,
          turnRevision: token.turnVersion,
          expectedStateRevision: token.stateRevision,
          expectedManeuverWindowVersion: token.maneuverWindowVersion,
          controlEpoch: token.controlEpoch,
          draft: token.draft,
        })
        || context.role.id !== action.actorRoleId) {
        throw new ConflictException({
          code: "ACTION_PREVIEW_STALE",
          message: "局势已经发生变化。这项谋划没有执行，请根据最新剧情重新预演。",
          latest: {
            turnRevision: context.turn.revision,
            stateRevision: context.run.worldSequence,
            maneuverWindowVersion: windowVersion,
            controlEpoch: context.control.epoch,
          },
        });
      }

      if (isReactionHold(action)) {
        if (action.primaryEffect.kind !== "REACTION_RESPONSE") {
          throw new BadRequestException({ code: "REACTION_DRAFT_INVALID", message: "应变保留请求无效。" });
        }
        const source = await tx.playerAction.findUnique({ where: { id: action.primaryEffect.reactionId } });
        if (!source || source.runId !== roomId || source.targetRoleId !== context.role.id || source.status !== "OPEN") {
          throw new ConflictException({ code: "REACTION_WINDOW_CLOSED", message: "这项回应窗口已经关闭。" });
        }
        const heldAt = new Date();
        await tx.playerAction.update({
          where: { id: source.id },
          data: {
            status: "HELD",
            resolvedAt: heldAt,
            resolvedJson: {
              ...record(source.resolvedJson),
              status: "HELD",
              heldByRoleId: context.role.id,
              heldAt: heldAt.toISOString(),
              maneuverHold: {
                schemaVersion: "reaction_hold_v1",
                previewId,
                idempotencyKey: input.idempotencyKey,
              },
            } as unknown as Prisma.InputJsonValue,
          },
        });
        // Holding closes only this response window. It is deliberately not a
        // PlayerAction, does not consume a maneuver slot, does not advance the
        // world sequence and does not create a narrative/world fact.
        await tx.storyRun.update({ where: { id: roomId }, data: { version: { increment: 1 } } });
        await tx.actorTurn.update({ where: { id: context.turn.id }, data: { revision: { increment: 1 } } });
        return this.reactionHoldResult(source.id, previewId, false);
      }

      const requestHash = sha256Canonical({ previewId, previewRequestHash: token.requestHash, idempotencyKey: input.idempotencyKey });
      const sequence = context.run.worldSequence + 1;
      const slotNumber = actions.length + 1;
      const actionSlot = action.actionKind === "REACTION" ? `REACTION:${action.primaryEffect.kind === "REACTION_RESPONSE" ? action.primaryEffect.reactionId : previewId}` : `MANEUVER:${context.turn.id}:${slotNumber}`;
      const status = "COMMITTED";
      const playerAction = await tx.playerAction.create({
        data: {
          runId: roomId,
          nodeId: context.run.currentNodeId!,
          chapterIndex: context.turn.stageIndex,
          userId: context.membership.userId,
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
            schemaVersion: "maneuver_action_record_v1",
            draft: token.draft,
            compiledAction: action,
            presentation: token.presentation,
            sourcePreviewId: previewId,
          } as unknown as Prisma.InputJsonValue,
          guardStatus: "ok",
          guardReason: "Maneuver preview confirmed",
          auditStatus: "ok",
          status,
          actionSlot,
          actorKind: "HUMAN",
          controlEpoch: context.control.epoch,
          policyVersion: "maneuver_rules_v1",
          provider: "deterministic",
          modelName: "maneuver-rules-v1",
          actionKey: action.settlementBindingId,
          idempotencyKey: `v2-maneuver:${input.idempotencyKey}`,
          requestHash,
          visibility: action.visibility.scope,
          targetRoleId: this.targetRoleId(context.roles, action),
          leverageKey: action.attachedAssetKeys[0] || null,
          sealedAt: new Date(),
          immediateJson: { title: token.presentation.title, narrative: token.presentation.narrative, worldSequence: sequence } as unknown as Prisma.InputJsonValue,
          resolvedJson: { status, worldSequence: sequence } as unknown as Prisma.InputJsonValue,
          resolvedAt: null,
        },
      });

      const outcome = await this.applyAction(tx, context, playerAction.id, action, token.draft, token.presentation, sequence);
      await this.applyAttachedRuleCards(tx, context, playerAction.id, action, outcome.status);
      await this.publishCommittedActionEvent(tx, context, playerAction.id, action, token.presentation, sequence);
      await tx.playerAction.update({
        where: { id: playerAction.id },
        data: {
          status: outcome.status,
          resolvedJson: outcome.resolvedJson as unknown as Prisma.InputJsonValue,
          resolvedAt: outcome.status === "OPEN" || outcome.status === "ARMED" ? null : new Date(),
        },
      });
      const updatedRun = await tx.storyRun.updateMany({
        where: {
          id: roomId,
          worldSequence: context.run.worldSequence,
          reservedWorldSequence: context.run.worldSequence,
        },
        data: {
          worldSequence: sequence,
          reservedWorldSequence: sequence,
          version: { increment: 1 },
        },
      });
      if (updatedRun.count !== 1) {
        throw new ConflictException({ code: "ACTION_PREVIEW_STALE", message: "局势已经被另一项行动更新，请重新预演。" });
      }
      await tx.actorTurn.update({ where: { id: context.turn.id }, data: { revision: { increment: 1 } } });
      const triggeredCardActionIds = await this.triggerArmedCards(tx, context, playerAction.id, action, sequence);
      const finalStatus = triggeredCardActionIds.length > 0 && !["OPEN", "ARMED"].includes(outcome.status)
        ? "CONTESTED_BY_CARD"
        : outcome.status;
      if (triggeredCardActionIds.length > 0) {
        await tx.playerAction.update({
          where: { id: playerAction.id },
          data: {
            status: finalStatus,
            resolvedJson: {
              ...record(outcome.resolvedJson),
              status: finalStatus,
              triggeredCardActionIds,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.narrativeEntry.create({
          data: {
            runId: context.run.id,
            nodeId: context.run.currentNodeId,
            roleId: context.role.id,
            entryType: "V2_MANEUVER_NOTICE",
            visibility: "private",
            content: "你的行动触发了一项预先伏置的规则。它的牌面效果已经进入结算；这不会泄露触发前你本来无权知道的布局。",
            factKeysJson: [],
            threadKeysJson: [],
            sourceEventIdsJson: [playerAction.id, ...triggeredCardActionIds],
            worldSequence: sequence,
            dedupeKey: `V2_CARD_CONTESTED_NOTICE:${playerAction.id}`,
          },
        });
      }
      return {
        accepted: true as const,
        action: {
          actionId: playerAction.id,
          kind: action.actionKind,
          slot: action.actionKind === "REACTION" ? "REACTION" as const : slotNumber === 1 ? "MANEUVER_1" as const : "MANEUVER_2" as const,
          status: finalStatus,
        },
        immediateReceipt: outcome.immediateReceipt,
      };
    });
    return result;
  }

  async buildProjectionAsync(input: ProjectionInput) {
    if (!input.turn || input.turn.status !== "OPEN" || !this.enabledForRun(input.run.templateKey)) return undefined;
    const actions = await this.prisma.playerAction.findMany({
      where: { runId: input.run.id, roleId: input.role.id, nodeId: input.run.currentNodeId || undefined, actionSlot: { startsWith: `MANEUVER:${input.turn.id}:` } },
      orderBy: { createdAt: "asc" },
    });
    const reactions = await this.openReactionsForRole(input.run.id, input.role.id, input.turn.id);
    const packageData = this.packageFor({
      run: input.run,
      role: input.role,
      roles: input.roles,
      turn: input.turn,
      visibleFacts: input.visibleFacts,
      entries: input.entries,
      assets: input.assets,
      availableTargets: input.availableTargets,
    });
    const cards = projectRuleCardsV1({ cards: packageData.ruleCards, holdings: packageData.ruleCardHoldings, roleId: input.role.id }).map((card) => {
      const definition = packageData.ruleCards.find((item) => item.cardKey === card.cardKey)!;
      return {
        ...card,
        legalTargets: packageData.targets.filter((target) => definition.legalTargetTypes.includes(target.type)).map((target) => ({ id: target.id, label: target.label, type: target.type })),
        triggerOptions: definition.triggerPatternIds.map((triggerPatternId) => ({ triggerPatternId, label: triggerLabel(triggerPatternId) })),
      };
    });
    const pendingActions = await this.pendingActions(input.run.id, input.role.id, input.turn.id, input.turn.stageIndex);
    const eligibleReactionCards = cards
      .filter((card) => card.status === "AVAILABLE" && card.timing.includes("REACTION"))
      .map((card) => card.cardAssetKey);
    const projectedReactions = reactions.map((reaction: ManeuverReactionProjection) => ({
      ...reaction,
      eligibleCardAssetKeys: eligibleReactionCards,
    }));
    return {
      schemaVersion: "maneuver_rules_projection_v1" as const,
      enabled: true as const,
      window: {
        windowId: `maneuver-window:${input.turn.id}`,
        status: "OPEN" as const,
        totalOpportunities: MAX_MANEUVERS_PER_TURN,
        remainingOpportunities: Math.max(0, MAX_MANEUVERS_PER_TURN - actions.length),
        usedSlots: actions.map((action: PlayerAction, index: number) => ({
          slot: index === 0 ? "MANEUVER_1" as const : "MANEUVER_2" as const,
          actionId: action.id,
          kind: maneuverKindFromActionType(action.actionType),
          status: action.status,
        })),
        formLimits: {
          conversationRemaining: actions.some((action) => action.actionType === "MANEUVER_CONVERSATION_V1") ? 0 : 1,
          investigationRemaining: actions.some((action) => action.actionType === "MANEUVER_INVESTIGATION_V1") ? 0 : 1,
        },
        version: actions.length + 1,
        closesWhen: "MAIN_DECISION_COMMITS" as const,
      },
      contacts: projectContactsV1(packageData.contacts, input.role.id),
      investigationLeads: projectInvestigationLeadsV1({ traces: packageData.traces, routes: packageData.investigationRoutes, roleId: input.role.id, currentStage: input.turn.stageIndex }),
      ruleCards: cards,
      evidenceCards: projectEvidenceHandV1(packageData.evidence, input.role.id),
      pendingActions,
      reactions: projectedReactions,
    };
  }

  private async loadContext(user: AuthenticatedUser, roomId: string, turnId: string) {
    return this.loadContextWith(this.prisma, user, roomId, turnId);
  }

  private async loadContextTx(tx: Tx, user: AuthenticatedUser, roomId: string, turnId: string) {
    return this.loadContextWith(tx, user, roomId, turnId);
  }

  private async loadContextWith(db: PrismaService | Tx, user: AuthenticatedUser, roomId: string, turnId: string) {
    const turn = await db.actorTurn.findUnique({ where: { id: turnId }, include: { run: true, role: true } });
    if (!turn || turn.runId !== roomId) throw new NotFoundException({ code: "TURN_NOT_FOUND", message: "Actor turn not found" });
    if (turn.status !== "OPEN") throw new ConflictException({ code: "MANEUVER_WINDOW_CLOSED", message: "主线决策已经锁定，当前场景不能再提交谋划。" });
    if (!turn.run.currentNodeId) throw new ConflictException({ code: "CURRENT_NODE_REQUIRED", message: "当前故事局没有可写入的剧情节点。" });
    const [membership, activePlayers, control, roles, facts, entries, assets, actions, openReactions] = await Promise.all([
      db.storyPlayer.findFirst({ where: { runId: roomId, userId: user.id, roleId: turn.roleId, status: "active" } }),
      db.storyPlayer.findMany({
        where: { runId: roomId, status: "active", userId: { not: null }, roleId: { not: null } },
        select: { userId: true, roleId: true },
      }),
      db.roleControl.findUnique({ where: { runId_roleId: { runId: roomId, roleId: turn.roleId } } }),
      db.storyRole.findMany({ where: { runId: roomId }, orderBy: { createdAt: "asc" } }),
      db.canonFact.findMany({ where: { runId: roomId, status: "confirmed" }, orderBy: { createdAt: "asc" } }),
      db.narrativeEntry.findMany({ where: { runId: roomId, OR: [{ visibility: "public" }, { roleId: turn.roleId }] }, orderBy: [{ worldSequence: "asc" }, { createdAt: "asc" }], take: 160 }),
      db.roleAsset.findMany({
        where: {
          runId: roomId,
          OR: [
            { ownerRoleId: turn.roleId },
            { visibility: { in: ["PUBLIC", "OBSERVABLE"] } },
            { stateJson: { path: ["sharedWithRoleIds"], array_contains: turn.roleId } },
          ],
        },
        orderBy: { assetKey: "asc" },
      }),
      db.playerAction.findMany({ where: { runId: roomId, roleId: turn.roleId, nodeId: turn.run.currentNodeId, actionSlot: { startsWith: `MANEUVER:${turn.id}:` } }, orderBy: { createdAt: "asc" } }),
      db.playerAction.findMany({
        where: {
          runId: roomId,
          targetRoleId: turn.roleId,
          actionType: { startsWith: "MANEUVER_" },
          status: "OPEN",
        },
        include: { role: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
    ]);
    if (!membership) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "This turn belongs to another role" });
    if (!control || control.epoch <= 0 || !["HUMAN_ACTIVE", "HUMAN_OFFLINE_GRACE"].includes(control.mode)) {
      throw new ForbiddenException({ code: "ROLE_CONTROL_CHANGED", message: "当前角色不由你控制。" });
    }
    const visibleFacts = facts.filter((fact: CanonFact) => fact.visibility === "public" || stringList(fact.knownByRoleIdsJson).includes(turn.roleId));
    const availableTargets = buildTargets(turn, roles, visibleFacts, assets);
    const packageData = this.packageFor({ run: turn.run, role: turn.role, roles, turn, visibleFacts, entries, assets, availableTargets });
    const windowVersion = actions.length + 1;
    const slot = actions.length === 0 ? "MANEUVER_1" as const : "MANEUVER_2" as const;
    const compileContext: ManeuverCompileContextV1 = {
      runId: roomId,
      actorTurnId: turn.id,
      actorRoleId: turn.roleId,
      actorRoleKey: turn.role.roleKey,
      actorId: turn.roleId,
      actorLabel: turn.role.roleName,
      slot,
      turnRevision: turn.revision,
      stateRevision: turn.run.worldSequence,
      maneuverWindowVersion: windowVersion,
      controlEpoch: control.epoch,
      contextHash: sha256Canonical({
        runId: roomId,
        turnId: turn.id,
        turnRevision: turn.revision,
        worldSequence: turn.run.worldSequence,
        reservedWorldSequence: turn.run.reservedWorldSequence,
        windowVersion,
        targets: availableTargets.map((item) => item.id),
        traces: packageData.traces.map((item) => [item.traceId, item.status]),
        cards: packageData.ruleCardHoldings.map((item) => [item.cardAssetKey, item.status]),
        evidence: packageData.evidence.map((item) => [item.evidenceId, item.visibility]),
        reactions: openReactions.map((item: PlayerAction) => [item.id, item.status, item.updatedAt instanceof Date ? item.updatedAt.toISOString() : String(item.updatedAt || "")]),
      }),
      contacts: packageData.contacts,
      traces: packageData.traces,
      investigationRoutes: packageData.investigationRoutes,
      ruleCards: packageData.ruleCards,
      ruleCardHoldings: packageData.ruleCardHoldings,
      actionBindings: packageData.actionBindings,
      targets: packageData.targets,
      evidence: packageData.evidence,
      capabilityIds: packageData.capabilityIds,
      resourceAmounts: packageData.resourceAmounts,
      currentStage: turn.stageIndex,
      nowIso: new Date().toISOString(),
      previewTtlSeconds: PREVIEW_TTL_SECONDS,
    };
    return { run: turn.run, turn, role: turn.role, control, roles, visibleFacts, entries, assets, actions, openReactions, membership, activePlayers, availableTargets, packageData, compileContext, windowVersion };
  }

  private packageFor(input: {
    run: Pick<StoryRun, "id" | "templateKey" | "worldSequence">;
    role: StoryRole;
    roles: StoryRole[];
    turn: ActorTurn;
    visibleFacts: Array<Pick<CanonFact, "factKey" | "content">>;
    entries: NarrativeEntry[];
    assets: RoleAsset[];
    availableTargets: ActionTargetV1[];
  }) {
    return buildContinuousStoryV2ManeuverPackageV1({
      runId: input.run.id,
      actorRole: input.role,
      roles: input.roles,
      visibleFacts: input.visibleFacts,
      observableEntries: input.entries
        .filter((entry) => ["V2_OBSERVABLE_TRACE", "V2_MANEUVER_TRACE", "V2_MANEUVER_NOTICE"].includes(entry.entryType))
        .map((entry) => ({ id: entry.id, entryType: entry.entryType, content: entry.content, worldSequence: entry.worldSequence, visibility: entry.visibility, roleId: entry.roleId })),
      assets: input.assets.map((asset) => ({
        assetKey: asset.assetKey,
        kind: asset.kind,
        ownerRoleId: asset.ownerRoleId,
        quantity: asset.quantity,
        status: asset.status,
        visibility: asset.visibility,
        stateJson: asset.stateJson,
        label: assetDisplayName(asset.assetKey),
      })),
      availableTargets: input.availableTargets,
      currentStage: input.turn.stageIndex,
      currentRevision: input.turn.revision,
      currentTurnId: input.turn.id,
    });
  }

  private previewCommand(value: unknown): CreateActionPreviewCommandV1 {
    try {
      const parsed = parseCreateActionPreviewCommandV1(value);
      if (!IDEMPOTENCY_KEY.test(parsed.idempotencyKey)) {
        throw Object.assign(new Error("行动预演需要有效的幂等键。"), { code: "INVALID_IDEMPOTENCY_KEY", path: "$.idempotencyKey" });
      }
      return parsed;
    } catch (error) {
      const details = error && typeof error === "object" ? error as { code?: unknown; message?: unknown; path?: unknown } : {};
      throw new BadRequestException({
        code: typeof details.code === "string" ? details.code : "MANEUVER_DRAFT_INVALID",
        message: typeof details.message === "string" ? details.message : "行动预演请求无效。",
        ...(typeof details.path === "string" ? { path: details.path } : {}),
      });
    }
  }

  private commitCommand(value: unknown): { idempotencyKey: string; previewToken: string } {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException({ code: "MANEUVER_COMMIT_INVALID", message: "行动确认请求无效。" });
    const command = value as Record<string, unknown>;
    const unknown = Object.keys(command).filter((key) => !["idempotencyKey", "previewToken"].includes(key));
    if (unknown.length > 0) throw new BadRequestException({ code: "MANEUVER_UNKNOWN_FIELD", message: `行动确认包含不允许的字段：${unknown.join("、")}` });
    const idempotencyKey = String(command.idempotencyKey || "");
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new BadRequestException({ code: "INVALID_IDEMPOTENCY_KEY", message: "行动确认需要有效的幂等键。" });
    if (typeof command.previewToken !== "string") throw new BadRequestException({ code: "ACTION_PREVIEW_TOKEN_INVALID", message: "行动预演凭证缺失。" });
    return { idempotencyKey, previewToken: command.previewToken };
  }

  private assertReactionDraft(
    context: {
      role: StoryRole;
      openReactions: Array<{ id: string; status: string; actionType: string }>;
      packageData: {
        ruleCards: RuleCardDefinitionV1[];
        ruleCardHoldings: RuleCardHoldingV1[];
      };
    },
    draft: ManeuverDraftV1,
  ) {
    if (draft.kind !== "REACTION") return;
    const source = context.openReactions.find((item) => item.id === draft.reactionId && item.status === "OPEN");
    if (!source) {
      throw new ConflictException({ code: "REACTION_WINDOW_CLOSED", message: "这项应变窗口已经关闭或不属于当前角色。" });
    }
    const legalOptionIds = new Set(reactionOptionsForActionType(source.actionType).map((item) => item.optionId));
    if (draft.optionId && !legalOptionIds.has(draft.optionId)) {
      throw new BadRequestException({ code: "REACTION_OPTION_INVALID", message: "所选应变选项不属于当前剧情窗口。" });
    }
    if (draft.cardAssetKey) {
      const holding = context.packageData.ruleCardHoldings.find((item) => (
        item.cardAssetKey === draft.cardAssetKey
        && item.ownerRoleId === context.role.id
        && item.status === "AVAILABLE"
      ));
      const definition = holding && context.packageData.ruleCards.find((item) => (
        item.cardKey === holding.cardKey && item.timing.includes("REACTION")
      ));
      if (!holding || !definition) {
        throw new ConflictException({ code: "CARD_NOT_OWNED", message: "这张筹码不能用于当前应变。" });
      }
    }
  }

  private assertWindow(actions: Array<{ actionType: string }>, kind: ManeuverKindV1) {
    if (kind !== "REACTION" && actions.length >= MAX_MANEUVERS_PER_TURN) {
      throw new ConflictException({ code: "MANEUVER_OPPORTUNITY_EXHAUSTED", message: "本场景的两次主动谋划已经用完。" });
    }
    if (kind === "CONVERSATION" && actions.some((action) => action.actionType === "MANEUVER_CONVERSATION_V1")) {
      throw new ConflictException({ code: "MANEUVER_FORM_LIMIT_REACHED", message: "本场景已经主动发起过一次人物交谈。" });
    }
    if (kind === "INVESTIGATION" && actions.some((action) => action.actionType === "MANEUVER_INVESTIGATION_V1")) {
      throw new ConflictException({ code: "MANEUVER_FORM_LIMIT_REACHED", message: "本场景已经发起过一次派遣调查。" });
    }
  }

  private async applyAction(
    tx: Tx,
    context: Awaited<ReturnType<ContinuousStoryV2ManeuverService["loadContextTx"]>>,
    actionId: string,
    action: CompiledManeuverActionV1,
    draft: ManeuverDraftV1,
    presentation: ActionPreviewPresentationV1,
    sequence: number,
  ) {
    const title = presentation.title;
    const narrative = presentation.narrative;
    await tx.narrativeEntry.create({
      data: {
        runId: context.run.id,
        nodeId: context.run.currentNodeId,
        roleId: context.role.id,
        entryType: "V2_MANEUVER_ACTION",
        visibility: "private",
        content: `${title}\n${narrative}`,
        factKeysJson: [],
        threadKeysJson: [],
        sourceEventIdsJson: [actionId],
        worldSequence: sequence,
        dedupeKey: `V2_MANEUVER_ACTION:${actionId}:${context.role.id}`,
      },
    });

    if (action.actionKind === "CONVERSATION" && action.primaryEffect.kind === "OPEN_INTERACTION") {
      const targetRoleId = this.targetRoleId(context.roles, action);
      if (!targetRoleId) throw new ConflictException({ code: "ACTION_TARGET_NOT_VISIBLE", message: "交谈对象已经不可用。" });
      const publicConversation = action.visibility.scope === "PUBLIC";
      const evidenceTitles = await this.shareEvidenceAttachments(
        tx,
        context,
        actionId,
        action.sourceEvidenceIds,
        publicConversation ? context.roles.map((role: StoryRole) => role.id) : [targetRoleId],
        publicConversation,
      );
      const spokenText = draft.kind === "CONVERSATION" ? draft.message : action.method;
      const attachmentText = evidenceTitles.length > 0
        ? `并实际出示了：${evidenceTitles.join("、")}。`
        : "";
      await tx.narrativeEntry.create({
        data: {
          runId: context.run.id,
          nodeId: context.run.currentNodeId,
          roleId: publicConversation ? null : targetRoleId,
          entryType: "V2_MANEUVER_NOTICE",
          visibility: publicConversation ? "public" : "private",
          content: publicConversation
            ? `${context.role.roleName}公开向${action.target.label}表示：${spokenText}${attachmentText}`
            : `${context.role.roleName}向你发来一段定向交谈：${spokenText}${attachmentText}`,
          factKeysJson: [],
          threadKeysJson: [],
          sourceEventIdsJson: [actionId],
          worldSequence: sequence,
          dedupeKey: `V2_MANEUVER_NOTICE:${actionId}:${publicConversation ? "public" : targetRoleId}`,
        },
      });
      return {
        status: "OPEN",
        resolvedJson: {
          status: "OPEN",
          worldSequence: sequence,
          awaitsRoleId: targetRoleId,
          evidenceIds: action.sourceEvidenceIds,
          visibility: publicConversation ? "PUBLIC" : "LIMITED",
        },
        immediateReceipt: {
          title,
          narrative: "这段话已经送达。对方可以回应、拒绝或暂时保持沉默。",
          visibility: publicConversation ? "PUBLIC" as const : "LIMITED" as const,
        },
      };
    }

    if (action.actionKind === "INVESTIGATION" && action.primaryEffect.kind === "START_INVESTIGATION") {
      const effect = action.primaryEffect;
      const trace = context.packageData.traces.find((item) => item.traceId === effect.traceId);
      const route = context.packageData.investigationRoutes.find((item) => item.routeId === effect.routeId);
      if (!trace || !route) throw new ConflictException({ code: "ACTION_PREVIEW_STALE", message: "调查痕迹或路线已经变化，请重新预演。" });
      const evidenceId = `evidence_${sha256Canonical({ actionId, traceId: trace.traceId, routeId: route.routeId }).slice(0, 24)}`;
      if (route.settlementMoment.kind !== "IMMEDIATE_AFTER_COMMIT") {
        if (route.observableTrail) {
          await this.writeTraceNotice(tx, context, actionId, sequence, route.observableTrail.summary, action.target.id, {
            audienceRoleIds: trace.subjectEntityIds,
          });
        }
        return {
          status: "PENDING",
          resolvedJson: {
            schemaVersion: "pending_investigation_v1",
            status: "PENDING",
            worldSequence: sequence,
            originTurnId: context.turn.id,
            originStageIndex: context.turn.stageIndex,
            settlementMoment: route.settlementMoment,
            evidenceId,
            trace,
            route,
          },
          immediateReceipt: {
            title,
            narrative: `调查已经开始。结果会在${action.timing.playerLabel}返回；在此之前，系统不会把未知事实写成结论。`,
            visibility: "PRIVATE" as const,
          },
        };
      }
      return this.completeInvestigation(tx, context, actionId, trace, route, evidenceId, sequence, title);
    }

    if (action.actionKind === "CARD_LAYOUT" && action.primaryEffect.kind === "PLAY_RULE_CARD") {
      const storedAsset = await tx.roleAsset.findUnique({ where: { runId_assetKey: { runId: context.run.id, assetKey: action.primaryEffect.cardAssetKey } } });
      const asset = storedAsset
        ? await this.releaseStaleTurnCardLock(tx, storedAsset, context.turn.id)
        : null;
      if (!asset || asset.ownerRoleId !== context.role.id || asset.status !== "ACTIVE") throw new ConflictException({ code: "CARD_NOT_OWNED", message: "这张筹码已经不在当前角色手中。" });
      const definition = context.packageData.ruleCards.find((item) => item.cardKey === context.packageData.ruleCardHoldings.find((item) => item.cardAssetKey === asset.assetKey)?.cardKey);
      if (!definition) throw new ConflictException({ code: "ACTION_PREVIEW_STALE", message: "筹码规则已经变化，请重新预演。" });
      if (action.primaryEffect.playMode === "SET") {
        const before = {
          quantity: asset.quantity,
          status: asset.status,
          stateJson: record(asset.stateJson),
          version: asset.version,
        };
        const updated = await tx.roleAsset.update({
          where: { id: asset.id },
          data: {
            status: "LOCKED",
            version: { increment: 1 },
            stateJson: {
              ...record(asset.stateJson),
              maneuverRulesV1: {
                status: "ARMED",
                actionId,
                ownerRoleId: context.role.id,
                targetId: action.target.id,
                triggerPatternId: action.primaryEffect.triggerPatternId,
                armedAtSequence: sequence,
                expiresAtTurnId: context.turn.id,
                cardDefinition: definition,
              },
            } as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.roleAssetMutation.create({
          data: {
            assetId: asset.id,
            actionId,
            mutationType: "LOCK",
            delta: 0,
            fromRoleId: context.role.id,
            toRoleId: context.role.id,
            beforeJson: before as unknown as Prisma.InputJsonValue,
            afterJson: {
              quantity: updated.quantity,
              status: updated.status,
              stateJson: record(updated.stateJson),
              version: updated.version,
            } as unknown as Prisma.InputJsonValue,
            idempotencyKey: `maneuver-card:${actionId}:${asset.assetKey}:LOCK`,
          },
        });
        return {
          status: "ARMED",
          resolvedJson: { status: "ARMED", worldSequence: sequence, triggerPatternId: action.primaryEffect.triggerPatternId },
          immediateReceipt: { title, narrative: "筹码已经按牌面条件伏下；触发前只显示为你的私密布局。", visibility: "PRIVATE" as const },
        };
      }
      await this.consumeCard(tx, asset, definition, context.turn.stageIndex, actionId);
      const cardFactKey = `maneuver.card.effect.${actionId}`;
      const cardFactContent = `${definition.label}：${definition.guaranteedEffects.join("；") || "牌面规则已经进入结算"}`;
      const cardTargetRoleId = this.targetRoleId(context.roles, action);
      const cardKnownBy = action.visibility.scope === "PUBLIC"
        ? context.roles.map((role: StoryRole) => role.id)
        : Array.from(new Set([
            context.role.id,
            ...(action.visibility.roleIds || []),
            ...(cardTargetRoleId ? [cardTargetRoleId] : []),
          ]));
      await tx.canonFact.create({
        data: {
          runId: context.run.id,
          sourceNodeId: context.run.currentNodeId,
          factKey: cardFactKey,
          content: cardFactContent,
          status: "confirmed",
          visibility: action.visibility.scope.toLowerCase(),
          sourceEventIdsJson: [],
          sourceActionIdsJson: [actionId],
          knownByRoleIdsJson: cardKnownBy,
        },
      });
      await this.writeTraceNotice(tx, context, actionId, sequence, `${definition.label}已经正式进入局势。`, action.target.id, {
        audienceRoleIds: action.visibility.roleIds,
        publicWhenNoRole: ["PUBLIC", "OBSERVABLE"].includes(action.visibility.scope),
      });
      const opensReaction = Boolean(cardTargetRoleId && action.reactionPolicy.mode !== "NONE");
      if (opensReaction && cardTargetRoleId) {
        await tx.narrativeEntry.create({
          data: {
            runId: context.run.id,
            nodeId: context.run.currentNodeId,
            roleId: cardTargetRoleId,
            entryType: "V2_MANEUVER_NOTICE",
            visibility: "private",
            content: `一项规则筹码已经直接作用于你控制的目标：${definition.guaranteedEffects.join("；") || "牌面效果已经进入局势"}。你可以回应这次影响，但不能改写已经发生的公开事实。`,
            factKeysJson: [cardFactKey],
            threadKeysJson: [],
            sourceEventIdsJson: [actionId],
            worldSequence: sequence,
            dedupeKey: `V2_CARD_REACTION_NOTICE:${actionId}:${cardTargetRoleId}`,
          },
        });
      }
      return {
        status: opensReaction ? "OPEN" : "RESOLVED",
        resolvedJson: {
          status: opensReaction ? "OPEN" : "RESOLVED",
          worldSequence: sequence,
          cardAssetKey: asset.assetKey,
          factKey: cardFactKey,
          ...(opensReaction ? { reactionKind: "CARD_EFFECT", awaitsRoleId: cardTargetRoleId } : {}),
        },
        immediateReceipt: { title, narrative: `${definition.label}已经按牌面规则生效；牌面之外的结果仍由局势结算。`, visibility: action.visibility.scope },
      };
    }

    if (action.primaryEffect.kind === "DISCLOSE_EVIDENCE") {
      const evidenceAssets = await tx.roleAsset.findMany({
        where: {
          runId: context.run.id,
          assetKey: { in: action.primaryEffect.evidenceAssetIds },
          ownerRoleId: context.role.id,
          kind: "EVIDENCE_CARD_V1",
          status: "ACTIVE",
        },
      });
      if (evidenceAssets.length !== action.primaryEffect.evidenceAssetIds.length) {
        throw new ConflictException({ code: "EVIDENCE_NOT_OWNED", message: "证据所有权或状态已经变化，请重新预演。" });
      }
      const targetRoleId = this.targetRoleId(context.roles, action);
      const publicAudience = action.primaryEffect.audience === "PUBLIC";
      if (!publicAudience && action.primaryEffect.audience === "TARGET" && !targetRoleId) {
        throw new ConflictException({ code: "ACTION_TARGET_NOT_VISIBLE", message: "证据接收对象已经不可用。" });
      }
      const disclosedTitles: string[] = [];
      const confirmedFactKeys: string[] = [];
      for (const asset of evidenceAssets) {
        const card = record(asset.stateJson) as unknown as EvidenceCardStateV1;
        if (card.schemaVersion !== "evidence_card_v1" || card.ownerRoleId !== context.role.id) {
          throw new ConflictException({ code: "EVIDENCE_NOT_OWNED", message: "证据来源链已经变化，请重新预演。" });
        }
        const sharedWithRoleIds = publicAudience
          ? context.roles.map((role: StoryRole) => role.id)
          : Array.from(new Set([...(card.sharedWithRoleIds || []), ...(targetRoleId ? [targetRoleId] : [])]));
        const visibility = publicAudience ? "PUBLIC" : "SHARED";
        const before = {
          visibility: asset.visibility,
          stateJson: record(asset.stateJson),
          version: asset.version,
        };
        const updated = await tx.roleAsset.update({
          where: { id: asset.id },
          data: {
            visibility,
            version: { increment: 1 },
            stateJson: { ...card, visibility, sharedWithRoleIds } as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.roleAssetMutation.create({
          data: {
            assetId: asset.id,
            actionId,
            mutationType: publicAudience ? "REVEAL" : "SHARE",
            delta: 0,
            fromRoleId: context.role.id,
            toRoleId: publicAudience ? null : targetRoleId,
            beforeJson: before as unknown as Prisma.InputJsonValue,
            afterJson: {
              visibility: updated.visibility,
              stateJson: record(updated.stateJson),
              version: updated.version,
            } as unknown as Prisma.InputJsonValue,
            idempotencyKey: `maneuver-evidence:${actionId}:${asset.id}:${publicAudience ? "REVEAL" : "SHARE"}`,
          },
        });
        disclosedTitles.push(card.title);
        if (card.level === "PROOF" && card.authenticity === "AUTHENTICATED") {
          for (const support of card.supports) {
            const factKey = `evidence.disclosed.${actionId}.${sha256Canonical({ evidenceId: card.evidenceId, claimKey: support.claimKey }).slice(0, 16)}`;
            await tx.canonFact.create({
              data: {
                runId: context.run.id,
                sourceNodeId: context.run.currentNodeId,
                factKey,
                content: support.statement,
                status: "confirmed",
                visibility: publicAudience ? "public" : "limited",
                sourceEventIdsJson: card.source.sourceEventIds,
                sourceActionIdsJson: [actionId],
                knownByRoleIdsJson: publicAudience
                  ? context.roles.map((role: StoryRole) => role.id)
                  : Array.from(new Set([context.role.id, ...(targetRoleId ? [targetRoleId] : [])])),
              },
            });
            confirmedFactKeys.push(factKey);
          }
        }
      }
      const summary = publicAudience
        ? `${context.role.roleName}公开了证据：${disclosedTitles.join("、")}。系统只确认牌面写明的有限命题。`
        : `${context.role.roleName}向你出示了证据：${disclosedTitles.join("、")}。这不自动证明牌面“不能证明”栏目之外的内容。`;
      if (publicAudience) {
        await tx.narrativeEntry.create({
          data: {
            runId: context.run.id,
            nodeId: context.run.currentNodeId,
            roleId: null,
            entryType: "V2_EVIDENCE_REVEALED",
            visibility: "public",
            content: summary,
            factKeysJson: confirmedFactKeys,
            threadKeysJson: [],
            sourceEventIdsJson: [actionId],
            worldSequence: sequence,
            dedupeKey: `V2_EVIDENCE_REVEALED:${actionId}:public`,
          },
        });
      } else if (targetRoleId) {
        await tx.narrativeEntry.create({
          data: {
            runId: context.run.id,
            nodeId: context.run.currentNodeId,
            roleId: targetRoleId,
            entryType: "V2_EVIDENCE_SHARED",
            visibility: "private",
            content: summary,
            factKeysJson: confirmedFactKeys,
            threadKeysJson: [],
            sourceEventIdsJson: [actionId],
            worldSequence: sequence,
            dedupeKey: `V2_EVIDENCE_SHARED:${actionId}:${targetRoleId}`,
          },
        });
      }
      return {
        status: "RESOLVED",
        resolvedJson: {
          status: "DISCLOSED",
          worldSequence: sequence,
          evidenceIds: action.primaryEffect.evidenceAssetIds,
          audience: action.primaryEffect.audience,
          confirmedFactKeys,
        },
        immediateReceipt: {
          title,
          narrative: publicAudience
            ? `《${disclosedTitles.join("》《")}》已经进入公共记录。`
            : `证据已经送达${action.target.label}。`,
          visibility: action.visibility.scope,
        },
      };
    }

    if (action.actionKind === "REACTION" && action.primaryEffect.kind === "REACTION_RESPONSE") {
      const source = await tx.playerAction.findUnique({ where: { id: action.primaryEffect.reactionId } });
      if (!source || source.runId !== context.run.id || source.targetRoleId !== context.role.id || source.status !== "OPEN") {
        throw new ConflictException({ code: "REACTION_WINDOW_CLOSED", message: "这项应变窗口已经关闭。" });
      }
      if (action.primaryEffect.hold) {
        await tx.playerAction.update({
          where: { id: source.id },
          data: {
            status: "HELD",
            resolvedAt: new Date(),
            resolvedJson: {
              ...record(source.resolvedJson),
              status: "HELD",
              heldByRoleId: context.role.id,
              heldAtSequence: sequence,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return {
          status: "RESOLVED",
          resolvedJson: { status: "HELD", worldSequence: sequence, sourceActionId: source.id },
          immediateReceipt: { title: "暂不回应", narrative: "你没有给出明确答复。原请求不会因此被视为同意。", visibility: "PRIVATE" as const },
        };
      }
      await tx.playerAction.update({ where: { id: source.id }, data: { status: "RESPONDED", resolvedAt: new Date(), resolvedJson: { ...record(source.resolvedJson), responseActionId: actionId, status: "RESPONDED" } as unknown as Prisma.InputJsonValue } });
      const replyText = draft.kind === "REACTION" ? (draft.rawText || action.method || "我暂不接受这项影响。") : action.method;
      const responseLabel = source.actionType === "MANEUVER_CONVERSATION_V1" ? "回应了你的交谈" : "回应了你造成的局势变化";
      await tx.narrativeEntry.create({
        data: {
          runId: context.run.id,
          nodeId: context.run.currentNodeId,
          roleId: source.roleId,
          entryType: "V2_MANEUVER_NOTICE",
          visibility: "private",
          content: `${context.role.roleName}${responseLabel}：${replyText}`,
          factKeysJson: [],
          threadKeysJson: [],
          sourceEventIdsJson: [source.id, actionId],
          worldSequence: sequence,
          dedupeKey: `V2_MANEUVER_RESPONSE:${source.id}:${actionId}`,
        },
      });
      return {
        status: "RESOLVED",
        resolvedJson: { status: "RESPONDED", worldSequence: sequence, sourceActionId: source.id, replyText },
        immediateReceipt: { title: "回应已经送达", narrative: replyText, visibility: "LIMITED" as const },
      };
    }

    const factKey = `maneuver.started.${actionId}`;
    const factContent = action.guaranteedStart.map((item) => item.statement).join("；") || `${context.role.roleName}开始执行：${action.method}`;
    const knownBy = action.visibility.scope === "PUBLIC"
      ? context.roles.map((role: StoryRole) => role.id)
      : action.visibility.scope === "LIMITED"
        ? Array.from(new Set([context.role.id, ...(action.visibility.roleIds || []), ...(this.targetRoleId(context.roles, action) ? [this.targetRoleId(context.roles, action)!] : [])]))
        : [context.role.id];
    await tx.canonFact.create({
      data: {
        runId: context.run.id,
        sourceNodeId: context.run.currentNodeId,
        factKey,
        content: factContent,
        status: "confirmed",
        visibility: action.visibility.scope.toLowerCase(),
        sourceEventIdsJson: [],
        sourceActionIdsJson: [actionId],
        knownByRoleIdsJson: knownBy,
      },
    });
    if (action.tracePolicy.leavesTrace) {
      await this.writeTraceNotice(tx, context, actionId, sequence, action.tracePolicy.playerSafeHint || `${context.role.roleName}的行动留下了可观察变化。`, action.target.id, {
        audienceRoleIds: action.visibility.roleIds,
        publicWhenNoRole: ["PUBLIC", "OBSERVABLE"].includes(action.visibility.scope),
      });
    }
    const targetRoleId = this.targetRoleId(context.roles, action);
    const opensReaction = Boolean(targetRoleId && action.reactionPolicy.mode !== "NONE");
    if (opensReaction && targetRoleId) {
      await tx.narrativeEntry.create({
        data: {
          runId: context.run.id,
          nodeId: context.run.currentNodeId,
          roleId: targetRoleId,
          entryType: "V2_MANEUVER_NOTICE",
          visibility: "private",
          content: `${context.role.roleName}的一项行动正在直接影响你控制的目标：${factContent}。你可以回应当前影响，但不能替对方撤回已经发出的命令。`,
          factKeysJson: [factKey],
          threadKeysJson: [],
          sourceEventIdsJson: [actionId],
          worldSequence: sequence,
          dedupeKey: `V2_MANEUVER_REACTION_NOTICE:${actionId}:${targetRoleId}`,
        },
      });
    }
    return {
      status: opensReaction ? "OPEN" : "RESOLVED",
      resolvedJson: {
        status: opensReaction ? "OPEN" : "STARTED",
        worldSequence: sequence,
        factKey,
        resultNarrative: factContent,
        ...(opensReaction ? { reactionKind: "WORLD_ACTION", awaitsRoleId: targetRoleId } : {}),
      },
      immediateReceipt: { title, narrative: `${factContent}。最终效果仍取决于时机、权限和其他角色的行动。`, visibility: action.visibility.scope },
    };
  }

  private async completeInvestigation(
    tx: Tx,
    context: Awaited<ReturnType<ContinuousStoryV2ManeuverService["loadContextTx"]>>,
    actionId: string,
    trace: WorldTraceV1,
    route: InvestigationRouteV1,
    evidenceId: string,
    sequence: number,
    title: string,
    writeObservableTrail = true,
  ) {
    const resolution = resolveInvestigationV1({
      trace,
      route,
      actorRoleId: context.role.id,
      actorCapabilityIds: context.packageData.capabilityIds,
      availableResources: context.packageData.resourceAmounts,
      evidenceId,
      evidenceTitle: `${trace.title} · ${route.label}`,
      acquiredAtRevision: sequence,
    });
    if (resolution.evidence) {
      const existing = await tx.roleAsset.findUnique({
        where: { runId_assetKey: { runId: context.run.id, assetKey: resolution.evidence.evidenceId } },
      });
      if (existing) {
        if (existing.ownerRoleId !== context.role.id || existing.kind !== "EVIDENCE_CARD_V1") {
          throw new ConflictException({ code: "EVIDENCE_ID_COLLISION", message: "调查证据标识与现有资产冲突，结算已停止。" });
        }
      } else {
        const created = await tx.roleAsset.create({
          data: {
            runId: context.run.id,
            assetKey: resolution.evidence.evidenceId,
            kind: "EVIDENCE_CARD_V1",
            ownerRoleId: context.role.id,
            quantity: 1,
            status: "ACTIVE",
            visibility: "PRIVATE",
            stateJson: resolution.evidence as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.roleAssetMutation.create({
          data: {
            assetId: created.id,
            actionId,
            mutationType: "ACQUIRE",
            delta: 1,
            fromRoleId: null,
            toRoleId: context.role.id,
            beforeJson: {} as unknown as Prisma.InputJsonValue,
            afterJson: {
              quantity: created.quantity,
              status: created.status,
              visibility: created.visibility,
              stateJson: record(created.stateJson),
              version: created.version,
            } as unknown as Prisma.InputJsonValue,
            idempotencyKey: `maneuver-evidence:${actionId}:${created.id}:ACQUIRE`,
          },
        });
      }
    }
    const resultText = resolution.evidence
      ? `${resolution.processNarrative}\n\n你获得《${resolution.evidence.title}》。它能够支持：${resolution.evidence.supports.map((item) => item.statement).join("；")}。仍然不能证明：${resolution.evidence.cannotProve.join("；")}。`
      : resolution.processNarrative;
    await tx.narrativeEntry.create({
      data: {
        runId: context.run.id,
        nodeId: context.run.currentNodeId,
        roleId: context.role.id,
        entryType: "V2_INVESTIGATION_RESULT",
        visibility: "private",
        content: resultText,
        factKeysJson: resolution.evidence?.supports.map((item) => item.claimKey) || [],
        threadKeysJson: [],
        sourceEventIdsJson: [actionId],
        worldSequence: sequence,
        dedupeKey: `V2_INVESTIGATION_RESULT:${actionId}`,
      },
    });
    await this.publishInvestigationResultEvent(tx, context, actionId, sequence, resultText, resolution.evidence);
    if (writeObservableTrail && resolution.observableTrail) {
      await this.writeTraceNotice(tx, context, actionId, sequence, resolution.observableTrail.summary, trace.traceId, {
        audienceRoleIds: trace.subjectEntityIds,
      });
    }
    return {
      status: "RESOLVED",
      resolvedJson: {
        status: resolution.status,
        worldSequence: sequence,
        evidenceId: resolution.evidence?.evidenceId || null,
        resultNarrative: resultText,
      },
      immediateReceipt: { title, narrative: resultText, visibility: "PRIVATE" as const },
    };
  }

  private async resolveDueInvestigations(
    user: AuthenticatedUser,
    roomId: string,
    turnId: string,
    requestedMoment: "BEFORE_MAIN_LOCK" | "NEXT_ACTOR_TURN",
  ) {
    return this.serializable(async (tx) => {
      const context = await this.loadContextTx(tx, user, roomId, turnId);
      this.assertNoWorldReservation(context.run);
      const pending = await tx.playerAction.findMany({
        where: {
          runId: roomId,
          roleId: context.role.id,
          actionType: "MANEUVER_INVESTIGATION_V1",
          status: "PENDING",
        },
        orderBy: { createdAt: "asc" },
      });
      const due = pending.filter((action: PlayerAction) => {
        const state = record(action.resolvedJson);
        const moment = record(state.settlementMoment);
        if (moment.kind !== requestedMoment) return false;
        if (requestedMoment === "BEFORE_MAIN_LOCK") return state.originTurnId === turnId;
        return typeof state.originTurnId === "string" && state.originTurnId !== turnId;
      });
      if (!due.length) return { resolvedCount: 0, worldSequence: context.run.worldSequence };

      let sequence = context.run.worldSequence;
      for (const action of due) {
        const state = record(action.resolvedJson);
        const trace = state.trace as WorldTraceV1;
        const route = state.route as InvestigationRouteV1;
        const evidenceId = String(state.evidenceId || `evidence_${sha256Canonical({ actionId: action.id }).slice(0, 24)}`);
        sequence += 1;
        const title = String(record(action.immediateJson).title || action.intent || "调查结果");
        const completed = await this.completeInvestigation(
          tx,
          context,
          action.id,
          trace,
          route,
          evidenceId,
          sequence,
          title,
          false,
        );
        await tx.playerAction.update({
          where: { id: action.id },
          data: {
            status: completed.status,
            resolvedJson: completed.resolvedJson as unknown as Prisma.InputJsonValue,
            resolvedAt: new Date(),
          },
        });
      }
      const updatedRun = await tx.storyRun.updateMany({
        where: {
          id: roomId,
          worldSequence: context.run.worldSequence,
          reservedWorldSequence: context.run.worldSequence,
        },
        data: {
          worldSequence: sequence,
          reservedWorldSequence: sequence,
          version: { increment: 1 },
        },
      });
      if (updatedRun.count !== 1) {
        throw new ConflictException({ code: "ACTION_PREVIEW_STALE", message: "调查结算期间局势已经变化，请刷新后重试。" });
      }
      await tx.actorTurn.update({
        where: { id: turnId },
        data: { revision: { increment: 1 } },
      });
      return { resolvedCount: due.length, worldSequence: sequence };
    });
  }

  private async writeTraceNotice(
    tx: Tx,
    context: Awaited<ReturnType<ContinuousStoryV2ManeuverService["loadContextTx"]>>,
    actionId: string,
    sequence: number,
    content: string,
    targetId: string,
    options: { audienceRoleIds?: string[]; publicWhenNoRole?: boolean } = {},
  ) {
    const roleIds = new Set<string>();
    const targetRole = context.roles.find((role: StoryRole) => role.id === targetId) || null;
    if (targetRole) roleIds.add(targetRole.id);
    for (const roleId of options.audienceRoleIds || []) {
      if (context.roles.some((role: StoryRole) => role.id === roleId)) roleIds.add(roleId);
    }
    roleIds.delete(context.role.id);
    for (const roleId of roleIds) {
      await tx.narrativeEntry.create({
        data: {
          runId: context.run.id,
          nodeId: context.run.currentNodeId,
          roleId,
          entryType: "V2_MANEUVER_TRACE",
          visibility: "private",
          content,
          factKeysJson: [],
          threadKeysJson: [],
          sourceEventIdsJson: [actionId],
          worldSequence: sequence,
          dedupeKey: `V2_MANEUVER_TRACE:${actionId}:${roleId}`,
        },
      });
    }
    if (roleIds.size > 0) {
      const audienceRoleIds = [...roleIds];
      await this.deliveries.publish(tx, {
        runId: context.run.id,
        nodeId: context.run.currentNodeId || undefined,
        type: "MANEUVER_TRACE_OBSERVED_V1",
        messageType: "observable_trace",
        roleKey: context.role.roleKey,
        visibility: "OBSERVABLE",
        audienceType: "ROLE",
        audienceUserIds: this.userIdsForRoles(context.activePlayers, audienceRoleIds),
        audienceRoleIds,
        payload: {
          schemaVersion: "maneuver_trace_event_v1",
          sourceActionId: actionId,
          content,
          worldSequence: sequence,
          targetId,
        },
        dedupeKey: `MANEUVER_TRACE_OBSERVED_V1:${actionId}:${sha256Canonical(audienceRoleIds).slice(0, 12)}`,
        sourceActionId: actionId,
        day: context.run.currentDay,
      });
      return;
    }
    if (options.publicWhenNoRole !== true) return;
    await tx.narrativeEntry.create({
      data: {
        runId: context.run.id,
        nodeId: context.run.currentNodeId,
        roleId: null,
        entryType: "V2_MANEUVER_TRACE",
        visibility: "public",
        content,
        factKeysJson: [],
        threadKeysJson: [],
        sourceEventIdsJson: [actionId],
        worldSequence: sequence,
        dedupeKey: `V2_MANEUVER_TRACE:${actionId}:public`,
      },
    });
    const audienceRoleIds = context.roles.map((role: StoryRole) => role.id);
    await this.deliveries.publish(tx, {
      runId: context.run.id,
      nodeId: context.run.currentNodeId || undefined,
      type: "MANEUVER_TRACE_OBSERVED_V1",
      messageType: "observable_trace",
      roleKey: context.role.roleKey,
      visibility: "PUBLIC",
      audienceType: "ALL_MEMBERS",
      audienceUserIds: this.userIdsForRoles(context.activePlayers, audienceRoleIds),
      audienceRoleIds,
      payload: {
        schemaVersion: "maneuver_trace_event_v1",
        sourceActionId: actionId,
        content,
        worldSequence: sequence,
        targetId,
      },
      dedupeKey: `MANEUVER_TRACE_OBSERVED_V1:${actionId}:public`,
      sourceActionId: actionId,
      day: context.run.currentDay,
    });
  }

  private async triggerArmedCards(
    tx: Tx,
    context: Awaited<ReturnType<ContinuousStoryV2ManeuverService["loadContextTx"]>>,
    sourceActionId: string,
    sourceAction: CompiledManeuverActionV1,
    sequence: number,
  ): Promise<string[]> {
    const triggeredCardActionIds: string[] = [];
    const locked = await tx.roleAsset.findMany({ where: { runId: context.run.id, status: "LOCKED" } });
    for (const asset of locked) {
      const state = record(record(asset.stateJson).maneuverRulesV1);
      if (state.status !== "ARMED" || state.targetId !== sourceAction.target.id || state.actionId === sourceActionId) continue;
      if (!armedTriggerMatches(String(state.triggerPatternId || ""), sourceAction)) continue;
      const ownerRoleId = String(state.ownerRoleId || asset.ownerRoleId || "");
      if (!ownerRoleId) continue;
      triggeredCardActionIds.push(String(state.actionId || asset.id));
      const definition = record(state.cardDefinition);
      const consumption = String(definition.consumption || "REUSABLE");
      const triggeredState = {
        ...state,
        status: consumption === "COOLDOWN" ? "COOLDOWN" : "TRIGGERED",
        triggeredByActionId: sourceActionId,
        triggeredAtSequence: sequence,
        ...(consumption === "COOLDOWN"
          ? { cooldownUntilStage: context.turn.stageIndex + Number(definition.cooldownStages || 1) }
          : {}),
      };
      const before = {
        quantity: asset.quantity,
        status: asset.status,
        stateJson: record(asset.stateJson),
        version: asset.version,
      };
      const updatedAsset = await tx.roleAsset.update({
        where: { id: asset.id },
        data: {
          status: consumption === "CONSUME" ? "CONSUMED" : "ACTIVE",
          ...(consumption === "CONSUME" ? { quantity: 0 } : {}),
          version: { increment: 1 },
          stateJson: { ...record(asset.stateJson), maneuverRulesV1: triggeredState } as unknown as Prisma.InputJsonValue,
        },
      });
      const armedActionId = String(state.actionId || "");
      if (armedActionId) {
        await tx.roleAssetMutation.create({
          data: {
            assetId: asset.id,
            actionId: armedActionId,
            mutationType: "TRIGGER",
            delta: consumption === "CONSUME" ? -Math.max(0, asset.quantity) : 0,
            fromRoleId: ownerRoleId,
            toRoleId: ownerRoleId,
            beforeJson: before as unknown as Prisma.InputJsonValue,
            afterJson: {
              quantity: updatedAsset.quantity,
              status: updatedAsset.status,
              stateJson: record(updatedAsset.stateJson),
              version: updatedAsset.version,
            } as unknown as Prisma.InputJsonValue,
            idempotencyKey: `maneuver-card:${armedActionId}:${asset.assetKey}:TRIGGER:${sourceActionId}`,
          },
        });
        await tx.playerAction.updateMany({
          where: { id: armedActionId, runId: context.run.id, status: "ARMED" },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolvedJson: {
              status: "TRIGGERED",
              triggeredByActionId: sourceActionId,
              triggeredAtWorldSequence: sequence,
              cardAssetKey: asset.assetKey,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
      const triggerFactKey = `maneuver.card.trigger.${String(state.actionId || asset.id)}.${sourceActionId}`;
      const guaranteedEffects = stringList(definition.guaranteedEffects);
      const afterTriggerVisibility = record(record(definition.visibility).afterTrigger);
      const afterTriggerScope = String(afterTriggerVisibility.scope || "OBSERVABLE");
      const triggerTargetRoleId = context.roles.some((role: StoryRole) => role.id === String(state.targetId || ""))
        ? String(state.targetId)
        : null;
      const triggerKnownBy = afterTriggerScope === "PUBLIC"
        ? context.roles.map((role: StoryRole) => role.id)
        : Array.from(new Set([
            ownerRoleId,
            ...stringList(afterTriggerVisibility.roleIds).filter((roleId) => context.roles.some((role: StoryRole) => role.id === roleId)),
            ...(triggerTargetRoleId ? [triggerTargetRoleId] : []),
          ]));
      await tx.canonFact.create({
        data: {
          runId: context.run.id,
          sourceNodeId: context.run.currentNodeId,
          factKey: triggerFactKey,
          content: `${assetDisplayName(asset.assetKey)}被触发：${guaranteedEffects.join("；") || "牌面规则已经进入结算"}`,
          status: "confirmed",
          visibility: afterTriggerScope.toLowerCase(),
          sourceEventIdsJson: [],
          sourceActionIdsJson: [String(state.actionId || ""), sourceActionId].filter(Boolean),
          knownByRoleIdsJson: triggerKnownBy,
        },
      });
      await tx.narrativeEntry.create({
        data: {
          runId: context.run.id,
          nodeId: context.run.currentNodeId,
          roleId: ownerRoleId,
          entryType: "V2_CARD_TRIGGERED",
          visibility: "private",
          content: `你伏下的“${assetDisplayName(asset.assetKey)}”被当前行动触发。牌面效果已经进入结算。`,
          factKeysJson: [triggerFactKey],
          threadKeysJson: [],
          sourceEventIdsJson: [String(state.actionId || ""), sourceActionId],
          worldSequence: sequence,
          dedupeKey: `V2_CARD_TRIGGERED:${state.actionId}:${sourceActionId}`,
        },
      });
      if (afterTriggerScope === "PUBLIC") {
        await tx.narrativeEntry.create({
          data: {
            runId: context.run.id,
            nodeId: context.run.currentNodeId,
            roleId: null,
            entryType: "V2_CARD_EFFECT",
            visibility: "public",
            content: `“${String(definition.label || assetDisplayName(asset.assetKey))}”已经被触发。${guaranteedEffects.join("；") || "牌面效果已经进入局势。"}`,
            factKeysJson: [triggerFactKey],
            threadKeysJson: [],
            sourceEventIdsJson: [String(state.actionId || ""), sourceActionId],
            worldSequence: sequence,
            dedupeKey: `V2_CARD_EFFECT:${state.actionId}:${sourceActionId}:public`,
          },
        });
      } else if (triggerTargetRoleId && triggerTargetRoleId !== ownerRoleId) {
        await tx.narrativeEntry.create({
          data: {
            runId: context.run.id,
            nodeId: context.run.currentNodeId,
            roleId: triggerTargetRoleId,
            entryType: "V2_CARD_EFFECT",
            visibility: "private",
            content: `一项伏置规则在你控制的目标上被触发：${guaranteedEffects.join("；") || "牌面效果已经进入局势。"}`,
            factKeysJson: [triggerFactKey],
            threadKeysJson: [],
            sourceEventIdsJson: [String(state.actionId || ""), sourceActionId],
            worldSequence: sequence,
            dedupeKey: `V2_CARD_EFFECT:${state.actionId}:${sourceActionId}:${triggerTargetRoleId}`,
          },
        });
      }
    }
    return triggeredCardActionIds;
  }

  private async publishCommittedActionEvent(
    tx: Tx,
    context: Awaited<ReturnType<ContinuousStoryV2ManeuverService["loadContextTx"]>>,
    actionId: string,
    action: CompiledManeuverActionV1,
    presentation: ActionPreviewPresentationV1,
    worldSequence: number,
  ) {
    const targetRoleId = this.targetRoleId(context.roles, action);
    // A private or merely observable action never broadcasts its complete
    // preview card. Other roles receive only the trace/reaction projection
    // produced by writeTraceNotice. LIMITED conversations/cards may include
    // the target because the sender explicitly chose to disclose that content.
    const audienceRoleIds = action.visibility.scope === "PUBLIC"
      ? context.roles.map((role: StoryRole) => role.id)
      : action.visibility.scope === "LIMITED"
        ? Array.from(new Set([
            context.role.id,
            ...(action.visibility.roleIds || []),
            ...(targetRoleId ? [targetRoleId] : []),
          ])).filter((roleId) => context.roles.some((role: StoryRole) => role.id === roleId))
        : [context.role.id];
    const publicEvent = action.visibility.scope === "PUBLIC";
    await this.deliveries.publish(tx, {
      runId: context.run.id,
      nodeId: context.run.currentNodeId || undefined,
      type: "MANEUVER_COMMITTED_V1",
      messageType: "maneuver",
      roleKey: context.role.roleKey,
      visibility: publicEvent ? "PUBLIC" : action.visibility.scope === "LIMITED" ? "LIMITED" : "PRIVATE",
      audienceType: publicEvent ? "ALL_MEMBERS" : "ROLE",
      audienceUserIds: this.userIdsForRoles(context.activePlayers, audienceRoleIds),
      audienceRoleIds,
      payload: {
        schemaVersion: "maneuver_committed_event_v1",
        actionId,
        actionKind: action.actionKind,
        title: presentation.title,
        narrative: presentation.narrative,
        worldSequence,
        visibility: action.visibility.scope,
      },
      dedupeKey: `MANEUVER_COMMITTED_V1:${actionId}`,
      sourceActionId: actionId,
      day: context.run.currentDay,
    });
  }

  private async publishInvestigationResultEvent(
    tx: Tx,
    context: Awaited<ReturnType<ContinuousStoryV2ManeuverService["loadContextTx"]>>,
    actionId: string,
    worldSequence: number,
    resultNarrative: string,
    evidence: EvidenceCardStateV1 | null | undefined,
  ) {
    await this.deliveries.publish(tx, {
      runId: context.run.id,
      nodeId: context.run.currentNodeId || undefined,
      type: "INVESTIGATION_COMPLETED_V1",
      messageType: "investigation",
      roleKey: context.role.roleKey,
      visibility: "PRIVATE",
      audienceType: "ROLE",
      audienceUserIds: this.userIdsForRoles(context.activePlayers, [context.role.id]),
      audienceRoleIds: [context.role.id],
      payload: {
        schemaVersion: "investigation_completed_event_v1",
        actionId,
        worldSequence,
        resultNarrative,
        evidence: evidence
          ? {
              evidenceId: evidence.evidenceId,
              title: evidence.title,
              level: evidence.level,
              authenticity: evidence.authenticity,
              supports: evidence.supports,
              cannotProve: evidence.cannotProve,
            }
          : null,
      },
      dedupeKey: `INVESTIGATION_COMPLETED_V1:${actionId}:${worldSequence}`,
      sourceActionId: actionId,
      day: context.run.currentDay,
    });
  }

  private assertNoWorldReservation(run: Pick<StoryRun, "worldSequence" | "reservedWorldSequence">) {
    if (Number(run.reservedWorldSequence) !== Number(run.worldSequence)) {
      throw new ConflictException({
        code: "WORLD_SETTLEMENT_IN_PROGRESS",
        message: "共同世界正在结算另一项权威行动，请等待剧情刷新后再预演或提交谋划。",
      });
    }
  }

  private async shareEvidenceAttachments(
    tx: Tx,
    context: Awaited<ReturnType<ContinuousStoryV2ManeuverService["loadContextTx"]>>,
    actionId: string,
    evidenceAssetKeys: string[],
    audienceRoleIds: string[],
    publicAudience: boolean,
  ) {
    if (evidenceAssetKeys.length === 0) return [];
    const legalAudience = Array.from(new Set(audienceRoleIds))
      .filter((roleId) => context.roles.some((role: StoryRole) => role.id === roleId));
    const titles: string[] = [];
    for (const assetKey of evidenceAssetKeys) {
      const asset = await tx.roleAsset.findUnique({
        where: { runId_assetKey: { runId: context.run.id, assetKey } },
      });
      if (!asset || asset.ownerRoleId !== context.role.id || asset.kind !== "EVIDENCE_CARD_V1" || asset.status !== "ACTIVE") {
        throw new ConflictException({ code: "EVIDENCE_NOT_OWNED", message: "附加证据已经不在当前角色手中。" });
      }
      const card = record(asset.stateJson) as unknown as EvidenceCardStateV1;
      if (card.schemaVersion !== "evidence_card_v1" || card.ownerRoleId !== context.role.id) {
        throw new ConflictException({ code: "EVIDENCE_NOT_OWNED", message: "证据来源链已经变化，请重新预演。" });
      }
      const before = {
        visibility: asset.visibility,
        stateJson: record(asset.stateJson),
        version: asset.version,
      };
      const sharedWithRoleIds = publicAudience
        ? context.roles.map((role: StoryRole) => role.id)
        : Array.from(new Set([...(card.sharedWithRoleIds || []), ...legalAudience]));
      const visibility = publicAudience ? "PUBLIC" : "SHARED";
      const updated = await tx.roleAsset.update({
        where: { id: asset.id },
        data: {
          visibility,
          version: { increment: 1 },
          stateJson: { ...card, visibility, sharedWithRoleIds } as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.roleAssetMutation.create({
        data: {
          assetId: asset.id,
          actionId,
          mutationType: publicAudience ? "REVEAL" : "SHARE",
          delta: 0,
          fromRoleId: context.role.id,
          toRoleId: publicAudience || legalAudience.length !== 1 ? null : legalAudience[0],
          beforeJson: before as unknown as Prisma.InputJsonValue,
          afterJson: {
            visibility: updated.visibility,
            stateJson: record(updated.stateJson),
            version: updated.version,
          } as unknown as Prisma.InputJsonValue,
          idempotencyKey: `maneuver-evidence:${actionId}:${asset.id}:${publicAudience ? "REVEAL" : "SHARE"}`,
        },
      });
      titles.push(card.title);
    }
    return titles;
  }

  private async applyAttachedRuleCards(
    tx: Tx,
    context: Awaited<ReturnType<ContinuousStoryV2ManeuverService["loadContextTx"]>>,
    actionId: string,
    action: CompiledManeuverActionV1,
    outcomeStatus: string,
  ) {
    if (action.actionKind === "CARD_LAYOUT") return;
    for (const assetKey of action.attachedAssetKeys) {
      if (action.sourceEvidenceIds.includes(assetKey)) continue;
      const holding = context.packageData.ruleCardHoldings.find((item) => (
        item.cardAssetKey === assetKey
        && item.ownerRoleId === context.role.id
        && item.status === "AVAILABLE"
      ));
      const definition = holding && context.packageData.ruleCards.find((item) => item.cardKey === holding.cardKey);
      const allowedTiming = action.actionKind === "REACTION" ? "REACTION" : "ATTACH";
      if (!holding || !definition || !definition.timing.includes(allowedTiming)) {
        throw new ConflictException({ code: "ACTION_PREVIEW_STALE", message: "附加筹码的所有权、时机或牌面规则已经变化，请重新预演。" });
      }
      const storedAsset = await tx.roleAsset.findUnique({ where: { runId_assetKey: { runId: context.run.id, assetKey } } });
      const asset = storedAsset
        ? await this.releaseStaleTurnCardLock(tx, storedAsset, context.turn.id)
        : null;
      if (!asset || asset.ownerRoleId !== context.role.id || asset.status !== "ACTIVE" || asset.quantity < 1) {
        throw new ConflictException({ code: "CARD_NOT_OWNED", message: "附加筹码已经不在当前角色手中。" });
      }
      await this.consumeCard(tx, asset, definition, context.turn.stageIndex, actionId);
      const factKey = `maneuver.card.attached.${actionId}.${sha256Canonical(assetKey).slice(0, 12)}`;
      const knownBy = action.visibility.scope === "PUBLIC"
        ? context.roles.map((role: StoryRole) => role.id)
        : action.visibility.scope === "LIMITED"
          ? Array.from(new Set([context.role.id, ...(action.visibility.roleIds || []), ...(this.targetRoleId(context.roles, action) ? [this.targetRoleId(context.roles, action)!] : [])]))
          : [context.role.id];
      await tx.canonFact.create({
        data: {
          runId: context.run.id,
          sourceNodeId: context.run.currentNodeId,
          factKey,
          content: `${definition.label}已附加到这项行动：${definition.guaranteedEffects.join("；") || "牌面修正已经进入结算"}`,
          status: "confirmed",
          visibility: action.visibility.scope.toLowerCase(),
          sourceEventIdsJson: [],
          sourceActionIdsJson: [actionId],
          knownByRoleIdsJson: knownBy,
        },
      });
      if (["PENDING", "OPEN", "ARMED"].includes(outcomeStatus) && definition.consumption === "LOCK") {
        const before = {
          quantity: asset.quantity,
          status: asset.status,
          stateJson: record(asset.stateJson),
          version: asset.version,
        };
        const updated = await tx.roleAsset.update({
          where: { id: asset.id },
          data: {
            status: "LOCKED",
            version: { increment: 1 },
            stateJson: {
              ...record(asset.stateJson),
              maneuverRulesV1: { status: "ATTACHED", actionId },
            } as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.roleAssetMutation.create({
          data: {
            assetId: asset.id,
            actionId,
            mutationType: "LOCK",
            delta: 0,
            fromRoleId: context.role.id,
            toRoleId: context.role.id,
            beforeJson: before as unknown as Prisma.InputJsonValue,
            afterJson: {
              quantity: updated.quantity,
              status: updated.status,
              stateJson: record(updated.stateJson),
              version: updated.version,
            } as unknown as Prisma.InputJsonValue,
            idempotencyKey: `maneuver-card:${actionId}:${asset.assetKey}:ATTACH_LOCK`,
          },
        });
      }
    }
  }


  private async releaseStaleTurnCardLock(
    tx: Tx,
    asset: RoleAsset,
    currentTurnId: string,
  ): Promise<RoleAsset> {
    const root = record(asset.stateJson);
    const state = record(root.maneuverRulesV1);
    const staleTurnLock = asset.status === "LOCKED"
      && state.status === "ARMED"
      && typeof state.expiresAtTurnId === "string"
      && state.expiresAtTurnId !== currentTurnId;
    if (!staleTurnLock) return asset;

    const releasedAt = new Date().toISOString();
    const released = await tx.roleAsset.updateMany({
      where: { id: asset.id, version: asset.version, status: "LOCKED" },
      data: {
        status: "ACTIVE",
        version: { increment: 1 },
        stateJson: {
          ...root,
          maneuverRulesV1: {
            ...state,
            status: "EXPIRED",
            expiredAtTurnId: currentTurnId,
            expiredAt: releasedAt,
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
    if (released.count !== 1) {
      throw new ConflictException({
        code: "ACTION_PREVIEW_STALE",
        message: "筹码状态刚刚发生变化，请刷新后重新预演。",
      });
    }
    return tx.roleAsset.findUniqueOrThrow({ where: { id: asset.id } });
  }

  private async consumeCard(
    tx: Tx,
    asset: RoleAsset,
    definition: { consumption: string; cooldownStages?: number },
    stageIndex: number,
    actionId: string,
  ) {
    if (!["CONSUME", "COOLDOWN"].includes(definition.consumption)) return;
    const before = {
      quantity: asset.quantity,
      status: asset.status,
      stateJson: record(asset.stateJson),
      version: asset.version,
    };
    const cooldownUntilStage = stageIndex + Number(definition.cooldownStages || 1);
    const updated = await tx.roleAsset.update({
      where: { id: asset.id },
      data: definition.consumption === "CONSUME"
        ? { status: "CONSUMED", quantity: 0, version: { increment: 1 } }
        : {
            status: "ACTIVE",
            version: { increment: 1 },
            stateJson: {
              ...record(asset.stateJson),
              maneuverRulesV1: { status: "COOLDOWN", cooldownUntilStage },
            } as unknown as Prisma.InputJsonValue,
          },
    });
    await tx.roleAssetMutation.create({
      data: {
        assetId: asset.id,
        actionId,
        mutationType: definition.consumption === "CONSUME" ? "CONSUME" : "COOLDOWN",
        delta: definition.consumption === "CONSUME" ? -Math.max(0, asset.quantity) : 0,
        fromRoleId: asset.ownerRoleId,
        toRoleId: asset.ownerRoleId,
        beforeJson: before as unknown as Prisma.InputJsonValue,
        afterJson: {
          quantity: updated.quantity,
          status: updated.status,
          stateJson: record(updated.stateJson),
          version: updated.version,
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey: `maneuver-card:${actionId}:${asset.assetKey}:${definition.consumption}`,
      },
    });
  }

  private targetRoleId(roles: StoryRole[], action: CompiledManeuverActionV1): string | null {
    if (["ROLE", "ACTOR", "PERSON"].includes(action.target.type)) return roles.some((role: StoryRole) => role.id === action.target.id) ? action.target.id : null;
    if (action.primaryEffect.kind === "OPEN_INTERACTION") {
      const targetActorId = action.primaryEffect.targetActorId;
      return roles.some((role: StoryRole) => role.id === targetActorId) ? targetActorId : null;
    }
    return null;
  }

  private userIdsForRoles(
    activePlayers: Array<{ userId: string | null; roleId: string | null }>,
    roleIds: string[],
  ) {
    const allowed = new Set(roleIds);
    return Array.from(new Set(activePlayers
      .filter((player): player is { userId: string; roleId: string } => (
        typeof player.userId === "string"
        && typeof player.roleId === "string"
        && allowed.has(player.roleId)
      ))
      .map((player) => player.userId)));
  }

  private async openReactionsForRole(runId: string, roleId: string, turnId: string): Promise<ManeuverReactionProjection[]> {
    const requests = await this.prisma.playerAction.findMany({
      where: {
        runId,
        targetRoleId: roleId,
        actionType: { startsWith: "MANEUVER_" },
        status: "OPEN",
      },
      include: { role: true },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    return requests.map((action: ReactionSourceAction) => ({
      reactionId: action.id,
      storyNotice: reactionStoryNotice(action),
      options: reactionOptionsForActionType(action.actionType),
      eligibleCardAssetKeys: [],
      customAllowed: true,
      holdAllowed: true,
      expiresAt: null,
      turnId,
    }));
  }

  private async pendingActions(runId: string, roleId: string, turnId: string, stageIndex: number) {
    const actions = await this.prisma.playerAction.findMany({
      where: {
        runId,
        roleId,
        chapterIndex: stageIndex,
        OR: [
          { actionSlot: { startsWith: `MANEUVER:${turnId}:` } },
          { actionSlot: { startsWith: "REACTION:" } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    return actions.map((action: PlayerAction) => {
      const resolved = record(action.resolvedJson);
      const immediate = record(action.immediateJson);
      return {
        actionId: action.id,
        kind: maneuverKindFromActionType(action.actionType),
        title: String(immediate.title || action.intent),
        status: action.status,
        slot: action.actionSlot?.startsWith("REACTION:")
          ? "REACTION" as const
          : action.actionSlot?.endsWith(":1")
            ? "MANEUVER_1" as const
            : "MANEUVER_2" as const,
        revealsAtLabel: action.status === "OPEN" ? "等待对方回应" : action.status === "ARMED" ? "条件出现时" : null,
        sourceActionId: typeof resolved.sourceActionId === "string" ? resolved.sourceActionId : null,
        resultTitle: typeof resolved.status === "string" ? resolved.status : null,
        resultNarrative: typeof resolved.resultNarrative === "string" ? resolved.resultNarrative : null,
        evidenceId: typeof resolved.evidenceId === "string" ? resolved.evidenceId : null,
      };
    });
  }

  private replayResult(action: { id: string; actionType: string; actionSlot: string | null; status: string; immediateJson: unknown }) {
    const immediate = record(action.immediateJson);
    return {
      accepted: true as const,
      action: {
        actionId: action.id,
        kind: maneuverKindFromActionType(action.actionType),
        slot: action.actionSlot?.startsWith("REACTION:") ? "REACTION" as const : action.actionSlot?.endsWith(":1") ? "MANEUVER_1" as const : "MANEUVER_2" as const,
        status: action.status,
      },
      immediateReceipt: {
        title: String(immediate.title || "行动已提交"),
        narrative: String(immediate.narrative || "这项行动已经记录。"),
        visibility: "PRIVATE" as const,
      },
      replayed: true,
    };
  }

  private async replayReactionHold(
    tx: Tx,
    user: AuthenticatedUser,
    roomId: string,
    previewId: string,
    idempotencyKey: string,
    action: CompiledManeuverActionV1,
  ) {
    if (!isReactionHold(action) || action.primaryEffect.kind !== "REACTION_RESPONSE") return null;
    const source = await tx.playerAction.findUnique({ where: { id: action.primaryEffect.reactionId } });
    if (!source || source.runId !== roomId || source.targetRoleId !== action.actorRoleId) {
      throw new ConflictException({ code: "REACTION_WINDOW_CLOSED", message: "这项回应窗口已经关闭。" });
    }
    const membership = await tx.storyPlayer.findFirst({
      where: { runId: roomId, userId: user.id, roleId: action.actorRoleId, status: "active" },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "This reaction belongs to another role" });
    const hold = record(record(source.resolvedJson).maneuverHold);
    if (source.status === "HELD"
      && hold.previewId === previewId
      && hold.idempotencyKey === idempotencyKey) {
      return this.reactionHoldResult(source.id, previewId, true);
    }
    if (source.status !== "OPEN") {
      throw new ConflictException({ code: "REACTION_WINDOW_CLOSED", message: "这项回应窗口已经关闭。" });
    }
    return null;
  }

  private reactionHoldResult(sourceActionId: string, previewId: string, replayed: boolean) {
    return {
      accepted: true as const,
      action: {
        actionId: `hold:${sourceActionId}:${previewId}`,
        kind: "REACTION" as const,
        slot: "REACTION" as const,
        status: "RESOLVED",
      },
      immediateReceipt: {
        title: "暂不应变",
        narrative: "你没有在这一刻给出明确回应。原请求不会因此被视为同意，也没有消耗主动谋划。",
        visibility: "PRIVATE" as const,
      },
      ...(replayed ? { replayed: true } : {}),
    };
  }

  private async serializable<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
      } catch (error) {
        if (attempt < 3 && isRetryableTransaction(error)) continue;
        throw error;
      }
    }
    throw new ConflictException({ code: "MANEUVER_CONCURRENCY_CONFLICT", message: "局势正在被其他行动更新，请刷新后重试。" });
  }
}

function buildTargets(
  turn: ActorTurn,
  roles: StoryRole[],
  facts: Array<Pick<CanonFact, "factKey" | "content">>,
  assets: RoleAsset[],
): ActionTargetV1[] {
  return [
    ...roles.map((role: StoryRole) => ({ type: "ROLE" as const, id: role.id, label: role.roleName, aliases: [role.roleKey, role.identity] })),
    ...facts.map((fact) => ({ type: "EVIDENCE" as const, id: fact.factKey, label: fact.content.slice(0, 54) })),
    ...assets.map((asset) => ({ type: "RESOURCE" as const, id: asset.assetKey, label: assetDisplayName(asset.assetKey) })),
    { type: "LOCATION" as const, id: `location:turn:${turn.id}`, label: turn.situationTitle },
    { type: "PUBLIC_FRAME" as const, id: `stage:${turn.stageIndex}`, label: `第 ${turn.stageIndex} 阶段的公共局势` },
  ];
}


type ReactionSourceActionLike = {
  actionType: string;
  targetText?: string | null;
  method?: string | null;
  intent?: string | null;
  immediateJson?: unknown;
  resolvedJson?: unknown;
  role?: { roleName?: string | null } | null;
};

function reactionOptionsForActionType(actionType: string): Array<{ optionId: string; label: string; description: string }> {
  if (actionType === "MANEUVER_CONVERSATION_V1") {
    return [
      { optionId: "reply", label: "直接回应", description: "回答、否认或说明你的立场；回应不会自动履行任何口头条件。" },
      { optionId: "counter_term", label: "提出反条件", description: "把对方的要求改成一个你愿意考虑的条件。" },
      { optionId: "refuse", label: "明确拒绝", description: "拒绝当前请求，但不阻止对方之后采取其他行动。" },
    ];
  }
  if (actionType === "MANEUVER_CARD_LAYOUT_V1") {
    return [
      { optionId: "resist", label: "正面抵制", description: "调用当前合法权限或资源，尝试削弱这张牌对你控制目标的效果。" },
      { optionId: "mitigate", label: "降低损失", description: "接受部分既成影响，把应变集中在尚未完成的结果上。" },
      { optionId: "expose", label: "公开质疑", description: "把这次规则筹码的使用带入公共叙事，要求对方承担公开代价。" },
    ];
  }
  return [
    { optionId: "oppose", label: "立即阻止", description: "以当前角色真实拥有的手段，尝试阻止尚未完成的部分。" },
    { optionId: "protect", label: "保护关键目标", description: "不直接撤销对方行动，而是优先保护你控制的人、物或资源。" },
    { optionId: "observe", label: "暗中跟进", description: "暂不公开对抗，沿已经出现的变化继续判断和留痕。" },
  ];
}

function reactionStoryNotice(action: ReactionSourceActionLike) {
  const immediate = record(action.immediateJson);
  const resolved = record(action.resolvedJson);
  const actorLabel = String(action.role?.roleName || "有人");
  const target = String(action.targetText || "你控制的目标");
  if (action.actionType === "MANEUVER_CONVERSATION_V1") {
    return {
      title: `${actorLabel}正在等待你的回应`,
      narrative: String(immediate.narrative || action.method || action.intent || "一段定向交谈已经送达。你可以回应、提出反条件、拒绝，或暂不应变。"),
    };
  }
  const title = String(immediate.title || "一项行动正在影响你的处境");
  const narrative = String(
    resolved.resultNarrative
      || immediate.narrative
      || `${actorLabel}的一项行动正在作用于${target}。你只能回应自己能够感知、且尚未完成的影响。`,
  );
  return { title, narrative };
}

function maneuverKindFromActionType(actionType: string): ManeuverKindV1 {
  if (actionType.includes("CONVERSATION")) return "CONVERSATION";
  if (actionType.includes("INVESTIGATION")) return "INVESTIGATION";
  if (actionType.includes("CARD_LAYOUT")) return "CARD_LAYOUT";
  if (actionType.includes("REACTION")) return "REACTION";
  return "CUSTOM_PLAN";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function triggerLabel(id: string) {
  if (id === "target_action_detected") return "目标受到行动影响时";
  if (id === "asset_transfer_attempt") return "有人试图转移目标时";
  return id;
}

function armedTriggerMatches(triggerPatternId: string, sourceAction: CompiledManeuverActionV1) {
  if (triggerPatternId === "target_action_detected") return true;
  if (triggerPatternId === "asset_transfer_attempt") {
    return sourceAction.primaryEffect.kind === "APPLY_CAPABILITY"
      && /move|transfer|转移|搬运/i.test(`${sourceAction.primaryEffect.effectKey} ${sourceAction.method} ${sourceAction.objective}`);
  }
  return false;
}

function isRetryableTransaction(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && ["P2034", "P2028"].includes(String((error as { code?: unknown }).code || "")));
}

function isReactionHold(action: CompiledManeuverActionV1): boolean {
  return action.actionKind === "REACTION"
    && action.primaryEffect.kind === "REACTION_RESPONSE"
    && action.primaryEffect.hold === true;
}
