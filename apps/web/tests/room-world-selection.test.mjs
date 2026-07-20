import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const platformUrl = new URL("../public/platform.js", import.meta.url);
const cssUrl = new URL("../public/platform.css", import.meta.url);
const htmlUrl = new URL("../public/platform.html", import.meta.url);

test("rooms expose a real world filter instead of an inert All Worlds button", async () => {
  const source = await readFile(platformUrl, "utf8");
  const renderStart = source.indexOf("function renderRooms()");
  const renderEnd = source.indexOf("function renderRoom()", renderStart);
  const roomPage = source.slice(renderStart, renderEnd);

  assert.match(roomPage, /data-world-filter/);
  assert.match(roomPage, /value="sangtian"/);
  assert.match(roomPage, /嘉靖财政危局/);
  assert.match(roomPage, /value="caesar"/);
  assert.match(source, /Rome, 44 BC/);
  assert.match(source, /data-world-chip/);
  assert.match(source, /data-action="clear-world-filter"/);
  assert.match(source, /history\.replaceState\(null, "", worldId \? `\/rooms\?worldId=/);
  assert.match(source, /worldFilter\.value = ""/);
  assert.match(source, /syncRoomFilterChip\(worldId\)/);
  assert.match(source, /"clear-world-filter": \(\) => location\.assign\("\/rooms"\)/);
});

test("Create Room requires an explicit playable multiplayer world", async () => {
  const source = await readFile(platformUrl, "utf8");
  const dialogStart = source.indexOf("function openCreateRoomDialog(");
  const dialogEnd = source.indexOf("async function hydrateRoom", dialogStart);
  const dialog = source.slice(dialogStart, dialogEnd);
  const actionStart = source.indexOf('"create-room":');
  const action = source.slice(actionStart, source.indexOf('"share-invite":', actionStart));

  assert.match(dialog, /document\.createElement\("dialog"\)/);
  assert.match(dialog, /Choose the world you want to play/);
  assert.match(dialog, /\/api\/v4\/worlds/);
  assert.match(dialog, /world\.playable && world\.modes\?\.includes\("multiplayer"\)/);
  assert.match(dialog, /input type="radio" name="worldId"/);
  assert.match(dialog, /Choose a world before creating the room/);
  assert.match(dialog, /JSON\.stringify\(\{ worldId, idempotencyKey \}\)/);
  assert.match(dialog, /many-worlds:create-room:/);
  assert.match(dialog, /localStorage\.removeItem\(idempotencyStorageKey\)/);
  assert.match(action, /openCreateRoomDialog\(\)/);
  assert.doesNotMatch(action, /\|\| "caesar"/);
});

test("My Rooms leaves readable width for the title and moves its action below", async () => {
  const [css, html] = await Promise.all([readFile(cssUrl, "utf8"), readFile(htmlUrl, "utf8")]);

  assert.match(css, /\.my-room \{[^}]*grid-template-columns:83px minmax\(0,1fr\)/s);
  assert.match(css, /\.my-room \.btn \{ grid-column:2;/);
  assert.match(css, /word-break:normal/);
  assert.match(html, /platform\.css\?v=[^"']+/);
  assert.match(html, /platform\.js\?v=[^"']+/);
});

test("Rooms mobile layout clears the legacy table minimum width", async () => {
  const css = await readFile(cssUrl, "utf8");
  const mobileStart = css.lastIndexOf("@media (max-width: 560px)");
  const mobileCss = css.slice(mobileStart);

  assert.match(mobileCss, /\.rooms-page \.filters \{ flex-wrap: wrap; \}/);
  assert.match(mobileCss, /\.room-row \{ width: 100%; min-width: 0;/);
  assert.match(mobileCss, /\.action-row \{ display: flex; flex-direction: column;/);
});
