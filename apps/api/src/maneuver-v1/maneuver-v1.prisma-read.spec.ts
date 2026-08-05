import assert from "node:assert/strict";
import test from "node:test";
import { deriveFallbackManeuverContextV1, readManeuverProjectionV1 } from "./maneuver-v1.prisma-read";

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
