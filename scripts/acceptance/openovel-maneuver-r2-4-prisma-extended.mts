import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const DATABASE_URL = requiredEnv("DATABASE_URL");
const API_BASE = String(process.env.OPENOVEL_R2_4_API_BASE || "http://127.0.0.1:3000/api").replace(/\/+$/, "");
const SESSION_COOKIE = normalizeCookie(requiredEnv("OPENOVEL_R2_4_SESSION_COOKIE"));
const EVIDENCE_ROOT = path.resolve(
  process.env.OPENOVEL_R2_4_EVIDENCE_ROOT
  || path.join(process.cwd(), "artifacts", "openovel-maneuver-r2-4-prisma-extended"),
);
const ROLE_KEY = String(process.env.OPENOVEL_R2_4_ROLE_KEY || "zhejiang_governor");

process.env.DATABASE_URL = DATABASE_URL;
const prisma = new PrismaClient();
const startedAt = new Date().toISOString();

try {
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  const oldStateRecovery = await verifyOldStateRecovery();
  const leverageRace = await verifyLeverageRace();
  const canonBridge = await verifyCanonBridge();
  const report = {
    schemaVersion: "openovel_maneuver_r2_4_prisma_extended_v2",
    verdict: "PASS",
    commitSha: process.env.OPENOVEL_R2_4_COMMIT_SHA || null,
    apiBase: API_BASE,
    database: "PostgreSQL via Prisma",
    oldStateRecovery,
    leverageRace,
    canonBridge,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`OPENOVEL_MANEUVER_R2_4_PRISMA_EXTENDED_PASS ${path.join(EVIDENCE_ROOT, "report.json")}\n`);
} catch (error) {
  await mkdir(EVIDENCE_ROOT, { recursive: true }).catch(() => undefined);
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify({
    schemaVersion: "openovel_maneuver_r2_4_prisma_extended_v2",
    verdict: "FAIL",
    error: serializeError(error),
    startedAt,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8").catch(() => undefined);
  throw error;
} finally {
  await prisma.$disconnect();
}

async function verifyOldStateRecovery() {
  const projection = await createFreshRun("old-state-recovery");
  const runId = projection.room.id;
  const option = projection.maneuverPanel.investigate.options[0];
  assert.ok(option?.intentKey);
  const confirmed = await previewAndConfirm(runId, {
    version: projection.maneuverVersion,
    idempotencyKey: `r24-recovery-investigate-${randomUUID()}`,
    maneuverType: "investigate",
    intentKey: option.intentKey,
  });
  const before = await prisma.storyRun.findUniqueOrThrow({
    where: { id: runId },
    select: { version: true, stateJson: true },
  });
  const eventCount = await prisma.storyEvent.count({
    where: { runId, type: "openovel_maneuver_result" },
  });
  const damaged = structuredClone(record(before.stateJson));
  delete damaged.openovelManeuver;
  await prisma.storyRun.update({
    where: { id: runId },
    data: { stateJson: damaged },
  });
  const recovered = await gameProjection(runId);
  const after = await prisma.storyRun.findUniqueOrThrow({
    where: { id: runId },
    select: { version: true, stateJson: true },
  });
  assert.equal(after.version, before.version, "event-ledger recovery must not create a new player version");
  assert.equal(await prisma.storyEvent.count({ where: { runId, type: "openovel_maneuver_result" } }), eventCount);
  assert.equal(recovered.maneuverPanel.quota.remaining, 1);
  assert.deepEqual(recovered.maneuverState.usedTypesToday, ["investigate"]);
  assert.ok(recovered.maneuverState.discoveredFactKeys.includes("first_registers_prepared_early"));
  assert.equal(recovered.leverageHand.items.length, 3);
  assert.equal(record(after.stateJson).openovelManeuver.results[0].id, confirmed.payload.result.id);
  return {
    runId,
    versionBeforeDamage: before.version,
    versionAfterRecovery: after.version,
    eventCount,
    recoveredUsedTypes: recovered.maneuverState.usedTypesToday,
    recoveredFacts: recovered.maneuverState.discoveredFactKeys,
  };
}

async function verifyLeverageRace() {
  let projection = await createFreshRun("leverage-race");
  projection = await advanceToTurn(projection, 2, "leverage-race");
  const runId = projection.room.id;
  const leverage = projection.maneuverPanel.leverage.options.find(
    (item: any) => item.leverageKey === "xunfu_merchant_old_pact_rumor",
  );
  assert.ok(leverage);
  const base = {
    version: projection.maneuverVersion,
    maneuverType: "leverage",
    leverageKey: leverage.leverageKey,
  };
  const [previewA, previewB] = await Promise.all([
    post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/preview`, {
      ...base,
      idempotencyKey: `r24-leverage-race-a-${randomUUID()}`,
      targetRoleKey: "merchant",
    }),
    post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/preview`, {
      ...base,
      idempotencyKey: `r24-leverage-race-b-${randomUUID()}`,
      targetRoleKey: "xunfu",
    }),
  ]);
  assert.equal(previewA.payload.accepted, true);
  assert.equal(previewB.payload.accepted, true);
  const beforeEvents = await prisma.storyEvent.count({
    where: { runId, type: "openovel_maneuver_result" },
  });
  const settled = await Promise.all([
    post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/confirm`, {
      previewToken: previewA.payload.previewToken,
    }),
    post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/confirm`, {
      previewToken: previewB.payload.previewToken,
    }),
  ]);
  const successes = settled.filter((item) => item.status >= 200 && item.status < 300 && item.payload.accepted === true);
  const conflicts = settled.filter((item) => item.status === 409);
  assert.equal(successes.length, 1, JSON.stringify(settled));
  assert.equal(conflicts.length, 1, JSON.stringify(settled));
  const refreshed = await gameProjection(runId);
  const state = record(record((await prisma.storyRun.findUniqueOrThrow({ where: { id: runId } })).stateJson).openovelManeuver);
  assert.equal(refreshed.maneuverPanel.quota.remaining, 1);
  assert.deepEqual(state.usedLeverageKeys, ["xunfu_merchant_old_pact_rumor"]);
  assert.equal(refreshed.leverageHand.items.some((item: any) => item.leverageKey === "xunfu_merchant_old_pact_rumor"), false);
  assert.equal(await prisma.storyEvent.count({ where: { runId, type: "openovel_maneuver_result" } }), beforeEvents + 1);
  const winner = successes[0];
  const replay = await post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/confirm`, {
    previewToken: winner === settled[0] ? previewA.payload.previewToken : previewB.payload.previewToken,
  });
  assert.equal(replay.payload.accepted, true);
  assert.equal(replay.payload.replayed, true);
  assert.equal(await prisma.storyEvent.count({ where: { runId, type: "openovel_maneuver_result" } }), beforeEvents + 1);
  return {
    runId,
    statuses: settled.map((item) => ({ status: item.status, code: item.payload.code || null })),
    winnerEventId: winner.payload.result?.id || winner.payload.resolution?.id,
    usedLeverageKeys: state.usedLeverageKeys,
    remaining: refreshed.maneuverPanel.quota.remaining,
    replayed: replay.payload.replayed,
  };
}

async function verifyCanonBridge() {
  const projection = await createFreshRun("canon-bridge");
  const runId = projection.room.id;
  const option = projection.maneuverPanel.investigate.options[0];
  assert.ok(option?.intentKey);
  const confirmed = await previewAndConfirm(runId, {
    version: projection.maneuverVersion,
    idempotencyKey: `r24-canon-investigate-${randomUUID()}`,
    maneuverType: "investigate",
    intentKey: option.intentKey,
  });
  const resultId = String(confirmed.payload.result?.id || confirmed.payload.resolution?.id || "");
  assert.ok(resultId);
  const beforeMain = await gameProjection(runId);
  assert.equal(beforeMain.worldSequence, 0);
  assert.ok(beforeMain.currentTurn.visibleFacts.some((fact: any) => fact.factKey === "first_registers_prepared_early"));
  assert.ok(beforeMain.evidenceHoldings.some((asset: any) => asset.assetKey === "first_registers_prepared_early"));
  const main = await submitFirstMainDecision(beforeMain, "canon-bridge");
  assert.equal(main.worldSequence, 1);
  const stored = await prisma.storyRun.findUniqueOrThrow({ where: { id: runId } });
  const maneuverState = record(record(stored.stateJson).openovelManeuver);
  assert.ok(maneuverState.canonConsumedResultIds.includes(resultId));
  assert.equal(maneuverState.lastCanonBridgeTurnNumber, 1);
  const acknowledgementEvents = await prisma.storyEvent.findMany({
    where: { runId, type: "openovel_maneuver_context_consumed" },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(acknowledgementEvents.length, 1);
  assert.deepEqual(record(acknowledgementEvents[0].payloadJson).sourceResultIds, [resultId]);
  const latestAction = await prisma.playerAction.findFirstOrThrow({
    where: { runId, status: "resolved" },
    orderBy: { createdAt: "desc" },
  });
  const serializedAction = JSON.stringify({
    freeText: latestAction.freeText,
    method: latestAction.method,
    immediateJson: latestAction.immediateJson,
  });
  assert.equal(serializedAction.includes("OPENOVEL_SERVER_CONFIRMED_MANEUVERS_V1"), false);

  const versionBeforeRecovery = stored.version;
  const totalEventCount = await prisma.storyEvent.count({ where: { runId } });
  const damaged = structuredClone(record(stored.stateJson));
  delete damaged.openovelManeuver;
  await prisma.storyRun.update({
    where: { id: runId },
    data: { stateJson: damaged },
  });
  await gameProjection(runId);
  const recoveredRun = await prisma.storyRun.findUniqueOrThrow({ where: { id: runId } });
  const recoveredState = record(record(recoveredRun.stateJson).openovelManeuver);
  assert.equal(recoveredRun.version, versionBeforeRecovery);
  assert.equal(await prisma.storyEvent.count({ where: { runId } }), totalEventCount);
  assert.ok(recoveredState.canonConsumedResultIds.includes(resultId));
  assert.equal(recoveredState.lastCanonBridgeTurnNumber, 1);

  return {
    runId,
    resultId,
    worldSequenceBefore: beforeMain.worldSequence,
    worldSequenceAfter: main.worldSequence,
    canonConsumedResultIds: recoveredState.canonConsumedResultIds,
    lastCanonBridgeTurnNumber: recoveredState.lastCanonBridgeTurnNumber,
    canonAcknowledgementEventId: acknowledgementEvents[0].id,
    stateRecoveryVersionUnchanged: recoveredRun.version === versionBeforeRecovery,
    playerActionContainsServerEnvelope: false,
  };
}

async function previewAndConfirm(runId: string, command: Record<string, unknown>) {
  const preview = await post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/preview`, command);
  assert.ok(preview.status >= 200 && preview.status < 300, JSON.stringify(preview.payload));
  assert.equal(preview.payload.accepted, true);
  const confirmed = await post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/confirm`, {
    previewToken: preview.payload.previewToken,
  });
  assert.ok(confirmed.status >= 200 && confirmed.status < 300, JSON.stringify(confirmed.payload));
  assert.equal(confirmed.payload.accepted, true);
  return confirmed;
}

async function createFreshRun(label: string) {
  const response = await post("/v4/rooms/solo", {
    worldId: "sangtian",
    roleKey: ROLE_KEY,
    idempotencyKey: `r24-prisma-extended-${label}-${randomUUID()}`,
    resumeExisting: false,
  });
  assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response.payload));
  const runId = String(response.payload.id || response.payload.runId || response.payload.roomId || "");
  assert.match(runId, /^solo_ovl_[a-f0-9]{32}$/);
  return gameProjection(runId);
}

async function advanceToTurn(projection: any, targetTurn: number, label: string) {
  let current = projection;
  let ordinal = 0;
  while (Number(current.worldSequence) < targetTurn) {
    ordinal += 1;
    current = await submitFirstMainDecision(current, `${label}-${ordinal}`);
  }
  assert.equal(Number(current.worldSequence), targetTurn);
  return current;
}

async function submitFirstMainDecision(projection: any, label: string) {
  const turn = projection.currentTurn;
  const candidate = turn?.decisions?.[0];
  assert.ok(turn && candidate);
  const response = await post(
    `/v4/rooms/${encodeURIComponent(projection.room.id)}/game/turns/${encodeURIComponent(turn.id)}/decision`,
    {
      idempotencyKey: `r24-prisma-main-${label}-${randomUUID()}`,
      turnRevision: turn.revision,
      controlEpoch: projection.control.epoch,
      intent: candidate.intentDraft,
      decisionForm: "STORY_CHOICE",
      candidateId: candidate.id,
    },
  );
  assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response.payload));
  return response.payload.gameProjection;
}

async function gameProjection(runId: string) {
  const response = await request(`/v4/rooms/${encodeURIComponent(runId)}/game`, { method: "GET" });
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

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
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
