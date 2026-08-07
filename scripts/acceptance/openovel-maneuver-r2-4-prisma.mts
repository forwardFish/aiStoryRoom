import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const DATABASE_URL = requiredEnv("DATABASE_URL");
const API_BASE = String(process.env.OPENOVEL_R2_4_API_BASE || "http://127.0.0.1:3000/api").replace(/\/+$/, "");
const RUN_ID = requiredEnv("OPENOVEL_R2_4_RUN_ID");
const SESSION_COOKIE = normalizeCookie(requiredEnv("OPENOVEL_R2_4_SESSION_COOKIE"));
const EVIDENCE_ROOT = path.resolve(
  process.env.OPENOVEL_R2_4_EVIDENCE_ROOT
  || path.join(process.cwd(), "artifacts", "openovel-maneuver-r2-4-prisma"),
);

process.env.DATABASE_URL = DATABASE_URL;
const prisma = new PrismaClient();
const startedAt = new Date().toISOString();

try {
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  const projectionBefore = await gameProjection();
  assert.equal(projectionBefore.room?.id, RUN_ID);
  assert.equal(projectionBefore.room?.mode, "solo");
  assert.ok(projectionBefore.currentTurn, "an open main decision is required");
  const worldSequenceBefore = Number(projectionBefore.worldSequence);
  const versionBefore = Number(projectionBefore.maneuverVersion);

  const before = await databaseSnapshot();
  assert.equal(before.run.version, versionBefore);

  const zeroWriteCommand = commandFor(projectionBefore, "custom", "preview-zero-write");
  const previewZeroWrite = await post(
    `/v4/rooms/${encodeURIComponent(RUN_ID)}/game/maneuvers/preview`,
    zeroWriteCommand,
  );
  assert.equal(previewZeroWrite.status, 201);
  assert.equal(previewZeroWrite.payload.accepted, true);
  assert.match(String(previewZeroWrite.payload.previewToken || ""), /^[^.]+\.[^.]+$/);
  assert.equal(previewZeroWrite.payload.gameProjection.maneuverVersion, versionBefore);
  assert.equal(previewZeroWrite.payload.gameProjection.worldSequence, worldSequenceBefore);

  const afterPreview = await databaseSnapshot();
  assert.deepEqual(afterPreview, before, "Preview must be a byte-equivalent database no-op");

  const raceProjection = await gameProjection();
  const raceA = await post(
    `/v4/rooms/${encodeURIComponent(RUN_ID)}/game/maneuvers/preview`,
    commandFor(raceProjection, "investigate", "race-investigate"),
  );
  const raceB = await post(
    `/v4/rooms/${encodeURIComponent(RUN_ID)}/game/maneuvers/preview`,
    commandFor(raceProjection, "custom", "race-custom"),
  );
  assert.equal(raceA.status, 201);
  assert.equal(raceB.status, 201);
  assert.equal(raceA.payload.gameProjection.maneuverVersion, versionBefore);
  assert.equal(raceB.payload.gameProjection.maneuverVersion, versionBefore);

  const settled = await Promise.all([
    post(`/v4/rooms/${encodeURIComponent(RUN_ID)}/game/maneuvers/confirm`, {
      previewToken: raceA.payload.previewToken,
    }),
    post(`/v4/rooms/${encodeURIComponent(RUN_ID)}/game/maneuvers/confirm`, {
      previewToken: raceB.payload.previewToken,
    }),
  ]);
  const successful = settled.filter((item) => item.status >= 200 && item.status < 300 && item.payload.accepted === true);
  const conflicted = settled.filter((item) => item.status === 409);
  assert.equal(successful.length, 1, `expected one successful confirm, got ${JSON.stringify(settled)}`);
  assert.equal(conflicted.length, 1, `expected one revision conflict, got ${JSON.stringify(settled)}`);
  assert.ok(
    ["VERSION_CONFLICT", "MANEUVER_PREVIEW_STALE"].includes(String(conflicted[0].payload.code || "")),
    `unexpected conflict: ${JSON.stringify(conflicted[0])}`,
  );

  const afterRace = await databaseSnapshot();
  assert.equal(afterRace.run.version, before.run.version + 1);
  assert.equal(afterRace.maneuverEventCount, before.maneuverEventCount + 1);
  assert.equal(afterRace.maneuverAiTaskCount, before.maneuverAiTaskCount);
  assert.equal(afterRace.run.worldSequence, before.run.worldSequence);

  const winnerIndex = settled.indexOf(successful[0]);
  const winningToken = winnerIndex === 0 ? raceA.payload.previewToken : raceB.payload.previewToken;
  const replay = await post(
    `/v4/rooms/${encodeURIComponent(RUN_ID)}/game/maneuvers/confirm`,
    { previewToken: winningToken },
  );
  assert.equal(replay.status, 201);
  assert.equal(replay.payload.accepted, true);
  assert.equal(replay.payload.replayed, true);

  const afterReplay = await databaseSnapshot();
  assert.deepEqual(afterReplay, afterRace, "idempotent confirm replay must not create another write");

  const refreshed = await gameProjection();
  assert.equal(refreshed.maneuverVersion, afterRace.run.version);
  assert.equal(refreshed.worldSequence, worldSequenceBefore);
  assert.equal(refreshed.maneuverState.totalManeuversUsed, projectionBefore.maneuverState.totalManeuversUsed + 1);
  assert.equal(
    refreshed.timeline.filter((item: any) => item.decisionForm !== "STORY_CHOICE").length,
    projectionBefore.timeline.filter((item: any) => item.decisionForm !== "STORY_CHOICE").length + 1,
  );

  const report = {
    schemaVersion: "openovel_maneuver_r2_4_prisma_v1",
    verdict: "PASS",
    runId: RUN_ID,
    apiBase: API_BASE,
    database: "PostgreSQL via Prisma",
    worldSequenceBefore,
    worldSequenceAfter: refreshed.worldSequence,
    previewZeroWrite: {
      previewId: previewZeroWrite.payload.preview?.previewId,
      before,
      after: afterPreview,
    },
    concurrentRevisionRace: {
      responses: settled.map(publicResponse),
      before,
      after: afterRace,
    },
    idempotentReplay: {
      response: publicResponse(replay),
      after: afterReplay,
    },
    refreshProjection: {
      maneuverVersion: refreshed.maneuverVersion,
      worldSequence: refreshed.worldSequence,
      remaining: refreshed.maneuverPanel?.quota?.remaining,
      usedTypesToday: refreshed.maneuverState?.usedTypesToday,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(EVIDENCE_ROOT, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`OPENOVEL_MANEUVER_R2_4_PRISMA_PASS ${path.join(EVIDENCE_ROOT, "report.json")}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const report = {
    schemaVersion: "openovel_maneuver_r2_4_prisma_v1",
    verdict: "FAIL",
    runId: RUN_ID,
    apiBase: API_BASE,
    error: serializeError(error),
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await mkdir(EVIDENCE_ROOT, { recursive: true }).catch(() => undefined);
  await writeFile(
    path.join(EVIDENCE_ROOT, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ).catch(() => undefined);
  throw error;
} finally {
  await prisma.$disconnect();
}

async function databaseSnapshot() {
  const [run, maneuverEventCount, maneuverAiTaskCount, events] = await Promise.all([
    prisma.storyRun.findUniqueOrThrow({
      where: { id: RUN_ID },
      select: {
        version: true,
        stateJson: true,
        currentDay: true,
        worldSequence: true,
        completedNodeCount: true,
        updatedAt: true,
      },
    }),
    prisma.storyEvent.count({ where: { runId: RUN_ID, type: "openovel_maneuver_result" } }),
    prisma.aiTask.count({ where: { runId: RUN_ID, taskType: "resolve_maneuver_narrative" } }),
    prisma.storyEvent.findMany({
      where: { runId: RUN_ID, type: "openovel_maneuver_result" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, dedupeKey: true, payloadJson: true },
    }),
  ]);
  return {
    run: {
      version: run.version,
      currentDay: run.currentDay,
      worldSequence: run.worldSequence,
      completedNodeCount: run.completedNodeCount,
      stateHash: sha256(run.stateJson),
    },
    maneuverEventCount,
    maneuverAiTaskCount,
    eventIds: events.map((event) => event.id),
    dedupeKeys: events.map((event) => event.dedupeKey),
    eventPayloadHashes: events.map((event) => sha256(event.payloadJson)),
  };
}

function commandFor(projection: any, preferred: "investigate" | "custom", suffix: string) {
  const idempotencyKey = `r2-4-${suffix}-${randomUUID()}`;
  const version = Number(projection.maneuverVersion);
  if (preferred === "investigate" && projection.maneuverPanel?.investigate?.enabled) {
    const option = projection.maneuverPanel.investigate.options[0];
    assert.ok(option?.intentKey, "an investigation option is required for the revision race");
    return {
      version,
      idempotencyKey,
      maneuverType: "investigate",
      intentKey: option.intentKey,
    };
  }
  assert.equal(projection.maneuverPanel?.custom?.enabled, true, "custom maneuver must be available");
  return {
    version,
    idempotencyKey,
    maneuverType: "custom",
    customText: `R2-4 bounded verification ${suffix}`,
  };
}

async function gameProjection() {
  const response = await request(`/v4/rooms/${encodeURIComponent(RUN_ID)}/game`, { method: "GET" });
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}

async function post(route: string, body: unknown) {
  return request(route, { method: "POST", body });
}

async function request(route: string, input: { method: string; body?: unknown }) {
  const response = await fetch(`${API_BASE}${route}`, {
    method: input.method,
    headers: {
      accept: "application/json",
      cookie: SESSION_COOKIE,
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function publicResponse(response: { status: number; payload: any }) {
  return {
    status: response.status,
    accepted: response.payload.accepted,
    replayed: response.payload.replayed,
    code: response.payload.code,
    eventId: response.payload.resolution?.id,
    maneuverVersion: response.payload.maneuverVersion,
  };
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeCookie(value: string) {
  return value.includes("=") ? value : `many_worlds_session=${value}`;
}

function serializeError(error: unknown) {
  return {
    name: (error as Error)?.name || "Error",
    message: (error as Error)?.message || String(error),
    stack: (error as Error)?.stack || null,
  };
}
