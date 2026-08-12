import type {
  NarrativeAudienceV1,
  OpenNovelNarrativeProjectionJobV1,
} from "@ai-story/shared";

export interface LegacyTerminalInputV1 {
  schemaVersion: "legacy_terminal_input_v1";
  runId: string;
  frozenRouteHash: string;
  sourceTurnId: string;
  sourceRevision: 20;
  terminalSignal: "HANDOFF_READY";
  settledStateHash: string;
  canonBeforeHash: string;
  endingPolicyVersion: string;
  inputHash: string;
}

export interface LegacyCanonFactV1 {
  factId: string;
  factText: string;
  sourceRef: string;
}

export interface CanonicalLegacyCanonMutationV1 {
  mutationId: string;
  operation: "UPSERT_FACT";
  factId: string;
  factText: string;
  sourceRef: string;
}

export interface LegacyAuthoritativeEndingV1 {
  schemaVersion: "legacy_authoritative_ending_v1";
  scope: "PART" | "STORY";
  endingKey: string;
  title: string;
  verdict: "WIN" | "COSTLY_WIN" | "LOSS";
  gain: string[];
  loss: string[];
  causes: Array<{ sourceRef: string; factText: string }>;
  sourceTurnId: string;
  sourceRevision: 20;
}

export interface LegacyStructuredResultV1 {
  schemaVersion: "legacy_structured_result_v1";
  runId: string;
  resultType: "SOLO_PART_END" | "SOLO_STORY_END";
  authoritativeEnding: LegacyAuthoritativeEndingV1;
  causeRefs: string[];
  replayPolicyVersion: string;
}

export interface LegacyTerminalNarrativeOutboxCommandV1 {
  schemaVersion: "legacy_terminal_narrative_outbox_command_v1";
  runId: string;
  audience: NarrativeAudienceV1;
  sourceRuntimeProfile: "OPENNOVEL_T20_V1";
  projectionKind: "FINALE_NARRATIVE";
  sourceAuthority: "LEGACY_TERMINAL_COMMITTED";
  sourceId: string;
  sourceContentHash: string;
  allowedFactIds: string[];
  allowedObjectVersionIds: string[];
  allowedKnowledgeIds: string[];
  narrativeProfileVersion: string;
  idempotencyKey: string;
}

export interface ValidatedLegacyTerminalCommitCommandV1 {
  schemaVersion: "validated_legacy_terminal_commit_command_v1";
  kind: "LEGACY_OPENOVEL";
  runId: string;
  expectedRuntimeTerminalState: "HANDOFF_READY";
  expectedStateHash: string;
  expectedCanonHash: string;
  inputHash: string;
  authoritativeEnding: LegacyAuthoritativeEndingV1;
  canonMutations: CanonicalLegacyCanonMutationV1[];
  canonAfterHash: string;
  structuredResult: LegacyStructuredResultV1;
  structuredResultHash: string;
  resultSchemaVersion: "openovel_result_v2";
  narrativeOutbox: LegacyTerminalNarrativeOutboxCommandV1;
  narrativeOutboxFingerprint: string;
  idempotencyKey: string;
  commandFingerprint: string;
}

export interface LegacyTerminalCommitReceiptV1 {
  schemaVersion: "legacy_terminal_commit_receipt_v1";
  runId: string;
  runtimeTerminalState: "PART_COMPLETE" | "STORY_COMPLETE";
  inputHash: string;
  endingHash: string;
  canonHash: string;
  structuredResultHash: string;
  sourceCommitHash: string;
  narrativeOutboxId: string;
  commitManifestHash: string;
}

export interface LegacyTerminalMaterialV1 {
  canonBefore: LegacyCanonFactV1[];
  terminalFacts: LegacyCanonFactV1[];
  ending: LegacyAuthoritativeEndingV1;
  canonMutations: CanonicalLegacyCanonMutationV1[];
  resultType: "SOLO_PART_END" | "SOLO_STORY_END";
  replayPolicyVersion: string;
  narrativeAudience: NarrativeAudienceV1;
  narrativeProfileVersion: string;
  allowedFactIds: string[];
  allowedObjectVersionIds: string[];
  allowedKnowledgeIds: string[];
}

export interface LegacyUnfinishedTerminalSnapshotV1 {
  kind: "UNFINISHED_T20";
  runId: string;
  runtimeProfile: "OPENNOVEL_T20_V1";
  runtimeTerminalState: "HANDOFF_READY";
  terminalInput: LegacyTerminalInputV1;
  material: LegacyTerminalMaterialV1;
}

export interface LegacyHistoricalCompletedSnapshotV1 {
  kind: "HISTORICAL_COMPLETED";
  runId: string;
  runtimeProfile: "OPENNOVEL_T20_V1";
  runtimeTerminalState: "PART_COMPLETE" | "STORY_COMPLETE";
  frozenHeadHash: string;
  frozenEndingHash: string;
  frozenResultHash: string;
  frozenFinalSceneNarrative: string;
  frozenPayload: unknown;
}

export type LegacyTerminalSourceSnapshotV1 =
  | LegacyUnfinishedTerminalSnapshotV1
  | LegacyHistoricalCompletedSnapshotV1;

export interface LegacyTerminalCommitOutcomeV1 {
  status: "COMMITTED" | "REPLAYED";
  receipt: LegacyTerminalCommitReceiptV1;
  authoritativeEnding: LegacyAuthoritativeEndingV1;
  canon: LegacyCanonFactV1[];
  structuredResult: LegacyStructuredResultV1;
  narrativeOutboxJob: OpenNovelNarrativeProjectionJobV1;
}

export interface LegacyNarrativePresentationV1 {
  schemaVersion: "legacy_narrative_presentation_v1";
  runId: string;
  sourceCommitHash: string;
  narrativeOutboxId: string;
  revision: number;
  status: "FALLBACK_PUBLISHED" | "PUBLISHED";
  text: string;
  contentHash: string;
  presentationHash: string;
}

export interface LegacyTerminalAuthorityReadModelV1 {
  receipt: LegacyTerminalCommitReceiptV1;
  authoritativeEnding: LegacyAuthoritativeEndingV1;
  canon: LegacyCanonFactV1[];
  structuredResult: LegacyStructuredResultV1;
  narrativeOutboxJob: OpenNovelNarrativeProjectionJobV1;
}

export interface LegacyHistoricalReadOnlyResultV1 {
  status: "HISTORICAL_READ_ONLY";
  snapshot: LegacyHistoricalCompletedSnapshotV1;
}

export interface LegacyActiveTerminalResultV1 extends LegacyTerminalCommitOutcomeV1 {
  narrativeStatus: "PENDING" | "FAILED_RETRYABLE";
}

export type LegacyTerminalFinalizeResultV1 =
  | LegacyHistoricalReadOnlyResultV1
  | LegacyActiveTerminalResultV1;

export type LegacyT20CreationIntentV1 =
  | "CREATE_T20"
  | "RESTART_SAME_EXPERIENCE"
  | "START_LATEST_EXPERIENCE";

export interface LegacyCreationPolicyResolutionV1 {
  intent: LegacyT20CreationIntentV1;
  allowed: boolean;
  targetRuntimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1" | null;
  reason: string | null;
}

