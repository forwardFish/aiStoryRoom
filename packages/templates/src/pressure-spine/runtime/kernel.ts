import { PressureKernelError } from "./errors";
import { clonePressureValue, isoFromEpoch, pressureHash, sortedUnique, stableId } from "./canonical";
import { assertPressurePhaseTransition } from "./phase-machine";
import { selectPressureBranch } from "./selector";
import { validateCompiledPressureAction } from "./guard";
import { compilePressureActionIntent } from "./compiler";
import { compareConflictActions } from "./conflict";
import { assertPressureRootEventLedger } from "./event-ledger";
import type {
  FrozenNodeResultV1,
  PressureActionPreview,
  PressureActionResolution,
  PressureContentBranch,
  PressureContentNode,
  PressureFrozenObjectOutcome,
  PressureFinaleResultV1,
  PressureKnowledgeDelta,
  PressureKnowledgeRecord,
  PressureOpeningProjection,
  PressureResourceLedgerEntry,
  PressureRootEvent,
  PressureRootEventType,
  PressureRuntimeContent,
  PressureRuntimeObjectState,
  PressureRuntimePhase,
  PressureRuntimeSeatState,
  PressureRuntimeState,
  PressureSealedAction,
  PressureSettlementResult,
  PressureVisibility,
} from "./types";

import type {
  PressureCompiledActionCommand,
  PressureCompiledActionPreview,
} from "./internal-types";

export type InitializePressureRuntimeInput = {
  runId: string;
  runSeed: string;
  nowEpochMs: number;
  initialPhaseDeadlineEpochMs?: number | null;
  initialEnergy?: number;
  initialResourceBalance?: number;
};

export type ConfirmPressureActionResult = {
  state: PressureRuntimeState;
  action: PressureSealedAction;
  replayed: boolean;
};

const SLOT_ORDER: Record<PressureCompiledActionCommand["slot"], number> = {
  PREPARE: 0,
  COMMIT: 1,
  REACTION: 2,
};

function cloneState(state: PressureRuntimeState): PressureRuntimeState {
  return clonePressureValue(state);
}

function deterministicEventTime(state: PressureRuntimeState, epochMs?: number): string {
  return isoFromEpoch(epochMs ?? state.worldTimeMinutes * 60_000);
}

function appendRootEvent(
  state: PressureRuntimeState,
  type: PressureRootEventType,
  payload: Record<string, unknown>,
  options: {
    visibility?: PressureVisibility;
    audienceSeatIds?: string[];
    sourceActionIds?: string[];
    dedupeKey?: string;
    epochMs?: number;
  } = {},
): PressureRootEvent {
  const dedupeKey = options.dedupeKey || `${type}:${state.runId}:${state.nodeId}:${state.rootEvents.length + 1}`;
  const existing = state.rootEvents.find((event) => event.dedupeKey === dedupeKey);
  if (existing) return existing;
  const event: PressureRootEvent = {
    eventId: stableId("event", state.runId, state.nodeId, type, dedupeKey),
    runId: state.runId,
    sequence: state.rootEvents.length + 1,
    nodeId: state.nodeId,
    phase: state.phase,
    type,
    visibility: options.visibility || "PRIVATE_SYSTEM",
    audienceSeatIds: sortedUnique(options.audienceSeatIds || []),
    sourceActionIds: sortedUnique(options.sourceActionIds || []),
    payload: clonePressureValue(payload),
    dedupeKey,
    createdAt: deterministicEventTime(state, options.epochMs),
  };
  state.rootEvents.push(event);
  return event;
}

function transitionPhase(state: PressureRuntimeState, to: PressureRuntimePhase): void {
  assertPressurePhaseTransition(state.phase, to, state.resumePhase);
  state.phase = to;
  if (to !== "FAILED_RECOVERABLE") state.resumePhase = null;
  state.version += 1;
}

function initialObjectState(contentObject: PressureRuntimeContent["objects"][string]): PressureRuntimeObjectState {
  const custodySeatId = contentObject.initialCustody.startsWith("seat.") ? contentObject.initialCustody : null;
  return {
    objectId: contentObject.objectId,
    versionId: `${contentObject.objectId}@INITIAL.v1`,
    predecessorVersionId: null,
    version: 1,
    kind: contentObject.kind,
    status: "AVAILABLE",
    custodySeatId,
    custodyActorId: null,
    custodyLocationId: null,
    custodyMode: contentObject.initialCustody,
    quantity: 1,
    signatures: [],
    seals: [],
    routes: [],
    claimIds: [],
    knownBySeatIds: custodySeatId ? [custodySeatId] : [],
    visibility: custodySeatId ? "PRIVATE" : "OBSERVABLE",
    acquiredInNodeId: null,
    acquiredByActionId: null,
    lastMutationActionId: null,
  };
}

function initialSeatState(
  content: PressureRuntimeContent,
  seatId: string,
  initialEnergy: number,
  initialResourceBalance: number,
): PressureRuntimeSeatState {
  const seat = content.nodes.P0?.seats.find((entry) => entry.seatId === seatId)
    || content.nodes.N1?.seats.find((entry) => entry.seatId === seatId);
  if (!seat) throw new PressureKernelError("CONTENT_IMPORT_INVALID", `Seat ${seatId} is absent from P0/N1 content`);
  const knownObjectVersionIds = Object.values(content.objects)
    .filter((object) => object.initialCustody === seatId)
    .map((object) => `${object.objectId}@INITIAL.v1`)
    .sort();
  return {
    seatId,
    roleKey: seat.roleKey,
    currentActorId: seat.currentActorId,
    controlEpoch: 1,
    energy: initialEnergy,
    initiativeLost: false,
    permissions: [...seat.permissions].sort(),
    knownFactIds: [...seat.knownFactIds].sort(),
    knownObjectVersionIds,
    resourceBalances: Object.fromEntries(seat.resources.map((resource) => [resource, initialResourceBalance])),
    reactionUsedAtNodeId: null,
  };
}

function initialKnowledge(content: PressureRuntimeContent): Record<string, PressureKnowledgeRecord> {
  const knowledge: Record<string, PressureKnowledgeRecord> = {};
  for (const nodeId of ["P0", "N1"]) {
    for (const seat of content.nodes[nodeId]?.seats || []) {
      for (const known of seat.knownFacts) {
        const existing = knowledge[known.factId];
        knowledge[known.factId] = {
          factId: known.factId,
          provenance: known.provenance,
          knownBySeatIds: sortedUnique([...(existing?.knownBySeatIds || []), seat.seatId]),
          claimId: known.claimId,
          objectId: known.objectId,
          objectVersionId: known.objectVersionId,
          sourceActionIds: [],
        };
      }
      for (const factId of seat.knownFactIds) {
        if (knowledge[factId]) continue;
        knowledge[factId] = {
          factId,
          provenance: "PRIVATE_ACTOR",
          knownBySeatIds: [seat.seatId],
          claimId: null,
          objectId: null,
          objectVersionId: null,
          sourceActionIds: [],
        };
      }
    }
  }
  return knowledge;
}

export function initializePressureRuntime(
  content: PressureRuntimeContent,
  input: InitializePressureRuntimeInput,
): PressureRuntimeState {
  if (!content.runtimeProfile) throw new PressureKernelError("RUNTIME_PROFILE_REQUIRED", "runtimeProfile is required");
  if (content.nodeIds[0] !== "P0" || !content.nodes.P0 || !content.nodes.N1) {
    throw new PressureKernelError("CONTENT_IMPORT_INVALID", "P0/N1 content is required");
  }
  const seats = Object.fromEntries(content.seatIds.map((seatId) => [
    seatId,
    initialSeatState(content, seatId, input.initialEnergy ?? 3, input.initialResourceBalance ?? 3),
  ]));
  const objects = Object.fromEntries(Object.values(content.objects).map((object) => [
    object.objectId,
    initialObjectState(object),
  ]));
  const state: PressureRuntimeState = {
    schemaVersion: "pressure_runtime_state_v1",
    runId: input.runId,
    runSeed: input.runSeed,
    startedAtEpochMs: input.nowEpochMs,
    runtimeProfile: content.runtimeProfile,
    strategyVersion: content.strategyVersion,
    packageSha256: content.packageSha256,
    contentTreeSha256: content.contentTreeSha256,
    phase: "P0_PROJECTING",
    resumePhase: null,
    nodeId: "P0",
    nodeSequence: 0,
    version: 1,
    phaseSnapshotVersion: 1,
    worldTimeMinutes: 0,
    pressureLevel: 0,
    phaseDeadlineEpochMs: input.initialPhaseDeadlineEpochMs ?? null,
    inputSnapshotHash: pressureHash({ packageSha256: content.packageSha256, runSeed: input.runSeed, nodeId: "P0" }),
    prepareRulesInputHash: null,
    commitSnapshotHash: null,
    commitRulesInputHash: null,
    selectorState: {},
    seats,
    objects,
    knowledge: initialKnowledge(content),
    claims: {},
    responsibilities: [],
    tracks: Object.fromEntries(content.worldTrackIds.map((trackId) => [trackId, 0])),
    sealedActions: {},
    actionIdBySeatSlot: {},
    idempotencyResults: {},
    resourceReservations: {},
    resourceLedger: [],
    knowledgeDeltas: [],
    rootEvents: [],
    frozenResults: [],
    projectionInputs: {},
    projections: {},
    reactionWindow: null,
    checkpoints: {},
    finaleInput: null,
    finaleResult: null,
    failure: null,
  };
  appendRootEvent(state, "RUN_INITIALIZED", {
    strategyVersion: content.strategyVersion,
    packageSha256: content.packageSha256,
    runtimeProfile: content.runtimeProfile,
    runSeed: input.runSeed,
  }, {
    dedupeKey: `RUN_INITIALIZED:${input.runId}`,
    epochMs: input.nowEpochMs,
  });
  return state;
}


function rulesCommandView(command: PressureCompiledActionCommand): Record<string, unknown> {
  const {
    submittedAtEpochMs: _submittedAtEpochMs,
    deadlineEpochMs: _deadlineEpochMs,
    expectedRunVersion: _expectedRunVersion,
    expectedSnapshotHash: _expectedSnapshotHash,
    idempotencyKey: _idempotencyKey,
    requestFingerprint: _requestFingerprint,
    previewToken: _previewToken,
    sourceIntent: _sourceIntent,
    ...semantic
  } = command;
  return semantic;
}

function actionSlotKey(command: Pick<PressureCompiledActionCommand, "nodeId" | "seatId" | "slot">): string {
  return `${command.nodeId}:${command.seatId}:${command.slot}`;
}

function reservationBalance(state: PressureRuntimeState, seatId: string, resourceId: string): number {
  return state.resourceReservations[seatId]?.[resourceId] || 0;
}

function reserveResources(state: PressureRuntimeState, command: PressureCompiledActionCommand): void {
  const reservations = state.resourceReservations[command.seatId] || {};
  for (const cost of command.resourceCosts) {
    reservations[cost.resourceId] = (reservations[cost.resourceId] || 0) + cost.amount;
  }
  state.resourceReservations[command.seatId] = reservations;
}

function releaseResources(state: PressureRuntimeState, command: PressureCompiledActionCommand): void {
  const reservations = state.resourceReservations[command.seatId] || {};
  for (const cost of command.resourceCosts) {
    reservations[cost.resourceId] = Math.max(0, (reservations[cost.resourceId] || 0) - cost.amount);
  }
  state.resourceReservations[command.seatId] = reservations;
}

function previewCompiledAction(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  command: PressureCompiledActionCommand,
): PressureCompiledActionPreview {
  return validateCompiledPressureAction(state, content, command);
}

function confirmCompiledPressureAction(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  command: PressureCompiledActionCommand,
  previewToken: string | undefined = command.previewToken,
): ConfirmPressureActionResult {
  const payloadHash = command.requestFingerprint;
  const replay = sourceState.idempotencyResults[command.idempotencyKey];
  if (replay) {
    if (replay.payloadHash !== payloadHash) {
      throw new PressureKernelError("IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused with a different canonical payload");
    }
    const existing = sourceState.sealedActions[replay.actionId];
    if (!existing) throw new PressureKernelError("SETTLEMENT_REPLAY_HASH_MISMATCH", "Idempotency record points to a missing action");
    const resultHash = pressureHash(existing);
    if (replay.resultHash !== resultHash) {
      throw new PressureKernelError("SETTLEMENT_REPLAY_HASH_MISMATCH", "Idempotent action result drifted");
    }
    return { state: cloneState(sourceState), action: clonePressureValue(existing), replayed: true };
  }
  const preview = previewCompiledAction(content, sourceState, command);
  if (!preview.accepted) throw new PressureKernelError(preview.errorCode!, preview.safeMessage, preview.safeMessage);
  if (!command.isDefault) {
    if (!previewToken) throw new PressureKernelError("PREVIEW_REQUIRED", "A validated preview token is required");
    if (previewToken !== preview.previewToken) {
      throw new PressureKernelError("PREVIEW_TAMPERED", "Preview token does not match the server-recompiled command");
    }
  }
  const slotKey = actionSlotKey(command);
  const existingSlotActionId = sourceState.actionIdBySeatSlot[slotKey];
  if (existingSlotActionId && existingSlotActionId !== command.actionId) {
    throw new PressureKernelError("ACTION_ALREADY_SEALED", `Seat slot ${slotKey} is already sealed`);
  }
  const existingIdentity = sourceState.sealedActions[command.actionId];
  if (existingIdentity && existingIdentity.command.seatId !== command.seatId) {
    throw new PressureKernelError("ACTION_ID_CONFLICT", "Server-derived action identity is already owned by another seat");
  }
  const state = cloneState(sourceState);
  const snapshotHash = state.inputSnapshotHash;
  const sealedCommand = clonePressureValue(preview.compiled);
  sealedCommand.previewToken = preview.previewToken;
  const sealed: PressureSealedAction = {
    command: sealedCommand,
    sealedAt: isoFromEpoch(command.submittedAtEpochMs),
    status: "SEALED",
    snapshotHash,
    resolvedAt: null,
    resolution: null,
  };
  state.sealedActions[command.actionId] = sealed;
  state.actionIdBySeatSlot[slotKey] = command.actionId;
  reserveResources(state, command);
  if (command.slot === "REACTION" && state.reactionWindow) {
    state.reactionWindow.usedSeatIds = sortedUnique([...state.reactionWindow.usedSeatIds, command.seatId]);
    if (command.effect.reseal) state.reactionWindow.resealUsed = true;
  }
  state.version += 1;
  appendRootEvent(state, "ACTION_SEALED", {
    actionId: command.actionId,
    seatId: command.seatId,
    slot: command.slot,
    actionType: command.type,
    snapshotHash,
    payloadHash,
  }, {
    visibility: command.visibility,
    audienceSeatIds: command.visibility === "PRIVATE" || command.visibility === "PRIVATE_SYSTEM" ? [command.seatId] : content.seatIds,
    sourceActionIds: [command.actionId],
    dedupeKey: `ACTION_SEALED:${command.actionId}`,
    epochMs: command.submittedAtEpochMs,
  });
  if (command.isDefault) {
    appendRootEvent(state, "DEFAULT_ACTION_APPLIED", {
      actionId: command.actionId,
      seatId: command.seatId,
      slot: command.slot,
      defaultPolicyId: command.defaultPolicyId || null,
    }, {
      visibility: "PRIVATE_SYSTEM",
      audienceSeatIds: [command.seatId],
      sourceActionIds: [command.actionId],
      dedupeKey: `DEFAULT_ACTION_APPLIED:${command.actionId}`,
      epochMs: command.submittedAtEpochMs,
    });
  }
  state.idempotencyResults[command.idempotencyKey] = {
    payloadHash,
    actionId: command.actionId,
    previewToken: preview.previewToken,
    resultHash: pressureHash(sealed),
  };
  return { state, action: clonePressureValue(sealed), replayed: false };
}

export function confirmPressureActionIntent(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  rawIntent: unknown,
  previewToken: string,
): ConfirmPressureActionResult {
  const compiled = compilePressureActionIntent(content, sourceState, rawIntent);
  return confirmCompiledPressureAction(content, sourceState, compiled, previewToken);
}

function defaultFallbackFor(node: PressureContentNode, inputClasses: string[]) {
  for (const inputClass of inputClasses) {
    const fallback = node.inputFallbacks.find((entry) => entry.inputClass.toUpperCase() === inputClass);
    if (fallback) return fallback;
  }
  return null;
}

function defaultDurationMinutes(node: PressureContentNode, slot: PressureCompiledActionCommand["slot"]): number {
  if (slot !== "PREPARE") return 0;
  const fallback = defaultFallbackFor(node, ["TIMEOUT", "NORMAL_NO_SUBMISSION", "SILENCE"]);
  return fallback && fallback.timeDeltaMinutes > 0 ? fallback.timeDeltaMinutes : 180;
}

export function buildDefaultPressureAction(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  seatId: string,
  slot: PressureCompiledActionCommand["slot"],
  nowEpochMs: number,
): PressureCompiledActionCommand {
  const node = content.nodes[state.nodeId];
  const seatContent = node.seats.find((entry) => entry.seatId === seatId);
  const seat = state.seats[seatId];
  if (!seatContent || !seat) throw new PressureKernelError("CONTENT_IMPORT_INVALID", `Missing seat content ${state.nodeId}/${seatId}`);
  const authoredDefault = node.defaultPolicies.find((entry) => entry.seatId === seatId);
  if (!authoredDefault) throw new PressureKernelError("CONTENT_IMPORT_INVALID", `Missing authored default policy ${state.nodeId}/${seatId}`);
  const policyText = slot === "PREPARE" ? authoredDefault.prepareText : authoredDefault.commitText;
  const publicIntent = {
    schemaVersion: "pressure_action_intent_v1" as const,
    runId: state.runId,
    nodeId: state.nodeId,
    slot,
    seatId,
    currentActorId: seat.currentActorId,
    controlEpoch: seat.controlEpoch,
    type: (slot === "REACTION" ? "PASS" : "PLAN") as "PASS" | "PLAN",
    intentText: policyText,
    targetObjectId: null,
    expectedObjectVersionId: null,
    resourceCommitments: [],
    parameters: {},
    visibility: "PRIVATE_SYSTEM" as const,
    submittedAtEpochMs: nowEpochMs,
    expectedRunVersion: state.phaseSnapshotVersion,
    expectedSnapshotHash: state.inputSnapshotHash,
    idempotencyKey: `default:${state.runId}:${state.nodeId}:${seatId}:${slot}`,
  };
  return compilePressureActionIntent(content, state, publicIntent, {
    isDefault: true,
    defaultPolicyId: authoredDefault.defaultPolicyId,
    policyVersion: `content-default:${state.strategyVersion}:${authoredDefault.defaultPolicyId}:${slot}`,
  });
}

export function sealMissingPressureActions(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  slot: PressureCompiledActionCommand["slot"],
  nowEpochMs: number,
): PressureRuntimeState {
  let state = sourceState;
  const eligibleSeatIds = slot === "REACTION"
    ? content.nodes[state.nodeId].reaction?.eligibleSeatIds || []
    : content.seatIds;
  for (const seatId of eligibleSeatIds) {
    if (state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:${slot}`]) continue;
    const command = buildDefaultPressureAction(content, state, seatId, slot, nowEpochMs);
    state = confirmCompiledPressureAction(content, state, command).state;
  }
  return state;
}

function allSeatsSealed(content: PressureRuntimeContent, state: PressureRuntimeState, slot: PressureCompiledActionCommand["slot"]): boolean {
  const seatIds = slot === "REACTION" ? content.nodes[state.nodeId].reaction?.eligibleSeatIds || [] : content.seatIds;
  return seatIds.every((seatId) => Boolean(state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:${slot}`]));
}

function actionComparator(left: PressureSealedAction, right: PressureSealedAction): number {
  return SLOT_ORDER[left.command.slot] - SLOT_ORDER[right.command.slot]
    || left.command.seatId.localeCompare(right.command.seatId)
    || left.command.actionId.localeCompare(right.command.actionId);
}

function selectObjectMutationWinners(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  actions: PressureSealedAction[],
): Map<string, string> {
  const candidates = new Map<string, PressureSealedAction[]>();
  for (const action of actions) {
    for (const mutation of action.command.effect.objectMutations || []) {
      const list = candidates.get(mutation.objectId) || [];
      list.push(action);
      candidates.set(mutation.objectId, list);
    }
  }
  const node = content.nodes[state.nodeId];
  const winners = new Map<string, string>();
  for (const [objectId, list] of candidates) {
    const object = state.objects[objectId];
    if (!object) continue;
    const winner = [...list].sort((left, right) => compareConflictActions(node, state, object, left, right))[0];
    if (winner) winners.set(objectId, winner.command.actionId);
  }
  return winners;
}

function selectorPatchFromAction(state: PressureRuntimeState, action: PressureSealedAction): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const contribution of action.command.effect.selectorContributions || []) {
    const current = state.selectorState[contribution.key];
    switch (contribution.operation) {
      case "ADD": patch[contribution.key] = Number(current || 0) + Number(contribution.value || 0); break;
      case "MAX": patch[contribution.key] = Math.max(Number(current || 0), Number(contribution.value || 0)); break;
      case "MIN": patch[contribution.key] = Math.min(Number(current || 0), Number(contribution.value || 0)); break;
      case "SET_TRUE": patch[contribution.key] = true; break;
      case "SET_FALSE": patch[contribution.key] = false; break;
      case "SET": patch[contribution.key] = clonePressureValue(contribution.value); break;
    }
  }
  return patch;
}

function applyResourceCosts(
  state: PressureRuntimeState,
  action: PressureSealedAction,
  resolution: PressureActionResolution,
): boolean {
  const seat = state.seats[action.command.seatId];
  for (const cost of action.command.resourceCosts) {
    if ((seat.resourceBalances[cost.resourceId] || 0) < cost.amount) {
      const entry: PressureResourceLedgerEntry = {
        entryId: stableId("resource", state.runId, action.command.actionId, cost.resourceId, "rejected"),
        seatId: action.command.seatId,
        resourceId: cost.resourceId,
        delta: 0,
        balanceAfter: seat.resourceBalances[cost.resourceId] || 0,
        actionId: action.command.actionId,
        status: "REJECTED",
      };
      state.resourceLedger.push(entry);
      resolution.resourceLedgerEntries.push(entry);
      resolution.status = "REJECTED";
      resolution.reasonCode = "RESOURCE_ALLOCATION_REJECTED";
      releaseResources(state, action.command);
      return false;
    }
  }
  for (const cost of action.command.resourceCosts) {
    seat.resourceBalances[cost.resourceId] = (seat.resourceBalances[cost.resourceId] || 0) - cost.amount;
    const entry: PressureResourceLedgerEntry = {
      entryId: stableId("resource", state.runId, action.command.actionId, cost.resourceId, state.resourceLedger.length),
      seatId: action.command.seatId,
      resourceId: cost.resourceId,
      delta: -cost.amount,
      balanceAfter: seat.resourceBalances[cost.resourceId],
      actionId: action.command.actionId,
      status: "APPLIED",
    };
    state.resourceLedger.push(entry);
    resolution.resourceLedgerEntries.push(entry);
  }
  releaseResources(state, action.command);
  return true;
}

function updateKnowledgeRecord(
  state: PressureRuntimeState,
  input: {
    factId: string;
    seatIds: string[];
    provenance: PressureKnowledgeRecord["provenance"];
    claimId?: string | null;
    objectId?: string | null;
    objectVersionId?: string | null;
    actionId: string;
  },
): PressureKnowledgeDelta {
  const existing = state.knowledge[input.factId];
  const knownBySeatIds = sortedUnique([...(existing?.knownBySeatIds || []), ...input.seatIds]);
  state.knowledge[input.factId] = {
    factId: input.factId,
    provenance: input.provenance,
    knownBySeatIds,
    claimId: input.claimId ?? existing?.claimId ?? null,
    objectId: input.objectId ?? existing?.objectId ?? null,
    objectVersionId: input.objectVersionId ?? existing?.objectVersionId ?? null,
    sourceActionIds: sortedUnique([...(existing?.sourceActionIds || []), input.actionId]),
  };
  for (const seatId of input.seatIds) {
    const seat = state.seats[seatId];
    if (!seat) continue;
    seat.knownFactIds = sortedUnique([...seat.knownFactIds, input.factId]);
    if (input.objectVersionId) seat.knownObjectVersionIds = sortedUnique([...seat.knownObjectVersionIds, input.objectVersionId]);
  }
  return {
    deltaId: stableId("knowledge", state.runId, state.nodeId, input.actionId, input.factId, "grant"),
    factId: input.factId,
    grantedToSeatIds: sortedUnique(input.seatIds),
    revokedFromSeatIds: [],
    sourceActionIds: [input.actionId],
  };
}

function applyActionEffects(
  state: PressureRuntimeState,
  action: PressureSealedAction,
  winners: Map<string, string>,
  resolvedAtEpochMs: number,
): PressureActionResolution {
  if (action.status !== "SEALED" && action.resolution) return action.resolution;
  const selectorPatch = selectorPatchFromAction(state, action);
  const resolution: PressureActionResolution = {
    actionId: action.command.actionId,
    status: "APPLIED",
    reasonCode: "ACTION_RESOLVED",
    worldTimeDeltaMinutes: Number(action.command.effect.timeDeltaMinutes || 0),
    pressureDelta: Number(action.command.effect.pressureDelta || 0),
    objectVersionIds: [],
    resourceLedgerEntries: [],
    selectorPatch,
    responsibilityEntryIds: [],
    knowledgeDeltaIds: [],
  };
  if (!applyResourceCosts(state, action, resolution)) {
    action.status = "REJECTED";
    action.resolvedAt = isoFromEpoch(resolvedAtEpochMs);
    action.resolution = resolution;
    return resolution;
  }
  if (action.command.effect.attemptOutcome === "FAILED") {
    resolution.status = "PARTIAL";
    resolution.reasonCode = action.command.effect.attemptReasonCode || "FAILED_ATTEMPT";
  }
  const seat = state.seats[action.command.seatId];
  seat.energy = Math.max(0, seat.energy + Number(action.command.effect.energyDelta || 0));
  if (action.command.effect.initiativeLost) seat.initiativeLost = true;
  Object.assign(state.selectorState, selectorPatch);

  for (const mutation of action.command.effect.objectMutations || []) {
    if (winners.get(mutation.objectId) !== action.command.actionId) {
      resolution.status = "PARTIAL";
      resolution.reasonCode = "OBJECT_CONFLICT_LOST";
      continue;
    }
    const object = state.objects[mutation.objectId];
    if (!object) {
      resolution.status = "REJECTED";
      resolution.reasonCode = "TARGET_NOT_REACHABLE";
      continue;
    }
    if (object.status === "DESTROYED") {
      resolution.status = "REJECTED";
      resolution.reasonCode = "TARGET_NOT_REACHABLE";
      continue;
    }
    if (object.versionId !== mutation.expectedVersionId || object.versionId !== action.command.expectedObjectVersionId) {
      resolution.status = "REJECTED";
      resolution.reasonCode = "OBJECT_VERSION_CONFLICT";
      continue;
    }
    const predecessorVersionId = object.versionId;
    const previousCustodySeatId = object.custodySeatId;
    object.version += 1;
    object.predecessorVersionId = predecessorVersionId;
    object.versionId = `${object.objectId}@${state.nodeId}.${action.command.slot}.v${object.version}`;
    object.status = mutation.operation === "DESTROY" ? "DESTROYED" : mutation.status || object.status;
    object.lastMutationActionId = action.command.actionId;
    if (["TRANSFER", "SEIZE"].includes(mutation.operation)) {
      object.custodySeatId = mutation.toSeatId === undefined ? action.command.seatId : mutation.toSeatId || null;
      object.custodyActorId = mutation.toActorId || null;
      if (object.custodySeatId !== previousCustodySeatId) {
        object.acquiredInNodeId = state.nodeId;
        object.acquiredByActionId = action.command.actionId;
      }
    }
    if (mutation.operation === "DESTROY") {
      object.custodySeatId = null;
      object.custodyActorId = null;
      object.custodyLocationId = null;
      object.custodyMode = "NO_CUSTODY_DESTROYED";
      object.quantity = 0;
      object.acquiredInNodeId = null;
      object.acquiredByActionId = null;
    }
    object.signatures = sortedUnique([...object.signatures, ...(mutation.signatures || [])]);
    object.seals = sortedUnique([...object.seals, ...(mutation.seals || [])]);
    object.routes = sortedUnique([...object.routes, ...(mutation.routes || [])]);
    object.claimIds = sortedUnique([...object.claimIds, ...(mutation.claimIds || [])]);
    if (mutation.knownBySeatIds) object.knownBySeatIds = sortedUnique(mutation.knownBySeatIds);
    if (object.custodySeatId) object.knownBySeatIds = sortedUnique([...object.knownBySeatIds, object.custodySeatId]);
    if (mutation.visibility) object.visibility = mutation.visibility;
    for (const seatId of object.knownBySeatIds) {
      const targetSeat = state.seats[seatId];
      if (targetSeat) targetSeat.knownObjectVersionIds = sortedUnique([...targetSeat.knownObjectVersionIds, object.versionId]);
    }
    resolution.objectVersionIds.push(object.versionId);
  }

  for (const grant of action.command.effect.knowledgeGrants || []) {
    const delta = updateKnowledgeRecord(state, {
      factId: grant.factId,
      seatIds: grant.seatIds,
      provenance: grant.provenance,
      claimId: grant.claimId,
      objectId: grant.objectId,
      objectVersionId: grant.objectVersionId,
      actionId: action.command.actionId,
    });
    state.knowledgeDeltas.push(delta);
    resolution.knowledgeDeltaIds.push(delta.deltaId);
  }
  for (const revoke of action.command.effect.knowledgeRevokes || []) {
    const existing = state.knowledge[revoke.factId];
    if (existing) existing.knownBySeatIds = existing.knownBySeatIds.filter((seatId) => !revoke.seatIds.includes(seatId));
    for (const seatId of revoke.seatIds) {
      const targetSeat = state.seats[seatId];
      if (targetSeat) targetSeat.knownFactIds = targetSeat.knownFactIds.filter((factId) => factId !== revoke.factId);
    }
    const delta: PressureKnowledgeDelta = {
      deltaId: stableId("knowledge", state.runId, state.nodeId, action.command.actionId, revoke.factId, "revoke"),
      factId: revoke.factId,
      grantedToSeatIds: [],
      revokedFromSeatIds: sortedUnique(revoke.seatIds),
      sourceActionIds: [action.command.actionId],
    };
    state.knowledgeDeltas.push(delta);
    resolution.knowledgeDeltaIds.push(delta.deltaId);
  }
  for (const claim of action.command.effect.claimUpdates || []) {
    const existing = state.claims[claim.claimId];
    state.claims[claim.claimId] = {
      status: claim.status,
      knownBySeatIds: sortedUnique(claim.knownBySeatIds),
      sourceActionIds: sortedUnique([...(existing?.sourceActionIds || []), action.command.actionId]),
    };
  }
  for (const item of action.command.effect.responsibilityEntries || []) {
    const entry = {
      responsibilityId: item.responsibilityId,
      seatId: item.seatId,
      kind: item.kind,
      weight: item.weight,
      sourceActionId: action.command.actionId,
    };
    if (!state.responsibilities.some((existing) => existing.responsibilityId === entry.responsibilityId)) {
      state.responsibilities.push(entry);
    }
    resolution.responsibilityEntryIds.push(entry.responsibilityId);
  }
  if (action.command.slot === "REACTION") seat.reactionUsedAtNodeId = state.nodeId;
  action.status = resolution.status === "REJECTED" ? "REJECTED" : "RESOLVED";
  action.resolvedAt = isoFromEpoch(resolvedAtEpochMs);
  action.resolution = resolution;
  return resolution;
}

function resolveActionBatch(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  actions: PressureSealedAction[],
  nowEpochMs: number,
): PressureActionResolution[] {
  const ordered = [...actions].sort(actionComparator);
  const winners = selectObjectMutationWinners(content, state, ordered);
  return ordered.map((action) => applyActionEffects(state, action, winners, nowEpochMs));
}


function frozenCanonicalView(frozen: FrozenNodeResultV1): Record<string, unknown> {
  return { ...clonePressureValue(frozen), contentHash: "", frozenAt: null };
}

export function frozenNodeResultHash(frozen: FrozenNodeResultV1): string {
  return pressureHash(frozenCanonicalView(frozen));
}

export function assertFrozenNodeResultIntegrity(frozen: FrozenNodeResultV1): void {
  const expected = frozenNodeResultHash(frozen);
  if (frozen.contentHash !== expected) {
    throw new PressureKernelError("FROZEN_RESULT_HASH_MISMATCH", `Frozen result hash mismatch for ${frozen.frozenResultId}`);
  }
}

function openingProjectionRefForBranch(
  content: PressureRuntimeContent,
  node: PressureContentNode,
  branch: PressureContentBranch,
): string | null {
  if (!node.nextNodeId || node.nextNodeId === "FINALE" || node.nodeId === "N7") return null;
  const next = content.nodes[node.nextNodeId];
  const variant = next?.openingVariants.find((entry) =>
    entry.predecessorFrozenResultId === branch.frozenResultId && entry.predecessorBranchId === branch.branchId,
  );
  if (!variant) throw new PressureKernelError("PROJECTION_INPUT_DRIFT", `No opening variant for ${branch.frozenResultId}`);
  return variant.openingProjectionId;
}
function createP0FrozenResult(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  nowEpochMs: number,
): FrozenNodeResultV1 {
  const branch = content.nodes.P0.branches[0];
  if (!branch) throw new PressureKernelError("CONTENT_IMPORT_INVALID", "P0 locked branch is missing");
  const eventSequenceFrom = state.rootEvents.length + 1;
  const frozen: FrozenNodeResultV1 = {
    schemaVersion: "pressure_frozen_node_result_v1",
    frozenResultId: branch.frozenResultId,
    runId: state.runId,
    nodeId: "P0",
    packageSha256: state.packageSha256,
    runSeed: state.runSeed,
    inputSnapshotHash: state.inputSnapshotHash,
    sealedActionIds: [],
    rulesInputHash: pressureHash({ nodeId: "P0", packageSha256: state.packageSha256 }),
    branchId: branch.branchId,
    branchLevel: branch.level,
    selectorInputs: {},
    frozenFactIds: [...branch.frozenFactIds],
    objectOutcomes: [],
    knowledgeDeltas: [],
    responsibilityAndEvidenceFreeze: [...branch.responsibilityAndEvidenceFreeze],
    trackDeltas: { ...branch.trackDeltas },
    carryForward: [...branch.carryForward],
    openingProjectionRef: "opening.N1.from.P0.LOCKED",
    worldTimeAfter: state.worldTimeMinutes,
    pressureAfter: state.pressureLevel,
    eventSequenceFrom,
    eventSequenceTo: eventSequenceFrom,
    contentHash: "",
    frozenAt: isoFromEpoch(nowEpochMs),
  };
  frozen.contentHash = frozenNodeResultHash(frozen);
  return frozen;
}

export function projectP0ToN1(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  nowEpochMs: number,
  prepareDeadlineEpochMs: number,
): { state: PressureRuntimeState; publicProjection: PressureOpeningProjection; privateProjections: PressureOpeningProjection[] } {
  if (sourceState.phase !== "P0_PROJECTING" || sourceState.nodeId !== "P0") {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", "P0 is not ready for projection");
  }
  const state = cloneState(sourceState);
  const frozen = createP0FrozenResult(content, state, nowEpochMs);
  state.frozenResults.push(frozen);
  for (const [trackId, delta] of Object.entries(frozen.trackDeltas)) state.tracks[trackId] = (state.tracks[trackId] || 0) + delta;
  appendRootEvent(state, "SETTLEMENT_FROZEN", {
    frozenResultId: frozen.frozenResultId,
    branchId: frozen.branchId,
    branchLevel: frozen.branchLevel,
    contentHash: frozen.contentHash,
    rulesInputHash: frozen.rulesInputHash,
  }, {
    visibility: "PUBLIC",
    audienceSeatIds: content.seatIds,
    dedupeKey: `SETTLEMENT_FROZEN:${state.runId}:P0`,
    epochMs: nowEpochMs,
  });
  const publicProjection: PressureOpeningProjection = {
    schemaVersion: "pressure_opening_projection_v1",
    projectionId: "opening.N1.from.P0.LOCKED:PUBLIC",
    runId: state.runId,
    nodeId: "N1",
    predecessorFrozenResultId: frozen.frozenResultId,
    viewerSeatId: null,
    publicFactIds: [...frozen.frozenFactIds],
    privateFactIds: [],
    objectVersionIds: [],
    currentActorId: null,
    contentHash: "",
  };
  publicProjection.contentHash = pressureHash({ ...publicProjection, contentHash: "" });
  const privateProjections = content.seatIds.map((seatId) => {
    const seatContent = content.nodes.N1.seats.find((seat) => seat.seatId === seatId)!;
    const projection: PressureOpeningProjection = {
      schemaVersion: "pressure_opening_projection_v1",
      projectionId: `opening.N1.from.P0.LOCKED:${seatId}`,
      runId: state.runId,
      nodeId: "N1",
      predecessorFrozenResultId: frozen.frozenResultId,
      viewerSeatId: seatId,
      publicFactIds: [...frozen.frozenFactIds],
      privateFactIds: [...seatContent.knownFactIds],
      objectVersionIds: state.seats[seatId].knownObjectVersionIds,
      currentActorId: seatContent.currentActorId,
      contentHash: "",
    };
    projection.contentHash = pressureHash({ ...projection, contentHash: "" });
    return projection;
  });
  transitionPhase(state, "PREPARE_OPEN");
  state.phaseSnapshotVersion = state.version;
  state.nodeId = "N1";
  state.nodeSequence = content.nodes.N1.sequence;
  state.selectorState = clonePressureValue(content.nodes.N1.defaultInputState);
  state.phaseDeadlineEpochMs = prepareDeadlineEpochMs;
  state.inputSnapshotHash = pressureHash({
    predecessorFrozenResultHash: frozen.contentHash,
    publicProjectionHash: publicProjection.contentHash,
    privateProjectionHashes: privateProjections.map((projection) => projection.contentHash),
    objects: state.objects,
    seats: state.seats,
  });
  state.projectionInputs[`${frozen.frozenResultId}:${frozen.contentHash}`] = {
    frozenResultId: frozen.frozenResultId,
    frozenContentHash: frozen.contentHash,
    projectionBatchHash: pressureHash([publicProjection.contentHash, ...privateProjections.map((projection) => projection.contentHash)]),
    projected: true,
  };
  for (const projection of [publicProjection, ...privateProjections]) state.projections[projection.projectionId] = projection;
  appendRootEvent(state, "OPENING_PROJECTED", {
    predecessorFrozenResultId: frozen.frozenResultId,
    nodeId: "N1",
    publicProjectionHash: publicProjection.contentHash,
    privateProjectionHashes: Object.fromEntries(privateProjections.map((projection) => [projection.viewerSeatId!, projection.contentHash])),
  }, {
    visibility: "PUBLIC",
    audienceSeatIds: content.seatIds,
    dedupeKey: `OPENING_PROJECTED:${state.runId}:N1`,
    epochMs: nowEpochMs,
  });
  appendRootEvent(state, "PHASE_OPENED", {
    phase: "PREPARE_OPEN",
    nodeId: "N1",
    deadlineEpochMs: prepareDeadlineEpochMs,
  }, {
    visibility: "PUBLIC",
    audienceSeatIds: content.seatIds,
    dedupeKey: `PHASE_OPENED:${state.runId}:N1:PREPARE`,
    epochMs: nowEpochMs,
  });
  return { state, publicProjection, privateProjections };
}

export function lockPreparePhase(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  nowEpochMs: number,
): PressureRuntimeState {
  if (sourceState.phase !== "PREPARE_OPEN") throw new PressureKernelError("NODE_PHASE_MISMATCH", "PREPARE is not open");
  const completeBeforeDeadline = allSeatsSealed(content, sourceState, "PREPARE");
  const deadlineReached = sourceState.phaseDeadlineEpochMs !== null && nowEpochMs >= sourceState.phaseDeadlineEpochMs;
  if (!completeBeforeDeadline && !deadlineReached) return cloneState(sourceState);
  let state = deadlineReached ? sealMissingPressureActions(content, sourceState, "PREPARE", nowEpochMs) : cloneState(sourceState);
  if (!allSeatsSealed(content, state, "PREPARE")) throw new PressureKernelError("SETTLEMENT_INPUT_INCOMPLETE", "PREPARE inputs are incomplete");
  state = cloneState(state);
  const commands = content.seatIds.map((seatId) => state.sealedActions[state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:PREPARE`]].command);
  state.prepareRulesInputHash = pressureHash(commands.map(rulesCommandView));
  transitionPhase(state, "PREPARE_LOCKED");
  return state;
}

export function beginPrepareResolutionPhase(sourceState: PressureRuntimeState): PressureRuntimeState {
  if (sourceState.phase !== "PREPARE_LOCKED") {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", "PREPARE is not locked");
  }
  const state = cloneState(sourceState);
  transitionPhase(state, "PREPARE_RESOLVING");
  return state;
}

export function resolvePreparePhase(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  nowEpochMs: number,
  commitDeadlineEpochMs: number,
): { state: PressureRuntimeState; actionResolutions: PressureActionResolution[] } {
  if (sourceState.phase !== "PREPARE_RESOLVING") throw new PressureKernelError("NODE_PHASE_MISMATCH", "PREPARE is not resolving");
  const state = cloneState(sourceState);
  const actions = content.seatIds.map((seatId) => state.sealedActions[state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:PREPARE`]]);
  const inputHash = pressureHash(actions.map((action) => ({ actionId: action.command.actionId, commandHash: pressureHash(rulesCommandView(action.command)) })));
  if (state.prepareRulesInputHash !== pressureHash(actions.map((action) => rulesCommandView(action.command)))) {
    throw new PressureKernelError("SETTLEMENT_INPUT_DRIFT", "PREPARE sealed input changed");
  }
  const checkpointKey = `${state.nodeId}:PREPARE_RESOLVED`;
  const existingCheckpoint = state.checkpoints[checkpointKey];
  if (existingCheckpoint && existingCheckpoint.inputHash !== inputHash) {
    throw new PressureKernelError("SETTLEMENT_INPUT_DRIFT", "PREPARE checkpoint input changed");
  }
  const actionResolutions = resolveActionBatch(content, state, actions, nowEpochMs);
  const timeDeltaMinutes = Math.max(0, ...actionResolutions.map((resolution) => resolution.worldTimeDeltaMinutes));
  const pressureDelta = Math.max(1, ...actionResolutions.map((resolution) => resolution.pressureDelta));
  state.worldTimeMinutes += timeDeltaMinutes;
  state.pressureLevel += pressureDelta;
  state.checkpoints[checkpointKey] = {
    checkpointKey,
    inputHash,
    outputHash: pressureHash({ actionResolutions, timeDeltaMinutes, pressureDelta, selectorState: state.selectorState, objects: state.objects }),
    completedAt: isoFromEpoch(nowEpochMs),
  };
  appendRootEvent(state, "TIME_ADVANCED", {
    nodeId: state.nodeId,
    minutes: timeDeltaMinutes,
    pressureDelta,
    worldTimeMinutes: state.worldTimeMinutes,
    pressureLevel: state.pressureLevel,
    resolvedActionIds: actionResolutions.map((resolution) => resolution.actionId),
  }, {
    visibility: "PUBLIC",
    audienceSeatIds: content.seatIds,
    sourceActionIds: actionResolutions.map((resolution) => resolution.actionId),
    dedupeKey: `TIME_ADVANCED:${state.runId}:${state.nodeId}:PREPARE`,
    epochMs: nowEpochMs,
  });
  transitionPhase(state, "COMMIT_OPEN");
  state.phaseSnapshotVersion = state.version;
  state.phaseDeadlineEpochMs = commitDeadlineEpochMs;
  state.inputSnapshotHash = pressureHash({
    previous: sourceState.inputSnapshotHash,
    prepareRulesInputHash: state.prepareRulesInputHash,
    worldTimeMinutes: state.worldTimeMinutes,
    pressureLevel: state.pressureLevel,
    objects: state.objects,
    seats: state.seats,
    selectorState: state.selectorState,
  });
  appendRootEvent(state, "PHASE_OPENED", {
    phase: "COMMIT_OPEN",
    nodeId: state.nodeId,
    deadlineEpochMs: commitDeadlineEpochMs,
    inputSnapshotHash: state.inputSnapshotHash,
  }, {
    visibility: "PUBLIC",
    audienceSeatIds: content.seatIds,
    dedupeKey: `PHASE_OPENED:${state.runId}:${state.nodeId}:COMMIT`,
    epochMs: nowEpochMs,
  });
  return { state, actionResolutions };
}

export function lockCommitPhase(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  nowEpochMs: number,
): PressureRuntimeState {
  if (sourceState.phase !== "COMMIT_OPEN") throw new PressureKernelError("NODE_PHASE_MISMATCH", "COMMIT is not open");
  const completeBeforeDeadline = allSeatsSealed(content, sourceState, "COMMIT");
  const deadlineReached = sourceState.phaseDeadlineEpochMs !== null && nowEpochMs >= sourceState.phaseDeadlineEpochMs;
  if (!completeBeforeDeadline && !deadlineReached) return cloneState(sourceState);
  let state = deadlineReached ? sealMissingPressureActions(content, sourceState, "COMMIT", nowEpochMs) : cloneState(sourceState);
  if (!allSeatsSealed(content, state, "COMMIT")) throw new PressureKernelError("SETTLEMENT_INPUT_INCOMPLETE", "COMMIT inputs are incomplete");
  state = cloneState(state);
  const commitActions = content.seatIds.map((seatId) => state.sealedActions[state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:COMMIT`]]);
  if (commitActions.some((action) => action.snapshotHash !== state.inputSnapshotHash)) {
    throw new PressureKernelError("SETTLEMENT_INPUT_DRIFT", "COMMIT actions were not sealed against one shared snapshot");
  }
  const commitCommands = commitActions.map((action) => action.command);
  state.commitRulesInputHash = pressureHash(commitCommands.map(rulesCommandView));
  state.commitSnapshotHash = state.inputSnapshotHash;
  transitionPhase(state, "COMMIT_LOCKED");
  return state;
}

export function deterministicReactionTrigger(state: PressureRuntimeState): { triggered: boolean; triggerFactIds: string[] } {
  const commitActions = Object.values(state.sealedActions)
    .filter((action) => action.command.nodeId === state.nodeId && action.command.slot === "COMMIT");
  const triggered = commitActions.some((action) => action.command.effect.reactionSignal?.triggered);
  const triggerFactIds = sortedUnique(commitActions.flatMap((action) => action.command.effect.reactionSignal?.evidenceIds || []));
  return { triggered, triggerFactIds };
}

export function openReactionOrSettlement(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  nowEpochMs: number,
  trigger = deterministicReactionTrigger(sourceState),
): PressureRuntimeState {
  if (sourceState.phase !== "COMMIT_LOCKED") throw new PressureKernelError("NODE_PHASE_MISMATCH", "COMMIT is not locked");
  const state = cloneState(sourceState);
  const reaction = content.nodes[state.nodeId].reaction;
  if (!reaction || !trigger.triggered) {
    transitionPhase(state, "SETTLING");
    state.phaseDeadlineEpochMs = null;
    return state;
  }
  transitionPhase(state, "REACTION_OPEN");
  state.phaseSnapshotVersion = state.version;
  state.phaseDeadlineEpochMs = nowEpochMs + reaction.windowSeconds * 1_000;
  state.reactionWindow = {
    nodeId: state.nodeId,
    openedAtEpochMs: nowEpochMs,
    closesAtEpochMs: state.phaseDeadlineEpochMs,
    eligibleSeatIds: [...reaction.eligibleSeatIds],
    allowedActionTypes: [...reaction.allowedActionTypes],
    usedSeatIds: [],
    resealUsed: false,
  };
  appendRootEvent(state, "REACTION_OPENED", {
    nodeId: state.nodeId,
    triggerId: reaction.triggerId,
    eligibleSeatIds: reaction.eligibleSeatIds,
    allowedActionTypes: reaction.allowedActionTypes,
    triggerFactIds: sortedUnique(trigger.triggerFactIds),
    deadlineEpochMs: state.phaseDeadlineEpochMs,
  }, {
    visibility: "LIMITED",
    audienceSeatIds: reaction.eligibleSeatIds,
    dedupeKey: `REACTION_OPENED:${state.runId}:${state.nodeId}`,
    epochMs: nowEpochMs,
  });
  return state;
}

export function lockReactionPhase(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  nowEpochMs: number,
): PressureRuntimeState {
  if (sourceState.phase !== "REACTION_OPEN") throw new PressureKernelError("REACTION_NOT_AVAILABLE", "REACTION is not open");
  const completeBeforeDeadline = allSeatsSealed(content, sourceState, "REACTION");
  const deadlineReached = sourceState.phaseDeadlineEpochMs !== null && nowEpochMs >= sourceState.phaseDeadlineEpochMs;
  if (!completeBeforeDeadline && !deadlineReached) return cloneState(sourceState);
  let state = deadlineReached ? sealMissingPressureActions(content, sourceState, "REACTION", nowEpochMs) : cloneState(sourceState);
  if (!allSeatsSealed(content, state, "REACTION")) throw new PressureKernelError("SETTLEMENT_INPUT_INCOMPLETE", "REACTION inputs are incomplete");
  state = cloneState(state);
  state.reactionWindow = state.reactionWindow ? {
    ...state.reactionWindow,
    usedSeatIds: sortedUnique((content.nodes[state.nodeId].reaction?.eligibleSeatIds || []).filter((seatId) => Boolean(state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:REACTION`]))),
  } : null;
  transitionPhase(state, "SETTLING");
  state.phaseDeadlineEpochMs = null;
  return state;
}

function branchOutcomeCustody(
  state: PressureRuntimeState,
  outcome: PressureContentBranch["objectOutcomes"][number],
  actionResolutions: PressureActionResolution[],
): PressureFrozenObjectOutcome {
  const object = state.objects[outcome.objectId];
  const sourceActionIds = actionResolutions
    .filter((resolution) => resolution.status !== "REJECTED" && resolution.objectVersionIds.length > 0)
    .map((resolution) => state.sealedActions[resolution.actionId])
    .filter((action): action is PressureSealedAction => Boolean(action))
    .filter((action) => (action.command.effect.objectMutations || []).some((mutation) => mutation.objectId === outcome.objectId))
    .map((action) => action.command.actionId)
    .sort();
  let custodySeatId = object?.custodySeatId || null;
  let custodyActorId = object?.custodyActorId || null;
  if (outcome.custodyMode.startsWith("seat.")) {
    custodySeatId = outcome.custodyMode;
    custodyActorId = state.seats[custodySeatId]?.currentActorId || null;
  } else if (
    outcome.custodyMode.startsWith("DISTRIBUTED")
    || [
      "MIXED",
      "MULTIPLE_CUSTODIANS",
      "SYSTEM_PRESSURE",
      "SYSTEM_FINAL",
      "NO_CUSTODY_DESTROYED",
      "RECIPIENT_COUNTIES_AND_HOUSEHOLDS",
      "HOUSEHOLDS_PLUS_OFFICIAL_REGISTRY",
      "COMPONENT_CUSTODY",
      "PROVINCIAL_AND_FISCAL_SPLIT",
      "SEIZING_AUTHORITIES",
      "OFFICIAL_RECIPIENTS",
      "ROUTE_RECIPIENTS",
    ].includes(outcome.custodyMode)
  ) {
    custodySeatId = null;
    custodyActorId = null;
  }
  return { ...outcome, custodySeatId, custodyActorId, sourceActionIds };
}

function actionsForNodeSettlement(state: PressureRuntimeState): PressureSealedAction[] {
  return Object.values(state.sealedActions)
    .filter((action) => action.command.nodeId === state.nodeId && ["COMMIT", "REACTION"].includes(action.command.slot))
    .sort(actionComparator);
}

export function settlePressureNode(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  nowEpochMs: number,
): PressureSettlementResult {
  if (sourceState.phase === "FROZEN") {
    const frozen = sourceState.frozenResults.find((entry) => entry.nodeId === sourceState.nodeId);
    if (!frozen) throw new PressureKernelError("RESULT_NOT_READY", `Frozen result missing for ${sourceState.nodeId}`);
    assertFrozenNodeResultIntegrity(frozen);
    const actionResolutions = actionsForNodeSettlement(sourceState).map((action) => action.resolution).filter((value): value is PressureActionResolution => Boolean(value));
    return { state: cloneState(sourceState), frozenResult: clonePressureValue(frozen), actionResolutions: clonePressureValue(actionResolutions) };
  }
  if (sourceState.phase !== "SETTLING") throw new PressureKernelError("NODE_PHASE_MISMATCH", "Node is not settling");
  if (!allSeatsSealed(content, sourceState, "COMMIT")) throw new PressureKernelError("SETTLEMENT_INPUT_INCOMPLETE", "COMMIT inputs are incomplete");
  const state = cloneState(sourceState);
  const node = content.nodes[state.nodeId];
  const relevantActions = actionsForNodeSettlement(state);
  const commitActions = content.seatIds.map((seatId) => state.sealedActions[state.actionIdBySeatSlot[`${state.nodeId}:${seatId}:COMMIT`]]);
  if (!state.commitSnapshotHash || commitActions.some((action) => action.snapshotHash !== state.commitSnapshotHash)) {
    throw new PressureKernelError("SETTLEMENT_INPUT_DRIFT", "COMMIT shared snapshot changed");
  }
  const commitCommands = commitActions.map((action) => action.command);
  if (state.commitRulesInputHash !== pressureHash(commitCommands.map(rulesCommandView))) {
    throw new PressureKernelError("SETTLEMENT_INPUT_DRIFT", "COMMIT sealed input changed");
  }
  const rulesInput = relevantActions.map((action) => ({
    actionId: action.command.actionId,
    seatId: action.command.seatId,
    slot: action.command.slot,
    snapshotHash: action.snapshotHash,
    commandHash: pressureHash(rulesCommandView(action.command)),
  }));
  const rulesInputHash = pressureHash(rulesInput);
  const checkpointKey = `${state.nodeId}:RULES_APPLIED`;
  const existingCheckpoint = state.checkpoints[checkpointKey];
  if (existingCheckpoint && existingCheckpoint.inputHash !== rulesInputHash) {
    throw new PressureKernelError("SETTLEMENT_INPUT_DRIFT", "Sealed input changed after checkpoint");
  }
  const actionResolutions = resolveActionBatch(content, state, relevantActions, nowEpochMs);
  const branch = selectPressureBranch(node, state.selectorState);
  const frozenObjectOutcomes = branch.objectOutcomes.map((outcome) => branchOutcomeCustody(state, outcome, actionResolutions));
  for (const outcome of frozenObjectOutcomes) {
    const object = state.objects[outcome.objectId];
    if (!object) continue;
    const predecessorVersionId = object.versionId;
    object.predecessorVersionId = predecessorVersionId;
    object.version += 1;
    object.versionId = outcome.versionId;
    object.status = outcome.status;
    object.custodyMode = outcome.custodyMode;
    object.custodySeatId = outcome.custodySeatId;
    object.custodyActorId = outcome.custodyActorId;
    object.knownBySeatIds = sortedUnique(outcome.knownBy);
    object.visibility = outcome.visibility;
    for (const seatId of object.knownBySeatIds) {
      const seat = state.seats[seatId];
      if (seat) seat.knownObjectVersionIds = sortedUnique([...seat.knownObjectVersionIds, object.versionId]);
    }
  }
  for (const factId of branch.frozenFactIds) {
    state.knowledge[factId] = {
      factId,
      provenance: branch.visibility === "PUBLIC" ? "PUBLIC" : "SEAT_RECORD",
      knownBySeatIds: branch.visibility === "PUBLIC" ? [...content.seatIds] : [...branch.knownBy],
      claimId: null,
      objectId: null,
      objectVersionId: null,
      sourceActionIds: relevantActions.map((action) => action.command.actionId).sort(),
    };
    for (const seatId of state.knowledge[factId].knownBySeatIds) {
      const seat = state.seats[seatId];
      if (seat) seat.knownFactIds = sortedUnique([...seat.knownFactIds, factId]);
    }
  }
  for (const [trackId, delta] of Object.entries(branch.trackDeltas)) state.tracks[trackId] = (state.tracks[trackId] || 0) + Number(delta || 0);
  const eventSequenceFrom = state.rootEvents.length + 1;
  const frozenAt = isoFromEpoch(Math.max(nowEpochMs, ...relevantActions.map((action) => action.command.submittedAtEpochMs)));
  const frozen: FrozenNodeResultV1 = {
    schemaVersion: "pressure_frozen_node_result_v1",
    frozenResultId: branch.frozenResultId,
    runId: state.runId,
    nodeId: state.nodeId,
    packageSha256: state.packageSha256,
    runSeed: state.runSeed,
    inputSnapshotHash: state.inputSnapshotHash,
    sealedActionIds: relevantActions.map((action) => action.command.actionId).sort(),
    rulesInputHash,
    branchId: branch.branchId,
    branchLevel: branch.level,
    selectorInputs: clonePressureValue(state.selectorState),
    frozenFactIds: [...branch.frozenFactIds],
    objectOutcomes: frozenObjectOutcomes,
    knowledgeDeltas: state.knowledgeDeltas.filter((delta) => delta.sourceActionIds.some((actionId) => state.sealedActions[actionId]?.command.nodeId === state.nodeId)),
    responsibilityAndEvidenceFreeze: [...branch.responsibilityAndEvidenceFreeze],
    trackDeltas: { ...branch.trackDeltas },
    carryForward: [...branch.carryForward],
    openingProjectionRef: openingProjectionRefForBranch(content, node, branch),
    worldTimeAfter: state.worldTimeMinutes,
    pressureAfter: state.pressureLevel,
    eventSequenceFrom,
    eventSequenceTo: eventSequenceFrom,
    contentHash: "",
    frozenAt,
  };
  frozen.contentHash = frozenNodeResultHash(frozen);
  const existingFrozen = state.frozenResults.find((entry) => entry.nodeId === state.nodeId);
  if (existingFrozen) assertFrozenNodeResultIntegrity(existingFrozen);
  if (existingFrozen && existingFrozen.contentHash !== frozen.contentHash) {
    throw new PressureKernelError("SETTLEMENT_REPLAY_HASH_MISMATCH", `Frozen result drift for ${state.nodeId}`);
  }
  if (!existingFrozen) state.frozenResults.push(frozen);
  state.checkpoints[checkpointKey] = {
    checkpointKey,
    inputHash: rulesInputHash,
    outputHash: frozen.contentHash,
    completedAt: frozenAt,
  };
  transitionPhase(state, "FROZEN");
  appendRootEvent(state, "SETTLEMENT_FROZEN", {
    frozenResultId: frozen.frozenResultId,
    branchId: frozen.branchId,
    branchLevel: frozen.branchLevel,
    contentHash: frozen.contentHash,
    rulesInputHash,
  }, {
    visibility: "PUBLIC",
    audienceSeatIds: content.seatIds,
    sourceActionIds: frozen.sealedActionIds,
    dedupeKey: `SETTLEMENT_FROZEN:${state.runId}:${state.nodeId}`,
    epochMs: nowEpochMs,
  });
  return { state, frozenResult: clonePressureValue(existingFrozen || frozen), actionResolutions: clonePressureValue(actionResolutions) };
}

function variantForFrozen(content: PressureRuntimeContent, nextNodeId: string, frozen: FrozenNodeResultV1) {
  assertFrozenNodeResultIntegrity(frozen);
  const variant = content.nodes[nextNodeId].openingVariants.find((entry) =>
    entry.predecessorFrozenResultId === frozen.frozenResultId && entry.predecessorBranchId === frozen.branchId,
  );
  if (!variant) throw new PressureKernelError("PROJECTION_INPUT_DRIFT", `No opening variant for ${frozen.frozenResultId}`);
  const frozenFactSet = new Set(frozen.frozenFactIds);
  const frozenVersionSet = new Set(frozen.objectOutcomes.map((outcome) => outcome.versionId));
  if (variant.requiredFrozenFactIds.some((factId) => !frozenFactSet.has(factId))) {
    throw new PressureKernelError("PROJECTION_INPUT_DRIFT", `Opening variant references absent frozen facts`);
  }
  if (variant.requiredObjectVersionIds.some((versionId) => !frozenVersionSet.has(versionId))) {
    throw new PressureKernelError("PROJECTION_INPUT_DRIFT", `Opening variant references absent object versions`);
  }
  return variant;
}

function buildOpeningProjection(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  nextNodeId: string,
  frozen: FrozenNodeResultV1,
  viewerSeatId: string | null,
): PressureOpeningProjection {
  const variant = variantForFrozen(content, nextNodeId, frozen);
  const frozenFacts = new Set(frozen.frozenFactIds);
  const frozenVersions = new Set(frozen.objectOutcomes.map((outcome) => outcome.versionId));
  const privateProjection = viewerSeatId ? variant.seatPrivateProjections.find((projection) => projection.seatId === viewerSeatId) : null;
  if (viewerSeatId && !privateProjection) throw new PressureKernelError("PROJECTION_KNOWLEDGE_VIOLATION", `No private projection for ${viewerSeatId}`);
  const publicFactIds = frozen.frozenFactIds.filter((factId) => {
    const knowledge = state.knowledge[factId];
    return knowledge?.provenance === "PUBLIC" || knowledge?.knownBySeatIds.length === content.seatIds.length;
  });
  const privateFactIds = viewerSeatId
    ? sortedUnique((privateProjection?.grantedFrozenFactIds || []).filter((factId) => frozenFacts.has(factId)))
    : [];
  const objectVersionIds = viewerSeatId
    ? sortedUnique((privateProjection?.grantedObjectVersionIds || []).filter((versionId) => frozenVersions.has(versionId)))
    : sortedUnique(variant.publicReferencedObjectVersionIds.filter((versionId) => frozenVersions.has(versionId)));
  const projection: PressureOpeningProjection = {
    schemaVersion: "pressure_opening_projection_v1",
    projectionId: `${variant.openingProjectionId}:${viewerSeatId || "PUBLIC"}`,
    runId: state.runId,
    nodeId: nextNodeId,
    predecessorFrozenResultId: frozen.frozenResultId,
    viewerSeatId,
    publicFactIds,
    privateFactIds,
    objectVersionIds,
    currentActorId: viewerSeatId ? String(privateProjection?.currentActorId || "") : null,
    contentHash: "",
  };
  projection.contentHash = pressureHash({ ...projection, contentHash: "" });
  return projection;
}

function applyHandoffs(content: PressureRuntimeContent, state: PressureRuntimeState, afterNode: string, nowEpochMs: number): void {
  for (const handoff of content.handoffs.filter((entry) => entry.afterNode === afterNode)) {
    const seat = state.seats[handoff.seatId];
    if (!seat || seat.currentActorId !== handoff.fromActorId) continue;
    seat.currentActorId = handoff.toActorId;
    seat.controlEpoch += 1;
    const nextNodeId = content.nodes[afterNode]?.nextNodeId || "";
    const nextSeat = content.nodes[nextNodeId]?.seats.find((entry) => entry.seatId === handoff.seatId);
    if (nextSeat) {
      seat.roleKey = nextSeat.roleKey;
      seat.permissions = [...nextSeat.permissions].sort();
      const inheritable = Object.values(state.knowledge)
        .filter((record) => record.knownBySeatIds.includes(handoff.seatId) && record.provenance !== "PRIVATE_ACTOR")
        .map((record) => record.factId);
      seat.knownFactIds = sortedUnique([...nextSeat.knownFactIds, ...inheritable]);
    }
    appendRootEvent(state, "HANDOFF_APPLIED", {
      handoffId: handoff.handoffId,
      seatId: handoff.seatId,
      fromActorId: handoff.fromActorId,
      toActorId: handoff.toActorId,
      controlEpoch: seat.controlEpoch,
      permissionChange: handoff.permissionChange,
    }, {
      visibility: "LIMITED",
      audienceSeatIds: [handoff.seatId],
      dedupeKey: `HANDOFF_APPLIED:${state.runId}:${handoff.handoffId}`,
      epochMs: nowEpochMs,
    });
  }
}

function resetNodeSlots(state: PressureRuntimeState, nextNodeId: string): void {
  for (const key of Object.keys(state.actionIdBySeatSlot)) {
    if (key.startsWith(`${nextNodeId}:`)) delete state.actionIdBySeatSlot[key];
  }
  for (const seat of Object.values(state.seats)) {
    seat.reactionUsedAtNodeId = null;
    seat.initiativeLost = false;
  }
}

export function projectNextPressureNode(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  nowEpochMs: number,
  prepareDeadlineEpochMs: number,
): { state: PressureRuntimeState; publicProjection: PressureOpeningProjection | null; privateProjections: PressureOpeningProjection[] } {
  if (sourceState.phase !== "FROZEN" && sourceState.phase !== "PROJECTING") {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", "Frozen node is not ready for projection");
  }
  const state = cloneState(sourceState);
  if (state.phase === "FROZEN") transitionPhase(state, "PROJECTING");
  const frozen = state.frozenResults.find((entry) => entry.nodeId === state.nodeId);
  if (!frozen) throw new PressureKernelError("RESULT_NOT_READY", `Frozen result missing for ${state.nodeId}`);
  const inputKey = `${frozen.frozenResultId}:${frozen.contentHash}`;
  const node = content.nodes[state.nodeId];
  if (node.nextNodeId === "FINALE" || state.nodeId === "N7") {
    assertFrozenNodeResultIntegrity(frozen);
    state.projectionInputs[inputKey] = { frozenResultId: frozen.frozenResultId, frozenContentHash: frozen.contentHash, projectionBatchHash: null, projected: true };
    transitionPhase(state, "FINALE_COMPUTING");
    state.phaseDeadlineEpochMs = null;
    return { state, publicProjection: null, privateProjections: [] };
  }
  const nextNodeId = node.nextNodeId;
  if (!nextNodeId || !content.nodes[nextNodeId]) throw new PressureKernelError("CONTENT_IMPORT_INVALID", `Missing next node after ${state.nodeId}`);
  const publicProjection = buildOpeningProjection(content, state, nextNodeId, frozen, null);
  const privateProjections = content.seatIds.map((seatId) => buildOpeningProjection(content, state, nextNodeId, frozen, seatId));
  const alreadyProjected = state.projectionInputs[inputKey]?.projected;
  if (alreadyProjected) return { state: cloneState(sourceState), publicProjection: clonePressureValue(publicProjection), privateProjections: clonePressureValue(privateProjections) };
  const projectionBatchHash = pressureHash([publicProjection.contentHash, ...privateProjections.map((projection) => projection.contentHash)]);
  state.projectionInputs[inputKey] = { frozenResultId: frozen.frozenResultId, frozenContentHash: frozen.contentHash, projectionBatchHash, projected: true };
  for (const projection of [publicProjection, ...privateProjections]) state.projections[projection.projectionId] = projection;
  const expectedOpeningRef = variantForFrozen(content, nextNodeId, frozen).openingProjectionId;
  if (frozen.openingProjectionRef !== expectedOpeningRef) {
    throw new PressureKernelError("PROJECTION_INPUT_DRIFT", "Frozen opening projection reference does not match the accepted variant");
  }
  applyHandoffs(content, state, state.nodeId, nowEpochMs);
  transitionPhase(state, "PREPARE_OPEN");
  state.phaseSnapshotVersion = state.version;
  state.nodeId = nextNodeId;
  state.nodeSequence = content.nodes[nextNodeId].sequence;
  state.selectorState = clonePressureValue(content.nodes[nextNodeId].defaultInputState);
  state.prepareRulesInputHash = null;
  state.commitRulesInputHash = null;
  state.phaseDeadlineEpochMs = prepareDeadlineEpochMs;
  resetNodeSlots(state, nextNodeId);
  for (const projection of privateProjections) {
    const seat = state.seats[projection.viewerSeatId!];
    if (!seat) continue;
    seat.currentActorId = projection.currentActorId || seat.currentActorId;
    seat.knownFactIds = sortedUnique([...seat.knownFactIds, ...projection.publicFactIds, ...projection.privateFactIds]);
    seat.knownObjectVersionIds = sortedUnique([...seat.knownObjectVersionIds, ...projection.objectVersionIds]);
  }
  state.inputSnapshotHash = pressureHash({
    frozenResultHash: frozen.contentHash,
    publicProjectionHash: publicProjection.contentHash,
    privateProjectionHashes: privateProjections.map((projection) => projection.contentHash),
    objects: state.objects,
    seats: state.seats,
  });
  appendRootEvent(state, "OPENING_PROJECTED", {
    predecessorFrozenResultId: frozen.frozenResultId,
    openingProjectionId: frozen.openingProjectionRef,
    publicProjectionHash: publicProjection.contentHash,
    privateProjectionHashes: Object.fromEntries(privateProjections.map((projection) => [projection.viewerSeatId!, projection.contentHash])),
    nodeId: nextNodeId,
  }, {
    visibility: "PUBLIC",
    audienceSeatIds: content.seatIds,
    dedupeKey: `OPENING_PROJECTED:${state.runId}:${nextNodeId}`,
    epochMs: nowEpochMs,
  });
  appendRootEvent(state, "PHASE_OPENED", {
    phase: "PREPARE_OPEN",
    nodeId: nextNodeId,
    deadlineEpochMs: prepareDeadlineEpochMs,
  }, {
    visibility: "PUBLIC",
    audienceSeatIds: content.seatIds,
    dedupeKey: `PHASE_OPENED:${state.runId}:${nextNodeId}:PREPARE`,
    epochMs: nowEpochMs,
  });
  return { state, publicProjection, privateProjections };
}

export function interruptPressureRuntime(
  sourceState: PressureRuntimeState,
  error: { code: string; message: string; failedAtEpochMs: number },
): PressureRuntimeState {
  if (sourceState.phase === "COMPLETED" || sourceState.phase === "FAILED_RECOVERABLE") {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", `Cannot interrupt phase ${sourceState.phase}`);
  }
  const state = cloneState(sourceState);
  const resumePhase = state.phase as Exclude<PressureRuntimePhase, "FAILED_RECOVERABLE" | "COMPLETED">;
  transitionPhase(state, "FAILED_RECOVERABLE");
  state.resumePhase = resumePhase;
  state.failure = {
    code: error.code,
    message: error.message,
    failedAt: isoFromEpoch(error.failedAtEpochMs),
    resumePhase,
  };
  return state;
}

export function recoverPressureRuntime(
  sourceState: PressureRuntimeState,
  input: { nowEpochMs: number; expectedPackageSha256: string; expectedInputSnapshotHash?: string },
): PressureRuntimeState {
  assertPressureRootEventLedger(sourceState.rootEvents);
  for (const frozen of sourceState.frozenResults) assertFrozenNodeResultIntegrity(frozen);
  if (sourceState.phase !== "FAILED_RECOVERABLE" || !sourceState.resumePhase) {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", "Runtime is not recoverable");
  }
  if (sourceState.packageSha256 !== input.expectedPackageSha256) {
    throw new PressureKernelError("PACKAGE_HASH_MISMATCH", "Package changed during recovery");
  }
  if (input.expectedInputSnapshotHash && sourceState.inputSnapshotHash !== input.expectedInputSnapshotHash) {
    throw new PressureKernelError("SETTLEMENT_INPUT_DRIFT", "Input snapshot changed during recovery");
  }
  const state = cloneState(sourceState);
  const resumePhase = state.resumePhase!;
  assertPressurePhaseTransition("FAILED_RECOVERABLE", resumePhase, resumePhase);
  state.phase = resumePhase;
  state.resumePhase = null;
  const failureCode = state.failure?.code || "UNKNOWN";
  state.failure = null;
  state.version += 1;
  appendRootEvent(state, "RECOVERY_COMPLETED", {
    resumedPhase: resumePhase,
    failureCode,
    inputSnapshotHash: state.inputSnapshotHash,
  }, {
    visibility: "PRIVATE_SYSTEM",
    dedupeKey: `RECOVERY_COMPLETED:${state.runId}:${state.nodeId}:${failureCode}:${sourceState.version}`,
    epochMs: input.nowEpochMs,
  });
  return state;
}

export function freezeFinaleInput(
  _content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  _nowEpochMs: number,
): PressureRuntimeState {
  if (sourceState.phase !== "FINALE_COMPUTING") {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", "Finale is not computing");
  }
  throw new PressureKernelError("D3_REQUIRED", "Finale computation and FINALE_FROZEN belong to D3");
}

/**
 * Deterministically freezes the MVP finale from the seven immutable node
 * results. Narration may explain this result, but cannot alter it.
 */
export function completePressureFinale(
  content: PressureRuntimeContent,
  sourceState: PressureRuntimeState,
  nowEpochMs: number,
): PressureRuntimeState {
  if (sourceState.phase !== "FINALE_COMPUTING") {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", "Finale is not computing");
  }
  const frozen = sourceState.frozenResults
    .filter((entry) => /^N[1-7]$/.test(entry.nodeId))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  if (frozen.length !== 7 || new Set(frozen.map((entry) => entry.nodeId)).size !== 7) {
    throw new PressureKernelError("D3_REQUIRED", "Finale requires exactly N1-N7 FrozenNodeResult inputs");
  }
  for (const item of frozen) assertFrozenNodeResultIntegrity(item);
  const state = cloneState(sourceState);
  const trackBands = content.worldTrackIds.map((trackId) => {
    const value = Number(state.tracks[trackId] || 0);
    return { trackId, value, band: value >= 2 ? "HIGH" as const : value <= -2 ? "LOW" as const : "MID" as const };
  });
  const track = (id: string) => Number(state.tracks[id] || 0);
  const civil = track("track.civilian_land");
  const silk = track("track.mulberry_silk");
  const fiscal = track("track.fiscal_military");
  const evidence = track("track.evidence_responsibility");
  const court = track("track.court_imperial_face");
  const worldOutcomeId: PressureFinaleResultV1["worldOutcomeId"] =
    civil <= -2 && fiscal <= -2 ? "EAST_SOUTH_COLLAPSE"
      : evidence >= 2 && court <= -2 ? "TRUTH_WITH_POLITICAL_SHOCK"
      : [civil, silk, fiscal, evidence, court].every((value) => value >= 2) ? "BALANCED_SURVIVAL"
      : fiscal >= 2 && civil <= -2 ? "FISCAL_ORDER_AT_CIVIL_COST"
      : civil >= 2 && fiscal <= -2 ? "CIVIL_RELIEF_AT_WAR_COST"
      : evidence <= -2 && court >= 2 ? "SCAPEGOAT_STABILITY"
      : "UNRESOLVED_COMPROMISE";
  const seatScores: Record<string, number> = {
    "seat.zhejiang_governor": Math.min(civil, fiscal),
    "seat.zhejiang_administration": Math.min(civil, court),
    "seat.qingliu_law": evidence,
    "seat.jiangnan_merchant": Math.min(civil, fiscal),
    "seat.sili_weaving": Math.min(silk, court),
    "seat.cabinet_finance": Math.min(fiscal, court),
  };
  const seatVerdicts = content.seatIds.map((seatId) => {
    const score = Number(seatScores[seatId] || 0);
    return { seatId, score, verdict: score >= 2 ? "WIN" as const : score <= -2 ? "LOSS" as const : "COSTLY_WIN" as const };
  });
  const causes = frozen.slice(-3).map((item) => ({
    nodeId: item.nodeId,
    branchId: item.branchId,
    branchLevel: item.branchLevel,
    frozenResultId: item.frozenResultId,
  }));
  const resultWithoutHash = {
    schemaVersion: "pressure_finale_result_v1" as const,
    worldOutcomeId,
    trackBands,
    seatVerdicts,
    causes,
    inputFrozenResultIds: frozen.map((item) => item.frozenResultId),
    frozenAt: isoFromEpoch(nowEpochMs),
  };
  state.finaleResult = { ...resultWithoutHash, contentHash: pressureHash(resultWithoutHash) };
  transitionPhase(state, "COMPLETED");
  appendRootEvent(state, "FINALE_FROZEN", {
    worldOutcomeId,
    finaleContentHash: state.finaleResult.contentHash,
    inputFrozenResultIds: state.finaleResult.inputFrozenResultIds,
  }, {
    visibility: "PUBLIC",
    audienceSeatIds: content.seatIds,
    dedupeKey: `FINALE_FROZEN:${state.runId}`,
    epochMs: nowEpochMs,
  });
  return state;
}

export function pressureRuntimeReplayHash(state: PressureRuntimeState): string {
  assertPressureRootEventLedger(state.rootEvents);
  for (const frozen of state.frozenResults) assertFrozenNodeResultIntegrity(frozen);
  return pressureHash({
    runId: state.runId,
    runSeed: state.runSeed,
    runtimeProfile: state.runtimeProfile,
    strategyVersion: state.strategyVersion,
    packageSha256: state.packageSha256,
    contentTreeSha256: state.contentTreeSha256,
    phase: state.phase,
    resumePhase: state.resumePhase,
    nodeId: state.nodeId,
    nodeSequence: state.nodeSequence,
    version: state.version,
    phaseSnapshotVersion: state.phaseSnapshotVersion,
    worldTimeMinutes: state.worldTimeMinutes,
    pressureLevel: state.pressureLevel,
    phaseDeadlineEpochMs: state.phaseDeadlineEpochMs,
    inputSnapshotHash: state.inputSnapshotHash,
    prepareRulesInputHash: state.prepareRulesInputHash,
    commitSnapshotHash: state.commitSnapshotHash,
    commitRulesInputHash: state.commitRulesInputHash,
    selectorState: state.selectorState,
    seats: state.seats,
    objects: state.objects,
    knowledge: state.knowledge,
    claims: state.claims,
    responsibilities: state.responsibilities,
    tracks: state.tracks,
    sealedActions: state.sealedActions,
    actionIdBySeatSlot: state.actionIdBySeatSlot,
    idempotencyResults: state.idempotencyResults,
    resourceReservations: state.resourceReservations,
    resourceLedger: state.resourceLedger,
    knowledgeDeltas: state.knowledgeDeltas,
    rootEvents: state.rootEvents.map(({ createdAt: _createdAt, ...event }) => event),
    frozenResults: state.frozenResults.map(({ frozenAt: _frozenAt, ...result }) => result),
    projectionInputs: state.projectionInputs,
    projections: state.projections,
    reactionWindow: state.reactionWindow,
    checkpoints: state.checkpoints,
    finaleInput: state.finaleInput,
    finaleResult: state.finaleResult,
    failure: state.failure ? { ...state.failure, failedAt: null } : null,
  });
}
