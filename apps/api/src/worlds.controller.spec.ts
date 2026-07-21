import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { WorldsController } from "./worlds.controller";

type SourceGame = {
  worldId: string;
  status: string;
  catalog: {
    title: string;
    description: string;
    durationLabel: string;
    cardCover: string;
    heroCover: string;
    lobby: { title: string; description: string; categoryLabel: string };
  };
  modes: { minHumanPlayers: number; maxHumanPlayers: number };
  presentation: { sceneBackground: string };
  roles: Array<{ roleKey: string; roleName: string; publicInfo: string; portrait: string }>;
};

function sourceGame(worldId: string): SourceGame {
  return JSON.parse(readFileSync(resolve(__dirname, `../../../packages/templates/config/${worldId}/game.json`), "utf8")) as SourceGame;
}

test("world list exposes all registry cards in order with playable state", () => {
  const result = new WorldsController().list();
  assert.deepEqual(result.worlds.map((world) => world.worldId), [
    "sangtian", "caesar", "last-will", "ten-years-later", "romeo-and-juliet", "hamlet"
  ]);
  assert.equal(result.worlds.filter((world) => world.status === "playable").length, 2);
  assert.equal(result.worlds.filter((world) => world.status === "coming_soon").length, 4);
  assert.ok(result.worlds.every((world) => world.detailPath === `/worlds/${world.worldId}`));
  assert.ok(result.worlds.every((world) => !/[\u3400-\u9fff]/u.test(`${world.cardTitle} ${world.cardDescription} ${world.categoryLabel}`)));
  assert.ok(result.worlds.every((world) => world.cardCover === `/assets/game/${world.worldId}/catalog-cover.png`));
  assert.ok(result.worlds.every((world) => existsSync(resolve(__dirname, `../../web/public${world.cardCover}`))));
});

for (const worldId of ["sangtian", "caesar"] as const) {
  test(`${worldId} detail projection matches its game.json content and assets`, () => {
    const source = sourceGame(worldId);
    const detail = new WorldsController().detail(worldId);
    assert.equal(detail.worldId, source.worldId);
    assert.equal(detail.title, source.catalog.title);
    assert.equal(detail.description, source.catalog.description);
    assert.equal(detail.cardTitle, source.catalog.lobby.title);
    assert.equal(detail.cardDescription, source.catalog.lobby.description);
    assert.equal(detail.categoryLabel, source.catalog.lobby.categoryLabel);
    assert.equal(detail.cardCover, source.catalog.cardCover);
    assert.equal(detail.heroCover, source.catalog.heroCover);
    assert.equal(detail.presentation.sceneBackground, source.presentation.sceneBackground);
    assert.equal(detail.minHumanPlayers, source.modes.minHumanPlayers);
    assert.equal(detail.maxHumanPlayers, source.modes.maxHumanPlayers);
    assert.equal(detail.minPlayers, source.modes.minHumanPlayers);
    assert.equal(detail.maxPlayers, Math.min(source.modes.maxHumanPlayers, source.roles.length));
    assert.deepEqual(detail.roles.map((role) => ({ key: role.key, name: role.name, publicInfo: role.publicInfo, portrait: role.portrait })),
      source.roles.map((role) => ({ key: role.roleKey, name: role.roleName, publicInfo: role.publicInfo, portrait: role.portrait })));
  });
}

test("world runtime metadata follows the same continuous-strategy rollout flag as room creation", () => {
  const prior = process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED;
  try {
    process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED = "false";
    assert.equal(new WorldsController().detail("sangtian").engineVersion, "legacy_v1");
    process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED = "true";
    assert.equal(new WorldsController().detail("sangtian").engineVersion, "continuous_story_v2");
  } finally {
    if (prior === undefined) delete process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED;
    else process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED = prior;
  }
});

test("world pricing metadata never advertises the active-action fee for a legacy engine", () => {
  const prior = {
    rollout: process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED,
    policy: process.env.CREDIT_DEFAULT_POLICY,
    price: process.env.CREDIT_RUN_CREATE_COST
  };
  try {
    process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED = "true";
    process.env.CREDIT_DEFAULT_POLICY = "active_action_v1";
    process.env.CREDIT_RUN_CREATE_COST = "20";
    const controller = new WorldsController();
    const sangtian = controller.detail("sangtian");
    const caesar = controller.detail("caesar");
    assert.equal(sangtian.engineVersion, "continuous_story_v2");
    assert.equal(sangtian.billingPolicyVersion, "active_action_v1");
    assert.equal(sangtian.runCreateCredits, 20);
    assert.equal(caesar.engineVersion, "legacy_v1");
    assert.equal(caesar.billingPolicyVersion, "world_unlock_v1");
    assert.equal(caesar.runCreateCredits, 0);
  } finally {
    restoreEnv("MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED", prior.rollout);
    restoreEnv("CREDIT_DEFAULT_POLICY", prior.policy);
    restoreEnv("CREDIT_RUN_CREATE_COST", prior.price);
  }
});

test("unknown world detail is a 404 instead of a hardcoded fallback", () => {
  assert.throws(() => new WorldsController().detail("not-a-world"), (error) => error instanceof NotFoundException);
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
