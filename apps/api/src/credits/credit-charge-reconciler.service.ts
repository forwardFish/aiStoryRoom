import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { readCreditConsumptionConfig } from "../config/credit-consumption.config";
import { PrismaService } from "../prisma.service";
import { CreditConsumptionService } from "./credit-consumption.service";
import { operationalMetrics } from "../observability/operational-metrics";

type ReconcileDecision = "COMMIT" | "RELEASE" | "KEEP";

/** Crash recovery for the reserve -> publish -> commit boundary.
 *
 * The reconciler never guesses that a published-looking partial write is a
 * success. It commits only when an authoritative terminal business object is
 * readable, preserves reservations backed by a live worker/generation, and
 * otherwise releases stale orphan reservations exactly through the normal
 * compensation path.
 */
@Injectable()
export class CreditChargeReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CreditChargeReconcilerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CreditConsumptionService) private readonly creditConsumption: CreditConsumptionService
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.CREDIT_RECONCILER_ENABLED === "false") return;
    const intervalMs = boundedInterval(process.env.CREDIT_RECONCILER_INTERVAL_MS);
    this.timer = setInterval(() => void this.safeReconcile(), intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcileOnce(input: { now?: Date; limit?: number } = {}) {
    const now = input.now || new Date();
    const staleBefore = new Date(now.getTime() - readCreditConsumptionConfig().stuckAfterSeconds * 1_000);
    const charges = await (this.prisma as any).creditCharge.findMany({
      where: {
        status: "RESERVED",
        OR: [{ expiresAt: { lte: now } }, { createdAt: { lte: staleBefore } }]
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.max(1, Math.min(500, Number(input.limit || 100)))
    });
    const summary = { inspected: charges.length, committed: 0, released: 0, kept: 0, errors: 0 };
    for (const charge of charges) {
      try {
        const { decision, reason } = await this.decide(charge, now);
        if (decision === "COMMIT") {
          await this.creditConsumption.commitCharge(charge.id);
          summary.committed += 1;
        } else if (decision === "RELEASE") {
          await this.creditConsumption.releaseCharge(charge.id, reason);
          summary.released += 1;
        } else {
          summary.kept += 1;
        }
      } catch (error) {
        summary.errors += 1;
        this.logger.error(`credit reconcile failed chargeId=${charge.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const expiredAllowances = await (this.prisma as any).runCreditAllowance.updateMany({
      where: { status: "ACTIVE", expiresAt: { lte: now } },
      data: { status: "EXPIRED" }
    });
    const terminalRuns = await this.prisma.storyRun.findMany({
      where: { status: { in: ["completed", "chapter_generated", "closed", "expired", "failed", "cancelled", "creation_failed"] } },
      select: { id: true }
    });
    const terminalRunIds = terminalRuns.map((run) => run.id);
    let terminalExpired = 0;
    if (terminalRunIds.length) {
      const allowances = await (this.prisma as any).runCreditAllowance.updateMany({
        where: { runId: { in: terminalRunIds }, status: { in: ["ACTIVE", "EXHAUSTED"] } },
        data: { status: "EXPIRED" }
      });
      terminalExpired = Number(allowances.count || 0);
      await (this.prisma as any).sponsorshipRequest.updateMany({
        where: { runId: { in: terminalRunIds }, status: "PENDING" },
        data: { status: "EXPIRED", resolvedAt: now }
      });
    }
    operationalMetrics.set("credit_charge_stuck_count", {}, summary.kept + summary.errors);
    return { ...summary, expiredAllowances: Number(expiredAllowances.count || 0) + terminalExpired };
  }

  private async safeReconcile() {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.reconcileOnce();
      if (result.committed || result.released || result.errors || result.expiredAllowances) {
        this.logger.log(`credit reconcile inspected=${result.inspected} committed=${result.committed} released=${result.released} kept=${result.kept} expiredAllowances=${result.expiredAllowances} errors=${result.errors}`);
      }
    } catch (error) {
      this.logger.error(`credit reconcile pass failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async decide(charge: any, now: Date): Promise<{ decision: ReconcileDecision; reason: string }> {
    const db = this.prisma as any;
    const recoveryCutoff = new Date(now.getTime() - readCreditConsumptionConfig().stuckAfterSeconds * 1_000);
    const run = charge.runId ? await db.storyRun.findUnique({ where: { id: charge.runId } }) : null;
    if (charge.chargeType === "RUN_CREATE") {
      if (!run) return { decision: "RELEASE", reason: "RUN_CREATE_ORPHANED" };
      const state = asRecord(run.stateJson);
      const roomState = asRecord(state.room);
      const isSolo = run.engineVersion === "solo_story_v2"
        || run.mode === "solo"
        || run.mode === "single"
        || roomState.solo === true
        || Number(run.maxPlayers || 0) === 1;
      if (!isSolo) {
        return run.status === "creation_failed"
          ? { decision: "RELEASE", reason: "RUN_CREATE_FAILED" }
          : { decision: "COMMIT", reason: "SHARED_RUN_DURABLE" };
      }
      if (run.engineVersion === "continuous_story_v2") {
        const playableTurn = await db.actorTurn.findFirst({
          where: {
            runId: run.id,
            turnIndex: 1,
            status: "OPEN",
            qualityStatus: "PASS",
            situationNarrative: { not: "" }
          },
          select: { id: true }
        });
        const decisionSet = playableTurn
          ? await db.decisionSet.findUnique({ where: { turnId: playableTurn.id }, select: { id: true } })
          : null;
        const publishedNarrative = playableTurn
          ? await db.narrativeEntry.findUnique({ where: { dedupeKey: `v2-opening:${playableTurn.id}` }, select: { id: true } })
          : null;
        if (playableTurn && decisionSet && publishedNarrative) {
          return { decision: "COMMIT", reason: "V2_SOLO_OPENING_PUBLISHED" };
        }
        const openingTask = await db.storyTaskOutbox.findFirst({
          where: { runId: run.id, taskType: "ACTOR_OPENING_V2" },
          orderBy: { updatedAt: "desc" },
          select: { id: true, status: true, attempt: true, maxAttempts: true }
        });
        const openingTaskStatus = String(openingTask?.status || "").toUpperCase();
        if (openingTask && ["PENDING", "RUNNING"].includes(openingTaskStatus) && Number(openingTask.attempt || 0) <= Number(openingTask.maxAttempts || 0)) {
          return { decision: "KEEP", reason: "V2_SOLO_OPENING_RECOVERABLE" };
        }
        if (openingTask && openingTaskStatus === "FAILED") {
          return { decision: "RELEASE", reason: "V2_SOLO_OPENING_TERMINAL_FAILURE" };
        }
        return { decision: "RELEASE", reason: "V2_SOLO_OPENING_NOT_PUBLISHED" };
      }
      const publishedOpening = await db.soloGenerationAttempt.findFirst({ where: { runId: run.id, triggerType: "OPENING", status: "PUBLISHED" }, select: { id: true } });
      const playableTurn = await db.actorTurn.findFirst({ where: { runId: run.id, turnIndex: 1, status: "OPEN" }, select: { id: true } });
      if (publishedOpening && playableTurn) return { decision: "COMMIT", reason: "SOLO_OPENING_PUBLISHED" };
      const activeOpening = await db.soloGenerationAttempt.findFirst({
        where: { runId: run.id, triggerType: "OPENING", status: { in: ["ACTION_RESERVED", "GENERATING", "FAILED_RETRYABLE", "SUCCEEDED"] } },
        select: { id: true, status: true, leaseExpiresAt: true, updatedAt: true }
      });
      // A first publication attempt may move a successfully persisted output
      // from SUCCEEDED to FAILED_RETRYABLE while the durable recovery task is
      // still pending.  The task, not the transient attempt label, is the
      // authority for whether publication can still converge without another
      // provider call.
      const openingRecoveryTask = activeOpening?.id
        ? await db.storyTaskOutbox.findFirst({
            where: { runId: run.id, inputRefId: activeOpening.id, taskType: "SOLO_PUBLISH_RECOVERY_V1" },
            orderBy: { updatedAt: "desc" },
            select: { status: true, attempt: true, maxAttempts: true }
          })
        : null;
      const openingRecoveryStatus = String(openingRecoveryTask?.status || "").toUpperCase();
      if (openingRecoveryTask && ["PENDING", "RUNNING"].includes(openingRecoveryStatus) && Number(openingRecoveryTask.attempt || 0) <= Number(openingRecoveryTask.maxAttempts || 0)) {
        return { decision: "KEEP", reason: "SOLO_OPENING_PUBLISH_RECOVERABLE" };
      }
      if (openingRecoveryTask && openingRecoveryStatus === "FAILED") {
        return { decision: "RELEASE", reason: "SOLO_OPENING_PUBLISH_FAILED" };
      }
      const openingHasLiveLease = activeOpening?.leaseExpiresAt && new Date(activeOpening.leaseExpiresAt) > now;
      const openingRecentlyRecoverable = activeOpening?.updatedAt && new Date(activeOpening.updatedAt) > recoveryCutoff;
      if (activeOpening && (openingHasLiveLease || openingRecentlyRecoverable)) {
        return { decision: "KEEP", reason: "SOLO_OPENING_RECOVERABLE" };
      }
      return { decision: "RELEASE", reason: "SOLO_OPENING_TERMINAL_FAILURE" };
    }

    if (!charge.playerActionId) return { decision: "RELEASE", reason: "PLAYER_ACTION_ORPHANED" };
    const action = await db.playerAction.findUnique({ where: { id: charge.playerActionId } });
    if (!action) return { decision: "RELEASE", reason: "PLAYER_ACTION_MISSING" };
    const resolution = await db.actionResolution.findUnique({ where: { playerActionId: action.id } });
    if (resolution?.qualityStatus === "PASS" || action.status === "resolved") {
      return { decision: "COMMIT", reason: "ACTION_PUBLISHED" };
    }
    const window = await db.actionWindow.findUnique({ where: { nodeId: action.nodeId } });
    if (window?.status === "RESOLVED") return { decision: "COMMIT", reason: "WINDOW_FINALIZED" };
    const relatedTask = await db.storyTaskOutbox.findFirst({
      where: resolution?.id
        ? { runId: action.runId, inputRefId: resolution.id, taskType: "ACTOR_RESULT_V2" }
        : window?.id
          ? { runId: action.runId, windowId: window.id, taskType: "RESOLVE_WINDOW" }
          : { runId: action.runId, nodeId: action.nodeId, taskType: { in: ["ACTOR_RESULT_V2", "RESOLVE_WINDOW"] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, status: true, attempt: true, maxAttempts: true, leaseExpiresAt: true, nextRetryAt: true }
    });
    const taskStatus = String(relatedTask?.status || "").toUpperCase();
    // A PENDING task or an expired RUNNING lease is still recoverable by the
    // worker's compare-and-swap reclaim path. Releasing here would let the
    // replacement worker publish an already-refunded action.
    if (relatedTask && ["PENDING", "RUNNING"].includes(taskStatus) && Number(relatedTask.attempt || 0) <= Number(relatedTask.maxAttempts || 0)) {
      return { decision: "KEEP", reason: taskStatus === "RUNNING" && relatedTask.leaseExpiresAt && new Date(relatedTask.leaseExpiresAt) <= now ? "OUTBOX_LEASE_RECLAIMABLE" : "OUTBOX_ACTIVE" };
    }
    if (relatedTask && taskStatus === "FAILED") {
      return { decision: "RELEASE", reason: Number(relatedTask.attempt || 0) >= Number(relatedTask.maxAttempts || 0) ? "GENERATION_RETRY_EXHAUSTED" : "GENERATION_TERMINAL_FAILURE" };
    }
    const activeSoloAttempt = await db.soloGenerationAttempt.findFirst({
      where: { submission: { playerActionId: action.id }, status: { in: ["ACTION_RESERVED", "GENERATING", "FAILED_RETRYABLE", "SUCCEEDED"] } },
      select: { id: true, status: true, leaseExpiresAt: true, updatedAt: true }
    });
    const soloRecoveryTask = activeSoloAttempt?.id
      ? await db.storyTaskOutbox.findFirst({
          where: { runId: action.runId, inputRefId: activeSoloAttempt.id, taskType: "SOLO_PUBLISH_RECOVERY_V1" },
          orderBy: { updatedAt: "desc" },
          select: { status: true, attempt: true, maxAttempts: true }
        })
      : null;
    const soloRecoveryStatus = String(soloRecoveryTask?.status || "").toUpperCase();
    if (soloRecoveryTask && ["PENDING", "RUNNING"].includes(soloRecoveryStatus) && Number(soloRecoveryTask.attempt || 0) <= Number(soloRecoveryTask.maxAttempts || 0)) {
      return { decision: "KEEP", reason: "SOLO_PUBLISH_RECOVERABLE" };
    }
    if (soloRecoveryTask && soloRecoveryStatus === "FAILED") {
      return { decision: "RELEASE", reason: "SOLO_PUBLISH_FAILED" };
    }
    const soloHasLiveLease = activeSoloAttempt?.leaseExpiresAt && new Date(activeSoloAttempt.leaseExpiresAt) > now;
    const soloRecentlyRecoverable = activeSoloAttempt?.updatedAt && new Date(activeSoloAttempt.updatedAt) > recoveryCutoff;
    if (activeSoloAttempt && (soloHasLiveLease || soloRecentlyRecoverable)) {
      return { decision: "KEEP", reason: "SOLO_GENERATION_RECOVERABLE" };
    }
    if (action.status === "rejected") return { decision: "RELEASE", reason: "ACTION_REJECTED" };
    if (!run || ["completed", "chapter_generated", "closed", "expired", "failed", "cancelled", "creation_failed"].includes(String(run.status))) {
      return { decision: "RELEASE", reason: "RUN_TERMINAL_WITHOUT_PUBLICATION" };
    }
    return { decision: "RELEASE", reason: "STALE_RESERVATION_WITHOUT_ACTIVE_WORK" };
  }
}

function boundedInterval(value: string | undefined) {
  const parsed = Number(value || 60_000);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(3_600_000, Math.floor(parsed))) : 60_000;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
