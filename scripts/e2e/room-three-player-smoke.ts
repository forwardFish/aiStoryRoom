import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const baseUrl = (process.env.MANY_WORLDS_API_BASE || "http://127.0.0.1:3102/api").replace(/\/$/, "");
const stamp = Date.now();
const totalRounds = Math.max(1, Math.min(7, Number(process.env.MANY_WORLDS_ROUNDS || 7)));
const worldId = process.env.MANY_WORLDS_WORLD_ID === "caesar" ? "caesar" : "sangtian";
const worldLabel = worldId === "caesar" ? "Caesar: The Last Spring of the Republic" : "嘉靖财政危局";

type Json = Record<string, any>;

function continuityPrisma() {
  const configured = process.env.MANY_WORLDS_DB_URL;
  if (!configured) return new PrismaClient();
  const url = new URL(configured);
  if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "1");
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function request(path: string, init: RequestInit = {}, token?: string): Promise<Json> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} -> ${response.status} ${payload.code || "UNKNOWN"}: ${payload.message || "request failed"}`);
  }
  return payload;
}

async function post(path: string, body: Json, token?: string) {
  return request(path, { method: "POST", body: JSON.stringify(body) }, token);
}

async function waitForResolution(roomId: string, taskId: string, token: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const task = await request(`/v4/rooms/${roomId}/game/tasks/${taskId}`, {}, token);
    if (task.status === "completed") return;
    if (task.status === "failed") throw new Error(`async resolution failed: ${task.lastError || "unknown error"}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("async resolution did not complete before timeout");
}

async function waitForTaskStatus(roomId: string, taskId: string, token: string, status: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const task = await request(`/v4/rooms/${roomId}/game/tasks/${taskId}`, {}, token);
    if (task.status === status) return task;
    if (task.status === "failed") throw new Error(`task failed before reaching ${status}: ${task.lastError || "unknown error"}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`task did not reach ${status} before timeout`);
}

async function createPlayer(index: number) {
  const email = `mw-v13-${stamp}-p${index}@example.test`;
  const password = "MvpTest2026!";
  const registration = await post("/v4/auth/register", { email, password, nickname: `验收玩家${index}` });
  assert.ok(registration.verificationToken, "non-production registration must return a verification token for automated smoke tests");
  await post("/v4/auth/verify", { email, verificationToken: registration.verificationToken });
  const login = await post("/v4/auth/login", { email, password });
  assert.equal(typeof login.accessToken, "string", "login must issue an access token");
  return { token: login.accessToken as string, email };
}

async function main() {
  const [host, player2, player3] = await Promise.all([createPlayer(1), createPlayer(2), createPlayer(3)]);
  const created = await post("/v4/rooms", { worldId, title: `${worldLabel}-三人七轮验收-${stamp}` }, host.token);
  assert.equal(created.status, "waiting_players");
  assert.equal(typeof created.id, "string");
  assert.equal(typeof created.code, "string");
  const openRooms = await request(`/v4/rooms?worldId=${worldId}`, {}, host.token);
  assert.ok(openRooms.rooms.some((room: Json) => room.id === created.id && room.nextAction === "open"), "public waiting room must appear in Open Rooms");
  const mineBeforeStart = await request(`/v4/rooms/mine?worldId=${worldId}`, {}, host.token);
  assert.ok(mineBeforeStart.rooms.some((room: Json) => room.id === created.id && room.nextAction === "open"), "host room must appear in My Rooms with open action");

  const selectRole = async (player: { token: string }, lockAsHost = false) => {
    const room = await request(`/v4/rooms/${created.id}`, {}, player.token);
    const availableRole = room.roles.find((role: Json) => role.status === "available");
    assert.ok(availableRole, "a selectable role must remain for each human player");
    await post(`/v4/rooms/${created.id}/role`, { roleId: availableRole.id }, player.token);
    if (lockAsHost) await post(`/v4/rooms/${created.id}/role/lock`, { roleId: availableRole.id }, player.token);
  };

  await selectRole(host, true);
  for (const player of [player2, player3]) {
    const joined = await post("/v4/rooms/join-by-code", { code: created.code }, player.token);
    assert.equal(joined.id, created.id);
    await selectRole(player);
  }
  await Promise.all([host, player2, player3].map((player) => post(`/v4/rooms/${created.id}/ready`, { ready: true }, player.token)));
  const started = await post(`/v4/rooms/${created.id}/start`, {}, host.token);
  assert.equal(started.status, "playing");
  const initialEvents = await request(`/v4/rooms/${created.id}/events`, {}, host.token);
  assert.equal(initialEvents.room.id, created.id, "member event feed must be scoped to the requested room");
  assert.equal(initialEvents.room.status, "playing", "member event feed must expose the current public room status");
  const sseAbort = new AbortController();
  const sseTimer = setTimeout(() => sseAbort.abort(), 5_000);
  try {
    const sse = await fetch(`${baseUrl}/v4/rooms/${created.id}/events/stream`, {
      headers: { authorization: `Bearer ${host.token}`, accept: "text/event-stream" },
      signal: sseAbort.signal
    });
    assert.equal(sse.status, 200, "member SSE stream must authenticate and open");
    assert.ok(String(sse.headers.get("content-type") || "").includes("text/event-stream"), "member SSE stream must return event-stream content");
    const reader = sse.body?.getReader();
    assert.ok(reader, "member SSE stream must expose a readable response body");
    const decoder = new TextDecoder();
    let frame = "";
    while (!frame.includes("data:")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      frame += decoder.decode(chunk.value, { stream: true });
    }
    assert.ok(frame.includes("data:"), "member SSE stream must emit a room-scoped event");
  } finally {
    clearTimeout(sseTimer);
    sseAbort.abort();
  }
  const rounds: Array<{ round: number; nodeId: string; submitted: number; completed: boolean }> = [];
  let game = await request(`/v4/rooms/${created.id}/game`, {}, host.token);
  let knowledgeBoundary = false;
  if (process.env.MANY_WORLDS_ASSERT_CONTINUITY === "true") {
    const prisma = continuityPrisma();
    try {
      const hostPlayer = await prisma.storyPlayer.findUniqueOrThrow({ where: { runId_userId: { runId: created.id, userId: (await prisma.user.findUniqueOrThrow({ where: { email: host.email } })).id } } });
      const privateFacts = await prisma.canonFact.findMany({ where: { runId: created.id, visibility: "role_private" } });
      const foreignFact = privateFacts.find((fact) => Array.isArray(fact.knownByRoleIdsJson) && !(fact.knownByRoleIdsJson as string[]).includes(String(hostPlayer.roleId)));
      assert.ok(foreignFact, "the test room must have a private fact owned by another role");
      const rejected = await post(`/v4/rooms/${created.id}/game/action`, {
        actionType: "observe",
        targetText: game.currentNode.title,
        method: foreignFact.content,
        intent: "Try to use a fact this role could not have learned.",
        riskLevel: "safe"
      }, host.token);
      assert.equal(rejected.result.accepted, false, "an action that quotes another role's private fact must be rejected");
      assert.ok(rejected.result.matchedRules.includes("unknown_private_fact"), "knowledge boundary rejection must identify its rule");
      knowledgeBoundary = true;
    } finally {
      await prisma.$disconnect();
    }
  }
  for (let round = 1; round <= totalRounds; round += 1) {
    assert.equal(game.currentNode.nodeIndex, round, `room game must expose node ${round}`);
    await Promise.all([host, player2, player3].map((player, index) => post(`/v4/rooms/${created.id}/game/action`, {
      actionType: index === (round - 1) % 3 ? "investigate" : "observe",
      targetText: game.currentNode.title,
      method: `Player ${index + 1} verifies the round ${round} evidence before deciding.`,
      intent: `Player ${index + 1} contributes a visible consequence to the shared round ${round}.`,
      riskLevel: index === (round - 1) % 3 ? "risky" : "safe"
    }, player.token)));
    const queued = process.env.MANY_WORLDS_ASYNC_RESOLVE === "true"
      ? await post(`/v4/rooms/${created.id}/game/resolve-async`, {}, host.token)
      : null;
    if (queued) {
      assert.ok(["pending", "running"].includes(queued.status), "async resolve must return a durable task");
      if (process.env.MANY_WORLDS_RECOVERY_PAUSE_AFTER_QUEUE === "true") {
        await waitForTaskStatus(created.id, queued.taskId, host.token, "running");
        const contextPath = resolve(".runtime", "many-worlds-outbox-recovery-context.json");
        await mkdir(resolve(".runtime"), { recursive: true });
        await writeFile(contextPath, JSON.stringify({ roomId: created.id, taskId: queued.taskId, token: host.token }) + "\n", { encoding: "utf8", mode: 0o600 });
        console.log(JSON.stringify({ status: "PAUSED_FOR_RECOVERY", roomId: created.id, taskId: queued.taskId, context: ".runtime/many-worlds-outbox-recovery-context.json" }));
        return;
      }
      await waitForResolution(created.id, queued.taskId, host.token);
    }
    const resolved = queued ? await request(`/v4/rooms/${created.id}/game`, {}, host.token) : await post(`/v4/rooms/${created.id}/game/resolve`, {}, host.token);
    rounds.push({ round, nodeId: game.currentNode.id, submitted: resolved.submittedRoleIds.length, completed: resolved.completed });
    game = resolved;
  }
  assert.equal(game.completed, totalRounds === 7, totalRounds === 7 ? "the seventh formal room round must produce a completed chapter" : "a partial async smoke must leave the room playable");
  const room = await request(`/v4/rooms/${created.id}`, {}, host.token);
  assert.equal(room.status, totalRounds === 7 ? "chapter_generated" : "playing");
  assert.equal(room.players.length, 3);
  assert.equal(room.roles.filter((role: Json) => role.status === "claimed").length, 3);
  assert.equal(room.players.filter((player: Json) => player.ready).length, 3);
  const mineFinished = await request(`/v4/rooms/mine?worldId=${worldId}`, {}, host.token);
  assert.ok(mineFinished.rooms.some((item: Json) => item.id === created.id && item.nextAction === (totalRounds === 7 ? "view_result" : "continue")), "room must remain recoverable in My Rooms");
  const closable = await post("/v4/rooms", { worldId, title: `${worldLabel}-关闭房间验收-${stamp}` }, host.token);
  const closed = await post(`/v4/rooms/${closable.id}/close`, {}, host.token);
  assert.equal(closed.status, "closed", "host may close a waiting room");
  await assert.rejects(() => post("/v4/rooms/join-by-code", { code: closable.code }, player2.token), /ROOM_NOT_JOINABLE/, "closed room must reject joins");
  let continuity: Json | undefined;
  if (process.env.MANY_WORLDS_ASSERT_CONTINUITY === "true") {
    const prisma = continuityPrisma();
    try {
      const [facts, minds, threads, snapshots, entries, dbRoles, humanActions, resolutions] = await Promise.all([
        prisma.canonFact.findMany({ where: { runId: created.id }, orderBy: { createdAt: "asc" } }),
        prisma.characterMind.findMany({ where: { runId: created.id }, orderBy: { createdAt: "asc" } }),
        prisma.storyThread.findMany({ where: { runId: created.id } }),
        prisma.sceneSnapshot.findMany({ where: { runId: created.id } }),
        prisma.narrativeEntry.findMany({ where: { runId: created.id }, orderBy: { createdAt: "asc" } }),
        prisma.storyRole.findMany({ where: { runId: created.id } }),
        prisma.playerAction.count({ where: { runId: created.id, playerType: "human", status: "accepted" } }),
        prisma.directorResolution.count({ where: { runId: created.id } })
      ]);
      const lastFactKey = ["node", totalRounds, "resolved"].join("_");
      assert.ok(facts.some((fact) => fact.factKey === "world_hook"), "continuity must retain the initial canonical world fact");
      assert.ok(facts.some((fact) => fact.factKey === lastFactKey), "each resolved node must publish a canonical fact");
      assert.equal(minds.length, dbRoles.length, "every story role must have exactly one CharacterMind");
      assert.ok(minds.every((mind) => Array.isArray(mind.confirmedFactKeysJson) && (mind.confirmedFactKeysJson as string[]).includes(lastFactKey)), "all active minds must receive the public resolved fact");
      assert.ok(threads.some((thread) => thread.threadKey === "main_pressure" && (totalRounds < 7 || thread.status === "resolved")), "the main pressure thread must be lifecycle-tracked");
      assert.ok(snapshots.filter((snapshot) => snapshot.scope === "public").length >= totalRounds + 1, "the public scene snapshot must be written at opening and every resolution");
      assert.equal(entries.filter((entry) => entry.entryType === "resolution" && entry.visibility === "public").length, totalRounds, "the unified narrative stream must contain one public entry per resolved node");
      assert.equal(humanActions, totalRounds * 3, "the continuity readback must retain every human action");
      assert.equal(resolutions, totalRounds, "the continuity readback must retain exactly one resolution per node");
      continuity = {
        canonicalFacts: facts.length,
        characterMinds: minds.length,
        storyThreads: threads.length,
        sceneSnapshots: snapshots.length,
        narrativeEntries: entries.length,
        humanActions,
        resolutions,
        knowledgeBoundary
      };
    } finally {
      await prisma.$disconnect();
    }
  }
  const report = { status: "PASS", worldId, roomId: created.id, code: created.code, players: room.players.length, selectedRoles: room.roles.filter((role: Json) => role.status === "claimed").length, runStatus: room.status, asyncResolution: process.env.MANY_WORLDS_ASYNC_RESOLVE === "true", eventFeed: true, privateSse: true, rounds, continuity, roomDiscovery: { open: true, mineBeforeStart: true, mineFinished: true, hostClose: true } };
  if (process.env.MANY_WORLDS_EVIDENCE_PATH) {
    const evidencePath = resolve(process.env.MANY_WORLDS_EVIDENCE_PATH);
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  console.log(JSON.stringify(report));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
