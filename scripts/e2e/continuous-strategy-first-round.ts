import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type Json = Record<string, any>;
type Player = { label: string; email: string; cookie: string; heartbeatSequence: number; roleId?: string };

const baseUrl = String(process.env.MANY_WORLDS_API_BASE || "http://127.0.0.1:3103/api").replace(/\/$/, "");
const mailSink = resolve(process.env.AUTH_MAIL_SINK_FILE || "apps/api/.auth-mail-sink.ndjson");
const stamp = `${Date.now()}-${process.pid}`;
const accountStamp = String(process.env.MANY_WORLDS_ACCOUNT_STAMP || stamp);

async function request(path: string, init: RequestInit = {}, cookie = ""): Promise<{ payload: Json; response: Response }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${response.status} ${payload.code || "UNKNOWN"}: ${payload.message || JSON.stringify(payload)}`);
  }
  return { payload, response };
}

async function post(path: string, body: Json, cookie = "") {
  return request(path, { method: "POST", body: JSON.stringify(body) }, cookie);
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = value.match(/(?:^|,\s*)many_worlds_session=([^;]+)/);
    if (match) return `many_worlds_session=${match[1]}`;
  }
  throw new Error("verification/login response did not issue the HttpOnly session cookie");
}

async function verificationToken(email: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const lines = (await readFile(mailSink, "utf8").catch(() => "")).trim().split(/\r?\n/).filter(Boolean);
    for (const line of lines.reverse()) {
      const message = JSON.parse(line);
      if (String(message.to).toLowerCase() !== email.toLowerCase()) continue;
      const urlText = String(message.text || message.html || "").match(/https?:\/\/[^\s<]+/)?.[0];
      if (!urlText) continue;
      const token = new URL(urlText.replace(/&amp;/g, "&")).searchParams.get("token");
      if (token) return token;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`verification mail not found for ${email}`);
}

async function createPlayer(index: number): Promise<Player> {
  const email = `continuous-${accountStamp}-p${index}@example.test`;
  const password = "MvpTest2026!";
  const label = `continuous-player-${index}`;
  if (!process.env.MANY_WORLDS_ACCOUNT_STAMP) {
    const registered = await post("/v4/auth/register", { email, password, nickname: label, returnTo: "/rooms" });
    assert.equal(registered.payload.accepted, true);
    assert.equal("verificationToken" in registered.payload, false, "registration must not expose a verification token");
    const token = await verificationToken(email);
    const verified = await post("/v4/auth/verify", { token });
    assert.equal(verified.payload.verified, true);
    assert.ok(sessionCookie(verified.response));
  }
  const login = await post("/v4/auth/login", { email, password });
  const cookie = sessionCookie(login.response);
  const me = await request("/v4/auth/me", {}, cookie);
  assert.equal(me.payload.email, email);
  return { label, email, cookie, heartbeatSequence: 0 };
}

async function game(player: Player, roomId: string) {
  return (await request(`/v4/rooms/${roomId}/game`, {}, player.cookie)).payload;
}

let lastHeartbeatAt = 0;
let heartbeatInFlight: Promise<void> | null = null;

async function keepPlayersOnline(players: Player[], roomId: string, force = false) {
  if (!force && Date.now() - lastHeartbeatAt < 2_000) return;
  if (heartbeatInFlight) return heartbeatInFlight;
  heartbeatInFlight = (async () => {
    await Promise.all(players.map(async (player) => {
      player.heartbeatSequence += 1;
      const response = await fetch(`${baseUrl}/v4/rooms/${roomId}/presence/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: player.cookie },
        body: JSON.stringify({
          sessionInstanceId: `api-seven-${accountStamp}-${player.label}`,
          heartbeatSequence: player.heartbeatSequence,
          lastAppliedDeliverySequence: 0
        })
      });
      const payload = await response.json().catch(() => ({})) as Json;
      if (!response.ok && !(response.status === 409 && payload.code === "WINDOW_MOVED")) {
        throw new Error(`heartbeat ${player.label} -> ${response.status} ${payload.code || "UNKNOWN"}`);
      }
    }));
    lastHeartbeatAt = Date.now();
  })();
  try {
    await heartbeatInFlight;
  } finally {
    heartbeatInFlight = null;
  }
}

function slotCommand(projection: Json, action: Json, prefix: string) {
  return {
    idempotencyKey: `${prefix}-${stamp}-${projection.player.roleKey}-${projection.run.stageIndex}`,
    windowId: projection.actionWindow.id,
    controlEpoch: projection.myControl.epoch,
    actionKey: action.actionKey
  };
}

async function main() {
  const players = [] as Player[];
  for (let index = 1; index <= 3; index += 1) players.push(await createPlayer(index));

  const created = (await post("/v4/rooms", {
    worldId: "sangtian",
    title: `continuous-supabase-first-round-${stamp}`,
    visibility: "private",
    maxPlayers: 3
  }, players[0].cookie)).payload;
  assert.equal(created.status, "waiting_players");
  assert.notEqual(created.engineVersion, "legacy-v1");
  assert.equal(created.maxPlayers, 3);
  const roomId = String(created.id);

  const chooseRole = async (player: Player, isHost = false) => {
    const room = (await request(`/v4/rooms/${roomId}`, {}, player.cookie)).payload;
    const role = room.roles.find((candidate: Json) => candidate.humanSelectable && candidate.status === "available");
    assert.ok(role, `${player.label} must see a playable available role`);
    await post(`/v4/rooms/${roomId}/role`, { roleId: role.id }, player.cookie);
    player.roleId = role.id;
    if (isHost) await post(`/v4/rooms/${roomId}/role/lock`, {}, player.cookie);
  };

  await chooseRole(players[0], true);
  for (const player of players.slice(1)) {
    const joined = (await post("/v4/rooms/join-by-code", { code: created.code }, player.cookie)).payload;
    assert.equal(joined.id, roomId);
    await chooseRole(player);
  }
  for (const player of players) await post(`/v4/rooms/${roomId}/ready`, { ready: true }, player.cookie);

  const readyRoom = (await request(`/v4/rooms/${roomId}`, {}, players[0].cookie)).payload;
  assert.equal(readyRoom.startEnabled, true);
  assert.equal(readyRoom.players.filter((player: Json) => player.ready).length, 3);
  const started = (await post(`/v4/rooms/${roomId}/start`, {}, players[0].cookie)).payload;
  assert.equal(started.status, "playing");
  assert.equal(started.gameProjection.run.stageIndex, 1);
  await keepPlayersOnline(players, roomId, true);
  let backgroundHeartbeatFailure: unknown = null;
  const heartbeatTimer = setInterval(() => {
    void keepPlayersOnline(players, roomId, true).catch((error) => {
      backgroundHeartbeatFailure ||= error;
    });
  }, 4_000);
  heartbeatTimer.unref?.();

  const totalStages = Math.max(1, Math.min(7, Number(process.env.MANY_WORLDS_STAGES || 1)));
  const stages = [] as Json[];
  let unlockEvidence: Json | null = null;
  let next = started.gameProjection;
  for (let stageIndex = 1; stageIndex <= totalStages; stageIndex += 1) {
    await keepPlayersOnline(players, roomId, true);
    let opening = [] as Json[];
    for (const player of players) opening.push(await game(player, roomId));
    assert.ok(opening.every((projection) => projection.run.stageIndex === stageIndex));
    assert.equal(new Set(opening.map((projection) => projection.player.roleId)).size, 3);
    assert.equal(new Set(opening.map((projection) => projection.privateBrief.text)).size, 3, `stage ${stageIndex} must keep role-private opening projections distinct`);

    if (opening[0].access.state === "REQUIRES_UNLOCK") {
      assert.equal(stageIndex, 4, "the shared paywall must open exactly before stage four");
      const granted = (await post("/v4/credits/test-grant", { runId: accountStamp, amount: 200 }, players[0].cookie)).payload;
      assert.ok(Number(granted.balance.available) >= 200);
      const unlocked = (await post(`/v4/story-runs/${roomId}/unlock`, { idempotencyKey: `unlock-${stamp}-${roomId}` }, players[0].cookie)).payload;
      assert.equal(unlocked.unlocked, true);
      assert.equal(unlocked.alreadyUnlocked, false);
      assert.equal(unlocked.creditsCharged, 100);
      assert.equal(unlocked.gameProjection.run.status, "playing");
      assert.equal(unlocked.gameProjection.actionWindow.status, "MAIN_OPEN");
      const replay = (await post(`/v4/story-runs/${roomId}/unlock`, { idempotencyKey: `unlock-replay-${stamp}-${roomId}` }, players[1].cookie)).payload;
      assert.equal(replay.alreadyUnlocked, true);
      assert.equal(replay.creditsCharged, 0);
      assert.equal(replay.payerUserId, unlocked.payerUserId);
      unlockEvidence = { stageIndex, charged: unlocked.creditsCharged, replayCharged: replay.creditsCharged, payerUserId: unlocked.payerUserId };
      opening = [];
      for (const player of players) opening.push(await game(player, roomId));
    }
    assert.ok(opening.every((projection) => projection.run.status === "playing" && projection.actionWindow.status === "MAIN_OPEN"));
    assert.ok(opening.every((projection) => projection.availableMainActions.length === 3));

    await keepPlayersOnline(players, roomId);
    await Promise.all(players.map(async (player) => {
      const projection = await game(player, roomId);
      const selected = projection.availableMainActions[0];
      const submitted = (await post(`/v4/rooms/${roomId}/game/actions/main`, slotCommand(projection, selected, "main"), player.cookie)).payload;
      assert.equal(submitted.accepted, true);
      assert.equal(submitted.gameProjection.actionWindow.myParticipant.mainStatus, "SUBMITTED");
    }));

    await keepPlayersOnline(players, roomId);
    const interactionCounts = await Promise.all(players.map(async (player) => {
      let reactions = 0;
      let maneuvers = 0;
      let projection = await game(player, roomId);
      if (projection.pendingReaction) {
        const option = projection.pendingReaction.options[0];
        const reaction = slotCommand(projection, option, "reaction");
        const response = (await post(`/v4/rooms/${roomId}/game/events/${projection.pendingReaction.eventId}/reaction`, reaction, player.cookie)).payload;
        assert.equal(response.accepted, true);
        projection = response.gameProjection;
        reactions += 1;
      }
      if (projection.availableManeuvers.length) {
        const response = (await post(`/v4/rooms/${roomId}/game/actions/maneuver`, slotCommand(projection, projection.availableManeuvers[0], "maneuver"), player.cookie)).payload;
        assert.equal(response.accepted, true);
        projection = response.gameProjection;
        maneuvers += 1;
      }
      const done = (await post(`/v4/rooms/${roomId}/game/layout/done`, {
        idempotencyKey: `done-${stamp}-${projection.player.roleKey}-${stageIndex}`,
        windowId: projection.actionWindow.id,
        controlEpoch: projection.myControl.epoch
      }, player.cookie)).payload;
      assert.equal(done.accepted, true);
      return { reactions, maneuvers };
    }));
    const reactions = interactionCounts.reduce((total, item) => total + item.reactions, 0);
    const maneuvers = interactionCounts.reduce((total, item) => total + item.maneuvers, 0);

    const deadline = Date.now() + Number(process.env.MANY_WORLDS_STAGE_TIMEOUT_MS || 180_000);
    next = await game(players[0], roomId);
    while (Date.now() < deadline && (stageIndex < 7 ? next.run.stageIndex === stageIndex : next.run.status !== "chapter_generated")) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      await keepPlayersOnline(players, roomId);
      next = await game(players[0], roomId);
    }
    if (stageIndex < 7) assert.equal(next.run.stageIndex, stageIndex + 1, `independent worker must advance stage ${stageIndex}`);
    else assert.equal(next.run.status, "chapter_generated", "stage seven must publish the completed run");
    assert.ok(next.latestPublicResult?.content);
    const personalResults = [] as string[];
    for (const player of players) {
      const projection = await game(player, roomId);
      assert.ok(projection.latestPersonalResult?.content);
      personalResults.push(projection.latestPersonalResult.content);
    }
    assert.equal(new Set(personalResults).size, 3, `stage ${stageIndex} must publish three distinct personal results`);
    stages.push({ stageIndex, mainActions: 3, maneuvers, reactions, nextStageIndex: next.run.stageIndex, runStatus: next.run.status });
  }

  const events = [] as Json[];
  for (const player of players) {
    const deliveries = [] as Json[];
    let after = 0;
    do {
      const page = (await request(`/v4/rooms/${roomId}/events?afterDeliverySequence=${after}`, {}, player.cookie)).payload;
      deliveries.push(...page.deliveries);
      const nextAfter = Number(page.nextAfterDeliverySequence || after);
      if (nextAfter <= after || !page.deliveries.length) break;
      after = nextAfter;
    } while (true);
    assert.ok(deliveries.length > 0);
    assert.deepEqual(deliveries.map((delivery: Json) => delivery.deliverySequence), deliveries.map((_delivery: Json, index: number) => index + 1));
    events.push({ user: player.label, count: deliveries.length, next: after });
  }
  clearInterval(heartbeatTimer);
  if (backgroundHeartbeatFailure) throw backgroundHeartbeatFailure;

  let results: Json[] | null = null;
  if (totalStages === 7) {
    results = [];
    for (const player of players) results.push((await request(`/v4/rooms/${roomId}/result`, {}, player.cookie)).payload);
    assert.equal(new Set(results.map((result) => result.publicEnding.content)).size, 1);
    assert.equal(new Set(results.map((result) => result.personalEnding.content)).size, 3);
    assert.ok(results.every((result) => result.myKeyDecisions.length >= 7));
  }

  const report = {
    status: "PASS",
    database: "supabase",
    schema: String(process.env.MANY_WORLDS_DB_SCHEMA || "unknown"),
    roomId,
    engineVersion: next.run.engineVersion,
    strategyVersion: next.run.strategyVersion,
    players: players.map((player) => ({ label: player.label, email: player.email, roleId: player.roleId })),
    stages,
    unlock: unlockEvidence,
    results: results?.map((result) => ({ personalRoleId: result.personalEnding.roleId, decisions: result.myKeyDecisions.length, crossImpacts: result.authorizedCrossImpacts.length })) || null,
    eventDeliveries: events,
    completedAt: new Date().toISOString()
  };
  const evidencePath = resolve(process.env.MANY_WORLDS_EVIDENCE_PATH || `docs/auto-execute/evidence/continuous-strategy/dev-first-round-${stamp}/report.json`);
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, evidencePath }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
