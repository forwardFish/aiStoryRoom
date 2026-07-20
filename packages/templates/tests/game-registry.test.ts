import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { findGameDefinition, getGameDefinition, getTemplate, listGameDefinitions, loadGameContinuousStrategyPackage, loadGameRegistry } from "../src";

test("the canonical game registry owns all six lobby cards in display order", () => {
  const games = listGameDefinitions();
  assert.deepEqual(games.map((game) => game.worldId), [
    "sangtian",
    "caesar",
    "last-will",
    "ten-years-later",
    "romeo-and-juliet",
    "hamlet"
  ]);
  assert.equal(games.filter((game) => game.status === "playable").length, 2);
  assert.equal(games.filter((game) => game.status === "coming_soon").length, 4);
  assert.ok(games.every((game) => game.catalog.lobby?.title && game.catalog.lobby?.description && game.catalog.lobby?.categoryLabel));
  assert.ok(games.every((game) => !/[\u3400-\u9fff]/u.test(`${game.catalog.title} ${game.catalog.subtitle} ${game.catalog.description} ${game.catalog.genre} ${game.catalog.lobby?.title} ${game.catalog.lobby?.description} ${game.catalog.lobby?.categoryLabel}`)));
  assert.ok(games.every((game) => game.catalog.cardCover === `/assets/game/${game.worldId}/catalog-cover.png`));
  assert.ok(games.filter((game) => game.status === "playable").every((game) => game.catalog.cardCover !== game.catalog.heroCover));
  assert.equal(new Set(games.map((game) => game.templateId)).size, games.length);
  assert.equal(findGameDefinition("caesar_last_spring")?.worldId, "caesar");
});

test("Sangtian defines six normal human-or-Agent roles plus a separate world actor", () => {
  const game = getGameDefinition("sangtian");
  assert.equal(game.roles.length, 6);
  assert.deepEqual(game.roles.map((role) => role.roleKey), ["zhejiang_governor", "xunfu", "county_magistrate", "clerk", "merchant", "sili_jian"]);
  assert.ok(game.roles.every((role) => role.canBeHumanControlled && role.canBeAiControlled));
  assert.ok(game.roles.every((role) => role.identity && role.publicInfo && role.personalGoal && role.portrait.startsWith("/assets/")));
  assert.ok(game.roles.every((role) => role.portrait.startsWith("/assets/game/sangtian/generated/")));
  assert.equal(game.worldActor?.actorKey, "court_market_pressure");
  assert.equal(game.roles.some((role) => role.roleKey === game.worldActor?.actorKey), false);
  assert.deepEqual(game.modes, { solo: true, multiplayer: true, minHumanPlayers: 1, maxHumanPlayers: 6 });
  assert.equal(game.engine.strategyVersion, "sangtian_v1_2");
});

test("Caesar may define six normal human-or-Agent roles without changing the registry code", () => {
  const game = getGameDefinition("caesar");
  assert.equal(game.roles.length, 6);
  assert.equal(game.modes.minHumanPlayers, 1);
  assert.equal(game.modes.maxHumanPlayers, 6);
  assert.ok(game.roles.every((role) => role.canBeHumanControlled && role.canBeAiControlled));
  assert.deepEqual(getTemplate(game.templateId).roles.map((role) => role.roleKey), game.roles.map((role) => role.roleKey));
});

test("the registered Sangtian strategy and role contract load together", () => {
  const content = loadGameContinuousStrategyPackage("sangtian");
  assert.equal(content.contract.worldId, "sangtian");
  assert.deepEqual(content.contract.playableRoleKeys, getGameDefinition("sangtian").roles.map((role) => role.roleKey));
  assert.equal(content.contract.worldActorKey, getGameDefinition("sangtian").worldActor?.actorKey);
  assert.equal(content.contract.strategyVersion, "sangtian_v1_2");
  assert.equal(content.roleStageContent.roleStages.length, 42);
  assert.equal(content.roleStageContent.roleStages.flatMap((entry) => entry.mainCards).length, 126);
  assert.equal(content.endingRules.personalEndingRules.length, 6);
});

test("every registered background and role portrait exists in the Web asset tree", () => {
  const publicRoot = resolve(__dirname, "../../../apps/web/public");
  for (const game of listGameDefinitions()) {
    const urls = [game.catalog.cardCover, game.catalog.heroCover, game.presentation.sceneBackground, ...game.roles.map((role) => role.portrait)];
    if (game.worldActor) urls.push(game.worldActor.portrait);
    for (const url of urls) {
      const pathname = new URL(url, "http://many-worlds.local").pathname;
      assert.equal(existsSync(resolve(publicRoot, pathname.slice(1))), true, `${game.worldId}: ${url}`);
    }
  }
});

test("every registry entry is isolated in its own world directory", () => {
  const registry = loadGameRegistry();
  for (const entry of registry.index.games) {
    assert.equal(entry.definitionPath, `${entry.worldId}/game.json`);
  }
});
