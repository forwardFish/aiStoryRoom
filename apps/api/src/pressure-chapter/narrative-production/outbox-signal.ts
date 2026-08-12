import { isSha256 } from "@ai-story/shared";
import type {
  NarrativeOutboxClockPortV1,
} from "../narrative";
import { NarrativeOutboxConsumerV1 } from "../narrative";
import type { NarrativeOutboxSignalPort } from "../terminal-commit";
import {
  PRESSURE_NARRATIVE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureNarrativeProduction,
} from "./errors";

export interface PressureNarrativeInProcessWorkerOptionsV1 {
  workerId?: string;
  maxBatchSize?: number;
  infrastructureRetryMs?: number;
  onBackgroundError?: (error: unknown) => void;
}

/**
 * Best-effort process wake-up over a durable, fenced Prisma outbox.
 *
 * A lost process wake-up cannot lose work: start() drains persisted rows again
 * after every process restart, while each consumer claim remains lease/fence
 * protected by PrismaNarrativeOutboxRepository.
 */
export class PressureNarrativeInProcessWorkerV1 {
  readonly workerId: string;
  private readonly maxBatchSize: number;
  private readonly infrastructureRetryMs: number;
  private readonly onBackgroundError: (error: unknown) => void;
  private scheduled = false;
  private stopped = true;
  private wakeRequested = false;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly consumer: NarrativeOutboxConsumerV1,
    private readonly clock: NarrativeOutboxClockPortV1,
    options: PressureNarrativeInProcessWorkerOptionsV1 = {},
  ) {
    this.workerId = options.workerId ?? `pressure-narrative:${process.pid}`;
    this.maxBatchSize = options.maxBatchSize ?? 64;
    this.infrastructureRetryMs = options.infrastructureRetryMs ?? 5_000;
    this.onBackgroundError = options.onBackgroundError ?? (() => undefined);
    nonEmpty(this.workerId, "worker.workerId");
    positiveInteger(this.maxBatchSize, "worker.maxBatchSize");
    nonNegativeInteger(this.infrastructureRetryMs, "worker.infrastructureRetryMs");
  }

  start(): void {
    this.stopped = false;
    this.wake();
  }

  stop(): void {
    this.stopped = true;
    this.wakeRequested = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  wake(): void {
    if (this.stopped) return;
    this.wakeRequested = true;
    if (this.scheduled || this.running !== null) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.drainUntilQuiescent().catch((error) => {
        this.onBackgroundError(error);
      });
    });
  }

  /** Exposed for a process worker/health harness and deterministic tests. */
  drainUntilQuiescent(): Promise<void> {
    if (this.running !== null) {
      this.wakeRequested = true;
      return this.running;
    }
    this.running = this.drainLoop().finally(() => {
      this.running = null;
      if (this.wakeRequested && !this.stopped) this.wake();
    });
    return this.running;
  }

  private async drainLoop(): Promise<void> {
    this.wakeRequested = false;
    try {
      for (let index = 0; index < this.maxBatchSize; index += 1) {
        if (this.stopped) return;
        const result = await this.consumer.consumeNext(this.workerId);
        if (result.kind === "ACKNOWLEDGED" || result.kind === "DEAD_LETTERED") {
          continue;
        }
        if (result.kind === "IDLE") return;
        this.scheduleAt(result.retryAtMs);
        return;
      }
      this.scheduleAt(this.clock.nowMs());
    } catch (error) {
      this.onBackgroundError(error);
      this.scheduleAt(this.clock.nowMs() + this.infrastructureRetryMs);
    }
  }

  private scheduleAt(retryAtMs: number): void {
    if (this.stopped) return;
    const delayMs = Math.max(0, retryAtMs - this.clock.nowMs());
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.wake();
    }, delayMs);
    this.timer.unref?.();
  }
}

/** Post-commit notifier. It has no authority or outbox writer capability. */
export class InProcessPressureNarrativeOutboxSignalV1
implements NarrativeOutboxSignalPort {
  constructor(private readonly worker: PressureNarrativeInProcessWorkerV1) {}

  async notifyCommitted(input: Readonly<{
    runId: string;
    authorityCommitHash: string;
    outboxDedupeKey: string;
    outboxHash: string;
  }>): Promise<void> {
    nonEmpty(input.runId, "signal.runId");
    hash(input.authorityCommitHash, "signal.authorityCommitHash");
    hash(input.outboxHash, "signal.outboxHash");
    const expected = `finale_narrative:${input.runId}:${input.authorityCommitHash}`;
    if (input.outboxDedupeKey !== expected) {
      invalid("signal.outboxDedupeKey", `EXPECTED_${expected}`);
    }
    this.worker.wake();
  }
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(path, "NON_EMPTY_STRING");
}

function hash(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) invalid(path, "SHA256");
}

function positiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(path, "POSITIVE_INTEGER");
}

function nonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path, "NON_NEGATIVE_INTEGER");
}

function invalid(path: string, detail?: string): never {
  return failPressureNarrativeProduction(ERROR.OUTBOX_SIGNAL_INVALID, path, detail);
}
