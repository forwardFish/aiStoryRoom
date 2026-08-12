import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";

export type PressureWorkerLaneNameV1 =
  | "decision"
  | "progress"
  | "narrative"
  | "aEmotion";
export type PressureWorkerTopologyV1 = "embedded" | "independent";
export type PressureWorkerLaneRunStateV1 = "IDLE" | "BUSY" | "WORKED" | "FAILED" | "STOPPED" | "DISABLED";

export type PressureWorkerStepResultV1 =
  | { kind: "IDLE" }
  | { kind: "BUSY"; retryAtMs: number }
  | { kind: "ACKNOWLEDGED"; [key: string]: unknown }
  | { kind: "RETRY_SCHEDULED"; retryAtMs: number; [key: string]: unknown }
  | { kind: "DEAD_LETTERED"; [key: string]: unknown }
  | { kind: "PROCESSED"; [key: string]: unknown };

export interface PressureWorkerDrainResultV1 {
  results: PressureWorkerStepResultV1[];
  stoppedBecause: "IDLE" | "BUSY" | "LIMIT";
}

export interface PressureWorkerLanePortV1 {
  tick?(workerId: string): Promise<PressureWorkerStepResultV1>;
  drain?(
    workerId: string,
    limit: number,
  ): Promise<PressureWorkerDrainResultV1>;
}

export interface PressureWorkerClockPortV1 {
  nowMs(): number;
}

export interface PressureWorkerTimerHandleV1 {
  cancel(): void;
  unref?(): void;
}

export interface PressureWorkerSchedulerPortV1 {
  schedule(
    delayMs: number,
    callback: () => void,
  ): PressureWorkerTimerHandleV1;
}

export interface PressureWorkerLaneHealthV1 {
  enabled: boolean;
  state: PressureWorkerLaneRunStateV1;
  runs: number;
  successes: number;
  failures: number;
  lastStartedAtMs: number | null;
  lastFinishedAtMs: number | null;
  lastErrorCode: string | null;
}

export interface PressureWorkerRuntimeHealthV1 {
  enabled: boolean;
  topology: PressureWorkerTopologyV1;
  running: boolean;
  stopping: boolean;
  pollMs: number;
  perLaneLimit: number;
  activeTick: boolean;
  lanes: Record<PressureWorkerLaneNameV1, PressureWorkerLaneHealthV1>;
}

export interface PressureWorkerRuntimeConfigV1 {
  enabled: boolean;
  topology: PressureWorkerTopologyV1;
  autoStart: boolean;
  pollMs: number;
  perLaneLimit: number;
  unrefTimers: boolean;
  lanes: Record<PressureWorkerLaneNameV1, boolean>;
}

export interface PressureWorkerRuntimeDependenciesV1 {
  clock: PressureWorkerClockPortV1;
  scheduler: PressureWorkerSchedulerPortV1;
  decision?: PressureWorkerLanePortV1 | null;
  progress?: PressureWorkerLanePortV1 | null;
  narrative?: PressureWorkerLanePortV1 | null;
  aEmotion?: PressureWorkerLanePortV1 | null;
}

export interface PressureWorkerRuntimeControllerV1
extends OnModuleInit, OnModuleDestroy {
  start(): Promise<void>;
  stop(): Promise<void>;
  tickOnce(): Promise<PressureWorkerRuntimeTickReportV1>;
  drain(limit?: number): Promise<PressureWorkerRuntimeTickReportV1[]>;
  health(): PressureWorkerRuntimeHealthV1;
}

export interface PressureWorkerRuntimeTickReportV1 {
  startedAtMs: number;
  finishedAtMs: number;
  lanes: Array<{
    lane: PressureWorkerLaneNameV1;
    state: PressureWorkerLaneRunStateV1;
    steps: number;
    stoppedBecause: "IDLE" | "BUSY" | "LIMIT" | "FAILED" | "DISABLED";
    errorCode: string | null;
  }>;
}
