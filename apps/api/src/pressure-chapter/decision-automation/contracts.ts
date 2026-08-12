import type {
  CanonicalJsonObject,
  ChapterIdV1,
  RunRouteSnapshotV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  AuthoredChapterRuntimeV1,
  ChapterOrchestratorStateV1,
  SubmitOrchestratedActionCommandV1,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type { SeatControlSnapshotV1 } from "../seat-control/types";
import type { WorkingLedgerProjectionV1 } from "../working-ledger/contracts";
import type { PressureDeadlineDefaultCoordinatorPortV1 } from "../deadline-default-production/contracts";

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
  | "DEADLINE_ADVANCED"
  | "AI_FAILURE_DEFAULTED"
  | "STALE_SKIPPED";

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
 * Read-only scan seam. A production implementation scans only started
 * Pressure runs whose W4 state is ACTIVE, then returns at most one canonical
 * task per (run, chapterRuntime, decision, seat, controlEpoch). It must never
 * scan or write a Provider, Narrative artifact, Result projection, or
 * client-owned queue. Concurrency is closed by deterministic action identity,
 * W5 idempotency, W4 CAS, and resume reconciliation instead of another queue.
 */
export interface ActivePressureDecisionScannerPortV1 {
  scanActive(): Promise<DecisionAutomationTaskV1[]>;
}

/** Read-only wrapper over the immutable stored Run route. */
export interface DecisionAutomationRouteReaderPortV1 {
  readRoute(runId: string): Promise<RunRouteSnapshotV1 | null>;
}

/** Read-only W4 seam; deliberately excludes compareAndSwap. */
export interface DecisionAutomationOrchestratorReaderPortV1 {
  read(runId: string): Promise<ChapterOrchestratorStateV1 | null>;
}

/** Read-only seat authority seam; deliberately excludes transitions/defaults. */
export interface DecisionAutomationSeatAuthorityReaderPortV1 {
  readSnapshot(runId: string): Promise<SeatControlSnapshotV1 | null>;
}

/** Existing authored W4 content, resolved by the frozen route. */
export interface DecisionAutomationContentPortV1 {
  load(input: Readonly<{
    routeSnapshot: RunRouteSnapshotV1;
    chapterId: ChapterIdV1;
  }>): Promise<AuthoredChapterRuntimeV1>;
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

/**
 * Trusted content boundary. Its production implementation must load the
 * published, hash-pinned policy belonging to route.contentPackageSha256. It is
 * deterministic and cannot call an LLM/Provider or read player free text.
 */
export interface ContentOwnedAiDecisionPolicyPortV1 {
  select(
    input: Readonly<AiDecisionPolicyInputV1>,
  ): Promise<AiDecisionPolicySelectionV1> | AiDecisionPolicySelectionV1;
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

/**
 * Narrow runtime command surface. It cannot write world/finale/narrative.
 * resume() exists only to reconcile an already accepted ledger action after a
 * crash between W5 append and W4 recordAction.
 */
export interface DecisionAutomationRuntimePortV1 {
  submitAction(
    command: SubmitOrchestratedActionCommandV1,
  ): Promise<ChapterOrchestratorStateV1>;
  resume(
    routeSnapshot: RunRouteSnapshotV1,
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

/** Canonical payload owned by the server compiler, never by the policy port. */
export interface AiDecisionAutomationPayloadV1 extends CanonicalJsonObject {
  source: "CONTENT_OWNED_AI_POLICY";
  policyRef: string;
  policyVersion: string;
  policyHash: string;
  selectionHash: string;
}
