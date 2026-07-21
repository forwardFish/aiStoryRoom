import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const platformUrl = new URL("../public/platform.js", import.meta.url);

test("normal Solo entry bypasses role selection and posts a resumable Solo request", async () => {
  const [platform, home] = await Promise.all([
    readFile(platformUrl, "utf8"),
    readFile(new URL("../public/home.js", import.meta.url), "utf8")
  ]);
  const actions = platform.slice(platform.indexOf("const actions ="), platform.indexOf("async function initializePlatform"));

  assert.match(platform, /function startSoloFromWorld/);
  assert.match(platform, /\/api\/v4\/rooms\/solo/);
  assert.match(platform, /resumeExisting:true/);
  assert.match(actions, /solo:[\s\S]*startSoloFromWorld\("caesar"/);
  assert.match(actions, /"sangtian-solo":[\s\S]*startSoloFromWorld\("sangtian"/);
  assert.match(actions, /"world-solo":[\s\S]*startSoloFromWorld\(worldId/);
  assert.match(home, /\/worlds\/caesar\?play=solo/);
});

test("room entry exposes the two-player Start rule and the waiting fallback actions", async () => {
  const [platform, selection] = await Promise.all([
    readFile(platformUrl, "utf8"),
    readFile(new URL("../public/room-role-selection-view.js", import.meta.url), "utf8")
  ]);

  assert.match(platform, /readyHumanCount/);
  assert.match(platform, /\$\{room\.players\.length\} \/ \$\{room\.maxPlayers\} players · \$\{readyHumanCount\} ready/);
  assert.match(platform, /startLabel: readyHumanCount === 2 \? "Start with 2 Players"/);
  assert.match(platform, /\/waiting\/extend/);
  assert.match(platform, /\/play-solo/);
  assert.match(platform, /START A SHARED STORY/);
  assert.match(platform, /WAITING TIME ENDED/);
  assert.match(platform, /Playing Solo will close this Multiplayer room/);
  assert.match(platform, /ROOM STATUS CHANGED/);
  assert.match(platform, /Play Solo Anyway/);
  assert.match(platform, /confirmReadyPlayersChanged/);
  assert.match(platform, /THE STORY IS STILL OPENING/);
  assert.match(platform, /Back to Room/);
  assert.match(platform, /Try Again/);
  assert.match(platform, /aria-labelledby/);
  assert.match(selection, /data-action="play-solo"/);
  assert.match(selection, /data-action="extend-wait"/);
  assert.match(selection, /data-lobby-countdown/);
  assert.match(selection, /This room has expired/);
  assert.match(selection, /Create New Room/);
});
