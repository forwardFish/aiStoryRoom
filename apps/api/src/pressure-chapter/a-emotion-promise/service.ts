import {
  computeDecisionActionRequestFingerprint,
  sha256Canonical,
  validateDecisionActionV1,
  validateRunRouteSnapshotV1,
  type CanonicalJsonObject,
  type DecisionActionV1,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  type CreatePressureSimplePromiseCommandV1,
  type CreatedPressureSimplePromiseV1,
  type PressureSimplePromiseAccessPortV1,
  type PressureSimplePromiseFormalCommitPortV1,
} from "./contracts";
import {
  PRESSURE_SIMPLE_PROMISE_ERROR_CODES_V1 as ERROR,
  failPressureSimplePromiseV1,
} from "./errors";
import {
  PRESSURE_PROMISE_ISSUER_SEAT_V1,
  PRESSURE_PROMISE_RECEIVER_SEAT_V1,
  PRESSURE_PROMISE_SHARED_OBJECT_V1,
  pressureSimplePromiseIdV1,
  promiseCreateActionTypeV1,
  validatePressureSimplePromiseCreateBodyV1,
} from "./policy";
import { computePressureFormalCommitmentFingerprintV1 } from "./working-ledger-commit.service";

/**
 * Application service for POST /promises. It creates no promise row and owns
 * no lifecycle state: its only write is the existing formal Working Ledger
 * append performed by the injected commit port.
 */
export class PressureSimplePromiseServiceV1 {
  constructor(
    private readonly access: PressureSimplePromiseAccessPortV1,
    private readonly formal: PressureSimplePromiseFormalCommitPortV1,
  ) {}

  async create(raw: CreatePressureSimplePromiseCommandV1): Promise<CreatedPressureSimplePromiseV1> {
    const roomId = requiredText(raw.roomId, "roomId");
    const subjectId = requiredText(raw.subjectId, "subjectId");
    const body = validatePressureSimplePromiseCreateBodyV1(raw.body);
    const access = await this.access.load({ roomId, subjectId });
    const route = validateRunRouteSnapshotV1(access.routeSnapshot);
    if (
      route.runId !== access.runId
      || access.issuerSeatId !== PRESSURE_PROMISE_ISSUER_SEAT_V1
      || !route.seatIds.includes(access.issuerSeatId)
    ) {
      failPressureSimplePromiseV1(ERROR.ROLE_FORBIDDEN, "access.issuerSeatId");
    }
    if (
      !access.interactableSeatIds.includes(PRESSURE_PROMISE_RECEIVER_SEAT_V1)
      || body.targetRoleId !== PRESSURE_PROMISE_RECEIVER_SEAT_V1
    ) {
      failPressureSimplePromiseV1(ERROR.TARGET_FORBIDDEN, "access.interactableSeatIds");
    }
    const actionType = promiseCreateActionTypeV1(body.promiseCode);
    if (!access.allowedPromiseCodes.includes(body.promiseCode)) {
      failPressureSimplePromiseV1(ERROR.ACTION_NOT_AVAILABLE, "access.allowedPromiseCodes", body.promiseCode);
    }
    if (
      !Number.isSafeInteger(access.controlEpoch)
      || access.controlEpoch < 0
      || !Number.isSafeInteger(access.expectedWorkingRevision)
      || access.expectedWorkingRevision < 0
      || !Number.isSafeInteger(access.nextActionOrdinal)
      || access.nextActionOrdinal < 1
    ) {
      failPressureSimplePromiseV1(ERROR.CONTEXT_MISMATCH, "access.fences");
    }

    const promiseId = pressureSimplePromiseIdV1({
      runId: access.runId,
      issuerSeatId: access.issuerSeatId,
    });
    if (access.existingIssuerPromiseIds.some((id) => id !== promiseId)) {
      failPressureSimplePromiseV1(ERROR.SLOT_EXHAUSTED, "access.existingIssuerPromiseIds");
    }
    const idempotencyKey = `promise:${sha256Canonical({
      schemaVersion: "pressure_simple_promise_request_v1",
      runId: access.runId,
      issuerSeatId: access.issuerSeatId,
      clientRequestId: body.clientRequestId,
    })}`;
    const payload: CanonicalJsonObject = {
      interactionKind: "FORMAL_PROMISE",
      promiseCode: body.promiseCode,
      targetRoleId: body.targetRoleId,
      visibility: body.visibility,
      relatedObjectId: PRESSURE_PROMISE_SHARED_OBJECT_V1,
    };
    const actionBase = {
      schemaVersion: "sangtian_decision_action_v1" as const,
      actionId: `action_${sha256Canonical({
        schemaVersion: "pressure_simple_promise_action_v1",
        runId: access.runId,
        issuerSeatId: access.issuerSeatId,
        idempotencyKey,
      })}`,
      runId: access.runId,
      chapterRuntimeId: access.chapterRuntimeId,
      chapterId: access.chapterId,
      decisionPointId: access.decisionPointId,
      seatId: access.issuerSeatId,
      actionOrdinal: access.nextActionOrdinal,
      actionRevision: 1,
      controlEpoch: access.controlEpoch,
      expectedWorkingRevision: access.expectedWorkingRevision,
      status: "SEALED" as const,
      actionType,
      payload,
      payloadHash: sha256Canonical(payload),
      idempotencyKey,
    };
    const prior = access.priorCommitmentActionsByIdempotencyKey?.get(idempotencyKey);
    const action = prior
      ? validateReplayAction(prior, actionBase, payload)
      : sealAction(actionBase);
    const mutation = {
      commitmentId: promiseId,
      operation: "CREATE" as const,
      seatIds: [PRESSURE_PROMISE_ISSUER_SEAT_V1, PRESSURE_PROMISE_RECEIVER_SEAT_V1],
      sourceActionId: action.actionId,
    };
    const audienceSeatIds: SeatIdV1[] = body.visibility === "PUBLIC"
      ? [...route.seatIds] as SeatIdV1[]
      : [PRESSURE_PROMISE_ISSUER_SEAT_V1, PRESSURE_PROMISE_RECEIVER_SEAT_V1];
    const inputFingerprint = computePressureFormalCommitmentFingerprintV1({
      routeHash: route.routeHash,
      action,
      mutation,
      audienceSeatIds,
    });
    const submitted = await this.formal.submit({
      routeSnapshot: route,
      subjectId,
      action,
      mutation,
      audienceSeatIds,
      inputFingerprint,
    });
    return {
      schemaVersion: "pressure_simple_promise_created_v1",
      promiseId,
      sourceRoleId: PRESSURE_PROMISE_ISSUER_SEAT_V1,
      targetRoleId: PRESSURE_PROMISE_RECEIVER_SEAT_V1,
      promiseCode: body.promiseCode,
      relatedObjectId: PRESSURE_PROMISE_SHARED_OBJECT_V1,
      visibility: body.visibility,
      createdByActionId: submitted.event.payload.eventType === "FORMAL_COMMITMENT_APPLIED"
        ? submitted.event.payload.action.actionId
        : action.actionId,
      status: "ACTIVE",
      submitStatus: submitted.status,
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

function requiredText(value: unknown, path: string): string {
  if (typeof value !== "string" || !/\S/u.test(value)) {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, path);
  }
  return value;
}
