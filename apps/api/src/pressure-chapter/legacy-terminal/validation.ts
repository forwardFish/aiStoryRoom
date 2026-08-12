import { validateNarrativeAudienceV1 } from "@ai-story/shared";
import {
  canonicalLegacyEnding,
  canonicalLegacyFacts,
  canonicalLegacyMaterial,
  canonicalLegacyMutations,
  compareLegacyCanonicalText,
  computeLegacyCanonHash,
  computeLegacyNarrativeContentHash,
  computeLegacyNarrativeOutboxFingerprint,
  computeLegacyPresentationHash,
  computeLegacySettledStateHash,
  computeLegacyStructuredResultHash,
  computeLegacyTerminalCommandFingerprint,
  computeLegacyTerminalInputHash,
} from "./canonical";
import type {
  CanonicalLegacyCanonMutationV1,
  LegacyAuthoritativeEndingV1,
  LegacyCanonFactV1,
  LegacyHistoricalCompletedSnapshotV1,
  LegacyNarrativePresentationV1,
  LegacyStructuredResultV1,
  LegacyTerminalInputV1,
  LegacyTerminalCommitReceiptV1,
  LegacyTerminalMaterialV1,
  LegacyTerminalNarrativeOutboxCommandV1,
  LegacyTerminalSourceSnapshotV1,
  LegacyUnfinishedTerminalSnapshotV1,
  ValidatedLegacyTerminalCommitCommandV1,
} from "./contracts";
import {
  LEGACY_TERMINAL_ERROR_CODES as ERROR,
  failLegacyTerminal,
} from "./errors";

const SHA256 = /^[a-f0-9]{64}$/u;

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:OBJECT`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:FIELDS`);
  }
}

function string(value: unknown, path: string, maximum = 2_000): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:STRING`);
  }
  return value;
}

function sha(value: unknown, path: string): string {
  const result = string(value, path, 64);
  if (!SHA256.test(result)) failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:SHA256`);
  return result;
}

function enumeration<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:ENUM`);
  }
  return value as T;
}

function stringArray(value: unknown, path: string, maximum = 50): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:ARRAY`);
  }
  const result = value.map((item, index) => string(item, `${path}[${index}]`, 500));
  if (new Set(result).size !== result.length) failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:DUPLICATE`);
  return result;
}

function validateFact(value: unknown, path: string): LegacyCanonFactV1 {
  const fact = object(value, path);
  exactKeys(fact, ["factId", "factText", "sourceRef"], path);
  return {
    factId: string(fact.factId, `${path}.factId`, 200),
    factText: string(fact.factText, `${path}.factText`, 2_000),
    sourceRef: string(fact.sourceRef, `${path}.sourceRef`, 300),
  };
}

function validateFacts(value: unknown, path: string): LegacyCanonFactV1[] {
  if (!Array.isArray(value) || value.length > 200) failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:ARRAY`);
  const facts = value.map((item, index) => validateFact(item, `${path}[${index}]`));
  if (new Set(facts.map((fact) => fact.factId)).size !== facts.length) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:DUPLICATE_FACT`);
  }
  return canonicalLegacyFacts(facts);
}

function validateMutation(value: unknown, path: string): CanonicalLegacyCanonMutationV1 {
  const mutation = object(value, path);
  exactKeys(mutation, ["mutationId", "operation", "factId", "factText", "sourceRef"], path);
  return {
    mutationId: string(mutation.mutationId, `${path}.mutationId`, 200),
    operation: enumeration(mutation.operation, ["UPSERT_FACT"] as const, `${path}.operation`),
    factId: string(mutation.factId, `${path}.factId`, 200),
    factText: string(mutation.factText, `${path}.factText`, 2_000),
    sourceRef: string(mutation.sourceRef, `${path}.sourceRef`, 300),
  };
}

function validateMutations(value: unknown, path: string): CanonicalLegacyCanonMutationV1[] {
  if (!Array.isArray(value) || value.length > 100) failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:ARRAY`);
  const mutations = value.map((item, index) => validateMutation(item, `${path}[${index}]`));
  if (new Set(mutations.map((mutation) => mutation.mutationId)).size !== mutations.length) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}:DUPLICATE_MUTATION`);
  }
  return canonicalLegacyMutations(mutations);
}

export function validateLegacyAuthoritativeEndingV1(
  value: unknown,
  path = "ending",
): LegacyAuthoritativeEndingV1 {
  const ending = object(value, path);
  exactKeys(ending, [
    "schemaVersion", "scope", "endingKey", "title", "verdict", "gain", "loss",
    "causes", "sourceTurnId", "sourceRevision",
  ], path);
  if (ending.schemaVersion !== "legacy_authoritative_ending_v1") {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}.schemaVersion`);
  }
  if (ending.sourceRevision !== 20) failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}.sourceRevision`);
  if (!Array.isArray(ending.causes) || ending.causes.length === 0 || ending.causes.length > 50) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, `${path}.causes`);
  }
  const causes = ending.causes.map((cause, index) => {
    const item = object(cause, `${path}.causes[${index}]`);
    exactKeys(item, ["sourceRef", "factText"], `${path}.causes[${index}]`);
    return {
      sourceRef: string(item.sourceRef, `${path}.causes[${index}].sourceRef`, 300),
      factText: string(item.factText, `${path}.causes[${index}].factText`, 2_000),
    };
  });
  const typed: LegacyAuthoritativeEndingV1 = {
    schemaVersion: "legacy_authoritative_ending_v1",
    scope: enumeration(ending.scope, ["PART", "STORY"] as const, `${path}.scope`),
    endingKey: string(ending.endingKey, `${path}.endingKey`, 200),
    title: string(ending.title, `${path}.title`, 200),
    verdict: enumeration(ending.verdict, ["WIN", "COSTLY_WIN", "LOSS"] as const, `${path}.verdict`),
    gain: stringArray(ending.gain, `${path}.gain`),
    loss: stringArray(ending.loss, `${path}.loss`),
    causes,
    sourceTurnId: string(ending.sourceTurnId, `${path}.sourceTurnId`, 200),
    sourceRevision: 20,
  };
  return canonicalLegacyEnding(typed);
}

export function validateLegacyTerminalInputV1(value: unknown): LegacyTerminalInputV1 {
  const input = object(value, "terminalInput");
  exactKeys(input, [
    "schemaVersion", "runId", "frozenRouteHash", "sourceTurnId", "sourceRevision",
    "terminalSignal", "settledStateHash", "canonBeforeHash", "endingPolicyVersion", "inputHash",
  ], "terminalInput");
  if (input.schemaVersion !== "legacy_terminal_input_v1") {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, "terminalInput.schemaVersion");
  }
  if (
    input.sourceRevision !== 20
    || input.terminalSignal !== "HANDOFF_READY"
    || input.sourceTurnId !== "T20"
  ) {
    failLegacyTerminal(ERROR.NOT_READY, "terminalInput:SOURCE_TURN_REVISION_OR_SIGNAL");
  }
  const typed: LegacyTerminalInputV1 = {
    schemaVersion: "legacy_terminal_input_v1",
    runId: string(input.runId, "terminalInput.runId", 200),
    frozenRouteHash: sha(input.frozenRouteHash, "terminalInput.frozenRouteHash"),
    sourceTurnId: string(input.sourceTurnId, "terminalInput.sourceTurnId", 200),
    sourceRevision: 20,
    terminalSignal: "HANDOFF_READY",
    settledStateHash: sha(input.settledStateHash, "terminalInput.settledStateHash"),
    canonBeforeHash: sha(input.canonBeforeHash, "terminalInput.canonBeforeHash"),
    endingPolicyVersion: string(input.endingPolicyVersion, "terminalInput.endingPolicyVersion", 200),
    inputHash: sha(input.inputHash, "terminalInput.inputHash"),
  };
  const { inputHash: _hash, ...withoutHash } = typed;
  if (typed.inputHash !== computeLegacyTerminalInputHash(withoutHash)) {
    failLegacyTerminal(ERROR.HASH_MISMATCH, "terminalInput.inputHash");
  }
  return typed;
}

export function validateLegacyTerminalMaterialV1(value: unknown): LegacyTerminalMaterialV1 {
  const material = object(value, "material");
  exactKeys(material, [
    "canonBefore", "terminalFacts", "ending", "canonMutations", "resultType",
    "replayPolicyVersion", "narrativeAudience", "narrativeProfileVersion", "allowedFactIds",
    "allowedObjectVersionIds", "allowedKnowledgeIds",
  ], "material");
  return canonicalLegacyMaterial({
    canonBefore: validateFacts(material.canonBefore, "material.canonBefore"),
    terminalFacts: validateFacts(material.terminalFacts, "material.terminalFacts"),
    ending: validateLegacyAuthoritativeEndingV1(material.ending, "material.ending"),
    canonMutations: validateMutations(material.canonMutations, "material.canonMutations"),
    resultType: enumeration(material.resultType, ["SOLO_PART_END", "SOLO_STORY_END"] as const, "material.resultType"),
    replayPolicyVersion: string(material.replayPolicyVersion, "material.replayPolicyVersion", 200),
    narrativeAudience: validateNarrativeAudienceV1(material.narrativeAudience),
    narrativeProfileVersion: string(material.narrativeProfileVersion, "material.narrativeProfileVersion", 200),
    allowedFactIds: stringArray(material.allowedFactIds, "material.allowedFactIds", 200),
    allowedObjectVersionIds: stringArray(material.allowedObjectVersionIds, "material.allowedObjectVersionIds", 200),
    allowedKnowledgeIds: stringArray(material.allowedKnowledgeIds, "material.allowedKnowledgeIds", 200),
  });
}

function validateUnfinishedSnapshot(value: Record<string, unknown>): LegacyUnfinishedTerminalSnapshotV1 {
  exactKeys(value, ["kind", "runId", "runtimeProfile", "runtimeTerminalState", "terminalInput", "material"], "snapshot");
  if (value.kind !== "UNFINISHED_T20" || value.runtimeProfile !== "OPENNOVEL_T20_V1" || value.runtimeTerminalState !== "HANDOFF_READY") {
    failLegacyTerminal(ERROR.NOT_READY, "snapshot:PROFILE_OR_STATE");
  }
  const runId = string(value.runId, "snapshot.runId", 200);
  const terminalInput = validateLegacyTerminalInputV1(value.terminalInput);
  const material = validateLegacyTerminalMaterialV1(value.material);
  if (material.ending.sourceTurnId !== "T20") {
    failLegacyTerminal(ERROR.NOT_READY, "snapshot:ENDING_SOURCE_TURN_NOT_T20");
  }
  if (terminalInput.runId !== runId || terminalInput.sourceTurnId !== material.ending.sourceTurnId) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, "snapshot:SOURCE_REFERENCE_MISMATCH");
  }
  const expectedScope = material.resultType === "SOLO_PART_END" ? "PART" : "STORY";
  if (material.ending.scope !== expectedScope) failLegacyTerminal(ERROR.INVALID_CONTRACT, "snapshot:ENDING_SCOPE_MISMATCH");
  const terminalFacts = new Set(material.terminalFacts.map((fact) => `${fact.sourceRef}\u0000${fact.factText}`));
  if (material.ending.causes.some((cause) => !terminalFacts.has(`${cause.sourceRef}\u0000${cause.factText}`))) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, "snapshot:ENDING_CAUSE_NOT_SETTLED");
  }
  if (terminalInput.canonBeforeHash !== computeLegacyCanonHash(material.canonBefore)) {
    failLegacyTerminal(ERROR.HASH_MISMATCH, "snapshot:CANON_BEFORE_HASH");
  }
  if (terminalInput.settledStateHash !== computeLegacySettledStateHash(material)) {
    failLegacyTerminal(ERROR.HASH_MISMATCH, "snapshot:SETTLED_STATE_HASH");
  }
  return {
    kind: "UNFINISHED_T20",
    runId,
    runtimeProfile: "OPENNOVEL_T20_V1",
    runtimeTerminalState: "HANDOFF_READY",
    terminalInput,
    material,
  };
}

function validateHistoricalSnapshot(value: Record<string, unknown>): LegacyHistoricalCompletedSnapshotV1 {
  exactKeys(value, [
    "kind", "runId", "runtimeProfile", "runtimeTerminalState", "frozenHeadHash",
    "frozenEndingHash", "frozenResultHash", "frozenFinalSceneNarrative", "frozenPayload",
  ], "snapshot");
  if (value.kind !== "HISTORICAL_COMPLETED" || value.runtimeProfile !== "OPENNOVEL_T20_V1") {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, "snapshot:HISTORICAL_PROFILE");
  }
  return {
    kind: "HISTORICAL_COMPLETED",
    runId: string(value.runId, "snapshot.runId", 200),
    runtimeProfile: "OPENNOVEL_T20_V1",
    runtimeTerminalState: enumeration(value.runtimeTerminalState, ["PART_COMPLETE", "STORY_COMPLETE"] as const, "snapshot.runtimeTerminalState"),
    frozenHeadHash: sha(value.frozenHeadHash, "snapshot.frozenHeadHash"),
    frozenEndingHash: sha(value.frozenEndingHash, "snapshot.frozenEndingHash"),
    frozenResultHash: sha(value.frozenResultHash, "snapshot.frozenResultHash"),
    frozenFinalSceneNarrative: string(value.frozenFinalSceneNarrative, "snapshot.frozenFinalSceneNarrative", 100_000),
    frozenPayload: structuredClone(value.frozenPayload),
  };
}

export function validateLegacyTerminalSourceSnapshotV1(value: unknown): LegacyTerminalSourceSnapshotV1 {
  const snapshot = object(value, "snapshot");
  return snapshot.kind === "HISTORICAL_COMPLETED"
    ? validateHistoricalSnapshot(snapshot)
    : validateUnfinishedSnapshot(snapshot);
}

export function validateLegacyStructuredResultV1(value: unknown): LegacyStructuredResultV1 {
  const result = object(value, "structuredResult");
  exactKeys(result, [
    "schemaVersion", "runId", "resultType", "authoritativeEnding", "causeRefs", "replayPolicyVersion",
  ], "structuredResult");
  if (result.schemaVersion !== "legacy_structured_result_v1") {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, "structuredResult.schemaVersion");
  }
  return {
    schemaVersion: "legacy_structured_result_v1",
    runId: string(result.runId, "structuredResult.runId", 200),
    resultType: enumeration(result.resultType, ["SOLO_PART_END", "SOLO_STORY_END"] as const, "structuredResult.resultType"),
    authoritativeEnding: validateLegacyAuthoritativeEndingV1(result.authoritativeEnding, "structuredResult.authoritativeEnding"),
    causeRefs: stringArray(result.causeRefs, "structuredResult.causeRefs"),
    replayPolicyVersion: string(result.replayPolicyVersion, "structuredResult.replayPolicyVersion", 200),
  };
}

function validateNarrativeOutbox(value: unknown): LegacyTerminalNarrativeOutboxCommandV1 {
  const outbox = object(value, "command.narrativeOutbox");
  exactKeys(outbox, [
    "schemaVersion", "runId", "audience", "sourceRuntimeProfile", "projectionKind",
    "sourceAuthority", "sourceId", "sourceContentHash", "allowedFactIds",
    "allowedObjectVersionIds", "allowedKnowledgeIds", "narrativeProfileVersion", "idempotencyKey",
  ], "command.narrativeOutbox");
  if (
    outbox.schemaVersion !== "legacy_terminal_narrative_outbox_command_v1"
    || outbox.sourceRuntimeProfile !== "OPENNOVEL_T20_V1"
    || outbox.projectionKind !== "FINALE_NARRATIVE"
    || outbox.sourceAuthority !== "LEGACY_TERMINAL_COMMITTED"
  ) failLegacyTerminal(ERROR.INVALID_CONTRACT, "command.narrativeOutbox:DISCRIMINATOR");
  return {
    schemaVersion: "legacy_terminal_narrative_outbox_command_v1",
    runId: string(outbox.runId, "command.narrativeOutbox.runId", 200),
    audience: validateNarrativeAudienceV1(outbox.audience),
    sourceRuntimeProfile: "OPENNOVEL_T20_V1",
    projectionKind: "FINALE_NARRATIVE",
    sourceAuthority: "LEGACY_TERMINAL_COMMITTED",
    sourceId: string(outbox.sourceId, "command.narrativeOutbox.sourceId", 300),
    sourceContentHash: sha(outbox.sourceContentHash, "command.narrativeOutbox.sourceContentHash"),
    allowedFactIds: stringArray(outbox.allowedFactIds, "command.narrativeOutbox.allowedFactIds", 200).sort(compareLegacyCanonicalText),
    allowedObjectVersionIds: stringArray(outbox.allowedObjectVersionIds, "command.narrativeOutbox.allowedObjectVersionIds", 200).sort(compareLegacyCanonicalText),
    allowedKnowledgeIds: stringArray(outbox.allowedKnowledgeIds, "command.narrativeOutbox.allowedKnowledgeIds", 200).sort(compareLegacyCanonicalText),
    narrativeProfileVersion: string(outbox.narrativeProfileVersion, "command.narrativeOutbox.narrativeProfileVersion", 200),
    idempotencyKey: string(outbox.idempotencyKey, "command.narrativeOutbox.idempotencyKey", 300),
  };
}

export function validateLegacyTerminalCommitCommandV1(
  value: unknown,
): ValidatedLegacyTerminalCommitCommandV1 {
  const command = object(value, "command");
  exactKeys(command, [
    "schemaVersion", "kind", "runId", "expectedRuntimeTerminalState", "expectedStateHash",
    "expectedCanonHash", "inputHash", "authoritativeEnding", "canonMutations", "canonAfterHash",
    "structuredResult", "structuredResultHash", "resultSchemaVersion", "narrativeOutbox",
    "narrativeOutboxFingerprint", "idempotencyKey", "commandFingerprint",
  ], "command");
  if (
    command.schemaVersion !== "validated_legacy_terminal_commit_command_v1"
    || command.kind !== "LEGACY_OPENOVEL"
    || command.expectedRuntimeTerminalState !== "HANDOFF_READY"
    || command.resultSchemaVersion !== "openovel_result_v2"
  ) failLegacyTerminal(ERROR.INVALID_CONTRACT, "command:DISCRIMINATOR");
  const typed: ValidatedLegacyTerminalCommitCommandV1 = {
    schemaVersion: "validated_legacy_terminal_commit_command_v1",
    kind: "LEGACY_OPENOVEL",
    runId: string(command.runId, "command.runId", 200),
    expectedRuntimeTerminalState: "HANDOFF_READY",
    expectedStateHash: sha(command.expectedStateHash, "command.expectedStateHash"),
    expectedCanonHash: sha(command.expectedCanonHash, "command.expectedCanonHash"),
    inputHash: sha(command.inputHash, "command.inputHash"),
    authoritativeEnding: validateLegacyAuthoritativeEndingV1(command.authoritativeEnding, "command.authoritativeEnding"),
    canonMutations: validateMutations(command.canonMutations, "command.canonMutations"),
    canonAfterHash: sha(command.canonAfterHash, "command.canonAfterHash"),
    structuredResult: validateLegacyStructuredResultV1(command.structuredResult),
    structuredResultHash: sha(command.structuredResultHash, "command.structuredResultHash"),
    resultSchemaVersion: "openovel_result_v2",
    narrativeOutbox: validateNarrativeOutbox(command.narrativeOutbox),
    narrativeOutboxFingerprint: sha(command.narrativeOutboxFingerprint, "command.narrativeOutboxFingerprint"),
    idempotencyKey: string(command.idempotencyKey, "command.idempotencyKey", 300),
    commandFingerprint: sha(command.commandFingerprint, "command.commandFingerprint"),
  };
  if (
    typed.structuredResult.runId !== typed.runId
    || typed.narrativeOutbox.runId !== typed.runId
    || JSON.stringify(typed.structuredResult.authoritativeEnding) !== JSON.stringify(typed.authoritativeEnding)
  ) failLegacyTerminal(ERROR.INVALID_CONTRACT, "command:RESULT_REFERENCE_MISMATCH");
  if (typed.structuredResultHash !== computeLegacyStructuredResultHash(typed.structuredResult)) {
    failLegacyTerminal(ERROR.HASH_MISMATCH, "command.structuredResultHash");
  }
  if (typed.narrativeOutbox.sourceContentHash !== typed.structuredResultHash) {
    failLegacyTerminal(ERROR.HASH_MISMATCH, "command.narrativeOutbox.sourceContentHash");
  }
  if (typed.narrativeOutboxFingerprint !== computeLegacyNarrativeOutboxFingerprint(typed.narrativeOutbox)) {
    failLegacyTerminal(ERROR.HASH_MISMATCH, "command.narrativeOutboxFingerprint");
  }
  const { commandFingerprint: _fingerprint, ...withoutFingerprint } = typed;
  if (typed.commandFingerprint !== computeLegacyTerminalCommandFingerprint(withoutFingerprint)) {
    failLegacyTerminal(ERROR.HASH_MISMATCH, "command.commandFingerprint");
  }
  return typed;
}

export function validateLegacyNarrativePresentationV1(
  value: unknown,
): LegacyNarrativePresentationV1 {
  const presentation = object(value, "presentation");
  exactKeys(presentation, [
    "schemaVersion", "runId", "sourceCommitHash", "narrativeOutboxId", "revision",
    "status", "text", "contentHash", "presentationHash",
  ], "presentation");
  if (presentation.schemaVersion !== "legacy_narrative_presentation_v1") {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, "presentation.schemaVersion");
  }
  if (!Number.isSafeInteger(presentation.revision) || Number(presentation.revision) < 1) {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, "presentation.revision");
  }
  const typed: LegacyNarrativePresentationV1 = {
    schemaVersion: "legacy_narrative_presentation_v1",
    runId: string(presentation.runId, "presentation.runId", 200),
    sourceCommitHash: sha(presentation.sourceCommitHash, "presentation.sourceCommitHash"),
    narrativeOutboxId: string(presentation.narrativeOutboxId, "presentation.narrativeOutboxId", 300),
    revision: Number(presentation.revision),
    status: enumeration(presentation.status, ["FALLBACK_PUBLISHED", "PUBLISHED"] as const, "presentation.status"),
    text: string(presentation.text, "presentation.text", 100_000),
    contentHash: sha(presentation.contentHash, "presentation.contentHash"),
    presentationHash: sha(presentation.presentationHash, "presentation.presentationHash"),
  };
  const { presentationHash: _hash, ...withoutHash } = typed;
  if (typed.contentHash !== computeLegacyNarrativeContentHash({ text: typed.text })) {
    failLegacyTerminal(ERROR.HASH_MISMATCH, "presentation.contentHash");
  }
  if (typed.presentationHash !== computeLegacyPresentationHash(withoutHash)) {
    failLegacyTerminal(ERROR.HASH_MISMATCH, "presentation.presentationHash");
  }
  return typed;
}

export function validateLegacyTerminalCommitReceiptV1(
  value: unknown,
): LegacyTerminalCommitReceiptV1 {
  const receipt = object(value, "receipt");
  exactKeys(receipt, [
    "schemaVersion", "runId", "runtimeTerminalState", "inputHash", "endingHash", "canonHash",
    "structuredResultHash", "sourceCommitHash", "narrativeOutboxId", "commitManifestHash",
  ], "receipt");
  if (receipt.schemaVersion !== "legacy_terminal_commit_receipt_v1") {
    failLegacyTerminal(ERROR.INVALID_CONTRACT, "receipt.schemaVersion");
  }
  return {
    schemaVersion: "legacy_terminal_commit_receipt_v1",
    runId: string(receipt.runId, "receipt.runId", 200),
    runtimeTerminalState: enumeration(receipt.runtimeTerminalState, ["PART_COMPLETE", "STORY_COMPLETE"] as const, "receipt.runtimeTerminalState"),
    inputHash: sha(receipt.inputHash, "receipt.inputHash"),
    endingHash: sha(receipt.endingHash, "receipt.endingHash"),
    canonHash: sha(receipt.canonHash, "receipt.canonHash"),
    structuredResultHash: sha(receipt.structuredResultHash, "receipt.structuredResultHash"),
    sourceCommitHash: sha(receipt.sourceCommitHash, "receipt.sourceCommitHash"),
    narrativeOutboxId: string(receipt.narrativeOutboxId, "receipt.narrativeOutboxId", 300),
    commitManifestHash: sha(receipt.commitManifestHash, "receipt.commitManifestHash"),
  };
}
