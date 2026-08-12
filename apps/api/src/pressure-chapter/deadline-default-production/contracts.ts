import type {
  RunRouteSnapshotV1,
  SeatIdV1,
} from "@ai-story/shared";
import type {
  ChapterOrchestratorStateV1,
  AuthoredChapterContentPort,
  ChapterOrchestratorStatePort,
  WorkingProjectionReaderPort,
} from "../orchestrator/contracts";
import type {
  FrozenDefaultSourceProofV1,
  FrozenDeadlineTakeoverProofV1,
  SeatControlSnapshotV1,
} from "../seat-control/types";
import type { SeatControlService } from "../seat-control/seat-control.service";

export type PressureSeatDecisionProofKindV1 =
  | "DEADLINE_TAKEOVER"
  | "DEFAULT_SOURCE";

export type PressureSeatDecisionProofV1 =
  | FrozenDeadlineTakeoverProofV1
  | FrozenDefaultSourceProofV1;

export interface PersistPressureSeatDecisionProofCommandV1 {
  proofKind: PressureSeatDecisionProofKindV1;
  proof: PressureSeatDecisionProofV1;
  authorityStateHash: string;
  frozenPolicyHash: string;
}

/**
 * Durable proof writer. The database row is the authority consumed by
 * SeatControlDecisionAuthorityPort; an in-memory or transport-only proof is
 * deliberately insufficient.
 */
export interface PressureSeatDecisionProofWriterPortV1 {
  persistOnce(
    command: Readonly<PersistPressureSeatDecisionProofCommandV1>,
  ): Promise<{ status: "COMMITTED" | "REPLAYED" }>;
}

export interface DeadlineDefaultRuntimePortV1 {
  resume(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1>;
  advanceDeadline(
    routeSnapshot: RunRouteSnapshotV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1>;
  applyAiFailure(
    routeSnapshot: RunRouteSnapshotV1,
    seatId: SeatIdV1,
    nowMs: number,
  ): Promise<ChapterOrchestratorStateV1>;
}

export interface DeadlineDefaultSeatControlPortV1 extends Pick<
  SeatControlService,
  "takeoverAtFrozenDeadline" | "resolveDeterministicDefault"
> {}

export interface PressureDeadlineDefaultProductionDependenciesV1 {
  orchestrators: Pick<ChapterOrchestratorStatePort, "read">;
  working: Pick<WorkingProjectionReaderPort, "load">;
  content: AuthoredChapterContentPort;
  seats: {
    readSnapshot(runId: string): Promise<SeatControlSnapshotV1 | null>;
  };
  seatControl: DeadlineDefaultSeatControlPortV1;
  proofs: PressureSeatDecisionProofWriterPortV1;
  runtime: DeadlineDefaultRuntimePortV1;
}

export interface DeadlineDefaultExpectedDecisionV1 {
  chapterRuntimeId: string;
  decisionPointId: string;
  expectedOrchestratorRevision: number;
}

export type DeadlineDefaultProductionResultV1 =
  | {
      kind: "APPLIED";
      state: ChapterOrchestratorStateV1;
    }
  | {
      kind: "STALE";
      state: ChapterOrchestratorStateV1;
    };

export interface PressureDeadlineDefaultCoordinatorPortV1 {
  advanceExpiredDecision(input: Readonly<{
    routeSnapshot: RunRouteSnapshotV1;
    expected: DeadlineDefaultExpectedDecisionV1;
    nowMs: number;
  }>): Promise<DeadlineDefaultProductionResultV1>;
  applyAiFailure(input: Readonly<{
    routeSnapshot: RunRouteSnapshotV1;
    expected: DeadlineDefaultExpectedDecisionV1;
    seatId: SeatIdV1;
    failureCode: string;
    nowMs: number;
  }>): Promise<DeadlineDefaultProductionResultV1>;
}
