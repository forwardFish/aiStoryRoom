import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { navigateToFreshSoloRun, playAgainUrl, renderPlayAgainDialog, soloWorldId } from "../public/solo-run-lifecycle.js";

test("play again creates a fresh-run route for the current world without deleting the old run", () => {
  const view = { run: { id: "old-run", storyId: "sangtian" } };
  assert.equal(soloWorldId(view), "sangtian");
  assert.equal(playAgainUrl(view), "/role-select?story=sangtian&start=new");
});

test("the confirmed play-again action enters the existing fresh-run lifecycle", () => {
  const assignments = [];
  const browserWindow = {
    location: { assign: (url) => assignments.push(url) },
  };

  assert.equal(navigateToFreshSoloRun({ browserWindow, view: { room: { worldId: "story with spaces" } } }), true);
  assert.deepEqual(assignments, ["/role-select?story=story%20with%20spaces&start=new"]);
});

test("play again falls back to world selection when the current world is unavailable", () => {
  assert.equal(playAgainUrl({}), "/worlds");
});

test("play again uses an in-game accessible dialog instead of a browser confirm", () => {
  const dialog = renderPlayAgainDialog();
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /id="playAgainCancelBtn"/);
  assert.match(dialog, /id="playAgainConfirmBtn"/);
  assert.match(dialog, /当前这一局及历史记录都会保留/);
});

test("the main game integrates the play-again lifecycle without replacing history or home", async () => {
  const [app, page, css] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/solo-run-lifecycle.css", import.meta.url), "utf8"),
  ]);

  assert.match(app, /id="historyBtn"/);
  assert.match(app, /id="playAgainBtn"[^>]*aria-label="再来一局"/);
  assert.match(app, /id="v2RoomBtn"[^>]*aria-label="返回主页"/);
  assert.match(app, /querySelector\("#playAgainBtn"\).*openPlayAgain/);
  assert.match(app, /querySelector\("#playAgainConfirmBtn"\).*confirmPlayAgain/);
  assert.doesNotMatch(app, /browserWindow\.confirm\([^)]*再来一局/);
  assert.match(page, /solo-run-lifecycle\.css\?v=20260805-play-again-v2/);
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*max-content\)/);
  assert.match(css, /\.play-again-dialog\s*\{/);
});
