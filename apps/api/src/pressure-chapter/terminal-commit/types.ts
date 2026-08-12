import type {
  AuthoritativePressureResultSnapshotV1,
  OpenNovelNarrativeProjectionJobV1,
  SangtianPressureFinaleDecisionV1,
} from "@ai-story/shared";
import type { FinaleShadowComparisonV1 } from "@ai-story/templates";

export type TerminalResultArtifactV1 = AuthoritativePressureResultSnapshotV1;

export interface FinaleNarrativeOutboxV1 {
  schemaVersion: "sangtian_finale_narrative_outbox_v1";
  runId: string;
  dedupeKey: string;
  sourceCommitHash: string;
  sourceDecisionHash: string;
  status: "PENDING";
  jobs: OpenNovelNarrativeProjectionJobV1[];
  outboxHash: string;
}

export interface AuthorityFirstTerminalRecordV1 {
  schemaVersion: "authority_first_terminal_record_v1";
  runId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  inputHash: string;
  policyHash: string;
  decision: SangtianPressureFinaleDecisionV1;
  seatOutcomes: SangtianPressureFinaleDecisionV1["seats"];
  resultArtifact: TerminalResultArtifactV1;
  narrativeOutbox: FinaleNarrativeOutboxV1;
  authorityCommitHash: string;
  atomicRecordHash: string;
}

export interface AuthorityFirstTerminalCommitResultV1 {
  status: "COMMITTED" | "REPLAYED";
  record: AuthorityFirstTerminalRecordV1;
}

export interface TerminalPostCommitStatusV1 {
  narrativeOutboxSignal: "NOTIFIED" | "FAILED_RETRYABLE" | "NOT_RUN";
  genericShadow: "MATCH" | "MISMATCH" | "FAILED_ISOLATED" | "NOT_RUN";
  shadowReport: FinaleShadowComparisonV1 | null;
}

export interface FinalizePressureRunResultV1 {
  status: "COMMITTED" | "REPLAYED";
  record: AuthorityFirstTerminalRecordV1;
  postCommit: TerminalPostCommitStatusV1;
}
