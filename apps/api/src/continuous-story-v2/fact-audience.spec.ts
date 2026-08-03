import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedStoryAction } from "./story-content";
import { factAudience } from "./continuous-story-v2.service";

const roles = ["actor", "target", "affected", "unrelated"];

function action(targetRoleId: string | null): ResolvedStoryAction {
  return { targetRoleId } as ResolvedStoryAction;
}

test("PUBLIC facts are known by all roles", () => {
  assert.deepEqual(factAudience("PUBLIC", action("target"), "actor", roles, ["affected"]), ["actor", "affected", "target", "unrelated"]);
});

test("OBSERVABLE facts include actor, explicit target and affected roles but not an unrelated third role", () => {
  const audience = factAudience("OBSERVABLE", action("target"), "actor", roles, ["affected"]);
  assert.deepEqual(audience, ["actor", "affected", "target"]);
  assert.equal(audience.includes("unrelated"), false);
});

test("OBSERVABLE facts fail closed to the actor when no reliable scene audience exists", () => {
  assert.deepEqual(factAudience("OBSERVABLE", action(null), "actor", roles, []), ["actor"]);
});

test("PRIVATE and LIMITED keep their explicit audiences", () => {
  assert.deepEqual(factAudience("PRIVATE", action("target"), "actor", roles, ["affected"]), ["actor"]);
  assert.deepEqual(factAudience("LIMITED", action("target"), "actor", roles, ["affected"]), ["actor", "affected", "target"]);
});

test("conditional resolution uses the same OBSERVABLE helper contract", () => {
  const conditionalOwnerRoleId = "actor";
  const affectedRoleIds = ["affected"];
  const audience = factAudience("OBSERVABLE", action("target"), conditionalOwnerRoleId, roles, affectedRoleIds);
  assert.equal(audience.includes("affected"), true);
  assert.equal(audience.includes("unrelated"), false);
});
