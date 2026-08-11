import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveFallbackManeuverContextV1,
  readB0ManeuverContextV1,
  readManeuverProjectionV1,
  selectCurrentB0WindowV1,
} from "./maneuver-v1.prisma-read";

const publicFact = {
  factKey: "fact.record.changed",
  content: "A signed record changed after its first timestamp.",
  visibility: "public",
  knownByRoleIdsJson: [],
  sourceEventIdsJson: ["event.record.change"],
  sourceActionIdsJson: [],
};
const privateFact = {
  factKey: "fact.private.other",
  content: "A private fact known only to another role.",
  visibility: "private",
  knownByRoleIdsJson: ["role.other"],
  sourceEventIdsJson: [],
  sourceActionIdsJson: [],
};

test("fallback derives world-neutral contacts and trace routes from role-visible authoritative state", () => {
  const result = deriveFallbackManeuverContextV1({
    roleId: "role.viewer",
    visibleFactKeys: [publicFact.factKey],
    roles: [
      { id: "role.viewer", roleName: "Viewer" },
      { id: "role.contact", roleName: "Records Officer", identity: "Officer", publicInfo: "Maintains records." },
    ],
    facts: [publicFact, privateFact],
  });
  assert.deepEqual(result.contacts.map((entry) => entry.id), ["role.contact"]);
  assert.equal(result.traces.length, 1);
  assert.equal(result.investigationOutcomes.length, 1);
  assert.equal(result.investigationOutcomes[0].factKey, publicFact.factKey);
  assert.equal(JSON.stringify(result).includes(privateFact.content), false);
});

test("fallback does not expose a private fact that the current role does not know", () => {
  const result = deriveFallbackManeuverContextV1({
    roleId: "role.viewer",
    visibleFactKeys: [],
    roles: [],
    facts: [privateFact],
  });
  assert.deepEqual(result.traces, []);
  assert.deepEqual(result.investigationOutcomes, []);
});

function fakeDb() {
  return {
    storyRun: { findUnique: async () => ({ id: "run.1", currentNodeId: "node.1", currentChapter: 1, worldSequence: 4, status: "playing" }) },
    storyPlayer: { findFirst: async () => ({ id: "player.viewer", roleId: "role.viewer" }) },
    roleControl: { findFirst: async () => ({ epoch: 1, mode: "HUMAN_ACTIVE", humanPlayerId: "player.viewer" }) },
    actionWindow: { findMany: async () => [] },
    actorTurn: { findFirst: async () => ({ id: "turn.1", stageIndex: 1, status: "OPEN", revision: 2, contextJson: { generationStatus: "READY" }, visibleFactKeysJson: [publicFact.factKey] }) },
    decisionSubmission: { findUnique: async () => null },
    playerAction: { findMany: async () => [] },
    roleAsset: { findMany: async () => [] },
    storyRole: { findMany: async () => [{ id: "role.contact", roleName: "Records Officer", identity: "Officer", publicInfo: "Maintains records." }] },
    canonFact: { findMany: async () => [publicFact, privateFact] },
  };
}

test("projection remains usable when an existing actor turn has no maneuver-specific context", async () => {
  const projection = await readManeuverProjectionV1(fakeDb() as never, "user.viewer", "run.1");
  assert.equal(projection.remaining, 2);
  assert.deepEqual(projection.contacts.map((entry) => entry.id), ["role.contact"]);
  assert.equal(projection.traces.length, 1);
  assert.equal(JSON.stringify(projection).includes(privateFact.content), false);
});


function fakeB0Db() {
  return {
    actionWindow: { findMany: async () => [{
      id: "window.b0.one",
      runId: "run.1",
      nodeId: "node.b0.one",
      status: "OPEN",
      openingSnapshotVersion: 4,
      projectionVersion: 1,
      version: 1,
      configJson: { schemaVersion: "b0-window-config-v1" },
      node: { chapterIndex: 1 },
      participants: [{ roleId: "role.viewer" }, { roleId: "role.contact" }],
    }] },
    storyRun: { findUnique: async () => ({ id: "run.1", currentChapter: 1, worldSequence: 4, status: "playing" }) },
    storyPlayer: { findFirst: async () => ({ id: "player.viewer", roleId: "role.viewer" }) },
    roleControl: { findFirst: async () => ({ epoch: 3, mode: "HUMAN_ACTIVE", humanPlayerId: "player.viewer" }) },
    actorTurn: { findFirst: async () => { throw new Error("B0 projection must not read ActorTurn"); } },
    decisionSubmission: { findUnique: async () => { throw new Error("B0 projection must not read DecisionSubmission"); } },
    playerAction: { findMany: async () => [] },
    roleAsset: { findMany: async () => [] },
    storyRole: { findMany: async () => [{ id: "role.contact", roleName: "Records Officer", identity: "Officer", publicInfo: "Maintains records." }] },
    canonFact: { findMany: async () => [publicFact, privateFact] },
  };
}

test("B0 projection derives an authoritative compiler context from ActionWindow without ActorTurn", async () => {
  const context = await readB0ManeuverContextV1(fakeB0Db() as never, "user.viewer", "run.1");
  assert.ok(context);
  assert.equal(context.b0WindowId, "window.b0.one");
  assert.equal(context.actorTurnId, "b0-window:window.b0.one");
  assert.equal(context.turnRevision, 1);
  assert.equal(context.controlEpoch, 3);
  assert.deepEqual(context.compilerContext.contacts.map((entry) => entry.id), ["role.contact"]);

  const projection = await readManeuverProjectionV1(fakeB0Db() as never, "user.viewer", "run.1");
  assert.equal(projection.windowState, "OPEN");
  assert.equal(projection.stateRevision, 4);
  assert.equal(projection.turnRevision, 1);
  assert.equal(JSON.stringify(projection).includes(privateFact.content), false);
});


test("B0 projection selects the successor OPEN window over a completed predecessor", async () => {
  const db = fakeB0Db() as any;
  db.storyRun.findUnique = async () => ({
    id: "run.1",
    currentNodeId: "node.b0.one",
    currentChapter: 1,
    worldSequence: 5,
    status: "playing",
  });
  db.actionWindow.findMany = async () => [
    {
      id: "window.b0.one",
      runId: "run.1",
      nodeId: "node.b0.one",
      status: "COMPLETED",
      openingSnapshotVersion: 4,
      projectionVersion: 8,
      version: 8,
      configJson: { schemaVersion: "b0-window-config-v1" },
      node: { chapterIndex: 1, nodeIndex: 1 },
      participants: [{ roleId: "role.viewer" }, { roleId: "role.contact" }],
    },
    {
      id: "window.b0.two",
      runId: "run.1",
      nodeId: "node.b0.two",
      status: "OPEN",
      openingSnapshotVersion: 5,
      projectionVersion: 1,
      version: 1,
      configJson: { schemaVersion: "b0-window-config-v1" },
      node: { chapterIndex: 1, nodeIndex: 2 },
      participants: [{ roleId: "role.viewer" }, { roleId: "role.contact" }],
    },
  ];

  const context = await readB0ManeuverContextV1(db, "user.viewer", "run.1");
  assert.ok(context);
  assert.equal(context.b0WindowId, "window.b0.two");
  assert.equal(context.actorTurnId, "b0-window:window.b0.two");
  assert.equal(context.windowState, "OPEN");
  assert.equal(context.turnRevision, 1);

  const projection = await readManeuverProjectionV1(db, "user.viewer", "run.1");
  assert.equal(projection.windowState, "OPEN");
  assert.equal(projection.stateRevision, 5);
  assert.equal(projection.turnRevision, 1);
  assert.equal(projection.contacts[0]?.id, "role.contact");
});


test("B0 selector distinguishes explicit window and node hints", () => {
  const windows = [
    {
      id: "window.completed",
      nodeId: "node.completed",
      status: "COMPLETED",
      configJson: { schemaVersion: "b0-window-config-v1" },
      node: { chapterIndex: 1, nodeIndex: 1 },
    },
    {
      id: "window.open",
      nodeId: "node.open",
      status: "OPEN",
      configJson: { schemaVersion: "b0-window-config-v1" },
      node: { chapterIndex: 1, nodeIndex: 2 },
    },
  ];

  assert.equal(
    selectCurrentB0WindowV1(windows, { windowId: "window.completed" })?.id,
    "window.completed",
    "an explicit window contract must compare against the window id rather than the node id",
  );
  assert.equal(
    selectCurrentB0WindowV1(windows, { nodeId: "node.open" })?.id,
    "window.open",
  );
  assert.equal(
    selectCurrentB0WindowV1(windows, { nodeId: "node.completed" })?.id,
    "window.open",
    "a stale completed current node must not hide an open successor",
  );
});
