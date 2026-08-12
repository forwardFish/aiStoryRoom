import type {
  OpenNovelNarrativeProjectionJobV1,
  NarrativeStatusV1,
} from "@ai-story/shared";

export type NarrativeOutboxClaimV1 =
  | { kind: "EMPTY" }
  | { kind: "BUSY"; retryAtMs: number }
  | {
      kind: "CLAIMED";
      outboxId: string;
      fence: number;
      attemptCount: number;
      maxAttempts: number;
      job: unknown;
    };

/** Lease/fence/retry/dead-letter are explicit and always fence-checked by the adapter. */
export interface NarrativeOutboxPortV1 {
  claimNext(request: {
    workerId: string;
    nowMs: number;
    leaseMs: number;
  }): Promise<NarrativeOutboxClaimV1>;
  acknowledge(request: { outboxId: string; fence: number }): Promise<void>;
  retry(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    nextAttemptAtMs: number;
    reasonCode: string;
  }): Promise<void>;
  deadLetter(request: {
    outboxId: string;
    fence: number;
    attemptCount: number;
    reasonCode: string;
  }): Promise<void>;
}

/** Read-only committed authority. It has no mutation, settlement, or finale method. */
export interface AuthoritativeNarrativeSourceReaderPortV1 {
  readCommitted(job: Readonly<OpenNovelNarrativeProjectionJobV1>): Promise<unknown | null>;
}

/** The only projector port receives an already filtered, audience-safe DTO. */
export interface OpenNovelNarrativeProjectorPortV1 {
  project(request: {
    job: OpenNovelNarrativeProjectionJobV1;
    audienceSafeSource: unknown;
    workerId: string;
  }): Promise<unknown>;
}

export interface NarrativeOutboxClockPortV1 {
  nowMs(): number;
}

export interface OpenNovelProjectionReceiptV1 {
  logicalProjectionKey: string;
  requestFingerprint: string;
  projectionId: string | null;
  status: NarrativeStatusV1;
  deliveryState: "ACTIVE" | "DEAD_LETTERED";
  artifact: unknown | null;
  retryAtMs: number | null;
  errorCode: string | null;
}

export type NarrativeOutboxConsumeResultV1 =
  | { kind: "IDLE" }
  | { kind: "BUSY"; retryAtMs: number }
  | { kind: "ACKNOWLEDGED"; outboxId: string; status: "PUBLISHED" | "FALLBACK_PUBLISHED" }
  | { kind: "RETRY_SCHEDULED"; outboxId: string; retryAtMs: number; reasonCode: string }
  | { kind: "DEAD_LETTERED"; outboxId: string; reasonCode: string };
