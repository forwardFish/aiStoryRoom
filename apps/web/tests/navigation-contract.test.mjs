import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const publicRoot = path.resolve("public");
const read = (file) => readFile(path.join(publicRoot, file), "utf8");

async function executablePublicSources(directory = publicRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...await executablePublicSources(target));
    else if (/\.(?:html|js)$/.test(entry.name)) sources.push(await readFile(target, "utf8"));
  }
  return sources;
}

test("generic Back controls use a deterministic home exit without browser-history navigation", async () => {
  const [sources, standardHeader, roleSelectHtml, roleSelect, platform, roomGame, continuousGame, continuousV2, credits] = await Promise.all([
    executablePublicSources(),
    read("standard-page-header.js"),
    read("role-select.html"),
    read("role-select.js"),
    read("platform.js"),
    read("room-game.js"),
    read("continuous-game-view.js"),
    read("continuous-story-v2-view.js"),
    read("js/credits.js")
  ]);

  const allSources = sources.join("\n");
  assert.doesNotMatch(allSources, /history\.(?:back|go)\s*\(\s*-?1?\s*\)/);
  assert.match(standardHeader, /this\.getAttribute\("back-href"\) \|\| "\/"/);
  assert.match(roleSelectHtml, /<standard-page-header back-href="\/">/);
  assert.match(roleSelect, /backHref:\s*"\/"/);
  assert.match(platform, /if \(path\.startsWith\("\/worlds\/"\)\) return "\/worlds"/);
  assert.match(roomGame, /back-link mw-back" href="\/"/);
  assert.doesNotMatch(roomGame, /back-link mw-back" href="\/rooms\//);
  assert.match(continuousGame, /<a href="\/">返回主页<\/a>/);
  assert.match(continuousV2, /<a href="\/">返回主页<\/a>/);
  assert.match(credits, /canonicalReturn = intent === "WORLD_UNLOCK" && runId[\s\S]*: "\/"/);
});

test("context-specific exits keep explicit destination labels", async () => {
  const [status, reset, bootstrap] = await Promise.all([
    read("js/credits-status.js"),
    read("reset-password.html"),
    read("game-bootstrap.js")
  ]);

  assert.match(status, /Back to World Credits/);
  assert.match(status, /Back to home/);
  assert.match(reset, /Back to login/);
  assert.match(bootstrap, /Back to story room/);
});
