import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const projectRoot = resolve(import.meta.dirname, "../..");
const evidenceRoot = resolve(projectRoot, "docs/auto-execute/game-content-phase1/runtime");
const baseUrl = process.env.GAME_CONTENT_BASE_URL || "http://127.0.0.1:5179";

async function gameSource(worldId) {
  return JSON.parse(await readFile(resolve(projectRoot, `packages/templates/config/${worldId}/game.json`), "utf8"));
}

function pathname(value) {
  return new URL(value, baseUrl).pathname;
}

await mkdir(evidenceRoot, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1735, height: 960 }, deviceScaleFactor: 1 });
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];
const requestedPaths = [];

page.on("console", (message) => { if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() }); });
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("request", (request) => requestedPaths.push(pathname(request.url())));
page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || "unknown" }));
page.on("response", (response) => { if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() }); });

const results = { baseUrl, homeEntry: false, lobby: {}, worlds: {}, consoleErrors, pageErrors, failedRequests, badResponses };
try {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  const homeEntry = page.locator('a[href="/worlds"]').first();
  await homeEntry.waitFor({ state: "visible" });
  await Promise.all([page.waitForURL(`${baseUrl}/worlds`), homeEntry.click()]);
  results.homeEntry = true;

  await page.locator(".world-card").first().waitFor({ state: "visible" });
  assert.equal(await page.locator(".world-card").count(), 6);
  assert.equal(await page.locator("a.world-card.is-playable").count(), 2);
  assert.equal(await page.locator("article.world-card.is-coming").count(), 4);
  assert.equal(await page.locator(".is-coming a").count(), 0);
  results.lobby = {
    cards: await page.locator(".world-card").count(),
    playable: await page.locator("a.world-card.is-playable").count(),
    comingSoon: await page.locator("article.world-card.is-coming").count(),
    sourceRequest: requestedPaths.includes("/api/v4/worlds")
  };
  assert.equal(results.lobby.sourceRequest, true);
  await page.screenshot({ path: resolve(evidenceRoot, "worlds-lobby-1735x960.png"), fullPage: false });

  for (const worldId of ["sangtian", "caesar"]) {
    const source = await gameSource(worldId);
    const requestStart = requestedPaths.length;
    await Promise.all([
      page.waitForURL(`${baseUrl}/worlds/${worldId}`),
      page.locator(`[data-world-id="${worldId}"]`).click()
    ]);
    await page.locator("[data-world-detail]").waitFor({ state: "visible" });
    await page.waitForFunction(() => [...document.querySelectorAll("[data-world-detail] img")].every((image) => image.complete));

    const actual = await page.locator("[data-world-detail]").evaluate((detail) => ({
      worldId: detail.dataset.worldId,
      title: detail.querySelector("h1")?.textContent || "",
      subtitle: detail.querySelector(".world-lead")?.textContent || "",
      description: detail.querySelector(".world-copy")?.textContent || "",
      meta: detail.querySelector(".meta-row")?.textContent || "",
      background: detail.querySelector("[data-world-background]")?.getAttribute("src") || "",
      roleKeys: [...detail.querySelectorAll("[data-role-key]")].map((role) => role.dataset.roleKey),
      roleNames: [...detail.querySelectorAll(".role-card strong")].map((role) => role.textContent || ""),
      roleCopy: [...detail.querySelectorAll(".role-card p")].map((role) => role.textContent || ""),
      portraits: [...detail.querySelectorAll("[data-role-portrait]")].map((image) => image.getAttribute("src") || ""),
      imageStates: [...detail.querySelectorAll("img")].map((image) => ({ src: image.getAttribute("src") || "", complete: image.complete, naturalWidth: image.naturalWidth })),
      imagesLoaded: [...detail.querySelectorAll("img")].every((image) => image.complete && image.naturalWidth > 0),
      actionWorldIds: [...detail.querySelectorAll("[data-action='world-solo'],[data-action='world-rooms']")].map((button) => button.dataset.worldId)
    }));

    results.worlds[worldId] = { imageStates: actual.imageStates };
    assert.equal(actual.worldId, source.worldId);
    assert.equal(actual.title, source.catalog.title);
    assert.equal(actual.subtitle, source.catalog.subtitle);
    assert.equal(actual.description, source.catalog.description);
    assert.equal(pathname(actual.background), source.catalog.heroCover);
    assert.match(actual.meta, new RegExp(`${source.modes.minHumanPlayers}.*${source.modes.maxHumanPlayers}`));
    assert.deepEqual(actual.roleKeys, source.roles.map((role) => role.roleKey));
    assert.deepEqual(actual.roleNames, source.roles.map((role) => role.roleName));
    assert.deepEqual(actual.roleCopy, source.roles.map((role) => role.publicInfo));
    assert.deepEqual(actual.portraits.map(pathname), source.roles.map((role) => role.portrait));
    assert.equal(actual.imagesLoaded, true);
    assert.ok(actual.actionWorldIds.every((id) => id === worldId));

    const worldRequests = requestedPaths.slice(requestStart);
    assert.ok(worldRequests.includes(`/api/v4/worlds/${worldId}`));
    assert.ok(worldRequests.includes(source.catalog.heroCover));
    for (const role of source.roles) assert.ok(worldRequests.includes(role.portrait), `${worldId} requested ${role.portrait}`);

    results.worlds[worldId] = {
      sourceFile: `packages/templates/config/${worldId}/game.json`,
      detailApi: `/api/v4/worlds/${worldId}`,
      titleMatches: true,
      descriptionMatches: true,
      playerRangeMatches: true,
      backgroundMatchesAndLoaded: true,
      roleCount: source.roles.length,
      roleNamesMatch: true,
      roleCopyMatches: true,
      portraitsMatchAndLoaded: true,
      actionWorldIdsMatch: true
    };
    await page.screenshot({ path: resolve(evidenceRoot, `${worldId}-detail-1735x960.png`), fullPage: true });
    await Promise.all([page.waitForURL(`${baseUrl}/worlds`), page.locator('.back-link[href="/worlds"]').click()]);
    await page.locator(".world-card").first().waitFor({ state: "visible" });
  }

  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failedRequests, []);
  assert.deepEqual(badResponses, []);
  results.verdict = "PASS";
} catch (error) {
  results.verdict = "FAIL";
  results.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  throw error;
} finally {
  await writeFile(resolve(evidenceRoot, "browser-verification.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
