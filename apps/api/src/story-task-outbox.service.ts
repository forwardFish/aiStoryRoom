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

const LEASE_MS = normalizeStoryTaskLeaseMs(process.env.STORY_TASK_LEASE_MS);
const POLL_MS = 250;
export const ROLE_AGENT_TASK_CONCURRENCY = 3;

export { normalizeStoryTaskLeaseMs } from "./config/continuous-strategy.config";

export function requiresOutboxHeartbeat(taskType: string) {
  return taskType !== "RESOLVE_WINDOW";
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
    @Inject(RoleAgentTaskService) private readonly roleAgents: RoleAgentTaskService
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
      this.prisma.storyTaskOutbox.count({ where: { status: "pending" } }),
      this.prisma.storyTaskOutbox.count({ where: { status: "running" } }),
      this.prisma.storyTaskOutbox.findFirst({ where: { status: { in: ["pending", "running"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })
    ]);
    return { workerId: this.workerId, enabled: readContinuousStrategyConfig().workerEmbedded || process.env.STORY_WORKER_PROCESS === "true", topology: process.env.STORY_WORKER_PROCESS === "true" ? "independent" : "embedded", leaseMs: LEASE_MS, pending, running, oldestAgeMs: oldest ? Date.now() - oldest.createdAt.getTime() : 0 };
  }

  async drainOne() {
    return this.drainReadyTasks(1);
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
      const first = await this.prisma.storyTaskOutbox.findFirst({ where: { status: "pending", nextRetryAt: { lte: now } }, orderBy: { createdAt: "asc" } });
      if (!first) return;
      const limit = Math.max(1, Math.min(ROLE_AGENT_TASK_CONCURRENCY, Math.trunc(roleAgentConcurrency || 1)));
      // Provider waits must not serialize the three playable roles. Keep every
      // non-Agent task single-file so resolution ordering and legacy behavior
      // remain unchanged.
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
        : [first];
      const claimedTaskIds: string[] = [];
      for (const candidate of candidates) {
        const claimed = await this.prisma.storyTaskOutbox.updateMany({
          where: { id: candidate.id, status: "pending", nextRetryAt: { lte: now } },
          data: { status: "running", leaseOwner: this.workerId, leaseExpiresAt: new Date(Date.now() + LEASE_MS), startedAt: now, attempt: { increment: 1 }, leaseVersion: { increment: 1 } }
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
    if (!task || task.status !== "running" || task.leaseOwner !== this.workerId || !task.leaseExpiresAt || task.leaseExpiresAt.getTime() <= Date.now()) return;
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
            status: "running",
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
      const resolution = task.taskType === "RESOLVE_WINDOW"
        ? await this.continuousResolution.resolve(String(task.windowId), fence)
        : task.taskType === "ROLE_AGENT_DECISION"
          ? await this.roleAgents.execute(task.id, fence)
          : await this.story.resolveNode(task.nodeId);
      const completed = await this.prisma.storyTaskOutbox.updateMany({
        where: {
          id: task.id,
          status: "running",
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        },
        data: { status: "completed", outcome: (resolution as any)?.outcome || "COMPLETED", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, resultJson: resolution as object, lastError: null }
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
      const exhausted = task.attempt >= task.maxAttempts;
      const delayMs = Math.min(30_000, 500 * 2 ** Math.max(0, task.attempt - 1));
      const recorded = await this.prisma.storyTaskOutbox.updateMany({
        where: {
          id: task.id,
          status: "running",
          leaseOwner: fence.leaseOwner,
          leaseVersion: fence.leaseVersion,
          leaseExpiresAt: { gt: new Date() }
        },
        data: exhausted
          ? { status: "failed", leaseOwner: null, leaseExpiresAt: null, lastError: message }
          : { status: "pending", leaseOwner: null, leaseExpiresAt: null, nextRetryAt: new Date(Date.now() + delayMs), lastError: message }
      });
      if (recorded.count !== 1) {
        this.logger.warn(`Story task ${task.id} lost lease ${fence.leaseVersion}; failure suppressed`);
        return;
      }
      if (exhausted && task.taskType === "resolve_node") await this.prisma.storyRun.updateMany({ where: { id: task.runId, status: "resolving" }, data: { status: "playing" } });
      this.logger.warn(`Story task ${task.id} attempt ${task.attempt} failed: ${message}`);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
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
