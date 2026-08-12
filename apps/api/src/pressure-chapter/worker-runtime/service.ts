import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  PRESSURE_WORKER_RUNTIME_ERROR_CODES as ERROR,
  PressureWorkerRuntimeError,
} from "./errors";
import type {
  PressureWorkerClockPortV1,
  PressureWorkerLaneHealthV1,
  PressureWorkerLaneNameV1,
  PressureWorkerLanePortV1,
  PressureWorkerLaneRunStateV1,
  PressureWorkerRuntimeConfigV1,
  PressureWorkerRuntimeControllerV1,
  PressureWorkerRuntimeDependenciesV1,
  PressureWorkerRuntimeHealthV1,
  PressureWorkerRuntimeTickReportV1,
  PressureWorkerSchedulerPortV1,
  PressureWorkerTimerHandleV1,
} from "./ports";

const DEFAULT_CONFIG: PressureWorkerRuntimeConfigV1 = Object.freeze({
  enabled: true,
  topology: "embedded",
  autoStart: true,
  pollMs: 250,
  perLaneLimit: 8,
  unrefTimers: true,
  lanes: {
    decision: true,
    progress: true,
    narrative: true,
    aEmotion: true,
  },
});

@Injectable()
export class PressureWorkerRuntimeServiceV1
implements PressureWorkerRuntimeControllerV1, OnModuleInit, OnModuleDestroy {
  private readonly config: PressureWorkerRuntimeConfigV1;
  private readonly lanes: Record<PressureWorkerLaneNameV1, PressureWorkerLanePortV1 | null>;
  private readonly workerIds: Record<PressureWorkerLaneNameV1, string>;
  private readonly laneHealth: Record<PressureWorkerLaneNameV1, PressureWorkerLaneHealthV1>;
  private running = false;
  private stopping = false;
  private activeTick = false;
  private timer: PressureWorkerTimerHandleV1 | null = null;
  private inFlightTick: Promise<PressureWorkerRuntimeTickReportV1> | null = null;

  constructor(
    dependencies: PressureWorkerRuntimeDependenciesV1,
    config: Partial<PressureWorkerRuntimeConfigV1> = {},
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      lanes: {
        ...DEFAULT_CONFIG.lanes,
        ...(config.lanes ?? {}),
      },
    };
    validateConfig(this.config);
    this.clock = dependencies.clock;
    this.scheduler = dependencies.scheduler;
    this.lanes = {
      decision: dependencies.decision ?? null,
      progress: dependencies.progress ?? null,
      narrative: dependencies.narrative ?? null,
      aEmotion: dependencies.aEmotion ?? null,
    };
    this.workerIds = {
      decision: buildWorkerId(this.config.topology, "decision"),
      progress: buildWorkerId(this.config.topology, "progress"),
      narrative: buildWorkerId(this.config.topology, "narrative"),
      aEmotion: buildWorkerId(this.config.topology, "aEmotion"),
    };
    this.laneHealth = {
      decision: createLaneHealth(this.config.lanes.decision),
      progress: createLaneHealth(this.config.lanes.progress),
      narrative: createLaneHealth(this.config.lanes.narrative),
      aEmotion: createLaneHealth(this.config.lanes.aEmotion),
    };
  }

  private readonly clock: PressureWorkerClockPortV1;
  private readonly scheduler: PressureWorkerSchedulerPortV1;

  async onModuleInit(): Promise<void> {
    if (!this.config.enabled || !this.config.autoStart) return;
    await this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    this.scheduleNext(this.config.pollMs);
  }

  async stop(): Promise<void> {
    if (!this.running && !this.inFlightTick) return;
    this.stopping = true;
    this.running = false;
    this.clearTimer();
    const pending = this.inFlightTick;
    if (pending) {
      await pending.catch(() => undefined);
    }
    for (const lane of laneNames()) {
      if (this.laneHealth[lane].state !== "DISABLED") {
        this.laneHealth[lane].state = "STOPPED";
      }
    }
    this.stopping = false;
  }

  async tickOnce(): Promise<PressureWorkerRuntimeTickReportV1> {
    if (this.activeTick) {
      return this.inFlightTick
        ?? Promise.reject(new PressureWorkerRuntimeError(ERROR.ALREADY_RUNNING, "Worker runtime tick is already running"));
    }
    const startedAtMs = this.clock.nowMs();
    this.activeTick = true;
    const run = this.runTick(startedAtMs);
    this.inFlightTick = run;
    try {
      return await run;
    } finally {
      this.inFlightTick = null;
      this.activeTick = false;
      if (this.running && !this.stopping) {
        this.scheduleNext(this.config.pollMs);
      }
    }
  }

  async drain(limit = this.config.perLaneLimit): Promise<PressureWorkerRuntimeTickReportV1[]> {
    assertPositiveInteger(limit, "limit");
    const reports: PressureWorkerRuntimeTickReportV1[] = [];
    for (let count = 0; count < limit; count += 1) {
      const report = await this.tickOnce();
      reports.push(report);
      const active = report.lanes.some((lane) => lane.stoppedBecause === "LIMIT");
      if (!active) break;
    }
    return reports;
  }

  health(): PressureWorkerRuntimeHealthV1 {
    return {
      enabled: this.config.enabled,
      topology: this.config.topology,
      running: this.running,
      stopping: this.stopping,
      pollMs: this.config.pollMs,
      perLaneLimit: this.config.perLaneLimit,
      activeTick: this.activeTick,
      lanes: structuredClone(this.laneHealth),
    };
  }

  private async runTick(
    startedAtMs: number,
  ): Promise<PressureWorkerRuntimeTickReportV1> {
    const lanes: PressureWorkerRuntimeTickReportV1["lanes"] = [];
    for (const lane of laneNames()) {
      lanes.push(await this.runLane(lane, startedAtMs));
    }
    return {
      startedAtMs,
      finishedAtMs: this.clock.nowMs(),
      lanes,
    };
  }

  private async runLane(
    lane: PressureWorkerLaneNameV1,
    startedAtMs: number,
  ): Promise<PressureWorkerRuntimeTickReportV1["lanes"][number]> {
    const port = this.lanes[lane];
    const health = this.laneHealth[lane];
    if (!this.config.lanes[lane] || !port) {
      health.state = "DISABLED";
      return {
        lane,
        state: "DISABLED",
        steps: 0,
        stoppedBecause: "DISABLED",
        errorCode: null,
      };
    }

    health.runs += 1;
    health.lastStartedAtMs = startedAtMs;
    try {
      const drained = await drainLane(
        port,
        this.workerIds[lane],
        this.config.perLaneLimit,
      );
      const state = classifyLaneState(drained.stoppedBecause, drained.results.length);
      health.state = state;
      health.successes += drained.results.filter((item) => item.kind !== "IDLE" && item.kind !== "BUSY").length;
      health.lastFinishedAtMs = this.clock.nowMs();
      health.lastErrorCode = null;
      return {
        lane,
        state,
        steps: drained.results.length,
        stoppedBecause: drained.stoppedBecause,
        errorCode: null,
      };
    } catch (error) {
      const code = readErrorCode(error);
      health.state = "FAILED";
      health.failures += 1;
      health.lastFinishedAtMs = this.clock.nowMs();
      health.lastErrorCode = code;
      return {
        lane,
        state: "FAILED",
        steps: 0,
        stoppedBecause: "FAILED",
        errorCode: code,
      };
    }
  }

  private scheduleNext(delayMs: number): void {
    this.clearTimer();
    this.timer = this.scheduler.schedule(delayMs, () => {
      if (!this.running || this.stopping || this.activeTick) {
        if (this.running && !this.stopping && !this.activeTick) {
          this.scheduleNext(this.config.pollMs);
        }
        return;
      }
      void this.tickOnce().catch(() => undefined);
    });
    if (this.config.unrefTimers) this.timer.unref?.();
  }

  private clearTimer(): void {
    this.timer?.cancel();
    this.timer = null;
  }
}

async function drainLane(
  port: PressureWorkerLanePortV1,
  workerId: string,
  limit: number,
) {
  if (port.drain) return port.drain(workerId, limit);
  if (!port.tick) {
    throw new PressureWorkerRuntimeError(
      ERROR.INVALID_CONFIGURATION,
      "Worker lane must expose tick() or drain()",
      { workerId },
    );
  }
  const results = [];
  for (let index = 0; index < limit; index += 1) {
    const result = await port.tick(workerId);
    results.push(result);
    if (result.kind === "IDLE") {
      return { results, stoppedBecause: "IDLE" as const };
    }
    if (result.kind === "BUSY") {
      return { results, stoppedBecause: "BUSY" as const };
    }
  }
  return { results, stoppedBecause: "LIMIT" as const };
}

function validateConfig(config: PressureWorkerRuntimeConfigV1): void {
  assertPositiveInteger(config.pollMs, "config.pollMs");
  assertPositiveInteger(config.perLaneLimit, "config.perLaneLimit");
}

function buildWorkerId(
  topology: string,
  lane: PressureWorkerLaneNameV1,
): string {
  return `pressure-worker:${topology}:${lane}:${process.pid}`;
}

function createLaneHealth(enabled: boolean): PressureWorkerLaneHealthV1 {
  return {
    enabled,
    state: enabled ? "STOPPED" : "DISABLED",
    runs: 0,
    successes: 0,
    failures: 0,
    lastStartedAtMs: null,
    lastFinishedAtMs: null,
    lastErrorCode: null,
  };
}

function classifyLaneState(
  stoppedBecause: "IDLE" | "BUSY" | "LIMIT",
  steps: number,
): PressureWorkerLaneRunStateV1 {
  if (stoppedBecause === "BUSY") return "BUSY";
  if (steps === 0 || (steps === 1 && stoppedBecause === "IDLE")) return "IDLE";
  return "WORKED";
}

function laneNames(): PressureWorkerLaneNameV1[] {
  return ["decision", "progress", "narrative", "aEmotion"];
}

function assertPositiveInteger(
  value: unknown,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new PressureWorkerRuntimeError(
      ERROR.INVALID_CONFIGURATION,
      `${label} must be a positive integer`,
      { value },
    );
  }
}

function readErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "").trim();
    if (code) return code;
  }
  if (error instanceof Error && error.name.trim()) return error.name;
  return "UNKNOWN_ERROR";
}
