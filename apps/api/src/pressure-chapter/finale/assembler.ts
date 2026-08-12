import {
  hashWithoutField,
  isSha256,
  sha256Canonical,
  validateSangtianFinaleInputV1,
  validateTerminalResultContextV1,
  type SangtianFinaleInputV1,
} from "@ai-story/shared";
import { validateSangtianOwnedFinalePolicyV1 } from "@ai-story/templates";
import {
  TERMINAL_COMMIT_ERROR_CODES as ERROR,
  failTerminalCommit,
} from "../terminal-commit";
import type {
  N7FrozenFinaleSourceReaderPort,
  N7FrozenFinaleSourceV1,
} from "./ports";

export interface AssembledN7FinaleInputV1 {
  source: N7FrozenFinaleSourceV1;
  input: SangtianFinaleInputV1;
}

export class N7FrozenFinaleInputAssemblerV1 {
  constructor(private readonly sourceReader: N7FrozenFinaleSourceReaderPort) {}

  async assemble(runId: string): Promise<AssembledN7FinaleInputV1> {
    nonEmpty(runId, "finaleAssembly.runId");
    const raw = await this.sourceReader.readN7FrozenSource(runId);
    if (raw === null) failTerminalCommit(ERROR.SOURCE_NOT_FOUND, "finaleAssembly.runId");
    const source = validateN7FrozenFinaleSourceV1(raw, runId);
    const inputWithoutHash = {
      schemaVersion: "sangtian_finale_input_v1" as const,
      runId: source.runId,
      routeHash: source.routeHash,
      runSeed: source.runSeed,
      genesisHash: source.genesisHash,
      frozenChapterBundles: structuredClone(source.frozenChapterBundles),
      finalWorldState: structuredClone(source.finalWorldState),
      causalEdges: structuredClone(source.causalEdges),
      policyVersion: source.policy.policyVersion,
      policyHash: source.policy.policyHash,
    };
    const input = validateSangtianFinaleInputV1({
      ...inputWithoutHash,
      inputHash: sha256Canonical(inputWithoutHash),
    });
    return { source: structuredClone(source), input };
  }
}

export function validateN7FrozenFinaleSourceV1(
  value: unknown,
  expectedRunId?: string,
): N7FrozenFinaleSourceV1 {
  const source = plainRecord(value, "n7FinaleSource");
  exactKeys(source, [
    "schemaVersion",
    "runId",
    "triggerKind",
    "terminalChapterId",
    "terminalWorldSequence",
    "routeHash",
    "runSeed",
    "genesisHash",
    "frozenChapterBundles",
    "finalWorldState",
    "causalEdges",
    "policy",
    "terminalResultContext",
    "sourceFingerprint",
  ], "n7FinaleSource");
  if (source.schemaVersion !== "n7_frozen_finale_source_v1") {
    failTerminalCommit(ERROR.INVALID_TRIGGER, "n7FinaleSource.schemaVersion");
  }
  nonEmpty(source.runId, "n7FinaleSource.runId");
  if (expectedRunId && source.runId !== expectedRunId) {
    failTerminalCommit(ERROR.INVALID_TRIGGER, "n7FinaleSource.runId", `EXPECTED_${expectedRunId}`);
  }
  if (source.triggerKind !== "N7_FROZEN") {
    failTerminalCommit(ERROR.INVALID_TRIGGER, "n7FinaleSource.triggerKind", "EXPECTED_N7_FROZEN");
  }
  if (source.terminalChapterId !== "N7" || source.terminalWorldSequence !== 7) {
    failTerminalCommit(ERROR.N7_REQUIRED, "n7FinaleSource.terminalChapterId", "EXPECTED_N7_SEQUENCE_7");
  }
  for (const field of ["routeHash", "genesisHash", "sourceFingerprint"] as const) {
    if (!isSha256(source[field])) {
      failTerminalCommit(ERROR.INVALID_TRIGGER, `n7FinaleSource.${field}`, "SHA256");
    }
  }
  nonEmpty(source.runSeed, "n7FinaleSource.runSeed");
  const policy = validateSangtianOwnedFinalePolicyV1(source.policy);
  const terminalResultContext = validateTerminalResultContextV1(source.terminalResultContext);
  if (
    terminalResultContext.runId !== source.runId
    || terminalResultContext.frozenRouteHash !== source.routeHash
    || terminalResultContext.contentPackageVersion !== policy.contentPackageVersion
    || terminalResultContext.contentPackageSha256 !== policy.contentPackageSha256
  ) {
    failTerminalCommit(
      ERROR.INVALID_TRIGGER,
      "n7FinaleSource.terminalResultContext",
      "FROZEN_TERMINAL_CONTEXT_MISMATCH",
    );
  }
  const expectedFingerprint = hashWithoutField(source, "sourceFingerprint");
  if (source.sourceFingerprint !== expectedFingerprint) {
    failTerminalCommit(
      ERROR.SOURCE_FINGERPRINT_MISMATCH,
      "n7FinaleSource.sourceFingerprint",
      `EXPECTED_${expectedFingerprint}`,
    );
  }
  return structuredClone(source) as unknown as N7FrozenFinaleSourceV1;
}

export function withN7FrozenFinaleSourceFingerprintV1(
  value: Omit<N7FrozenFinaleSourceV1, "sourceFingerprint">,
): N7FrozenFinaleSourceV1 {
  return validateN7FrozenFinaleSourceV1({
    ...structuredClone(value),
    sourceFingerprint: sha256Canonical(value),
  });
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failTerminalCommit(ERROR.INVALID_TRIGGER, path, "OBJECT");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) failTerminalCommit(ERROR.INVALID_TRIGGER, `${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in value));
  if (missing) failTerminalCommit(ERROR.INVALID_TRIGGER, `${path}.${missing}`, "MISSING_FIELD");
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    failTerminalCommit(ERROR.INVALID_TRIGGER, path, "NON_EMPTY_STRING");
  }
}
