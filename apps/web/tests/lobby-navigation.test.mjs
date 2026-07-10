import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("大厅、选角和游戏页形成完整 Web 导航链路", async () => {
  const [home, roles, game, server] = await Promise.all([
    readFile(new URL("../public/home.html", import.meta.url), "utf8"),
    readFile(new URL("../public/role-select.html", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8")
  ]);

  assert.match(home, /home\.js/);
  assert.match(home, /story-lobby-root/);
  assert.match(roles, /role-select\.js/);
  assert.match(roles, /role-select-root/);
  assert.match(game, /app\.js/);
  assert.match(game, /web-game-root/);
  assert.match(server, /home\.html/);
  assert.match(server, /role-select\.html/);
  assert.match(server, /index\.html/);
});
