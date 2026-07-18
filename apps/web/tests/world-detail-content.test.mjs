import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

async function sourceGame(worldId) {
  return JSON.parse(await readFile(new URL(`../../../packages/templates/config/${worldId}/game.json`, import.meta.url), "utf8"));
}

function apiDetail(game) {
  return {
    id: game.publicId,
    runtimeId: game.worldId,
    worldId: game.worldId,
    publicId: game.publicId,
    detailPath: `/worlds/${game.worldId}`,
    status: game.status,
    playable: game.status === "playable",
    cardTitle: game.catalog.lobby.title,
    cardDescription: game.catalog.lobby.description,
    categoryLabel: game.catalog.lobby.categoryLabel,
    cardCover: game.catalog.cardCover,
    title: game.catalog.title,
    subtitle: game.catalog.subtitle,
    description: game.catalog.description,
    genre: game.catalog.genre,
    tags: game.catalog.tags,
    heroCover: game.catalog.heroCover,
    durationLabel: game.catalog.durationLabel,
    roleCount: game.roles.length,
    minHumanPlayers: game.modes.minHumanPlayers,
    maxHumanPlayers: game.modes.maxHumanPlayers,
    modes: [game.modes.solo ? "solo" : null, game.modes.multiplayer ? "multiplayer" : null].filter(Boolean),
    presentation: game.presentation,
    roles: game.roles.map((role) => ({ key: role.roleKey, name: role.roleName, identity: role.identity, publicInfo: role.publicInfo, portrait: role.portrait }))
  };
}

async function renderDetail(worldId, detail) {
  const dom = new JSDOM('<!doctype html><div id="platform-app"></div>', { url: `http://localhost/worlds/${worldId}` });
  const previous = new Map();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    history: dom.window.history,
    localStorage: dom.window.localStorage,
    fetch: async (url) => {
      assert.equal(url, `/api/v4/worlds/${worldId}`);
      return { ok: true, status: 200, json: async () => detail };
    }
  };
  for (const [key, value] of Object.entries(globals)) { previous.set(key, globalThis[key]); globalThis[key] = value; }
  try {
    await import(new URL(`../public/platform.js?detail-test=${worldId}-${Date.now()}`, import.meta.url));
    const deadline = Date.now() + 1000;
    while (!dom.window.document.querySelector("[data-world-detail]") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    return { dom, document: dom.window.document };
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

test("Sangtian and Caesar use one detail template and every visible asset/content field matches game.json", async () => {
  const signatures = [];
  for (const worldId of ["sangtian", "caesar"]) {
    const source = await sourceGame(worldId);
    const { dom, document } = await renderDetail(worldId, apiDetail(source));
    const detail = document.querySelector("[data-world-detail]");
    assert.ok(detail, `${worldId} detail rendered`);
    assert.equal(detail.dataset.worldId, source.worldId);
    assert.equal(detail.querySelector("h1")?.textContent, source.catalog.title);
    assert.equal(detail.querySelector(".world-lead")?.textContent, source.catalog.subtitle);
    assert.equal(detail.querySelector(".world-copy")?.textContent, source.catalog.description);
    assert.equal(detail.querySelector("[data-world-background]")?.getAttribute("src"), source.catalog.heroCover);
    assert.match(detail.querySelector(".meta-row")?.textContent || "", new RegExp(`${source.modes.minHumanPlayers}.*${source.modes.maxHumanPlayers}`));
    assert.equal(detail.querySelectorAll("[data-role-key]").length, source.roles.length);
    assert.deepEqual([...detail.querySelectorAll("[data-role-key]")].map((role) => role.dataset.roleKey), source.roles.map((role) => role.roleKey));
    assert.deepEqual([...detail.querySelectorAll("[data-role-portrait]")].map((image) => image.getAttribute("src")), source.roles.map((role) => role.portrait));
    assert.deepEqual([...detail.querySelectorAll(".role-card strong")].map((name) => name.textContent), source.roles.map((role) => role.roleName));
    assert.deepEqual([...detail.querySelectorAll(".role-card p")].map((copy) => copy.textContent), source.roles.map((role) => role.publicInfo));
    assert.ok([...detail.querySelectorAll("[data-action='world-solo'],[data-action='world-rooms']")].every((button) => button.dataset.worldId === source.worldId));
    signatures.push([...detail.children].map((child) => `${child.tagName}.${child.className}`).join("|"));
    dom.window.close();
  }
  assert.equal(signatures[0], signatures[1], "both games share the same top-level detail template structure");
});

test("detail implementation has no Sangtian/Caesar template switch or fixed world route", async () => {
  const [platform, server] = await Promise.all([
    readFile(new URL("../public/platform.js", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8")
  ]);
  const detailStart = platform.indexOf("function worldIdFromPath");
  const detailEnd = platform.indexOf("function roomRow", detailStart);
  const detailSource = platform.slice(detailStart, detailEnd);
  assert.ok(detailStart >= 0 && detailEnd > detailStart);
  assert.doesNotMatch(detailSource, /sangtian|caesar/i);
  assert.doesNotMatch(platform, /renderSangtianWorld|hydrateWorldRegistry/);
  assert.doesNotMatch(server, /\["\/worlds\/(sangtian|caesar)"/);
  assert.match(server, /\^\\\/worlds\\\/\[\^\/\]\+\$/);
});
