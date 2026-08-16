import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  compareCanonicalText,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import type {
  BeatSubmitControllerAuthorityV1,
  BeatSubmitPlanV1,
  BeatSubmitPolicyInputV1,
} from "./contracts";

export const BEAT_SUBMIT_POLICY_VERSION_V1 =
  "pressure-beat-submit-policy-1.0.0" as const;

export const BEAT_SUBMIT_POLICY_ERROR_CODES_V1 = Object.freeze({
  INVALID_INPUT: "PRESSURE_BEAT_SUBMIT_POLICY_INVALID_INPUT",
  AUTHORITY_MISMATCH: "PRESSURE_BEAT_SUBMIT_POLICY_AUTHORITY_MISMATCH",
  VIEWER_NOT_ACTIVE_HUMAN: "PRESSURE_BEAT_SUBMIT_POLICY_VIEWER_NOT_ACTIVE_HUMAN",
} as const);

export type BeatSubmitPolicyErrorCodeV1 =
  (typeof BEAT_SUBMIT_POLICY_ERROR_CODES_V1)[keyof typeof BEAT_SUBMIT_POLICY_ERROR_CODES_V1];

export class BeatSubmitPolicyErrorV1 extends Error {
  readonly name = "BeatSubmitPolicyErrorV1";

  constructor(
    readonly code: BeatSubmitPolicyErrorCodeV1,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

const INPUT_FIELDS = Object.freeze([
  "schemaVersion",
  "beat",
  "participantMode",
  "viewerSeatId",
  "requiredSeatIds",
  "controllerTopology",
  "inputHash",
]);
const BEAT_FIELDS = Object.freeze(["beatId", "closesChapter"]);
const CONTROLLER_FIELDS = Object.freeze([
  "seatId",
  "mode",
  "activeControllerId",
  "controlEpoch",
  "authorityStateHash",
  "requiresResolution",
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const KNOWN_SEATS = new Set<string>(PRESSURE_CHAPTER_SEAT_IDS_V1);

export function computeBeatSubmitPolicyInputHashV1(
  input: Omit<BeatSubmitPolicyInputV1, "inputHash">,
): string {
  return sha256Canonical(input);
}

/**
 * Pure Beat submission classification. It owns no I/O ports and has no ability
 * to call external services, persistence, or the database.
 */
export class BeatSubmitPolicyV1 {
  plan(input: Readonly<BeatSubmitPolicyInputV1>): BeatSubmitPlanV1 {
    return planBeatSubmitV1(input);
  }
}

export function planBeatSubmitV1(
  input: Readonly<BeatSubmitPolicyInputV1>,
): BeatSubmitPlanV1 {
  validateInput(input);
  const controllers = new Map<SeatIdV1, BeatSubmitControllerAuthorityV1>(
    input.controllerTopology.map((controller) => [controller.seatId, controller]),
  );
  const viewer = controllers.get(input.viewerSeatId);
  if (
    !viewer
    || viewer.mode !== "HUMAN_ACTIVE"
    || viewer.requiresResolution !== true
    || !input.requiredSeatIds.includes(input.viewerSeatId)
  ) {
    fail(
      "VIEWER_NOT_ACTIVE_HUMAN",
      "viewerSeatId",
      "PENDING_REQUIRED_HUMAN_CONTROLLER_REQUIRED",
    );
  }

  const chapterClosing = input.beat.closesChapter === true;
  const npcResolutionSeatIds = chapterClosing
    ? input.requiredSeatIds.filter((seatId) => {
        const controller = controllers.get(seatId)!;
        return controller.mode === "AI_ACTIVE" && controller.requiresResolution;
      })
    : [];
  const planWithoutHash = {
    schemaVersion: "pressure_beat_submit_plan_v1" as const,
    policyVersion: BEAT_SUBMIT_POLICY_VERSION_V1,
    beatId: input.beat.beatId,
    participantMode: input.participantMode,
    viewerSeatId: input.viewerSeatId,
    mode: chapterClosing
      ? "CHAPTER_COUNCIL_COMMIT" as const
      : "INTERMEDIATE_ACTION_ONLY" as const,
    humanSubmissionSeatIds: [input.viewerSeatId] as SeatIdV1[],
    npcResolutionSeatIds,
    invokeSettlement: chapterClosing,
    inputHash: input.inputHash,
  };
  return deepFreeze({
    ...planWithoutHash,
    planHash: sha256Canonical(planWithoutHash),
  });
}

function validateInput(input: Readonly<BeatSubmitPolicyInputV1>): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_INPUT", "$", "OBJECT_REQUIRED");
  }
  assertExactKeys(input as unknown as Record<string, unknown>, INPUT_FIELDS, "$input");
  if (input.schemaVersion !== "pressure_beat_submit_policy_input_v1") {
    fail("INVALID_INPUT", "schemaVersion", "UNSUPPORTED");
  }
  if (!input.beat || typeof input.beat !== "object" || Array.isArray(input.beat)) {
    fail("INVALID_INPUT", "beat", "OBJECT_REQUIRED");
  }
  assertExactKeys(input.beat as unknown as Record<string, unknown>, BEAT_FIELDS, "beat");
  requireText(input.beat.beatId, "beat.beatId");
  if (typeof input.beat.closesChapter !== "boolean") {
    fail("INVALID_INPUT", "beat.closesChapter", "BOOLEAN_REQUIRED");
  }
  if (input.participantMode !== "SOLO" && input.participantMode !== "MULTIPLAYER") {
    fail("INVALID_INPUT", "participantMode", "UNSUPPORTED");
  }
  validateKnownSeat(input.viewerSeatId, "viewerSeatId");
  const requiredSeatIds = validateSeatIds(input.requiredSeatIds, "requiredSeatIds");
  if (!requiredSeatIds.includes(input.viewerSeatId)) {
    fail("AUTHORITY_MISMATCH", "viewerSeatId", "NOT_REQUIRED");
  }
  if (!Array.isArray(input.controllerTopology) || input.controllerTopology.length === 0) {
    fail("INVALID_INPUT", "controllerTopology", "NON_EMPTY_ARRAY_REQUIRED");
  }
  const controllerSeatIds = new Set<string>();
  for (const [index, controller] of input.controllerTopology.entries()) {
    const path = `controllerTopology[${index}]`;
    if (!controller || typeof controller !== "object" || Array.isArray(controller)) {
      fail("INVALID_INPUT", path, "OBJECT_REQUIRED");
    }
    assertExactKeys(controller as unknown as Record<string, unknown>, CONTROLLER_FIELDS, path);
    validateKnownSeat(controller.seatId, `${path}.seatId`);
    if (controllerSeatIds.has(controller.seatId)) {
      fail("INVALID_INPUT", `${path}.seatId`, "DUPLICATE");
    }
    controllerSeatIds.add(controller.seatId);
    if (controller.mode !== "HUMAN_ACTIVE" && controller.mode !== "AI_ACTIVE") {
      fail("INVALID_INPUT", `${path}.mode`, "UNSUPPORTED");
    }
    requireText(controller.activeControllerId, `${path}.activeControllerId`);
    if (!Number.isSafeInteger(controller.controlEpoch) || controller.controlEpoch < 1) {
      fail("INVALID_INPUT", `${path}.controlEpoch`, "POSITIVE_SAFE_INTEGER_REQUIRED");
    }
    if (!SHA256.test(controller.authorityStateHash)) {
      fail("INVALID_INPUT", `${path}.authorityStateHash`, "SHA256_REQUIRED");
    }
    if (typeof controller.requiresResolution !== "boolean") {
      fail("INVALID_INPUT", `${path}.requiresResolution`, "BOOLEAN_REQUIRED");
    }
  }
  for (const seatId of requiredSeatIds) {
    if (!controllerSeatIds.has(seatId)) {
      fail("AUTHORITY_MISMATCH", "controllerTopology", `MISSING_REQUIRED_SEAT_${seatId}`);
    }
  }
  if (!SHA256.test(input.inputHash)) {
    fail("INVALID_INPUT", "inputHash", "SHA256_REQUIRED");
  }
  const expectedInputHash = computeBeatSubmitPolicyInputHashV1({
    schemaVersion: input.schemaVersion,
    beat: structuredClone(input.beat),
    participantMode: input.participantMode,
    viewerSeatId: input.viewerSeatId,
    requiredSeatIds: [...input.requiredSeatIds],
    controllerTopology: input.controllerTopology.map((controller) => ({ ...controller })),
  });
  if (input.inputHash !== expectedInputHash) {
    fail("AUTHORITY_MISMATCH", "inputHash", "CANONICAL_BINDING_MISMATCH");
  }
}

function validateSeatIds(value: readonly SeatIdV1[], path: string): SeatIdV1[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("INVALID_INPUT", path, "NON_EMPTY_ARRAY_REQUIRED");
  }
  const output: SeatIdV1[] = [];
  const seen = new Set<string>();
  for (const [index, seatId] of value.entries()) {
    validateKnownSeat(seatId, `${path}[${index}]`);
    if (seen.has(seatId)) fail("INVALID_INPUT", `${path}[${index}]`, "DUPLICATE");
    seen.add(seatId);
    output.push(seatId);
  }
  return output;
}

function validateKnownSeat(value: unknown, path: string): asserts value is SeatIdV1 {
  requireText(value, path);
  if (!KNOWN_SEATS.has(value)) fail("INVALID_INPUT", path, "UNKNOWN_SEAT");
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const canonicalExpected = [...expected].sort(compareCanonicalText);
  if (actual.length !== canonicalExpected.length || actual.some((key, index) => key !== canonicalExpected[index])) {
    fail("INVALID_INPUT", path, `EXACT_KEYS_${canonicalExpected.join(",")}`);
  }
}

function requireText(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    fail("INVALID_INPUT", path, "TRIMMED_TEXT_REQUIRED");
  }
}

function fail(code: keyof typeof BEAT_SUBMIT_POLICY_ERROR_CODES_V1, path: string, detail?: string): never {
  throw new BeatSubmitPolicyErrorV1(BEAT_SUBMIT_POLICY_ERROR_CODES_V1[code], path, detail);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
