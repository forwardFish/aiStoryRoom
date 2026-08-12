import {
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  validateDecisionActionV1,
  validateRunRouteSnapshotV1,
  type CanonicalJsonObject,
  type DecisionActionV1,
} from "@ai-story/shared";
import type {
  AppliedPressurePromiseOperationV1,
  ApplyPressurePromiseOperationCommandV1,
  PressureSimplePromiseAccessPortV1,
  PressureSimplePromiseFormalCommitPortV1,
} from "./contracts";
import {
  PRESSURE_SIMPLE_PROMISE_ERROR_CODES_V1 as ERROR,
  failPressureSimplePromiseV1,
} from "./errors";
import {
  PRESSURE_PROMISE_ISSUER_SEAT_V1,
  PRESSURE_PROMISE_RECEIVER_SEAT_V1,
  PRESSURE_PROMISE_SHARED_OBJECT_V1,
  compilePressurePromiseOperationMutationV1,
  pressureSimplePromiseIdV1,
} from "./policy";
import { computePressureFormalCommitmentFingerprintV1 } from "./working-ledger-commit.service";

/** Applies only explicit preset operations; generic DELIVER_LEDGER is invalid. */
export class PressurePromiseOperationServiceV1 {
  constructor(
    private readonly access: PressureSimplePromiseAccessPortV1,
    private readonly formal: PressureSimplePromiseFormalCommitPortV1,
  ) {}

  async apply(raw: ApplyPressurePromiseOperationCommandV1): Promise<AppliedPressurePromiseOperationV1> {
    const roomId = text(raw.roomId, "roomId");
    const subjectId = text(raw.subjectId, "subjectId");
    const clientRequestId = text(raw.clientRequestId, "clientRequestId");
    const access = await this.access.load({ roomId, subjectId });
    const route = validateRunRouteSnapshotV1(access.routeSnapshot);
    const expectedPromiseId = pressureSimplePromiseIdV1({
      runId: access.runId,
      issuerSeatId: PRESSURE_PROMISE_ISSUER_SEAT_V1,
    });
    const desiredOperation = raw.operationCode === "PROMISE_DELIVER_ORIGINAL_FULFILL"
      ? "FULFILL"
      : "BREAK";
    if (
      access.issuerSeatId !== PRESSURE_PROMISE_ISSUER_SEAT_V1
      || raw.promiseId !== expectedPromiseId
      || !access.existingIssuerPromiseIds.includes(expectedPromiseId)
      || !["CREATE", desiredOperation].includes(String(access.currentPromiseOperation))
    ) failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "promise.lifecycle");
    if (!(access.allowedPromiseOperationCodes ?? []).includes(raw.operationCode)) {
      failPressureSimplePromiseV1(ERROR.ACTION_NOT_AVAILABLE, "operationCode", raw.operationCode);
    }
    if (
      !Number.isSafeInteger(access.controlEpoch) || access.controlEpoch < 0
      || !Number.isSafeInteger(access.expectedWorkingRevision) || access.expectedWorkingRevision < 0
      || !Number.isSafeInteger(access.nextActionOrdinal) || access.nextActionOrdinal < 1
    ) failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "access.fences");
    const idempotencyKey = `promise-operation:${sha256Canonical({
      schemaVersion: "pressure_simple_promise_operation_request_v1",
      runId: access.runId,
      promiseId: expectedPromiseId,
      operationCode: raw.operationCode,
      clientRequestId,
    })}`;
    const payload: CanonicalJsonObject = {
      interactionKind: "FORMAL_PROMISE_OPERATION",
      promiseId: expectedPromiseId,
      operationCode: raw.operationCode,
      relatedObjectId: PRESSURE_PROMISE_SHARED_OBJECT_V1,
    };
    const actionBase = {
      schemaVersion: "sangtian_decision_action_v1" as const,
      actionId: `action_${sha256Canonical({ runId: access.runId, idempotencyKey })}`,
      runId: access.runId,
      chapterRuntimeId: access.chapterRuntimeId,
      chapterId: access.chapterId,
      decisionPointId: access.decisionPointId,
      seatId: PRESSURE_PROMISE_ISSUER_SEAT_V1,
      actionOrdinal: access.nextActionOrdinal,
      actionRevision: 1,
      controlEpoch: access.controlEpoch,
      expectedWorkingRevision: access.expectedWorkingRevision,
      status: "SEALED" as const,
      actionType: raw.operationCode,
      payload,
      payloadHash: sha256Canonical(payload),
      idempotencyKey,
    };
    const prior = access.priorCommitmentActionsByIdempotencyKey?.get(idempotencyKey);
    const action = prior
      ? validateReplayAction(prior, actionBase, payload)
      : sealAction(actionBase);
    const mutation = compilePressurePromiseOperationMutationV1({
      promiseId: expectedPromiseId,
      operationCode: raw.operationCode,
      sourceActionId: action.actionId,
    });
    const audienceSeatIds = [PRESSURE_PROMISE_ISSUER_SEAT_V1, PRESSURE_PROMISE_RECEIVER_SEAT_V1];
    const inputFingerprint = computePressureFormalCommitmentFingerprintV1({
      routeHash: route.routeHash,
      action,
      mutation,
      audienceSeatIds,
    });
    const result = await this.formal.submit({
      routeSnapshot: route,
      subjectId,
      action,
      mutation,
      audienceSeatIds,
      inputFingerprint,
    });
    return {
      schemaVersion: "pressure_simple_promise_operation_applied_v1",
      promiseId: expectedPromiseId,
      operationCode: raw.operationCode,
      status: desiredOperation === "FULFILL" ? "FULFILLED" : "BROKEN",
      sourceActionId: action.actionId,
      submitStatus: result.status,
    };
  }
}

function sealAction(
  actionBase: Omit<DecisionActionV1, "requestFingerprint" | "sealedHash">,
) {
  const requestFingerprint = computeDecisionActionRequestFingerprint(actionBase);
  const sealed = { ...actionBase, requestFingerprint };
  return validateDecisionActionV1({ ...sealed, sealedHash: sha256Canonical(sealed) });
}

function validateReplayAction(
  value: unknown,
  desired: Omit<DecisionActionV1, "requestFingerprint" | "sealedHash">,
  payload: CanonicalJsonObject,
) {
  const action = validateDecisionActionV1(value);
  if (
    action.idempotencyKey !== desired.idempotencyKey
    || action.runId !== desired.runId
    || action.chapterRuntimeId !== desired.chapterRuntimeId
    || action.chapterId !== desired.chapterId
    || action.decisionPointId !== desired.decisionPointId
    || action.seatId !== desired.seatId
    || action.expectedWorkingRevision !== desired.expectedWorkingRevision
    || action.actionType !== desired.actionType
    || sha256Canonical(action.payload) !== sha256Canonical(payload)
  ) failPressureSimplePromiseV1(ERROR.IDEMPOTENCY_MISMATCH, "action.idempotencyKey");
  return action;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !/\S/u.test(value) || value.length > 160) {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, path);
  }
  return value;
}
