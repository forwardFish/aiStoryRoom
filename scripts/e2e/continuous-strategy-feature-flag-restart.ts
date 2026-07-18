import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { CONTINUOUS_ENGINE_VERSION, LEGACY_ENGINE_VERSION, LEGACY_STRATEGY_VERSION } from "@ai-story/shared";

type Json = Record<string, any>;
type Player = { email: string; password: string; nickname: string; cookie?: string };
type AcceptanceState = {
  schema: string;
  stamp: string;
  players: Player[];
  startedRoomId: string;
  waitingRoomId: string;
  prepareApiPid: number;
  prepareWorkerPid: number;
  preparedAt: string;
};

const phase = String(process.argv[2] || "").trim();
const baseUrl = String(process.env.MANY_WORLDS_API_BASE || "http://127.0.0.1:3128/api").replace(/\/$/, "");
const statePath = resolve(process.env.MANY_WORLDS_STATE_PATH || "D:/tmp/continuous-feature-flag-restart-state.json");
const evidencePath = resolve(process.env.MANY_WORLDS_EVIDENCE_PATH || "docs/auto-execute/evidence/continuous-strategy/feature-flag-restart/report.json");
const mailSink = resolve(process.env.AUTH_MAIL_SINK_FILE || "D:/tmp/continuous-feature-flag-restart-mail.ndjson");
const schema = String(process.env.MANY_WORLDS_DB_SCHEMA || "").trim();
const apiPid = Number(process.env.ACCEPTANCE_API_PID || 0);
const workerPid = Number(process.env.ACCEPTANCE_WORKER_PID || 0);
const prisma = new PrismaClient();
const wait = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
let activeHeartbeatKeeper: ReturnType<typeof createHeartbeatKeeper> | null = null;

async function request(path: string, init: RequestInit = {}, cookie = "", allowError = false) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!allowError && !response.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${response.status} ${payload.code || "UNKNOWN"}: ${payload.message || JSON.stringify(payload)}`);
  }
  return { payload, response };
}

function post(path: string, body: Json, cookie = "", allowError = false) {
  return request(path, { method: "POST", body: JSON.stringify(body) }, cookie, allowError);
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  for (const value of headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""]) {
    const match = value.match(/(?:^|,\s*)many_worlds_session=([^;]+)/);
    if (match) return `many_worlds_session=${match[1]}`;
  }
  throw new Error("login did not issue the HttpOnly many_worlds_session cookie");
}

async function verificationToken(email: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const lines = (await readFile(mailSink, "utf8").catch(() => "")).trim().split(/\r?\n/).filter(Boolean);
    for (const line of lines.reverse()) {
      const message = JSON.parse(line);
      if (String(message.to).toLowerCase() !== email.toLowerCase()) continue;
      const urlText = String(message.text || message.html || "").match(/https?:\/\/[^\s<]+/)?.[0];
      const token = urlText ? new URL(urlText.replace(/&amp;/g, "&")).searchParams.get("token") : null;
      if (token) return token;
    }
    await wait(100);
  }
  throw new Error(`verification mail not found for ${email}`);
}

async function registerPlayer(stamp: string, index: number): Promise<Player> {
  const player = {
    email: `continuous-flag-${stamp}-p${index}@example.test`,
    password: "MvpTest2026!",
    nickname: `flag-restart-player-${index}`
  };
  const registered = await post("/v4/auth/register", {
    email: player.email,
    password: player.password,
    nickname: player.nickname,
    returnTo: "/rooms"
  });
  assert.equal(registered.payload.accepted, true);
  assert.equal("verificationToken" in registered.payload, false, "registration must not expose a verification token");
  const verified = await post("/v4/auth/verify", { token: await verificationToken(player.email) });
  assert.equal(verified.payload.verified, true);
  return player;
}

async function login(player: Player) {
  const response = await post("/v4/auth/login", { email: player.email, password: player.password });
  player.cookie = sessionCookie(response.response);
  const me = await request("/v4/auth/me", {}, player.cookie);
  assert.equal(me.payload.email, player.email);
}

function cookie(player: Player) {
  assert.ok(player.cookie, `missing session cookie for ${player.email}`);
  return player.cookie;
}

function createHeartbeatKeeper(players: Player[], stamp: string) {
  const roomIds = new Set<string>();
  const sequences = new Map<string, number>();
  let running = false;
  let task: Promise<void> | null = null;
  let failure: Error | null = null;
  let heartbeatChain: Promise<void> = Promise.resolve();
  let lastHeartbeatBatchAt = 0;

  const heartbeat = async (player: Player, playerIndex: number, roomId: string) => {
    const key = `${roomId}:${playerIndex}`;
    const sequence = (sequences.get(key) || 0) + 1;
    sequences.set(key, sequence);
    const beat = await post(`/v4/rooms/${roomId}/presence/heartbeat`, {
      sessionInstanceId: `flag-restart-${stamp}-${roomId}-p${playerIndex + 1}`,
      heartbeatSequence: sequence,
      lastAppliedDeliverySequence: 0
    }, cookie(player), true);
    if (beat.response.ok || (beat.response.status === 409 && beat.payload.code === "WINDOW_MOVED")) return;
    throw new Error(`heartbeat ${roomId} player ${playerIndex + 1} -> ${beat.response.status} ${beat.payload.code || "UNKNOWN"}`);
  };

  const runHeartbeatBatch = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = heartbeatChain.then(async () => {
      const delayMs = Math.max(0, 650 - (Date.now() - lastHeartbeatBatchAt));
      if (delayMs) await wait(delayMs);
      try {
        return await operation();
      } finally {
        lastHeartbeatBatchAt = Date.now();
      }
    });
    heartbeatChain = next.then(() => undefined, () => undefined);
    return next;
  };

  const beatAll = () => runHeartbeatBatch(async () => {
    for (const roomId of roomIds) {
      await Promise.all(players.map((player, playerIndex) => heartbeat(player, playerIndex, roomId)));
    }
  });

  const beatNewRoom = (roomId: string) => runHeartbeatBatch(async () => {
    await Promise.all(players.map((player, playerIndex) => heartbeat(player, playerIndex, roomId)));
    roomIds.add(roomId);
  });

  return {
    async addRoom(roomId: string) {
      if (roomIds.has(roomId)) return;
      // addRoom can run while the periodic keeper is in flight. Serializing and
      // spacing both paths prevents the same room/session from receiving two
      // heartbeats inside the server's independent 500 ms presence interval.
      await beatNewRoom(roomId);
    },
    start() {
      if (running) return;
      running = true;
      task = (async () => {
        while (running) {
          await wait(2_000);
          if (!running) break;
          try {
            await beatAll();
          } catch (error) {
            failure = error instanceof Error ? error : new Error(String(error));
            running = false;
          }
        }
      })();
    },
    assertHealthy() {
      if (failure) throw failure;
    },
    async stop() {
      running = false;
      await task;
      if (failure) throw failure;
    }
  };
}

async function setUpReadyRoom(players: Player[], stamp: string, suffix: string) {
  const created = (await post("/v4/rooms", {
    worldId: "sangtian",
    title: `feature-flag-${suffix}-${stamp}`,
    visibility: "private",
    maxPlayers: 3
  }, cookie(players[0]))).payload;
  assert.equal(created.status, "waiting_players");
  assert.equal(created.engineVersion, CONTINUOUS_ENGINE_VERSION);
  assert.equal(created.strategyVersion, "sangtian_v1_1");
  const roomId = String(created.id);

  for (let index = 0; index < players.length; index += 1) {
    if (index > 0) {
      const joined = (await post("/v4/rooms/join-by-code", { code: created.code }, cookie(players[index]))).payload;
      assert.equal(joined.id, roomId);
    }
    const room = (await request(`/v4/rooms/${roomId}`, {}, cookie(players[index]))).payload;
    const role = room.roles.find((candidate: Json) => candidate.humanSelectable && candidate.status === "available");
    assert.ok(role, `player ${index + 1} must see an available role in ${roomId}`);
    await post(`/v4/rooms/${roomId}/role`, { roleId: role.id }, cookie(players[index]));
    if (index === 0) await post(`/v4/rooms/${roomId}/role/lock`, {}, cookie(players[index]));
  }
  for (const player of players) await post(`/v4/rooms/${roomId}/ready`, { ready: true }, cookie(player));
  const ready = (await request(`/v4/rooms/${roomId}`, {}, cookie(players[0]))).payload;
  assert.equal(ready.startEnabled, true);
  assert.equal(ready.players.filter((entry: Json) => entry.ready).length, 3);
  return roomId;
}

async function game(player: Player, roomId: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await request(`/v4/rooms/${roomId}/game`, {}, cookie(player), true);
    if (response.response.ok) return response.payload;
    if (response.response.status !== 409 || response.payload.code !== "WINDOW_MOVED") {
      throw new Error(`GET game ${roomId} -> ${response.response.status} ${response.payload.code}: ${response.payload.message}`);
    }
    await wait(250);
  }
  throw new Error(`game projection did not stabilize for ${roomId}`);
}

function slotCommand(projection: Json, action: Json, stamp: string, roomId: string, prefix: string) {
  return {
    idempotencyKey: `${prefix}-${stamp}-${roomId}-${projection.player.roleKey}-${projection.run.stageIndex}`,
    windowId: projection.actionWindow.id,
    controlEpoch: projection.myControl.epoch,
    actionKey: action.actionKey
  };
}

async function waitForAdvance(player: Player, roomId: string, stageIndex: number) {
  const deadline = Date.now() + 180_000;
  let projection = await game(player, roomId);
  while (Date.now() < deadline) {
    if (stageIndex === 7 ? projection.run.status === "chapter_generated" : projection.run.stageIndex === stageIndex + 1) return projection;
    await wait(500);
    projection = await game(player, roomId);
  }
  throw new Error(`room ${roomId} stage ${stageIndex} did not advance: ${JSON.stringify({ run: projection.run, window: projection.actionWindow })}`);
}

async function playStage(players: Player[], state: AcceptanceState, roomId: string, stageIndex: number) {
  let opening = await game(players[0], roomId);
  assert.equal(opening.run.stageIndex, stageIndex);
  assert.equal(opening.run.engineVersion, CONTINUOUS_ENGINE_VERSION);
  assert.equal(opening.run.strategyVersion, "sangtian_v1_1");
  if (opening.access.state === "REQUIRES_UNLOCK") {
    assert.equal(stageIndex, 4, "the shared unlock gate must occur exactly before stage four");
    const unlocked = (await post(`/v4/story-runs/${roomId}/unlock`, {
      idempotencyKey: `flag-restart-unlock-${state.stamp}-${roomId}`
    }, cookie(players[0]))).payload;
    assert.equal(unlocked.unlocked, true);
    assert.equal(unlocked.creditsCharged, 100);
    opening = await game(players[0], roomId);
  }
  assert.equal(opening.actionWindow.status, "MAIN_OPEN");

  for (const player of players) {
    const projection = await game(player, roomId);
    assert.equal(projection.availableMainActions.length, 3);
    const response = (await post(
      `/v4/rooms/${roomId}/game/actions/main`,
      slotCommand(projection, projection.availableMainActions[0], state.stamp, roomId, "main"),
      cookie(player)
    )).payload;
    assert.equal(response.accepted, true);
  }

  for (const player of players) {
    let projection = await game(player, roomId);
    if (projection.pendingReaction) {
      projection = (await post(
        `/v4/rooms/${roomId}/game/events/${projection.pendingReaction.eventId}/reaction`,
        slotCommand(projection, projection.pendingReaction.options[0], state.stamp, roomId, "reaction"),
        cookie(player)
      )).payload.gameProjection;
    }
    if (projection.availableManeuvers.length) {
      projection = (await post(
        `/v4/rooms/${roomId}/game/actions/maneuver`,
        slotCommand(projection, projection.availableManeuvers[0], state.stamp, roomId, "maneuver"),
        cookie(player)
      )).payload.gameProjection;
    }
    const done = (await post(`/v4/rooms/${roomId}/game/layout/done`, {
      idempotencyKey: `done-${state.stamp}-${roomId}-${projection.player.roleKey}-${stageIndex}`,
      windowId: projection.actionWindow.id,
      controlEpoch: projection.myControl.epoch
    }, cookie(player))).payload;
    assert.equal(done.accepted, true);
  }
  return waitForAdvance(players[0], roomId, stageIndex);
}

async function runPrepare() {
  assert.equal(process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED, "true");
  assert.match(schema, /^cs_accept_flag_/);
  assert.ok(apiPid > 0 && workerPid > 0);
  const stamp = `${Date.now()}-${process.pid}`;
  const players = [] as Player[];
  for (let index = 1; index <= 3; index += 1) players.push(await registerPlayer(stamp, index));
  for (const player of players) await login(player);
  const credits = (await post("/v4/credits/test-grant", { runId: stamp, amount: 300 }, cookie(players[0]))).payload;
  assert.ok(Number(credits.balance.available) >= 300);

  const startedRoomId = await setUpReadyRoom(players, stamp, "started-before-restart");
  const waitingRoomId = await setUpReadyRoom(players, stamp, "waiting-before-restart");
  const started = (await post(`/v4/rooms/${startedRoomId}/start`, {}, cookie(players[0]))).payload;
  assert.equal(started.status, "playing");
  assert.equal(started.gameProjection.run.stageIndex, 1);

  const [startedDb, waitingDb] = await Promise.all([
    prisma.storyRun.findUniqueOrThrow({ where: { id: startedRoomId } }),
    prisma.storyRun.findUniqueOrThrow({ where: { id: waitingRoomId } })
  ]);
  assert.equal(startedDb.engineVersion, CONTINUOUS_ENGINE_VERSION);
  assert.equal(waitingDb.engineVersion, CONTINUOUS_ENGINE_VERSION);
  assert.equal(startedDb.strategyVersion, "sangtian_v1_1");
  assert.equal(waitingDb.strategyVersion, "sangtian_v1_1");
  assert.equal(startedDb.status, "playing");
  assert.equal(waitingDb.status, "waiting_players");
  // The world actor is a deterministic system force, not a claimable player
  // role. Only the three playable roles receive RoleControl rows.
  assert.equal(await prisma.roleControl.count({ where: { runId: startedRoomId } }), 3);
  assert.equal(await prisma.roleControl.count({ where: { runId: waitingRoomId } }), 0);

  const state: AcceptanceState = {
    schema,
    stamp,
    players: players.map(({ cookie: _cookie, ...player }) => player),
    startedRoomId,
    waitingRoomId,
    prepareApiPid: apiPid,
    prepareWorkerPid: workerPid,
    preparedAt: new Date().toISOString()
  };
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ phase: "prepare", status: "PASS", ...state, players: state.players.map(({ password: _password, ...player }) => player) }, null, 2));
}

async function roomEvidence(roomId: string) {
  const [run, storyRoles, windows, resolutions, personalResults, publicResults, controls, systemActions, systemActionsWithRole] = await Promise.all([
    prisma.storyRun.findUniqueOrThrow({ where: { id: roomId } }),
    prisma.storyRole.count({ where: { runId: roomId } }),
    prisma.actionWindow.count({ where: { runId: roomId } }),
    prisma.directorResolution.count({ where: { runId: roomId } }),
    prisma.narrativeEntry.count({ where: { runId: roomId, entryType: "stage_personal_result" } }),
    prisma.narrativeEntry.count({ where: { runId: roomId, entryType: "stage_public_result" } }),
    prisma.roleControl.count({ where: { runId: roomId } }),
    prisma.playerAction.count({ where: { runId: roomId, actionSlot: "SYSTEM_ACTION", actorKind: "SYSTEM" } }),
    prisma.playerAction.count({ where: { runId: roomId, actionSlot: "SYSTEM_ACTION", roleId: { not: null } } })
  ]);
  assert.equal(run.engineVersion, CONTINUOUS_ENGINE_VERSION);
  assert.equal(run.strategyVersion, "sangtian_v1_1");
  assert.equal(run.status, "chapter_generated");
  assert.equal(storyRoles, 3);
  assert.equal(windows, 7);
  assert.equal(resolutions, 7);
  assert.equal(personalResults, 21);
  assert.equal(publicResults, 7);
  assert.equal(controls, 3);
  assert.equal(systemActions, 7);
  assert.equal(systemActionsWithRole, 0);
  return { roomId, engineVersion: run.engineVersion, strategyVersion: run.strategyVersion, status: run.status, storyRoles, windows, resolutions, personalResults, publicResults, controls, systemActions, systemActionsWithRole };
}

async function runVerify() {
  assert.equal(process.env.MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED, "false");
  assert.ok(apiPid > 0 && workerPid > 0);
  const state = JSON.parse(await readFile(statePath, "utf8")) as AcceptanceState;
  assert.equal(state.schema, schema);
  assert.notEqual(apiPid, state.prepareApiPid, "API must be a different process after the flag restart");
  assert.notEqual(workerPid, state.prepareWorkerPid, "Worker must be a different process after the flag restart");
  for (const player of state.players) await login(player);
  const heartbeatKeeper = createHeartbeatKeeper(state.players, state.stamp);
  activeHeartbeatKeeper = heartbeatKeeper;
  await heartbeatKeeper.addRoom(state.startedRoomId);
  heartbeatKeeper.start();

  const [startedBeforeContinue, waitingBeforeStart] = await Promise.all([
    request(`/v4/rooms/${state.startedRoomId}`, {}, cookie(state.players[0])),
    request(`/v4/rooms/${state.waitingRoomId}`, {}, cookie(state.players[0]))
  ]);
  assert.equal(startedBeforeContinue.payload.status, "playing");
  assert.equal(waitingBeforeStart.payload.status, "waiting_players");
  for (const room of [startedBeforeContinue.payload, waitingBeforeStart.payload]) {
    assert.equal(room.engineVersion, CONTINUOUS_ENGINE_VERSION);
    assert.equal(room.strategyVersion, "sangtian_v1_1");
  }

  const waitingStarted = (await post(`/v4/rooms/${state.waitingRoomId}/start`, {}, cookie(state.players[0]))).payload;
  assert.equal(waitingStarted.status, "playing");
  assert.equal(waitingStarted.gameProjection.run.engineVersion, CONTINUOUS_ENGINE_VERSION);
  assert.equal(waitingStarted.gameProjection.run.strategyVersion, "sangtian_v1_1");
  await heartbeatKeeper.addRoom(state.waitingRoomId);

  const newLegacyRoom = (await post("/v4/rooms", {
    worldId: "sangtian",
    title: `flag-off-new-room-${state.stamp}`,
    visibility: "private",
    maxPlayers: 3
  }, cookie(state.players[0]))).payload;
  assert.equal(newLegacyRoom.engineVersion, LEGACY_ENGINE_VERSION);
  assert.equal(newLegacyRoom.strategyVersion, LEGACY_STRATEGY_VERSION);

  const legacySolo = (await post("/v4/rooms/solo", { worldId: "caesar", roleKey: "brutus" }, cookie(state.players[0]))).payload;
  const legacySoloDb = await prisma.storyRun.findUniqueOrThrow({ where: { id: String(legacySolo.id) } });
  assert.equal(legacySoloDb.engineVersion, LEGACY_ENGINE_VERSION);
  assert.equal(legacySoloDb.strategyVersion, LEGACY_STRATEGY_VERSION);

  const stageEvidence = [] as Json[];
  for (let stageIndex = 1; stageIndex <= 7; stageIndex += 1) {
    heartbeatKeeper.assertHealthy();
    const [startedNext, waitingNext] = await Promise.all([
      playStage(state.players, state, state.startedRoomId, stageIndex),
      playStage(state.players, state, state.waitingRoomId, stageIndex)
    ]);
    stageEvidence.push({
      stageIndex,
      startedRun: { stageIndex: startedNext.run.stageIndex, status: startedNext.run.status },
      waitingRun: { stageIndex: waitingNext.run.stageIndex, status: waitingNext.run.status }
    });
  }

  const [startedRun, waitingRun] = await Promise.all([
    roomEvidence(state.startedRoomId),
    roomEvidence(state.waitingRoomId)
  ]);
  const newLegacyDb = await prisma.storyRun.findUniqueOrThrow({ where: { id: String(newLegacyRoom.id) } });
  assert.equal(newLegacyDb.engineVersion, LEGACY_ENGINE_VERSION);
  assert.equal(newLegacyDb.strategyVersion, LEGACY_STRATEGY_VERSION);
  assert.equal(await prisma.roleControl.count({ where: { runId: newLegacyDb.id } }), 0);
  assert.equal(await prisma.roleControl.count({ where: { runId: legacySoloDb.id } }), 0);
  heartbeatKeeper.assertHealthy();
  await heartbeatKeeper.stop();
  activeHeartbeatKeeper = null;

  const report = {
    status: "PASS",
    checkpoint: "D11_FEATURE_FLAG_RESTART",
    database: { provider: "supabase", schema },
    processRestart: {
      apiPidBefore: state.prepareApiPid,
      apiPidAfter: apiPid,
      workerPidBefore: state.prepareWorkerPid,
      workerPidAfter: workerPid,
      flagBefore: true,
      flagAfter: false
    },
    frozenRuns: { startedBeforeRestart: startedRun, waitingBeforeRestart: waitingRun },
    newAfterRestart: {
      roomId: newLegacyDb.id,
      engineVersion: newLegacyDb.engineVersion,
      strategyVersion: newLegacyDb.strategyVersion,
      roleControls: 0
    },
    legacySolo: {
      runId: legacySoloDb.id,
      engineVersion: legacySoloDb.engineVersion,
      strategyVersion: legacySoloDb.strategyVersion,
      roleControls: 0
    },
    stages: stageEvidence,
    preparedAt: state.preparedAt,
    completedAt: new Date().toISOString()
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, evidencePath }, null, 2));
}

async function main() {
  if (phase === "prepare") await runPrepare();
  else if (phase === "verify") await runVerify();
  else throw new Error("usage: tsx continuous-strategy-feature-flag-restart.ts <prepare|verify>");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (activeHeartbeatKeeper) {
    await activeHeartbeatKeeper.stop().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
  await prisma.$disconnect();
});
