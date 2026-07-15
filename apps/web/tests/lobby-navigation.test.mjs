import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("大厅、选角和游戏页形成完整 Web 导航链路", async () => {
  const [home, roles, game, trio, server] = await Promise.all([
    readFile(new URL("../public/home.html", import.meta.url), "utf8"),
    readFile(new URL("../public/role-select.html", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/trio.html", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8")
  ]);

  assert.match(home, /home\.js/);
  assert.match(home, /story-lobby-root/);
  assert.match(roles, /role-select\.js/);
  assert.match(roles, /role-select-root/);
  assert.match(game, /app\.js/);
  assert.match(game, /web-game-root/);
  assert.match(trio, /trio\.js/);
  assert.match(trio, /trio-root/);
  assert.match(server, /home\.html/);
  assert.match(server, /role-select\.html/);
  assert.match(server, /index\.html/);
  assert.match(server, /trio\.html/);
  assert.match(server, /legacyRedirects/);
  assert.match(server, /credits-success\.html/);
});

test("room rendering only retains real API rooms", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const start = source.indexOf("function renderRooms()");
  const end = source.indexOf("function renderRoom()", start);
  const roomPage = source.slice(start, end);

  assert.match(roomPage, /data-live-rooms/);
  assert.match(roomPage, /Loading available rooms/);
  assert.match(roomPage, /Loading your rooms/);
  assert.doesNotMatch(roomPage, /Night Council|After Hours|Board Vote|fixture-caesar-waiting/);
});

test("deployed platform authentication targets the Railway API instead of Vercel", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");

  assert.match(source, /const deployedApiBase = "https:\/\/appsapi-test\.up\.railway\.app\/api"/);
  assert.match(source, /fetch\(apiUrl\(url\)/);
  assert.match(source, /fetch\(apiUrl\(`\/api\/v4\/referrals\/qr/);
  assert.doesNotMatch(source, /fetch\(`\/api\/v4\/referrals\/qr/);
});
