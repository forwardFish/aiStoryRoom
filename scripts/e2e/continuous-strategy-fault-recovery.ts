import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

type Json = Record<string, any>;
type Player = { label: string; email: string; password: string; cookie: string; roleId?: string };
type SuiteState = { stamp: string; schema: string; players: Player[] };
type CaseState = {
  caseId: string;
  kind: "resolution" | "role-agent";
  roomId: string;
  windowId: string;
  stageIndex: number;
  players: Player[];
  checkpoint?: string;
  boundary?: string;
  roleId?: string;
  taskId?: string;
  armedAt: string;
};

const command = process.argv[2] || "";
const baseUrl = String(process.env.MANY_WORLDS_API_BASE || "http://127.0.0.1:3138/api").replace(/\/$/, "");
const suitePath = resolve(required("MANY_WORLDS_SUITE_STATE"));
const activeRoomPath = resolve(process.env.MANY_WORLDS_ACTIVE_ROOM_PATH || `${suitePath}.active-room.json`);
const stopHeartbeatPath = resolve(process.env.MANY_WORLDS_HEARTBEAT_STOP_PATH || `${suitePath}.heartbeat.stop`);
const caseDir = process.env.MANY_WORLDS_CASE_DIR ? resolve(process.env.MANY_WORLDS_CASE_DIR) : "";
const mailSink = resolve(process.env.AUTH_MAIL_SINK_FILE || "D:/tmp/continuous-fault-mail.ndjson");
const schema = String(process.env.MANY_WORLDS_DB_SCHEMA || "").trim();
const prisma = new PrismaClient();

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function request(path: string, init: RequestInit = {}, cookie = "", allowError = false) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as Json;
  if (!allowError && !response.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${response.status} ${payload.code || "UNKNOWN"}: ${payload.message || JSON.stringify(payload)}`);
  }
  return { response, payload };
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
  throw new Error("auth response did not issue the HttpOnly session cookie");
}

async function verificationToken(email: string) {
  return waitFor(`verification mail for ${email}`, async () => {
    const lines = (await readFile(mailSink, "utf8").catch(() => "")).trim().split(/\r?\n/).filter(Boolean);
    for (const line of lines.reverse()) {
      const message = JSON.parse(line);
      if (String(message.to).toLowerCase() !== email.toLowerCase()) continue;
      const urlText = String(message.text || message.html || "").match(/https?:\/\/[^\s<]+/)?.[0];
      const token = urlText ? new URL(urlText.replace(/&amp;/g, "&")).searchParams.get("token") : null;
      if (token) return token;
    }
    return null;
  }, Boolean, 20_000, 100);
}

async function waitFor<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 120_000, pollMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (Date.now() < deadline) {
    if (done(value)) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
    value = await read();
  }
  throw new Error(`${label} timed out; last value=${JSON.stringify(value)}`);
}

async function exists(path: string) {
  return readFile(path).then(() => true).catch(() => false);
}

async function waitForSignal(path: string) {
  await waitFor(`signal ${path}`, () => exists(path), Boolean, 120_000, 100);
}

async function setActiveRoom(roomId: string | null) {
  await writeJson(activeRoomPath, { roomId, updatedAt: new Date().toISOString() });
}

function slotCommand(projection: Json, action: Json, prefix: string) {
  return {
    idempotencyKey: `${prefix}-${Date.now()}-${projection.player.roleKey}-${projection.run.stageIndex}`,
    windowId: projection.actionWindow.id,
    controlEpoch: projection.myControl.epoch,
    actionKey: action.actionKey
  };
}

async function game(player: Player, roomId: string) {
  return (await request(`/v4/rooms/${roomId}/game`, {}, player.cookie)).payload;
}

async function initializeSuite() {
  const databaseUrl = new URL(required("DATABASE_URL"));
  assert.match(databaseUrl.hostname, /supabase/i, "fault recovery acceptance must use Supabase");
  assert.match(schema, /^cs_accept_/, "fault recovery acceptance requires an isolated acceptance schema");
  const stamp = `${Date.now()}-${process.pid}`;
  const players: Player[] = [];
  for (let index = 1; index <= 3; index += 1) {
    const email = `continuous-fault-${stamp}-p${index}@example.test`;
    const password = "MvpTest2026!";
    const label = `fault-player-${index}`;
    const registered = await post("/v4/auth/register", { email, password, nickname: label, returnTo: "/rooms" });
    assert.equal(registered.payload.accepted, true);
    assert.equal("verificationToken" in registered.payload, false);
    const verified = await post("/v4/auth/verify", { token: await verificationToken(email) });
    assert.equal(verified.payload.verified, true);
    const login = await post("/v4/auth/login", { email, password });
    const cookie = sessionCookie(login.response);
    assert.equal((await request("/v4/auth/me", {}, cookie)).payload.email, email);
    players.push({ label, email, password, cookie });
  }
  await writeJson(suitePath, { stamp, schema, players } satisfies SuiteState);
  await setActiveRoom(null);
  console.log(JSON.stringify({ command, status: "PASS", schema, playerCount: players.length }));
}

async function createRoom(suite: SuiteState, caseId: string) {
  const players = suite.players.map((player) => ({ ...player }));
  const created = (await post("/v4/rooms", {
    worldId: "sangtian",
    title: `continuous-fault-${caseId}-${suite.stamp}`,
    visibility: "private",
    maxPlayers: 3
  }, players[0].cookie)).payload;
  const roomId = String(created.id);
  assert.equal(created.engineVersion, "continuous_strategy_v1_1");
  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    if (index > 0) {
      const joined = (await post("/v4/rooms/join-by-code", { code: created.code }, player.cookie)).payload;
      assert.equal(joined.id, roomId);
    }
    const room = (await request(`/v4/rooms/${roomId}`, {}, player.cookie)).payload;
    const role = room.roles.find((candidate: Json) => candidate.humanSelectable && candidate.status === "available");
    assert.ok(role, `${player.label} must see an available role`);
    await post(`/v4/rooms/${roomId}/role`, { roleId: role.id }, player.cookie);
    player.roleId = role.id;
    if (index === 0) await post(`/v4/rooms/${roomId}/role/lock`, {}, player.cookie);
  }
  for (const player of players) await post(`/v4/rooms/${roomId}/ready`, { ready: true }, player.cookie);
  const ready = (await request(`/v4/rooms/${roomId}`, {}, players[0].cookie)).payload;
  assert.equal(ready.startEnabled, true);
  const started = (await post(`/v4/rooms/${roomId}/start`, {}, players[0].cookie)).payload;
  assert.equal(started.status, "playing");
  await setActiveRoom(roomId);
  return { roomId, players };
}

async function unlockIfNeeded(players: Player[], roomId: string, opening: Json) {
  if (opening.access.state !== "REQUIRES_UNLOCK") return opening;
  assert.equal(opening.run.stageIndex, 4);
  await post("/v4/credits/test-grant", { runId: `${roomId}-fault`, amount: 200 }, players[0].cookie);
  const unlocked = (await post(`/v4/story-runs/${roomId}/unlock`, { idempotencyKey: `fault-unlock-${roomId}` }, players[0].cookie)).payload;
  assert.equal(unlocked.unlocked, true);
  return game(players[0], roomId);
}

async function submitStage(players: Player[], roomId: string, stageIndex: number, holdFinalDone = false) {
  const opening = await unlockIfNeeded(players, roomId, await game(players[0], roomId));
  assert.equal(opening.run.stageIndex, stageIndex);
  assert.equal(opening.actionWindow.status, "MAIN_OPEN");
  for (const player of players) {
    const projection = await game(player, roomId);
    const result = (await post(`/v4/rooms/${roomId}/game/actions/main`, slotCommand(projection, projection.availableMainActions[0], `fault-main-${stageIndex}`), player.cookie)).payload;
    assert.equal(result.accepted, true);
  }
  const doneCommands: Array<{ player: Player; body: Json }> = [];
  for (const player of players) {
    let projection = await game(player, roomId);
    if (projection.pendingReaction) {
      projection = (await post(`/v4/rooms/${roomId}/game/events/${projection.pendingReaction.eventId}/reaction`, slotCommand(projection, projection.pendingReaction.options[0], `fault-reaction-${stageIndex}`), player.cookie)).payload.gameProjection;
    }
    if (projection.availableManeuvers.length) {
      projection = (await post(`/v4/rooms/${roomId}/game/actions/maneuver`, slotCommand(projection, projection.availableManeuvers[0], `fault-maneuver-${stageIndex}`), player.cookie)).payload.gameProjection;
    }
    doneCommands.push({
      player,
      body: {
        idempotencyKey: `fault-done-${roomId}-${projection.player.roleKey}-${stageIndex}`,
        windowId: projection.actionWindow.id,
        controlEpoch: projection.myControl.epoch
      }
    });
  }
  const submitCount = holdFinalDone ? doneCommands.length - 1 : doneCommands.length;
  for (let index = 0; index < submitCount; index += 1) {
    const done = (await post(`/v4/rooms/${roomId}/game/layout/done`, doneCommands[index].body, doneCommands[index].player.cookie)).payload;
    assert.equal(done.accepted, true);
  }
  return { windowId: String(doneCommands[0].body.windowId), held: holdFinalDone ? doneCommands.at(-1)! : null };
}

async function waitForStage(players: Player[], roomId: string, stageIndex: number) {
  return waitFor(`room ${roomId} stage ${stageIndex} advance`, () => game(players[0], roomId), (projection) =>
    stageIndex === 7 ? projection.run.status === "chapter_generated" : projection.run.stageIndex === stageIndex + 1,
  180_000, 500);
}

async function armResolutionCase() {
  const suite = await readJson<SuiteState>(suitePath);
  const caseId = required("MANY_WORLDS_CASE_ID");
  const checkpoint = required("MANY_WORLDS_CHECKPOINT");
  const targetStage = Number(required("MANY_WORLDS_TARGET_STAGE"));
  assert.ok(targetStage === 3 || targetStage === 7);
  const { roomId, players } = await createRoom(suite, caseId);
  for (let stageIndex = 1; stageIndex < targetStage; stageIndex += 1) {
    await submitStage(players, roomId, stageIndex);
    await waitForStage(players, roomId, stageIndex);
  }
  const prepared = await submitStage(players, roomId, targetStage, true);
  const barrierPath = resolve(caseDir, "barrier.json");
  const signalPath = resolve(caseDir, "continue.signal");
  await writeJson(barrierPath, { caseId, roomId, windowId: prepared.windowId, stageIndex: targetStage, checkpoint, reachedAt: new Date().toISOString() });
  await waitForSignal(signalPath);
  assert.ok(prepared.held);
  const sealed = (await post(`/v4/rooms/${roomId}/game/layout/done`, prepared.held.body, prepared.held.player.cookie)).payload;
  assert.equal(sealed.accepted, true);
  const state: CaseState = { caseId, kind: "resolution", roomId, windowId: prepared.windowId, stageIndex: targetStage, players, checkpoint, armedAt: new Date().toISOString() };
  await writeJson(resolve(caseDir, "state.json"), state);
  console.log(JSON.stringify({ command, status: "PASS", caseId, roomId, windowId: prepared.windowId, stageIndex: targetStage, checkpoint }));
}

async function armRoleAgentCase() {
  const suite = await readJson<SuiteState>(suitePath);
  const caseId = required("MANY_WORLDS_CASE_ID");
  const boundary = String(process.env.MANY_WORLDS_ROLE_BOUNDARY || "PROVIDER_FALLBACK");
  const { roomId, players } = await createRoom(suite, caseId);
  const target = players[2];
  const opening = await game(target, roomId);
  const barrierPath = resolve(caseDir, "barrier.json");
  const signalPath = resolve(caseDir, "continue.signal");
  await writeJson(barrierPath, { caseId, roomId, windowId: opening.actionWindow.id, roleId: opening.player.roleId, boundary, reachedAt: new Date().toISOString() });
  await waitForSignal(signalPath);
  const handed = (await post(`/v4/rooms/${roomId}/game/control/handoff-to-ai`, {
    idempotencyKey: `fault-handoff-${caseId}-${roomId}`,
    expectedControlEpoch: opening.myControl.epoch
  }, target.cookie)).payload.gameProjection;
  assert.equal(handed.myControl.mode, "AI_ACTIVE");
  const task = await waitFor("role agent task", () => prisma.storyTaskOutbox.findFirst({
    where: { runId: roomId, windowId: opening.actionWindow.id, roleId: opening.player.roleId, actionSlot: "MAIN", taskType: "ROLE_AGENT_DECISION" },
    orderBy: { createdAt: "desc" }
  }), Boolean, 30_000, 200);
  const state: CaseState = {
    caseId, kind: "role-agent", roomId, windowId: opening.actionWindow.id, stageIndex: 1,
    players, boundary, roleId: opening.player.roleId, taskId: task!.id, armedAt: new Date().toISOString()
  };
  await writeJson(resolve(caseDir, "state.json"), state);
  console.log(JSON.stringify({ command, status: "PASS", caseId, roomId, windowId: state.windowId, roleId: state.roleId, taskId: state.taskId, boundary }));
}

async function waitLeaseExpired() {
  const state = await readJson<CaseState>(resolve(caseDir, "state.json"));
  const task = await waitFor("faulted task to remain leased", () => state.taskId
    ? prisma.storyTaskOutbox.findUnique({ where: { id: state.taskId } })
    : prisma.storyTaskOutbox.findFirst({ where: { runId: state.roomId, windowId: state.windowId, taskType: "RESOLVE_WINDOW" }, orderBy: { createdAt: "desc" } }),
  (candidate) => Boolean(candidate?.status === "running" && candidate.leaseExpiresAt), 60_000, 200);
  state.taskId = task!.id;
  await writeJson(resolve(caseDir, "state.json"), state);
  const expired = await waitFor("faulted task lease expiry", () => prisma.storyTaskOutbox.findUnique({ where: { id: task!.id } }), (candidate) =>
    Boolean(candidate?.status === "running" && candidate.leaseExpiresAt && candidate.leaseExpiresAt.getTime() <= Date.now()),
  120_000, 250);
  const workflow = state.kind === "resolution" ? await prisma.resolutionWorkflow.findUnique({ where: { windowId: state.windowId }, include: { checkpoints: { orderBy: { completedAt: "asc" } } } }) : null;
  const decision = state.kind === "role-agent" && state.roleId ? await prisma.roleAgentDecision.findUnique({
    where: { windowId_roleId_actionSlot_controlEpoch: { windowId: state.windowId, roleId: state.roleId, actionSlot: "MAIN", controlEpoch: Number(expired!.controlEpoch) } }
  }).catch(() => null) : null;
  const partial = {
    status: "PASS", caseId: state.caseId, taskId: expired!.id, taskStatus: expired!.status,
    leaseOwner: expired!.leaseOwner, leaseVersion: expired!.leaseVersion, leaseExpiresAt: expired!.leaseExpiresAt?.toISOString(),
    checkpointKeys: workflow?.checkpoints.map((entry) => entry.checkpointKey) || [],
    workflowStatus: workflow?.status || null,
    decisionStatus: decision?.status || null,
    observedAt: new Date().toISOString()
  };
  await writeJson(resolve(caseDir, "partial.json"), partial);
  console.log(JSON.stringify({ command, ...partial }));
}

async function verifyResolutionCase() {
  const state = await readJson<CaseState>(resolve(caseDir, "state.json"));
  assert.equal(state.kind, "resolution");
  const task = await waitFor("replacement worker completes resolution", () => prisma.storyTaskOutbox.findUnique({ where: { id: state.taskId! } }), (candidate) => candidate?.status === "completed", 180_000, 300);
  const run = await waitFor("run advances after recovery", () => prisma.storyRun.findUnique({ where: { id: state.roomId } }), (candidate) =>
    state.stageIndex === 7 ? candidate?.status === "chapter_generated" : Number(candidate?.currentDay) === state.stageIndex + 1,
  180_000, 300);
  const workflow = await prisma.resolutionWorkflow.findUniqueOrThrow({ where: { windowId: state.windowId }, include: { checkpoints: { orderBy: { completedAt: "asc" } } } });
  const window = await prisma.actionWindow.findUniqueOrThrow({ where: { id: state.windowId }, include: { node: true } });
  const expectedTerminal = state.stageIndex === 7 ? "RUN_COMPLETED" : "NEXT_WINDOW_OPENED";
  const expectedKeys = ["RULES_APPLIED", "PUBLIC_PROJECTED", ...Array.from({ length: 3 }, (_value, index) => `ROLE_PROJECTED:${index + 1}`), "PUBLISHED", expectedTerminal];
  const actualKeys = workflow.checkpoints.map((entry) => entry.checkpointKey);
  let roleOrdinal = 0;
  const normalizedKeys = actualKeys.map((key) => key.startsWith("ROLE_PROJECTED:") ? `ROLE_PROJECTED:${++roleOrdinal}` : key);
  assert.deepEqual(normalizedKeys, expectedKeys);
  assert.equal(workflow.status, "COMPLETED");
  assert.ok(task!.attempt >= 2 && task!.leaseVersion >= 3, "replacement worker must claim a newer lease");
  assert.equal(await prisma.directorResolution.count({ where: { runId: state.roomId, nodeId: window.nodeId } }), 1);
  assert.equal(await prisma.narrativeEntry.count({ where: { runId: state.roomId, nodeId: window.nodeId, entryType: "stage_public_result" } }), 1);
  assert.equal(await prisma.narrativeEntry.count({ where: { runId: state.roomId, nodeId: window.nodeId, entryType: "stage_personal_result" } }), 3);
  assert.equal(await prisma.eventDelivery.count({ where: { roomId: state.roomId, event: { dedupeKey: `${state.stageIndex === 7 ? "RUN_COMPLETED" : "STAGE_RESOLVED"}:${state.windowId}` } } }), 3);
  const window8Count = await prisma.actionWindow.count({ where: { runId: state.roomId, node: { nodeIndex: { gt: 7 } } } });
  assert.equal(window8Count, 0);
  const report = {
    status: "PASS", caseId: state.caseId, kind: state.kind, roomId: state.roomId, windowId: state.windowId,
    stageIndex: state.stageIndex, checkpoint: state.checkpoint, taskId: task!.id, taskAttempt: task!.attempt,
    leaseVersion: task!.leaseVersion, checkpointKeys: actualKeys, workflowStatus: workflow.status,
    runStatus: run!.status, currentDay: run!.currentDay, window8Count,
    resolutionCount: 1, publicProjectionCount: 1, personalProjectionCount: 3,
    completedAt: new Date().toISOString()
  };
  await writeJson(resolve(caseDir, "verify.json"), report);
  await setActiveRoom(null);
  console.log(JSON.stringify({ command, ...report }));
}

async function verifyRoleAgentCase() {
  const state = await readJson<CaseState>(resolve(caseDir, "state.json"));
  assert.equal(state.kind, "role-agent");
  const expectFallback = String(process.env.MANY_WORLDS_EXPECT_FALLBACK || "false") === "true";
  const expectRecovery = String(process.env.MANY_WORLDS_EXPECT_RECOVERY || "true") === "true";
  const task = await waitFor("role agent task completes", () => prisma.storyTaskOutbox.findUnique({ where: { id: state.taskId! } }), (candidate) => candidate?.status === "completed", 120_000, 250);
  const decision = await prisma.roleAgentDecision.findUniqueOrThrow({
    where: { windowId_roleId_actionSlot_controlEpoch: { windowId: state.windowId, roleId: state.roleId!, actionSlot: "MAIN", controlEpoch: Number(task!.controlEpoch) } }
  });
  const window = await prisma.actionWindow.findUniqueOrThrow({
    where: { id: state.windowId },
    select: { nodeId: true }
  });
  const actions = await prisma.playerAction.findMany({ where: {
    runId: state.roomId,
    nodeId: window.nodeId,
    roleId: state.roleId,
    actionSlot: "MAIN",
    status: "accepted"
  } });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].actorKind, "AI_TAKEOVER");
  assert.equal(decision.playerActionId, actions[0].id);
  if (expectFallback) {
    assert.equal(decision.status, "SEALED_FALLBACK");
    assert.equal(task!.outcome, "SEALED_FALLBACK");
    assert.equal(decision.provider, "deepseek");
    assert.ok(decision.providerAttempts >= 1);
    assert.ok(decision.lastError);
  } else {
    assert.equal(decision.status, "SEALED_ACT");
    assert.equal(task!.outcome, "SEALED_ACT");
  }
  if (expectRecovery) assert.ok(task!.attempt >= 2 && task!.leaseVersion >= 3, "faulted role task must be reclaimed with a newer lease");
  const report = {
    status: "PASS", caseId: state.caseId, kind: state.kind, roomId: state.roomId, windowId: state.windowId,
    roleId: state.roleId, boundary: state.boundary, taskId: task!.id, taskAttempt: task!.attempt,
    leaseVersion: task!.leaseVersion, taskOutcome: task!.outcome, decisionStatus: decision.status,
    provider: decision.provider, providerAttempts: decision.providerAttempts, fallback: expectFallback,
    actionId: actions[0].id, actionCount: actions.length, completedAt: new Date().toISOString()
  };
  await writeJson(resolve(caseDir, "verify.json"), report);
  await setActiveRoom(null);
  console.log(JSON.stringify({ command, ...report }));
}

async function heartbeatLoop() {
  const suite = await readJson<SuiteState>(suitePath);
  const sequences = new Map<string, number>();
  while (!(await exists(stopHeartbeatPath))) {
    const active = await readJson<{ roomId: string | null }>(activeRoomPath).catch(() => ({ roomId: null }));
    if (active.roomId) {
      await Promise.all(suite.players.map(async (player, index) => {
        const key = `${active.roomId}:${index}`;
        const sequence = (sequences.get(key) || 0) + 1;
        sequences.set(key, sequence);
        const response = await post(`/v4/rooms/${active.roomId}/presence/heartbeat`, {
          sessionInstanceId: `fault-suite-${suite.stamp}-p${index + 1}`,
          heartbeatSequence: sequence,
          lastAppliedDeliverySequence: 0
        }, player.cookie, true);
        if (!response.response.ok && ![409, 429].includes(response.response.status)) {
          throw new Error(`heartbeat ${active.roomId} p${index + 1} -> ${response.response.status} ${response.payload.code || "UNKNOWN"}`);
        }
      }));
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  console.log(JSON.stringify({ command, status: "PASS", stoppedAt: new Date().toISOString() }));
}

async function main() {
  if (command === "init") return initializeSuite();
  if (command === "heartbeat-loop") return heartbeatLoop();
  if (command === "resolution-arm") return armResolutionCase();
  if (command === "role-arm") return armRoleAgentCase();
  if (command === "wait-lease") return waitLeaseExpired();
  if (command === "resolution-verify") return verifyResolutionCase();
  if (command === "role-verify") return verifyRoleAgentCase();
  throw new Error("usage: continuous-strategy-fault-recovery <init|heartbeat-loop|resolution-arm|role-arm|wait-lease|resolution-verify|role-verify>");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
