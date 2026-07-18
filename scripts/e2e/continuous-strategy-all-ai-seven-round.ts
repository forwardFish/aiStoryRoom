import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

type Json = Record<string, any>;
type Player = { email: string; cookie: string; sequence: number; roleId?: string };

const baseUrl = String(process.env.MANY_WORLDS_API_BASE || "http://127.0.0.1:3103/api").replace(/\/$/, "");
const mailSink = resolve(process.env.AUTH_MAIL_SINK_FILE || "apps/api/.auth-mail-sink.ndjson");
const evidencePath = resolve(process.env.MANY_WORLDS_EVIDENCE_PATH || "docs/auto-execute/evidence/continuous-strategy/dev-supabase-all-ai-seven-round/report.json");
const databaseSchema = String(process.env.MANY_WORLDS_DB_SCHEMA || "unknown");
const stamp = `${Date.now()}-${process.pid}`;
const prisma = new PrismaClient();

const wait = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

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
  for (const value of headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""]) {
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
  const email = `continuous-all-ai-${stamp}-p${index}@example.test`;
  const password = "MvpTest2026!";
  await post("/v4/auth/register", { email, password, nickname: `all-ai-player-${index}`, returnTo: "/rooms" });
  await post("/v4/auth/verify", { token: await verificationToken(email) });
  const login = await post("/v4/auth/login", { email, password });
  return { email, cookie: sessionCookie(login.response), sequence: 0 };
}

async function game(player: Player, roomId: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await request(`/v4/rooms/${roomId}/game`, {}, player.cookie, true);
    if (response.response.ok) return response.payload;
    if (response.response.status !== 409 || response.payload.code !== "WINDOW_MOVED") {
      throw new Error(`GET game -> ${response.response.status} ${response.payload.code}: ${response.payload.message}`);
    }
    await wait(250);
  }
  throw new Error("game projection did not stabilize after WINDOW_MOVED");
}

async function heartbeat(player: Player, roomId: string, sessionInstanceId: string) {
  player.sequence += 1;
  return post(`/v4/rooms/${roomId}/presence/heartbeat`, {
    sessionInstanceId,
    heartbeatSequence: player.sequence,
    lastAppliedDeliverySequence: 0
  }, player.cookie, true);
}

function slotCommand(projection: Json, action: Json, prefix: string) {
  return {
    idempotencyKey: `${prefix}-${stamp}-${projection.player.roleKey}-${projection.run.stageIndex}`,
    windowId: projection.actionWindow.id,
    controlEpoch: projection.myControl.epoch,
    actionKey: action.actionKey
  };
}

async function waitForStage(player: Player, roomId: string, priorStage: number) {
  // A fully AI-controlled stage can contain six sequential provider decisions
  // (MAIN + MANEUVER for three roles), followed by seven durable Supabase
  // projection checkpoints. The timeout is an acceptance ceiling, not a game
  // deadline, and must not turn a healthy fallback/recovery path into a false
  // negative.
  const configuredTimeoutMs = Number(process.env.MANY_WORLDS_STAGE_TIMEOUT_MS || 420_000);
  const deadline = Date.now()
    + Math.max(30_000, Number.isFinite(configuredTimeoutMs) ? configuredTimeoutMs : 420_000);
  let projection = await game(player, roomId);
  while (Date.now() < deadline) {
    if (priorStage === 7 ? projection.run.status === "chapter_generated" : projection.run.stageIndex === priorStage + 1) return projection;
    await wait(500);
    projection = await game(player, roomId);
  }
  throw new Error(`stage ${priorStage} did not advance: ${JSON.stringify({ run: projection.run, window: projection.actionWindow })}`);
}

async function main() {
  const players = await Promise.all([1, 2, 3].map(createPlayer));
  // The protected fixture endpoint requires the attempt key to be embedded in
  // the verified @example.test address; every account above contains stamp.
  const fixtureKey = stamp;
  const creditFixtures = [] as Json[];
  for (const player of players) {
    creditFixtures.push((await post("/v4/credits/test-grant", { runId: fixtureKey, amount: 200 }, player.cookie)).payload);
  }

  const created = (await post("/v4/rooms", { worldId: "sangtian", title: `all-ai-seven-round-${stamp}`, visibility: "private", maxPlayers: 3 }, players[0].cookie)).payload;
  const roomId = String(created.id);
  const chooseRole = async (player: Player, lock = false) => {
    const room = (await request(`/v4/rooms/${roomId}`, {}, player.cookie)).payload;
    const role = room.roles.find((candidate: Json) => candidate.humanSelectable && candidate.status === "available");
    assert.ok(role);
    await post(`/v4/rooms/${roomId}/role`, { roleId: role.id }, player.cookie);
    player.roleId = role.id;
    if (lock) await post(`/v4/rooms/${roomId}/role/lock`, {}, player.cookie);
  };
  await chooseRole(players[0], true);
  for (const player of players.slice(1)) {
    await post("/v4/rooms/join-by-code", { code: created.code }, player.cookie);
    await chooseRole(player);
  }
  for (const player of players) await post(`/v4/rooms/${roomId}/ready`, { ready: true }, player.cookie);
  await post(`/v4/rooms/${roomId}/start`, {}, players[0].cookie);

  const sessions = players.map((_player, index) => `all-ai-${stamp}-p${index + 1}`);
  const humanIndices = new Set([0, 1, 2]);
  for (let index = 0; index < players.length; index += 1) {
    const beat = await heartbeat(players[index], roomId, sessions[index]);
    assert.equal(beat.response.status, 201);
    assert.equal(beat.payload.accepted, true);
  }
  let keepAlive = true;
  let keepAliveError: unknown;
  const keepAliveTask = (async () => {
    while (keepAlive) {
      await wait(2_000);
      for (const index of [...humanIndices]) {
        const beat = await heartbeat(players[index], roomId, sessions[index]);
        if (beat.response.ok || (beat.response.status === 409 && beat.payload.code === "WINDOW_MOVED")) continue;
        keepAliveError = new Error(`heartbeat ${index} -> ${beat.response.status} ${beat.payload.code}`);
        keepAlive = false;
        return;
      }
    }
  })();

  const stages = [] as Json[];
  let unlockEvidence: Json | null = null;
  try {
    for (let stageIndex = 1; stageIndex <= 7; stageIndex += 1) {
      let opening = await game(players[0], roomId);
      assert.equal(opening.run.stageIndex, stageIndex);
      if (opening.access.state === "REQUIRES_UNLOCK") {
        assert.equal(stageIndex, 4);
        const unlocked = (await post(`/v4/story-runs/${roomId}/unlock`, { idempotencyKey: `all-ai-unlock-${stamp}` }, players[0].cookie)).payload;
        assert.equal(unlocked.creditsCharged, 100);
        assert.equal(unlocked.payerUserId, (await request("/v4/auth/me", {}, players[0].cookie)).payload.id);
        unlockEvidence = { payerUserId: unlocked.payerUserId, creditsCharged: unlocked.creditsCharged };
        opening = await game(players[0], roomId);
      }

      if (stageIndex < 4) {
        for (const player of players) {
          let projection = await game(player, roomId);
          await post(`/v4/rooms/${roomId}/game/actions/main`, slotCommand(projection, projection.availableMainActions[0], "human-main"), player.cookie);
        }
        for (const player of players) {
          let projection = await game(player, roomId);
          if (projection.pendingReaction) {
            projection = (await post(`/v4/rooms/${roomId}/game/events/${projection.pendingReaction.eventId}/reaction`, slotCommand(projection, projection.pendingReaction.options[0], "human-reaction"), player.cookie)).payload.gameProjection;
          }
          if (projection.availableManeuvers.length) {
            projection = (await post(`/v4/rooms/${roomId}/game/actions/maneuver`, slotCommand(projection, projection.availableManeuvers[0], "human-maneuver"), player.cookie)).payload.gameProjection;
          }
          await post(`/v4/rooms/${roomId}/game/layout/done`, {
            idempotencyKey: `human-done-${stamp}-${projection.player.roleKey}-${stageIndex}`,
            windowId: projection.actionWindow.id,
            controlEpoch: projection.myControl.epoch
          }, player.cookie);
        }
      } else if (stageIndex === 4) {
        humanIndices.clear();
        await wait(2_500);
        for (const player of players) {
          const projection = await game(player, roomId);
          const response = (await post(`/v4/rooms/${roomId}/game/control/handoff-to-ai`, {
            idempotencyKey: `all-ai-handoff-${stamp}-${projection.player.roleKey}`,
            expectedControlEpoch: projection.myControl.epoch
          }, player.cookie)).payload;
          assert.equal(response.gameProjection.myControl.mode, "AI_ACTIVE");
        }
      } else {
        const controls = (await game(players[0], roomId)).roleControllerStates.filter((entry: Json) => entry.controllerKind !== "SYSTEM");
        assert.equal(controls.length, 3);
        assert.ok(controls.every((entry: Json) => entry.controllerKind === "AI"));
        assert.ok(controls.every((entry: Json) => !("mode" in entry) && !("epoch" in entry)));
      }

      const next = await waitForStage(players[0], roomId, stageIndex);
      stages.push({ stageIndex, nextStageIndex: next.run.stageIndex, runStatus: next.run.status });
    }
  } finally {
    keepAlive = false;
    await keepAliveTask;
  }
  if (keepAliveError) throw keepAliveError;

  const [windows, mainActions, maneuverActions, resolutions, personalEntries, publicEntries, transitions, unlocks] = await Promise.all([
    prisma.actionWindow.findMany({ where: { runId: roomId }, orderBy: { createdAt: "asc" } }),
    prisma.playerAction.findMany({ where: { runId: roomId, actionSlot: "MAIN" }, orderBy: { createdAt: "asc" } }),
    prisma.playerAction.findMany({ where: { runId: roomId, actionSlot: "MANEUVER" }, orderBy: { createdAt: "asc" } }),
    prisma.directorResolution.findMany({ where: { runId: roomId }, orderBy: { createdAt: "asc" } }),
    prisma.narrativeEntry.count({ where: { runId: roomId, entryType: "stage_personal_result" } }),
    prisma.narrativeEntry.count({ where: { runId: roomId, entryType: "stage_public_result" } }),
    prisma.roleControlTransition.findMany({ where: { roleControl: { runId: roomId }, reason: "EXPLICIT_HANDOFF" } }),
    prisma.worldUnlock.findMany({ where: { runId: roomId } })
  ]);
  assert.equal(windows.length, 7);
  assert.equal(mainActions.length, 21);
  assert.equal(mainActions.filter((action) => action.actorKind === "HUMAN").length, 9);
  assert.equal(mainActions.filter((action) => action.actorKind === "AI_TAKEOVER").length, 12);
  assert.equal(maneuverActions.length, 21);
  assert.equal(maneuverActions.filter((action) => action.actorKind === "HUMAN").length, 9);
  assert.equal(maneuverActions.filter((action) => action.actorKind === "AI_TAKEOVER").length, 12);
  assert.equal(resolutions.length, 7);
  assert.equal(personalEntries, 21);
  assert.equal(publicEntries, 7);
  assert.equal(transitions.length, 3);
  assert.equal(unlocks.length, 1);
  assert.ok(resolutions.every((resolution) => {
    const edges = Array.isArray(resolution.relationChangesJson) ? resolution.relationChangesJson as Json[] : [];
    return edges.length >= 2 && new Set(edges.map((edge) => edge.sourceRoleId)).size >= 2;
  }), "every stage must keep at least two traceable cross-role influence sources");

  const results = [] as Json[];
  for (const player of players) results.push((await request(`/v4/rooms/${roomId}/result`, {}, player.cookie)).payload);
  assert.equal(new Set(results.map((result) => result.personalEnding.content)).size, 3);

  const report = {
    status: "PASS",
    database: { provider: "supabase", schema: databaseSchema },
    roomId,
    humanMainCount: 9,
    aiMainCount: 12,
    humanManeuverCount: 9,
    aiManeuverCount: 12,
    windowCount: windows.length,
    resolutionCount: resolutions.length,
    personalStageResultCount: personalEntries,
    publicStageResultCount: publicEntries,
    explicitHandoffCount: transitions.length,
    worldUnlockCount: unlocks.length,
    payerUserId: unlockEvidence?.payerUserId,
    creditsCharged: unlockEvidence?.creditsCharged,
    stages,
    completedAt: new Date().toISOString()
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
