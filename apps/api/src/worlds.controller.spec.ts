import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    "sangtian", "caesar", "last-night-shift", "ninety-days-left", "inheritance-table", "blackout-protocol"
  ]);
  assert.equal(result.worlds.filter((world) => world.status === "playable").length, 2);
  assert.equal(result.worlds.filter((world) => world.status === "coming_soon").length, 4);
  assert.ok(result.worlds.every((world) => world.detailPath === `/worlds/${world.worldId}`));
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
    assert.equal(new WorldsController().detail("sangtian").engineVersion, "continuous_strategy_v1_1");
  } finally {
    if (prior === undefined) delete process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED;
    else process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED = prior;
  }
});

test("unknown world detail is a 404 instead of a hardcoded fallback", () => {
  assert.throws(() => new WorldsController().detail("not-a-world"), (error) => error instanceof NotFoundException);
});
