import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/current-user.decorator";
import { readCreditConsumptionConfig } from "../config/credit-consumption.config";
import {
  classifyCreditAction,
  parseRunBilling,
  priceForCreditAction,
} from "../credits/credit-policy";
import { CreditConsumptionService } from "../credits/credit-consumption.service";
import { PrismaService } from "../prisma.service";
import { StoryService } from "../story.service";
import { OpenNovelAdapterService } from "./openovel-adapter.service";
import {
  OPENOVEL_ENGINE_VERSION,
  OpenNovelRuntimeClient,
  type OpenNovelPublicRun,
  type OpenNovelTurnEvent,
} from "./openovel-runtime.client";
import { OpenNovelTurnReplayClient } from "./openovel-turn-replay.client";
import { ACTION_SLOT, type ActionContext, type ChargeReservation } from "./openovel-stage-b-types";
import {
  actionMetadata,
  asRecord,
  canonicalHash,
  creditsRequired,
  definitivePrecommitFailure,
  errorCode,
  idempotencyConflict,
  isIndeterminateTransport,
  isRuntimeBusy,
  openNovelChargeIdempotencyKey,
  openNovelCommitEventId,
  openNovelState,
  productRunStatus,
  publicModelUsage,
  publicTurnResult,
  reconcileAttempts,
  reconcileDelayMs,
  sleep,
} from "./openovel-stage-b-utils";

export abstract class OpenNovelStageBCommitService extends OpenNovelAdapterService {
  protected readonly inFlight = new Map<string, Promise<any>>();

  constructor(
    protected readonly stageBPrisma: PrismaService,
    story: StoryService,
    protected readonly stageBCredits: CreditConsumptionService,
    protected readonly stageBRuntime: OpenNovelRuntimeClient,
    protected readonly replayRuntime: OpenNovelTurnReplayClient,
  ) {
    super(stageBPrisma, story, stageBCredits, stageBRuntime);
  }

  protected async executeOrJoin(
    context: ActionContext,
    onEvent: (event: OpenNovelTurnEvent) => void | Promise<void>,
    preferReplay: boolean,
  ) {
    const active = this.inFlight.get(context.action.id);
    if (active) {
      const result = await active;
      await onEvent({ type: "turn.committed", data: result });
      return result;
    }

    const execution = this.executeOnce(context, onEvent, preferReplay);
    this.inFlight.set(context.action.id, execution);
    try {
      const result = await execution;
      // Persistence and charge commit already succeeded. A disconnected HTTP
      // or SSE callback may fail here without rolling Canon back.
      await onEvent({ type: "turn.committed", data: result });
      return result;
    } finally {
      if (this.inFlight.get(context.action.id) === execution) {
        this.inFlight.delete(context.action.id);
      }
    }
  }

  protected async executeOnce(
    context: ActionContext,
    onEvent: (event: OpenNovelTurnEvent) => void | Promise<void>,
    preferReplay: boolean,
  ) {
    let charge: ChargeReservation = null;
    let committed: any;
    try {
      charge = await this.ensureCharge(context);
      if (preferReplay) {
        committed = await this.replayWithWait(context);
      } else {
        try {
          committed = await this.stageBRuntime.streamAction(
            {
              runId: context.run.id,
              action: context.actionText,
              submissionId: context.action.id,
              expectedStateRevision: context.expectedRevision,
              boundOption: context.boundOption,
            },
            async (event: OpenNovelTurnEvent) => {
              if (event.type === "turn.committed") return;
              try {
                await onEvent(event);
              } catch {
                // Presentation transport never owns the Runtime commit.
              }
            },
          );
        } catch (error) {
          committed = await this.recoverAfterStreamError(context, error);
        }
      }
    } catch (error) {
      const runtimeState = await this.stageBRuntime.getRun(context.run.id).catch(() => null);
      if (definitivePrecommitFailure(error, runtimeState, context.expectedRevision)) {
        await this.failBeforeCommit(context, charge, error);
      }
      throw error;
    }

    const runtimeAfter = await this.stageBRuntime.getRun(context.run.id);
    this.assertCommittedResult(context, committed, runtimeAfter);
    await this.persistStageBCommittedTurn(context, runtimeAfter, committed);
    await this.settleCharge(context, charge || await this.ensureCharge(context));
    return publicTurnResult(asRecord(committed));
  }

  protected async recoverAfterStreamError(
    context: ActionContext,
    error: unknown,
  ) {
    const runtimeState = await this.stageBRuntime.getRun(context.run.id).catch(() => null);
    // A visible Runtime revision advance is conclusive evidence that the
    // authoritative Head may already own this submission. Runtime busy is
    // also retryable because another process still holds the foreground
    // lease. In both cases reconciliation re-enters by the same submission id
    // and cannot start a second settlement for a different key.
    if (Number(runtimeState?.turnNumber ?? -1) > context.expectedRevision
      || isRuntimeBusy(error)) {
      return this.replayWithWait(context, error);
    }

    // A transport failure without a readable Runtime is deliberately left in
    // `generating` + `RESERVED`. Releasing here could make a committed Head
    // free, while replaying here could hide a definitive pre-commit failure.
    // The caller retries with the same key and reconciles after Runtime is
    // readable again.
    if (isIndeterminateTransport(error) && !runtimeState) throw error;
    throw error;
  }

  protected async replayWithWait(context: ActionContext, firstError?: unknown) {
    let lastError = firstError;
    const attempts = reconcileAttempts();
    const delayMs = reconcileDelayMs();
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.replayRuntime.replay({
          runId: context.run.id,
          action: context.actionText,
          submissionId: context.action.id,
          boundOption: context.boundOption,
        });
      } catch (error) {
        lastError = error;
        if (!isRuntimeBusy(error)) throw error;
        await sleep(delayMs);
      }
    }
    throw new ConflictException({
      code: "OPENOVEL_ACTION_IN_PROGRESS",
      message: "The authoritative turn is still being committed. Retry with the same idempotency key.",
      retryable: true,
      cause: errorCode(lastError),
    });
  }

  protected async ensureCharge(context: ActionContext): Promise<ChargeReservation> {
    const creditConfig = readCreditConsumptionConfig();
    const billing = parseRunBilling(context.run, creditConfig.prices);
    const actionClass = classifyCreditAction({
      actorKind: "HUMAN",
      candidateId: context.boundOption?.id,
      customAction: context.boundOption ? undefined : context.actionText,
      decisionForm: "STORY_CHOICE",
      operation: ACTION_SLOT,
    });
    const amount = billing.policyVersion === "active_action_v1"
      ? priceForCreditAction(actionClass, billing.prices)
      : 0;
    if (amount <= 0) return null;

    const attached = await (this.stageBPrisma as any).creditCharge?.findUnique?.({
      where: { playerActionId: context.action.id },
    });
    if (attached) return { kind: "replay", charge: attached };

    const attempt = actionMetadata(context.action).chargeAttempt;
    const reservation = await this.stageBCredits.reserveCharge({
      runId: context.run.id,
      beneficiaryUserId: context.user.id,
      // Attach only after Runtime commit. A released pre-commit attempt then
      // cannot consume the PlayerAction's unique charge relation forever.
      chargeType: "PLAYER_ACTION",
      actionClass,
      amount,
      idempotencyKey: openNovelChargeIdempotencyKey(context.action.id, attempt),
      requestHash: context.requestHash,
      metadata: {
        engine: OPENOVEL_ENGINE_VERSION,
        turnNumber: context.expectedRevision + 1,
        boundOptionId: context.boundOption?.id || null,
        chargeAttempt: attempt,
      },
      meteringMode: creditConfig.meteringMode,
    });
    if (reservation.kind === "insufficient") throw creditsRequired(reservation);
    if (
      reservation.kind === "replay"
      && String((reservation as any).charge?.status || "") === "RELEASED"
    ) {
      throw new ConflictException({
        code: "OPENOVEL_CHARGE_ATTEMPT_RELEASED",
        message: "The previous charge attempt was released. Retry with the same action key.",
      });
    }
    return reservation as ChargeReservation;
  }

  protected async settleCharge(context: ActionContext, reservation: ChargeReservation) {
    const charge = reservation?.charge;
    if (!charge) return null;
    if (charge.playerActionId && charge.playerActionId !== context.action.id) {
      throw new ConflictException({
        code: "CREDIT_CHARGE_ACTION_MISMATCH",
        message: "The OpenNovel charge belongs to a different action.",
      });
    }
    if (!charge.playerActionId) {
      await (this.stageBCredits as any).attachPlayerAction(charge.id, context.action.id);
    }
    return this.stageBCredits.commitCharge(charge.id);
  }

  protected async failBeforeCommit(
    context: ActionContext,
    reservation: ChargeReservation,
    error: unknown,
  ) {
    const failed = await (this.stageBPrisma as any).$transaction(async (tx: any) => {
      const action = await tx.playerAction.updateMany({
        where: { id: context.action.id, status: "generating" },
        data: {
          status: "failed",
          resolvedJson: { code: errorCode(error) },
        },
      });
      if (action.count === 1) {
        await tx.sceneNode.updateMany({
          where: { id: context.nodeId, status: "resolving" },
          data: { status: "generation_failed" },
        });
      }
      return action.count === 1;
    }, { maxWait: 10_000, timeout: 30_000 }).catch(() => false);
    if (failed && reservation?.charge && String(reservation.charge.status || "") === "RESERVED") {
      await this.stageBCredits.releaseCharge(
        reservation.charge.id,
        errorCode(error),
      ).catch(() => undefined);
    }
  }

  protected async reclaimFailedAction(context: ActionContext) {
    const current = await this.refreshAction(context.action.id) || context.action;
    const metadata = actionMetadata(current);
    const nextMetadata = {
      ...asRecord(current.immediateJson),
      boundOption: metadata.boundOption,
      expectedStateRevision: metadata.expectedStateRevision,
      requestedTurnId: metadata.requestedTurnId,
      chargeAttempt: metadata.chargeAttempt + 1,
    };
    const reclaimed = await (this.stageBPrisma as any).$transaction(async (tx: any) => {
      const updated = await tx.playerAction.updateMany({
        where: { id: current.id, status: { in: ["failed", "rejected"] } },
        data: {
          status: "generating",
          immediateJson: nextMetadata,
        },
      });
      if (updated.count !== 1) return null;
      await tx.sceneNode.updateMany({
        where: { id: current.nodeId, status: { in: ["generation_failed", "open_for_actions"] } },
        data: { status: "resolving" },
      });
      return tx.playerAction.findUnique({ where: { id: current.id } });
    }, { maxWait: 10_000, timeout: 30_000 });
    return reclaimed;
  }

  protected async persistStageBCommittedTurn(
    context: ActionContext,
    runtimeAfter: OpenNovelPublicRun,
    result: any,
  ) {
    return (this.stageBPrisma as any).$transaction(async (tx: any) => {
      const fresh = await tx.storyRun.findUnique({
        where: { id: context.run.id },
        select: { stateJson: true },
      });
      if (!fresh) throw new Error("OPENOVEL_RUN_DISAPPEARED");
      const claimed = await tx.playerAction.updateMany({
        where: {
          id: context.action.id,
          status: { in: ["generating", "failed", "rejected"] },
        },
        data: {
          status: "resolved",
          resolvedJson: result,
          resolvedAt: new Date(result.committedAt || Date.now()),
        },
      });
      if (claimed.count === 0) {
        const existing = await tx.playerAction.findUnique({
          where: { id: context.action.id },
          select: { status: true, resolvedJson: true },
        });
        if (existing?.status === "resolved") {
          if (
            existing.resolvedJson
            && canonicalHash(existing.resolvedJson) !== canonicalHash(result)
          ) {
            throw new Error("OPENOVEL_COMMITTED_RESULT_DIVERGED");
          }
          return false;
        }
        throw new Error("OPENOVEL_MIRROR_ACTION_NOT_RECOVERABLE");
      }
      await tx.sceneNode.update({
        where: { id: context.nodeId },
        data: {
          publicNarration: String(result.narration || runtimeAfter.recentCanon),
          actionOptionsJson: runtimeAfter.options,
          status: "resolved",
          resolvedAt: new Date(result.committedAt || Date.now()),
        },
      });
      await tx.storyRun.update({
        where: { id: context.run.id },
        data: {
          status: productRunStatus(runtimeAfter.status),
          currentDay: runtimeAfter.turnNumber,
          completedNodeCount: runtimeAfter.turnNumber,
          currentNodeId: context.nodeId,
          stateJson: openNovelState(fresh.stateJson, runtimeAfter),
          version: { increment: 1 },
        },
      });
      await tx.eventLog.create({
        data: {
          id: openNovelCommitEventId(context.action.id),
          userId: context.user.id,
          runId: context.run.id,
          nodeId: context.nodeId,
          actionId: context.action.id,
          eventName: "openovel_turn_committed",
          source: OPENOVEL_ENGINE_VERSION,
          payload: {
            turnId: result.turnId,
            turnNumber: result.turnNumber,
            narration: result.narration,
            options: runtimeAfter.options,
            warnings: result.warnings || [],
            narrator: publicModelUsage(result.narrator),
            optionsProvider: publicModelUsage(result.optionsProvider),
            committedAt: result.committedAt,
            runtimeResultHash: canonicalHash(result),
            endingHash: canonicalHash(runtimeAfter.ending || null),
          },
        },
      });
      return true;
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  protected assertCommittedResult(
    context: ActionContext,
    result: any,
    runtimeAfter: OpenNovelPublicRun,
  ) {
    if (
      String(result?.runId || "") !== context.run.id
      || String(result?.turnId || "") !== context.requestedTurnId
      || Number(result?.turnNumber) !== context.expectedRevision + 1
      || runtimeAfter.turnNumber < context.expectedRevision + 1
    ) {
      throw new ConflictException({
        code: "OPENOVEL_COMMITTED_TURN_MISMATCH",
        message: "The Runtime replay does not match the claimed turn.",
      });
    }
  }

  protected assertReplayRequest(action: any, expected: {
    runId: string;
    userId: string;
    requestHash: string;
    expectedRevision?: number;
  }) {
    const metadata = actionMetadata(action);
    if (
      action.runId !== expected.runId
      || action.userId !== expected.userId
      || action.requestHash !== expected.requestHash
      || (
        expected.expectedRevision !== undefined
        && metadata.expectedStateRevision !== expected.expectedRevision
      )
    ) {
      throw idempotencyConflict();
    }
  }

  protected async stageBAuthorizedRun(user: AuthenticatedUser, runId: string) {
    const run = await (this.stageBPrisma as any).storyRun.findUnique({
      where: { id: runId },
      include: {
        players: { where: { userId: user.id }, include: { role: true } },
      },
    });
    if (!run) {
      throw new NotFoundException({
        code: "OPENOVEL_RUN_NOT_FOUND",
        message: "Story run not found.",
      });
    }
    if (
      run.ownerUserId !== user.id
      || !run.players?.some((item: any) => item.userId === user.id)
    ) {
      throw new ForbiddenException({
        code: "OPENOVEL_RUN_ACCESS_DENIED",
        message: "This story belongs to another player.",
      });
    }
    if (run.engineVersion !== OPENOVEL_ENGINE_VERSION) {
      throw new ConflictException({
        code: "OPENOVEL_RUNTIME_MISMATCH",
        message: "This run does not use OpenNovel-First.",
      });
    }
    return run;
  }

  protected async roleForAction(runId: string, roleId: string) {
    const role = await (this.stageBPrisma as any).storyRole?.findUnique?.({
      where: { id: roleId },
    });
    if (role && role.runId === runId) return role;
    return { id: roleId, runId };
  }

  protected async refreshAction(actionId: string) {
    return (this.stageBPrisma as any).playerAction.findUnique({
      where: { id: actionId },
    });
  }

  protected stageBAssertEnabled() {
    if (
      process.env.NODE_ENV === "production"
      && String(process.env.OPENOVEL_V1_ENABLED || "") !== "1"
    ) {
      throw new ForbiddenException({
        code: "OPENOVEL_V1_DISABLED",
        message: "OpenNovel-First is not enabled.",
      });
    }
  }
}
