import {
  applyLegacyCanonMutations,
  canonicalLegacyEnding,
  canonicalLegacyMaterial,
  compareLegacyCanonicalText,
  computeLegacyCanonHash,
  computeLegacyNarrativeOutboxFingerprint,
  computeLegacyStructuredResultHash,
  computeLegacyTerminalCommandFingerprint,
} from "./canonical";
import type {
  LegacyStructuredResultV1,
  LegacyUnfinishedTerminalSnapshotV1,
  ValidatedLegacyTerminalCommitCommandV1,
} from "./contracts";
import {
  LEGACY_TERMINAL_ERROR_CODES as ERROR,
  failLegacyTerminal,
} from "./errors";
import {
  validateLegacyTerminalCommitCommandV1,
  validateLegacyTerminalSourceSnapshotV1,
} from "./validation";

function nonEmpty(value: string, path: string): string {
  if (!value || value.length > 300) failLegacyTerminal(ERROR.INVALID_CONTRACT, path);
  return value;
}

/**
 * Pure deterministic edge adapter for deployment-time unfinished T20 runs.
 * It consumes only committed source state and emits an authority command.
 */
export class LegacyTerminalInputAdapterV1 {
  compile(input: {
    snapshot: LegacyUnfinishedTerminalSnapshotV1;
    idempotencyKey: string;
  }): ValidatedLegacyTerminalCommitCommandV1 {
    const validated = validateLegacyTerminalSourceSnapshotV1(input.snapshot);
    if (validated.kind !== "UNFINISHED_T20") {
      failLegacyTerminal(ERROR.NOT_READY, "HISTORICAL_RUN_CANNOT_COMPILE");
    }
    const idempotencyKey = nonEmpty(input.idempotencyKey, "idempotencyKey");
    const material = canonicalLegacyMaterial(validated.material);
    const ending = canonicalLegacyEnding(material.ending);
    const terminalSourceRefs = new Set(material.terminalFacts.map((fact) => fact.sourceRef));
    if (material.canonMutations.some((mutation) => !terminalSourceRefs.has(mutation.sourceRef))) {
      failLegacyTerminal(ERROR.INVALID_CONTRACT, "CANON_MUTATION_SOURCE_NOT_SETTLED");
    }
    const terminalFactIds = new Set(material.terminalFacts.map((fact) => fact.factId));
    if (material.allowedFactIds.some((factId) => !terminalFactIds.has(factId))) {
      failLegacyTerminal(ERROR.INVALID_CONTRACT, "NARRATIVE_FACT_NOT_SETTLED");
    }

    const canonAfter = applyLegacyCanonMutations(material.canonBefore, material.canonMutations);
    const structuredResult: LegacyStructuredResultV1 = {
      schemaVersion: "legacy_structured_result_v1",
      runId: validated.runId,
      resultType: material.resultType,
      authoritativeEnding: ending,
      causeRefs: [...new Set(ending.causes.map((cause) => cause.sourceRef))].sort(compareLegacyCanonicalText),
      replayPolicyVersion: material.replayPolicyVersion,
    };
    const structuredResultHash = computeLegacyStructuredResultHash(structuredResult);
    const narrativeOutbox = {
      schemaVersion: "legacy_terminal_narrative_outbox_command_v1" as const,
      runId: validated.runId,
      audience: { ...material.narrativeAudience },
      sourceRuntimeProfile: "OPENNOVEL_T20_V1" as const,
      projectionKind: "FINALE_NARRATIVE" as const,
      sourceAuthority: "LEGACY_TERMINAL_COMMITTED" as const,
      sourceId: `legacy-terminal:${validated.runId}:${validated.terminalInput.sourceTurnId}`,
      sourceContentHash: structuredResultHash,
      allowedFactIds: [...material.allowedFactIds],
      allowedObjectVersionIds: [...material.allowedObjectVersionIds],
      allowedKnowledgeIds: [...material.allowedKnowledgeIds],
      narrativeProfileVersion: material.narrativeProfileVersion,
      idempotencyKey: `legacy-terminal-narrative:${validated.runId}:${validated.terminalInput.inputHash}`,
    };
    const withoutFingerprint: Omit<ValidatedLegacyTerminalCommitCommandV1, "commandFingerprint"> = {
      schemaVersion: "validated_legacy_terminal_commit_command_v1",
      kind: "LEGACY_OPENOVEL",
      runId: validated.runId,
      expectedRuntimeTerminalState: "HANDOFF_READY",
      expectedStateHash: validated.terminalInput.settledStateHash,
      expectedCanonHash: validated.terminalInput.canonBeforeHash,
      inputHash: validated.terminalInput.inputHash,
      authoritativeEnding: ending,
      canonMutations: material.canonMutations.map((mutation) => ({ ...mutation })),
      canonAfterHash: computeLegacyCanonHash(canonAfter),
      structuredResult,
      structuredResultHash,
      resultSchemaVersion: "openovel_result_v2",
      narrativeOutbox,
      narrativeOutboxFingerprint: computeLegacyNarrativeOutboxFingerprint(narrativeOutbox),
      idempotencyKey,
    };
    return validateLegacyTerminalCommitCommandV1({
      ...withoutFingerprint,
      commandFingerprint: computeLegacyTerminalCommandFingerprint(withoutFingerprint),
    });
  }
}

