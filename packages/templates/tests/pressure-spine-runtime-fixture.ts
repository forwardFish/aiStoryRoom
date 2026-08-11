import { resolve } from "node:path";
import {
  confirmPressureActionIntent,
  initializePressureRuntime,
  loadPressureRuntimeContent,
  pressureHash,
  projectP0ToN1,
  validatePressureActionIntent,
  type PressureActionIntentCommandV1,
  type PressureActionSlot,
  type PressureActionType,
  type PressureRuntimeContent,
  type PressureRuntimeState,
  type PressureVisibility,
} from "../src/pressure-spine/runtime/index";

const registryPath = resolve(process.cwd(), "packages/templates/config/sangtian/strategy-registry.json");

export function acceptedRuntimeContent(): PressureRuntimeContent {
  return loadPressureRuntimeContent(registryPath, "sangtian_pressure_v1_0");
}

export function initializedAtN1(
  content = acceptedRuntimeContent(),
  input: { runId?: string; runSeed?: string; nowEpochMs?: number; deadlineEpochMs?: number } = {},
): PressureRuntimeState {
  const now = input.nowEpochMs ?? 1_000;
  const initialized = initializePressureRuntime(content, {
    runId: input.runId ?? "run.pressure.test",
    runSeed: input.runSeed ?? "seed.pressure.test",
    nowEpochMs: now,
  });
  return projectP0ToN1(content, initialized, now + 1, input.deadlineEpochMs ?? now + 600_000).state;
}

export function forceNodePhase(
  content: PressureRuntimeContent,
  source: PressureRuntimeState,
  nodeId: string,
  phase: PressureRuntimeState["phase"],
  deadlineEpochMs = 9_000_000,
): PressureRuntimeState {
  const state = structuredClone(source);
  state.nodeId = nodeId;
  state.nodeSequence = content.nodes[nodeId].sequence;
  state.phase = phase;
  state.resumePhase = null;
  state.failure = null;
  state.version += 1;
  state.phaseSnapshotVersion = state.version;
  state.phaseDeadlineEpochMs = deadlineEpochMs;
  state.selectorState = structuredClone(content.nodes[nodeId].defaultInputState);
  state.prepareRulesInputHash = null;
  state.commitRulesInputHash = null;
  state.commitSnapshotHash = null;
  state.reactionWindow = null;
  state.resourceReservations = {};
  state.actionIdBySeatSlot = {};
  state.sealedActions = {};
  state.idempotencyResults = {};
  for (const seatEntry of content.nodes[nodeId].seats) {
    const seat = state.seats[seatEntry.seatId];
    if (!seat) continue;
    seat.currentActorId = seatEntry.currentActorId;
    seat.roleKey = seatEntry.roleKey;
    seat.permissions = [...seatEntry.permissions].sort();
    seat.reactionUsedAtNodeId = null;
    seat.initiativeLost = false;
  }
  state.inputSnapshotHash = pressureHash({
    packageSha256: state.packageSha256,
    runSeed: state.runSeed,
    nodeId,
    phase,
    objects: state.objects,
    seats: state.seats,
    selectorState: state.selectorState,
  });
  return state;
}

export function makeObjectPublic(
  state: PressureRuntimeState,
  content: PressureRuntimeContent,
  objectId: string,
): void {
  const object = state.objects[objectId];
  if (!object) throw new Error(`Unknown object ${objectId}`);
  object.visibility = "PUBLIC";
  object.knownBySeatIds = [...content.seatIds];
  for (const seatId of content.seatIds) {
    state.seats[seatId].knownObjectVersionIds = [...new Set([...state.seats[seatId].knownObjectVersionIds, object.versionId])].sort();
  }
  state.inputSnapshotHash = pressureHash({
    packageSha256: state.packageSha256,
    runSeed: state.runSeed,
    nodeId: state.nodeId,
    phase: state.phase,
    objects: state.objects,
    seats: state.seats,
    selectorState: state.selectorState,
  });
}

export function actionIntent(
  state: PressureRuntimeState,
  content: PressureRuntimeContent,
  input: {
    seatId?: string;
    slot?: PressureActionSlot;
    type?: PressureActionType;
    intentText?: string;
    targetObjectId?: string | null;
    expectedObjectVersionId?: string | null;
    targetSeatId?: string | null;
    destinationId?: string | null;
    factIds?: string[];
    signatureId?: string | null;
    desiredDisposition?: "HOLD" | "TRANSFER" | "SEIZE" | "UPDATE" | "DESTROY" | null;
    resourceCommitments?: Array<{ resourceId: string; amount: number }>;
    idempotencyKey?: string;
    submittedAtEpochMs?: number;
    visibility?: PressureVisibility;
  } = {},
): PressureActionIntentCommandV1 {
  const seatId = input.seatId ?? content.seatIds[0];
  const seat = state.seats[seatId];
  const targetObject = input.targetObjectId ? state.objects[input.targetObjectId] : null;
  return {
    schemaVersion: "pressure_action_intent_v1",
    runId: state.runId,
    nodeId: state.nodeId,
    slot: input.slot ?? "PREPARE",
    seatId,
    currentActorId: seat.currentActorId,
    controlEpoch: seat.controlEpoch,
    type: input.type ?? "PLAN",
    intentText: input.intentText ?? `${input.type ?? "PLAN"}:${seatId}`,
    targetObjectId: input.targetObjectId ?? null,
    expectedObjectVersionId: input.expectedObjectVersionId ?? targetObject?.versionId ?? null,
    resourceCommitments: input.resourceCommitments ?? [],
    parameters: {
      targetSeatId: input.targetSeatId ?? null,
      destinationId: input.destinationId ?? null,
      factIds: input.factIds ?? [],
      signatureId: input.signatureId ?? null,
      desiredDisposition: input.desiredDisposition ?? null,
    },
    visibility: input.visibility ?? "PRIVATE",
    submittedAtEpochMs: input.submittedAtEpochMs ?? Math.min(state.phaseDeadlineEpochMs ?? 5_000, 5_000),
    expectedRunVersion: state.phaseSnapshotVersion,
    expectedSnapshotHash: state.inputSnapshotHash,
    idempotencyKey: input.idempotencyKey ?? `${state.runId}:${state.nodeId}:${seatId}:${input.slot ?? "PREPARE"}:${input.type ?? "PLAN"}`,
  };
}

export function previewAndConfirm(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  intent: PressureActionIntentCommandV1,
) {
  const preview = validatePressureActionIntent(content, state, intent);
  if (!preview.accepted) throw new Error(`${preview.errorCode}:${preview.safeMessage}`);
  return confirmPressureActionIntent(content, state, preview.normalizedIntent, preview.previewToken);
}

export function sealAllWith(
  content: PressureRuntimeContent,
  source: PressureRuntimeState,
  slot: PressureActionSlot,
  create: (state: PressureRuntimeState, seatId: string, index: number) => PressureActionIntentCommandV1 = (state, seatId, index) => actionIntent(state, content, {
    seatId,
    slot,
    type: "PLAN",
    idempotencyKey: `${state.runId}:${state.nodeId}:${slot}:${index}`,
  }),
): PressureRuntimeState {
  let state = source;
  for (const [index, seatId] of content.seatIds.entries()) {
    state = previewAndConfirm(content, state, create(state, seatId, index)).state;
  }
  return state;
}

export function rootEventCounts(state: PressureRuntimeState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of state.rootEvents) counts[event.type] = (counts[event.type] || 0) + 1;
  return counts;
}
