import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { StoryService } from "./story.service";

const LEASE_MS = 30_000;
const POLL_MS = 250;

@Injectable()
export class StoryTaskOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoryTaskOutboxService.name);
  private readonly workerId = `api-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StoryService) private readonly story: StoryService
  ) {}

  onModuleInit() {
    // The normal API process also runs a worker so a local `pnpm dev:api` has
    // a complete flow. A dedicated worker process may run concurrently; leases
    // keep the command safe in that deployment topology.
    if (process.env.STORY_WORKER_ENABLED !== "true") return;
    // A transient pool/network error must not become an unhandled rejection
    // that terminates the API process. The next poll retries naturally.
    this.timer = setInterval(() => {
      void this.drainOne().catch((error) => {
        this.logger.warn("Story task poll failed and will retry: " + String(error));
      });
    }, POLL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueueResolve(runId: string, nodeId: string) {
    const task = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.storyTaskOutbox.findUnique({ where: { nodeId } });
      if (existing) return existing;
      await tx.storyRun.updateMany({ where: { id: runId, status: "playing" }, data: { status: "resolving", version: { increment: 1 } } });
      return tx.storyTaskOutbox.create({ data: { runId, nodeId, taskType: "resolve_node", status: "pending" } });
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
    return { workerId: this.workerId, enabled: process.env.STORY_WORKER_ENABLED === "true", pending, running, oldestAgeMs: oldest ? Date.now() - oldest.createdAt.getTime() : 0 };
  }

  async drainOne() {
    if (this.draining) return;
    this.draining = true;
    try {
      const now = new Date();
      await this.prisma.storyTaskOutbox.updateMany({
        where: { status: "running", leaseExpiresAt: { lt: now } },
        data: { status: "pending", leaseOwner: null, leaseExpiresAt: null, nextRetryAt: now }
      });
      const task = await this.prisma.storyTaskOutbox.findFirst({ where: { status: "pending", nextRetryAt: { lte: now } }, orderBy: { createdAt: "asc" } });
      if (!task) return;
      const claimed = await this.prisma.storyTaskOutbox.updateMany({
        where: { id: task.id, status: "pending", nextRetryAt: { lte: now } },
        data: { status: "running", leaseOwner: this.workerId, leaseExpiresAt: new Date(Date.now() + LEASE_MS), startedAt: now, attempt: { increment: 1 } }
      });
      if (claimed.count !== 1) return;
      await this.process(task.id);
    } finally {
      this.draining = false;
    }
  }

  private async process(taskId: string) {
    const task = await this.prisma.storyTaskOutbox.findUnique({ where: { id: taskId } });
    if (!task || task.status !== "running" || task.leaseOwner !== this.workerId) return;
    // An AI request can legitimately take longer than the initial lease. Keep
    // the claim alive while this worker is still executing it so another
    // process cannot reclaim the task and apply the same resolution twice.
    const heartbeat = setInterval(() => {
      void this.prisma.storyTaskOutbox
        .updateMany({
          where: { id: task.id, status: "running", leaseOwner: this.workerId },
          data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) }
        })
        .catch((error) => this.logger.warn(`Failed to renew story-task lease ${task.id}: ${String(error)}`));
    }, Math.max(1_000, Math.floor(LEASE_MS / 3)));
    heartbeat.unref?.();
    try {
      const testDelayMs = Math.max(0, Math.min(120_000, Number(process.env.STORY_TASK_TEST_DELAY_MS || 0)));
      // Test-only fault injection: it creates a window after the durable lease
      // is claimed so recovery can be exercised by terminating the worker.
      if (process.env.NODE_ENV !== "production" && testDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, testDelayMs));
      }
      const resolution = await this.story.resolveNode(task.nodeId);
      await this.prisma.storyTaskOutbox.updateMany({
        where: { id: task.id, status: "running", leaseOwner: this.workerId },
        data: { status: "completed", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, resultJson: resolution as object, lastError: null }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = task.attempt + 1 >= task.maxAttempts;
      const delayMs = Math.min(30_000, 500 * 2 ** task.attempt);
      await this.prisma.storyTaskOutbox.updateMany({
        where: { id: task.id, status: "running", leaseOwner: this.workerId },
        data: exhausted
          ? { status: "failed", leaseOwner: null, leaseExpiresAt: null, lastError: message }
          : { status: "pending", leaseOwner: null, leaseExpiresAt: null, nextRetryAt: new Date(Date.now() + delayMs), lastError: message }
      });
      if (exhausted) await this.prisma.storyRun.updateMany({ where: { id: task.runId, status: "resolving" }, data: { status: "playing" } });
      this.logger.warn(`Story task ${task.id} attempt ${task.attempt + 1} failed: ${message}`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private project(task: { id: string; runId: string; nodeId: string; taskType: string; status: string; attempt: number; maxAttempts: number; nextRetryAt: Date; createdAt: Date; updatedAt: Date; completedAt: Date | null; lastError: string | null }) {
    return { taskId: task.id, runId: task.runId, nodeId: task.nodeId, taskType: task.taskType, status: task.status, attempt: task.attempt, maxAttempts: task.maxAttempts, nextRetryAt: task.nextRetryAt, completedAt: task.completedAt, lastError: task.lastError, createdAt: task.createdAt, updatedAt: task.updatedAt };
  }
}
