import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

type Json = Record<string, any>;
type Player = { email: string; cookie: string; sequence: number };

const baseUrl = String(process.env.MANY_WORLDS_API_BASE || "http://127.0.0.1:3103/api").replace(/\/$/, "");
const mailSink = resolve(process.env.AUTH_MAIL_SINK_FILE || "apps/api/.auth-mail-sink.ndjson");
const evidencePath = resolve(process.env.MANY_WORLDS_EVIDENCE_PATH || "docs/auto-execute/evidence/continuous-strategy/dev-supabase-dropout-20260716-01/report.json");
const stamp = `${Date.now()}-${process.pid}`;
const prisma = new PrismaClient();
const dropoutIndex = Number(process.env.MANY_WORLDS_DROPOUT_INDEX || 2);
if (!Number.isInteger(dropoutIndex) || dropoutIndex < 0 || dropoutIndex > 2) throw new Error("MANY_WORLDS_DROPOUT_INDEX must be 0, 1, or 2");

async function request(path: string, init: RequestInit = {}, cookie = "", allowError = false) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!allowError && !response.ok) throw new Error(`${init.method || "GET"} ${path} -> ${response.status} ${payload.code || "UNKNOWN"}: ${payload.message || JSON.stringify(payload)}`);
  return { payload, response };
}

function post(path: string, body: Json, cookie = "", allowError = false) {
  return request(path, { method: "POST", body: JSON.stringify(body) }, cookie, allowError);
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = value.match(/(?:^|,\s*)many_worlds_session=([^;]+)/);
    if (match) return `many_worlds_session=${match[1]}`;
  }
  throw new Error("session cookie missing");
}

async function verificationToken(email: string) {
  const deadline = Date.now() + 10_000;
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
  throw new Error(`verification mail missing for ${email}`);
}

async function createPlayer(index: number): Promise<Player> {
  const email = `continuous-dropout-${stamp}-p${index}@example.test`;
  const password = "MvpTest2026!";
  await post("/v4/auth/register", { email, password, nickname: `dropout-player-${index}`, returnTo: "/rooms" });
  await post("/v4/auth/verify", { token: await verificationToken(email) });
  const login = await post("/v4/auth/login", { email, password });
  return { email, cookie: sessionCookie(login.response), sequence: 0 };
}

async function game(player: Player, roomId: string) {
  return (await request(`/v4/rooms/${roomId}/game`, {}, player.cookie)).payload;
}

async function heartbeat(player: Player, roomId: string, session: string) {
  player.sequence += 1;
  return (await post(`/v4/rooms/${roomId}/presence/heartbeat`, {
    sessionInstanceId: session,
    heartbeatSequence: player.sequence,
    lastAppliedDeliverySequence: 0
  }, player.cookie)).payload;
}

async function waitFor(label: string, read: () => Promise<Json>, predicate: (value: Json) => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = {} as Json;
  while (Date.now() < deadline) {
    latest = await read();
    if (predicate(latest)) return latest;
    await wait(250);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(latest)}`);
}

function slotCommand(projection: Json, action: Json, prefix: string) {
  return {
    idempotencyKey: `${prefix}-${stamp}-${projection.player.roleKey}-${projection.run.stageIndex}`,
    windowId: projection.actionWindow.id,
    controlEpoch: projection.myControl.epoch,
    actionKey: action.actionKey
  };
}

async function wait(ms: number) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function main() {
  const players = await Promise.all([1, 2, 3].map(createPlayer));
  const created = (await post("/v4/rooms", {
    worldId: "sangtian",
    title: `continuous-dropout-${stamp}`,
    visibility: "private",
    maxPlayers: 3
  }, players[0].cookie)).payload;
  const roomId = String(created.id);

  const chooseRole = async (player: Player, lock = false) => {
    const room = (await request(`/v4/rooms/${roomId}`, {}, player.cookie)).payload;
    const role = room.roles.find((candidate: Json) => candidate.humanSelectable && candidate.status === "available");
    assert.ok(role);
    await post(`/v4/rooms/${roomId}/role`, { roleId: role.id }, player.cookie);
    if (lock) await post(`/v4/rooms/${roomId}/role/lock`, {}, player.cookie);
  };
  await chooseRole(players[0], true);
  for (const player of players.slice(1)) {
    await post("/v4/rooms/join-by-code", { code: created.code }, player.cookie);
    await chooseRole(player);
  }
  for (const player of players) await post(`/v4/rooms/${roomId}/ready`, { ready: true }, player.cookie);
  await post(`/v4/rooms/${roomId}/start`, {}, players[0].cookie);

  const sessions = players.map((_, index) => `dropout-${stamp}-p${index + 1}`);
  const initialHeartbeats = await Promise.all(players.map((player, index) => heartbeat(player, roomId, sessions[index])));
  assert.ok(initialHeartbeats.every((result) => result.accepted));
  const activePlayers = players.map((player, index) => ({ player, index })).filter(({ index }) => index !== dropoutIndex);
  const droppedPlayer = players[dropoutIndex];
  const initialDropped = await game(droppedPlayer, roomId);
  const staleEpoch = initialDropped.myControl.epoch;
  const staleMain = initialDropped.availableMainActions[0];

  let keepAlive = true;
  let keepAliveError: unknown;
  const keepAliveTask = (async () => {
    while (keepAlive) {
      await wait(2_000);
      try {
        await Promise.all(activePlayers.map(({ player, index }) => heartbeat(player, roomId, sessions[index])));
      } catch (error) {
        // Resolution advances currentNodeId and creates the next ActionWindow
        // in separate committed checkpoints.  A heartbeat landing in that
        // short interval correctly receives WINDOW_MOVED; a real client
        // refreshes its projection and retries instead of treating it as a
        // lost session.
        if (/409 WINDOW_MOVED/.test(String(error))) continue;
        keepAliveError = error;
        keepAlive = false;
      }
    }
  })();

  try {
    // The two connected humans keep playing instead of waiting for the absent
    // participant.  This is the product behavior the takeover path must enable.
    for (const { player } of activePlayers) {
      const projection = await game(player, roomId);
      await post(`/v4/rooms/${roomId}/game/actions/main`, slotCommand(projection, projection.availableMainActions[0], "main"), player.cookie);
    }
    const offline = await waitFor("dropped player offline grace", () => game(droppedPlayer, roomId), (projection) => projection.myControl.mode === "HUMAN_OFFLINE_GRACE", 45_000);
    assert.equal(offline.myControl.epoch, staleEpoch, "offline grace must not change the fencing epoch");
    assert.ok((await game(activePlayers[0].player, roomId)).roleControllerStates.every((state: Json) => state.roleId === initialDropped.player.roleId || state.controllerKind === "HUMAN" || state.controllerKind === "SYSTEM"));

    const takenOver = await waitFor("dropped player AI takeover", () => game(droppedPlayer, roomId), (projection) => projection.myControl.mode === "AI_ACTIVE", 60_000);
    assert.equal(takenOver.myControl.epoch, staleEpoch + 1);
    // This lane verifies NEXT_WINDOW reclaim deterministically.  Wait until
    // the agent has sealed its whole current-stage layout; reclaim before
    // that point is a different, valid immediate-MANEUVER path.
    const aiSealed = await waitFor("AI seals current layout", () => game(droppedPlayer, roomId), (projection) =>
      projection.actionWindow.myParticipant.mainStatus === "SUBMITTED"
      && Boolean(projection.actionWindow.myParticipant.doneAt)
      && projection.myActions.some((action: Json) => action.actorKind === "AI_TAKEOVER")
    , 60_000);

    const stale = await post(`/v4/rooms/${roomId}/game/actions/main`, {
      idempotencyKey: `stale-${stamp}`,
      windowId: initialDropped.actionWindow.id,
      controlEpoch: staleEpoch,
      actionKey: staleMain.actionKey
    }, droppedPlayer.cookie, true);
    assert.equal(stale.response.status, 409);
    assert.equal(stale.payload.code, "ROLE_CONTROL_CHANGED");

    const returnHeartbeat = await heartbeat(droppedPlayer, roomId, sessions[dropoutIndex]);
    assert.equal(returnHeartbeat.rolePresence.mode, "AI_ACTIVE", "heartbeat alone must not steal control back from AI");
    const reclaimed = (await post(`/v4/rooms/${roomId}/game/control/reclaim`, {
      idempotencyKey: `reclaim-${stamp}`,
      expectedControlEpoch: aiSealed.myControl.epoch
    }, droppedPlayer.cookie)).payload.gameProjection;
    assert.equal(reclaimed.myControl.mode, "HUMAN_RECLAIM_PENDING");
    assert.equal(reclaimed.myControl.epoch, staleEpoch + 2);

    await waitFor("interaction grace", () => game(activePlayers[0].player, roomId), (projection) => projection.actionWindow.status === "INTERACTION_GRACE");
    for (const { player } of activePlayers) {
      let projection = await game(player, roomId);
      if (projection.pendingReaction) {
        projection = (await post(`/v4/rooms/${roomId}/game/events/${projection.pendingReaction.eventId}/reaction`, slotCommand(projection, projection.pendingReaction.options[0], "reaction"), player.cookie)).payload.gameProjection;
      }
      if (projection.availableManeuvers.length) {
        projection = (await post(`/v4/rooms/${roomId}/game/actions/maneuver`, slotCommand(projection, projection.availableManeuvers[0], "maneuver"), player.cookie)).payload.gameProjection;
      }
      await post(`/v4/rooms/${roomId}/game/layout/done`, {
        idempotencyKey: `done-${stamp}-${projection.player.roleKey}`,
        windowId: projection.actionWindow.id,
        controlEpoch: projection.myControl.epoch
      }, player.cookie);
    }

    const nextStage = await waitFor("room advances while player is absent", () => game(droppedPlayer, roomId), (projection) => projection.run.stageIndex === 2, 45_000);
    assert.equal(nextStage.myControl.mode, "HUMAN_ACTIVE", "scheduled reclaim must activate at the next window");
    assert.equal(nextStage.myControl.epoch, staleEpoch + 2);

    const [sessionsReadback, transitions, aiActions] = await Promise.all([
      prisma.presenceSession.findMany({ where: { runId: roomId }, orderBy: { userId: "asc" } }),
      prisma.roleControlTransition.findMany({ where: { roleControl: { runId: roomId } }, orderBy: { createdAt: "asc" } }),
      prisma.playerAction.findMany({ where: { runId: roomId, actorKind: "AI_TAKEOVER" }, orderBy: { createdAt: "asc" } })
    ]);
    assert.equal(sessionsReadback.length, 3);
    assert.ok(transitions.some((transition) => transition.reason === "DISCONNECT_DETECTED"));
    assert.ok(transitions.some((transition) => transition.reason === "DISCONNECT_TIMEOUT"));
    assert.ok(transitions.some((transition) => transition.reason === "PLAYER_RECLAIM_SCHEDULED" && transition.effectiveSlot === "NEXT_WINDOW"));
    assert.ok(transitions.some((transition) => transition.reason === "RECLAIM_EFFECTIVE_NEXT_WINDOW" && transition.effectiveSlot === "MAIN"));
    assert.ok(aiActions.some((action) => action.roleId === initialDropped.player.roleId && action.actionSlot === "MAIN"));

    const report = {
      status: "PASS",
      database: { provider: "supabase", schema: String(process.env.MANY_WORLDS_DB_SCHEMA || "cs_acceptance_20260716_02") },
      roomId,
      dropoutIndex,
      droppedHost: dropoutIndex === 0,
      staleEpoch,
      takeoverEpoch: staleEpoch + 1,
      reclaimedEpoch: staleEpoch + 2,
      presenceSessionCount: sessionsReadback.length,
      transitionReasons: transitions.map((transition) => transition.reason),
      aiActionSlots: aiActions.map((action) => action.actionSlot),
      advancedToStage: nextStage.run.stageIndex
    };
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    keepAlive = false;
    await keepAliveTask;
    if (keepAliveError) throw keepAliveError;
  }
}

main().finally(async () => prisma.$disconnect()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
