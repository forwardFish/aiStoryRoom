import assert from "node:assert/strict";
import test from "node:test";
import { gamePageProjection } from "../game-page-projection";

const SANGTIAN_PUBLIC_NAMES = [
  "浙江总督",
  "浙江巡抚",
  "清流县令",
  "改桑书吏",
  "江南商会会首",
  "司礼监织造使",
];

const SANGTIAN_PUBLIC_PORTRAITS = [
  "/assets/game/sangtian/generated/role-governor-scene-v1.png",
  "/assets/game/sangtian/generated/role-xunfu-scene-v1.png",
  "/assets/game/sangtian/generated/governor-scene-v1.png",
  "/assets/game/sangtian/generated/role-clerk-scene-v1.png",
  "/assets/game/sangtian/generated/role-merchant-scene-v1.png",
  "/assets/game/sangtian/generated/role-spy-scene-v1.png",
];

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

test("Sangtian game projection keeps canonical seat ids but uses the public character cards", () => {
  const projection = gamePageProjection("sangtian");
  assert.deepEqual(projection.roles.map((role) => role.roleKey), [
    "zhejiang_governor",
    "zhejiang_administration",
    "qingliu_law",
    "cabinet_finance",
    "jiangnan_merchant",
    "sili_weaving",
  ]);
  assert.deepEqual(projection.roles.map((role) => role.roleName), SANGTIAN_PUBLIC_NAMES);
  assert.deepEqual(projection.roles.map((role) => role.portrait), SANGTIAN_PUBLIC_PORTRAITS);
  assert.deepEqual(
    projection.roles.map((role) => role.gameplayProfile.characterName),
    SANGTIAN_PUBLIC_NAMES,
  );
  assert.equal(
    projection.roles.some((role) => /(?:rank|shield|treasury|grain|crown)\.png$/u.test(role.portrait)),
    false,
  );
});

test("role-scoped projection exposes private profile data only for the explicit viewer role", () => {
  const publicProjection = gamePageProjection("sangtian");
  const viewerRoleKey = publicProjection.roles[0]!.roleKey;
  const projection = gamePageProjection("sangtian", viewerRoleKey);
  const viewerRole = projection.roles.find((role) => role.roleKey === viewerRoleKey)!;

  assert.ok(viewerRole.personalGoal.length > 0);
  assert.ok(viewerRole.knownInfo.length > 0);
  assert.ok(viewerRole.gameplayProfile.fateQuestion.length > 0);
  assert.ok(viewerRole.gameplayProfile.goals.length > 0);
  assert.ok(viewerRole.gameplayProfile.resources.length > 0);
  assert.ok(viewerRole.gameplayProfile.leverage.length > 0);

  for (const otherRole of projection.roles.filter((role) => role.roleKey !== viewerRoleKey)) {
    assert.equal(otherRole.personalGoal, "");
    assert.deepEqual(otherRole.knownInfo, []);
    assert.equal(otherRole.gameplayProfile.fateQuestion, "");
    assert.deepEqual(otherRole.gameplayProfile.goals, []);
    assert.deepEqual(otherRole.gameplayProfile.resources, []);
    assert.deepEqual(otherRole.gameplayProfile.leverage, []);
  }
});

test("unknown and empty viewer role keys do not reveal any private role profile", () => {
  for (const viewerRoleKey of ["", "not-a-real-role"]) {
    const projection = gamePageProjection("sangtian", viewerRoleKey);
    assert.equal(projection.roles.every((role) => role.personalGoal === ""), true);
    assert.equal(projection.roles.every((role) => role.knownInfo.length === 0), true);
    assert.equal(projection.roles.every((role) => role.gameplayProfile.goals.length === 0), true);
  }
});
