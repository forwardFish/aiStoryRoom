import { canonicalJson, isSha256 } from "@ai-story/shared";
import type { ProjectPressureChapterGameProjectionFromSourcesV1 } from "../game-projection/contracts";

export const PRESSURE_SQL7_COMMIT_QUERY_LABELS_V1 = Object.freeze([
  "AUTHORITY_CAS_AND_NEXT_RUNTIME",
  "DECISION_ACTIONS",
  "STORY_EVENTS",
  "CHAPTER_SETTLEMENT",
  "NARRATIVE_PROJECTIONS",
  "OUTBOX_TASKS",
] as const);

export type PressureSql7CommitQueryLabelV1 =
  typeof PRESSURE_SQL7_COMMIT_QUERY_LABELS_V1[number];

export const PRESSURE_SQL7_COMMIT_MAX_APPLICATION_SQL_V1 =
  PRESSURE_SQL7_COMMIT_QUERY_LABELS_V1.length;

export interface PressureSql7AuthorityFenceV1 {
  runId: string;
  routeHash: string;
  chapterRuntimeId: string;
  chapterId: string;
  chapterSequence: number;
  expectedRuntimeState: "DECISION_POINT_OPEN" | "ACTION_DRAFTING";
  expectedRuntimeLockVersion: number;
  expectedWorkingRevision: number;
  expectedWorkingStateHash: string;
  expectedWorkingStateJson: unknown;
  expectedLedgerProjectionJson: unknown;
  expectedOrchestrationHash: string;
  expectedWorldSequence: number;
  expectedReservedWorldSequence: number;
  expectedWorldStateJson: unknown;
  expectedSeatStateRevision: number;
  expectedSeatVersion: number;
  expectedSeatStateHash: string;
  expectedSeatSnapshotJson: unknown;
  expectedOrchestratorEventId: string;
  expectedOrchestratorDedupeKey: string;
  expectedOrchestratorPayloadJson: unknown;
  expectedViewerPlayerId: string;
  expectedViewerUserId: string;
  expectedViewerRoleId: string | null;
  expectedViewerPlayerType: string;
  expectedViewerStatus: string;
  submissionActionId: string;
  submissionIdempotencyKey: string;
  submissionRequestFingerprint: string;
}

export interface PressureSql7FrozenRuntimeV1 {
  workingRevision: number;
  workingStateJson: unknown;
  workingStateHash: string;
  decisionStateJson: unknown;
  ledgerProjectionJson: unknown;
  closeInputHash: string;
  frozenAt: Date;
}

export interface PressureSql7NextRuntimeRowV1 {
  id: string;
  runId: string;
  chapterId: string;
  chapterSequence: number;
  state: "CHAPTER_OPENING" | "CHAPTER_ACTIVE" | "DECISION_POINT_OPEN";
  baseWorldSequence: number;
  baseWorldStateHash: string;
  previousFrozenHash: string;
  routeHash: string;
  contentPackageVersion: string;
  contentHash: string;
  orchestrationPackageVersion: string;
  orchestrationHash: string;
  runtimeContractVersion: string;
  runtimeContractHash: string;
  workingRevision: number;
  workingStateJson: unknown;
  workingStateHash: string;
  decisionStateJson: unknown;
  ledgerProjectionJson: unknown;
  closeInputHash: string | null;
  lockVersion: number;
  openedAt: Date;
}

export interface PressureSql7WorldTransitionV1 {
  committedWorldSequence: number;
  reservedWorldSequence: number;
  committedWorldStateJson: unknown;
  currentChapter: number;
  currentNodeId: string;
  nextRuntime: PressureSql7NextRuntimeRowV1;
}

export interface PressureSql7DecisionActionRowV1 {
  id: string;
  runId: string;
  chapterRuntimeId: string;
  decisionPointId: string;
  seatId: string;
  actionOrdinal: number;
  actionType: string;
  status: "DRAFT" | "CONFIRMED" | "SEALED" | "REJECTED";
  controlEpoch: number;
  expectedWorkingRevision: number;
  currentRevision: number;
  idempotencyKey: string;
  requestFingerprint: string;
  payloadJson: unknown;
  payloadHash: string;
  sealedHash: string | null;
  authorityEventHash: string;
  confirmedAt: Date | null;
  sealedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PressureSql7StoryEventRowV1 {
  id: string;
  runId: string;
  day: number;
  type: string;
  messageType: string;
  roleKey: string | null;
  visibility: string;
  payloadJson: unknown;
  sequence: number | null;
  dedupeKey: string | null;
  audienceType: string | null;
  audienceRoleIdsJson: unknown | null;
  sourceActionId: string | null;
  createdAt: Date;
}

export interface PressureSql7ChapterSettlementRowV1 {
  id: string;
  runId: string;
  chapterRuntimeId: string;
  chapterId: string;
  chapterSequence: number;
  schemaVersion: string;
  idempotencyKey: string;
  requestFingerprint: string;
  baseWorldSequence: number;
  committedWorldSequence: number;
  baseWorldStateHash: string;
  committedWorldStateHash: string;
  inputJson: unknown;
  inputHash: string;
  evaluationJson: unknown;
  evaluationHash: string;
  worldDeltaJson: unknown;
  worldDeltaHash: string;
  decisionLedgerHash: string;
  finalWorkingStateHash: string;
  reservationLedgerHash: string;
  frozenBundleHash: string;
  commitManifestJson: unknown;
  commitManifestHash: string;
  rootEventId: string;
  outboxDedupeKeysJson: unknown;
  commitHash: string;
  committedAt: Date;
}

export interface PressureSql7NarrativeProjectionRowV1 {
  id: string;
  runId: string;
  projectionKind: "GENESIS_NARRATIVE" | "BEAT_NARRATIVE" | "CHAPTER_NARRATIVE" | "FINALE_NARRATIVE";
  sourceAuthority: "GENESIS_FROZEN" | "CHAPTER_WORKING" | "CHAPTER_FROZEN" | "FINALE_FROZEN" | "LEGACY_TERMINAL_COMMITTED";
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  narrativeProfileVersion: string;
  projectorVersion: string;
  audienceKind: "PUBLIC" | "SEAT";
  audienceSeatId: string | null;
  audienceKey: string;
  status: "PENDING" | "GENERATING" | "VALIDATING" | "PUBLISHED" | "FALLBACK_PUBLISHED" | "FAILED_RETRYABLE";
  requestFingerprint: string;
  attempt: number;
  maxAttempts: number;
  checkpoint: "PERSISTED" | "LEASED" | "HANDLER_STARTED" | "HANDLER_COMMITTED" | "PUBLISHED" | "ACKNOWLEDGED" | "FAILED_RETRYABLE" | "DEAD_LETTER";
  artifactJson: unknown | null;
  artifactContentHash: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseVersion: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

export interface PressureSql7OutboxTaskRowV1 {
  id: string;
  runId: string;
  taskType: "OPEN_CHAPTER" | "PROJECT_GENESIS_NARRATIVE" | "PROJECT_BEAT_NARRATIVE" | "PROJECT_CHAPTER_NARRATIVE" | "COMPUTE_FINALE" | "PROJECT_FINALE_NARRATIVE" | "INTERACTION_COMPILE_REQUESTED" | "PUBLISH_RESULT";
  status: "PENDING" | "LEASED" | "RETRYABLE" | "COMPLETED" | "DEAD_LETTER";
  checkpoint: "PERSISTED" | "LEASED" | "HANDLER_STARTED" | "HANDLER_COMMITTED" | "PUBLISHED" | "ACKNOWLEDGED" | "FAILED_RETRYABLE" | "DEAD_LETTER";
  dedupeKey: string;
  sourceAuthority: "GENESIS_FROZEN" | "CHAPTER_WORKING" | "CHAPTER_FROZEN" | "FINALE_FROZEN" | "LEGACY_TERMINAL_COMMITTED";
  sourceId: string;
  sourceCommitHash: string;
  payloadJson: unknown;
  payloadHash: string;
  attempt: number;
  maxAttempts: number;
  availableAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseVersion: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface CommittedDecisionToNextProjectionAuthorityV1 {
  schemaVersion: "pressure_committed_decision_to_next_projection_authority_v1";
  runId: string;
  previousChapterRuntimeId: string;
  nextChapterRuntimeId: string;
  settlementId: string;
  committedWorldSequence: number;
  commitHash: string;
  projectionAuthority: ProjectPressureChapterGameProjectionFromSourcesV1;
}

export interface PressureSql7CommitPlanV1 {
  schemaVersion: "pressure_sql7_commit_plan_v1";
  fence: PressureSql7AuthorityFenceV1;
  frozenRuntime: PressureSql7FrozenRuntimeV1;
  worldTransition: PressureSql7WorldTransitionV1;
  decisionActions: readonly PressureSql7DecisionActionRowV1[];
  storyEvents: readonly PressureSql7StoryEventRowV1[];
  settlement: PressureSql7ChapterSettlementRowV1;
  narrativeProjections: readonly PressureSql7NarrativeProjectionRowV1[];
  outboxTasks: readonly PressureSql7OutboxTaskRowV1[];
  receipt: CommittedDecisionToNextProjectionAuthorityV1;
}

export type PressureSql7CommitErrorCodeV1 =
  | "INVALID_PLAN"
  | "AUTHORITY_FENCE_MISMATCH"
  | "PERSISTED_COUNT_MISMATCH"
  | "QUERY_BUDGET_EXCEEDED";

export class PressureSql7CommitErrorV1 extends Error {
  constructor(
    readonly code: PressureSql7CommitErrorCodeV1,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "PressureSql7CommitErrorV1";
  }
}

export function validatePressureSql7CommitPlanV1(
  plan: Readonly<PressureSql7CommitPlanV1>,
): PressureSql7CommitPlanV1 {
  if (plan.schemaVersion !== "pressure_sql7_commit_plan_v1") invalid("schemaVersion");
  const { fence, frozenRuntime, worldTransition, settlement, receipt } = plan;
  requireText(fence.runId, "fence.runId");
  requireHash(fence.routeHash, "fence.routeHash");
  requireText(fence.chapterRuntimeId, "fence.chapterRuntimeId");
  requireText(fence.chapterId, "fence.chapterId");
  requireNonNegativeInteger(fence.chapterSequence, "fence.chapterSequence");
  requireNonNegativeInteger(fence.expectedRuntimeLockVersion, "fence.expectedRuntimeLockVersion");
  requireNonNegativeInteger(fence.expectedWorkingRevision, "fence.expectedWorkingRevision");
  requireHash(fence.expectedWorkingStateHash, "fence.expectedWorkingStateHash");
  requireHash(fence.expectedOrchestrationHash, "fence.expectedOrchestrationHash");
  requireNonNegativeInteger(fence.expectedWorldSequence, "fence.expectedWorldSequence");
  requireNonNegativeInteger(fence.expectedReservedWorldSequence, "fence.expectedReservedWorldSequence");
  requireNonNegativeInteger(fence.expectedSeatStateRevision, "fence.expectedSeatStateRevision");
  requireNonNegativeInteger(fence.expectedSeatVersion, "fence.expectedSeatVersion");
  requireHash(fence.expectedSeatStateHash, "fence.expectedSeatStateHash");
  requireText(fence.expectedOrchestratorEventId, "fence.expectedOrchestratorEventId");
  requireText(fence.expectedOrchestratorDedupeKey, "fence.expectedOrchestratorDedupeKey");
  requireText(fence.expectedViewerPlayerId, "fence.expectedViewerPlayerId");
  requireText(fence.expectedViewerUserId, "fence.expectedViewerUserId");
  requireText(fence.expectedViewerPlayerType, "fence.expectedViewerPlayerType");
  requireText(fence.expectedViewerStatus, "fence.expectedViewerStatus");
  requireText(fence.submissionActionId, "fence.submissionActionId");
  requireText(fence.submissionIdempotencyKey, "fence.submissionIdempotencyKey");
  requireHash(fence.submissionRequestFingerprint, "fence.submissionRequestFingerprint");
  requireJson(fence.expectedWorkingStateJson, "fence.expectedWorkingStateJson");
  requireJson(fence.expectedLedgerProjectionJson, "fence.expectedLedgerProjectionJson");
  requireJson(fence.expectedWorldStateJson, "fence.expectedWorldStateJson");
  requireJson(fence.expectedSeatSnapshotJson, "fence.expectedSeatSnapshotJson");
  requireJson(fence.expectedOrchestratorPayloadJson, "fence.expectedOrchestratorPayloadJson");

  requireHash(frozenRuntime.workingStateHash, "frozenRuntime.workingStateHash");
  requireHash(frozenRuntime.closeInputHash, "frozenRuntime.closeInputHash");
  requireDate(frozenRuntime.frozenAt, "frozenRuntime.frozenAt");
  requireJson(frozenRuntime.workingStateJson, "frozenRuntime.workingStateJson");
  requireJson(frozenRuntime.decisionStateJson, "frozenRuntime.decisionStateJson");
  requireJson(frozenRuntime.ledgerProjectionJson, "frozenRuntime.ledgerProjectionJson");
  const next = worldTransition.nextRuntime;
  if (
    next.runId !== fence.runId
    || next.routeHash !== fence.routeHash
    || next.chapterSequence !== fence.chapterSequence + 1
    || next.baseWorldSequence !== worldTransition.committedWorldSequence
    || settlement.committedWorldSequence !== worldTransition.committedWorldSequence
    || settlement.baseWorldSequence !== fence.expectedWorldSequence
  ) invalid("worldTransition binding");
  requireText(next.id, "worldTransition.nextRuntime.id");
  requireText(next.chapterId, "worldTransition.nextRuntime.chapterId");
  requireHash(next.baseWorldStateHash, "worldTransition.nextRuntime.baseWorldStateHash");
  requireHash(next.previousFrozenHash, "worldTransition.nextRuntime.previousFrozenHash");
  requireHash(next.contentHash, "worldTransition.nextRuntime.contentHash");
  requireHash(next.orchestrationHash, "worldTransition.nextRuntime.orchestrationHash");
  requireHash(next.runtimeContractHash, "worldTransition.nextRuntime.runtimeContractHash");
  requireHash(next.workingStateHash, "worldTransition.nextRuntime.workingStateHash");
  requireDate(next.openedAt, "worldTransition.nextRuntime.openedAt");
  requireJson(worldTransition.committedWorldStateJson, "worldTransition.committedWorldStateJson");
  requireJson(next.workingStateJson, "worldTransition.nextRuntime.workingStateJson");
  requireJson(next.decisionStateJson, "worldTransition.nextRuntime.decisionStateJson");
  requireJson(next.ledgerProjectionJson, "worldTransition.nextRuntime.ledgerProjectionJson");

  if (!plan.decisionActions.length) invalid("decisionActions must not be empty");
  if (!plan.storyEvents.length) invalid("storyEvents must not be empty");
  if (!plan.narrativeProjections.length) invalid("narrativeProjections must not be empty");
  if (!plan.outboxTasks.length) invalid("outboxTasks must not be empty");
  assertUnique(plan.decisionActions.map((row) => row.id), "decisionActions.id");
  assertUnique(plan.storyEvents.map((row) => row.id), "storyEvents.id");
  assertUnique(plan.narrativeProjections.map((row) => row.id), "narrativeProjections.id");
  assertUnique(plan.outboxTasks.map((row) => row.id), "outboxTasks.id");
  assertRunBindings(plan.decisionActions, fence.runId, "decisionActions");
  assertRunBindings(plan.storyEvents, fence.runId, "storyEvents");
  assertRunBindings(plan.narrativeProjections, fence.runId, "narrativeProjections");
  assertRunBindings(plan.outboxTasks, fence.runId, "outboxTasks");
  if (plan.decisionActions.some((row) => row.chapterRuntimeId !== fence.chapterRuntimeId)) {
    invalid("decisionActions.chapterRuntimeId");
  }
  const submission = plan.decisionActions.find((row) => row.id === fence.submissionActionId);
  if (
    !submission
    || submission.idempotencyKey !== fence.submissionIdempotencyKey
    || submission.requestFingerprint !== fence.submissionRequestFingerprint
  ) invalid("submission idempotency binding");
  plan.decisionActions.forEach((row, index) => {
    requireJson(row.payloadJson, `decisionActions[${index}].payloadJson`);
    requireDate(row.createdAt, `decisionActions[${index}].createdAt`);
    requireDate(row.updatedAt, `decisionActions[${index}].updatedAt`);
  });
  plan.storyEvents.forEach((row, index) =>
    requireJson(row.payloadJson, `storyEvents[${index}].payloadJson`));
  if (
    settlement.runId !== fence.runId
    || settlement.chapterRuntimeId !== fence.chapterRuntimeId
    || settlement.chapterId !== fence.chapterId
    || settlement.chapterSequence !== fence.chapterSequence
  ) invalid("settlement binding");
  requireHash(settlement.commitHash, "settlement.commitHash");
  requireJson(settlement.inputJson, "settlement.inputJson");
  requireJson(settlement.evaluationJson, "settlement.evaluationJson");
  requireJson(settlement.worldDeltaJson, "settlement.worldDeltaJson");
  requireJson(settlement.commitManifestJson, "settlement.commitManifestJson");
  requireJson(settlement.outboxDedupeKeysJson, "settlement.outboxDedupeKeysJson");
  plan.narrativeProjections.forEach((row, index) => {
    if (row.artifactJson !== null) {
      requireJson(row.artifactJson, `narrativeProjections[${index}].artifactJson`);
    }
    requireDate(row.createdAt, `narrativeProjections[${index}].createdAt`);
    requireDate(row.updatedAt, `narrativeProjections[${index}].updatedAt`);
  });
  plan.outboxTasks.forEach((row, index) => {
    requireJson(row.payloadJson, `outboxTasks[${index}].payloadJson`);
    requireDate(row.availableAt, `outboxTasks[${index}].availableAt`);
    requireDate(row.createdAt, `outboxTasks[${index}].createdAt`);
    requireDate(row.updatedAt, `outboxTasks[${index}].updatedAt`);
  });
  if (
    receipt.schemaVersion !== "pressure_committed_decision_to_next_projection_authority_v1"
    || receipt.runId !== fence.runId
    || receipt.previousChapterRuntimeId !== fence.chapterRuntimeId
    || receipt.nextChapterRuntimeId !== next.id
    || receipt.settlementId !== settlement.id
    || receipt.committedWorldSequence !== worldTransition.committedWorldSequence
    || receipt.commitHash !== settlement.commitHash
  ) invalid("receipt binding");
  return structuredClone(plan);
}

function assertRunBindings(
  rows: readonly { runId: string }[],
  runId: string,
  path: string,
): void {
  if (rows.some((row) => row.runId !== runId)) invalid(`${path}.runId`);
}

function assertUnique(values: readonly string[], path: string): void {
  values.forEach((value, index) => requireText(value, `${path}[${index}]`));
  if (new Set(values).size !== values.length) invalid(`${path} must be unique`);
}

function requireText(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value) invalid(path);
}

function requireHash(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) invalid(path);
}

function requireNonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path);
}

function requireDate(value: unknown, path: string): asserts value is Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalid(path);
}

function requireJson(value: unknown, path: string): void {
  try {
    canonicalJson(value);
  } catch {
    invalid(path);
  }
}

function invalid(path: string): never {
  throw new PressureSql7CommitErrorV1(
    "INVALID_PLAN",
    `Pressure SQL7 commit plan is invalid at ${path}`,
    { path },
  );
}
