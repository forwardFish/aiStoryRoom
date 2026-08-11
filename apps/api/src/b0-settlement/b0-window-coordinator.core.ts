import type {
  B0ActionContractV1,
  B0RoomRulesetV1,
  B0SettlementBatchV1,
  B0SettlementSnapshotV1,
  B0SettlementWindowV1,
} from "@ai-story/shared";
import {
  validateB0ActionContractV1,
  validateB0RoomRulesetV1,
  validateB0SettlementWindowV1,
} from "@ai-story/shared";
import {
  captureB0SettlementSnapshotV1,
  hashCanonicalB0Value,
  hashB0RoomRulesetV1,
  prepareB0SettlementBatchV1,
} from "@ai-story/templates";

export type B0WindowRoleBindingV1 = {
  actorId: string;
  roleId: string;
  controlEpoch: number;
  controlMode: "HUMAN_ACTIVE" | "AI_ACTIVE";
};

export type B0WindowConfigV1 = {
  schemaVersion: "b0-window-config-v1";
  situationId: string;
  ruleset: B0RoomRulesetV1;
  rulesetHash: string;
  expectedActorIds: string[];
  roleBindings: B0WindowRoleBindingV1[];
  createdAt: string;
};

export type B0StoredIntentEnvelopeV1 = {
  schemaVersion: "b0-intent-revision-envelope-v1";
  windowId: string;
  roomId: string;
  runId: string;
  actorId: string;
  latestRevision: number;
  latestDraft: B0ActionContractV1 | null;
  lastConfirmed: B0ActionContractV1 | null;
  lockedIntent: B0ActionContractV1 | null;
  latestRequestHash: string | null;
};

export type SaveB0DraftInputV1 = {
  window: B0SettlementWindowV1;
  config: B0WindowConfigV1;
  current: B0StoredIntentEnvelopeV1 | null;
  candidate: B0ActionContractV1;
  expectedRevision: number;
  now: string;
};

export type ConfirmB0DraftInputV1 = {
  window: B0SettlementWindowV1;
  config: B0WindowConfigV1;
  current: B0StoredIntentEnvelopeV1;
  expectedRevision: number;
  now: string;
};

export type B0ParticipantReadyStateV1 = {
  actorId: string;
  ready: boolean;
  version: number;
};

export type B0WindowWorldCaptureV1 = {
  worldState: unknown;
  actorStates: unknown[];
  roleBindings: unknown[];
  knowledgeState: unknown;
  relationshipState: unknown;
  resourceState: unknown;
  activeCapabilities: unknown[];
  dueSystemIntents?: unknown[];
};

export type B0FreezeEnvelopeV1 = {
  schemaVersion: "b0-freeze-envelope-v1";
  window: B0SettlementWindowV1;
  config: B0WindowConfigV1;
  lockReason: "ALL_READY" | "DEADLINE" | "IMMEDIATE";
  lockedAt: string;
  snapshot: B0SettlementSnapshotV1;
  batch: B0SettlementBatchV1;
  lockedIntents: B0ActionContractV1[];
};

export type B0WindowProjectionV1 = {
  schemaVersion: "b0-window-projection-v1";
  window: B0SettlementWindowV1;
  actorId: string;
  actorReady: boolean;
  readyCount: number;
  expectedCount: number;
  latestDraft: B0ActionContractV1 | null;
  lastConfirmed: B0ActionContractV1 | null;
  lockedIntent: B0ActionContractV1 | null;
  batch: Pick<B0SettlementBatchV1, "id" | "status" | "inputHash"> | null;
};

export type B0WindowStoreRecordV1 = {
  window: B0SettlementWindowV1;
  storageVersion: number;
  config: B0WindowConfigV1;
  participants: B0ParticipantReadyStateV1[];
};

export interface B0WindowFreezeStoreV1 {
  readWindow(windowId: string): Promise<B0WindowStoreRecordV1 | null>;
  claimOpenWindow(input: {
    windowId: string;
    expectedVersion: number;
    lockReason: "ALL_READY" | "DEADLINE" | "IMMEDIATE";
    lockedAt: string;
  }): Promise<boolean>;
  readIntentEnvelope(windowId: string, actorId: string): Promise<B0StoredIntentEnvelopeV1 | null>;
  captureWorld(windowId: string): Promise<B0WindowWorldCaptureV1>;
  persistLockedIntent(input: {
    windowId: string;
    actorId: string;
    envelope: B0StoredIntentEnvelopeV1;
    intent: B0ActionContractV1;
  }): Promise<void>;
  persistFreeze(envelope: B0FreezeEnvelopeV1): Promise<void>;
  readFreeze(windowId: string): Promise<B0FreezeEnvelopeV1 | null>;
}

export type FreezeB0WindowResultV1 = {
  status: "FROZEN" | "ALREADY_FROZEN" | "NOT_ELIGIBLE";
  envelope: B0FreezeEnvelopeV1 | null;
};

export class B0WindowCoordinatorErrorV1 extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "B0WindowCoordinatorErrorV1";
  }
}

export function createB0WindowConfigV1(input: {
  situationId: string;
  ruleset: B0RoomRulesetV1;
  expectedActorIds: string[];
  roleBindings: B0WindowRoleBindingV1[];
  createdAt: string;
}): Readonly<B0WindowConfigV1> {
  const rulesetValidation = validateB0RoomRulesetV1(input.ruleset);
  if (!rulesetValidation.ok) throw new B0WindowCoordinatorErrorV1("ROOM_RULESET_MISMATCH", rulesetValidation.errors.join("; "));
  const expectedActorIds = uniqueSorted(input.expectedActorIds);
  if (expectedActorIds.length === 0) throw new B0WindowCoordinatorErrorV1("ACTOR_NOT_EXPECTED", "A B0 window requires at least one actor.");
  const bindings = [...input.roleBindings]
    .map((binding) => ({ ...binding }))
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
  if (bindings.length !== expectedActorIds.length
    || bindings.some((binding, index) => binding.actorId !== expectedActorIds[index])
    || new Set(bindings.map((binding) => binding.roleId)).size !== bindings.length
    || bindings.some((binding) => !Number.isInteger(binding.controlEpoch) || binding.controlEpoch < 1)) {
    throw new B0WindowCoordinatorErrorV1("ACTOR_OWNERSHIP_MISMATCH", "Role bindings must cover the frozen actor set exactly once.");
  }
  return deepFreeze({
    schemaVersion: "b0-window-config-v1",
    situationId: required(input.situationId, "situationId"),
    ruleset: clone(rulesetValidation.value),
    rulesetHash: hashB0RoomRulesetV1(rulesetValidation.value),
    expectedActorIds,
    roleBindings: bindings,
    createdAt: iso(input.createdAt, "createdAt"),
  });
}

export function assertB0WindowConfigV1(value: unknown): B0WindowConfigV1 {
  const record = asRecord(value, "window config");
  exactKeys(record, ["schemaVersion", "situationId", "ruleset", "rulesetHash", "expectedActorIds", "roleBindings", "createdAt"], "window config");
  if (record.schemaVersion !== "b0-window-config-v1") throw new B0WindowCoordinatorErrorV1("ROOM_RULESET_MISMATCH", "Invalid B0 window config schema.");
  const config = createB0WindowConfigV1({
    situationId: required(record.situationId, "situationId"),
    ruleset: record.ruleset as B0RoomRulesetV1,
    expectedActorIds: stringArray(record.expectedActorIds, "expectedActorIds"),
    roleBindings: roleBindings(record.roleBindings),
    createdAt: required(record.createdAt, "createdAt"),
  });
  if (record.rulesetHash !== config.rulesetHash) throw new B0WindowCoordinatorErrorV1("ROOM_RULESET_MISMATCH", "Frozen ruleset hash does not match the config.");
  return clone(config);
}

export function saveB0DraftRevisionV1(input: SaveB0DraftInputV1): {
  envelope: B0StoredIntentEnvelopeV1;
  replayed: boolean;
} {
  assertOpenContext(input.window, input.config, input.candidate.actorId);
  const current = input.current ? assertB0StoredIntentEnvelopeV1(input.current) : emptyEnvelope(input.window, input.candidate.actorId);
  const candidateRequestHash = hashCanonicalB0Value({
    clientRequestId: input.candidate.clientRequestId,
    expectedRevision: input.expectedRevision,
    candidate: omitVolatileActionFields(input.candidate),
  });
  if (current.latestDraft?.clientRequestId === input.candidate.clientRequestId) {
    if (current.latestRequestHash !== candidateRequestHash) {
      throw new B0WindowCoordinatorErrorV1("IDEMPOTENCY_KEY_REUSED", "The draft request key was reused with different content.");
    }
    return { envelope: clone(current), replayed: true };
  }
  if (input.expectedRevision !== current.latestRevision) {
    throw new B0WindowCoordinatorErrorV1("INTENT_STALE_REVISION", `Expected revision ${input.expectedRevision}; current revision is ${current.latestRevision}.`);
  }
  const nextRevision = current.latestRevision + 1;
  const draft: B0ActionContractV1 = {
    ...clone(input.candidate),
    windowId: input.window.id,
    roomId: input.window.roomId,
    runId: input.window.runId,
    actorId: input.candidate.actorId,
    baseWorldSequence: input.window.baseWorldSequence,
    revision: nextRevision,
    status: "DRAFT",
    createdAt: current.latestDraft?.createdAt || iso(input.now, "now"),
    updatedAt: iso(input.now, "now"),
    confirmedAt: null,
    lockedAt: null,
  };
  assertValidAction(draft);
  const envelope: B0StoredIntentEnvelopeV1 = {
    ...current,
    latestRevision: nextRevision,
    latestDraft: draft,
    lockedIntent: null,
    latestRequestHash: candidateRequestHash,
  };
  return { envelope: deepFreeze(clone(envelope)), replayed: false };
}

export function confirmB0DraftRevisionV1(input: ConfirmB0DraftInputV1): {
  envelope: B0StoredIntentEnvelopeV1;
  replayed: boolean;
} {
  assertOpenContext(input.window, input.config, input.current.actorId);
  const current = assertB0StoredIntentEnvelopeV1(input.current);
  if (current.lastConfirmed?.revision === input.expectedRevision
    && current.latestDraft?.revision === input.expectedRevision) {
    return { envelope: clone(current), replayed: true };
  }
  if (!current.latestDraft || current.latestDraft.revision !== input.expectedRevision) {
    throw new B0WindowCoordinatorErrorV1("INTENT_STALE_REVISION", "Only the latest draft revision can be confirmed.");
  }
  const confirmed: B0ActionContractV1 = {
    ...clone(current.latestDraft),
    status: "CONFIRMED",
    updatedAt: iso(input.now, "now"),
    confirmedAt: iso(input.now, "now"),
    lockedAt: null,
  };
  assertValidAction(confirmed);
  return {
    envelope: deepFreeze(clone({ ...current, latestDraft: confirmed, lastConfirmed: confirmed })),
    replayed: false,
  };
}

export function assertB0StoredIntentEnvelopeV1(value: unknown): B0StoredIntentEnvelopeV1 {
  const record = asRecord(value, "intent envelope");
  exactKeys(record, [
    "schemaVersion", "windowId", "roomId", "runId", "actorId", "latestRevision",
    "latestDraft", "lastConfirmed", "lockedIntent", "latestRequestHash",
  ], "intent envelope");
  if (record.schemaVersion !== "b0-intent-revision-envelope-v1") {
    throw new B0WindowCoordinatorErrorV1("INTENT_SCHEMA_INVALID", "Invalid intent envelope schema.");
  }
  const envelope = record as unknown as B0StoredIntentEnvelopeV1;
  for (const key of ["windowId", "roomId", "runId", "actorId"] as const) required(envelope[key], key);
  if (!Number.isInteger(envelope.latestRevision) || envelope.latestRevision < 0) throw new B0WindowCoordinatorErrorV1("INTENT_SCHEMA_INVALID", "latestRevision must be >= 0.");
  for (const action of [envelope.latestDraft, envelope.lastConfirmed, envelope.lockedIntent]) {
    if (action) assertValidAction(action);
  }
  if (envelope.latestDraft && envelope.latestDraft.revision !== envelope.latestRevision) {
    throw new B0WindowCoordinatorErrorV1("INTENT_SCHEMA_INVALID", "latestDraft revision does not match latestRevision.");
  }
  if (envelope.lastConfirmed && envelope.lastConfirmed.status !== "CONFIRMED") {
    throw new B0WindowCoordinatorErrorV1("INTENT_SCHEMA_INVALID", "lastConfirmed must have CONFIRMED status.");
  }
  if (envelope.lockedIntent && envelope.lockedIntent.status !== "LOCKED") {
    throw new B0WindowCoordinatorErrorV1("INTENT_SCHEMA_INVALID", "lockedIntent must have LOCKED status.");
  }
  if (envelope.latestRequestHash !== null && !/^[a-f0-9]{64}$/.test(envelope.latestRequestHash)) {
    throw new B0WindowCoordinatorErrorV1("INTENT_SCHEMA_INVALID", "latestRequestHash is invalid.");
  }
  return clone(envelope);
}

export function lockB0IntentForActorV1(input: {
  window: B0SettlementWindowV1;
  config: B0WindowConfigV1;
  actorId: string;
  current: B0StoredIntentEnvelopeV1 | null;
  lockedAt: string;
}): { envelope: B0StoredIntentEnvelopeV1; intent: B0ActionContractV1; source: "CONFIRMED" | "HOLD" } {
  const current = input.current ? assertB0StoredIntentEnvelopeV1(input.current) : emptyEnvelope(input.window, input.actorId);
  const confirmed = current.lastConfirmed;
  const intent = confirmed
    ? lockConfirmed(input.window, input.config, input.actorId, confirmed, input.lockedAt)
    : buildB0HoldIntentV1(input.window, input.actorId, Math.max(1, current.latestRevision), input.lockedAt);
  return {
    envelope: deepFreeze(clone({
      ...current,
      latestRevision: Math.max(current.latestRevision, intent.revision),
      lockedIntent: intent,
    })),
    intent,
    source: confirmed ? "CONFIRMED" : "HOLD",
  };
}

export function buildB0HoldIntentV1(
  window: B0SettlementWindowV1,
  actorId: string,
  revision: number,
  lockedAt: string,
): B0ActionContractV1 {
  const timestamp = iso(lockedAt, "lockedAt");
  const intent: B0ActionContractV1 = {
    schemaVersion: "b0-action-contract-v1",
    id: `b0.intent.hold.${hashCanonicalB0Value([window.id, actorId]).slice(0, 24)}`,
    windowId: window.id,
    roomId: window.roomId,
    runId: window.runId,
    actorId,
    baseWorldSequence: window.baseWorldSequence,
    revision,
    kind: "HOLD",
    rawPlayerText: "Hold position.",
    normalizedSummary: "The actor holds position and commits no proactive world change.",
    targetRefs: [],
    primaryEffect: { effectTypeId: "hold.position", direction: "PROTECT", requestedMagnitude: "MINOR" },
    method: { methodTypeId: "hold.no_action", description: "Preserve the current position without a proactive action." },
    resourceCommitments: [],
    evidenceRefs: [],
    capabilityRefs: [],
    propositionRefs: [],
    visibilityIntent: { type: "PRIVATE", declaredRecipientRefs: [actorId] },
    reactionPolicy: "NONE",
    requestedTiming: "CURRENT_WINDOW",
    riskTags: [],
    compilerVersion: "b0-hold-v1",
    validationVersion: "b0-contract-v1",
    clientRequestId: `system-hold:${window.id}:${actorId}`,
    status: "LOCKED",
    createdAt: timestamp,
    updatedAt: timestamp,
    confirmedAt: null,
    lockedAt: timestamp,
  };
  assertValidAction(intent);
  return deepFreeze(intent);
}

export function b0FreezeReasonV1(input: {
  window: B0SettlementWindowV1;
  participants: B0ParticipantReadyStateV1[];
  now: string;
}): "ALL_READY" | "DEADLINE" | "IMMEDIATE" | null {
  if (input.window.status !== "OPEN") return null;
  if (input.window.mode === "IMMEDIATE") return "IMMEDIATE";
  const expected = new Set<string>(input.window.expectedActorIds);
  const ready = new Set<string>(input.participants.filter((participant) => participant.ready).map((participant) => participant.actorId));
  if (expected.size > 0 && [...expected].every((actorId) => ready.has(actorId))) return "ALL_READY";
  if (input.window.locksAt && Date.parse(iso(input.now, "now")) >= Date.parse(input.window.locksAt)) return "DEADLINE";
  return null;
}

export function buildB0FreezeEnvelopeV1(input: {
  record: B0WindowStoreRecordV1;
  lockReason: "ALL_READY" | "DEADLINE" | "IMMEDIATE";
  lockedAt: string;
  intentEnvelopes: Map<string, B0StoredIntentEnvelopeV1 | null>;
  world: B0WindowWorldCaptureV1;
}): {
  freeze: B0FreezeEnvelopeV1;
  lockedEnvelopes: Map<string, B0StoredIntentEnvelopeV1>;
} {
  const config = assertB0WindowConfigV1(input.record.config);
  const window = clone(input.record.window);
  const lockedAt = iso(input.lockedAt, "lockedAt");
  const lockedIntents: B0ActionContractV1[] = [];
  const lockedEnvelopes = new Map<string, B0StoredIntentEnvelopeV1>();
  for (const actorId of config.expectedActorIds) {
    const locked = lockB0IntentForActorV1({
      window,
      config,
      actorId,
      current: input.intentEnvelopes.get(actorId) ?? null,
      lockedAt,
    });
    lockedIntents.push(locked.intent);
    lockedEnvelopes.set(actorId, locked.envelope);
  }
  lockedIntents.sort((left, right) => left.id.localeCompare(right.id));
  const snapshot = captureB0SettlementSnapshotV1({
    id: `b0.snapshot.${hashCanonicalB0Value([window.id, window.baseWorldSequence, config.rulesetHash]).slice(0, 24)}`,
    windowId: window.id,
    roomId: window.roomId,
    runId: window.runId,
    baseWorldSequence: window.baseWorldSequence,
    ruleset: config.ruleset,
    worldState: input.world.worldState,
    actorStates: input.world.actorStates,
    roleBindings: input.world.roleBindings,
    knowledgeState: input.world.knowledgeState,
    relationshipState: input.world.relationshipState,
    resourceState: input.world.resourceState,
    activeCapabilities: input.world.activeCapabilities,
    dueSystemIntents: input.world.dueSystemIntents ?? [],
    createdAt: lockedAt,
  });
  const batch = prepareB0SettlementBatchV1({
    id: `b0.batch.${hashCanonicalB0Value([window.id, snapshot.id]).slice(0, 24)}`,
    snapshot,
    intents: lockedIntents,
    createdAt: lockedAt,
  });
  const frozenWindow: B0SettlementWindowV1 = {
    ...window,
    readyActorIds: uniqueSorted(input.record.participants.filter((participant) => participant.ready).map((participant) => participant.actorId)),
    lockedAt,
    status: "LOCKED",
    lockReason: input.lockReason,
  };
  const freeze: B0FreezeEnvelopeV1 = deepFreeze({
    schemaVersion: "b0-freeze-envelope-v1",
    window: frozenWindow,
    config,
    lockReason: input.lockReason,
    lockedAt,
    snapshot,
    batch,
    lockedIntents,
  });
  return { freeze, lockedEnvelopes };
}

export async function freezeB0WindowV1(
  store: B0WindowFreezeStoreV1,
  input: { windowId: string; now: string; requestedReason?: "ALL_READY" | "DEADLINE" | "IMMEDIATE" },
): Promise<FreezeB0WindowResultV1> {
  const record = await store.readWindow(input.windowId);
  if (!record) throw new B0WindowCoordinatorErrorV1("WINDOW_NOT_FOUND", "The B0 window was not found.");
  if (record.window.status !== "OPEN") {
    const existing = await store.readFreeze(input.windowId);
    if (existing) return { status: "ALREADY_FROZEN", envelope: existing };
    throw new B0WindowCoordinatorErrorV1("WINDOW_NOT_OPEN", `The B0 window is ${record.window.status}.`);
  }
  const derivedReason = b0FreezeReasonV1({ window: record.window, participants: record.participants, now: input.now });
  let reason = derivedReason;
  if (input.requestedReason === "DEADLINE" && record.window.locksAt
    && Date.parse(input.now) >= Date.parse(record.window.locksAt)) reason = "DEADLINE";
  if (input.requestedReason === "IMMEDIATE" && record.window.mode === "IMMEDIATE") reason = "IMMEDIATE";
  if (input.requestedReason === "ALL_READY" && derivedReason === "ALL_READY") reason = "ALL_READY";
  if (!reason) return { status: "NOT_ELIGIBLE", envelope: null };
  const claimed = await store.claimOpenWindow({
    windowId: record.window.id,
    expectedVersion: record.storageVersion,
    lockReason: reason,
    lockedAt: input.now,
  });
  if (!claimed) {
    const existing = await store.readFreeze(input.windowId);
    if (existing) return { status: "ALREADY_FROZEN", envelope: existing };
    throw new B0WindowCoordinatorErrorV1("WINDOW_ALREADY_LOCKED", "Another request locked the window first.");
  }
  const intentEnvelopes = new Map<string, B0StoredIntentEnvelopeV1 | null>();
  for (const actorId of record.config.expectedActorIds) {
    intentEnvelopes.set(actorId, await store.readIntentEnvelope(record.window.id, actorId));
  }
  const built = buildB0FreezeEnvelopeV1({
    record,
    lockReason: reason,
    lockedAt: input.now,
    intentEnvelopes,
    world: await store.captureWorld(record.window.id),
  });
  for (const actorId of record.config.expectedActorIds) {
    const envelope = built.lockedEnvelopes.get(actorId)!;
    await store.persistLockedIntent({ windowId: record.window.id, actorId, envelope, intent: envelope.lockedIntent! });
  }
  await store.persistFreeze(built.freeze);
  return { status: "FROZEN", envelope: built.freeze };
}

export function projectB0WindowV1(input: {
  record: B0WindowStoreRecordV1;
  actorId: string;
  intent: B0StoredIntentEnvelopeV1 | null;
  freeze: B0FreezeEnvelopeV1 | null;
}): B0WindowProjectionV1 {
  if (!input.record.config.expectedActorIds.includes(input.actorId)) {
    throw new B0WindowCoordinatorErrorV1("ACTOR_NOT_EXPECTED", "The actor is not part of this B0 window.");
  }
  const participant = input.record.participants.find((entry) => entry.actorId === input.actorId);
  if (!participant) throw new B0WindowCoordinatorErrorV1("ACTOR_NOT_EXPECTED", "The actor has no window participant row.");
  const intent = input.intent ? assertB0StoredIntentEnvelopeV1(input.intent) : null;
  return {
    schemaVersion: "b0-window-projection-v1",
    window: clone(input.freeze?.window ?? input.record.window),
    actorId: input.actorId,
    actorReady: participant.ready || Boolean(input.freeze),
    readyCount: input.freeze
      ? input.freeze.window.readyActorIds.length
      : input.record.participants.filter((entry) => entry.ready).length,
    expectedCount: input.record.config.expectedActorIds.length,
    latestDraft: intent?.latestDraft ?? null,
    lastConfirmed: intent?.lastConfirmed ?? null,
    lockedIntent: input.freeze?.lockedIntents.find((entry) => entry.actorId === input.actorId) ?? intent?.lockedIntent ?? null,
    batch: input.freeze ? { id: input.freeze.batch.id, status: input.freeze.batch.status, inputHash: input.freeze.batch.inputHash } : null,
  };
}

function assertOpenContext(window: B0SettlementWindowV1, config: B0WindowConfigV1, actorId: string): void {
  const windowValidation = validateB0SettlementWindowV1(window);
  if (!windowValidation.ok) throw new B0WindowCoordinatorErrorV1("WINDOW_NOT_FOUND", windowValidation.errors.join("; "));
  if (window.status !== "OPEN") throw new B0WindowCoordinatorErrorV1("WINDOW_NOT_OPEN", `The B0 window is ${window.status}.`);
  const validatedConfig = assertB0WindowConfigV1(config);
  if (validatedConfig.ruleset.rulesetVersion !== window.rulesetVersion) throw new B0WindowCoordinatorErrorV1("ROOM_RULESET_MISMATCH", "Window and frozen ruleset versions differ.");
  if (!validatedConfig.expectedActorIds.includes(actorId)) throw new B0WindowCoordinatorErrorV1("ACTOR_NOT_EXPECTED", "The actor is not part of this window.");
}

function emptyEnvelope(window: B0SettlementWindowV1, actorId: string): B0StoredIntentEnvelopeV1 {
  return {
    schemaVersion: "b0-intent-revision-envelope-v1",
    windowId: window.id,
    roomId: window.roomId,
    runId: window.runId,
    actorId,
    latestRevision: 0,
    latestDraft: null,
    lastConfirmed: null,
    lockedIntent: null,
    latestRequestHash: null,
  };
}

function lockConfirmed(
  window: B0SettlementWindowV1,
  config: B0WindowConfigV1,
  actorId: string,
  confirmed: B0ActionContractV1,
  lockedAt: string,
): B0ActionContractV1 {
  assertOpenContext(window, config, actorId);
  if (confirmed.status !== "CONFIRMED" || confirmed.actorId !== actorId
    || confirmed.windowId !== window.id || confirmed.roomId !== window.roomId || confirmed.runId !== window.runId
    || confirmed.baseWorldSequence !== window.baseWorldSequence) {
    throw new B0WindowCoordinatorErrorV1("INTENT_CONTEXT_MISMATCH", "The confirmed intent does not match the frozen window.");
  }
  const locked = { ...clone(confirmed), status: "LOCKED" as const, updatedAt: iso(lockedAt, "lockedAt"), lockedAt: iso(lockedAt, "lockedAt") };
  assertValidAction(locked);
  return deepFreeze(locked);
}

function assertValidAction(action: B0ActionContractV1): void {
  const validation = validateB0ActionContractV1(action);
  if (!validation.ok) throw new B0WindowCoordinatorErrorV1("INTENT_SCHEMA_INVALID", validation.errors.join("; "));
}

function omitVolatileActionFields(action: B0ActionContractV1): unknown {
  const { revision: _revision, status: _status, createdAt: _createdAt, updatedAt: _updatedAt,
    confirmedAt: _confirmedAt, lockedAt: _lockedAt, ...stable } = action;
  return stable;
}

function roleBindings(value: unknown): B0WindowRoleBindingV1[] {
  if (!Array.isArray(value)) throw new B0WindowCoordinatorErrorV1("ROOM_RULESET_MISMATCH", "roleBindings must be an array.");
  return value.map((entry, index) => {
    const record = asRecord(entry, `roleBindings[${index}]`);
    exactKeys(record, ["actorId", "roleId", "controlEpoch", "controlMode"], `roleBindings[${index}]`);
    if (!Number.isInteger(record.controlEpoch) || Number(record.controlEpoch) < 1) throw new B0WindowCoordinatorErrorV1("ROOM_RULESET_MISMATCH", "controlEpoch is invalid.");
    if (record.controlMode !== "HUMAN_ACTIVE" && record.controlMode !== "AI_ACTIVE") throw new B0WindowCoordinatorErrorV1("ROOM_RULESET_MISMATCH", "controlMode is invalid.");
    return {
      actorId: required(record.actorId, `roleBindings[${index}].actorId`),
      roleId: required(record.roleId, `roleBindings[${index}].roleId`),
      controlEpoch: Number(record.controlEpoch),
      controlMode: record.controlMode,
    };
  });
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new B0WindowCoordinatorErrorV1("INTENT_SCHEMA_INVALID", `${path} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new B0WindowCoordinatorErrorV1("INTENT_UNKNOWN_FIELD", `${path} contains unknown field: ${unknown}`);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new B0WindowCoordinatorErrorV1("INTENT_SCHEMA_INVALID", `${path} must be a string array.`);
  }
  return value as string[];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => required(value, "actorId")))].sort();
}

function required(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new B0WindowCoordinatorErrorV1("B0_REQUIRED_FIELD", `${path} is required.`);
  return value;
}

function iso(value: unknown, path: string): string {
  const text = required(value, path);
  if (Number.isNaN(Date.parse(text))) throw new B0WindowCoordinatorErrorV1("B0_TIMESTAMP_INVALID", `${path} must be an ISO timestamp.`);
  return text;
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, clone(entry)])) as T;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  return value;
}
