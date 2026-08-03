import assert from "node:assert/strict";
import test from "node:test";
import { gamePageProjection } from "../game-page-projection";

test("world projection without a viewer is public-only", () => {
  const projection = gamePageProjection("sangtian");
  assert.ok(projection.roles.length >= 2);
  for (const role of projection.roles) {
    assert.equal(role.personalGoal, "");
    assert.deepEqual(role.knownInfo, []);
    assert.equal(role.gameplayProfile.fateQuestion, "");
    assert.deepEqual(role.gameplayProfile.goals, []);
    assert.deepEqual(role.gameplayProfile.resources, []);
    assert.deepEqual(role.gameplayProfile.leverage, []);
  }
});

test("role-scoped and Solo projections expose only the viewer's private profile", () => {
  const publicProjection = gamePageProjection("sangtian");
  const roleKey = publicProjection.roles[0]!.roleKey;
  const projection = gamePageProjection("sangtian", roleKey);
  const self = projection.roles.find((role) => role.roleKey === roleKey)!;
  assert.ok(self.personalGoal.length > 0);
  assert.ok(self.gameplayProfile.goals.length > 0);
  for (const other of projection.roles.filter((role) => role.roleKey !== roleKey)) {
    assert.equal(other.personalGoal, "");
    assert.deepEqual(other.knownInfo, []);
    assert.deepEqual(other.gameplayProfile.leverage, []);
  }
});
