import { pressureHash } from "./canonical";
import type { PressureContentNode, PressureRuntimeObjectState, PressureRuntimeState, PressureSealedAction } from "./types";

const SLOT_ORDER: Record<string, number> = { PREPARE: 0, COMMIT: 1, REACTION: 2 };

type ConflictDimension = "OPENING_CUSTODY" | "AUTHORITY" | "RESOURCE" | "PREPARE_CONTROL" | "STABLE_TIE_BREAK";

export function stableActionOrder(actions: PressureSealedAction[]): PressureSealedAction[] {
  return [...actions].sort((left, right) => {
    const slot = (SLOT_ORDER[left.command.slot] ?? 99) - (SLOT_ORDER[right.command.slot] ?? 99);
    if (slot) return slot;
    const seat = left.command.seatId.localeCompare(right.command.seatId);
    if (seat) return seat;
    return left.command.actionId.localeCompare(right.command.actionId);
  });
}

function normalizeDimension(value: string, index: number, total: number): ConflictDimension {
  const text = String(value || "").toUpperCase();
  if (/HASH|TIE|DETERMIN|破同分|确定性/u.test(text) || index === total - 1) return "STABLE_TIE_BREAK";
  if (/CUSTODY|OWNER|POSSESSION|保管|所有权|开始.*持有|开始.*控制/u.test(text)) return "OPENING_CUSTODY";
  if (/AUTHORITY|PERMISSION|COMMAND|JURISDICTION|SIGNATURE|SEAL|权限|指挥|管辖|签押|印信|封印|合法/u.test(text)) return "AUTHORITY";
  if (/RESOURCE|MATERIAL|FORCE|CONSIDERATION|TIME|投入|资源|兵力|物资|对价|到达时间/u.test(text)) return "RESOURCE";
  if (/PREPARE|PREPARATION|REGISTRATION|PUBLICATION|PROMISE|准备|登记|公示|承诺/u.test(text)) return "PREPARE_CONTROL";
  return (["OPENING_CUSTODY", "AUTHORITY", "RESOURCE", "PREPARE_CONTROL"] as ConflictDimension[])[Math.min(index, 3)]!;
}

function authorityScore(action: PressureSealedAction, object: PressureRuntimeObjectState): number {
  return action.command.authorityGrants.filter((grant) =>
    grant.allowedActionTypes.includes(action.command.type)
    && (grant.targetObjectIds.length === 0 || grant.targetObjectIds.includes(object.objectId))
    && (grant.targetObjectKinds.length === 0 || grant.targetObjectKinds.includes(object.kind)),
  ).length;
}

function resourceScore(action: PressureSealedAction): number {
  return action.command.resourceCosts.reduce((total, item) => total + item.amount, 0);
}

function prepareControlScore(state: PressureRuntimeState, action: PressureSealedAction): number {
  return action.command.slot !== "PREPARE"
    && Boolean(state.actionIdBySeatSlot[`${state.nodeId}:${action.command.seatId}:PREPARE`]) ? 1 : 0;
}

function dimensionValue(
  dimension: ConflictDimension,
  state: PressureRuntimeState,
  node: PressureContentNode,
  object: PressureRuntimeObjectState,
  action: PressureSealedAction,
): number | string {
  switch (dimension) {
    case "OPENING_CUSTODY": return object.custodySeatId === action.command.seatId ? 1 : 0;
    case "AUTHORITY": return authorityScore(action, object);
    case "RESOURCE": return resourceScore(action);
    case "PREPARE_CONTROL": return prepareControlScore(state, action);
    case "STABLE_TIE_BREAK": return pressureHash([state.runSeed, node.nodeId, object.objectId, action.command.seatId]);
    default: {
      const exhaustive: never = dimension;
      return exhaustive;
    }
  }
}

/**
 * The accepted content owns the ordered comparator dimensions. The runtime
 * maps those authored dimensions to generic server-derived values. Clients
 * never submit a priority vector or a winning score.
 */
export function conflictVector(
  node: PressureContentNode,
  state: PressureRuntimeState,
  object: PressureRuntimeObjectState,
  action: PressureSealedAction,
): Array<number | string> {
  const authored = node.conflictPriorityOrder.length
    ? node.conflictPriorityOrder
    : ["OPENING_CUSTODY", "AUTHORITY", "RESOURCE", "PREPARE_CONTROL", "STABLE_TIE_BREAK"];
  return authored.map((value, index) => dimensionValue(normalizeDimension(value, index, authored.length), state, node, object, action));
}

function compareVectorDescending(left: Array<number | string>, right: Array<number | string>): number {
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l === r) continue;
    if (typeof l === "string" || typeof r === "string") return String(l).localeCompare(String(r));
    return Number(r) - Number(l);
  }
  return 0;
}

export function compareConflictActions(
  node: PressureContentNode,
  state: PressureRuntimeState,
  object: PressureRuntimeObjectState,
  left: PressureSealedAction,
  right: PressureSealedAction,
): number {
  const compared = compareVectorDescending(
    conflictVector(node, state, object, left),
    conflictVector(node, state, object, right),
  );
  return compared || left.command.actionId.localeCompare(right.command.actionId);
}

export function objectConflictCandidates(actions: PressureSealedAction[]): Map<string, PressureSealedAction[]> {
  const byObject = new Map<string, PressureSealedAction[]>();
  for (const action of actions) {
    const objectIds = new Set<string>();
    if (action.command.targetObjectId) objectIds.add(action.command.targetObjectId);
    for (const mutation of action.command.effect.objectMutations || []) objectIds.add(mutation.objectId);
    for (const objectId of objectIds) {
      const current = byObject.get(objectId) || [];
      current.push(action);
      byObject.set(objectId, current);
    }
  }
  return byObject;
}

export function resolveObjectConflictWinners(
  node: PressureContentNode,
  state: PressureRuntimeState,
  actions: PressureSealedAction[],
): Map<string, PressureSealedAction> {
  const winners = new Map<string, PressureSealedAction>();
  for (const [objectId, candidates] of objectConflictCandidates(actions)) {
    const object = state.objects[objectId];
    if (!object) continue;
    const ordered = [...candidates].sort((left, right) => compareConflictActions(node, state, object, left, right));
    if (ordered[0]) winners.set(objectId, ordered[0]);
  }
  return winners;
}
