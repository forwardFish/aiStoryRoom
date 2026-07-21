import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { StoryService } from "./story.service";
import {
  isInjectedCheckpointExit,
  maybeInjectRoleAgentFault,
  normalizeStoryTaskLeaseMs,
  readContinuousStrategyConfig
} from "./config/continuous-strategy.config";
import { WindowLifecycleService } from "./continuous-strategy/window-lifecycle.service";
import { WindowResolutionService } from "./continuous-strategy/window-resolution.service";
import { RoleAgentTaskService } from "./continuous-strategy/role-agent-task.service";
import { ContinuousStoryV2Service } from "./continuous-story-v2/continuous-story-v2.service";
import { readCreditConsumptionConfig } from "./config/credit-consumption.config";
import { SoloStoryEngineService } from "./solo-story-engine/solo-story-engine.service";

const LEASE_MS = normalizeStoryTaskLeaseMs(process.env.STORY_TASK_LEASE_MS);
const POLL_MS = 250;
export const ROLE_AGENT_TASK_CONCURRENCY = 3;

export { normalizeStoryTaskLeaseMs } from "./config/continuous-strategy.config";

export function requiresOutboxHeartbeat(taskType: string) {
  return taskType !== "RESOLVE_WINDOW";
}

const V2_TASK_TYPES = ["ACTOR_OPENING_V2", "ACTOR_AGENT_TURN_V2", "ACTOR_RESULT_V2", "ACTOR_IMPACT_V2", "CONDITIONAL_ACTION_V2", "SOLO_AI_WORLD_TICK_V1", "SOLO_PUBLISH_RECOVERY_V1"];
function isV2Task(taskType: string) { return V2_TASK_TYPES.includes(taskType); }
function pendingStatus(taskType: string) { return isV2Task(taskType) ? "PENDING" : "pending"; }
function runningStatus(taskType: string) { return isV2Task(taskType) ? "RUNNING" : "running"; }
function completedStatus(taskType: string) { return isV2Task(taskType) ? "COMPLETED" : "completed"; }
function failedStatus(taskType: string) { return isV2Task(taskType) ? "FAILED" : "failed"; }

const NON_RETRYABLE_STORY_GENERATION_CODES = new Set([
  "STORY_GENERATION_REJECTED",
  "OPENING_STORY_GENERATION_REJECTED"
]);

/**
 * Publication-gate failures are deterministic for the same context and model
 * output. Re-enqueuing the identical actor action only pays for the same full
 * generation again and can keep the player on RESOLVING for minutes. Only
 * transient provider/transport failures are allowed to use the outbox retry
 * budget; a quality rejection must stop after its first execution.
 */
export function isNonRetryableStoryTaskError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const getResponse = (error as { getResponse?: unknown }).getResponse;
  if (typeof getResponse !== "function") return false;
  const response = (getResponse as () => unknown).call(error);
  if (!response || typeof response !== "object") return false;
  const payload = response as { code?: unknown; recoverable?: unknown };
  const code = typeof payload.code === "string" ? payload.code : "";
  return NON_RETRYABLE_STORY_GENERATION_CODES.has(code) && payload.recoverable === false;
}

@Injectable()
export class StoryTaskOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoryTaskOutboxService.name);
  private readonly workerId = `api-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private draining = false;
  private pollFailures = 0;
  private retryAfterMs = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StoryService) private readonly story: StoryService,
    @Inject(WindowLifecycleService) private readonly lifecycle: WindowLifecycleService,
    @Inject(WindowResolutionService) private readonly continuousResolution: WindowResolutionService,
    @Inject(RoleAgentTaskService) private readonly roleAgents: RoleAgentTaskService,
    @Inject(ContinuousStoryV2Service) private readonly continuousStoryV2: ContinuousStoryV2Service,
    @Inject(SoloStoryEngineService) private readonly soloStoryEngine: SoloStoryEngineService
  ) {}

  onModuleInit() {
    // The normal API process also runs a worker so a local `pnpm dev:api` has
    // a complete flow. A dedicated worker process may run concurrently; leases
    // keep the command safe in that deployment topology.
    if (!readContinuousStrategyConfig().workerEmbedded && process.env.STORY_WORKER_PROCESS !== "true") return;
    // A transient pool/network error must not become an unhandled rejection
    // that terminates the API process. The next poll retries naturally.
    this.timer = setInterval(() => {
      // Supabase round trips can take longer than POLL_MS.  Fence the complete
      // sweep+drain cycle so interval ticks cannot accumulate concurrent
      // lifecycle scans and exhaust a small, deliberately bounded pool.
      if (this.polling || Date.now() < this.retryAfterMs) return;
      this.polling = true;
      void this.lifecycle.sweep()
        .then(() => this.recoverTerminalV2Result())
        .then(() => this.drainReadyTasks())
        .then(() => { this.pollFailures = 0; this.retryAfterMs = 0; })
        .catch((error) => {
          this.pollFailures = Math.min(this.pollFailures + 1, 6);
          const delayMs = Math.min(15_000, 500 * 2 ** this.pollFailures);
          this.retryAfterMs = Date.now() + delayMs;
          this.logger.warn(`Story task poll failed; retrying in ${delayMs}ms: ${String(error)}`);
        })
        .finally(() => { this.polling = false; });
    }, POLL_MS);
    // The HTTP server itself keeps an embedded worker alive, so its poll timer
    // may be unreferenced.  A dedicated worker has no HTTP listener; unref'ing
    // its only timer would let Node exit immediately after bootstrap.
    if (process.env.STORY_WORKER_PROCESS !== "true") this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueueResolve(runId: string, nodeId: string) {
    const dedupeKey = `RESOLVE_LEGACY:${nodeId}`;
    const task = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.storyTaskOutbox.findUnique({ where: { dedupeKey } });
      if (existing) return existing;
      await tx.storyRun.updateMany({ where: { id: runId, status: "playing" }, data: { status: "resolving", version: { increment: 1 } } });
      return tx.storyTaskOutbox.create({ data: { runId, nodeId, dedupeKey, taskType: "resolve_node", status: "pending" } });
    });
    return this.project(task);
  }

  async get(taskId: string) {
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId } });
    return task ? this.project(task) : null;
  }

  async health() {
    const [pending, running, oldest] = await Promise.all([
      this.prisma.storyTaskOutbox.count({ where: { status: { in: ["pending", "PENDING"] } } }),
      this.prisma.storyTaskOutbox.count({ where: { status: { in: ["running", "RUNNING"] } } }),
      this.prisma.storyTaskOutbox.findFirst({ where: { status: { in: ["pending", "PENDING", "running", "RUNNING"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })
    ]);
    return { workerId: this.workerId, enabled: readContinuousStrategyConfig().workerEmbedded || process.env.STORY_WORKER_PROCESS === "true", topology: process.env.STORY_WORKER_PROCESS === "true" ? "independent" : "embedded", leaseMs: LEASE_MS, pending, running, oldestAgeMs: oldest ? Date.now() - oldest.createdAt.getTime() : 0 };
  }

  async drainOne() {
    return this.drainReadyTasks(1);
  }

  async recoverTerminalV2Result() {
    // A terminal ACTOR_RESULT_V2 task is not fully compensated until its
    // reserved positive world sequence has been compacted. The immediate
    // compensation can lose a race for a small database pool after a long
    // provider call, so every worker sweep repairs one durable terminal task
    // before claiming more continuation work.
    const strandedResult = await this.prisma.storyTaskOutbox.findFirst({
      where: {
        taskType: "ACTOR_RESULT_V2",
        status: "FAILED",
        outcome: null,
        inputRefId: { not: null }
      },
      orderBy: { updatedAt: "asc" },
      select: { id: true }
    });
    if (!strandedResult) return { recovered: false };
    const result = await this.continuousStoryV2.failReservedResultTask(strandedResult.id, "TERMINAL_RESULT_RECOVERY");
    return { recovered: true, taskId: strandedResult.id, result };
  }

  async drainReadyTasks(roleAgentConcurrency = ROLE_AGENT_TASK_CONCURRENCY) {
    if (this.draining) return;
    this.draining = true;
    try {
      const now = new Date();
      await this.prisma.storyTaskOutbox.updateMany({
        where: { status: "running", leaseExpiresAt: { lt: now } },
        data: { status: "pending", leaseOwner: null, leaseExpiresAt: null, nextRetryAt: now, leaseVersion: { increment: 1 } }
      });
      await this.prisma.storyTaskOutbox.updateMany({
        where: { status: "RUNNING", taskType: { in: V2_TASK_TYPES }, leaseExpiresAt: { lt: now } },
        data: { status: "PENDING", leaseOwner: null, leaseExpiresAt: null, nextRetryAt: now, leaseVersion: { increment: 1 } }
      });
      // Independent V2 actor turns are player-facing continuation work. Do not
      // let an unrelated backlog of legacy shared-window tasks become a hidden
      // room-wide barrier for a role that is ready to keep moving.
      const firstV2Task = await this.prisma.storyTaskOutbox.findFirst({
        where: {
          status: "PENDING",
          taskType: { in: V2_TASK_TYPES },
          nextRetryAt: { lte: now }
        },
        orderBy: { createdAt: "asc" }
      });
      const first = firstV2Task || await this.prisma.storyTaskOutbox.findFirst({
        where: {
          nextRetryAt: { lte: now },
          OR: [{ status: "pending" }, { status: "PENDING", taskType: { in: V2_TASK_TYPES } }]
        },
        orderBy: { createdAt: "asc" }
      });
      if (!first) return;
      const creditConfig = readCreditConsumptionConfig();
      const requestedLimit = Math.max(1, Math.trunc(roleAgentConcurrency || 1));
      const limit = creditConfig.aiBatchingEnabled
        ? Math.min(creditConfig.aiBatchMaxSize, Math.max(ROLE_AGENT_TASK_CONCURRENCY, requestedLimit))
        : Math.min(ROLE_AGENT_TASK_CONCURRENCY, requestedLimit);
      // Provider selection may overlap and batch. V2 still commits each
      // ActorTurn through its fenced worldSequence transaction, so concurrent
      // selection never turns into a shared publication barrier.
      const candidates = first.taskType === "ROLE_AGENT_DECISION" && limit > 1
        ? await this.prisma.storyTaskOutbox.findMany({
            where: {
              status: "pending",
              nextRetryAt: { lte: now },
              taskType: "ROLE_AGENT_DECISION",
              runId: first.runId,
              windowId: first.windowId,
              actionSlot: first.actionSlot,
              controlEpoch: first.controlEpoch
            },
            orderBy: { createdAt: "asc" },
            take: limit
          })
        : first.taskType === "ACTOR_AGENT_TURN_V2" && creditConfig.aiBatchingEnabled && limit > 1
          ? await this.prisma.storyTaskOutbox.findMany({
              where: {
                status: "PENDING",
                nextRetryAt: { lte: now },
                taskType: "ACTOR_AGENT_TURN_V2",
                runId: first.runId
              },
              orderBy: { createdAt: "asc" },
              take: limit
            })
        : [first];
      const claimedTaskIds: string[] = [];
      for (const candidate of candidates) {
        const candidatePending = pendingStatus(candidate.taskType);
        const candidateRunning = runningStatus(candidate.taskType);
        const claimed = await this.prisma.storyTaskOutbox.updateMany({
          where: { id: candidate.id, status: candidatePending, nextRetryAt: { lte: now } },
          data: { status: candidateRunning, leaseOwner: this.workerId, leaseExpiresAt: new Date(Date.now() + LEASE_MS), startedAt: now, attempt: { increment: 1 }, leaseVersion: { increment: 1 } }
        });
        if (claimed.count === 1) claimedTaskIds.push(candidate.id);
      }
      await Promise.all(claimedTaskIds.map((taskId) => this.process(taskId)));
    } finally {
      this.draining = false;
    }
  }

  private async process(taskId: string) {
    // The post-claim read is authoritative: attempt and leaseVersion were both
    // incremented by the claim CAS, so the pre-claim candidate must never be
    // used for retries, renewal, completion, or failure.
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId } });
    if (!task || task.status !== runningStatus(task.taskType) || task.leaseOwner !== this.workerId || !task.leaseExpiresAt || task.leaseExpiresAt.getTime() <= Date.now()) return;
    const activeStatus = runningStatus(task.taskType);
    const fence = { taskId: task.id, leaseOwner: this.workerId, leaseVersion: task.leaseVersion };
    let leaseLost = false;

    // Role-Agent/provider and legacy tasks need an outer heartbeat while they
    // execute outside a transaction. RESOLVE_WINDOW renews and fences the task
    // inside every checkpoint transaction; a second writer on that same row
    // would create avoidable Supabase write conflicts.
    const heartbeat = requiresOutboxHeartbeat(task.taskType) ? setInterval(() => {
      void this.prisma.storyTaskOutbox
        .updateMany({
          where: {
            id: task.id,
            status: activeStatus,
            leaseOwner: fence.leaseOwner,
            leaseVersion: fence.leaseVersion,
            leaseExpiresAt: { gt: new Date() }
          },
          data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) }
        })
        .then((renewed) => {
          if (renewed.count !== 1) leaseLost = true;
        })
        .catch((error) => this.logger.warn(`Failed to renew story-task lease ${task.id}: ${String(error)}`));
    }, Math.max(1_000, Math.floor(LEASE_MS / 3))) : undefined;
    heartbeat?.unref?.();
    try {
      if (task.taskType === "ROLE_AGENT_DECISION") maybeInjectRoleAgentFault("TASK_LEASED", task.id);
      const testDelayMs = Math.max(0, Math.min(120_000, Number(process.env.STORY_TASK_TEST_DELAY_MS || 0)));
      // Test-only delay: it creates a window after the durable lease is
      // claimed so recovery can be exercised by terminating the worker.
      if (process.env.NODE_ENV !== "production" && testDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, testDelayMs));
      }
      if (leaseLost) {
        this.logger.warn(`Story task ${task.id} lost lease ${fence.leaseVersion}; suppressing execution`);
        return;
      }
      const resolution = await this.executeTask(task, fence);
      if ((resolution as any)?.outcome === "LEASE_LOST") {
        leaseLost = true;
        this.logger.warn(`Story task ${task.id} lost lease ${fence.leaseVersion}; completion suppressed`);
        return;
      }
      const completed = await this.prisma.storyTaskOutbox.updateMany({
        where: {
          id: task.id,
          status: activeStatus,
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        },
        data: { status: completedStatus(task.taskType), outcome: (resolution as any)?.outcome || "COMPLETED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, resultJson: resolution as object, lastError: null }
      });
      if (completed.count !== 1) {
        leaseLost = true;
        this.logger.warn(`Story task ${task.id} lost lease ${fence.leaseVersion}; completion suppressed`);
      }
    } catch (error) {
      if (isInjectedCheckpointExit(error)) {
        // Deliberately leave the leased task untouched. A replacement worker
        // can reclaim it after expiry and resume from the committed boundary.
        this.handleInjectedCheckpointExit(task.id, error);
        return;
      }
      if (leaseLost) {
        this.logger.warn(`Story task ${task.id} lost lease ${fence.leaseVersion}; failure suppressed`);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      // attempt is already incremented by the successful claim and was read
      // again above. Exhaust exactly on maxAttempts, not one attempt early.
      const nonRetryable = isNonRetryableStoryTaskError(error);
      const exhausted = nonRetryable || task.attempt >= task.maxAttempts;
      const delayMs = Math.min(30_000, 500 * 2 ** Math.max(0, task.attempt - 1));
      const recorded = await this.prisma.storyTaskOutbox.updateMany({
        where: {
          id: task.id,
          status: activeStatus,
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        },
        data: exhausted
          ? { status: failedStatus(task.taskType), leaseOwner: null, leaseExpiresAt: null, lastError: message }
          : { status: pendingStatus(task.taskType), leaseOwner: null, leaseExpiresAt: null, nextRetryAt: new Date(Date.now() + delayMs), lastError: message }
      });
      if (recorded.count !== 1) {
        this.logger.warn(`Story task ${task.id} lost lease ${fence.leaseVersion}; failure suppressed`);
        return;
      }
      if (exhausted && task.taskType === "resolve_node") await this.prisma.storyRun.updateMany({ where: { id: task.runId, status: "resolving" }, data: { status: "playing" } });
      if (exhausted && task.taskType === "ACTOR_RESULT_V2") {
        try {
          await this.continuousStoryV2.failReservedResultTask(task.id, nonRetryable ? "QUALITY_REJECTED" : "GENERATION_RETRY_EXHAUSTED");
        } catch (releaseError) {
          this.logger.error(`Failed to release terminal V2 credit reservation for task ${task.id}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
        }
      }
      if (exhausted && task.taskType === "RESOLVE_WINDOW" && task.windowId) {
        try {
          await this.continuousResolution.releaseWindowCharges(String(task.windowId), nonRetryable ? "WINDOW_RESOLUTION_REJECTED" : "WINDOW_RESOLUTION_RETRY_EXHAUSTED");
        } catch (releaseError) {
          this.logger.error(`Failed to release terminal window credit reservations for task ${task.id}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
        }
      }
      if (exhausted && task.taskType === "SOLO_PUBLISH_RECOVERY_V1") {
        try {
          await this.soloStoryEngine.failPublishRecoveryTask(task.id, nonRetryable ? "SOLO_PUBLISH_REJECTED" : "SOLO_PUBLISH_RETRY_EXHAUSTED");
        } catch (releaseError) {
          this.logger.error(`Failed to compensate terminal Solo publish recovery ${task.id}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
        }
      }
      this.logger.warn(`Story task ${task.id} attempt ${task.attempt} failed${nonRetryable ? " without automatic retry" : ""}: ${message}`);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  private async executeTask(task: { id: string; nodeId: string; windowId: string | null; taskType: string }, fence: { taskId: string; leaseOwner: string; leaseVersion: number }) {
    switch (task.taskType) {
      case "RESOLVE_WINDOW":
        return this.continuousResolution.resolve(String(task.windowId), fence);
      case "ROLE_AGENT_DECISION":
        return this.roleAgents.execute(task.id, fence);
      case "ACTOR_OPENING_V2":
        return this.continuousStoryV2.executeOpeningTask(task.id, fence);
      case "ACTOR_AGENT_TURN_V2":
        return this.continuousStoryV2.executeAgentTask(task.id, fence);
      case "ACTOR_RESULT_V2":
        return this.continuousStoryV2.executeResultTask(task.id, fence);
      case "ACTOR_IMPACT_V2":
        return this.continuousStoryV2.executeImpactTask(task.id, fence);
      case "CONDITIONAL_ACTION_V2":
        return this.continuousStoryV2.executeConditionalTask(task.id, fence);
      case "SOLO_AI_WORLD_TICK_V1":
        return this.soloStoryEngine.executeAiWorldTickTask(task.id, fence);
      case "SOLO_PUBLISH_RECOVERY_V1":
        return this.soloStoryEngine.executePublishRecoveryTask(task.id, fence);
      case "resolve_node":
        return this.story.resolveNode(task.nodeId);
      default:
        // Never interpret a future task vocabulary as a legacy node
        // resolution. During rolling deploys that would corrupt an independent
        // actor thread by creating a shared DirectorResolution.
        throw new Error(`UNKNOWN_STORY_TASK_TYPE:${task.taskType}`);
    }
  }

  private handleInjectedCheckpointExit(taskId: string, error: Error & { exitCode?: number }) {
    const exitCode = Number.isInteger(error.exitCode) ? Number(error.exitCode) : 86;
    this.logger.error(`Story task ${taskId} reached injected checkpoint; leaving lease intact and exiting with code ${exitCode}`);
    if (process.env.STORY_WORKER_PROCESS !== "true") return;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    process.exitCode = exitCode;
    setImmediate(() => process.exit(exitCode));
  }
  private project(task: { id: string; runId: string; nodeId: string; taskType: string; status: string; attempt: number; maxAttempts: number; nextRetryAt: Date; createdAt: Date; updatedAt: Date; completedAt: Date | null; lastError: string | null }) {
    return { taskId: task.id, runId: task.runId, nodeId: task.nodeId, taskType: task.taskType, status: task.status, attempt: task.attempt, maxAttempts: task.maxAttempts, nextRetryAt: task.nextRetryAt, completedAt: task.completedAt, lastError: task.lastError, createdAt: task.createdAt, updatedAt: task.updatedAt };
  }
}
