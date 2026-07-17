import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

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
  assert.match(game, /game-bootstrap\.js/);
  assert.doesNotMatch(game, /room-main-game\.css/);
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

test("deployed platform authentication uses Vercel's same-origin API proxy", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");

  assert.match(source, /const deployedApiBase = "\/api"/);
  assert.match(source, /fetch\(apiUrl\(url\)/);
  assert.match(source, /fetch\(apiUrl\(`\/api\/v4\/referrals\/qr/);
  assert.doesNotMatch(source, /fetch\(`\/api\/v4\/referrals\/qr/);
  assert.doesNotMatch(source, /response\.verificationToken/);
  assert.doesNotMatch(source, /response\.resetToken/);
  assert.match(source, /\/api\/v4\/auth\/verification\/resend/);
  assert.match(source, /\/api\/v4\/auth\/google\/challenge/);
  assert.match(source, /Account created\. Check your email to verify it/);
});

test("login, signup and password reset surfaces stay account-only", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const start = source.indexOf("function renderAuth()");
  const end = source.indexOf("function renderAccount()", start);
  const authPage = source.slice(start, end);

  assert.match(authPage, /Welcome to Many Worlds/);
  assert.match(authPage, /Log in or create an account to continue/);
  assert.match(authPage, /Enter your display name/);
  assert.doesNotMatch(authPage, /Set new password|data-reset-form|data-sign-out|data-action="show-signup"/);
  assert.match(authPage, /data-google-signin/);
  assert.doesNotMatch(authPage, /Caesar|story|world title|room|Continue to/i);
  assert.match(source, /manyworlds\.invalid/);
  assert.match(source, /\/join", "\/rooms", "\/game"/);
});

test("legacy invite registration cannot authenticate before email verification", async () => {
  const source = await readFile(new URL("../public/join.html", import.meta.url), "utf8");

  assert.match(source, /minlength="8"/);
  assert.match(source, /\/v4\/auth\/verify/);
  assert.match(source, /\/v4\/auth\/login/);
  assert.doesNotMatch(source, /setToken\(result\.token\)/);
  assert.match(source, /setToken\(session\.accessToken\|\|session\.token\)/);
  assert.doesNotMatch(source, /opening|story|room|Caesar/i);
});

test("room lobby enables Ready per player and Start Game only for a fully ready host", async () => {
  const baseRoom = {
    id: "room-1",
    title: "嘉靖财政危局测试房间",
    worldId: "sangtian",
    status: "waiting_players",
    code: "TEST123",
    maxPlayers: 3,
    minPlayers: 3,
    hostRoleLocked: true,
    players: [
      { userId: "host", nickname: "Host", roleId: "role-1", roleName: "浙江总督", ready: true },
      { userId: "p2", nickname: "Player 2", roleId: "role-2", roleName: "浙江巡抚", ready: false },
      { userId: "p3", nickname: "Player 3", roleId: "role-3", roleName: "清流县令", ready: false }
    ],
    roles: [
      { id: "role-1", roleName: "浙江总督", status: "claimed", claimedByCurrentUser: false },
      { id: "role-2", roleName: "浙江巡抚", status: "claimed", claimedByCurrentUser: true },
      { id: "role-3", roleName: "清流县令", status: "claimed", claimedByCurrentUser: false }
    ]
  };

  const nonHost = await renderRoomLobby({ ...baseRoom, isHost: false });
  assert.equal(nonHost.querySelector('[data-action="ready"]').disabled, false);
  assert.equal(nonHost.querySelector('[data-action="start-game"]'), null);
  nonHost.ownerDocument.defaultView.close();

  const waitingHostRoom = structuredClone(baseRoom);
  waitingHostRoom.isHost = true;
  waitingHostRoom.roles.forEach((role) => { role.claimedByCurrentUser = role.id === "role-1"; });
  const waitingHost = await renderRoomLobby(waitingHostRoom);
  assert.equal(waitingHost.querySelector('[data-action="ready"]').disabled, true);
  assert.equal(waitingHost.querySelector('[data-action="ready"]').textContent, "Ready ✓");
  assert.equal(waitingHost.querySelector('[data-action="start-game"]').disabled, true);
  waitingHost.ownerDocument.defaultView.close();

  const readyHostRoom = structuredClone(waitingHostRoom);
  readyHostRoom.players.forEach((player) => { player.ready = true; });
  const readyHost = await renderRoomLobby(readyHostRoom);
  assert.equal(readyHost.querySelector('[data-action="start-game"]').disabled, false);
  assert.match(readyHost.querySelector(".room-footer p").textContent, /All players are ready/);
  readyHost.ownerDocument.defaultView.close();
});

test("room lobby keeps the world title separate from the room title", async () => {
  const room = {
    id: "room-caesar",
    title: "Caesar: The Last Spring of the Republic：没有影子的客人",
    worldId: "caesar",
    status: "waiting_players",
    code: "CAESAR1",
    maxPlayers: 6,
    minPlayers: 3,
    hostRoleLocked: false,
    players: [{ userId: "host", nickname: "Host", roleId: "role-1", roleName: "Brutus", ready: false }],
    roles: [{ id: "role-1", roleName: "Brutus", status: "claimed", claimedByCurrentUser: true }]
  };

  const rendered = await renderRoomLobby(room);
  assert.equal(rendered.querySelector(".room-world h1").textContent, "Caesar: The Last Spring of the Republic");
  assert.equal(rendered.querySelector(".room-world p").textContent, "没有影子的客人");
  rendered.ownerDocument.defaultView.close();
});

async function renderRoomLobby(room) {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const dom = new JSDOM('<!doctype html><main id="platform-app"></main>', {
    url: "http://127.0.0.1:5200/rooms/room-1",
    runScripts: "outside-only"
  });
  dom.window.document.cookie = "many_worlds_session_hint=1; Path=/";
  dom.window.fetch = async () => new Response(JSON.stringify(room), { status: 200, headers: { "content-type": "application/json" } });
  dom.window.eval(source);
  const deadline = Date.now() + 2_000;
  while (!dom.window.document.querySelector(".room-footer")?.textContent.includes(room.isHost && room.players.every((player) => player.ready) ? "All players are ready" : room.isHost ? "You are ready" : "Confirm that")) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for live room controls");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return dom.window.document.querySelector("#platform-app");
}
