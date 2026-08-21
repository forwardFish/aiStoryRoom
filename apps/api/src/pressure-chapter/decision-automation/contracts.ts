import type {
  CanonicalJsonObject,
  ChapterIdV1,
  RunRouteSnapshotV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStateV1,
  CommittedSettlementResumeAuthorityV1,
  SubmitOrchestratedActionCommandV1,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type { SeatControlSnapshotV1 } from "../seat-control/types";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import type { PressureDeadlineDefaultCoordinatorPortV1 } from "../deadline-default-production/contracts";
import type { AEmotionAuthorityEmissionV1 } from "../a-emotion-production/content-source";
import type { AuthorityDownstreamManifestV1 } from "../projection-plan/authority-downstream";
import type { OpenNovelNarrativeProjectionJobV1, SealedChapterSettlementInputV1 } from "@ai-story/shared";
import type { BeatResolutionV1 } from "@ai-story/shared";
import type { WorkingLedgerEventV1 } from "../working-ledger/contracts";
import type { StoredRunRouteRecordV1 } from "../run-router/types";

export interface DecisionAutomationTaskV1 {
  schemaVersion: "pressure_decision_automation_task_v1";
  runId: string;
  routeHash: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  decisionPointId: string;
  seatId: SeatIdV1;
  expectedOrchestratorRevision: number;
  expectedWorkingRevision: number;
  expectedControlEpoch: number;
  expectedControllerMode: "HUMAN_ACTIVE" | "AI_ACTIVE";
  expectedDeadlineAtMs: number | null;
  expectedSeatAuthorityStateHash: string;
  taskHash: string;
}

export type DecisionAutomationOutcomeKindV1 =
  | "ACTION_SUBMITTED"
  | "ACTION_RECONCILED"
  | "AI_FAILURE_DEFAULTED"
  | "BATCH_COMPLETED"
  | "BATCH_PARTIAL"
  | "WAITING_FOR_HUMANS"
  | "NO_PENDING_AI"
  | "ALREADY_PROGRESSED"
  | "DEADLINE_ADVANCED"
  | "STALE_SKIPPED";

/** Legacy per-seat recovery outcome retained for source/test compatibility. */
export interface DecisionAutomationOutcomeV1 {
  schemaVersion: "pressure_decision_automation_outcome_v1";
  taskHash: string;
  outcome: DecisionAutomationOutcomeKindV1;
  actionId: string | null;
  resultingOrchestratorHash: string | null;
  completedAtMs: number;
  outcomeHash: string;
}

/**
 * Read-only discovery only. Production execution groups returned seat facts by
 * (run, chapterRuntime, decision) and performs one coherent convergence attempt.
 */
export interface ActivePressureDecisionScannerPortV1 {
  scanActive(): Promise<DecisionAutomationTaskV1[]>;
}


/** Legacy read seams remain available to the un-wired per-seat service. */
export interface DecisionAutomationRouteReaderPortV1 {
  readRoute(runId: string): Promise<RunRouteSnapshotV1 | null>;
}

export interface DecisionAutomationOrchestratorReaderPortV1 {
  read(runId: string): Promise<ChapterOrchestratorStateV1 | null>;
}

export interface DecisionAutomationSeatAuthorityReaderPortV1 {
  readSnapshot(runId: string): Promise<SeatControlSnapshotV1 | null>;
}

export interface DecisionAutomationContentPortV1 {
  load(input: Readonly<{
    routeSnapshot: RunRouteSnapshotV1;
    chapterId: ChapterIdV1;
  }>): Promise<AuthoredChapterRuntimeV1>;
}

export interface DecisionConvergenceAuthoritySnapshotV1 {
  schemaVersion: "pressure_decision_convergence_authority_snapshot_v1";
  routeSnapshot: RunRouteSnapshotV1;
  chapter: ChapterOrchestratorStateV1;
  projection: WorkingLedgerProjectionV1;
  seatAuthority: SeatControlSnapshotV1;
  aiPolicyArtifactHash: string;
  capturedAtMs: number;
  snapshotHash: string;
}

export interface DecisionSubmitViewerBindingV1 {
  roomId: string;
  runId: string;
  subjectId: string;
  seatId: SeatIdV1;
  humanControllerId: string;
}

/** One authenticated HTTP submit bound to one exact authority snapshot. */
export interface DecisionSubmitSnapshotV1 {
  schemaVersion: "pressure_decision_submit_snapshot_v1";
  authority: DecisionConvergenceAuthoritySnapshotV1;
  viewer: DecisionSubmitViewerBindingV1;
  submitSnapshotHash: string;
}

/** Internal aggregate submit read: one frozen route record plus one sealed authority snapshot. */
export interface DecisionSubmitAuthorityBundleV1 {
  storedRoute: StoredRunRouteRecordV1;
  snapshot: DecisionSubmitSnapshotV1;
}

export interface DecisionConvergenceSnapshotReaderPortV1 {
  capture(input: Readonly<{
    runId: string;
    expectedRouteHash: string;
    aiPolicyArtifactHash: string;
    capturedAtMs: number;
  }>): Promise<DecisionConvergenceAuthoritySnapshotV1 | null>;
  captureSubmit?(input: Readonly<{
    runId: string;
    expectedRouteHash: string;
    aiPolicyArtifactHash: string;
    capturedAtMs: number;
    roomId: string;
    subjectId: string;
    seatId: SeatIdV1;
    chapterRuntimeId: string;
    decisionPointId: string;
    expectedWorkingRevision: number;
    expectedControlEpoch: number;
    expectedSubmissionFenceToken: string;
  }>): Promise<DecisionSubmitSnapshotV1 | null>;
  captureSubmitAuthority?(input: Readonly<{
    runId: string;
    expectedRouteHash: string;
    aiPolicyArtifactHash: string;
    capturedAtMs: number;
    roomId: string;
    subjectId: string;
    seatId: SeatIdV1;
    chapterRuntimeId: string;
    decisionPointId: string;
    expectedWorkingRevision: number;
    expectedControlEpoch: number;
    expectedSubmissionFenceToken: string;
  }>): Promise<DecisionSubmitAuthorityBundleV1 | null>;
  /** One-row post-transition cache read used only when settlement opens a new chapter. */
  loadWorkingProjection?(input: Readonly<{
    runId: string;
    routeHash: string;
    chapterRuntimeId: string;
    chapterId: ChapterIdV1;
  }>): Promise<WorkingLedgerProjectionV1 | null>;
}

export interface AiDecisionPolicyInputV1 {
  schemaVersion: "sangtian_ai_decision_policy_input_v1";
  runId: string;
  routeHash: string;
  runSeed: string;
  contentPackageVersion: string;
  contentPackageSha256: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  decisionPointId: string;
  seatId: SeatIdV1;
  eligibleActionTypes: string[];
  inputHash: string;
}

export interface AiDecisionPolicySelectionV1 {
  schemaVersion: "sangtian_ai_decision_policy_selection_v1";
  policyRef: string;
  policyVersion: string;
  policyHash: string;
  resolvedContentPackageVersion: string;
  resolvedContentPackageSha256: string;
  inputHash: string;
  actionType: string;
  selectionHash: string;
}

/** Deterministic content-owned policy contract used by legacy and batch paths. */
export interface ContentOwnedAiDecisionPolicyPortV1 {
  select(
    input: Readonly<AiDecisionPolicyInputV1>,
  ): Promise<AiDecisionPolicySelectionV1> | AiDecisionPolicySelectionV1;
}

/** Production convergence requires the verified published artifact hash. */
export interface PublishedContentOwnedAiDecisionPolicyPortV1
  extends ContentOwnedAiDecisionPolicyPortV1 {
  readonly artifactSha256: string;
}

export type DecisionAutomationCompilationResultV1 =
  | {
      kind: "COMMAND";
      command: SubmitOrchestratedActionCommandV1;
    }
  | {
      kind: "ALREADY_ACCEPTED";
      actionId: string;
      idempotencyKey: string;
      inputFingerprint: string;
    };

export interface DecisionAutomationCommandCompilerPortV1 {
  compile(input: Readonly<{
    routeSnapshot: RunRouteSnapshotV1;
    chapter: ChapterOrchestratorStateV1;
    projection: WorkingLedgerProjectionV1;
    seatAuthority: {
      seatId: SeatIdV1;
      activeControllerId: string;
      controlEpoch: number;
      submissionFenceToken: string;
    };
    selection: AiDecisionPolicySelectionV1;
    nowMs: number;
  }>): DecisionAutomationCompilationResultV1;
}

export type PreparedAutomationActionStaleReasonV1 =
  | "ROUTE"
  | "ORCHESTRATOR_REVISION"
  | "ORCHESTRATOR_HASH"
  | "CHAPTER_OR_DECISION"
  | "DESCRIPTOR"
  | "DECISION_POLICY"
  | "WORKING_REVISION"
  | "WORKING_STATE"
  | "DEADLINE"
  | "SEAT_AUTHORITY"
  | "SEAT_CONTROLLER"
  | "SEAT_EPOCH"
  | "SEAT_FENCE"
  | "AI_POLICY";

export interface PreparedAutomationActionAuthorityV1 {
  actorKind: "HUMAN" | "AI";
  snapshotHash: string;
  expectedOrchestratorRevision: number;
  expectedOrchestratorHash: string;
  expectedDescriptorHash: string;
  expectedDecisionPolicyHash: string;
  expectedWorkingRevision: number;
  expectedWorkingStateHash: string;
  expectedLedgerHeadHash: string;
  expectedSeatAuthorityStateHash: string;
  expectedControllerId: string;
  expectedControlEpoch: number;
  expectedSubmissionFenceToken: string;
  expectedAiPolicyHash: string | null;
}

export interface AppendPreparedAutomationActionCommandV1 {
  command: SubmitOrchestratedActionCommandV1;
  authority: PreparedAutomationActionAuthorityV1;
}

/**
 * A deterministic, route-ordered batch of prepared AI actions. The batch is
 * compiled entirely in memory and is the only unit allowed to cross the W5
 * persistence boundary for one convergence pass.
 */
export interface PreparedAutomationActionBatchV1 {
  schemaVersion: "pressure_prepared_automation_action_batch_v1";
  batchId: string;
  snapshotHash: string;
  runId: string;
  routeHash: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  decisionPointId: string;
  expectedOrchestratorRevision: number;
  expectedOrchestratorHash: string;
  expectedWorkingRevision: number;
  expectedWorkingStateHash: string;
  expectedLedgerHeadHash: string;
  expectedSeatAuthorityStateHash: string;
  frozenSeatOrder: SeatIdV1[];
  existingAcceptedActions?: Array<{
    seatId: SeatIdV1;
    actionId: string;
    actionBudget: number;
  }>;
  actions: AppendPreparedAutomationActionCommandV1[];
  chapterDescriptor: AuthoredChapterRuntimeV1;
  nextOrchestratorState: ChapterOrchestratorStateV1;
  beatPlan: {
    event: WorkingLedgerEventV1;
    resolution: BeatResolutionV1;
    postBeatOrchestratorState: ChapterOrchestratorStateV1;
    settlementInput: SealedChapterSettlementInputV1 | null;
    narrativeJobs: OpenNovelNarrativeProjectionJobV1[];
    aEmotionEmissions: AEmotionAuthorityEmissionV1[];
    downstreamManifest: AuthorityDownstreamManifestV1;
  };
  batchHash: string;
}

export type PreparedAutomationActionBatchConflictReasonV1 =
  | "HEAD_CONFLICT"
  | PreparedAutomationActionStaleReasonV1;

export interface PreparedAutomationActionBatchResultV1 {
  status: "COMMITTED" | "REPLAYED" | "CONFLICT";
  batchId: string;
  actionIds: string[];
  replayedActionIds: string[];
  eventHashes: string[];
  ledgerHeadHash: string;
  orchestratorState: ChapterOrchestratorStateV1;
  projection: WorkingLedgerProjectionV1 | null;
  conflictReason: PreparedAutomationActionBatchConflictReasonV1 | null;
}

/** One already-accepted authored Beat folded without any database access. */
export interface PreparedChapterReplayBeatV1 {
  decisionPointId: string;
  actionIds: string[];
  recordedOrchestratorState: ChapterOrchestratorStateV1;
  event: WorkingLedgerEventV1;
  resolution: BeatResolutionV1;
  postBeatOrchestratorState: ChapterOrchestratorStateV1;
  narrativeJobs: OpenNovelNarrativeProjectionJobV1[];
  aEmotionEmissions: AEmotionAuthorityEmissionV1[];
  downstreamManifest: AuthorityDownstreamManifestV1;
}

/**
 * A chapter-prefix replay is planned entirely in memory from durable human
 * actions. It crosses persistence once and stops at the authored final Beat;
 * the existing final-Beat convergence and Settlement remain authoritative.
 */
export interface PreparedChapterReplayBatchV1 {
  schemaVersion: "pressure_prepared_chapter_replay_batch_v1";
  batchId: string;
  snapshotHash: string;
  routeSnapshot: RunRouteSnapshotV1;
  runId: string;
  routeHash: string;
  chapterRuntimeId: string;
  chapterId: ChapterIdV1;
  nowMs: number;
  expectedOrchestratorRevision: number;
  expectedOrchestratorHash: string;
  expectedWorkingRevision: number;
  expectedWorkingStateHash: string;
  expectedLedgerHeadHash: string;
  chapterDescriptor: AuthoredChapterRuntimeV1;
  beats: PreparedChapterReplayBeatV1[];
  finalOrchestratorState: ChapterOrchestratorStateV1;
  finalWorkingRevision: number;
  finalWorkingStateHash: string;
  finalLedgerHeadHash: string;
  batchHash: string;
}

export interface PreparedChapterReplayBatchResultV1 {
  status: "COMMITTED" | "REPLAYED" | "CONFLICT";
  batchId: string;
  beatEventHashes: string[];
  ledgerHeadHash: string;
  orchestratorState: ChapterOrchestratorStateV1;
  projection: WorkingLedgerProjectionV1 | null;
  conflictReason: PreparedAutomationActionBatchConflictReasonV1 | null;
}

export interface AppendPreparedAutomationActionResultV1 {
  status: "APPENDED" | "REPLAYED" | "HEAD_CONFLICT" | "STALE";
  actionId: string;
  eventHash: string | null;
  ledgerHeadHash: string;
  staleReason: PreparedAutomationActionStaleReasonV1 | null;
}

/** One short W5 transaction; it has no Beat/Settlement/Provider capability. */
export interface PreparedAutomationActionSubmissionPortV1 {
  submitPrepared(
    command: AppendPreparedAutomationActionCommandV1,
  ): Promise<AppendPreparedAutomationActionResultV1>;
  submitPreparedBatch?(
    batch: PreparedAutomationActionBatchV1,
  ): Promise<PreparedAutomationActionBatchResultV1>;
  submitPreparedChapterReplay?(
    batch: PreparedChapterReplayBatchV1,
  ): Promise<PreparedChapterReplayBatchResultV1>;
}

/** Existing runtime surface retained for the legacy recovery source. */
export interface DecisionAutomationRuntimePortV1 {
  submitAction(
    command: SubmitOrchestratedActionCommandV1,
  ): Promise<ChapterOrchestratorStateV1>;
  resume(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1>;
  resumeFromCommittedSettlementAuthority?(
    routeSnapshot: RunRouteSnapshotV1,
    authority: Readonly<CommittedSettlementResumeAuthorityV1>,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1>;
  advanceDeadline(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1>;
}

export interface DecisionAutomationClockPortV1 {
  nowMs(): number;
}

export type DecisionConvergenceTriggerV1 = "HTTP_POST_SUBMIT" | "RECOVERY";

export interface DecisionConvergenceCommandV1 {
  trigger: DecisionConvergenceTriggerV1;
  runId: string;
  expectedRouteHash: string;
  source: {
    chapterRuntimeId: string;
    chapterId: ChapterIdV1;
    decisionPointId: string;
  } | null;
  nowMs: number;
  humanSubmitMs: number;
  /**
   * HTTP-only prepared player action.  Recovery never supplies this value.
   * It is committed in the same W5 batch as the required deterministic AI
   * actions, so the public request does not execute the legacy human write
   * path and then read the same authority again for AI convergence.
   */
  humanAction: SubmitOrchestratedActionCommandV1 | null;
  /** HTTP may reuse the snapshot already consumed by its command compiler. */
  authoritySnapshot?: DecisionConvergenceAuthoritySnapshotV1 | null;
}

export interface DecisionConvergenceStageTimingsV1 {
  humanSubmitMs: number;
  snapshotMs: number;
  compileAllMs: number;
  ledgerAppendTotalMs: number;
  ledgerAppendEachMs: number[];
  orchestratorReconcileMs: number;
  orchestratorTotalMs: number;
  beatMs: number;
  settlementMs: number;
  nextOpenMs: number;
  projectionMs: number;
  endToEndMs: number;
}

export interface DecisionConvergenceDiagnosticsV1 {
  schemaVersion: "pressure_decision_convergence_diagnostics_v1";
  batchId: string;
  trigger: DecisionConvergenceTriggerV1;
  runId: string;
  chapterRuntimeId: string | null;
  chapterId: ChapterIdV1 | null;
  decisionPointId: string | null;
  outcome: DecisionAutomationOutcomeKindV1;
  pendingHumanCount: number;
  pendingAiCount: number;
  snapshotReadCount: number;
  policyCallCount: number;
  compileCount: number;
  appendTxCount: number;
  replayCount: number;
  headConflictCount: number;
  w4ConflictCount: number;
  staleRouteCount: number;
  staleRevisionCount: number;
  staleEpochCount: number;
  staleFenceCount: number;
  stalePolicyCount: number;
  resumeCount: number;
  providerCallCount: 0;
  timings: DecisionConvergenceStageTimingsV1;
}

export interface DecisionConvergenceResultV1 {
  schemaVersion: "pressure_decision_convergence_result_v1";
  batchId: string;
  outcome: DecisionAutomationOutcomeKindV1;
  actionIds: string[];
  chapter: ChapterOrchestratorStateV1 | null;
  committedAuthority: {
    chapter: ChapterOrchestratorStateV1;
    workingProjection: WorkingLedgerProjectionV1;
    chapterDescriptor: AuthoredChapterRuntimeV1;
  } | null;
  metrics: DecisionConvergenceDiagnosticsV1;
}

export interface DecisionConvergenceDiagnosticsPortV1 {
  record(metrics: Readonly<DecisionConvergenceDiagnosticsV1>): Promise<void> | void;
}

export interface PressureDecisionConvergencePortV1 {
  converge(
    command: Readonly<DecisionConvergenceCommandV1>,
  ): Promise<DecisionConvergenceResultV1>;
  recordHttpCompletion(
    result: Readonly<DecisionConvergenceResultV1>,
    input: Readonly<{ projectionMs: number; endToEndMs: number }>,
  ): Promise<void>;
  replayReadyChapterPrefix?(
    command: Readonly<{
      runId: string;
      expectedRouteHash: string;
      chapterRuntimeId: string;
      chapterId: ChapterIdV1;
      nowMs: number;
      authority?: Readonly<{
        routeSnapshot: RunRouteSnapshotV1;
        chapter: ChapterOrchestratorStateV1;
        projection: WorkingLedgerProjectionV1;
        seatAuthority: SeatControlSnapshotV1;
      }>;
    }>,
  ): Promise<PreparedChapterReplayBatchResultV1 | null>;
}

/** Original per-seat dependency surface retained but no longer production-wired. */
export interface DecisionAutomationDependenciesV1 {
  scanner: ActivePressureDecisionScannerPortV1;
  routes: DecisionAutomationRouteReaderPortV1;
  orchestrators: DecisionAutomationOrchestratorReaderPortV1;
  working: Pick<WorkingProjectionReaderPort, "load">;
  seats: DecisionAutomationSeatAuthorityReaderPortV1;
  content: DecisionAutomationContentPortV1;
  policy: ContentOwnedAiDecisionPolicyPortV1;
  compiler: DecisionAutomationCommandCompilerPortV1;
  runtime: DecisionAutomationRuntimePortV1;
  deadlineDefaults: PressureDeadlineDefaultCoordinatorPortV1;
  clock: DecisionAutomationClockPortV1;
}

/** Decision-scoped zero-model production dependency surface. */
export interface DecisionConvergenceDependenciesV1 {
  scanner: ActivePressureDecisionScannerPortV1;
  snapshots: DecisionConvergenceSnapshotReaderPortV1;
  content: DecisionAutomationContentPortV1;
  policy: PublishedContentOwnedAiDecisionPolicyPortV1;
  compiler: DecisionAutomationCommandCompilerPortV1;
  preparedActions: PreparedAutomationActionSubmissionPortV1;
  runtime: Pick<
    DecisionAutomationRuntimePortV1,
    "resume" | "resumeFromCommittedSettlementAuthority"
  >;
  deadlineDefaults: PressureDeadlineDefaultCoordinatorPortV1;
  diagnostics: DecisionConvergenceDiagnosticsPortV1;
  clock: DecisionAutomationClockPortV1;
}

export interface DecisionAutomationConfigV1 {
  retryMs: number;
}

export type DecisionAutomationStepResultV1 =
  | { kind: "IDLE" }
  | { kind: "BUSY"; retryAtMs: number }
  | {
      kind: "ACKNOWLEDGED";
      taskHash: string;
      outcome: DecisionAutomationOutcomeKindV1;
      actionId: string | null;
    }
  | {
      kind: "RETRY_SCHEDULED";
      taskHash: string;
      errorCode: string;
      retryAtMs: number;
    };

export interface DecisionAutomationDrainResultV1 {
  results: DecisionAutomationStepResultV1[];
  stoppedBecause: "IDLE" | "BUSY" | "LIMIT";
}

/** Canonical payload owned by the server compiler, never by a model. */
export interface AiDecisionAutomationPayloadV1 extends CanonicalJsonObject {
  source: "CONTENT_OWNED_AI_POLICY";
  policyRef: string;
  policyVersion: string;
  policyHash: string;
  selectionHash: string;
}
