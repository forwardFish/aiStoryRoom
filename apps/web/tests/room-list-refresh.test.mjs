import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the open-room list polls without overlapping requests or surviving navigation", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const appShellStart = source.indexOf("function appShell(");
  const appShellEnd = source.indexOf("function currentRoomPlayer", appShellStart);
  const appShell = source.slice(appShellStart, appShellEnd);
  const refreshStart = source.indexOf("async function refreshRoomsList()");
  const refreshEnd = source.indexOf("async function hydrateRoom", refreshStart);
  const refresh = source.slice(refreshStart, refreshEnd);

  assert.match(appShell, /setInterval\(\(\) => \{ void refreshRoomsList\(\); \}, 5000\)/);
  assert.match(appShell, /setInterval\(\(\) => \{ restoreRoomDialogDraft\(\); \}, 250\)/);
  assert.match(appShell, /clearInterval\(roomDialogRecoveryTimer\)/);
  assert.match(refresh, /currentPath !== "\/rooms" \|\| roomsRefreshPending/);
  assert.match(refresh, /\.join-code-dialog\[open\], \.create-room-dialog\[open\]/);
  assert.match(refresh, /\|\| roomDialogOpen/);
  assert.match(refresh, /roomsRefreshPending = true/);
  assert.match(refresh, /finally \{ roomsRefreshPending = false; \}/);
});

test("a recovered room-list poll clears stale errors and never exposes an internal error key", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const noticeStart = source.indexOf("function notice(");
  const noticeEnd = source.indexOf("let googleIdentityLibraryPromise", noticeStart);
  const hydrateStart = source.indexOf("async function hydrateRooms()");
  const hydrateEnd = source.indexOf("async function refreshRoomsList()", hydrateStart);
  const notices = source.slice(noticeStart, noticeEnd);
  const hydrate = source.slice(hydrateStart, hydrateEnd);

  assert.match(notices, /function clearNotice\(\)/);
  assert.match(hydrate, /bindRoomActions\(\); clearNotice\(\);/);
  assert.match(hydrate, /error\.code === "INTERNAL_ERROR" \? "Rooms are temporarily unavailable\. Retrying automatically…"/);
  assert.doesNotMatch(hydrate, /notice\(error\.message \|\| "Unable to load rooms\."\)/);
});

test("room dialogs restore their in-progress draft after the Rooms page is rebuilt", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const renderStart = source.indexOf("function renderRooms()");
  const renderEnd = source.indexOf("function renderRoom()", renderStart);
  const restoreStart = source.indexOf("function readRoomDialogDraft()");
  const restoreEnd = source.indexOf("async function hydrateRoom", restoreStart);
  const roomRender = source.slice(renderStart, renderEnd);
  const dialogFlow = source.slice(restoreStart, restoreEnd);

  assert.match(roomRender, /restoreRoomDialogDraft\(\)/);
  assert.match(dialogFlow, /sessionStorage\.setItem\(roomDialogDraftKey/);
  assert.match(dialogFlow, /draft\?\.type === "join"/);
  assert.match(dialogFlow, /draft\?\.type === "create"/);
  assert.match(dialogFlow, /saveRoomDialogDraft\(\{ type: "create", worldId \}\)/);
  assert.match(dialogFlow, /clearRoomDialogDraft\(\)/);
});
