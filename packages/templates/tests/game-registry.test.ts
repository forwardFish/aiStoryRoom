import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  findGameDefinition,
  getGameDefinition,
  getTemplate,
  listGameDefinitions,
  loadGameRegistry,
  loadPublishedSangtianActionReleaseV1,
  loadSangtianPressureChapterPackageV1,
  validateGameDefinition,
} from "../src";

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
  const accepted = loadSangtianPressureChapterPackageV1();
  assert.equal(game.roles.length, 6);
  assert.deepEqual(
    [...game.roles.map((role) => role.roleKey)].sort(),
    [...accepted.content.genesis.seats.map((seat) => seat.seatId)].sort(),
  );
  for (const seat of accepted.content.genesis.seats) {
    const role = game.roles.find((candidate) => candidate.roleKey === seat.seatId);
    assert.equal(role?.roleName, seat.displayName);
    assert.equal(role?.identity, seat.institutionalMission);
    assert.equal(role?.publicInfo, seat.institutionalMission);
    assert.equal(role?.portrait.includes("/generated/"), false);
  }
  assert.ok(game.roles.every((role) => role.canBeHumanControlled && role.canBeAiControlled));
  assert.ok(game.roles.every((role) => role.identity && role.publicInfo && role.personalGoal && role.portrait.startsWith("/assets/")));
  assert.ok(game.roles.every((role) => role.portrait.startsWith("/assets/game/sangtian/")));
  assert.equal(game.worldActor?.actorKey, "court_market_pressure");
  assert.equal(game.roles.some((role) => role.roleKey === game.worldActor?.actorKey), false);
  assert.deepEqual(game.modes, { solo: true, multiplayer: true, minHumanPlayers: 1, maxHumanPlayers: 6 });
  assert.deepEqual(game.engine, {
    engineVersion: "pressure_chapter_v1",
    strategyVersion: "sangtian_pressure_chapter_v1_0",
    strategyRegistryPath: null,
    fixedRules: null,
  });
});

test("Caesar may define six normal human-or-Agent roles without changing the registry code", () => {
  const game = getGameDefinition("caesar");
  assert.equal(game.roles.length, 6);
  assert.equal(game.modes.minHumanPlayers, 1);
  assert.equal(game.modes.maxHumanPlayers, 6);
  assert.ok(game.roles.every((role) => role.canBeHumanControlled && role.canBeAiControlled));
  assert.deepEqual(getTemplate(game.templateId).roles.map((role) => role.roleKey), game.roles.map((role) => role.roleKey));
});

test("the registered Sangtian Pressure route and accepted role contract load together", () => {
  const game = getGameDefinition("sangtian");
  const content = loadSangtianPressureChapterPackageV1();
  const release = loadPublishedSangtianActionReleaseV1();
  assert.deepEqual(
    [...game.roles.map((role) => role.roleKey)].sort(),
    [...content.content.genesis.seats.map((seat) => seat.seatId)].sort(),
  );
  assert.equal(release.route.status, "PUBLISHED");
  assert.equal(release.routeRegistration.route.engineVersion, game.engine.engineVersion);
  assert.equal(release.routeRegistration.route.strategyVersion, game.engine.strategyVersion);
  assert.equal(release.route.contentPackageVersion, content.manifest.packageVersion);
  assert.equal(release.route.contentPackageSha256, content.manifest.contentSha256);
  assert.equal(content.content.chapters.length, 7);
});

test("the game registry fails closed on a split Pressure route or legacy seat alias", () => {
  const game = structuredClone(getGameDefinition("sangtian"));
  assert.throws(
    () => validateGameDefinition({
      ...game,
      engine: { ...game.engine, strategyVersion: "sangtian_v1_2" },
    }),
    /frozen strategyVersion/,
  );
  assert.throws(
    () => validateGameDefinition({
      ...game,
      roles: game.roles.map((role, index) => index === 0 ? { ...role, roleKey: "clerk" } : role),
    }),
    /canonical six-seat catalog/,
  );
  assert.throws(
    () => validateGameDefinition({
      ...game,
      engine: { ...game.engine, soloEngineVersion: "openovel_v1" },
    }),
    /second Solo engine/,
  );
});

test("every registered background and role portrait exists in the Web asset tree", () => {
  const publicRoot = process.cwd().endsWith("packages\\templates")
    || process.cwd().endsWith("packages/templates")
    ? resolve(process.cwd(), "../../apps/web/public")
    : resolve(__dirname, "../../../apps/web/public");
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
