import {
  isSha256,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import type { PressureCommittedCommitmentMutationV1 } from "../a-emotion-lifecycle/contracts";
import {
  PRESSURE_PROMISE_OPERATION_CODES_V1,
  PRESSURE_SIMPLE_PROMISE_CODES_V1,
  type PressurePromiseOperationCodeV1,
  type PressureSimplePromiseCodeV1,
  type PressureSimplePromiseVisibilityV1,
} from "./contracts";
import {
  PRESSURE_SIMPLE_PROMISE_ERROR_CODES_V1 as ERROR,
  failPressureSimplePromiseV1,
} from "./errors";

export const PRESSURE_PROMISE_ISSUER_SEAT_V1 = "zhejiang_administration" as const;
export const PRESSURE_PROMISE_RECEIVER_SEAT_V1 = "zhejiang_governor" as const;
export const PRESSURE_PROMISE_INVESTIGATOR_SEAT_V1 = "qingliu_law" as const;
export const PRESSURE_PROMISE_SHARED_OBJECT_V1 = "original-grain-ledger" as const;

const PROMISE_CODES = new Set<string>(PRESSURE_SIMPLE_PROMISE_CODES_V1);
const OPERATION_CODES = new Set<string>(PRESSURE_PROMISE_OPERATION_CODES_V1);

export function promiseCreateActionTypeV1(code: PressureSimplePromiseCodeV1): string {
  return `CREATE_SIMPLE_PROMISE_${code}`;
}

export function pressureSimplePromiseIdV1(input: {
  runId: string;
  issuerSeatId: SeatIdV1;
}): string {
  return `simple-promise:${sha256Canonical({
    schemaVersion: "pressure_simple_promise_slot_v1",
    runId: nonEmpty(input.runId, "runId"),
    issuerSeatId: input.issuerSeatId,
    slot: 1,
  })}`;
}

export function validatePressureSimplePromiseCreateBodyV1(value: unknown): {
  targetRoleId: SeatIdV1;
  promiseCode: PressureSimplePromiseCodeV1;
  visibility: PressureSimplePromiseVisibilityV1;
  clientRequestId: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, "body", "OBJECT");
  }
  const body = value as Record<string, unknown>;
  const keys = ["targetRoleId", "promiseCode", "visibility", "clientRequestId"];
  if (Object.keys(body).length !== keys.length || keys.some((key) => !(key in body))) {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, "body", "EXACT_FIELDS");
  }
  if (body.targetRoleId !== PRESSURE_PROMISE_RECEIVER_SEAT_V1) {
    failPressureSimplePromiseV1(ERROR.TARGET_FORBIDDEN, "body.targetRoleId");
  }
  if (!PROMISE_CODES.has(String(body.promiseCode))) {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, "body.promiseCode");
  }
  if (body.visibility !== "PRIVATE" && body.visibility !== "PUBLIC") {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, "body.visibility");
  }
  const clientRequestId = nonEmpty(body.clientRequestId, "body.clientRequestId");
  if (clientRequestId.length > 160) {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, "body.clientRequestId", "TOO_LONG");
  }
  return {
    targetRoleId: PRESSURE_PROMISE_RECEIVER_SEAT_V1,
    promiseCode: body.promiseCode as PressureSimplePromiseCodeV1,
    visibility: body.visibility,
    clientRequestId,
  };
}

/**
 * Deterministic formal mutation. The selected operation is committed through
 * Working Ledger; this function never infers an original/copy distinction
 * from DELIVER_LEDGER or narrative text.
 */
export function compilePressurePromiseOperationMutationV1(input: {
  promiseId: string;
  operationCode: PressurePromiseOperationCodeV1;
  sourceActionId: string;
}): PressureCommittedCommitmentMutationV1 {
  const promiseId = nonEmpty(input.promiseId, "promiseId");
  const sourceActionId = nonEmpty(input.sourceActionId, "sourceActionId");
  if (!OPERATION_CODES.has(input.operationCode)) {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, "operationCode");
  }
  return {
    commitmentId: promiseId,
    operation: input.operationCode === "PROMISE_DELIVER_ORIGINAL_FULFILL"
      ? "FULFILL"
      : "BREAK",
    seatIds: [PRESSURE_PROMISE_ISSUER_SEAT_V1, PRESSURE_PROMISE_RECEIVER_SEAT_V1],
    sourceActionId,
  };
}

export function assertPressurePromiseBindingHashV1(value: {
  bindingHash: string;
  [key: string]: unknown;
}): void {
  const { bindingHash, ...body } = value;
  if (!isSha256(bindingHash) || sha256Canonical(body) !== bindingHash) {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, "bindingHash");
  }
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !/\S/u.test(value)) {
    failPressureSimplePromiseV1(ERROR.INPUT_INVALID, path, "NON_EMPTY_STRING");
  }
  return value;
}

