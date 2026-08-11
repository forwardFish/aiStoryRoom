import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  beginPrepareResolutionPhase,
  confirmPressureActionIntent,
  initializePressureRuntime,
  loadPressureRuntimeContent,
  lockCommitPhase,
  lockPreparePhase,
  openReactionOrSettlement,
  pressureHash,
  projectP0ToN1,
  resolvePreparePhase,
  validatePressureActionIntent,
  type PressureActionIntentCommandV1,
  type PressureRuntimeContent,
  type PressureRuntimeState,
} from "@ai-story/templates";
import { ContinuousEventDeliveryService } from "./event-delivery.service";
import {
  createPressureRuntimeCheckpoint,
  mergePressureCheckpointIntoStateJson,
  PressureSpineRuntimeService,
} from "./pressure-spine-runtime.service";

type Row = Record<string, any>;
type DbState = {
  storyRuns: Row[];
  roles: Row[];
  players: Row[];
  nodes: Row[];
  windows: Row[];
  participants: Row[];
  playerActions: Row[];
  workflows: Row[];
  resolutionCheckpoints: Row[];
  roleAssets: Row[];
  roleAssetMutations: Row[];
  storyEvents: Row[];
  storyEventCursors: Row[];
  deliveryCursors: Row[];
  deliveries: Row[];
};

const clone = <T>(value: T): T => structuredClone(value);
const nowIso = (ms = 0) => new Date(ms).toISOString();

function applyData(row: Row, data: Row): Row {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "increment")) {
      row[key] = Number(row[key] || 0) + Number((value as Row).increment || 0);
    } else {
      row[key] = clone(value);
    }
  }
  row.updatedAt = new Date();
  return row;
}

function statusMatches(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === "object" && !Array.isArray(condition)) {
    const object = condition as Row;
    if (Array.isArray(object.in)) return object.in.includes(value);
    if (Object.prototype.hasOwnProperty.call(object, "not")) return value !== object.not;
  }
  return value === condition;
}

function rowMatches(row: Row, where: Row): boolean {
  for (const [key, condition] of Object.entries(where || {})) {
    if (key === "runId_assetKey") {
      if (row.runId !== (condition as Row).runId || row.assetKey !== (condition as Row).assetKey) return false;
      continue;
    }
    if (key === "windowId_roleId") {
      if (row.windowId !== (condition as Row).windowId || row.roleId !== (condition as Row).roleId) return false;
      continue;
    }
    if (key === "roomId_userId") {
      if (row.roomId !== (condition as Row).roomId || row.userId !== (condition as Row).userId) return false;
      continue;
    }
    if (key === "idempotencyKey" || key === "id" || key === "windowId" || key === "runId" || key === "nodeId" || key === "actionType" || key === "messageType" || key === "version" || key === "status") {
      if (!statusMatches(row[key], condition)) return false;
      continue;
    }
    if (key === "resolvedAt" && condition && typeof condition === "object" && Object.prototype.hasOwnProperty.call(condition, "not")) {
      if (row.resolvedAt === (condition as Row).not) return false;
      continue;
    }
  }
  return true;
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  const orders = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return rows.sort((left, right) => {
    for (const order of orders) {
      const [field, direction] = Object.entries(order)[0] as [string, any];
      const a = left[field] instanceof Date ? left[field].getTime() : left[field];
      const b = right[field] instanceof Date ? right[field].getTime() : right[field];
      const cmp = a < b ? -1 : a > b ? 1 : 0;
      if (cmp) return direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

class MemoryTx {
  constructor(public state: DbState) {}

  $queryRaw = async () => [{ acquired: true }];

  private enrichRun(run: Row): Row {
    return {
      ...clone(run),
      roles: clone(this.state.roles.filter((entry) => entry.runId === run.id)),
      players: clone(this.state.players.filter((entry) => entry.runId === run.id && entry.status === "active")),
      actionWindows: clone(sortRows(this.state.windows.filter((entry) => entry.runId === run.id), { createdAt: "desc" })),
    };
  }

  storyRun = {} as any;

  actionWindow = {} as any;
  sceneNode = {} as any;
  playerAction = {} as any;
  actionWindowParticipant = {} as any;
  resolutionWorkflow = {} as any;
  resolutionCheckpoint = {} as any;
  roleAsset = {} as any;
  roleAssetMutation = {} as any;
  storyEvent = {} as any;
  storyEventCursor = {} as any;
  eventDeliveryCursor = {} as any;
  eventDelivery = {} as any;

  initialize(): this {
    this.storyRun.findUnique = async ({ where }: any) => {
      const run = this.state.storyRuns.find((entry) => entry.id === where.id);
      return run ? this.enrichRun(run) : null;
    };
    this.storyRun.findUniqueOrThrow = async ({ where }: any) => {
      const run = await this.storyRun.findUnique({ where });
      if (!run) throw new Error("RUN_NOT_FOUND");
      return run;
    };
    this.storyRun.updateMany = async ({ where, data }: any) => {
      const rows = this.state.storyRuns.filter((entry) => rowMatches(entry, where));
      rows.forEach((entry) => applyData(entry, data));
      return { count: rows.length };
    };
    this.storyRun.update = async ({ where, data }: any) => {
      const row = this.state.storyRuns.find((entry) => entry.id === where.id);
      if (!row) throw new Error("RUN_NOT_FOUND");
      return clone(applyData(row, data));
    };

    this.actionWindow.findUnique = async ({ where }: any) => {
      const window = this.state.windows.find((entry) => where.id ? entry.id === where.id : entry.nodeId === where.nodeId);
      if (!window) return null;
      const run = this.state.storyRuns.find((entry) => entry.id === window.runId)!;
      const node = this.state.nodes.find((entry) => entry.id === window.nodeId)!;
      return { ...clone(window), run: this.enrichRun(run), node: clone(node) };
    };
    this.actionWindow.update = async ({ where, data }: any) => {
      const row = this.state.windows.find((entry) => entry.id === where.id);
      if (!row) throw new Error("WINDOW_NOT_FOUND");
      return clone(applyData(row, data));
    };
    this.actionWindow.create = async ({ data }: any) => {
      const row = { id: `window.${this.state.windows.length + 1}`, version: 1, createdAt: new Date(), updatedAt: new Date(), ...clone(data) };
      this.state.windows.push(row);
      return clone(row);
    };

    this.sceneNode.findFirst = async ({ where }: any) => clone(this.state.nodes.find((entry) => rowMatches(entry, where)) || null);
    this.sceneNode.create = async ({ data }: any) => {
      const row = { id: `node.${this.state.nodes.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...clone(data) };
      this.state.nodes.push(row);
      return clone(row);
    };

    this.playerAction.findUnique = async ({ where }: any) => {
      const row = where.idempotencyKey
        ? this.state.playerActions.find((entry) => entry.idempotencyKey === where.idempotencyKey)
        : this.state.playerActions.find((entry) => entry.id === where.id);
      return row ? clone(row) : null;
    };
    this.playerAction.create = async ({ data }: any) => {
      if (this.state.playerActions.some((entry) => entry.id === data.id || entry.idempotencyKey === data.idempotencyKey)) {
        throw Object.assign(new Error("UNIQUE_CONSTRAINT"), { code: "P2002" });
      }
      const row = { createdAt: new Date(), updatedAt: new Date(), resolvedAt: null, ...clone(data) };
      this.state.playerActions.push(row);
      return clone(row);
    };
    this.playerAction.findMany = async ({ where, orderBy }: any) => {
      const rows = this.state.playerActions.filter((entry) => rowMatches(entry, where));
      return clone(sortRows(rows, orderBy));
    };
    this.playerAction.updateMany = async ({ where, data }: any) => {
      const rows = this.state.playerActions.filter((entry) => rowMatches(entry, where));
      rows.forEach((entry) => applyData(entry, data));
      return { count: rows.length };
    };

    this.actionWindowParticipant.update = async ({ where, data }: any) => {
      const row = this.state.participants.find((entry) => rowMatches(entry, { windowId_roleId: where.windowId_roleId }));
      if (!row) throw new Error("PARTICIPANT_NOT_FOUND");
      return clone(applyData(row, data));
    };
    this.actionWindowParticipant.upsert = async ({ where, create }: any) => {
      const existing = this.state.participants.find((entry) => rowMatches(entry, { windowId_roleId: where.windowId_roleId }));
      if (existing) return clone(existing);
      const row = { id: `participant.${this.state.participants.length + 1}`, mainStatus: "PENDING", maneuverStatus: "LOCKED", reactionStatus: "PENDING", ...clone(create) };
      this.state.participants.push(row);
      return clone(row);
    };

    this.resolutionWorkflow.findUnique = async ({ where }: any) => {
      const row = this.state.workflows.find((entry) => entry.windowId === where.windowId);
      if (!row) return null;
      return { ...clone(row), checkpoints: clone(this.state.resolutionCheckpoints.filter((entry) => entry.workflowId === row.id)) };
    };
    this.resolutionWorkflow.findFirst = async ({ where }: any) => {
      const rows = this.state.workflows.filter((entry) => rowMatches(entry, where));
      const row = sortRows(rows, { updatedAt: "desc" })[0];
      return row ? { ...clone(row), checkpoints: clone(this.state.resolutionCheckpoints.filter((entry) => entry.workflowId === row.id)) } : null;
    };
    this.resolutionWorkflow.create = async ({ data }: any) => {
      const row = { id: `workflow.${this.state.workflows.length + 1}`, version: 1, createdAt: new Date(), updatedAt: new Date(), rulesOutputJson: null, completedAt: null, ...clone(data) };
      this.state.workflows.push(row);
      return { ...clone(row), checkpoints: [] };
    };
    this.resolutionWorkflow.update = async ({ where, data }: any) => {
      const row = this.state.workflows.find((entry) => entry.id === where.id);
      if (!row) throw new Error("WORKFLOW_NOT_FOUND");
      return clone(applyData(row, data));
    };

    this.resolutionCheckpoint.create = async ({ data }: any) => {
      if (this.state.resolutionCheckpoints.some((entry) => entry.workflowId === data.workflowId && entry.checkpointKey === data.checkpointKey)) {
        throw Object.assign(new Error("UNIQUE_CHECKPOINT"), { code: "P2002" });
      }
      const row = { id: `checkpoint.${this.state.resolutionCheckpoints.length + 1}`, createdAt: new Date(), ...clone(data) };
      this.state.resolutionCheckpoints.push(row);
      return clone(row);
    };

    this.roleAsset.findUnique = async ({ where }: any) => clone(this.state.roleAssets.find((entry) => rowMatches(entry, where)) || null);
    this.roleAsset.create = async ({ data, select }: any) => {
      const row = { id: `asset.${this.state.roleAssets.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...clone(data) };
      this.state.roleAssets.push(row);
      return select ? { id: row.id } : clone(row);
    };
    this.roleAsset.updateMany = async ({ where, data }: any) => {
      const rows = this.state.roleAssets.filter((entry) => rowMatches(entry, where));
      rows.forEach((entry) => applyData(entry, data));
      return { count: rows.length };
    };

    this.roleAssetMutation.upsert = async ({ where, update, create }: any) => {
      const existing = this.state.roleAssetMutations.find((entry) => entry.idempotencyKey === where.idempotencyKey);
      if (existing) return clone(applyData(existing, update));
      const row = { id: `mutation.${this.state.roleAssetMutations.length + 1}`, createdAt: new Date(), ...clone(create) };
      this.state.roleAssetMutations.push(row);
      return clone(row);
    };

    this.storyEvent.findUnique = async ({ where }: any) => clone(this.state.storyEvents.find((entry) => entry.dedupeKey === where.dedupeKey) || null);
    this.storyEvent.findMany = async ({ where, orderBy }: any) => clone(sortRows(this.state.storyEvents.filter((entry) => rowMatches(entry, where)), orderBy));
    this.storyEvent.create = async ({ data }: any) => {
      if (this.state.storyEvents.some((entry) => entry.dedupeKey === data.dedupeKey || (entry.runId === data.runId && entry.sequence === data.sequence))) {
        throw Object.assign(new Error("UNIQUE_EVENT"), { code: "P2002" });
      }
      const row = { createdAt: new Date(), ...clone(data) };
      this.state.storyEvents.push(row);
      return clone(row);
    };

    this.storyEventCursor.findUnique = async ({ where }: any) => clone(this.state.storyEventCursors.find((entry) => entry.runId === where.runId) || null);
    this.storyEventCursor.create = async ({ data }: any) => {
      const row = { version: 1, ...clone(data) };
      this.state.storyEventCursors.push(row);
      return clone(row);
    };
    this.storyEventCursor.update = async ({ where, data }: any) => {
      const row = this.state.storyEventCursors.find((entry) => entry.runId === where.runId)!;
      return clone(applyData(row, data));
    };

    this.eventDeliveryCursor.findUnique = async ({ where }: any) => clone(this.state.deliveryCursors.find((entry) => rowMatches(entry, { roomId_userId: where.roomId_userId })) || null);
    this.eventDeliveryCursor.create = async ({ data }: any) => {
      const row = { id: `delivery-cursor.${this.state.deliveryCursors.length + 1}`, version: 1, ...clone(data) };
      this.state.deliveryCursors.push(row);
      return clone(row);
    };
    this.eventDeliveryCursor.update = async ({ where, data }: any) => {
      const row = this.state.deliveryCursors.find((entry) => rowMatches(entry, { roomId_userId: where.roomId_userId }))!;
      return clone(applyData(row, data));
    };

    this.eventDelivery.create = async ({ data }: any) => {
      const row = { id: `delivery.${this.state.deliveries.length + 1}`, deliveredAt: new Date(), ...clone(data) };
      this.state.deliveries.push(row);
      return clone(row);
    };
    return this;
  }
}

class MemoryPrisma extends MemoryTx {
  constructor(state: DbState) {
    super(state);
    this.initialize();
  }

  $transaction = async <T>(operation: (tx: MemoryTx) => Promise<T>): Promise<T> => {
    const next = clone(this.state);
    const tx = new MemoryTx(next).initialize();
    const result = await operation(tx);
    this.state = next;
    this.initialize();
    return result;
  };
}

function runtimeContent(): PressureRuntimeContent {
  return loadPressureRuntimeContent(
    resolve(process.cwd(), "packages/templates/config/sangtian/strategy-registry.json"),
    "sangtian_pressure_v1_0",
  );
}

function initialN1(content: PressureRuntimeContent, runId: string): PressureRuntimeState {
  const initialized = initializePressureRuntime(content, { runId, runSeed: `seed:${runId}`, nowEpochMs: 1_000 });
  return projectP0ToN1(content, initialized, 1_001, 600_000).state;
}

function actionIntent(
  state: PressureRuntimeState,
  content: PressureRuntimeContent,
  seatId: string,
  slot: "PREPARE" | "COMMIT" | "REACTION",
  idempotencyKey: string,
  type: PressureActionIntentCommandV1["type"] = "PLAN",
): PressureActionIntentCommandV1 {
  return {
    schemaVersion: "pressure_action_intent_v1",
    runId: state.runId,
    nodeId: state.nodeId,
    slot,
    seatId,
    currentActorId: state.seats[seatId].currentActorId,
    controlEpoch: state.seats[seatId].controlEpoch,
    type,
    intentText: `${type}:${seatId}:${slot}`,
    targetObjectId: null,
    expectedObjectVersionId: null,
    resourceCommitments: [],
    parameters: {},
    visibility: "PRIVATE",
    submittedAtEpochMs: 5_000,
    expectedRunVersion: state.phaseSnapshotVersion,
    expectedSnapshotHash: state.inputSnapshotHash,
    idempotencyKey,
  };
}

function seal(content: PressureRuntimeContent, state: PressureRuntimeState, intent: PressureActionIntentCommandV1): PressureRuntimeState {
  const preview = validatePressureActionIntent(content, state, intent);
  assert.equal(preview.accepted, true, `${preview.errorCode}:${preview.safeMessage}`);
  return confirmPressureActionIntent(content, state, preview.normalizedIntent, preview.previewToken).state;
}

function settlingN1(content: PressureRuntimeContent, runId: string): PressureRuntimeState {
  let state = initialN1(content, runId);
  for (const [index, seatId] of content.seatIds.entries()) {
    state = seal(content, state, actionIntent(state, content, seatId, "PREPARE", `${runId}:prepare:${index}`));
  }
  state = lockPreparePhase(content, state, 6_000);
  state = beginPrepareResolutionPhase(state);
  state = resolvePreparePhase(content, state, 6_001, 700_000).state;
  for (const [index, seatId] of content.seatIds.entries()) {
    state = seal(content, state, actionIntent(state, content, seatId, "COMMIT", `${runId}:commit:${index}`));
  }
  state = lockCommitPhase(content, state, 7_000);
  state = openReactionOrSettlement(content, state, 7_001);
  assert.equal(state.phase, "SETTLING");
  return state;
}

function persistedActionRows(state: PressureRuntimeState, roleBySeat: Record<string, string>, nodeId: string): Row[] {
  return Object.values(state.sealedActions).map((action) => ({
    id: action.command.actionId,
    runId: state.runId,
    nodeId,
    chapterIndex: state.nodeSequence,
    userId: null,
    roleId: roleBySeat[action.command.seatId],
    playerType: action.command.isDefault ? "timeout" : "ai",
    actionType: "pressure_action",
    method: action.command.intentText,
    intent: action.command.intentText,
    normalizedJson: {
      actionId: action.command.actionId,
      publicIntent: action.command.sourceIntent,
      compiled: {
        schemaVersion: "pressure_persisted_action_v1",
        normalizedIntent: action.command.sourceIntent,
        compiledCommand: action.command,
        snapshotHash: action.snapshotHash,
        actionHash: pressureHash(action),
      },
    },
    guardStatus: "ok",
    auditStatus: "ok",
    status: action.resolution ? "resolved" : "accepted",
    actionSlot: action.command.slot === "PREPARE" ? "MAIN" : action.command.slot === "COMMIT" ? "MANEUVER" : "REACTION",
    actorKind: action.command.isDefault ? "TIMEOUT_FALLBACK" : "AI_TAKEOVER",
    controlEpoch: action.command.controlEpoch,
    policyVersion: action.command.policyVersion,
    provider: "rules",
    modelName: "pressure-kernel-v1",
    actionKey: action.command.type,
    idempotencyKey: action.command.idempotencyKey,
    requestHash: action.command.requestFingerprint,
    visibility: action.command.visibility,
    sealedAt: new Date(action.sealedAt),
    resolvedAt: action.resolvedAt ? new Date(action.resolvedAt) : null,
    resolvedJson: action.resolution,
    createdAt: new Date(action.sealedAt),
    updatedAt: new Date(action.sealedAt),
  }));
}

function harness(state: PressureRuntimeState) {
  const content = runtimeContent();
  const seats = content.nodes[state.nodeId].seats.length ? content.nodes[state.nodeId].seats : content.nodes.N1.seats;
  const roles = seats.map((seat, index) => ({
    id: `role.${index + 1}`,
    runId: state.runId,
    roleKey: seat.roleKey,
    roleName: seat.roleKey,
  }));
  const roleBySeat = Object.fromEntries(seats.map((seat, index) => [seat.seatId, roles[index].id]));
  const players = roles.map((role, index) => ({
    id: `player.${index + 1}`,
    runId: state.runId,
    roleId: role.id,
    userId: index === 0 ? "user.1" : null,
    playerType: index === 0 ? "human" : "ai",
    status: "active",
  }));
  const node = {
    id: `node.${state.nodeId}`,
    runId: state.runId,
    chapterIndex: state.nodeSequence,
    nodeIndex: state.nodeSequence,
    title: state.nodeId,
  };
  const window = {
    id: `window.${state.nodeId}`,
    runId: state.runId,
    nodeId: node.id,
    status: state.phase === "PREPARE_OPEN" ? "MAIN_OPEN" : state.phase,
    version: 1,
    projectionVersion: 1,
    configJson: { commitSeconds: 180 },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const checkpoint = createPressureRuntimeCheckpoint(state, nowIso(0));
  const run = {
    id: state.runId,
    strategyVersion: "sangtian_pressure_v1_0",
    templateKey: "sangtian",
    stateJson: mergePressureCheckpointIntoStateJson({}, checkpoint),
    version: 1,
    currentDay: state.nodeSequence,
    status: "playing",
    updatedAt: new Date(0),
  };
  const db: DbState = {
    storyRuns: [run],
    roles,
    players,
    nodes: [node],
    windows: [window],
    participants: roles.map((role) => ({
      windowId: window.id,
      roleId: role.id,
      mainStatus: "PENDING",
      maneuverStatus: "LOCKED",
      reactionStatus: "NOT_OPEN",
      version: 1,
    })),
    playerActions: [],
    workflows: [],
    resolutionCheckpoints: [],
    roleAssets: [],
    roleAssetMutations: [],
    storyEvents: [],
    storyEventCursors: [],
    deliveryCursors: [],
    deliveries: [],
  };
  const prisma = new MemoryPrisma(db);
  const deliveries = new ContinuousEventDeliveryService(prisma as any);
  const service = new PressureSpineRuntimeService(prisma as any, deliveries);
  service.setNowProviderForTest(() => 5_000);
  return { content, roleBySeat, prisma, service, user: { id: "user.1" } as any, node, window };
}

test("REC-001 ACTION_SEALED crash returns the original durable action on retry", async () => {
  const content = runtimeContent();
  const state = initialN1(content, "run.confirm.crash");
  const fixture = harness(state);
  const seatId = content.seatIds[0];
  const intent = actionIntent(state, content, seatId, "PREPARE", "confirm-once", "REST");
  const preview = await fixture.service.preview(fixture.user, state.runId, intent);
  fixture.service.setFaultInjectorForTest((point) => {
    if (point === "AFTER_ACTION_SEALED_COMMIT") throw new Error("INJECTED_AFTER_ACTION_SEALED");
  });
  await assert.rejects(() => fixture.service.confirm(fixture.user, state.runId, intent, preview.previewToken), /INJECTED_AFTER_ACTION_SEALED/);
  assert.equal(fixture.prisma.state.playerActions.length, 1);
  assert.equal(fixture.prisma.state.storyEvents.filter((entry) => entry.type === "ACTION_SEALED").length, 1);
  fixture.service.setFaultInjectorForTest(null);
  const replay = await fixture.service.confirm(fixture.user, state.runId, intent, preview.previewToken);
  assert.equal(replay.replayed, true);
  assert.equal(replay.actionId, fixture.prisma.state.playerActions[0].id);
  assert.equal(fixture.prisma.state.playerActions.length, 1);
  assert.equal(fixture.prisma.state.storyEvents.filter((entry) => entry.type === "ACTION_SEALED").length, 1);
});

test("idempotency is server canonical and fails closed when payload changes", async () => {
  const content = runtimeContent();
  const state = initialN1(content, "run.idempotency");
  const fixture = harness(state);
  const seatId = content.seatIds[0];
  const original = actionIntent(state, content, seatId, "PREPARE", "same-key", "PLAN");
  const preview = await fixture.service.preview(fixture.user, state.runId, original);
  await fixture.service.confirm(fixture.user, state.runId, original, preview.previewToken);
  for (let index = 0; index < 10; index += 1) {
    const replay = await fixture.service.confirm(fixture.user, state.runId, original, preview.previewToken);
    assert.equal(replay.replayed, true);
  }
  const changed = { ...original, intentText: "changed payload with old client fingerprint" };
  const changedPreview = await fixture.service.preview(fixture.user, state.runId, changed);
  await assert.rejects(
    () => fixture.service.confirm(fixture.user, state.runId, changed, changedPreview.previewToken),
    (error: any) => error?.response?.code === "IDEMPOTENCY_KEY_REUSED",
  );
  assert.equal(fixture.prisma.state.playerActions.length, 1);
});

test("REC-002 and REC-003 rules checkpoint survives while domain DB fault rolls back atomically", async () => {
  const content = runtimeContent();
  const state = settlingN1(content, "run.resolve.crash");
  const fixture = harness(state);
  fixture.prisma.state.playerActions = persistedActionRows(state, fixture.roleBySeat, fixture.node.id);
  fixture.service.setFaultInjectorForTest((point) => {
    if (point === "AFTER_RULES_APPLIED_COMMIT") throw new Error("INJECTED_AFTER_RULES");
  });
  await assert.rejects(() => fixture.service.resolveWindow(fixture.window.id), /INJECTED_AFTER_RULES/);
  assert.equal(fixture.prisma.state.resolutionCheckpoints.filter((entry) => entry.checkpointKey === "RULES_APPLIED").length, 1);
  assert.equal(fixture.prisma.state.roleAssetMutations.length, 0);

  fixture.service.setFaultInjectorForTest((point) => {
    if (point === "BEFORE_DOMAIN_TRANSACTION_COMMIT") throw new Error("INJECTED_DB_FAULT");
  });
  await assert.rejects(() => fixture.service.resolveWindow(fixture.window.id), /INJECTED_DB_FAULT/);
  assert.equal(fixture.prisma.state.resolutionCheckpoints.filter((entry) => entry.checkpointKey === "DOMAIN_PERSISTED").length, 0);
  assert.equal(fixture.prisma.state.roleAssetMutations.length, 0);

  fixture.service.setFaultInjectorForTest(null);
  const completed = await fixture.service.resolveWindow(fixture.window.id);
  assert.equal(completed.outcome, "PROJECTED");
  assert.ok(completed.frozenResultHash);
  const mutationKeys = fixture.prisma.state.roleAssetMutations.map((entry) => entry.idempotencyKey);
  assert.equal(new Set(mutationKeys).size, mutationKeys.length);
  const frozenHash = completed.frozenResultHash;
  const replay = await fixture.service.resolveWindow(fixture.window.id);
  assert.equal(replay.outcome, "PROJECTED");
  assert.equal(replay.frozenResultHash, frozenHash);
  assert.equal(fixture.prisma.state.resolutionCheckpoints.filter((entry) => entry.checkpointKey === "PROJECTION_INPUT_PERSISTED").length, 1);
});

test("REC-004 reconstructs from RULES_APPLIED and rejects frozen tampering", async () => {
  const content = runtimeContent();
  const state = settlingN1(content, "run.recover.workflow");
  const fixture = harness(state);
  fixture.prisma.state.playerActions = persistedActionRows(state, fixture.roleBySeat, fixture.node.id);
  fixture.service.setFaultInjectorForTest((point) => {
    if (point === "AFTER_RULES_APPLIED_COMMIT") throw new Error("STOP_AFTER_RULES");
  });
  await assert.rejects(() => fixture.service.resolveWindow(fixture.window.id), /STOP_AFTER_RULES/);
  fixture.service.setFaultInjectorForTest(null);
  fixture.prisma.state.storyRuns[0].stateJson = {};
  const recovered = await fixture.service.recoverRun(state.runId);
  assert.equal(recovered.state.phase, "FROZEN");
  assert.ok(recovered.state.frozenResults[0]?.contentHash);
  const tampered = clone(fixture.prisma.state.storyRuns[0].stateJson);
  tampered.pressureRuntimeV1.state.frozenResults[0].branchId = "tampered";
  fixture.prisma.state.storyRuns[0].stateJson = tampered;
  await assert.rejects(
    () => fixture.service.recoverRun(state.runId),
    (error: any) => error?.response?.code === "RECOVERY_CHECKPOINT_INVALID" || /FROZEN_RESULT_HASH_MISMATCH|Frozen result hash mismatch/.test(String(error)),
  );
});

test("persisted pressure events remain restricted to the 12 root types", async () => {
  const content = runtimeContent();
  const state = initialN1(content, "run.root-events");
  const fixture = harness(state);
  const intent = actionIntent(state, content, content.seatIds[0], "PREPARE", "root-event", "REST");
  const preview = await fixture.service.preview(fixture.user, state.runId, intent);
  await fixture.service.confirm(fixture.user, state.runId, intent, preview.previewToken);
  const allowed = new Set([
    "RUN_INITIALIZED", "PHASE_OPENED", "ACTION_SEALED", "TIME_ADVANCED", "DEFAULT_ACTION_APPLIED",
    "REACTION_OPENED", "SETTLEMENT_FROZEN", "OPENING_PROJECTED", "HANDOFF_APPLIED", "FINALE_FROZEN",
    "NARRATIVE_PUBLISHED", "RECOVERY_COMPLETED",
  ]);
  for (const event of fixture.prisma.state.storyEvents) assert.equal(allowed.has(event.type), true, event.type);
});


test("deadline rejects a new confirm but preserves an existing idempotent replay", async () => {
  const content = runtimeContent();
  const acceptedState = initialN1(content, "run.deadline.replay");
  const acceptedFixture = harness(acceptedState);
  const seatId = content.seatIds[0];
  const acceptedIntent = actionIntent(acceptedState, content, seatId, "PREPARE", "deadline-replay", "REST");
  const acceptedPreview = await acceptedFixture.service.preview(acceptedFixture.user, acceptedState.runId, acceptedIntent);
  await acceptedFixture.service.confirm(acceptedFixture.user, acceptedState.runId, acceptedIntent, acceptedPreview.previewToken);
  acceptedFixture.service.setNowProviderForTest(() => 600_000);
  const replay = await acceptedFixture.service.confirm(acceptedFixture.user, acceptedState.runId, acceptedIntent, acceptedPreview.previewToken);
  assert.equal(replay.replayed, true);
  assert.equal(acceptedFixture.prisma.state.playerActions.length, 1);

  const lateState = initialN1(content, "run.deadline.new");
  const lateFixture = harness(lateState);
  const lateIntent = actionIntent(lateState, content, seatId, "PREPARE", "deadline-new", "REST");
  const latePreview = await lateFixture.service.preview(lateFixture.user, lateState.runId, lateIntent);
  lateFixture.service.setNowProviderForTest(() => 600_000);
  await assert.rejects(
    () => lateFixture.service.confirm(lateFixture.user, lateState.runId, lateIntent, latePreview.previewToken),
    (error: any) => error?.response?.code === "DEADLINE_EXPIRED",
  );
  assert.equal(lateFixture.prisma.state.playerActions.length, 0);
  assert.equal(lateFixture.prisma.state.storyEvents.length, 0);
});

test("persisted pressure ledger rejects a non-root StoryEvent during recovery", async () => {
  const content = runtimeContent();
  const state = initialN1(content, "run.root-event-tamper");
  const fixture = harness(state);
  const intent = actionIntent(state, content, content.seatIds[0], "PREPARE", "root-event-tamper", "REST");
  const preview = await fixture.service.preview(fixture.user, state.runId, intent);
  await fixture.service.confirm(fixture.user, state.runId, intent, preview.previewToken);
  const last = fixture.prisma.state.storyEvents.at(-1)!;
  fixture.prisma.state.storyEvents.push({
    ...clone(last),
    id: "event.non-root",
    type: "ACTION_RESOLVED",
    dedupeKey: "event.non-root",
    sequence: last.sequence + 1,
    payloadJson: {
      ...clone(last.payloadJson),
      pressureEventSequence: Number((last.payloadJson as any).pressureEventSequence) + 1,
      pressureEventId: "event.non-root",
    },
  });
  await assert.rejects(
    () => fixture.service.recoverRun(state.runId),
    (error: any) => error?.response?.code === "ROOT_EVENT_TYPE_INVALID",
  );
});
