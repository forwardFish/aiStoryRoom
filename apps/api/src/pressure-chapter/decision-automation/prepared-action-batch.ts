import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  isSha256,
  sha256Canonical,
  validateRunRouteSnapshotV1,
  validateSeatIdV1,
} from "@ai-story/shared";
import type {
  FormalActionAcceptedPayloadV1,
  WorkingLedgerEventV1,
  WorkingLedgerProjectionV1,
} from "../working-ledger/contracts";
import {
  appendFormalActionEventsToWorkingLedgerProjection,
  buildWorkingLedgerEventsFromProjection,
} from "../working-ledger/working-ledger";
import type {
  AppendPreparedAutomationActionCommandV1,
  PreparedAutomationActionBatchV1,
} from "./contracts";

export function createPreparedAutomationActionBatchV1(input: Readonly<{
  batchId: string;
  snapshotHash: string;
  routeSnapshot: AppendPreparedAutomationActionCommandV1["command"]["routeSnapshot"];
  chapterRuntimeId: string;
  chapterId: PreparedAutomationActionBatchV1["chapterId"];
  decisionPointId: string;
  expectedOrchestratorRevision: number;
  expectedOrchestratorHash: string;
  expectedWorkingRevision: number;
  expectedWorkingStateHash: string;
  expectedLedgerHeadHash: string;
  expectedSeatAuthorityStateHash: string;
  actions: readonly AppendPreparedAutomationActionCommandV1[];
  chapterDescriptor: PreparedAutomationActionBatchV1["chapterDescriptor"];
  nextOrchestratorState: PreparedAutomationActionBatchV1["nextOrchestratorState"];
  beatPlan: PreparedAutomationActionBatchV1["beatPlan"];
}>): PreparedAutomationActionBatchV1 {
  const route = validateRunRouteSnapshotV1(input.routeSnapshot);
  const actions = canonicalizePreparedAutomationActionsV1(route, input.actions);
  if (!actions.length) throw new Error("Prepared automation batch cannot be empty");
  if (!input.batchId.trim() || !isSha256(input.snapshotHash)) {
    throw new Error("Prepared automation batch identity is invalid");
  }
  if (actions.some((item) => (
    item.command.routeSnapshot.routeHash !== route.routeHash
    || item.command.action.runId !== route.runId
    || item.command.action.chapterRuntimeId !== input.chapterRuntimeId
    || item.command.action.chapterId !== input.chapterId
    || item.command.action.decisionPointId !== input.decisionPointId
    || item.authority.snapshotHash !== input.snapshotHash
    || item.authority.expectedLedgerHeadHash !== input.expectedLedgerHeadHash
  ))) {
    throw new Error("Prepared automation batch authority binding is invalid");
  }
  const body = {
    schemaVersion: "pressure_prepared_automation_action_batch_v1" as const,
    batchId: input.batchId,
    snapshotHash: input.snapshotHash,
    runId: route.runId,
    routeHash: route.routeHash,
    chapterRuntimeId: input.chapterRuntimeId,
    chapterId: input.chapterId,
    decisionPointId: input.decisionPointId,
    expectedOrchestratorRevision: input.expectedOrchestratorRevision,
    expectedOrchestratorHash: input.expectedOrchestratorHash,
    expectedWorkingRevision: input.expectedWorkingRevision,
    expectedWorkingStateHash: input.expectedWorkingStateHash,
    expectedLedgerHeadHash: input.expectedLedgerHeadHash,
    expectedSeatAuthorityStateHash: input.expectedSeatAuthorityStateHash,
    frozenSeatOrder: route.seatIds.map((seatId, index) =>
      validateSeatIdV1(seatId, `routeSnapshot.seatIds[${index}]`)),
    actions,
    chapterDescriptor: structuredClone(input.chapterDescriptor),
    nextOrchestratorState: structuredClone(input.nextOrchestratorState),
    beatPlan: structuredClone(input.beatPlan),
  };
  return {
    ...body,
    batchHash: computePreparedAutomationActionBatchHashV1(body),
  };
}

/** Freezes every batch planner and writer to the route's canonical seat order. */
export function canonicalizePreparedAutomationActionsV1(
  routeSnapshot: AppendPreparedAutomationActionCommandV1["command"]["routeSnapshot"],
  actions: readonly AppendPreparedAutomationActionCommandV1[],
): AppendPreparedAutomationActionCommandV1[] {
  const route = validateRunRouteSnapshotV1(routeSnapshot);
  const seatOrder = new Map(route.seatIds.map((seatId, index) => [seatId, index]));
  return [...actions]
    .map((item) => structuredClone(item))
    .sort((left, right) => (
      requireSeatOrder(seatOrder, left.command.action.seatId)
      - requireSeatOrder(seatOrder, right.command.action.seatId)
    ));
}

export function computePreparedAutomationActionBatchHashV1(
  batch: Omit<PreparedAutomationActionBatchV1, "batchHash">,
): string {
  return sha256Canonical({
    ...batch,
    actions: batch.actions.map((item) => ({
      command: item.command,
      authority: item.authority,
    })),
  });
}

export interface PreparedActionLedgerPlanV1 {
  payloads: FormalActionAcceptedPayloadV1[];
  events: WorkingLedgerEventV1[];
  projection: WorkingLedgerProjectionV1;
}

/** Pure W5 action-event plan over one already validated authority projection. */
export function planPreparedActionLedgerV1(input: Readonly<{
  projection: WorkingLedgerProjectionV1;
  actions: readonly AppendPreparedAutomationActionCommandV1[];
}>): PreparedActionLedgerPlanV1 {
  if (!input.actions.length) throw new Error("Prepared action ledger plan cannot be empty");
  const payloads = input.actions.map(({ command }) => ({
    eventType: "FORMAL_ACTION_ACCEPTED" as const,
    routeHash: command.routeSnapshot.routeHash,
    inputFingerprint: command.inputFingerprint,
    action: structuredClone(command.action),
    intent: structuredClone(command.intent),
    audienceSeatIds: formalActionAudience(command.action.seatId, command.intent),
  }));
  const events = buildWorkingLedgerEventsFromProjection({
    projection: input.projection,
    payloads,
  });
  return {
    payloads,
    events,
    projection: appendFormalActionEventsToWorkingLedgerProjection(input.projection, events),
  };
}

function formalActionAudience(
  actorSeatId: AppendPreparedAutomationActionCommandV1["command"]["action"]["seatId"],
  intent: AppendPreparedAutomationActionCommandV1["command"]["intent"],
) {
  if (intent.visibility === "PUBLIC") return [...PRESSURE_CHAPTER_SEAT_IDS_V1];
  if (intent.visibility === "PRIVATE") return [actorSeatId];
  const participants = [
    actorSeatId,
    ...intent.targetSeatIds,
    ...intent.commitmentMutations.flatMap((item) => item.seatIds),
    ...intent.knowledgeGrants.map((item) => item.seatId),
  ];
  return PRESSURE_CHAPTER_SEAT_IDS_V1.filter((seatId) => participants.includes(seatId));
}

function requireSeatOrder(order: ReadonlyMap<string, number>, seatId: string): number {
  const index = order.get(seatId);
  if (index === undefined) throw new Error(`Prepared automation seat is not in frozen route: ${seatId}`);
  return index;
}
