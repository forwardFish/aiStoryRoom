import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderRoomSelectionPage, roomRoleArtwork } from "../public/room-role-selection-view.js";

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
  assert.match(game, /main-game\.css/);
  assert.match(game, /continuous-game\.css/);
  assert.doesNotMatch(game, /<script[^>]+src="app\.js/);
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
  assert.match(roomPage, /rooms-table-card/);
  assert.match(roomPage, /data-action="open-tab"/);
  assert.match(roomPage, /data-action="my-tab"/);
  assert.doesNotMatch(roomPage, /<aside class="my-rooms"/);
  assert.doesNotMatch(roomPage, /Night Council|After Hours|Board Vote|fixture-caesar-waiting/);
});

test("Open Rooms and My Rooms share one table while keeping their own actions", async () => {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const start = source.indexOf("function roomAction(");
  const end = source.indexOf("function roomWorldTitle(", start);
  const roomDataFlow = source.slice(start, end);

  assert.match(roomDataFlow, /view === "open"/);
  assert.match(roomDataFlow, /label: "Join"/);
  assert.match(roomDataFlow, /: "Start"/);
  assert.match(roomDataFlow, /roomRows\(activeRooms, roomsView\.activeTab\)/);
  assert.match(roomDataFlow, /roomsView\.openRooms = Array\.isArray\(data\.rooms\)/);
  assert.match(roomDataFlow, /roomsView\.myRooms = Array\.isArray\(data\.myRooms\)/);
  assert.doesNotMatch(roomDataFlow, /Night Council|After Hours|Board Vote/);
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

  assert.match(authPage, /Welcome to \$\{BRAND_NAME\}/);
  assert.match(authPage, /textContent = BRAND_TAGLINE/);
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
  assert.match(source, /setToken\(session\.accessToken\s*\|\|\s*session\.token\)/);
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

test("room lobby uses one component with world title, banner and portraits supplied by the API", async () => {
  for (const world of [
    { id: "caesar", title: "Caesar: The Last Spring of the Republic", banner: "/assets/game/caesar/room-banner.png", role: "Brutus", portrait: "/assets/game/caesar/brutus.png" },
    { id: "sangtian", title: "桑田诏：嘉靖财政危局", banner: "/assets/game/sangtian/background.png", role: "浙江总督", portrait: "/assets/game/sangtian/governor.png" }
  ]) {
    const room = {
      id: `room-${world.id}`,
      title: `${world.title}：没有影子的客人`,
      worldId: world.id,
      world: { title: world.title, bannerArtwork: world.banner },
      status: "waiting_players",
      code: `${world.id.toUpperCase()}1`,
      maxPlayers: world.id === "caesar" ? 6 : 3,
      minPlayers: 1,
      hostRoleLocked: false,
      players: [{ userId: "host", nickname: "Host", roleId: "role-1", roleName: world.role, ready: false }],
      roles: [{ id: "role-1", roleKey: "role_key", roleName: world.role, portrait: world.portrait, status: "claimed", claimedByCurrentUser: true }]
    };

    const rendered = await renderRoomLobby(room);
    assert.equal(rendered.querySelector(".room-world h1").textContent, world.title);
    assert.equal(rendered.querySelector(".room-world p").textContent, "没有影子的客人");
    assert.equal(rendered.querySelector(".mw-room-banner").getAttribute("src"), world.banner);
    assert.equal(rendered.querySelector(".mw-room-role-card img").getAttribute("src"), world.portrait);
    rendered.ownerDocument.defaultView.close();
  }

  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const start = source.indexOf("function roomWorldTitle(");
  const end = source.indexOf("async function refreshRoomsList", start);
  assert.doesNotMatch(source.slice(start, end), /worldId === ["'](?:caesar|sangtian)|roomRoleArtwork\(["'](?:caesar|sangtian)/);
});

async function renderRoomLobby(room) {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const dom = new JSDOM('<!doctype html><main id="platform-app"></main>', {
    url: "http://127.0.0.1:5200/rooms/room-1",
    runScripts: "outside-only"
  });
  dom.window.document.cookie = "many_worlds_session_hint=1; Path=/";
  // Polling belongs to the long-lived browser page, not this one-shot DOM
  // rendering test. Disabling it prevents a failed assertion from retaining
  // an interval and hanging the entire web test process.
  dom.window.setInterval = () => 0;
  dom.window.clearInterval = () => {};
  dom.window.MANY_WORLDS_ROOM_SELECTION = { renderRoomSelectionPage, roomRoleArtwork };
  dom.window.fetch = async () => new Response(JSON.stringify(room), { status: 200, headers: { "content-type": "application/json" } });
  dom.window.eval(source);
  const deadline = Date.now() + 2_000;
  while (dom.window.document.querySelector(".mw-room-invite-card strong")?.textContent !== room.code) {
    if (Date.now() >= deadline) {
      dom.window.close();
      throw new Error("Timed out waiting for live room controls");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return dom.window.document.querySelector("#platform-app");
}

test("rooms disclose automatic refresh only when live polling is active", async () => {
  const signedOut = await renderRoomsPage(false);
  assert.equal(signedOut.document.querySelector("[data-room-refresh-note]")?.hidden, true);
  assert.match(signedOut.document.querySelector("[data-live-rooms]")?.textContent || "", /Log in to view live rooms/);
  assert.equal(signedOut.fetchCalls.length, 0);
  assert.deepEqual(signedOut.intervals, []);
  signedOut.window.close();

  const signedIn = await renderRoomsPage(true);
  assert.equal(signedIn.document.querySelector("[data-room-refresh-note]")?.hidden, false);
  assert.equal(signedIn.fetchCalls.length, 1);
  assert.deepEqual(signedIn.intervals, [5000, 250]);
  signedIn.window.close();
});

test("Open Rooms and My Rooms switch the shared table data and action", async () => {
  const rendered = await renderRoomsPage(true, {
    rooms: [{ id: "open-1", code: "OPEN1", worldId: "caesar", title: "Night Council", status: "waiting_players", maxPlayers: 6, players: [{ id: "p1" }] }],
    myRooms: [{ id: "mine-1", worldId: "caesar", title: "My Night Council", status: "waiting_players", maxPlayers: 6, players: [{ id: "p1" }, { id: "p2" }], nextAction: "open" }]
  });

  assert.equal(rendered.document.querySelector(".room-action")?.textContent, "Join");
  rendered.document.querySelector('[data-action="my-tab"]')?.click();
  assert.equal(rendered.document.querySelector(".room-action")?.textContent, "Start");
  assert.equal(rendered.document.querySelector('[data-action="my-tab"]')?.getAttribute("aria-selected"), "true");
  assert.equal(rendered.document.querySelectorAll(".rooms-table-card").length, 1);
  rendered.window.close();
});

test("the live invitation dialog uses the exact product brand", async () => {
  const room = {
    id: "room-brand", title: "Brand Room", worldId: "caesar", status: "waiting_players", code: "BRAND1",
    maxPlayers: 3, minPlayers: 3, isHost: true, hostRoleLocked: true,
    players: [{ userId: "host", nickname: "Host", roleId: "role-1", roleName: "Brutus", ready: true }],
    roles: [{ id: "role-1", roleName: "Brutus", status: "claimed", claimedByCurrentUser: true }]
  };
  const rendered = await renderRoomLobby(room);
  const window = rendered.ownerDocument.defaultView;
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  rendered.querySelector('[data-action="share-invite"]')?.click();
  const deadline = Date.now() + 2_000;
  while (!window.document.querySelector(".share-dialog")) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the invitation dialog");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const dialog = window.document.querySelector(".invite-share-dialog");
  const copy = dialog?.querySelector(".share-channels p")?.textContent || "";
  assert.equal(copy, "Invite friends to this room on Our Many Worlds.");
  assert.equal(dialog?.querySelector(".share-room-head h2")?.textContent, "Shared Story Room");
  assert.equal(dialog?.querySelectorAll(".share-network-row button").length, 6);
  assert.ok(dialog?.querySelector(".share-status"));
  assert.ok(dialog?.querySelector(".share-player-count"));
  assert.ok(dialog?.querySelector(".share-reward-emblem"));
  assert.ok(dialog?.querySelector(".share-reward-coins"));
  assert.ok(dialog?.querySelector(".poster-preview"));
  assert.ok(dialog?.querySelector(".share-link-label"));
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const posterSource = source.slice(source.indexOf("async function buildInvitePoster"), source.indexOf("async function copyInviteLink"));
  assert.doesNotMatch(posterSource, /Room code:/);
  window.close();
});

async function renderRoomsPage(signedIn, responseData = { rooms: [], myRooms: [] }) {
  const source = await readFile(new URL("../public/platform.js", import.meta.url), "utf8");
  const dom = new JSDOM('<!doctype html><main id="platform-app"></main>', {
    url: "http://127.0.0.1:5200/rooms",
    runScripts: "outside-only"
  });
  if (signedIn) dom.window.document.cookie = "many_worlds_session_hint=1; Path=/";
  const fetchCalls = [];
  const intervals = [];
  dom.window.setInterval = (_callback, milliseconds) => { intervals.push(milliseconds); return intervals.length; };
  dom.window.clearInterval = () => {};
  dom.window.fetch = async (url) => {
    fetchCalls.push(String(url));
    return new Response(JSON.stringify(responseData), { status: 200, headers: { "content-type": "application/json" } });
  };
  dom.window.eval(source);
  const deadline = Date.now() + 2_000;
  while (!dom.window.document.querySelector(".rooms-page") || (signedIn && (fetchCalls.length === 0 || /Loading available rooms/.test(dom.window.document.querySelector("[data-live-rooms]")?.textContent || "")))) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the rooms page");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { window: dom.window, document: dom.window.document, fetchCalls, intervals };
}
