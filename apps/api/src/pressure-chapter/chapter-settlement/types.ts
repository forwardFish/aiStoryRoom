import type {
  B0ChapterPolicyEvaluationDraftV1,
  B0ChapterSettlementInputV1,
  B0ChapterSettlementMaterialV1,
  B0SettlementCommitResultV1,
  ChapterIdV1,
  ChapterSettlementEvaluationV1,
  FrozenChapterBundleV1,
  SealedChapterSettlementInputV1,
  WorldDeltaV1,
  WorldStateV1,
} from "@ai-story/shared";

export interface ChapterSettlementKeyV1 {
  runId: string;
  chapterRuntimeId: string;
}

/**
 * Read-side fence captured when formal actions close. The observed fields are
 * read in the same source snapshot and expose any post-close drift.
 */
export interface ChapterCloseFenceV1 {
  schemaVersion: "pressure_chapter_close_fence_v1";
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  lifecycleState:
    | "CHAPTER_ACTIVE"
    | "CHAPTER_CLOSING"
    | "CHAPTER_SETTLING"
    | "CHAPTER_FROZEN";
  closedWorkingRevision: number;
  observedWorkingRevision: number;
  closedWorkingStateHash: string;
  observedWorkingStateHash: string;
  closedDecisionLedgerHash: string;
  observedDecisionLedgerHash: string;
  closedActionCount: number;
  observedActionCount: number;
  baseWorldSequenceAtClose: number;
  observedWorldSequence: number;
  baseWorldStateHashAtClose: string;
  observedWorldStateHash: string;
  runRouteHashAtClose: string;
  previousFrozenHashAtClose: string;
  reservationLedgerHashAtClose: string;
  contentPolicyVersionAtClose: string;
  contentPolicyHashAtClose: string;
  settlementContractVersionAtClose: string;
  settlementContractHashAtClose: string;
  closeFenceHash: string;
}

/** Internal application read aggregate; the canonical wire remains sealedInput. */
export interface ChapterSettlementSourceV1 {
  schemaVersion: "pressure_chapter_settlement_source_v1";
  closeFence: ChapterCloseFenceV1;
  sealedInput: SealedChapterSettlementInputV1;
  settlementMaterial: B0ChapterSettlementMaterialV1;
  baseWorldState: WorldStateV1;
  sourceHash: string;
}

export interface CommitChapterFenceV1 {
  expectedLifecycleState: "CHAPTER_SETTLING";
  expectedWorkingRevision: number;
  expectedWorkingStateHash: string;
  expectedDecisionLedgerHash: string;
  expectedActionCount: number;
  expectedWorldSequence: number;
  expectedWorldStateHash: string;
  closeFenceHash: string;
}

export interface ChapterFrozenRootEventV1 {
  schemaVersion: "pressure_chapter_frozen_root_event_v1";
  eventId: string;
  eventType: "CHAPTER_FROZEN";
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  chapterSequence: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  baseWorldSequence: number;
  committedWorldSequence: number;
  settlementInputHash: string;
  evaluationHash: string;
  worldDeltaHash: string;
  bundleHash: string;
  eventHash: string;
}

export interface ChapterHandoffOutboxV1 {
  schemaVersion: "pressure_chapter_handoff_outbox_v1";
  taskType: "OPEN_CHAPTER" | "COMPUTE_FINALE";
  status: "PENDING";
  dedupeKey: string;
  runId: string;
  chapterRuntimeId: string;
  sourceRootEventId: string;
  sourceRootEventHash: string;
  sourceBundleHash: string;
  target:
    | { kind: "NEXT_CHAPTER"; chapterId: ChapterIdV1 }
    | { kind: "FINALE"; chapterId: null };
  outboxHash: string;
}

/** Complete authority candidate handed to W1's single serializable committer. */
export interface AtomicChapterCommitRecordV1 {
  schemaVersion: "pressure_atomic_chapter_commit_v1";
  runId: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  idempotencyKey: string;
  requestFingerprint: string;
  sourceHash: string;
  commitFence: CommitChapterFenceV1;
  sealedInput: SealedChapterSettlementInputV1;
  worldDelta: WorldDeltaV1;
  settlement: ChapterSettlementEvaluationV1;
  frozenChapterBundle: FrozenChapterBundleV1;
  rootEvent: ChapterFrozenRootEventV1;
  outbox: ChapterHandoffOutboxV1;
  receipt: B0SettlementCommitResultV1;
  atomicRecordHash: string;
}

export interface SettleChapterCommandV1 extends ChapterSettlementKeyV1 {
  authorityTrigger: "CHAPTER_CLOSE";
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface SettleChapterResultV1 {
  status: "COMMITTED" | "REPLAYED";
  record: AtomicChapterCommitRecordV1;
}

export interface ChapterSettlementSourcePort {
  readSealedSource(
    key: Readonly<ChapterSettlementKeyV1>,
  ): Promise<ChapterSettlementSourceV1 | null>;
}

/** Content package owns rules only; it receives no repository/commit capability. */
export interface ContentOwnedChapterPolicyPort {
  evaluateChapter(input: Readonly<{
    b0Input: Readonly<B0ChapterSettlementInputV1>;
    baseWorldState: Readonly<WorldStateV1>;
  }>): Promise<B0ChapterPolicyEvaluationDraftV1>;
}

/**
 * W1 persistence handoff. commitOnce must persist every record member and its
 * lifecycle/world-sequence CAS in one serializable transaction.
 */
export interface AtomicChapterCommitterPort {
  readCommitted(
    key: Readonly<ChapterSettlementKeyV1>,
  ): Promise<unknown | null>;
  commitOnce(
    record: Readonly<AtomicChapterCommitRecordV1>,
  ): Promise<{
    status: "COMMITTED" | "ALREADY_COMMITTED";
    record: unknown;
  }>;
}
