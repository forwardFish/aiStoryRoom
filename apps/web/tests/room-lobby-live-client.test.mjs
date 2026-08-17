import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createRoomLobbyLiveClient } from "../public/room-lobby-live-client.js";

test("platform loads the live client before its narrow room integration", async () => {
  const [html, platform] = await Promise.all([
    readFile(new URL("../public/platform.html", import.meta.url), "utf8"),
    readFile(new URL("../public/platform.js", import.meta.url), "utf8"),
  ]);
  assert.ok(
    html.indexOf("/room-lobby-live-client.js") < html.indexOf("/platform.js"),
    "the live client must register before platform room hydration starts",
  );

  const appShellStart = platform.indexOf("function appShell(");
  const appShellEnd = platform.indexOf("function renderLobbyCountdown", appShellStart);
  const appShell = platform.slice(appShellStart, appShellEnd);
  assert.match(appShell, /MANY_WORLDS_ROOM_LOBBY_LIVE\?\.createRoomLobbyLiveClient/);
  assert.match(appShell, /roomLobbyLiveClient\.start\(\)/);
  assert.match(appShell, /roomLobbyLiveClient\?\.destroy\(\)/);
  assert.match(appShell, /30_000/);
  assert.doesNotMatch(appShell, /hydrateSharedRoom\(roomMatch\[1\]\); \}, 5000/);

  const hydrateStart = platform.indexOf("async function hydrateSharedRoom(roomId)");
  const hydrateEnd = platform.indexOf("function startSoloFromWorld", hydrateStart);
  const hydrate = platform.slice(hydrateStart, hydrateEnd);
  assert.match(hydrate, /sharedRoomHydrationQueuedRoomId = roomId/);
  assert.match(hydrate, /if \(sharedRoomHydrationPromise\) return sharedRoomHydrationPromise/);
  assert.match(hydrate, /while \(sharedRoomHydrationQueuedRoomId\)/);
  assert.match(hydrate, /currentPath !== `\/rooms\/\$\{roomId\}`/);
});

test("connects on the approved same-origin path and subscribes without a token", async () => {
  const timers = createTimers();
  const sockets = createFakeWebSockets();
  const documentTarget = createEventTarget({ visibilityState: "visible" });
  const windowTarget = createEventTarget();
  let refreshes = 0;
  const client = createRoomLobbyLiveClient({
    roomId: "room_123",
    refresh: async () => { refreshes += 1; },
    WebSocketCtor: sockets.WebSocket,
    documentTarget,
    windowTarget,
    locationTarget: { origin: "https://test.ourmanyworlds.com" },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  client.start();
  await flush();
  assert.equal(refreshes, 1);
  assert.equal(sockets.instances.length, 1);
  assert.equal(sockets.instances[0].url, "wss://test.ourmanyworlds.com/api/v4/room-lobby/socket");
  assert.equal(sockets.instances[0].url.includes("token="), false);

  sockets.instances[0].open();
  assert.deepEqual(JSON.parse(sockets.instances[0].sent[0]), {
    type: "room.subscribe",
    schemaVersion: "room_lobby_socket_v1",
    roomId: "room_123",
  });
  sockets.instances[0].message({
    type: "room.subscribed",
    schemaVersion: "room_lobby_socket_v1",
    roomId: "room_123",
  });
  await flush();
  assert.equal(refreshes, 2);
  assert.equal(timers.delays().includes(30_000), true);

  client.destroy();
  assert.equal(timers.size(), 0);
  assert.equal(documentTarget.listenerCount(), 0);
  assert.equal(windowTarget.listenerCount(), 0);
});

test("coalesces matching invalidations and ignores unrelated or malformed messages", async () => {
  const timers = createTimers();
  const sockets = createFakeWebSockets();
  let refreshes = 0;
  const client = createRoomLobbyLiveClient({
    roomId: "room_a",
    refresh: async () => { refreshes += 1; },
    WebSocketCtor: sockets.WebSocket,
    documentTarget: createEventTarget({ visibilityState: "visible" }),
    windowTarget: createEventTarget(),
    locationTarget: { origin: "http://localhost:5177" },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });
  client.start();
  await flush();
  const socket = sockets.instances[0];
  socket.open();
  socket.message({ type: "room.subscribed", schemaVersion: "room_lobby_socket_v1", roomId: "room_a" });
  await flush();
  const before = refreshes;

  socket.message({ type: "room.invalidated", schemaVersion: "room_lobby_changed_v1", roomId: "room_b" });
  socket.rawMessage("not-json");
  socket.message({ type: "room.invalidated", schemaVersion: "room_lobby_changed_v1", roomId: "room_a" });
  socket.message({ type: "room.invalidated", schemaVersion: "room_lobby_changed_v1", roomId: "room_a" });
  assert.equal(timers.count(50), 1);
  timers.run(50);
  await flush();
  assert.equal(refreshes, before + 1);
  client.destroy();
});

test("keeps refreshes single-flight and drains one queued refresh", async () => {
  const timers = createTimers();
  const sockets = createFakeWebSockets();
  const first = deferred();
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  const client = createRoomLobbyLiveClient({
    roomId: "room_queue",
    refresh: async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (calls === 1) await first.promise;
      active -= 1;
    },
    WebSocketCtor: sockets.WebSocket,
    documentTarget: createEventTarget({ visibilityState: "visible" }),
    windowTarget: createEventTarget(),
    locationTarget: { origin: "http://localhost:5177" },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  client.start();
  await flush();
  assert.equal(calls, 1);
  const queuedA = client.requestRefresh();
  const queuedB = client.requestRefresh();
  assert.equal(queuedA, queuedB);
  first.resolve();
  await queuedA;
  assert.equal(calls, 2);
  assert.equal(maximumActive, 1);
  client.destroy();
});

test("reconnects with bounded backoff and refreshes on visibility, online, and fallback", async () => {
  const timers = createTimers();
  const sockets = createFakeWebSockets();
  const documentTarget = createEventTarget({ visibilityState: "hidden" });
  const windowTarget = createEventTarget();
  let refreshes = 0;
  const client = createRoomLobbyLiveClient({
    roomId: "room_reconnect",
    refresh: async () => { refreshes += 1; },
    WebSocketCtor: sockets.WebSocket,
    documentTarget,
    windowTarget,
    locationTarget: { origin: "http://localhost:5177" },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    random: () => 0,
  });
  client.start();
  await flush();
  assert.equal(refreshes, 1);

  sockets.instances[0].serverClose();
  assert.equal(timers.count(375), 1);
  timers.run(375);
  assert.equal(sockets.instances.length, 2);

  documentTarget.visibilityState = "visible";
  documentTarget.emit("visibilitychange");
  await flush();
  assert.equal(refreshes, 2);
  windowTarget.emit("online");
  await flush();
  assert.equal(refreshes, 3);
  timers.run(30_000);
  await flush();
  assert.equal(refreshes, 4);

  client.destroy();
  const socketCount = sockets.instances.length;
  windowTarget.emit("online");
  documentTarget.emit("visibilitychange");
  await flush();
  assert.equal(refreshes, 4);
  assert.equal(sockets.instances.length, socketCount);
  assert.equal(timers.size(), 0);
});

test("access revocation refreshes authority once and stops reconnecting", async () => {
  const timers = createTimers();
  const sockets = createFakeWebSockets();
  let refreshes = 0;
  const client = createRoomLobbyLiveClient({
    roomId: "room_revoked",
    refresh: async () => { refreshes += 1; },
    WebSocketCtor: sockets.WebSocket,
    documentTarget: createEventTarget({ visibilityState: "visible" }),
    windowTarget: createEventTarget(),
    locationTarget: { origin: "https://test.ourmanyworlds.com" },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });
  client.start();
  await flush();
  const socket = sockets.instances[0];
  socket.open();
  socket.message({ type: "room.subscribed", schemaVersion: "room_lobby_socket_v1", roomId: "room_revoked" });
  await flush();
  const before = refreshes;
  socket.message({ type: "room.access_revoked", schemaVersion: "room_lobby_socket_v1", roomId: "room_revoked" });
  await flush();
  assert.equal(refreshes, before + 1);
  assert.equal(timers.delays().some((delay) => delay < 30_000), false);
  client.destroy();
});

test("keeps the thirty-second authority fallback when WebSocket is unavailable", async () => {
  const timers = createTimers();
  let refreshes = 0;
  const client = createRoomLobbyLiveClient({
    roomId: "room_fallback",
    refresh: async () => { refreshes += 1; },
    WebSocketCtor: null,
    documentTarget: createEventTarget({ visibilityState: "visible" }),
    windowTarget: createEventTarget(),
    locationTarget: { origin: "http://localhost:5177" },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });
  client.start();
  await flush();
  assert.equal(refreshes, 1);
  assert.equal(timers.count(30_000), 1);
  timers.run(30_000);
  await flush();
  assert.equal(refreshes, 2);
  assert.equal(timers.count(30_000), 1);
  client.destroy();
});

test("a subscription timeout closes the socket and schedules reconnect", async () => {
  const timers = createTimers();
  const sockets = createFakeWebSockets();
  const client = createRoomLobbyLiveClient({
    roomId: "room_subscribe_timeout",
    refresh: async () => {},
    WebSocketCtor: sockets.WebSocket,
    documentTarget: createEventTarget({ visibilityState: "visible" }),
    windowTarget: createEventTarget(),
    locationTarget: { origin: "https://test.ourmanyworlds.com" },
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    random: () => 0,
  });
  client.start();
  const socket = sockets.instances[0];
  socket.open();
  assert.equal(timers.count(10_000), 1);
  timers.run(10_000);
  assert.deepEqual(socket.closeCalls, [{ code: 1008, reason: "subscription timeout" }]);
  assert.equal(timers.count(375), 1);
  timers.run(375);
  assert.equal(sockets.instances.length, 2);
  client.destroy();
});

function createFakeWebSockets() {
  const instances = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closeCalls = [];
      instances.push(this);
    }
    send(value) { this.sent.push(value); }
    open() { this.onopen?.(); }
    message(value) { this.rawMessage(JSON.stringify(value)); }
    rawMessage(data) { this.onmessage?.({ data }); }
    serverClose() { this.onclose?.({ code: 1006 }); }
    close(code, reason) { this.closeCalls.push({ code, reason }); }
  }
  return { WebSocket: FakeWebSocket, instances };
}

function createTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    count(delay) { return [...tasks.values()].filter((task) => task.delay === delay).length; },
    delays() { return [...tasks.values()].map((task) => task.delay); },
    run(delay) {
      const entry = [...tasks.entries()].find(([, task]) => task.delay === delay);
      assert.ok(entry, `expected timer with delay ${delay}`);
      tasks.delete(entry[0]);
      entry[1].callback();
    },
    size() { return tasks.size; },
  };
}

function createEventTarget(initial = {}) {
  const listeners = new Map();
  return {
    ...initial,
    addEventListener(type, listener) {
      const values = listeners.get(type) || new Set();
      values.add(listener);
      listeners.set(type, values);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type) { for (const listener of listeners.get(type) || []) listener(); },
    listenerCount() { return [...listeners.values()].reduce((total, values) => total + values.size, 0); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
