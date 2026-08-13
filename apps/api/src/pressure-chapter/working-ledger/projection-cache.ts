import {
  isSha256,
  sha256Canonical,
  validateDecisionActionV1,
  validateSeatIdV1,
  type ChapterIdV1,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  AcceptedFormalActionV1,
  WorkingLedgerProjectionV1,
} from "./contracts";
import { workingStateHash } from "./working-ledger";

interface ProjectionCacheBindingsV1 {
  runId: string;
  chapterRuntimeId: string;
  chapterId: string;
  routeHash: string;
  workingRevision: number;
  workingState: unknown;
  workingStateHash: string;
}

export function decodeWorkingLedgerProjectionCacheV1(
  value: unknown,
  bindings: Readonly<ProjectionCacheBindingsV1>,
): WorkingLedgerProjectionV1 {
  const cache = record(value, "ledgerProjectionJson");
  const { projectionCacheHash, ...cacheBody } = cache;
  const key = record(cache.key, "ledgerProjectionJson.key");
  const state = structuredClone(bindings.workingState) as WorkingLedgerProjectionV1["state"];
  if (
    cache.schemaVersion !== "pressure_mvp_ledger_projection_v1"
    || (projectionCacheHash !== undefined && (
      !isSha256(String(projectionCacheHash))
      || sha256Canonical(cacheBody) !== projectionCacheHash
    ))
    || key.runId !== bindings.runId
    || key.chapterRuntimeId !== bindings.chapterRuntimeId
    || cache.chapterId !== bindings.chapterId
    || cache.routeHash !== bindings.routeHash
    || !isSha256(String(cache.chapterDefinitionHash ?? ""))
    || !isSha256(String(cache.headHash ?? ""))
    || !Number.isSafeInteger(cache.headSequence)
    || Number(cache.headSequence) < 0
    || !isSha256(String(cache.stateHash ?? ""))
    || cache.stateHash !== bindings.workingStateHash
    || workingStateHash(state) !== bindings.workingStateHash
    || state.runId !== bindings.runId
    || state.chapterId !== bindings.chapterId
    || state.revision !== bindings.workingRevision
  ) throw new Error("WORKING_PROJECTION_CACHE_BINDING_MISMATCH");

  const acceptedActions = map<AcceptedFormalActionV1>(cache.acceptedActions, "acceptedActions");
  const actionsByIdempotencyKey = map<AcceptedFormalActionV1>(
    cache.actionsByIdempotencyKey,
    "actionsByIdempotencyKey",
  );
  for (const [actionId, accepted] of acceptedActions) {
    const action = validateDecisionActionV1(accepted.action);
    if (
      actionId !== action.actionId
      || action.runId !== bindings.runId
      || action.chapterRuntimeId !== bindings.chapterRuntimeId
      || action.chapterId !== bindings.chapterId
      || accepted.routeHash !== bindings.routeHash
      || !isSha256(accepted.eventHash)
      || !isSha256(accepted.inputFingerprint)
    ) throw new Error("WORKING_PROJECTION_CACHE_ACTION_MISMATCH");
    const byKey = actionsByIdempotencyKey.get(action.idempotencyKey);
    if (!byKey || byKey.eventHash !== accepted.eventHash) {
      throw new Error("WORKING_PROJECTION_CACHE_IDEMPOTENCY_MISMATCH");
    }
  }
  if (actionsByIdempotencyKey.size !== acceptedActions.size) {
    throw new Error("WORKING_PROJECTION_CACHE_IDEMPOTENCY_SIZE_MISMATCH");
  }

  return {
    key: { runId: bindings.runId, chapterRuntimeId: bindings.chapterRuntimeId },
    chapterId: bindings.chapterId as ChapterIdV1,
    routeHash: bindings.routeHash,
    chapterDefinitionHash: String(cache.chapterDefinitionHash),
    headHash: String(cache.headHash),
    headSequence: Number(cache.headSequence),
    state,
    stateHash: bindings.workingStateHash,
    nextDecisionPin: structuredClone(cache.nextDecisionPin) as WorkingLedgerProjectionV1["nextDecisionPin"],
    acceptedActions,
    actionsByIdempotencyKey,
    commitmentActionsByIdempotencyKey: map(cache.commitmentActionsByIdempotencyKey, "commitmentActionsByIdempotencyKey"),
    appliedBeats: map(cache.appliedBeats, "appliedBeats"),
    pendingReservations: map(cache.pendingReservations, "pendingReservations"),
    commitments: map(cache.commitments, "commitments"),
    evidenceRefsByAction: map(cache.evidenceRefsByAction, "evidenceRefsByAction"),
    knowledgeBySeat: seatMap<string[]>(cache.knowledgeBySeat, "knowledgeBySeat"),
    seatArcProgressBySeat: seatMap<number>(cache.seatArcProgressBySeat, "seatArcProgressBySeat"),
  };
}

export function withWorkingLedgerProjectionCacheHashV1(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...body,
    projectionCacheHash: sha256Canonical(body),
  };
}

export function workingLedgerProjectionCacheHashV1(
  projection: WorkingLedgerProjectionV1,
): string {
  return sha256Canonical({
    schemaVersion: "pressure_working_projection_compare_v1",
    key: projection.key,
    chapterId: projection.chapterId,
    routeHash: projection.routeHash,
    chapterDefinitionHash: projection.chapterDefinitionHash,
    headHash: projection.headHash,
    headSequence: projection.headSequence,
    state: projection.state,
    stateHash: projection.stateHash,
    nextDecisionPin: projection.nextDecisionPin,
    acceptedActions: entries(projection.acceptedActions),
    actionsByIdempotencyKey: entries(projection.actionsByIdempotencyKey),
    commitmentActionsByIdempotencyKey: entries(
      projection.commitmentActionsByIdempotencyKey ?? new Map(),
    ),
    appliedBeats: entries(projection.appliedBeats),
    pendingReservations: entries(projection.pendingReservations),
    commitments: entries(projection.commitments),
    evidenceRefsByAction: entries(projection.evidenceRefsByAction),
    knowledgeBySeat: entries(projection.knowledgeBySeat),
    seatArcProgressBySeat: entries(projection.seatArcProgressBySeat),
  });
}

function record(value: unknown, path: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`WORKING_PROJECTION_CACHE_OBJECT_REQUIRED:${path}`);
  }
  return value as Record<string, any>;
}

function map<T>(value: unknown, path: string): Map<string, T> {
  if (!Array.isArray(value)) throw new Error(`WORKING_PROJECTION_CACHE_MAP_REQUIRED:${path}`);
  const result = new Map<string, T>();
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || !item[0]) {
      throw new Error(`WORKING_PROJECTION_CACHE_MAP_ENTRY_INVALID:${path}`);
    }
    if (result.has(item[0])) throw new Error(`WORKING_PROJECTION_CACHE_MAP_DUPLICATE:${path}`);
    result.set(item[0], structuredClone(item[1]) as T);
  }
  return result;
}

function seatMap<T>(value: unknown, path: string): Map<SeatIdV1, T> {
  const result = new Map<SeatIdV1, T>();
  for (const [seatId, item] of map<T>(value, path)) {
    result.set(validateSeatIdV1(seatId, path), item);
  }
  return result;
}

function entries<T>(value: ReadonlyMap<string, T>): Array<[string, T]> {
  return [...value.entries()]
    .map(([key, item]) => [key, structuredClone(item)] as [string, T])
    .sort(([left], [right]) => left.localeCompare(right));
}
