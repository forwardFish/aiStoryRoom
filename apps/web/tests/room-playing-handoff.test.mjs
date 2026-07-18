import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a lobby poll enters the continuous game as soon as the room starts", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const start = source.indexOf("async function hydrateSharedRoom(roomId)");
  const end = source.indexOf("const actions =", start);
  const hydrateRoom = source.slice(start, end);

  assert.match(hydrateRoom, /room\.status === "playing"/);
  assert.match(hydrateRoom, /location\.assign\(`\/game\?runId=\$\{encodeURIComponent\(room\.id\)\}`\)/);
  assert.ok(
    hydrateRoom.indexOf('room.status === "playing"') < hydrateRoom.indexOf("sharedMultiplayerRoomMarkup(room)"),
    "navigation must happen before rendering a stale lobby state"
  );
});
