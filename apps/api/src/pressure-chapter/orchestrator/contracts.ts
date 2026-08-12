import type {
  BeatResolutionV1,
  ChapterIdV1,
  DecisionActionV1,
  DecisionPointDefinitionV1,
  DeterministicDefaultPolicyV1,
  FrozenChapterBundleV1,
  RunRouteSnapshotV1,
  SealedChapterSettlementInputV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  ChapterWorkingState,
  PressureChapterDefinition,
} from "@ai-story/templates";
import type {
  SubmitFormalInteractionCommandV1,
  SubmitFormalInteractionResultV1,
} from "../interaction/contracts";
import type {
  WorkingActionIntentV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import type {
  OpenWorkingLedgerCommandV1,
} from "../working-ledger/working-ledger.service";

export type AuthoredSeatRequirementV1 = "REQUIRED" | "NOT_REQUIRED";

export interface AuthoredDecisionRuntimeV1 {
  decisionPointId: string;
  execution: DecisionPointDefinitionV1;
  seatRequirements: Record<SeatIdV1, AuthoredSeatRequirementV1>;
}

export interface AuthoredChapterRuntimeV1 {
  schemaVersion: "pressure_authored_chapter_runtime_v1";
  chapterId: ChapterIdV1;
  definition: PressureChapterDefinition;
  decisions: AuthoredDecisionRuntimeV1[];
  chapterClosePolicy: {
    kind: "ALL_AUTHORED_DECISION_POINTS_COMPLETED";
    decisionPointIds: string[];
  };
  contentPolicyVersion: string;
  contentPolicyHash: string;
  settlementContractVersion: string;
  settlementContractHash: string;
  descriptorHash: string;
}

export interface ChapterAuthorityBaseV1 {
  baseWorldSequence: number;
  baseWorldStateHash: string;
  previousFrozenHash: string;
}

export interface ActiveDecisionSeatV1 {
  seatId: SeatIdV1;
  requirement: AuthoredSeatRequirementV1;
  completion: "PENDING" | "SEALED_ACTIONS" | "DEFAULTED" | "NOT_REQUIRED";
  actionIds: string[];
  actionCount: number;
  defaultCode: string | null;
}

export interface ActiveDecisionStateV1 {
  decisionPointId: string;
  policyHash: string;
  openedAtMs: number;
  deadlineAtMs: number | null;
  seats: ActiveDecisionSeatV1[];
}

export interface ChapterSeatSummaryV1 {
  seatId: SeatIdV1;
  requirement: AuthoredSeatRequirementV1;
  sealedActionIds: string[];
  defaultActionIds: string[];
  defaultCodes: string[];
}

export type ChapterOrchestratorPhaseV1 =
  | "ACTIVE"
  | "RESOLVING_BEAT"
  | "SETTLING"
  | "FROZEN"
  | "FINALE_REQUESTED";

export interface ChapterOrchestratorStateV1 {
  schemaVersion: "pressure_chapter_orchestrator_state_v1";
  runId: string;
  routeHash: string;
  revision: number;
  phase: ChapterOrchestratorPhaseV1;
  currentChapterId: ChapterIdV1;
  chapterRuntimeId: string;
  descriptorHash: string;
  authorityBase: ChapterAuthorityBaseV1;
  activeDecision: ActiveDecisionStateV1 | null;
  chapterSeatSummaries: ChapterSeatSummaryV1[];
  settlementInputHash: string | null;
  frozenBundleHash: string | null;
  orchestratorHash: string;
}

export interface ChapterOrchestratorStatePort {
  read(runId: string): Promise<ChapterOrchestratorStateV1 | null>;
  compareAndSwap(input: {
    runId: string;
    expectedRevision: number | null;
    next: ChapterOrchestratorStateV1;
  }): Promise<{
    status: "COMMITTED" | "CONFLICT";
    current: ChapterOrchestratorStateV1 | null;
  }>;
}

export interface AuthoredChapterContentPort {
  load(input: {
    routeSnapshot: RunRouteSnapshotV1;
    chapterId: ChapterIdV1;
  }): Promise<AuthoredChapterRuntimeV1>;
}

export interface ChapterWorkingSeedPort {
  load(input: {
    routeSnapshot: RunRouteSnapshotV1;
    chapter: AuthoredChapterRuntimeV1;
    authorityBase: ChapterAuthorityBaseV1;
  }): Promise<ChapterWorkingState>;
}

export interface WorkingLedgerOpeningPort {
  open(command: OpenWorkingLedgerCommandV1): Promise<{
    status: "OPENED" | "REPLAYED";
    event: unknown;
  }>;
}

export interface WorkingProjectionReaderPort {
  load(input: {
    runId: string;
    chapterRuntimeId: string;
  }): Promise<WorkingLedgerProjectionV1>;
}

export interface FormalActionSubmissionPort {
  submit(command: SubmitFormalInteractionCommandV1): Promise<SubmitFormalInteractionResultV1>;
}

/**
 * W5 bridge. Single-action implementations may delegate to WorkingBeatApplicationService;
 * sync contests may aggregate multiple sealed actions before emitting one BeatResolutionV1.
 */
export interface DecisionBeatResolutionPort {
  resolve(input: {
    routeSnapshot: RunRouteSnapshotV1;
    chapterRuntimeId: string;
    chapterDefinition: PressureChapterDefinition;
    actionIds: string[];
    resolverVersion: string;
  }): Promise<{
    status: "APPLIED" | "REPLAYED";
    resolution: BeatResolutionV1;
    projection: WorkingLedgerProjectionV1;
  }>;
}

export interface DecisionCloseEvaluatorPort {
  isClosed(input: {
    decision: AuthoredDecisionRuntimeV1;
    active: ActiveDecisionStateV1;
    projection: WorkingLedgerProjectionV1;
  }): Promise<boolean>;
}

export interface DeterministicDefaultActionPort {
  submit(input: {
    routeSnapshot: RunRouteSnapshotV1;
    chapterRuntimeId: string;
    chapterId: ChapterIdV1;
    decisionPointId: string;
    seatId: SeatIdV1;
    expectedWorkingRevision: number;
    policy: DeterministicDefaultPolicyV1;
    reason: "DEADLINE" | "AI_FAILURE";
    idempotencyKey: string;
  }): Promise<{ status: "ACCEPTED" | "REPLAYED"; actionId: string }>;
}

export interface ChapterSettlementPort {
  settle(input: {
    routeSnapshot: RunRouteSnapshotV1;
    settlementInput: SealedChapterSettlementInputV1;
    chapterDescriptorHash: string;
    seatParticipation: Array<{
      seatId: SeatIdV1;
      requirement: AuthoredSeatRequirementV1;
      completion:
        | "SEALED_ACTIONS"
        | "DEFAULTED"
        | "MIXED_ACTIONS"
        | "NOT_REQUIRED";
      defaultCodes: string[];
    }>;
  }): Promise<{ status: "SETTLED" | "REPLAYED"; frozenBundle: FrozenChapterBundleV1 }>;
}

export interface FinaleRequestPort {
  request(input: {
    runId: string;
    routeHash: string;
    n7FrozenBundleHash: string;
    idempotencyKey: string;
  }): Promise<{ status: "REQUESTED" | "REPLAYED" }>;
}

export interface StartChapterRunCommandV1 {
  routeSnapshot: RunRouteSnapshotV1;
  genesisWorldStateHash: string;
  genesisHash: string;
  nowMs: number;
}

export interface SubmitOrchestratedActionCommandV1 {
  routeSnapshot: RunRouteSnapshotV1;
  subjectId: string;
  action: DecisionActionV1;
  intent: WorkingActionIntentV1;
  inputFingerprint: string;
  nowMs: number;
}
