import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { readContinuousStrategyConfig } from "../config/continuous-strategy.config";
import { StoryTaskOutboxService } from "../story-task-outbox.service";
import { B0SettlementPipelineService } from "./b0-settlement-pipeline.service";

const B0_TASK_TYPES = new Set([
  "B0_SETTLEMENT_REQUESTED",
  "B0_PUBLISH_STRUCTURED_RESULTS",
  "B0_NARRATIVE_GENERATION",
  "B0_WINDOW_EVENT",
]);

type OutboxTask = {
  id: string;
  nodeId: string;
  windowId: string | null;
  taskType: string;
};

type OutboxFence = {
  taskId: string;
  leaseOwner: string;
  leaseVersion: number;
};

type ExecuteTask = (task: OutboxTask, fence: OutboxFence) => Promise<unknown>;

/**
 * Connects B0 task vocabulary to the repository's existing leased
 * StoryTaskOutbox worker without introducing another queue or process type.
 * Both the embedded API worker and worker.ts load this provider through the
 * same AppModule, so they share the same Supabase-backed leases and retries.
 */
@Injectable()
export class B0OutboxBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(B0OutboxBridgeService.name);
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private originalExecuteTask?: ExecuteTask;

  constructor(
    @Inject(StoryTaskOutboxService) private readonly outbox: StoryTaskOutboxService,
    @Inject(B0SettlementPipelineService) private readonly pipeline: B0SettlementPipelineService,
  ) {}

  onModuleInit(): void {
    const worker = this.outbox as unknown as { executeTask: ExecuteTask };
    const current = worker.executeTask.bind(this.outbox);
    this.originalExecuteTask = current;
    worker.executeTask = async (task, fence) => {
      if (!B0_TASK_TYPES.has(task.taskType)) return current(task, fence);
      try {
        switch (task.taskType) {
          case "B0_SETTLEMENT_REQUESTED":
            return await this.pipeline.executeSettlementTask(task.id, fence);
          case "B0_PUBLISH_STRUCTURED_RESULTS":
            return await this.pipeline.executePublicationTask(task.id, fence);
          case "B0_NARRATIVE_GENERATION":
            return await this.pipeline.executeNarrativeTask(task.id, fence);
          case "B0_WINDOW_EVENT":
            return await this.pipeline.executeWindowEventTask(task.id, fence);
          default:
            throw new Error(`UNKNOWN_B0_TASK_TYPE:${task.taskType}`);
        }
      } catch (error) {
        await this.pipeline.failTask(
          task.id,
          error instanceof Error ? error.message : String(error),
        ).catch((failure) => {
          this.logger.error(`Failed to record B0 task failure ${task.id}: ${String(failure)}`);
        });
        throw error;
      }
    };

    const config = readContinuousStrategyConfig();
    if (!config.workerEmbedded && process.env.STORY_WORKER_PROCESS !== "true") return;
    const intervalMs = boundedInterval(process.env.B0_RECOVERY_POLL_MS);
    this.recoveryTimer = setInterval(() => {
      void this.pipeline.recover().catch((error) => {
        this.logger.warn(`B0 deadline recovery failed: ${String(error)}`);
      });
    }, intervalMs);
    if (process.env.STORY_WORKER_PROCESS !== "true") this.recoveryTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    if (!this.originalExecuteTask) return;
    const worker = this.outbox as unknown as { executeTask: ExecuteTask };
    worker.executeTask = this.originalExecuteTask;
  }
}

function boundedInterval(raw: unknown): number {
  const value = Number(raw ?? 1_000);
  if (!Number.isFinite(value)) return 1_000;
  return Math.max(500, Math.min(30_000, Math.trunc(value)));
}
