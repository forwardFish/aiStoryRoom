import { canonicalJson, isSha256, sha256Canonical } from "../contracts/canonical";
import {
  validateSealedChapterSettlementInputV1,
  type SealedChapterSettlementInputV1 as PressureSealedChapterSettlementInputV1,
} from "../contracts/chapter";
import { PressureChapterContractError } from "../contracts/errors";
import { chapterSequence } from "../contracts/domain";
import { PRESSURE_CHAPTER_SEAT_IDS_V1 } from "../contracts/route";
import { cloneAndFreezeB0, compareB0Text } from "./canonical";
import { B0ChapterSettlementErrorV1, type B0ChapterSettlementErrorCodeV1 } from "./errors";
import {
  type B0ChapterCausalEdgeV1,
  type B0ChapterPolicyEvaluationDraftV1,
  type B0ChapterPolicyEvaluationV1,
  type B0ChapterResourceDeltaV1,
  type B0ChapterSeatArcDeltaV1,
  type B0ChapterSeatParticipationV1,
  type B0ChapterSettlementCompileRequestV1,
  type B0ChapterSettlementCommandV1,
  type B0ChapterSettlementInputDraftV1,
  type B0ChapterSettlementInputV1,
  type B0ChapterSettlementReceiptV1,
  type B0ChapterSettlementResultV1,
  type B0ChapterWorldDeltaV1,
  type B0ChapterWorldMutationV1,
  type B0SealedChapterDecisionActionV1,
  type B0SealedChapterResourceCommitmentV1,
} from "./types";


export function computeB0RunChapterFingerprintV1(input: Pick<
  B0ChapterSettlementInputV1,
  "wireInput" | "chapterSequence"
>): string {
  return sha256Canonical({
    schemaVersion: "b0_run_chapter_fingerprint_v1",
    runId: input.wireInput.runId,
    chapterRuntimeId: input.wireInput.chapterRuntimeId,
    chapterId: input.wireInput.chapterId,
    chapterSequence: input.chapterSequence,
  });
}

export function computeB0ChapterSettlementInputHashV1(
  input: Omit<B0ChapterSettlementInputV1, "b0InputHash">,
): string {
  return sha256Canonical(input);
}

export function compileB0ChapterSettlementInputV1(
  request: B0ChapterSettlementCompileRequestV1,
): Readonly<B0ChapterSettlementInputV1> {
  assertExactKeys(request, ["wireInput", "settlementMaterial"], "compileRequest", "INPUT_SCHEMA_INVALID");
  const wireInput = authoritativeWireInput(request.wireInput);
  const sequence = chapterSequence(wireInput.chapterId);
  const draft: B0ChapterSettlementInputDraftV1 = {
    schemaVersion: "b0_chapter_settlement_input_v1",
    wireInput,
    chapterSequence: sequence,
    settlementMaterial: request.settlementMaterial,
  };
  const canonicalDraft = canonicalizeB0InputDraft(draft);
  validateB0InputDraft(canonicalDraft);
  const runChapterFingerprint = computeB0RunChapterFingerprintV1(canonicalDraft);
  const withoutHash = { ...canonicalDraft, runChapterFingerprint };
  const compiled = {
    ...withoutHash,
    b0InputHash: computeB0ChapterSettlementInputHashV1(withoutHash),
  };
  return cloneAndFreezeB0(compiled) as Readonly<B0ChapterSettlementInputV1>;
}

export function canonicalizeB0ChapterSettlementInputV1(
  input: B0ChapterSettlementInputV1,
): Readonly<B0ChapterSettlementInputV1> {
  const canonical = {
    ...canonicalizeB0InputDraft(input),
    runChapterFingerprint: input.runChapterFingerprint,
    b0InputHash: input.b0InputHash,
  };
  validateB0InputDraft(canonical);
  const expectedRunChapterFingerprint = computeB0RunChapterFingerprintV1(canonical);
  if (canonical.runChapterFingerprint !== expectedRunChapterFingerprint) {
    fail("RUN_CHAPTER_FINGERPRINT_MISMATCH", "The sealed input is not bound to its run and chapter.");
  }
  const { b0InputHash: _ignored, ...withoutHash } = canonical;
  if (canonical.b0InputHash !== computeB0ChapterSettlementInputHashV1(withoutHash)) {
    fail("B0_INPUT_HASH_MISMATCH", "The internal B0 input does not match its immutable hash.");
  }
  return cloneAndFreezeB0(canonical) as Readonly<B0ChapterSettlementInputV1>;
}

export function computeB0ChapterPolicyEvaluationHashV1(
  evaluation: Omit<B0ChapterPolicyEvaluationV1, "evaluationHash">,
): string {
  return sha256Canonical(evaluation);
}

export function sealB0ChapterPolicyEvaluationV1(
  draft: B0ChapterPolicyEvaluationDraftV1,
): Readonly<B0ChapterPolicyEvaluationV1> {
  const canonical = canonicalizeEvaluationDraft(draft);
  validateEvaluationDraft(canonical);
  return cloneAndFreezeB0({
    ...canonical,
    evaluationHash: computeB0ChapterPolicyEvaluationHashV1(canonical),
  }) as Readonly<B0ChapterPolicyEvaluationV1>;
}

export function canonicalizeB0ChapterPolicyEvaluationV1(
  evaluation: B0ChapterPolicyEvaluationV1,
): Readonly<B0ChapterPolicyEvaluationV1> {
  const canonical = {
    ...canonicalizeEvaluationDraft(evaluation),
    evaluationHash: evaluation.evaluationHash,
  };
  validateEvaluationDraft(canonical);
  const { evaluationHash: _ignored, ...withoutHash } = canonical;
  if (canonical.evaluationHash !== computeB0ChapterPolicyEvaluationHashV1(withoutHash)) {
    fail("EVALUATION_HASH_MISMATCH", "The chapter policy evaluation does not match its immutable hash.");
  }
  return cloneAndFreezeB0(canonical) as Readonly<B0ChapterPolicyEvaluationV1>;
}

export function computeB0ChapterRequestFingerprintV1(input: {
  idempotencyKey: string;
  sealedInput: Pick<B0ChapterSettlementInputV1, "runChapterFingerprint" | "b0InputHash">;
  evaluation: Pick<B0ChapterPolicyEvaluationV1, "evaluationHash">;
}): string {
  return sha256Canonical({
    schemaVersion: "b0_chapter_settlement_request_fingerprint_v1",
    idempotencyKey: input.idempotencyKey,
    runChapterFingerprint: input.sealedInput.runChapterFingerprint,
    b0InputHash: input.sealedInput.b0InputHash,
    evaluationHash: input.evaluation.evaluationHash,
  });
}

export function createB0ChapterSettlementCommandV1(input: {
  idempotencyKey: string;
  sealedInput: B0ChapterSettlementInputV1;
  evaluation: B0ChapterPolicyEvaluationV1;
}): Readonly<B0ChapterSettlementCommandV1> {
  requiredText(input.idempotencyKey, "command.idempotencyKey", "INPUT_SCHEMA_INVALID");
  const sealedInput = canonicalizeB0ChapterSettlementInputV1(input.sealedInput);
  const evaluation = canonicalizeB0ChapterPolicyEvaluationV1(input.evaluation);
  assertEvaluationBinding(sealedInput, evaluation);
  return cloneAndFreezeB0({
    schemaVersion: "b0_chapter_settlement_command_v1" as const,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint: computeB0ChapterRequestFingerprintV1({
      idempotencyKey: input.idempotencyKey,
      sealedInput,
      evaluation,
    }),
    input: sealedInput,
    evaluation,
  }) as Readonly<B0ChapterSettlementCommandV1>;
}

export function settleB0ChapterV1(
  rawCommand: B0ChapterSettlementCommandV1,
  existingReceipt?: B0ChapterSettlementReceiptV1 | null,
): B0ChapterSettlementResultV1 {
  assertExactKeys(rawCommand, [
    "schemaVersion", "idempotencyKey", "requestFingerprint", "input", "evaluation",
  ], "command", "INPUT_SCHEMA_INVALID");
  if (rawCommand.schemaVersion !== "b0_chapter_settlement_command_v1") {
    fail("INPUT_SCHEMA_INVALID", "command.schemaVersion is invalid.");
  }
  requiredText(rawCommand.idempotencyKey, "command.idempotencyKey", "INPUT_SCHEMA_INVALID");
  const input = canonicalizeB0ChapterSettlementInputV1(rawCommand.input);
  const evaluation = canonicalizeB0ChapterPolicyEvaluationV1(rawCommand.evaluation);
  assertEvaluationBinding(input, evaluation);
  const requestFingerprint = computeB0ChapterRequestFingerprintV1({
    idempotencyKey: rawCommand.idempotencyKey,
    sealedInput: input,
    evaluation,
  });
  if (rawCommand.requestFingerprint !== requestFingerprint) {
    fail("REQUEST_FINGERPRINT_MISMATCH", "The command fingerprint does not match its sealed input and evaluation.");
  }

  const worldDelta = buildChapterWorldDelta(input, evaluation);
  const receipt = buildReceipt(input, evaluation, worldDelta, rawCommand.idempotencyKey, requestFingerprint);
  if (existingReceipt) {
    assertStoredReceipt(existingReceipt);
    if (existingReceipt.idempotencyKey !== rawCommand.idempotencyKey) {
      fail("IDEMPOTENCY_KEY_MISMATCH", "The supplied receipt belongs to a different idempotency key.");
    }
    if (existingReceipt.requestFingerprint !== requestFingerprint) {
      fail(
        "CHAPTER_SETTLEMENT_FINGERPRINT_MISMATCH",
        "The idempotency key was already settled with a different request fingerprint.",
      );
    }
    if (existingReceipt.commitHash !== receipt.commitHash) {
      fail("STORED_RECEIPT_INVALID", "The stored receipt does not match the deterministic settlement result.");
    }
    return {
      worldDelta,
      receipt: cloneAndFreezeB0({ ...existingReceipt, status: "ALREADY_SETTLED" as const }) as Readonly<B0ChapterSettlementReceiptV1>,
    };
  }
  return { worldDelta, receipt };
}

function canonicalizeB0InputDraft(
  input: B0ChapterSettlementInputDraftV1 | B0ChapterSettlementInputV1,
): B0ChapterSettlementInputDraftV1 {
  assertExactKeys(input, [
    "schemaVersion", "wireInput", "chapterSequence", "settlementMaterial",
    ...(hasOwn(input, "runChapterFingerprint") ? ["runChapterFingerprint"] : []),
    ...(hasOwn(input, "b0InputHash") ? ["b0InputHash"] : []),
  ], "b0Input", "INPUT_SCHEMA_INVALID");
  const wireInput = authoritativeWireInput(input.wireInput);
  assertExactKeys(
    input.settlementMaterial,
    ["seats", "resources", "actions"],
    "b0Input.settlementMaterial",
    "INPUT_SCHEMA_INVALID",
  );
  requireArray(input.settlementMaterial.seats, "b0Input.settlementMaterial.seats", "INPUT_SCHEMA_INVALID");
  requireArray(input.settlementMaterial.resources, "b0Input.settlementMaterial.resources", "INPUT_SCHEMA_INVALID");
  requireArray(input.settlementMaterial.actions, "b0Input.settlementMaterial.actions", "INPUT_SCHEMA_INVALID");
  return {
    schemaVersion: input.schemaVersion,
    wireInput: cloneAndFreezeB0(wireInput) as PressureSealedChapterSettlementInputV1,
    chapterSequence: input.chapterSequence,
    settlementMaterial: {
      seats: [...input.settlementMaterial.seats]
        .map(canonicalSeat)
        .sort((left, right) => compareB0SeatIds(left.seatId, right.seatId)),
      resources: [...input.settlementMaterial.resources]
        .map((resource) => ({ ...resource }))
        .sort((left, right) => compareB0Text(left.resourceId, right.resourceId)),
      actions: [...input.settlementMaterial.actions]
        .map(canonicalAction)
        .sort((left, right) => compareB0Text(left.actionId, right.actionId)),
    },
  };
}

function canonicalSeat(seat: B0ChapterSeatParticipationV1): B0ChapterSeatParticipationV1 {
  assertExactKeys(
    seat,
    ["seatId", "requirement", "completion", "defaultCodes"],
    "seat",
    "SIX_SEAT_TOPOLOGY_INVALID",
  );
  requireArray(
    seat.defaultCodes,
    "seat.defaultCodes",
    "SIX_SEAT_TOPOLOGY_INVALID",
  );
  seat.defaultCodes.forEach((code, index) => {
    requiredText(
      code,
      "seat.defaultCodes[" + index + "]",
      "SIX_SEAT_TOPOLOGY_INVALID",
    );
  });
  return {
    seatId: seat.seatId,
    requirement: seat.requirement,
    completion: seat.completion,
    defaultCodes: [...new Set(seat.defaultCodes)].sort(compareB0Text),
  };
}

function canonicalAction(action: B0SealedChapterDecisionActionV1): B0SealedChapterDecisionActionV1 {
  assertExactKeys(action, [
    "actionId", "decisionPointId", "seatId", "source", "actionType", "payload",
    "resourceCommitments", "evidenceRefs",
  ], "action", "INPUT_SCHEMA_INVALID");
  requireArray(action.resourceCommitments, "action.resourceCommitments", "INPUT_SCHEMA_INVALID");
  requireArray(action.evidenceRefs, "action.evidenceRefs", "INPUT_SCHEMA_INVALID");
  action.resourceCommitments.forEach((commitment) => assertExactKeys(commitment, [
    "commitmentId", "reservationKey", "resourceId", "amount", "expectedResourceVersion",
  ], "resourceCommitment", "RESOURCE_SNAPSHOT_INVALID"));
  return {
    actionId: action.actionId,
    decisionPointId: action.decisionPointId,
    seatId: action.seatId,
    source: action.source,
    actionType: action.actionType,
    payload: cloneAndFreezeB0(action.payload) as B0SealedChapterDecisionActionV1["payload"],
    resourceCommitments: [...action.resourceCommitments]
      .map((commitment) => ({ ...commitment }))
      .sort(compareCommitments),
    evidenceRefs: [...action.evidenceRefs].sort(compareB0Text),
  };
}

function compareCommitments(
  left: B0SealedChapterResourceCommitmentV1,
  right: B0SealedChapterResourceCommitmentV1,
): number {
  return compareB0Text(left.commitmentId, right.commitmentId)
    || compareB0Text(left.resourceId, right.resourceId)
    || left.amount - right.amount;
}

function compareB0SeatIds(
  left: B0ChapterSeatParticipationV1["seatId"],
  right: B0ChapterSeatParticipationV1["seatId"],
): number {
  return PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(left)
    - PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(right);
}

function canonicalizeEvaluationDraft(
  evaluation: B0ChapterPolicyEvaluationDraftV1 | B0ChapterPolicyEvaluationV1,
): B0ChapterPolicyEvaluationDraftV1 {
  assertExactKeys(evaluation, [
    "schemaVersion", "b0InputHash", "contentPolicyVersion", "contentPolicyHash",
    "resourceDispositions", "mutations", "seatArcDeltas", "trackDelta", "carryForward",
    "causalEdges", ...(hasOwn(evaluation, "evaluationHash") ? ["evaluationHash"] : []),
  ], "evaluation", "EVALUATION_SCHEMA_INVALID");
  requireArray(evaluation.resourceDispositions, "evaluation.resourceDispositions", "EVALUATION_SCHEMA_INVALID");
  requireArray(evaluation.mutations, "evaluation.mutations", "EVALUATION_SCHEMA_INVALID");
  requireArray(evaluation.seatArcDeltas, "evaluation.seatArcDeltas", "EVALUATION_SCHEMA_INVALID");
  requireArray(evaluation.causalEdges, "evaluation.causalEdges", "EVALUATION_SCHEMA_INVALID");
  evaluation.resourceDispositions.forEach((entry) => assertExactKeys(
    entry,
    ["commitmentId", "disposition"],
    "resourceDisposition",
    "RESOURCE_DISPOSITION_MISMATCH",
  ));
  evaluation.seatArcDeltas.forEach((entry) => assertExactKeys(
    entry,
    ["seatId", "delta"],
    "seatArcDelta",
    "EVALUATION_SCHEMA_INVALID",
  ));
  return {
    schemaVersion: evaluation.schemaVersion,
    b0InputHash: evaluation.b0InputHash,
    contentPolicyVersion: evaluation.contentPolicyVersion,
    contentPolicyHash: evaluation.contentPolicyHash,
    resourceDispositions: [...evaluation.resourceDispositions]
      .map((entry) => ({ ...entry }))
      .sort((left, right) => compareB0Text(left.commitmentId, right.commitmentId)),
    mutations: [...evaluation.mutations].map(canonicalMutation).sort(compareMutations),
    seatArcDeltas: [...evaluation.seatArcDeltas]
      .map((entry) => ({ seatId: entry.seatId, delta: cloneAndFreezeB0(entry.delta) as B0ChapterSeatArcDeltaV1["delta"] }))
      .sort((left, right) => compareB0SeatIds(left.seatId, right.seatId)),
    trackDelta: cloneAndFreezeB0(evaluation.trackDelta) as B0ChapterPolicyEvaluationV1["trackDelta"],
    carryForward: cloneAndFreezeB0(evaluation.carryForward) as B0ChapterPolicyEvaluationV1["carryForward"],
    causalEdges: [...evaluation.causalEdges].map(canonicalEdge).sort((left, right) => compareB0Text(left.edgeId, right.edgeId)),
  };
}

function canonicalMutation(mutation: B0ChapterWorldMutationV1): B0ChapterWorldMutationV1 {
  assertExactKeys(mutation, [
    "mutationId", "entityType", "entityId", "attribute", "operation", "value", "originActionIds",
  ], "mutation", "EVALUATION_SCHEMA_INVALID");
  requireArray(mutation.originActionIds, "mutation.originActionIds", "EVALUATION_SCHEMA_INVALID");
  return {
    mutationId: mutation.mutationId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    attribute: mutation.attribute,
    operation: mutation.operation,
    value: cloneAndFreezeB0(mutation.value) as B0ChapterWorldMutationV1["value"],
    originActionIds: [...mutation.originActionIds].sort(compareB0Text),
  };
}

function compareMutations(left: B0ChapterWorldMutationV1, right: B0ChapterWorldMutationV1): number {
  return compareB0Text(left.entityType, right.entityType)
    || compareB0Text(left.entityId, right.entityId)
    || compareB0Text(left.attribute, right.attribute)
    || compareB0Text(left.operation, right.operation)
    || compareB0Text(left.mutationId, right.mutationId);
}

function canonicalEdge(edge: B0ChapterCausalEdgeV1): B0ChapterCausalEdgeV1 {
  assertExactKeys(edge, [
    "edgeId", "fromActionIds", "toMutationIds", "relation", "evidenceRefs",
  ], "causalEdge", "CAUSAL_REFERENCE_INVALID");
  requireArray(edge.fromActionIds, "causalEdge.fromActionIds", "CAUSAL_REFERENCE_INVALID");
  requireArray(edge.toMutationIds, "causalEdge.toMutationIds", "CAUSAL_REFERENCE_INVALID");
  requireArray(edge.evidenceRefs, "causalEdge.evidenceRefs", "CAUSAL_REFERENCE_INVALID");
  return {
    edgeId: edge.edgeId,
    fromActionIds: [...edge.fromActionIds].sort(compareB0Text),
    toMutationIds: [...edge.toMutationIds].sort(compareB0Text),
    relation: edge.relation,
    evidenceRefs: [...edge.evidenceRefs].sort(compareB0Text),
  };
}

function validateB0InputDraft(input: B0ChapterSettlementInputDraftV1): void {
  if (input.schemaVersion !== "b0_chapter_settlement_input_v1") {
    fail("INPUT_SCHEMA_INVALID", "b0Input.schemaVersion is invalid.");
  }
  const wireInput = authoritativeWireInput(input.wireInput);
  const expectedSequence = chapterSequence(wireInput.chapterId);
  if (input.chapterSequence !== expectedSequence || wireInput.baseWorldSequence !== expectedSequence - 1) {
    fail(
      "BASE_WORLD_SEQUENCE_MISMATCH",
      `${wireInput.chapterId} must use chapterSequence=${expectedSequence} and baseWorldSequence=${expectedSequence - 1}.`,
    );
  }
  validateSeats(input.settlementMaterial.seats, input.settlementMaterial.actions);
  validateActionsAndResources(
    input.settlementMaterial.actions,
    input.settlementMaterial.resources,
    wireInput.sealedDecisionActionIds,
  );
}

function validateSeats(
  seats: B0ChapterSeatParticipationV1[],
  actions: B0SealedChapterDecisionActionV1[],
): void {
  if (seats.length !== 6) fail("SIX_SEAT_TOPOLOGY_INVALID", "A sealed chapter must contain exactly six seats.");
  assertUnique(seats.map((seat) => seat.seatId), "SIX_SEAT_TOPOLOGY_INVALID", "seatId");
  if (seats.some((seat, index) => seat.seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index])) {
    fail("SIX_SEAT_TOPOLOGY_INVALID", "A sealed chapter must contain the canonical six institutional seats.");
  }
  const seatById = new Map(seats.map((seat) => [seat.seatId, seat]));
  for (const action of actions) {
    const seat = seatById.get(action.seatId);
    if (!seat || seat.requirement !== "REQUIRED") {
      fail("ACTION_CONTEXT_MISMATCH", `Action ${action.actionId} belongs to an unknown or NOT_REQUIRED seat.`);
    }
    if (seat.completion === "DEFAULTED" && action.source !== "DEFAULT") {
      fail("ACTION_CONTEXT_MISMATCH", `Defaulted seat ${seat.seatId} contains a non-default action.`);
    }
    if (seat.completion === "SEALED_ACTIONS" && action.source === "DEFAULT") {
      fail("ACTION_CONTEXT_MISMATCH", `Non-defaulted seat ${seat.seatId} contains a default action.`);
    }
  }
  for (const seat of seats) {
    requiredText(seat.seatId, "seat.seatId", "SIX_SEAT_TOPOLOGY_INVALID");
    if (seat.requirement !== "REQUIRED" && seat.requirement !== "NOT_REQUIRED") {
      fail("SIX_SEAT_TOPOLOGY_INVALID", `Seat ${seat.seatId} has an invalid requirement.`);
    }
    if (!["SEALED_ACTIONS", "DEFAULTED", "MIXED_ACTIONS", "NOT_REQUIRED"].includes(seat.completion)) {
      fail("SIX_SEAT_TOPOLOGY_INVALID", `Seat ${seat.seatId} has an invalid completion status.`);
    }
    const seatActions = actions.filter((action) => action.seatId === seat.seatId);
    const defaultActionCount = seatActions
      .filter((action) => action.source === "DEFAULT").length;
    const nonDefaultActionCount = seatActions.length - defaultActionCount;
    if (seat.requirement === "NOT_REQUIRED") {
      if (
        seat.completion !== "NOT_REQUIRED"
        || seat.defaultCodes.length !== 0
        || seatActions.length !== 0
      ) {
        fail("SIX_SEAT_TOPOLOGY_INVALID", `NOT_REQUIRED seat ${seat.seatId} cannot block, default, or submit an action.`);
      }
      continue;
    }
    if (seat.requirement !== "REQUIRED" || seat.completion === "NOT_REQUIRED") {
      fail("SIX_SEAT_TOPOLOGY_INVALID", `Seat ${seat.seatId} has an invalid requirement/completion pair.`);
    }
    if (seatActions.length === 0) {
      fail(
        "SIX_SEAT_TOPOLOGY_INVALID",
        "Required seat " + seat.seatId + " has no sealed action.",
      );
    }
    if (seat.completion === "SEALED_ACTIONS") {
      if (
        defaultActionCount !== 0
        || nonDefaultActionCount < 1
        || seat.defaultCodes.length !== 0
      ) {
        fail(
          "SIX_SEAT_TOPOLOGY_INVALID",
          "SEALED_ACTIONS seat " + seat.seatId
            + " must contain only non-default actions and no defaultCodes.",
        );
      }
    } else if (seat.completion === "DEFAULTED") {
      if (
        defaultActionCount < 1
        || nonDefaultActionCount !== 0
        || seat.defaultCodes.length < 1
        || seat.defaultCodes.length > defaultActionCount
      ) {
        fail(
          "SIX_SEAT_TOPOLOGY_INVALID",
          "DEFAULTED seat " + seat.seatId
            + " must contain one or more default actions and canonical defaultCodes.",
        );
      }
    } else if (
      defaultActionCount < 1
      || nonDefaultActionCount < 1
      || seat.defaultCodes.length < 1
      || seat.defaultCodes.length > defaultActionCount
    ) {
      fail(
        "SIX_SEAT_TOPOLOGY_INVALID",
        "MIXED_ACTIONS seat " + seat.seatId
          + " must contain both default and non-default actions.",
      );
    }
  }
}

function validateActionsAndResources(
  actions: B0SealedChapterDecisionActionV1[],
  resources: B0ChapterSettlementInputV1["settlementMaterial"]["resources"],
  actionIds: string[],
): void {
  assertUnique(actionIds, "ACTION_SET_MISMATCH", "sealedDecisionActionId");
  assertUnique(actions.map((action) => action.actionId), "ACTION_SET_MISMATCH", "actionId");
  if (actionIds.length !== actions.length || actionIds.some((id, index) => id !== actions[index]?.actionId)) {
    fail("ACTION_SET_MISMATCH", "sealedDecisionActionIds do not exactly match the canonical action set.");
  }
  assertUnique(resources.map((resource) => resource.resourceId), "RESOURCE_SNAPSHOT_INVALID", "resourceId");
  resources.forEach((resource) => assertExactKeys(
    resource,
    ["resourceId", "quantity", "version"],
    "resource",
    "RESOURCE_SNAPSHOT_INVALID",
  ));
  const resourcesById = new Map(resources.map((resource) => [resource.resourceId, resource]));
  for (const resource of resources) {
    requiredText(resource.resourceId, "resource.resourceId", "RESOURCE_SNAPSHOT_INVALID");
    if (!nonNegativeInteger(resource.quantity) || !nonNegativeInteger(resource.version)) {
      fail("RESOURCE_SNAPSHOT_INVALID", `Resource ${resource.resourceId} quantity/version must be non-negative integers.`);
    }
  }

  const commitmentIds: string[] = [];
  const reservationKeys: string[] = [];
  const demand = new Map<string, number>();
  for (const action of actions) {
    requiredText(action.actionId, "action.actionId", "INPUT_SCHEMA_INVALID");
    requiredText(action.decisionPointId, `action ${action.actionId}.decisionPointId`, "INPUT_SCHEMA_INVALID");
    requiredText(action.seatId, `action ${action.actionId}.seatId`, "ACTION_CONTEXT_MISMATCH");
    requiredText(action.actionType, `action ${action.actionId}.actionType`, "INPUT_SCHEMA_INVALID");
    if (!["HUMAN", "AI", "DEFAULT"].includes(action.source)) {
      fail("INPUT_SCHEMA_INVALID", `Action ${action.actionId} has an invalid source.`);
    }
    assertUnique(action.evidenceRefs, "INPUT_SCHEMA_INVALID", `action ${action.actionId} evidenceRef`);
    action.evidenceRefs.forEach((evidenceRef) => requiredText(
      evidenceRef,
      `action ${action.actionId}.evidenceRef`,
      "INPUT_SCHEMA_INVALID",
    ));
    if (action.source === "DEFAULT" && action.resourceCommitments.length > 0) {
      fail("RESOURCE_COMMITMENT_DUPLICATE", `Default action ${action.actionId} cannot consume a reserved player resource.`);
    }
    for (const commitment of action.resourceCommitments) {
      requiredText(commitment.commitmentId, "commitment.commitmentId", "RESOURCE_COMMITMENT_DUPLICATE");
      requiredText(commitment.reservationKey, "commitment.reservationKey", "RESOURCE_COMMITMENT_DUPLICATE");
      requiredText(commitment.resourceId, "commitment.resourceId", "RESOURCE_SNAPSHOT_INVALID");
      commitmentIds.push(commitment.commitmentId);
      reservationKeys.push(commitment.reservationKey);
      const resource = resourcesById.get(commitment.resourceId);
      if (!resource) fail("RESOURCE_SNAPSHOT_INVALID", `Resource ${commitment.resourceId} is absent from the sealed snapshot.`);
      if (!positiveInteger(commitment.amount)) {
        fail("RESOURCE_SNAPSHOT_INVALID", `Commitment ${commitment.commitmentId} amount must be a positive integer.`);
      }
      if (commitment.expectedResourceVersion !== resource.version) {
        fail("RESOURCE_VERSION_MISMATCH", `Commitment ${commitment.commitmentId} uses a stale resource version.`);
      }
      const nextDemand = (demand.get(commitment.resourceId) ?? 0) + commitment.amount;
      if (!Number.isSafeInteger(nextDemand)) {
        fail("RESOURCE_SNAPSHOT_INVALID", `Resource ${commitment.resourceId} aggregate commitment is not a safe integer.`);
      }
      demand.set(commitment.resourceId, nextDemand);
    }
  }
  assertUnique(commitmentIds, "RESOURCE_COMMITMENT_DUPLICATE", "commitmentId");
  assertUnique(reservationKeys, "RESOURCE_COMMITMENT_DUPLICATE", "reservationKey");
  for (const [resourceId, amount] of demand) {
    const available = resourcesById.get(resourceId)?.quantity ?? 0;
    if (amount > available) {
      fail("RESOURCE_INSUFFICIENT", `Resource ${resourceId} requires ${amount}, but only ${available} is sealed.`);
    }
  }
}

function validateEvaluationDraft(evaluation: B0ChapterPolicyEvaluationDraftV1): void {
  if (evaluation.schemaVersion !== "b0_chapter_policy_evaluation_v1") {
    fail("EVALUATION_SCHEMA_INVALID", "evaluation.schemaVersion is invalid.");
  }
  assertHash(evaluation.b0InputHash, "evaluation.b0InputHash", "EVALUATION_SCHEMA_INVALID");
  requiredText(evaluation.contentPolicyVersion, "evaluation.contentPolicyVersion", "EVALUATION_SCHEMA_INVALID");
  assertHash(evaluation.contentPolicyHash, "evaluation.contentPolicyHash", "EVALUATION_SCHEMA_INVALID");
  assertUnique(evaluation.resourceDispositions.map((entry) => entry.commitmentId), "RESOURCE_DISPOSITION_MISMATCH", "commitment disposition");
  assertUnique(evaluation.mutations.map((entry) => entry.mutationId), "WORLD_MUTATION_CONFLICT", "mutationId");
  assertUnique(evaluation.seatArcDeltas.map((entry) => entry.seatId), "EVALUATION_SCHEMA_INVALID", "seatArc seatId");
  if (evaluation.seatArcDeltas.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length
    || evaluation.seatArcDeltas.some((entry, index) => entry.seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index])) {
    fail("EVALUATION_SCHEMA_INVALID", "The policy evaluation must contain the canonical six institutional seat arcs.");
  }
  assertUnique(evaluation.causalEdges.map((edge) => edge.edgeId), "CAUSAL_REFERENCE_INVALID", "causal edgeId");
  const targets = new Set<string>();
  for (const mutation of evaluation.mutations) {
    requiredText(mutation.mutationId, "mutation.mutationId", "EVALUATION_SCHEMA_INVALID");
    requiredText(mutation.entityId, `mutation ${mutation.mutationId}.entityId`, "EVALUATION_SCHEMA_INVALID");
    requiredText(mutation.attribute, `mutation ${mutation.mutationId}.attribute`, "EVALUATION_SCHEMA_INVALID");
    if (!["ACTOR", "LOCATION", "DOCUMENT", "EVIDENCE", "INSTITUTION", "RELATION", "WORLD"].includes(mutation.entityType)) {
      fail("EVALUATION_SCHEMA_INVALID", `Mutation ${mutation.mutationId} has an invalid entity type.`);
    }
    if (!["SET", "INCREMENT", "ADD", "REMOVE"].includes(mutation.operation)) {
      fail("EVALUATION_SCHEMA_INVALID", `Mutation ${mutation.mutationId} has an invalid operation.`);
    }
    if (mutation.originActionIds.length === 0) {
      fail("CAUSAL_REFERENCE_INVALID", `Mutation ${mutation.mutationId} has no action origin.`);
    }
    assertUnique(mutation.originActionIds, "CAUSAL_REFERENCE_INVALID", `mutation ${mutation.mutationId} originActionId`);
    if (mutation.operation === "INCREMENT" && typeof mutation.value !== "number") {
      fail("EVALUATION_SCHEMA_INVALID", `Mutation ${mutation.mutationId} increment must be numeric.`);
    }
    const target = `${mutation.entityType}\u0000${mutation.entityId}\u0000${mutation.attribute}`;
    if (targets.has(target)) {
      fail("WORLD_MUTATION_CONFLICT", `Multiple policy mutations target ${mutation.entityType}:${mutation.entityId}.${mutation.attribute}.`);
    }
    targets.add(target);
  }
  for (const disposition of evaluation.resourceDispositions) {
    requiredText(disposition.commitmentId, "resourceDisposition.commitmentId", "RESOURCE_DISPOSITION_MISMATCH");
    if (disposition.disposition !== "CONSUMED" && disposition.disposition !== "RELEASED") {
      fail("RESOURCE_DISPOSITION_MISMATCH", `Commitment ${disposition.commitmentId} has an invalid disposition.`);
    }
  }
  for (const seatArc of evaluation.seatArcDeltas) {
    requiredText(seatArc.seatId, "seatArcDelta.seatId", "EVALUATION_SCHEMA_INVALID");
  }
  for (const edge of evaluation.causalEdges) {
    requiredText(edge.edgeId, "causalEdge.edgeId", "CAUSAL_REFERENCE_INVALID");
    requiredText(edge.relation, `causalEdge ${edge.edgeId}.relation`, "CAUSAL_REFERENCE_INVALID");
    if (edge.fromActionIds.length === 0 || edge.toMutationIds.length === 0) {
      fail("CAUSAL_REFERENCE_INVALID", `Causal edge ${edge.edgeId} must bind actions to mutations.`);
    }
    assertUnique(edge.fromActionIds, "CAUSAL_REFERENCE_INVALID", `edge ${edge.edgeId} fromActionId`);
    assertUnique(edge.toMutationIds, "CAUSAL_REFERENCE_INVALID", `edge ${edge.edgeId} toMutationId`);
    assertUnique(edge.evidenceRefs, "CAUSAL_REFERENCE_INVALID", `edge ${edge.edgeId} evidenceRef`);
  }
}

function assertEvaluationBinding(
  input: B0ChapterSettlementInputV1,
  evaluation: B0ChapterPolicyEvaluationV1,
): void {
  if (evaluation.b0InputHash !== input.b0InputHash
    || evaluation.contentPolicyVersion !== input.wireInput.contentPolicyVersion
    || evaluation.contentPolicyHash !== input.wireInput.contentPolicyHash) {
    fail("EVALUATION_CONTEXT_MISMATCH", "The policy evaluation is not bound to the sealed chapter input and policy.");
  }
  const commitmentIds = input.settlementMaterial.actions
    .flatMap((action) => action.resourceCommitments.map((entry) => entry.commitmentId))
    .sort(compareB0Text);
  const dispositionIds = evaluation.resourceDispositions.map((entry) => entry.commitmentId);
  if (commitmentIds.length !== dispositionIds.length || commitmentIds.some((id, index) => id !== dispositionIds[index])) {
    fail("RESOURCE_DISPOSITION_MISMATCH", "Every sealed resource commitment must have exactly one policy disposition.");
  }
  const seatIds = input.settlementMaterial.seats.map((seat) => seat.seatId);
  const seatArcIds = evaluation.seatArcDeltas.map((entry) => entry.seatId);
  if (seatIds.length !== seatArcIds.length || seatIds.some((id, index) => id !== seatArcIds[index])) {
    fail("EVALUATION_CONTEXT_MISMATCH", "The policy evaluation must contain exactly one SeatArc delta for each of the six seats.");
  }
  const actionIds = new Set(input.wireInput.sealedDecisionActionIds);
  const actionsById = new Map(input.settlementMaterial.actions.map((action) => [action.actionId, action]));
  const mutationIds = new Set(evaluation.mutations.map((mutation) => mutation.mutationId));
  const evaluationEvidenceRefs = new Set(
    evaluation.mutations
      .filter((mutation) => mutation.entityType === "EVIDENCE")
      .map((mutation) => mutation.entityId),
  );
  for (const mutation of evaluation.mutations) {
    if (mutation.originActionIds.some((actionId) => !actionIds.has(actionId))) {
      fail("CAUSAL_REFERENCE_INVALID", `Mutation ${mutation.mutationId} references an action outside the sealed ledger.`);
    }
  }
  for (const edge of evaluation.causalEdges) {
    const edgeEvidenceRefs = new Set(edge.fromActionIds.flatMap(
      (actionId) => actionsById.get(actionId)?.evidenceRefs ?? [],
    ));
    if (edge.fromActionIds.some((actionId) => !actionIds.has(actionId))
      || edge.toMutationIds.some((mutationId) => !mutationIds.has(mutationId))
      || edge.evidenceRefs.some((evidenceRef) => (
        !edgeEvidenceRefs.has(evidenceRef) && !evaluationEvidenceRefs.has(evidenceRef)
      ))) {
      fail("CAUSAL_REFERENCE_INVALID", `Causal edge ${edge.edgeId} references data outside the sealed input/evaluation.`);
    }
  }
}

function buildChapterWorldDelta(
  input: B0ChapterSettlementInputV1,
  evaluation: B0ChapterPolicyEvaluationV1,
): Readonly<B0ChapterWorldDeltaV1> {
  const actionsByCommitment = new Map<string, { actionId: string; commitment: B0SealedChapterResourceCommitmentV1 }>();
  for (const action of input.settlementMaterial.actions) {
    for (const commitment of action.resourceCommitments) {
      actionsByCommitment.set(commitment.commitmentId, { actionId: action.actionId, commitment });
    }
  }
  const resourcesById = new Map(input.settlementMaterial.resources.map((resource) => [resource.resourceId, resource]));
  const consumedByResource = new Map<string, Array<{ actionId: string; commitment: B0SealedChapterResourceCommitmentV1 }>>();
  for (const disposition of evaluation.resourceDispositions) {
    if (disposition.disposition !== "CONSUMED") continue;
    const entry = actionsByCommitment.get(disposition.commitmentId);
    if (!entry) fail("RESOURCE_DISPOSITION_MISMATCH", `Unknown resource commitment ${disposition.commitmentId}.`);
    const list = consumedByResource.get(entry.commitment.resourceId) ?? [];
    list.push(entry);
    consumedByResource.set(entry.commitment.resourceId, list);
  }
  const resourceDeltas: B0ChapterResourceDeltaV1[] = [];
  for (const [resourceId, entries] of [...consumedByResource.entries()].sort(([left], [right]) => compareB0Text(left, right))) {
    const resource = resourcesById.get(resourceId);
    if (!resource) fail("RESOURCE_SNAPSHOT_INVALID", `Resource ${resourceId} is absent from the sealed snapshot.`);
    const commitmentIds = entries.map((entry) => entry.commitment.commitmentId).sort(compareB0Text);
    const originActionIds = [...new Set(entries.map((entry) => entry.actionId))].sort(compareB0Text);
    const consumed = entries.reduce((sum, entry) => sum + entry.commitment.amount, 0);
    const committedQuantity = resource.quantity - consumed;
    if (committedQuantity < 0) fail("RESOURCE_INSUFFICIENT", `Resource ${resourceId} would become negative.`);
    const identity = {
      runChapterFingerprint: input.runChapterFingerprint,
      resourceId,
      commitmentIds,
      originActionIds,
    };
    resourceDeltas.push({
      mutationId: `b0.resource.${sha256Canonical(identity).slice(0, 24)}`,
      resourceId,
      expectedResourceVersion: resource.version,
      baseQuantity: resource.quantity,
      delta: -consumed,
      committedQuantity,
      commitmentIds,
      originActionIds,
    });
  }

  const withoutHash: Omit<B0ChapterWorldDeltaV1, "worldDeltaHash"> = {
    schemaVersion: "b0_chapter_world_delta_v1",
    runId: input.wireInput.runId,
    chapterRuntimeId: input.wireInput.chapterRuntimeId,
    chapterId: input.wireInput.chapterId,
    wireInputHash: input.wireInput.inputHash,
    b0InputHash: input.b0InputHash,
    baseWorldSequence: input.wireInput.baseWorldSequence,
    committedWorldSequence: input.wireInput.baseWorldSequence + 1,
    resourceDeltas,
    mutations: evaluation.mutations,
    seatArcDeltas: evaluation.seatArcDeltas,
    trackDelta: evaluation.trackDelta,
    carryForward: evaluation.carryForward,
    causalEdges: evaluation.causalEdges,
  };
  return cloneAndFreezeB0({
    ...withoutHash,
    worldDeltaHash: sha256Canonical(withoutHash),
  }) as Readonly<B0ChapterWorldDeltaV1>;
}

function buildReceipt(
  input: B0ChapterSettlementInputV1,
  evaluation: B0ChapterPolicyEvaluationV1,
  worldDelta: B0ChapterWorldDeltaV1,
  idempotencyKey: string,
  requestFingerprint: string,
): Readonly<B0ChapterSettlementReceiptV1> {
  const settlementId = `b0.chapter.${sha256Canonical({
    schemaVersion: "b0_chapter_settlement_identity_v1",
    runChapterFingerprint: input.runChapterFingerprint,
    wireInputHash: input.wireInput.inputHash,
    b0InputHash: input.b0InputHash,
    evaluationHash: evaluation.evaluationHash,
  }).slice(0, 24)}`;
  const manifestPayload = {
    schemaVersion: "b0_chapter_commit_manifest_v1",
    settlementId,
    runId: input.wireInput.runId,
    chapterRuntimeId: input.wireInput.chapterRuntimeId,
    chapterId: input.wireInput.chapterId,
    runChapterFingerprint: input.runChapterFingerprint,
    wireInputHash: input.wireInput.inputHash,
    b0InputHash: input.b0InputHash,
    evaluationHash: evaluation.evaluationHash,
    worldDeltaHash: worldDelta.worldDeltaHash,
    baseWorldSequence: input.wireInput.baseWorldSequence,
    committedWorldSequence: input.wireInput.baseWorldSequence + 1,
  };
  const commitManifestHash = sha256Canonical(manifestPayload);
  const receiptPayload = {
    schemaVersion: "b0_chapter_settlement_receipt_v1" as const,
    settlementId,
    runId: input.wireInput.runId,
    chapterRuntimeId: input.wireInput.chapterRuntimeId,
    chapterId: input.wireInput.chapterId,
    idempotencyKey,
    requestFingerprint,
    runChapterFingerprint: input.runChapterFingerprint,
    wireInputHash: input.wireInput.inputHash,
    b0InputHash: input.b0InputHash,
    evaluationHash: evaluation.evaluationHash,
    worldDeltaHash: worldDelta.worldDeltaHash,
    baseWorldSequence: input.wireInput.baseWorldSequence,
    committedWorldSequence: input.wireInput.baseWorldSequence + 1,
    commitManifestHash,
  };
  return cloneAndFreezeB0({
    ...receiptPayload,
    status: "SETTLED" as const,
    commitHash: sha256Canonical(receiptPayload),
  }) as Readonly<B0ChapterSettlementReceiptV1>;
}

function assertStoredReceipt(receipt: B0ChapterSettlementReceiptV1): void {
  assertExactKeys(receipt, [
    "schemaVersion", "status", "settlementId", "runId", "chapterRuntimeId", "chapterId",
    "idempotencyKey", "requestFingerprint", "runChapterFingerprint", "wireInputHash", "b0InputHash",
    "evaluationHash", "worldDeltaHash", "baseWorldSequence", "committedWorldSequence",
    "commitManifestHash", "commitHash",
  ], "receipt", "STORED_RECEIPT_INVALID");
  if (receipt.schemaVersion !== "b0_chapter_settlement_receipt_v1") {
    fail("STORED_RECEIPT_INVALID", "The stored receipt schema is invalid.");
  }
  const { status: _status, commitHash, ...payload } = receipt;
  if ((receipt.status !== "SETTLED" && receipt.status !== "ALREADY_SETTLED")
    || commitHash !== sha256Canonical(payload)) {
    fail("STORED_RECEIPT_INVALID", "The stored receipt hash is invalid.");
  }
}

function authoritativeWireInput(value: unknown): PressureSealedChapterSettlementInputV1 {
  try {
    return validateSealedChapterSettlementInputV1(value);
  } catch (error) {
    if (error instanceof PressureChapterContractError) {
      fail("WIRE_INPUT_INVALID", `The canonical settlement input is invalid: ${error.message}`);
    }
    throw error;
  }
}

function assertHash(value: unknown, path: string, code: B0ChapterSettlementErrorCodeV1): asserts value is string {
  if (!isSha256(value)) fail(code, `${path} must be a lowercase SHA-256 hash.`);
}

function requiredText(
  value: unknown,
  path: string,
  code: B0ChapterSettlementErrorCodeV1,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) fail(code, `${path} is required.`);
}

function assertUnique(values: string[], code: B0ChapterSettlementErrorCodeV1, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(code, `Duplicate ${label}: ${value}.`);
    seen.add(value);
  }
}

function assertExactKeys(
  value: unknown,
  allowed: readonly string[],
  path: string,
  code: B0ChapterSettlementErrorCodeV1,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, `${path} must be an object.`);
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) fail(code, `${path} contains unknown field: ${key}.`);
  }
}

function hasOwn(value: unknown, key: string): boolean {
  return value !== null
    && typeof value === "object"
    && Object.prototype.hasOwnProperty.call(value, key);
}

function requireArray(
  value: unknown,
  path: string,
  code: B0ChapterSettlementErrorCodeV1,
): asserts value is unknown[] {
  if (!Array.isArray(value)) fail(code, `${path} must be an array.`);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function fail(code: B0ChapterSettlementErrorCodeV1, message: string): never {
  throw new B0ChapterSettlementErrorV1(code, message);
}

export function describeB0ChapterSettlementV1(result: B0ChapterSettlementResultV1): string {
  return canonicalJson({
    receipt: result.receipt,
    worldDelta: result.worldDelta,
  });
}
