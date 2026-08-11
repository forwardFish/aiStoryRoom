import { PressureKernelError } from "./errors";
import { pressureHash, sortedUnique, stableId } from "./canonical";
import type {
  PressureActionIntentCommandV1,
  PressureActionSlot,
  PressureActionType,
  PressureContentInputFallback,
  PressureRuntimeContent,
  PressureRuntimeState,
  PressureVisibility,
} from "./types";
import {
  PRESSURE_ACTION_SLOTS,
  PRESSURE_ACTION_TYPES,
  PRESSURE_WORLD_ACTION_TYPES,
} from "./types";
import type {
  PressureActionEffect,
  PressureAuthorityGrant,
  PressureCompiledActionCommand,
  PressureCompiledActionPreview,
  PressureObjectMutationIntent,
} from "./internal-types";

const ACTION_SET = new Set<string>(PRESSURE_ACTION_TYPES);
const SLOT_SET = new Set<string>(PRESSURE_ACTION_SLOTS);
const WORLD_ACTION_SET = new Set<string>(PRESSURE_WORLD_ACTION_TYPES);
const VISIBILITY_SET = new Set<PressureVisibility>(["PUBLIC", "OBSERVABLE", "LIMITED", "PRIVATE", "PRIVATE_SYSTEM"]);
const INTENT_KEYS = new Set([
  "schemaVersion", "runId", "nodeId", "slot", "seatId", "currentActorId", "controlEpoch", "type",
  "intentText", "targetObjectId", "expectedObjectVersionId", "resourceCommitments", "parameters",
  "visibility", "submittedAtEpochMs", "expectedRunVersion", "expectedSnapshotHash", "idempotencyKey",
]);
const PARAMETER_KEYS = new Set([
  "targetSeatId", "destinationId", "factIds", "signatureId", "disclosureVisibility",
  "desiredDisposition",
]);

export type CompilePressureIntentOptions = {
  isDefault?: boolean;
  defaultPolicyId?: string | null;
  policyVersion?: string | null;
  intentClass?: "FAILED_OUTCOME_CLAIM" | "FAILED_AUTHORITY_CLAIM" | null;
};

function assertPlainRecord(value: unknown, code: "ACTION_SCHEMA_INVALID", label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PressureKernelError(code, `${label} must be an object`);
  }
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: Set<string>, label: string): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key)).sort();
  if (unexpected.length) {
    throw new PressureKernelError("ACTION_SCHEMA_INVALID", `${label} contains forbidden fields: ${unexpected.join(",")}`);
  }
}

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().replace(/\s+/gu, " ").slice(0, max);
}

function optionalText(value: unknown, max: number): string | null {
  const normalized = text(value, max);
  return normalized || null;
}

function integer(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new PressureKernelError("ACTION_SCHEMA_INVALID", `${label} must be a non-negative safe integer`);
  }
  return normalized;
}

function fallbackFor(content: PressureRuntimeContent, nodeId: string, classes: string[]): PressureContentInputFallback | null {
  const node = content.nodes[nodeId];
  if (!node) return null;
  const normalizedClasses = classes.map((entry) => entry.toUpperCase());
  for (const entry of node.inputFallbacks) {
    const inputClass = entry.inputClass.toUpperCase();
    if (normalizedClasses.some((candidate) => inputClass.includes(candidate))) return entry;
  }
  return null;
}

function normalizeResources(value: unknown): Array<{ resourceId: string; amount: number }> {
  if (!Array.isArray(value)) throw new PressureKernelError("ACTION_SCHEMA_INVALID", "resourceCommitments must be an array");
  const totals = new Map<string, number>();
  for (const [index, item] of value.entries()) {
    assertPlainRecord(item, "ACTION_SCHEMA_INVALID", `resourceCommitments[${index}]`);
    assertOnlyKeys(item, new Set(["resourceId", "amount"]), `resourceCommitments[${index}]`);
    const resourceId = text(item.resourceId, 180);
    const amount = Number(item.amount);
    if (!resourceId || !Number.isSafeInteger(amount) || amount <= 0) {
      throw new PressureKernelError("ACTION_SCHEMA_INVALID", `resourceCommitments[${index}] is invalid`);
    }
    totals.set(resourceId, (totals.get(resourceId) || 0) + amount);
  }
  return [...totals.entries()].map(([resourceId, amount]) => ({ resourceId, amount })).sort((a, b) => a.resourceId.localeCompare(b.resourceId));
}

export function canonicalizePressureActionIntent(raw: unknown): PressureActionIntentCommandV1 {
  assertPlainRecord(raw, "ACTION_SCHEMA_INVALID", "action intent");
  assertOnlyKeys(raw, INTENT_KEYS, "action intent");
  if (raw.schemaVersion !== "pressure_action_intent_v1") {
    throw new PressureKernelError("ACTION_SCHEMA_INVALID", "schemaVersion must be pressure_action_intent_v1");
  }
  const slot = String(raw.slot || "").toUpperCase();
  if (!SLOT_SET.has(slot)) throw new PressureKernelError("ACTION_SLOT_INVALID", `Unsupported slot ${slot}`);
  const type = String(raw.type || "").toUpperCase();
  if (!ACTION_SET.has(type)) throw new PressureKernelError("ACTION_TYPE_INVALID", `Unsupported action type ${type}`);
  const visibility = String(raw.visibility || "").toUpperCase() as PressureVisibility;
  if (!VISIBILITY_SET.has(visibility)) throw new PressureKernelError("ACTION_SCHEMA_INVALID", `Unsupported visibility ${visibility}`);
  const parametersValue = raw.parameters ?? {};
  assertPlainRecord(parametersValue, "ACTION_SCHEMA_INVALID", "parameters");
  assertOnlyKeys(parametersValue, PARAMETER_KEYS, "parameters");
  const desired = optionalText(parametersValue.desiredDisposition, 32)?.toUpperCase() || null;
  if (desired && !["HOLD", "TRANSFER", "SEIZE", "UPDATE", "DESTROY"].includes(desired)) {
    throw new PressureKernelError("ACTION_OPERATION_INVALID", `Unsupported desiredDisposition ${desired}`);
  }
  const disclosure = optionalText(parametersValue.disclosureVisibility, 32)?.toUpperCase() as PressureVisibility | null;
  if (disclosure && !VISIBILITY_SET.has(disclosure)) {
    throw new PressureKernelError("ACTION_SCHEMA_INVALID", `Unsupported disclosureVisibility ${disclosure}`);
  }
  const factIds = Array.isArray(parametersValue.factIds)
    ? sortedUnique(parametersValue.factIds.map((value) => text(value, 200)))
    : [];
  const normalized: PressureActionIntentCommandV1 = {
    schemaVersion: "pressure_action_intent_v1",
    runId: text(raw.runId, 200),
    nodeId: text(raw.nodeId, 80),
    slot: slot as PressureActionSlot,
    seatId: text(raw.seatId, 160),
    currentActorId: text(raw.currentActorId, 160),
    controlEpoch: integer(raw.controlEpoch, "controlEpoch"),
    type: type as PressureActionType,
    intentText: text(raw.intentText, 1200),
    targetObjectId: optionalText(raw.targetObjectId, 220),
    expectedObjectVersionId: optionalText(raw.expectedObjectVersionId, 260),
    resourceCommitments: normalizeResources(raw.resourceCommitments),
    parameters: {
      targetSeatId: optionalText(parametersValue.targetSeatId, 160),
      destinationId: optionalText(parametersValue.destinationId, 220),
      factIds,
      signatureId: optionalText(parametersValue.signatureId, 220),
      disclosureVisibility: disclosure || undefined,
      desiredDisposition: desired as NonNullable<PressureActionIntentCommandV1["parameters"]>["desiredDisposition"],
    },
    visibility,
    submittedAtEpochMs: integer(raw.submittedAtEpochMs, "submittedAtEpochMs"),
    expectedRunVersion: integer(raw.expectedRunVersion, "expectedRunVersion"),
    expectedSnapshotHash: text(raw.expectedSnapshotHash, 128),
    idempotencyKey: text(raw.idempotencyKey, 240),
  };
  if (!normalized.runId || !normalized.nodeId || !normalized.seatId || !normalized.currentActorId || !normalized.intentText || !normalized.expectedSnapshotHash || !normalized.idempotencyKey) {
    throw new PressureKernelError("ACTION_SCHEMA_INVALID", "Required action intent fields are empty");
  }
  return normalized;
}

export function fingerprintPressureActionIntent(intent: PressureActionIntentCommandV1): string {
  return pressureHash(canonicalizePressureActionIntent(intent));
}

function phaseForSlot(slot: PressureActionSlot): PressureRuntimeState["phase"] {
  if (slot === "PREPARE") return "PREPARE_OPEN";
  if (slot === "COMMIT") return "COMMIT_OPEN";
  return "REACTION_OPEN";
}

function stableSelectorKey(content: PressureRuntimeContent, state: PressureRuntimeState, intent: PressureActionIntentCommandV1): string | null {
  const node = content.nodes[state.nodeId];
  const keys = [...node.selectorInputKeys].sort();
  if (!keys.length || !WORLD_ACTION_SET.has(intent.type)) return null;
  const byType = {
    ALLOCATE: "number",
    SIGN: "boolean",
    TRANSFER: "string",
    SEIZE: "number",
    DISCLOSE: "boolean",
    DISPATCH: "string",
  } as const;
  const preferred = keys.filter((key) => typeof node.defaultInputState[key] === byType[intent.type as keyof typeof byType]);
  const candidates = preferred.length ? preferred : keys;
  const index = Number.parseInt(pressureHash([intent.type, intent.seatId, intent.targetObjectId || ""]).slice(0, 8), 16) % candidates.length;
  return candidates[index] || null;
}

function authorityFor(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  intent: PressureActionIntentCommandV1,
  operation: PressureObjectMutationIntent["operation"] | null,
): PressureAuthorityGrant[] {
  const seat = state.seats[intent.seatId];
  const node = content.nodes[state.nodeId];
  const object = intent.targetObjectId ? state.objects[intent.targetObjectId] : null;
  const targetObjectIds = sortedUnique([
    ...node.contestedObjectIds,
    ...node.secondaryObjectIds,
    ...(node.seats.find((entry) => entry.seatId === intent.seatId)?.keyLeverageObjectIds || []),
    ...Object.values(state.objects).filter((candidate) => candidate.custodySeatId === intent.seatId).map((candidate) => candidate.objectId),
  ]);
  const grants: PressureAuthorityGrant[] = [];
  if (object?.custodySeatId === intent.seatId && object.status !== "DESTROYED") {
    grants.push({
      sourceId: object.versionId,
      sourceKind: "CUSTODY",
      allowedActionTypes: ["TRANSFER", "SIGN", "DISPATCH", "DISCLOSE", "SEIZE"],
      allowedOperations: ["HOLD", "TRANSFER", "UPDATE", "DESTROY"],
      targetObjectIds: [object.objectId],
      targetObjectKinds: [object.kind],
    });
  }
  for (const permission of seat.permissions) {
    grants.push({
      sourceId: permission,
      sourceKind: "PERMISSION",
      allowedActionTypes: [...PRESSURE_ACTION_TYPES],
      allowedOperations: operation ? [operation, "HOLD", "UPDATE", "SEIZE", "TRANSFER"] : ["HOLD", "UPDATE"],
      targetObjectIds,
      targetObjectKinds: object ? [object.kind] : [],
    });
  }
  return grants.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

function compileEffect(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  intent: PressureActionIntentCommandV1,
  options: CompilePressureIntentOptions,
): { effect: PressureActionEffect; operation: PressureObjectMutationIntent["operation"] | null; ruleIds: string[] } {
  const node = content.nodes[state.nodeId];
  const params = intent.parameters || {};
  const selectorKey = stableSelectorKey(content, state, intent);
  const totalCommitted = intent.resourceCommitments.reduce((sum, item) => sum + item.amount, 0);
  const effect: PressureActionEffect = {};
  const ruleIds = [`content:${content.strategyVersion}`, `node:${state.nodeId}`, `seat:${intent.seatId}`, `type:${intent.type}`];
  let operation: PressureObjectMutationIntent["operation"] | null = null;

  if (intent.slot === "PREPARE" && options.intentClass?.startsWith("FAILED_")) {
    const fallback = fallbackFor(content, state.nodeId, ["FABRICATED", "OVERREACH", "FAILED"]);
    effect.timeDeltaMinutes = Math.max(60, fallback?.timeDeltaMinutes || 180);
    effect.pressureDelta = Math.max(1, fallback?.pressureDelta || 1);
    effect.initiativeLost = true;
    effect.attemptOutcome = "FAILED";
    effect.attemptReasonCode = options.intentClass === "FAILED_AUTHORITY_CLAIM" ? "ROLE_FORBIDDEN" : "OUTCOME_OWNERSHIP";
  }

  if (intent.slot === "PREPARE") {
    const fallback = intent.type === "REST"
      ? fallbackFor(content, state.nodeId, ["REST", "SLEEP"])
      : intent.type === "DELAY" || intent.type === "PASS"
        ? fallbackFor(content, state.nodeId, ["SILENCE", "IDLE", "CHAT", "DELAY", "TIMEOUT"])
        : null;
    effect.timeDeltaMinutes = Math.max(0, fallback?.timeDeltaMinutes ?? (intent.type === "REST" ? 360 : intent.type === "DELAY" || intent.type === "PASS" ? 180 : 60));
    effect.pressureDelta = Math.max(0, fallback?.pressureDelta ?? (intent.type === "REST" || intent.type === "DELAY" || intent.type === "PASS" ? 1 : 0));
    effect.energyDelta = intent.type === "REST" ? 1 : 0;
    effect.initiativeLost = ["REST", "DELAY", "PASS"].includes(intent.type);
  }

  if (options.isDefault) {
    effect.authoredPolicyRef = options.defaultPolicyId || null;
    if (selectorKey) effect.selectorContributions = [{ key: selectorKey, operation: "ADD", value: 0 }];
    return { effect, operation: null, ruleIds: [...ruleIds, `default:${effect.authoredPolicyRef || "unknown"}`] };
  }

  if (selectorKey) {
    const value = Math.max(1, totalCommitted || 1);
    effect.selectorContributions = [{
      key: selectorKey,
      operation: intent.type === "SIGN" ? "SET_TRUE" : "ADD",
      value: intent.type === "SIGN" ? true : value,
    }];
    ruleIds.push(`selector:${selectorKey}`);
  }

  const targetObject = intent.targetObjectId ? state.objects[intent.targetObjectId] : null;
  if (intent.type === "TRANSFER") operation = "TRANSFER";
  else if (intent.type === "SEIZE") operation = params.desiredDisposition === "DESTROY" ? "DESTROY" : "SEIZE";
  else if (intent.type === "DISPATCH" || (intent.type === "SIGN" && targetObject)) operation = "UPDATE";

  if (operation && targetObject) {
    const mutation: PressureObjectMutationIntent = {
      objectId: targetObject.objectId,
      expectedVersionId: intent.expectedObjectVersionId || "",
      operation,
    };
    if (operation === "TRANSFER") {
      mutation.toSeatId = params.targetSeatId || null;
      mutation.toActorId = params.targetSeatId ? state.seats[params.targetSeatId]?.currentActorId || null : null;
    } else if (operation === "SEIZE") {
      mutation.toSeatId = intent.seatId;
      mutation.toActorId = intent.currentActorId;
    } else if (intent.type === "DISPATCH") {
      mutation.routes = params.destinationId ? [params.destinationId] : [];
    } else if (intent.type === "SIGN") {
      mutation.signatures = [params.signatureId || stableId("signature", state.runId, intent.idempotencyKey)];
    }
    effect.objectMutations = [mutation];
  }

  if (intent.type === "DISCLOSE") {
    const targetSeatIds = params.targetSeatId ? [params.targetSeatId] : content.seatIds;
    effect.knowledgeGrants = (params.factIds || []).map((factId) => ({
      factId,
      seatIds: sortedUnique(targetSeatIds),
      provenance: "TRANSFERRED" as const,
    }));
  }
  if (intent.type === "SIGN") {
    effect.responsibilityEntries = [{
      responsibilityId: stableId("responsibility", state.runId, state.nodeId, intent.seatId, intent.idempotencyKey),
      seatId: intent.seatId,
      kind: "SIGNED",
      weight: 1,
    }];
  }
  if (intent.slot === "COMMIT" && node.reaction && WORLD_ACTION_SET.has(intent.type)) {
    effect.reactionSignal = { triggered: true, evidenceIds: sortedUnique(intent.parameters?.factIds || []) };
  }
  if (intent.slot === "REACTION") {
    effect.reseal = Boolean(params.signatureId && node.reaction);
  }
  return { effect, operation, ruleIds };
}

export function compilePressureActionIntent(
  content: PressureRuntimeContent,
  state: PressureRuntimeState,
  rawIntent: unknown,
  options: CompilePressureIntentOptions = {},
): PressureCompiledActionCommand {
  const intent = canonicalizePressureActionIntent(rawIntent);
  if (intent.runId !== state.runId || intent.nodeId !== state.nodeId) {
    throw new PressureKernelError("NODE_PHASE_MISMATCH", "Intent does not target the current run/node");
  }
  if (state.phase !== phaseForSlot(intent.slot)) {
    throw new PressureKernelError("ACTION_WINDOW_CLOSED", `${intent.slot} is not open`);
  }
  const payloadHash = fingerprintPressureActionIntent(intent);
  const actionId = stableId("pressure-action", state.runId, intent.idempotencyKey);
  const { effect, operation, ruleIds } = compileEffect(content, state, intent, options);
  const command: PressureCompiledActionCommand = {
    schemaVersion: "pressure_compiled_action_v1",
    actionId,
    runId: intent.runId,
    nodeId: intent.nodeId,
    slot: intent.slot,
    seatId: intent.seatId,
    currentActorId: intent.currentActorId,
    controlEpoch: intent.controlEpoch,
    type: intent.type,
    intentText: intent.intentText,
    targetObjectId: intent.targetObjectId || null,
    expectedObjectVersionId: intent.expectedObjectVersionId || null,
    targetSeatId: intent.parameters?.targetSeatId || null,
    resourceCosts: intent.resourceCommitments,
    visibility: intent.visibility,
    submittedAtEpochMs: intent.submittedAtEpochMs,
    deadlineEpochMs: state.phaseDeadlineEpochMs ?? intent.submittedAtEpochMs,
    expectedRunVersion: intent.expectedRunVersion,
    expectedSnapshotHash: intent.expectedSnapshotHash,
    idempotencyKey: intent.idempotencyKey,
    requestFingerprint: payloadHash,
    policyVersion: options.policyVersion || null,
    effect,
    authorityGrants: authorityFor(content, state, intent, operation),
    knowledgeFactIds: sortedUnique(intent.parameters?.factIds || []),
    compiledRuleIds: ruleIds,
    isDefault: options.isDefault,
    defaultPolicyId: options.defaultPolicyId || null,
    sourceIntent: intent,
  };
  return command;
}

export function buildPressureActionPreview(
  state: PressureRuntimeState,
  compiled: PressureCompiledActionCommand,
  accepted: boolean,
  errorCode: PressureCompiledActionPreview["errorCode"] = null,
  safeMessage = "Action intent is valid for preview.",
): PressureCompiledActionPreview {
  const previewToken = pressureHash({
    runId: state.runId,
    nodeId: state.nodeId,
    phase: state.phase,
    phaseSnapshotVersion: state.phaseSnapshotVersion,
    inputSnapshotHash: state.inputSnapshotHash,
    payloadHash: compiled.requestFingerprint,
    compiledHash: pressureHash({ ...compiled, previewToken: undefined }),
  });
  return {
    accepted,
    errorCode,
    safeMessage,
    actionFingerprint: compiled.requestFingerprint,
    previewToken,
    normalizedIntent: compiled.sourceIntent,
    compiled: { ...compiled, previewToken },
  };
}
