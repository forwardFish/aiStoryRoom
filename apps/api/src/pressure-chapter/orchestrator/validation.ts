import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  validateDecisionPointDefinitionV1,
  type SeatIdV1,
} from "@ai-story/shared";
import { assertPressureChapterDefinition } from "@ai-story/templates";
import type {
  AuthoredChapterRuntimeV1,
  AuthoredDecisionRuntimeV1,
  ChapterOrchestratorStateV1,
} from "./contracts";
import {
  CHAPTER_ORCHESTRATOR_ERROR_CODES as ERROR,
  failChapterOrchestrator,
} from "./errors";

export function validateAuthoredChapterRuntimeV1(
  raw: AuthoredChapterRuntimeV1,
): AuthoredChapterRuntimeV1 {
  if (
    raw.schemaVersion !== "pressure_authored_chapter_runtime_v1"
    || !raw.contentPolicyVersion?.trim()
    || !raw.settlementContractVersion?.trim()
  ) failChapterOrchestrator(ERROR.CONTENT_INVALID, "descriptor-header");
  const definition = assertPressureChapterDefinition(raw.definition);
  if (raw.chapterId !== definition.chapterId || !definition.decisionPoints.length) {
    failChapterOrchestrator(ERROR.CONTENT_INVALID, "chapter-definition");
  }
  if (raw.decisions.length !== definition.decisionPoints.length) {
    failChapterOrchestrator(ERROR.CONTENT_INVALID, "decision-count");
  }
  const byId = new Map<string, AuthoredDecisionRuntimeV1>();
  for (const decision of raw.decisions) {
    if (byId.has(decision.decisionPointId)) {
      failChapterOrchestrator(ERROR.CONTENT_INVALID, `duplicate:${decision.decisionPointId}`);
    }
    const execution = validateDecisionPointDefinitionV1(decision.execution);
    if (
      execution.decisionPointKey !== decision.decisionPointId
      || execution.chapterId !== raw.chapterId
      || !definition.decisionPoints.some((point) => point.decisionPointId === decision.decisionPointId)
    ) failChapterOrchestrator(ERROR.CONTENT_INVALID, `execution:${decision.decisionPointId}`);
    validateSeatRequirements(decision);
    byId.set(decision.decisionPointId, { ...decision, execution });
  }
  const pointIds = definition.decisionPoints
    .map((point) => point.decisionPointId)
    .sort(compareCanonicalText);
  const closeIds = [...raw.chapterClosePolicy.decisionPointIds].sort(compareCanonicalText);
  if (
    raw.chapterClosePolicy.kind !== "ALL_AUTHORED_DECISION_POINTS_COMPLETED"
    || JSON.stringify(pointIds) !== JSON.stringify(closeIds)
  ) failChapterOrchestrator(ERROR.CONTENT_INVALID, "chapter-close-policy");
  const { descriptorHash: _hash, ...body } = raw;
  if (
    !/^[a-f0-9]{64}$/.test(raw.contentPolicyHash)
    || !/^[a-f0-9]{64}$/.test(raw.settlementContractHash)
    || sha256Canonical(body) !== raw.descriptorHash
  ) failChapterOrchestrator(ERROR.CONTENT_INVALID, "descriptor-hash");
  return structuredClone(raw);
}

export function validateOrchestratorStateV1(
  state: ChapterOrchestratorStateV1,
): ChapterOrchestratorStateV1 {
  const { orchestratorHash: _hash, ...body } = state;
  if (
    state.schemaVersion !== "pressure_chapter_orchestrator_state_v1"
    || !state.runId.trim()
    || !state.chapterRuntimeId.trim()
    || !Number.isInteger(state.revision)
    || state.revision < 0
    || sha256Canonical(body) !== state.orchestratorHash
  ) failChapterOrchestrator(ERROR.STATE_CORRUPT);
  return structuredClone(state);
}

export function withOrchestratorHashV1(
  state: Omit<ChapterOrchestratorStateV1, "orchestratorHash">,
): ChapterOrchestratorStateV1 {
  return { ...structuredClone(state), orchestratorHash: sha256Canonical(state) };
}

function validateSeatRequirements(decision: AuthoredDecisionRuntimeV1): void {
  const raw = decision.seatRequirements as unknown as Record<string, unknown>;
  const keys = Object.keys(raw).sort(compareCanonicalText);
  const expected = [...PRESSURE_CHAPTER_SEAT_IDS_V1].sort(compareCanonicalText);
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    failChapterOrchestrator(ERROR.CONTENT_INVALID, `seat-keys:${decision.decisionPointId}`);
  }
  const required: SeatIdV1[] = [];
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    const requirement = raw[seatId];
    if (requirement === "OPTIONAL") {
      failChapterOrchestrator(ERROR.OPTIONAL_UNDEFINED, `${decision.decisionPointId}:${seatId}`);
    }
    if (requirement !== "REQUIRED" && requirement !== "NOT_REQUIRED") {
      failChapterOrchestrator(ERROR.CONTENT_INVALID, `seat-requirement:${decision.decisionPointId}:${seatId}`);
    }
    if (requirement === "REQUIRED") required.push(seatId);
  }
  if (JSON.stringify(required) !== JSON.stringify(decision.execution.requiredSeatIds)) {
    failChapterOrchestrator(ERROR.CONTENT_INVALID, `required-seat-mismatch:${decision.decisionPointId}`);
  }
}
