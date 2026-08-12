import {
  hashWithoutField,
  isSha256,
  compareCanonicalText,
  compileB0ChapterSettlementInputV1,
  nextChapterId,
  chapterSequence,
  sha256Canonical,
  validateB0SettlementCommitResultV1,
  validateChapterIdV1,
  validateChapterSettlementEvaluationV1,
  validateFrozenChapterBundleV1,
  validateSealedChapterSettlementInputV1,
  validateWorldDeltaV1,
  validateWorldStateV1,
  type B0SettlementCommitResultV1,
  type ChapterSettlementEvaluationV1,
  type FrozenChapterBundleV1,
  type SeatIdV1,
  type WorldStateV1,
} from "@ai-story/shared";
import {
  CHAPTER_SETTLEMENT_ERROR_CODES as ERROR,
  failChapterSettlement,
} from "./errors";
import type {
  AtomicChapterCommitRecordV1,
  ChapterCloseFenceV1,
  ChapterFrozenRootEventV1,
  ChapterHandoffOutboxV1,
  ChapterSettlementSourceV1,
  CommitChapterFenceV1,
  SettleChapterCommandV1,
} from "./types";

const CLOSE_FENCE_KEYS = [
  "schemaVersion",
  "runId",
  "chapterRuntimeId",
  "chapterId",
  "lifecycleState",
  "closedWorkingRevision",
  "observedWorkingRevision",
  "closedWorkingStateHash",
  "observedWorkingStateHash",
  "closedDecisionLedgerHash",
  "observedDecisionLedgerHash",
  "closedActionCount",
  "observedActionCount",
  "baseWorldSequenceAtClose",
  "observedWorldSequence",
  "baseWorldStateHashAtClose",
  "observedWorldStateHash",
  "runRouteHashAtClose",
  "previousFrozenHashAtClose",
  "reservationLedgerHashAtClose",
  "contentPolicyVersionAtClose",
  "contentPolicyHashAtClose",
  "settlementContractVersionAtClose",
  "settlementContractHashAtClose",
  "closeFenceHash",
] as const;
const SOURCE_KEYS = [
  "schemaVersion",
  "closeFence",
  "sealedInput",
  "settlementMaterial",
  "baseWorldState",
  "sourceHash",
] as const;
const COMMIT_FENCE_KEYS = [
  "expectedLifecycleState",
  "expectedWorkingRevision",
  "expectedWorkingStateHash",
  "expectedDecisionLedgerHash",
  "expectedActionCount",
  "expectedWorldSequence",
  "expectedWorldStateHash",
  "closeFenceHash",
] as const;
const ROOT_EVENT_KEYS = [
  "schemaVersion",
  "eventId",
  "eventType",
  "runId",
  "chapterRuntimeId",
  "chapterId",
  "chapterSequence",
  "baseWorldSequence",
  "committedWorldSequence",
  "settlementInputHash",
  "evaluationHash",
  "worldDeltaHash",
  "bundleHash",
  "eventHash",
] as const;
const OUTBOX_KEYS = [
  "schemaVersion",
  "taskType",
  "status",
  "dedupeKey",
  "runId",
  "chapterRuntimeId",
  "sourceRootEventId",
  "sourceRootEventHash",
  "sourceBundleHash",
  "target",
  "outboxHash",
] as const;
const ATOMIC_RECORD_KEYS = [
  "schemaVersion",
  "runId",
  "chapterRuntimeId",
  "chapterId",
  "idempotencyKey",
  "requestFingerprint",
  "sourceHash",
  "commitFence",
  "sealedInput",
  "worldDelta",
  "settlement",
  "frozenChapterBundle",
  "rootEvent",
  "outbox",
  "receipt",
  "atomicRecordHash",
] as const;

export function sealChapterCloseFenceV1(
  draft: Omit<ChapterCloseFenceV1, "closeFenceHash">,
): ChapterCloseFenceV1 {
  return validateChapterCloseFenceV1({
    ...structuredClone(draft),
    closeFenceHash: sha256Canonical(draft),
  });
}

export function validateChapterCloseFenceV1(
  value: unknown,
): ChapterCloseFenceV1 {
  const fence = exactRecord(value, CLOSE_FENCE_KEYS, "closeFence");
  literal(
    fence.schemaVersion,
    "pressure_chapter_close_fence_v1",
    "closeFence.schemaVersion",
  );
  requiredText(fence.runId, "closeFence.runId");
  requiredText(fence.chapterRuntimeId, "closeFence.chapterRuntimeId");
  validateChapterIdV1(fence.chapterId, "closeFence.chapterId");
  if (
    ![
      "CHAPTER_ACTIVE",
      "CHAPTER_CLOSING",
      "CHAPTER_SETTLING",
      "CHAPTER_FROZEN",
    ].includes(String(fence.lifecycleState))
  ) {
    invalid("closeFence.lifecycleState", "ENUM");
  }
  for (const field of [
    "closedWorkingRevision",
    "observedWorkingRevision",
    "closedActionCount",
    "observedActionCount",
    "baseWorldSequenceAtClose",
    "observedWorldSequence",
  ] as const) {
    nonNegativeInteger(fence[field], `closeFence.${field}`);
  }
  for (const field of [
    "closedWorkingStateHash",
    "observedWorkingStateHash",
    "closedDecisionLedgerHash",
    "observedDecisionLedgerHash",
    "baseWorldStateHashAtClose",
    "observedWorldStateHash",
    "runRouteHashAtClose",
    "previousFrozenHashAtClose",
    "reservationLedgerHashAtClose",
    "contentPolicyHashAtClose",
    "settlementContractHashAtClose",
    "closeFenceHash",
  ] as const) {
    hash(fence[field], `closeFence.${field}`);
  }
  requiredText(
    fence.contentPolicyVersionAtClose,
    "closeFence.contentPolicyVersionAtClose",
  );
  requiredText(
    fence.settlementContractVersionAtClose,
    "closeFence.settlementContractVersionAtClose",
  );
  assertSelfHash(fence, "closeFenceHash", "closeFence");
  return fence as unknown as ChapterCloseFenceV1;
}

export function sealChapterSettlementSourceV1(
  draft: Omit<ChapterSettlementSourceV1, "sourceHash">,
): ChapterSettlementSourceV1 {
  const sealedInput = validateSealedChapterSettlementInputV1(draft.sealedInput);
  const canonicalMaterial = compileB0ChapterSettlementInputV1({
    wireInput: sealedInput,
    settlementMaterial: draft.settlementMaterial,
  }).settlementMaterial;
  const canonicalDraft = {
    ...structuredClone(draft),
    sealedInput: structuredClone(sealedInput),
    settlementMaterial: structuredClone(canonicalMaterial),
  };
  return validateChapterSettlementSourceV1({
    ...canonicalDraft,
    sourceHash: sha256Canonical(canonicalDraft),
  });
}

export function validateChapterSettlementSourceV1(
  value: unknown,
): ChapterSettlementSourceV1 {
  const source = exactRecord(value, SOURCE_KEYS, "source");
  literal(
    source.schemaVersion,
    "pressure_chapter_settlement_source_v1",
    "source.schemaVersion",
  );
  validateChapterCloseFenceV1(source.closeFence);
  const sealedInput = validateSealedChapterSettlementInputV1(source.sealedInput);
  validateWorldStateV1(source.baseWorldState, "source.baseWorldState");
  exactRecord(
    source.settlementMaterial,
    ["seats", "resources", "actions"],
    "source.settlementMaterial",
  );
  const canonicalMaterial = compileB0ChapterSettlementInputV1({
    wireInput: sealedInput,
    settlementMaterial: source.settlementMaterial,
  }).settlementMaterial;
  if (
    sha256Canonical(source.settlementMaterial) !==
    sha256Canonical(canonicalMaterial)
  ) {
    failChapterSettlement(
      ERROR.SOURCE_REFERENCE_MISMATCH,
      "source.settlementMaterial",
      "NON_CANONICAL_ORDER",
    );
  }
  hash(source.sourceHash, "source.sourceHash");
  assertSelfHash(source, "sourceHash", "source");
  return source as unknown as ChapterSettlementSourceV1;
}

export function assertChapterSettlementSourceReadyV1(
  value: unknown,
): ChapterSettlementSourceV1 {
  const source = validateChapterSettlementSourceV1(value);
  const fence = source.closeFence;
  const input = source.sealedInput;
  const world = source.baseWorldState;
  if (fence.lifecycleState !== "CHAPTER_SETTLING") {
    failChapterSettlement(
      ERROR.CHAPTER_NOT_CLOSED,
      "source.closeFence.lifecycleState",
      fence.lifecycleState,
    );
  }
  if (
    fence.closedWorkingRevision !== fence.observedWorkingRevision ||
    fence.closedWorkingStateHash !== fence.observedWorkingStateHash
  ) {
    failChapterSettlement(
      ERROR.WORKING_REVISION_MISMATCH,
      "source.closeFence.workingRevision",
    );
  }
  if (
    fence.closedActionCount !== fence.observedActionCount ||
    fence.closedDecisionLedgerHash !== fence.observedDecisionLedgerHash
  ) {
    failChapterSettlement(
      ERROR.POST_CLOSE_ACTION_DETECTED,
      "source.closeFence.decisionLedger",
    );
  }
  if (
    fence.baseWorldSequenceAtClose !== fence.observedWorldSequence ||
    input.baseWorldSequence !== fence.observedWorldSequence ||
    world.worldSequence !== fence.observedWorldSequence
  ) {
    failChapterSettlement(
      ERROR.WORLD_SEQUENCE_MISMATCH,
      "source.baseWorldSequence",
    );
  }
  if (
    fence.baseWorldStateHashAtClose !== fence.observedWorldStateHash ||
    input.baseWorldStateHash !== fence.observedWorldStateHash ||
    world.stateHash !== fence.observedWorldStateHash
  ) {
    failChapterSettlement(
      ERROR.WORLD_STATE_HASH_MISMATCH,
      "source.baseWorldStateHash",
    );
  }
  const referencesMatch =
    input.runId === fence.runId &&
    input.chapterRuntimeId === fence.chapterRuntimeId &&
    input.chapterId === fence.chapterId &&
    input.finalWorkingStateHash === fence.closedWorkingStateHash &&
    input.decisionLedgerHash === fence.closedDecisionLedgerHash &&
    input.sealedDecisionActionIds.length === fence.closedActionCount &&
    input.runRouteHash === fence.runRouteHashAtClose &&
    input.previousFrozenHash === fence.previousFrozenHashAtClose &&
    input.reservationLedgerHash === fence.reservationLedgerHashAtClose &&
    input.contentPolicyVersion === fence.contentPolicyVersionAtClose &&
    input.contentPolicyHash === fence.contentPolicyHashAtClose &&
    input.settlementContractVersion ===
      fence.settlementContractVersionAtClose &&
    input.settlementContractHash === fence.settlementContractHashAtClose;
  if (!referencesMatch) {
    failChapterSettlement(
      ERROR.SOURCE_REFERENCE_MISMATCH,
      "source.sealedInput",
      "CLOSE_FENCE_MISMATCH",
    );
  }
  return source;
}

export function computeChapterSettlementRequestFingerprintV1(input: {
  runId: string;
  chapterRuntimeId: string;
  idempotencyKey: string;
  sealedInputHash: string;
}): string {
  return sha256Canonical({
    schemaVersion: "pressure_chapter_settlement_request_fingerprint_v1",
    commandType: "SETTLE_CHAPTER",
    runId: input.runId,
    chapterRuntimeId: input.chapterRuntimeId,
    idempotencyKey: input.idempotencyKey,
    sealedInputHash: input.sealedInputHash,
  });
}

export function buildAtomicChapterCommitRecordV1(input: {
  command: SettleChapterCommandV1;
  source: ChapterSettlementSourceV1;
  settlement: ChapterSettlementEvaluationV1;
  b0SettlementId: string;
}): AtomicChapterCommitRecordV1 {
  const source = assertChapterSettlementSourceReadyV1(input.source);
  const settlement = validateChapterSettlementEvaluationV1(
    input.settlement,
    source.sealedInput.inputHash,
  );
  requiredText(input.b0SettlementId, "b0SettlementId");
  const frozenWorldState = applyChapterSettlementToWorldV1(
    source.baseWorldState,
    settlement,
  );
  const frozenChapterBundle = buildFrozenChapterBundle(
    source,
    settlement,
    frozenWorldState,
  );
  const rootEvent = buildRootEvent(source, settlement, frozenChapterBundle);
  const outbox = buildHandoffOutbox(source, frozenChapterBundle, rootEvent);
  const commitFence: CommitChapterFenceV1 = {
    expectedLifecycleState: "CHAPTER_SETTLING",
    expectedWorkingRevision: source.closeFence.closedWorkingRevision,
    expectedWorkingStateHash: source.closeFence.closedWorkingStateHash,
    expectedDecisionLedgerHash: source.closeFence.closedDecisionLedgerHash,
    expectedActionCount: source.closeFence.closedActionCount,
    expectedWorldSequence: source.sealedInput.baseWorldSequence,
    expectedWorldStateHash: source.sealedInput.baseWorldStateHash,
    closeFenceHash: source.closeFence.closeFenceHash,
  };
  const receipt = buildCommitReceipt({
    source,
    settlement,
    frozenChapterBundle,
    rootEvent,
    outbox,
    settlementId: input.b0SettlementId,
  });
  const base = {
    schemaVersion: "pressure_atomic_chapter_commit_v1" as const,
    runId: source.sealedInput.runId,
    chapterRuntimeId: source.sealedInput.chapterRuntimeId,
    chapterId: source.sealedInput.chapterId,
    idempotencyKey: input.command.idempotencyKey,
    requestFingerprint: input.command.requestFingerprint,
    sourceHash: source.sourceHash,
    commitFence,
    sealedInput: structuredClone(source.sealedInput),
    worldDelta: structuredClone(settlement.worldDelta),
    settlement: structuredClone(settlement),
    frozenChapterBundle,
    rootEvent,
    outbox,
    receipt,
  };
  return validateAtomicChapterCommitRecordV1({
    ...base,
    atomicRecordHash: sha256Canonical(base),
  });
}

export function validateAtomicChapterCommitRecordV1(
  value: unknown,
): AtomicChapterCommitRecordV1 {
  const record = exactRecord(value, ATOMIC_RECORD_KEYS, "atomicRecord");
  literal(
    record.schemaVersion,
    "pressure_atomic_chapter_commit_v1",
    "atomicRecord.schemaVersion",
  );
  requiredText(record.runId, "atomicRecord.runId");
  requiredText(record.chapterRuntimeId, "atomicRecord.chapterRuntimeId");
  validateChapterIdV1(record.chapterId, "atomicRecord.chapterId");
  requiredText(record.idempotencyKey, "atomicRecord.idempotencyKey");
  for (const field of [
    "requestFingerprint",
    "sourceHash",
    "atomicRecordHash",
  ] as const) {
    hash(record[field], `atomicRecord.${field}`);
  }
  const commitFence = validateCommitFence(record.commitFence);
  const sealedInput = validateSealedChapterSettlementInputV1(
    record.sealedInput,
  );
  const worldDelta = validateWorldDeltaV1(record.worldDelta);
  const settlement = validateChapterSettlementEvaluationV1(
    record.settlement,
    sealedInput.inputHash,
  );
  const bundle = validateFrozenChapterBundleV1(
    record.frozenChapterBundle,
    sealedInput.previousFrozenHash,
  );
  const rootEvent = validateRootEvent(record.rootEvent);
  const outbox = validateHandoffOutbox(record.outbox);
  const receipt = validateB0SettlementCommitResultV1(
    record.receipt,
    sealedInput,
    settlement,
  );
  const deltaHash = sha256Canonical(worldDelta);
  const expectedTarget = nextChapterId(sealedInput.chapterId);
  const expectedBundleId = frozenBundleId(bundle.bundleHash);
  const expectedRequestFingerprint =
    computeChapterSettlementRequestFingerprintV1({
      runId: sealedInput.runId,
      chapterRuntimeId: sealedInput.chapterRuntimeId,
      idempotencyKey: record.idempotencyKey as string,
      sealedInputHash: sealedInput.inputHash,
    });
  const referencesMatch =
    record.runId === sealedInput.runId &&
    record.chapterRuntimeId === sealedInput.chapterRuntimeId &&
    record.chapterId === sealedInput.chapterId &&
    record.requestFingerprint === expectedRequestFingerprint &&
    deltaHash === sha256Canonical(settlement.worldDelta) &&
    deltaHash === sha256Canonical(bundle.worldDelta) &&
    commitFence.expectedWorkingStateHash ===
      sealedInput.finalWorkingStateHash &&
    commitFence.expectedDecisionLedgerHash === sealedInput.decisionLedgerHash &&
    commitFence.expectedActionCount ===
      sealedInput.sealedDecisionActionIds.length &&
    commitFence.expectedWorldSequence === sealedInput.baseWorldSequence &&
    commitFence.expectedWorldStateHash === sealedInput.baseWorldStateHash &&
    rootEvent.runId === record.runId &&
    rootEvent.chapterRuntimeId === record.chapterRuntimeId &&
    rootEvent.chapterId === record.chapterId &&
    rootEvent.settlementInputHash === sealedInput.inputHash &&
    rootEvent.evaluationHash === settlement.evaluationHash &&
    rootEvent.worldDeltaHash === deltaHash &&
    rootEvent.bundleHash === bundle.bundleHash &&
    outbox.runId === record.runId &&
    outbox.chapterRuntimeId === record.chapterRuntimeId &&
    outbox.sourceRootEventId === rootEvent.eventId &&
    outbox.sourceRootEventHash === rootEvent.eventHash &&
    outbox.sourceBundleHash === bundle.bundleHash &&
    outbox.target.kind ===
      (expectedTarget === "FINALE" ? "FINALE" : "NEXT_CHAPTER") &&
    outbox.target.chapterId ===
      (expectedTarget === "FINALE" ? null : expectedTarget) &&
    receipt.frozenChapterBundleId === expectedBundleId &&
    receipt.bundleHash === bundle.bundleHash &&
    receipt.rootEventId === rootEvent.eventId &&
    receipt.outboxDedupeKeys.length === 1 &&
    receipt.outboxDedupeKeys[0] === outbox.dedupeKey;
  if (!referencesMatch) {
    failChapterSettlement(
      ERROR.ATOMIC_RECORD_INVALID,
      "atomicRecord",
      "REFERENCE_MISMATCH",
    );
  }
  const expectedManifestHash = computeCommitManifestHash({
    settlementId: receipt.settlementId,
    frozenChapterBundleId: receipt.frozenChapterBundleId,
    sourceHash: record.sourceHash as string,
    closeFenceHash: commitFence.closeFenceHash,
    sealedInput,
    settlement,
    bundle,
    rootEvent,
    outbox,
  });
  if (receipt.commitManifestHash !== expectedManifestHash) {
    failChapterSettlement(
      ERROR.ATOMIC_RECORD_HASH_MISMATCH,
      "atomicRecord.receipt.commitManifestHash",
      `EXPECTED_${expectedManifestHash}`,
    );
  }
  assertSelfHash(record, "atomicRecordHash", "atomicRecord");
  return record as unknown as AtomicChapterCommitRecordV1;
}

export function applyChapterSettlementToWorldV1(
  baseValue: WorldStateV1,
  settlementValue: ChapterSettlementEvaluationV1,
): WorldStateV1 {
  const base = validateWorldStateV1(baseValue, "baseWorldState");
  const settlement = validateChapterSettlementEvaluationV1(settlementValue);
  const factValues = structuredClone(base.factValues);
  const seenFacts = new Set<string>();
  for (const mutation of settlement.worldDelta.factMutations) {
    if (seenFacts.has(mutation.factRef)) deltaInvalid(mutation.factRef, "DUPLICATE_FACT");
    seenFacts.add(mutation.factRef);
    if (factValues[mutation.factRef] !== mutation.before) {
      deltaInvalid(mutation.factRef, "FACT_BEFORE_MISMATCH");
    }
    factValues[mutation.factRef] = mutation.after;
  }
  const resources = structuredClone(base.resources);
  const seenResources = new Set<string>();
  for (const mutation of settlement.worldDelta.resourceMutations) {
    if (seenResources.has(mutation.resourceId)) {
      deltaInvalid(mutation.resourceId, "DUPLICATE_RESOURCE");
    }
    seenResources.add(mutation.resourceId);
    if (resources[mutation.resourceId] !== mutation.before) {
      deltaInvalid(mutation.resourceId, "RESOURCE_BEFORE_MISMATCH");
    }
    resources[mutation.resourceId] = mutation.after;
  }
  const trackBase = {
    schemaVersion: "sangtian_track_state_v1" as const,
    values: structuredClone(base.tracks.values),
  };
  for (const [trackId, amount] of Object.entries(settlement.trackDelta)) {
    trackBase.values[trackId as keyof typeof trackBase.values] += amount;
  }
  const tracks = {
    ...trackBase,
    stateHash: sha256Canonical(trackBase),
  };
  const objects = replaceById(
    base.objects,
    settlement.objectKnowledgeEvidenceResponsibilityDelta.objectStates,
    (item) => item.objectId,
  );
  const knowledgeBySeat = structuredClone(base.knowledgeBySeat);
  for (const state of settlement.objectKnowledgeEvidenceResponsibilityDelta
    .knowledgeStates) {
    knowledgeBySeat[state.seatId] = structuredClone(state);
  }
  const evidence = replaceById(
    base.evidence,
    settlement.objectKnowledgeEvidenceResponsibilityDelta.evidenceStates,
    (item) => item.evidenceId,
  );
  const responsibilities = replaceById(
    base.responsibilities,
    settlement.objectKnowledgeEvidenceResponsibilityDelta.responsibilityStates,
    (item) => item.responsibilityId,
  );
  const seatArcs = structuredClone(base.seatArcs);
  for (const delta of settlement.seatArcDeltas) {
    if (seatArcs[delta.seatId].stateHash !== delta.beforeStateHash) {
      deltaInvalid(delta.seatId, "SEAT_ARC_BEFORE_MISMATCH");
    }
    seatArcs[delta.seatId] = structuredClone(delta.afterState);
  }
  const worldBase = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: base.worldSequence + 1,
    factValues,
    resources,
    tracks,
    objects,
    knowledgeBySeat,
    evidence,
    responsibilities,
    seatArcs,
  };
  return validateWorldStateV1({
    ...worldBase,
    stateHash: sha256Canonical(worldBase),
  });
}

function buildFrozenChapterBundle(
  source: ChapterSettlementSourceV1,
  settlement: ChapterSettlementEvaluationV1,
  frozenWorldState: WorldStateV1,
): FrozenChapterBundleV1 {
  const sealed = source.sealedInput;
  const base = {
    schemaVersion: "sangtian_frozen_chapter_bundle_v1" as const,
    runId: sealed.runId,
    chapterId: sealed.chapterId,
    chapterSequence: chapterSequence(sealed.chapterId),
    baseWorldSequence: sealed.baseWorldSequence,
    committedWorldSequence: sealed.baseWorldSequence + 1,
    previousFrozenHash: sealed.previousFrozenHash,
    decisionLedgerHash: sealed.decisionLedgerHash,
    finalWorkingStateHash: sealed.finalWorkingStateHash,
    settlementPolicyVersion: sealed.contentPolicyVersion,
    worldDelta: structuredClone(settlement.worldDelta),
    committedWorldStateHash: frozenWorldState.stateHash,
    frozenWorldState,
    causalEdges: structuredClone(settlement.causalEdges),
    carryForward: structuredClone(settlement.carryForward),
  };
  return validateFrozenChapterBundleV1(
    { ...base, bundleHash: sha256Canonical(base) },
    sealed.previousFrozenHash,
  );
}

function buildRootEvent(
  source: ChapterSettlementSourceV1,
  settlement: ChapterSettlementEvaluationV1,
  bundle: FrozenChapterBundleV1,
): ChapterFrozenRootEventV1 {
  const eventId = `pressure.chapter_frozen.${sha256Canonical({
    runId: source.sealedInput.runId,
    chapterRuntimeId: source.sealedInput.chapterRuntimeId,
    inputHash: source.sealedInput.inputHash,
    evaluationHash: settlement.evaluationHash,
    bundleHash: bundle.bundleHash,
  }).slice(0, 24)}`;
  const base = {
    schemaVersion: "pressure_chapter_frozen_root_event_v1" as const,
    eventId,
    eventType: "CHAPTER_FROZEN" as const,
    runId: source.sealedInput.runId,
    chapterRuntimeId: source.sealedInput.chapterRuntimeId,
    chapterId: source.sealedInput.chapterId,
    chapterSequence: chapterSequence(source.sealedInput.chapterId),
    baseWorldSequence: source.sealedInput.baseWorldSequence,
    committedWorldSequence: source.sealedInput.baseWorldSequence + 1,
    settlementInputHash: source.sealedInput.inputHash,
    evaluationHash: settlement.evaluationHash,
    worldDeltaHash: sha256Canonical(settlement.worldDelta),
    bundleHash: bundle.bundleHash,
  };
  return validateRootEvent({ ...base, eventHash: sha256Canonical(base) });
}

function buildHandoffOutbox(
  source: ChapterSettlementSourceV1,
  bundle: FrozenChapterBundleV1,
  rootEvent: ChapterFrozenRootEventV1,
): ChapterHandoffOutboxV1 {
  const next = nextChapterId(source.sealedInput.chapterId);
  const target: ChapterHandoffOutboxV1["target"] =
    next === "FINALE"
      ? { kind: "FINALE", chapterId: null }
      : { kind: "NEXT_CHAPTER", chapterId: next };
  const taskType = next === "FINALE" ? "COMPUTE_FINALE" : "OPEN_CHAPTER";
  const dedupeKey = `pressure.chapter_handoff.${sha256Canonical({
    runId: source.sealedInput.runId,
    chapterRuntimeId: source.sealedInput.chapterRuntimeId,
    bundleHash: bundle.bundleHash,
    target,
  }).slice(0, 24)}`;
  const base = {
    schemaVersion: "pressure_chapter_handoff_outbox_v1" as const,
    taskType,
    status: "PENDING" as const,
    dedupeKey,
    runId: source.sealedInput.runId,
    chapterRuntimeId: source.sealedInput.chapterRuntimeId,
    sourceRootEventId: rootEvent.eventId,
    sourceRootEventHash: rootEvent.eventHash,
    sourceBundleHash: bundle.bundleHash,
    target,
  };
  return validateHandoffOutbox({ ...base, outboxHash: sha256Canonical(base) });
}

function buildCommitReceipt(input: {
  source: ChapterSettlementSourceV1;
  settlement: ChapterSettlementEvaluationV1;
  frozenChapterBundle: FrozenChapterBundleV1;
  rootEvent: ChapterFrozenRootEventV1;
  outbox: ChapterHandoffOutboxV1;
  settlementId: string;
}): B0SettlementCommitResultV1 {
  const frozenChapterBundleId = frozenBundleId(
    input.frozenChapterBundle.bundleHash,
  );
  const commitManifestHash = computeCommitManifestHash({
    settlementId: input.settlementId,
    frozenChapterBundleId,
    sourceHash: input.source.sourceHash,
    closeFenceHash: input.source.closeFence.closeFenceHash,
    sealedInput: input.source.sealedInput,
    settlement: input.settlement,
    bundle: input.frozenChapterBundle,
    rootEvent: input.rootEvent,
    outbox: input.outbox,
  });
  const base = {
    schemaVersion: "b0_settlement_commit_result_v1" as const,
    settlementId: input.settlementId,
    frozenChapterBundleId,
    runId: input.source.sealedInput.runId,
    chapterRuntimeId: input.source.sealedInput.chapterRuntimeId,
    chapterId: input.source.sealedInput.chapterId,
    inputHash: input.source.sealedInput.inputHash,
    evaluationHash: input.settlement.evaluationHash,
    baseWorldSequence: input.source.sealedInput.baseWorldSequence,
    committedWorldSequence: input.source.sealedInput.baseWorldSequence + 1,
    baseWorldStateHash: input.source.sealedInput.baseWorldStateHash,
    committedWorldStateHash: input.frozenChapterBundle.committedWorldStateHash,
    worldDeltaHash: sha256Canonical(input.settlement.worldDelta),
    commitManifestHash,
    bundleHash: input.frozenChapterBundle.bundleHash,
    rootEventId: input.rootEvent.eventId,
    outboxDedupeKeys: [input.outbox.dedupeKey],
  };
  return validateB0SettlementCommitResultV1(
    { ...base, commitHash: sha256Canonical(base) },
    input.source.sealedInput,
    input.settlement,
  );
}

function computeCommitManifestHash(input: {
  settlementId: string;
  frozenChapterBundleId: string;
  sourceHash: string;
  closeFenceHash: string;
  sealedInput: { inputHash: string };
  settlement: { evaluationHash: string; worldDelta: unknown };
  bundle: FrozenChapterBundleV1;
  rootEvent: ChapterFrozenRootEventV1;
  outbox: ChapterHandoffOutboxV1;
}): string {
  return sha256Canonical({
    schemaVersion: "pressure_chapter_commit_manifest_v1",
    settlementId: input.settlementId,
    frozenChapterBundleId: input.frozenChapterBundleId,
    sourceHash: input.sourceHash,
    closeFenceHash: input.closeFenceHash,
    inputHash: input.sealedInput.inputHash,
    evaluationHash: input.settlement.evaluationHash,
    worldDeltaHash: sha256Canonical(input.settlement.worldDelta),
    bundleHash: input.bundle.bundleHash,
    committedWorldStateHash: input.bundle.committedWorldStateHash,
    rootEventHash: input.rootEvent.eventHash,
    outboxHash: input.outbox.outboxHash,
  });
}

function validateCommitFence(value: unknown): CommitChapterFenceV1 {
  const fence = exactRecord(value, COMMIT_FENCE_KEYS, "atomicRecord.commitFence");
  literal(
    fence.expectedLifecycleState,
    "CHAPTER_SETTLING",
    "atomicRecord.commitFence.expectedLifecycleState",
  );
  for (const field of [
    "expectedWorkingRevision",
    "expectedActionCount",
    "expectedWorldSequence",
  ] as const) {
    nonNegativeInteger(fence[field], `atomicRecord.commitFence.${field}`);
  }
  for (const field of [
    "expectedWorkingStateHash",
    "expectedDecisionLedgerHash",
    "expectedWorldStateHash",
    "closeFenceHash",
  ] as const) {
    hash(fence[field], `atomicRecord.commitFence.${field}`);
  }
  return fence as unknown as CommitChapterFenceV1;
}

function validateRootEvent(value: unknown): ChapterFrozenRootEventV1 {
  const event = exactRecord(value, ROOT_EVENT_KEYS, "rootEvent");
  literal(
    event.schemaVersion,
    "pressure_chapter_frozen_root_event_v1",
    "rootEvent.schemaVersion",
  );
  literal(event.eventType, "CHAPTER_FROZEN", "rootEvent.eventType");
  requiredText(event.eventId, "rootEvent.eventId");
  requiredText(event.runId, "rootEvent.runId");
  requiredText(event.chapterRuntimeId, "rootEvent.chapterRuntimeId");
  const chapterId = validateChapterIdV1(event.chapterId, "rootEvent.chapterId");
  const sequence = chapterSequence(chapterId);
  if (
    event.chapterSequence !== sequence ||
    event.baseWorldSequence !== sequence - 1 ||
    event.committedWorldSequence !== sequence
  ) {
    failChapterSettlement(
      ERROR.WORLD_SEQUENCE_MISMATCH,
      "rootEvent.worldSequence",
    );
  }
  for (const field of [
    "settlementInputHash",
    "evaluationHash",
    "worldDeltaHash",
    "bundleHash",
    "eventHash",
  ] as const) {
    hash(event[field], `rootEvent.${field}`);
  }
  assertSelfHash(event, "eventHash", "rootEvent");
  return event as unknown as ChapterFrozenRootEventV1;
}

function validateHandoffOutbox(value: unknown): ChapterHandoffOutboxV1 {
  const outbox = exactRecord(value, OUTBOX_KEYS, "outbox");
  literal(
    outbox.schemaVersion,
    "pressure_chapter_handoff_outbox_v1",
    "outbox.schemaVersion",
  );
  if (outbox.taskType !== "OPEN_CHAPTER" && outbox.taskType !== "COMPUTE_FINALE") {
    invalid("outbox.taskType", "ENUM");
  }
  literal(outbox.status, "PENDING", "outbox.status");
  requiredText(outbox.dedupeKey, "outbox.dedupeKey");
  requiredText(outbox.runId, "outbox.runId");
  requiredText(outbox.chapterRuntimeId, "outbox.chapterRuntimeId");
  requiredText(outbox.sourceRootEventId, "outbox.sourceRootEventId");
  for (const field of [
    "sourceRootEventHash",
    "sourceBundleHash",
    "outboxHash",
  ] as const) {
    hash(outbox[field], `outbox.${field}`);
  }
  const target = exactRecord(outbox.target, ["kind", "chapterId"], "outbox.target");
  if (target.kind === "NEXT_CHAPTER") {
    validateChapterIdV1(target.chapterId, "outbox.target.chapterId");
    if (outbox.taskType !== "OPEN_CHAPTER") invalid("outbox.taskType", "TARGET_MISMATCH");
  } else if (target.kind === "FINALE") {
    if (target.chapterId !== null || outbox.taskType !== "COMPUTE_FINALE") {
      invalid("outbox.target", "FINALE_TARGET_MISMATCH");
    }
  } else {
    invalid("outbox.target.kind", "ENUM");
  }
  assertSelfHash(outbox, "outboxHash", "outbox");
  return outbox as unknown as ChapterHandoffOutboxV1;
}

function frozenBundleId(bundleHash: string): string {
  return `pressure.chapter_bundle.${bundleHash.slice(0, 24)}`;
}

function replaceById<T>(
  base: readonly T[],
  updates: readonly T[],
  identity: (item: T) => string,
): T[] {
  const map = new Map(base.map((item) => [identity(item), structuredClone(item)]));
  for (const update of updates) map.set(identity(update), structuredClone(update));
  return [...map.values()].sort((left, right) =>
    compareCanonicalText(identity(left), identity(right)),
  );
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "OBJECT");
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort(compareCanonicalText);
  const expected = [...expectedKeys].sort(compareCanonicalText);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalid(path, `EXACT_KEYS_${expected.join(",")}`);
  }
  return record;
}

function assertSelfHash(
  value: Record<string, any>,
  field: string,
  path: string,
): void {
  const expected = hashWithoutField(value, field);
  if (value[field] !== expected) {
    failChapterSettlement(
      ERROR.ATOMIC_RECORD_HASH_MISMATCH,
      `${path}.${field}`,
      `EXPECTED_${expected}`,
    );
  }
}

function hash(value: unknown, path: string): asserts value is string {
  if (!isSha256(value)) invalid(path, "SHA256_LOWER_HEX");
}

function requiredText(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "NON_EMPTY_STRING");
}

function nonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid(path, "NON_NEGATIVE_SAFE_INTEGER");
  }
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) invalid(path, `EXPECTED_${String(expected)}`);
}

function invalid(path: string, detail?: string): never {
  return failChapterSettlement(ERROR.ATOMIC_RECORD_INVALID, path, detail);
}

function deltaInvalid(path: string, detail: string): never {
  return failChapterSettlement(ERROR.WORLD_DELTA_INVALID, path, detail);
}
