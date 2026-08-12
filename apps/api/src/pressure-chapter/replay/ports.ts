import {
  hashWithoutField,
  validateReplayCreationReceiptV1,
  type ParticipantModeV1,
  type PressureReplayActionV1,
  type ReplayCreationReceiptV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  validatePressurePinnedRouteRegistrationV1,
  type PressurePinnedRouteRegistrationV1,
} from "../run-router";
import {
  PRESSURE_RESULT_READ_ERROR_CODES as ERROR,
  failPressureResultRead,
} from "../result/errors";

export interface ReplayResolvedTargetV1 {
  schemaVersion: "pressure_replay_route_target_v1";
  sourceRunId: string;
  targetExperience: "SAME_FROZEN_ROUTE" | "LATEST_REGISTERED_ROUTE";
  participantMode: ParticipantModeV1;
  pinnedRegistration: PressurePinnedRouteRegistrationV1;
  /** Existing source Run routeHash for SAME; null for a LATEST selection. */
  sourceRouteHash: string | null;
  /** Hash of this registration descriptor, not the future Run routeHash. */
  targetDescriptorHash: string;
}

export interface StoredReplayExecutionV1 {
  sourceRunId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  receipt: ReplayCreationReceiptV1;
}

export interface ReplayCreationRequestV1 {
  sourceRunId: string;
  viewerId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  action: PressureReplayActionV1;
  requestedRoleId: SeatIdV1 | null;
  participantMode: ParticipantModeV1;
  target: ReplayResolvedTargetV1 | null;
}

/** Read-only idempotency lookup; it must not lock or mutate the source Run. */
export interface ReplayExecutionReaderPort {
  readExecution(
    sourceRunId: string,
    idempotencyKey: string,
  ): Promise<unknown | null>;
}

/** Resolves the currently published target at command time; no client route is accepted. */
export interface ReplayTargetRouteResolverPort {
  resolveSamePressureRoute?(
    sourceRunId: string,
    participantMode: ParticipantModeV1,
    expectedSourceRouteHash: string,
  ): Promise<unknown | null>;
  resolveLatestPressureRoute(
    sourceRunId: string,
    participantMode: ParticipantModeV1,
  ): Promise<unknown | null>;
}

/**
 * One atomic, idempotent new-target transaction. Implementations may create a
 * new Run or Lobby (or a navigation receipt), but expose no source-Run writer.
 */
export interface ReplayCreationTransactionPort {
  createOnce(request: Readonly<ReplayCreationRequestV1>): Promise<unknown>;
}

export function validateReplayResolvedTargetV1(
  value: unknown,
  path = "replayTarget",
): ReplayResolvedTargetV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "OBJECT");
  const target = value as Record<string, unknown>;
  exact(target, [
    "schemaVersion",
    "sourceRunId",
    "targetExperience",
    "participantMode",
    "pinnedRegistration",
    "sourceRouteHash",
    "targetDescriptorHash",
  ], path);
  if (
    target.schemaVersion !== "pressure_replay_route_target_v1" ||
    typeof target.sourceRunId !== "string" ||
    !target.sourceRunId.trim() ||
    (target.targetExperience !== "SAME_FROZEN_ROUTE" &&
      target.targetExperience !== "LATEST_REGISTERED_ROUTE") ||
    (target.participantMode !== "SOLO" &&
      target.participantMode !== "MULTIPLAYER")
  ) invalid(path, "HEADER");
  let pinned: PressurePinnedRouteRegistrationV1;
  try {
    pinned = validatePressurePinnedRouteRegistrationV1(
      target.pinnedRegistration as PressurePinnedRouteRegistrationV1,
    );
  } catch (cause) {
    failPressureResultRead(
      ERROR.REPLAY_TARGET_UNAVAILABLE,
      `${path}.pinnedRegistration`,
      cause instanceof Error ? cause.message : "INVALID_PIN",
    );
  }
  if (
    pinned.registration.worldId !== "sangtian" ||
    !pinned.registration.participantModes.includes(target.participantMode)
  ) invalid(`${path}.pinnedRegistration`, "PARTICIPANT_MODE");
  if (target.targetExperience === "SAME_FROZEN_ROUTE") {
    hash(target.sourceRouteHash, `${path}.sourceRouteHash`);
  } else if (target.sourceRouteHash !== null) {
    invalid(`${path}.sourceRouteHash`, "LATEST_REQUIRES_NULL");
  }
  hash(target.targetDescriptorHash, `${path}.targetDescriptorHash`);
  if (
    hashWithoutField(target, "targetDescriptorHash") !==
      target.targetDescriptorHash
  ) invalid(`${path}.targetDescriptorHash`, "HASH_MISMATCH");
  return structuredClone(target) as unknown as ReplayResolvedTargetV1;
}

export function validateStoredReplayExecutionV1(
  value: unknown,
  expectedSourceRunId: string,
  expectedIdempotencyKey: string,
): StoredReplayExecutionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("replayExecution", "OBJECT");
  const execution = value as Record<string, unknown>;
  exact(execution, ["sourceRunId", "idempotencyKey", "requestFingerprint", "receipt"], "replayExecution");
  if (
    execution.sourceRunId !== expectedSourceRunId ||
    execution.idempotencyKey !== expectedIdempotencyKey
  ) {
    invalid("replayExecution", "SOURCE_OR_KEY_MISMATCH");
  }
  hash(execution.requestFingerprint, "replayExecution.requestFingerprint");
  const receipt = validateReplayCreationReceiptV1(execution.receipt);
  if (receipt.sourceRunId !== expectedSourceRunId) invalid("replayExecution.receipt.sourceRunId");
  return {
    sourceRunId: expectedSourceRunId,
    idempotencyKey: expectedIdempotencyKey,
    requestFingerprint: String(execution.requestFingerprint),
    receipt: structuredClone(receipt),
  };
}

function exact(value: Record<string, unknown>, fields: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !fields.includes(key));
  if (unknown) invalid(`${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = fields.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function hash(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid(path, "SHA256_LOWER_HEX");
}

function invalid(path: string, detail?: string): never {
  failPressureResultRead(ERROR.REPLAY_RECEIPT_INVALID, path, detail);
}
