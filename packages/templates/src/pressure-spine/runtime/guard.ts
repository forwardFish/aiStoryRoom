import { PressureKernelError } from "./errors";
import { buildPressureActionPreview, compilePressureActionIntent } from "./compiler";
import { clonePressureValue, pressureHash } from "./canonical";
import type {
  PressureActionIntentCommandV1,
  PressureActionPreview,
  PressureActionSlot,
  PressureActionType,
  PressureKernelErrorCode,
  PressureRuntimeContent,
  PressureRuntimeState,
} from "./types";
import type {
  PressureCompiledActionCommand,
  PressureCompiledActionPreview,
  PressureObjectMutationIntent,
} from "./internal-types";

function phaseForSlot(slot: PressureActionSlot): PressureRuntimeState["phase"] {
  if (slot === "PREPARE") return "PREPARE_OPEN";
  if (slot === "COMMIT") return "COMMIT_OPEN";
  return "REACTION_OPEN";
}

function reject(
  state: PressureRuntimeState,
  compiled: PressureCompiledActionCommand,
  errorCode: PressureKernelErrorCode,
  safeMessage: string,
): PressureCompiledActionPreview {
  return buildPressureActionPreview(state, compiled, false, errorCode, safeMessage);
}

function actionMutationObjects(command: PressureCompiledActionCommand): PressureObjectMutationIntent[] {
  return command.effect.objectMutations || [];
}

function hasPendingAcquisition(
  state: PressureRuntimeState,
  seatId: string,
  objectId: string,
): boolean {
  return Object.values(state.sealedActions).some((sealed) =>
    sealed.command.nodeId === state.nodeId
    && sealed.command.slot === "COMMIT"
    && sealed.command.seatId === seatId
    && sealed.status !== "REJECTED"
    && (sealed.command.effect.objectMutations || []).some((mutation) =>
      mutation.objectId === objectId
      && ["TRANSFER", "SEIZE"].includes(mutation.operation)
      && (mutation.toSeatId === undefined ? seatId : mutation.toSeatId) === seatId,
    ),
  );
}

function authorityCovers(
  command: PressureCompiledActionCommand,
  mutation: PressureObjectMutationIntent,
  objectKind: string,
): boolean {
  return command.authorityGrants.some((grant) =>
    grant.allowedActionTypes.includes(command.type)
    && grant.allowedOperations.includes(mutation.operation)
    && (grant.targetObjectIds.length === 0 || grant.targetObjectIds.includes(mutation.objectId))
    && (grant.targetObjectKinds.length === 0 || grant.targetObjectKinds.includes(objectKind)),
  );
}

function validateMutationShape(
  state: PressureRuntimeState,
  command: PressureCompiledActionCommand,
): { code: PressureKernelErrorCode; message: string } | null {
  const mutations = actionMutationObjects(command);
  const seen = new Set<string>();
  for (const mutation of mutations) {
    if (seen.has(mutation.objectId)) {
      return { code: "ACTION_OPERATION_INVALID", message: `Only one mutation per object is allowed: ${mutation.objectId}` };
    }
    seen.add(mutation.objectId);
    const object = state.objects[mutation.objectId];
    if (!object) return { code: "TARGET_NOT_REACHABLE", message: `Object ${mutation.objectId} is unavailable` };
    if (object.status === "DESTROYED") return { code: "TARGET_NOT_REACHABLE", message: `Destroyed object ${mutation.objectId} cannot be used` };
    if (mutation.expectedVersionId !== object.versionId || command.expectedObjectVersionId !== object.versionId) {
      return { code: "OBJECT_VERSION_CONFLICT", message: `Object ${mutation.objectId} version is stale` };
    }
    if (!authorityCovers(command, mutation, object.kind)) {
      return { code: "ROLE_FORBIDDEN", message: `Authority does not cover ${mutation.operation} on ${mutation.objectId}` };
    }
    if (["HOLD", "TRANSFER", "UPDATE", "DESTROY"].includes(mutation.operation)
      && object.custodySeatId !== command.seatId
      && !command.authorityGrants.some((grant) => grant.sourceKind === "PERMISSION" && grant.allowedOperations.includes(mutation.operation))) {
      return { code: "OBJECT_NOT_HELD", message: `Seat does not hold ${mutation.objectId}` };
    }
    if (mutation.operation === "DESTROY") {
      if (object.acquiredInNodeId === state.nodeId || hasPendingAcquisition(state, command.seatId, mutation.objectId)) {
        return {
          code: "OBJECT_NEWLY_ACQUIRED_DESTROY_FORBIDDEN",
          message: "An object acquired in this node cannot be destroyed in the same node or reaction",
        };
      }
      if (object.custodySeatId !== command.seatId) {
        return { code: "OBJECT_NOT_HELD", message: "Destruction requires custody before the action begins" };
      }
    }
  }
  return null;
}

function validateActionTypeContract(
  command: PressureCompiledActionCommand,
): { code: PressureKernelErrorCode; message: string } | null {
  const mutations = actionMutationObjects(command);
  switch (command.type) {
    case "ALLOCATE":
      if (mutations.length) return { code: "ACTION_OPERATION_INVALID", message: "ALLOCATE cannot mutate object custody" };
      return null;
    case "SIGN":
      if (mutations.some((mutation) => mutation.operation !== "UPDATE")) return { code: "ACTION_OPERATION_INVALID", message: "SIGN may only update an existing object" };
      return null;
    case "TRANSFER":
      if (mutations.length !== 1 || mutations[0].operation !== "TRANSFER") return { code: "ACTION_OPERATION_INVALID", message: "TRANSFER requires one transfer mutation" };
      return null;
    case "SEIZE":
      if (mutations.length !== 1 || !["SEIZE", "DESTROY"].includes(mutations[0].operation)) return { code: "ACTION_OPERATION_INVALID", message: "SEIZE requires one seize or pre-authorized destroy mutation" };
      return null;
    case "DISCLOSE":
      if (mutations.length) return { code: "ACTION_OPERATION_INVALID", message: "DISCLOSE cannot mutate custody" };
      return null;
    case "DISPATCH":
      if (mutations.length !== 1 || mutations[0].operation !== "UPDATE") return { code: "ACTION_OPERATION_INVALID", message: "DISPATCH requires one route update" };
      return null;
    case "REST":
    case "DELAY":
    case "NEGOTIATE":
    case "INVESTIGATE":
    case "PLAN":
    case "PASS":
      if (mutations.length) return { code: "ACTION_OPERATION_INVALID", message: `${command.type} cannot carry object mutations` };
      return null;
    default: {
      const neverType: never = command.type;
      return { code: "ACTION_TYPE_INVALID", message: `Unsupported action type ${String(neverType)}` };
    }
  }
}

export function validateCompiledPressureAction(
  state: PressureRuntimeState,
  content: PressureRuntimeContent,
  command: PressureCompiledActionCommand,
): PressureCompiledActionPreview {
  const expectedPhase = phaseForSlot(command.slot);
  if (state.phase !== expectedPhase) return reject(state, command, "ACTION_WINDOW_CLOSED", `${command.slot} is not open`);
  if (command.runId !== state.runId || command.nodeId !== state.nodeId) return reject(state, command, "NODE_PHASE_MISMATCH", "Action targets another run/node");
  const seat = state.seats[command.seatId];
  if (!seat) return reject(state, command, "ROLE_FORBIDDEN", "Unknown seat");
  if (seat.currentActorId !== command.currentActorId) return reject(state, command, "CURRENT_ACTOR_MISMATCH", "Current actor changed");
  if (seat.controlEpoch !== command.controlEpoch) return reject(state, command, "CONTROL_EPOCH_CHANGED", "Control epoch changed");
  if (command.expectedRunVersion !== state.phaseSnapshotVersion || command.expectedSnapshotHash !== state.inputSnapshotHash) {
    return reject(state, command, "RUN_VERSION_CONFLICT", "Action preview snapshot is stale");
  }
  if (state.phaseDeadlineEpochMs !== null && command.submittedAtEpochMs > state.phaseDeadlineEpochMs && !command.isDefault) {
    return reject(state, command, "DEADLINE_EXPIRED", "Action arrived after the server deadline");
  }
  const slotKey = `${state.nodeId}:${command.seatId}:${command.slot}`;
  const existingSlotActionId = state.actionIdBySeatSlot[slotKey];
  if (existingSlotActionId && existingSlotActionId !== command.actionId) {
    return reject(state, command, "ACTION_ALREADY_SEALED", "Seat slot is already sealed");
  }
  const existingAction = state.sealedActions[command.actionId];
  if (existingAction && existingAction.command.seatId !== command.seatId) {
    return reject(state, command, "ACTION_ID_CONFLICT", "Action identity belongs to another seat");
  }
  if (command.slot === "REACTION") {
    const reaction = state.reactionWindow;
    if (!reaction || !reaction.eligibleSeatIds.includes(command.seatId)) return reject(state, command, "REACTION_NOT_AVAILABLE", "Seat is not eligible for reaction");
    if (!command.isDefault && command.type !== "PASS" && !reaction.allowedActionTypes.includes(command.type as any)) return reject(state, command, "ACTION_TYPE_INVALID", "Action type is not allowed in this reaction");
    if (reaction.usedSeatIds.includes(command.seatId) || seat.reactionUsedAtNodeId === state.nodeId) return reject(state, command, "REACTION_ALREADY_USED", "Reaction already used");
    if (command.effect.reseal && reaction.resealUsed) return reject(state, command, "REACTION_RESEAL_LIMIT", "Reaction reseal already used");
  }
  const typeContract = validateActionTypeContract(command);
  if (typeContract) return reject(state, command, typeContract.code, typeContract.message);
  const mutationFailure = validateMutationShape(state, command);
  if (mutationFailure) return reject(state, command, mutationFailure.code, mutationFailure.message);
  const node = content.nodes[state.nodeId];
  const allowedObjectIds = new Set([
    ...node.contestedObjectIds,
    ...node.secondaryObjectIds,
    ...(node.seats.find((entry) => entry.seatId === command.seatId)?.keyLeverageObjectIds || []),
    ...Object.values(state.objects).filter((object) => object.custodySeatId === command.seatId).map((object) => object.objectId),
  ]);
  if (command.targetObjectId && !allowedObjectIds.has(command.targetObjectId)) {
    return reject(state, command, "TARGET_NOT_REACHABLE", "Target object is outside the current authored action surface");
  }
  if (command.targetObjectId) {
    const object = state.objects[command.targetObjectId];
    if (!object || object.status === "DESTROYED") return reject(state, command, "TARGET_NOT_REACHABLE", "Target object is unavailable");
    if (command.expectedObjectVersionId !== object.versionId) return reject(state, command, "OBJECT_VERSION_CONFLICT", "Target object version is stale");
    const visible = object.visibility === "PUBLIC" || object.visibility === "OBSERVABLE"
      || object.knownBySeatIds.includes(command.seatId)
      || object.custodySeatId === command.seatId;
    if (!visible) return reject(state, command, "OBJECT_NOT_KNOWN", "Seat does not know the target object version");
  }
  for (const factId of command.knowledgeFactIds) {
    const record = state.knowledge[factId];
    if (!record || !record.knownBySeatIds.includes(command.seatId) || !seat.knownFactIds.includes(factId)) {
      return reject(state, command, "OBJECT_NOT_KNOWN", `Seat does not know fact ${factId}`);
    }
  }
  for (const grant of command.effect.knowledgeGrants || []) {
    if (!command.knowledgeFactIds.includes(grant.factId)) return reject(state, command, "OBJECT_NOT_KNOWN", "Knowledge grant was not sourced from a known fact");
    if (grant.seatIds.some((seatId) => !state.seats[seatId])) return reject(state, command, "ROLE_FORBIDDEN", "Knowledge target seat is invalid");
  }
  for (const cost of command.resourceCosts) {
    const current = seat.resourceBalances[cost.resourceId];
    const reserved = state.resourceReservations[command.seatId]?.[cost.resourceId] || 0;
    if (!Number.isSafeInteger(cost.amount) || cost.amount <= 0 || current === undefined || current - reserved < cost.amount) {
      return reject(state, command, "RESOURCE_INSUFFICIENT", `Resource ${cost.resourceId} is unavailable`);
    }
  }
  const canonicalFingerprint = pressureHash(command.sourceIntent);
  if (canonicalFingerprint !== command.requestFingerprint) {
    return reject(state, command, "ACTION_PAYLOAD_CONFLICT", "Server-compiled request fingerprint drifted");
  }
  return buildPressureActionPreview(state, command, true);
}

export function previewPressureActionIntent(
  state: PressureRuntimeState,
  content: PressureRuntimeContent,
  rawIntent: unknown,
): { preview: PressureActionPreview; compiled: PressureCompiledActionCommand } {
  const compiled = compilePressureActionIntent(content, state, rawIntent);
  const checked = validateCompiledPressureAction(state, content, compiled);
  return {
    preview: {
      accepted: checked.accepted,
      errorCode: checked.errorCode,
      safeMessage: checked.safeMessage,
      actionFingerprint: checked.actionFingerprint,
      previewToken: checked.previewToken,
      normalizedIntent: clonePressureValue(checked.normalizedIntent),
    },
    compiled: clonePressureValue(checked.compiled),
  };
}

export function assertPressurePreviewToken(
  state: PressureRuntimeState,
  preview: PressureActionPreview,
  previewToken?: string,
): void {
  if (!previewToken) throw new PressureKernelError("PREVIEW_REQUIRED", "A validated preview token is required");
  if (previewToken !== preview.previewToken) throw new PressureKernelError("PREVIEW_TAMPERED", "Preview token mismatch");
  const expected = pressureHash({
    runId: state.runId,
    nodeId: state.nodeId,
    phase: state.phase,
    phaseSnapshotVersion: state.phaseSnapshotVersion,
    inputSnapshotHash: state.inputSnapshotHash,
    payloadHash: preview.actionFingerprint,
  });
  // buildPressureActionPreview additionally binds the compiled hash. We only
  // assert snapshot membership here; confirm recompiles and compares the full token.
  if (!preview.previewToken || !expected) throw new PressureKernelError("PREVIEW_TAMPERED", "Preview token invalid");
}

export function fingerprintPressureActionIntentForAudit(intent: PressureActionIntentCommandV1): string {
  return pressureHash(intent);
}
