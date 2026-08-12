import type { ChapterIdV1 } from "@ai-story/shared";

export interface ProgressOutboxStoredTaskV1 {
  outboxId: string;
  runId: string;
  taskType: string;
  dedupeKey: string;
  sourceAuthority: string;
  sourceId: string;
  sourceCommitHash: string;
  payloadJson: unknown;
  payloadHash: string;
  attemptCount: number;
  maxAttempts: number;
}

export type ProgressOutboxClaimV1 =
  | { kind: "EMPTY" }
  | { kind: "BUSY"; retryAtMs: number }
  | {
      kind: "CLAIMED";
      outboxId: string;
      fence: number;
      attemptCount: number;
      maxAttempts: number;
      task: ProgressOutboxStoredTaskV1;
    };

export interface ProgressOutboxPortV1 {
  claimNext(request: {
    workerId: string;
    nowMs: number;
    leaseMs: number;
  }): Promise<ProgressOutboxClaimV1>;
  acknowledge(request: {
    outboxId: string;
    fence: number;
    workerId: string;
    completedAtMs: number;
  }): Promise<void>;
  retry(request: {
    outboxId: string;
    fence: number;
    workerId: string;
    nowMs: number;
    nextAttemptAtMs: number;
    reasonCode: string;
  }): Promise<void>;
  deadLetter(request: {
    outboxId: string;
    fence: number;
    workerId: string;
    nowMs: number;
    reasonCode: string;
  }): Promise<void>;
}

export interface ProgressOutboxClockPortV1 {
  nowMs(): number;
}

export interface ProgressOpenChapterHandoffV1 {
  sourceAuthority: "CHAPTER_FROZEN";
  runId: string;
  previousChapterRuntimeId: string;
  outboxDedupeKey: string;
  sourceBundleHash: string;
  sourceCommitHash: string;
  targetChapterId: Exclude<ChapterIdV1, "N1">;
}

export interface ProgressOpenChapterResultV1 {
  status: "OPENED" | "REPLAYED";
  chapterId: Exclude<ChapterIdV1, "N1">;
  chapterRuntimeId: string;
}

export interface RuntimeProgressOpenChapterPortV1 {
  openNextChapter(request: {
    handoff: Readonly<ProgressOpenChapterHandoffV1>;
    workerId: string;
    nowMs: number;
  }): Promise<ProgressOpenChapterResultV1>;
}

export interface ProgressComputeFinaleHandoffV1 {
  sourceAuthority: "CHAPTER_FROZEN";
  runId: string;
  terminalChapterRuntimeId: string;
  outboxDedupeKey: string;
  sourceBundleHash: string;
  sourceCommitHash: string;
}

export interface ProgressComputeFinaleResultV1 {
  status: "COMMITTED" | "REPLAYED";
  runId: string;
  authorityCommitHash: string;
}

export interface RuntimeProgressFinalePortV1 {
  computeFinale(request: {
    handoff: Readonly<ProgressComputeFinaleHandoffV1>;
    workerId: string;
    nowMs: number;
  }): Promise<ProgressComputeFinaleResultV1>;
}

export interface ProgressOutboxWorkerConfigV1 {
  leaseMs: number;
  baseRetryMs: number;
  maxRetryMs: number;
}

export type ProgressOutboxTickResultV1 =
  | { kind: "IDLE" }
  | { kind: "BUSY"; retryAtMs: number }
  | {
      kind: "ACKNOWLEDGED";
      outboxId: string;
      taskType: "OPEN_CHAPTER" | "COMPUTE_FINALE";
      effect: "OPENED" | "REPLAYED" | "COMMITTED";
    }
  | {
      kind: "RETRY_SCHEDULED";
      outboxId: string;
      reasonCode: string;
      retryAtMs: number;
    }
  | {
      kind: "DEAD_LETTERED";
      outboxId: string;
      reasonCode: string;
    };

export interface ProgressOutboxDrainResultV1 {
  results: ProgressOutboxTickResultV1[];
  stoppedBecause: "IDLE" | "BUSY" | "LIMIT";
}

