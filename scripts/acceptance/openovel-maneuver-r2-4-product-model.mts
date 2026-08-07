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
  || path.join(process.cwd(), "artifacts", "openovel-maneuver-r2-4-product-model"),
);
const ROLE_KEY = String(process.env.OPENOVEL_R2_4_ROLE_KEY || "zhejiang_governor");
const EXPECTED_MODEL = String(process.env.DEEPSEEK_MODEL || "").trim();
const INPUT_RATE = numberEnv("OPENOVEL_R2_4_INPUT_USD_PER_MILLION", 0.435);
const OUTPUT_RATE = numberEnv("OPENOVEL_R2_4_OUTPUT_USD_PER_MILLION", 0.87);

process.env.DATABASE_URL = DATABASE_URL;
const prisma = new PrismaClient();
const startedAt = new Date().toISOString();
const cases: any[] = [];

try {
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  cases.push(await executeCase({
    id: "contact-county-magistrate",
    targetTurn: 0,
    maneuverType: "contact",
    targetRoleKey: "county_magistrate",
    messageText: "原始底册是否完整？明日之前能否送到总督府？",
  }));
  cases.push(await executeCase({
    id: "contact-xunfu",
    targetTurn: 0,
    maneuverType: "contact",
    targetRoleKey: "xunfu",
    messageText: "为何首批名册在诏令正式送达前已经形成？",
  }));
  cases.push(await executeCase({
    id: "contact-merchant",
    targetTurn: 2,
    maneuverType: "contact",
    targetRoleKey: "merchant",
    messageText: "商会承诺的粮食究竟来自哪些仓号？",
  }));
  cases.push(await executeCase({
    id: "leverage-land-contract",
    targetTurn: 4,
    maneuverType: "leverage",
    leverageKey: "land_contract_fragment",
    targetRoleKey: "merchant",
  }));
  cases.push(await executeCase({
    id: "leverage-county-letter",
    targetTurn: 4,
    maneuverType: "leverage",
    leverageKey: "county_letter",
    targetRoleKey: "xunfu",
  }));

  const investigation = await executeInvestigationZeroModelCase();
  const realCases = cases.filter((item) => item.aiTask?.status === "completed");
  assert.equal(realCases.length, 5, "all five character-response cases must use the real provider");
  assert.equal(cases.every((item) => item.logicalCalls === 1), true);
  assert.equal(cases.every((item) => item.providerRequestId), true, "provider request ids must be retained");
  assert.equal(cases.every((item) => item.after.version === item.before.version + 1), true);
  assert.equal(cases.every((item) => item.after.remaining === item.before.remaining - 1), true);
  const contactReplies = cases
    .filter((item) => item.maneuverType === "contact")
    .map((item) => normalize(item.playerVisibleResult));
  assert.equal(new Set(contactReplies).size, 3, "the three roles returned indistinguishable responses");
  assert.equal(cases.every((item) => !/你已经决定|你答应了|你下令了/u.test(item.playerVisibleResult)), true);
  assert.equal(cases.every((item) => item.aiOutputKeys.every((key: string) => ["narrative", "replyText", "title"].includes(key))), true);

  const totals = cases.reduce((sum, item) => ({
    logicalCalls: sum.logicalCalls + item.logicalCalls,
    httpAttempts: sum.httpAttempts + item.httpAttempts,
    inputTokens: sum.inputTokens + item.inputTokens,
    outputTokens: sum.outputTokens + item.outputTokens,
    latencyMs: sum.latencyMs + item.latencyMs,
    estimatedCostUsd: sum.estimatedCostUsd + item.estimatedCostUsd,
  }), {
    logicalCalls: 0,
    httpAttempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    estimatedCostUsd: 0,
  });

  const report = {
    schemaVersion: "openovel_maneuver_r2_4_product_model_v1",
    verdict: "PASS",
    commitSha: process.env.OPENOVEL_R2_4_COMMIT_SHA || null,
    apiBase: API_BASE,
    database: "PostgreSQL via Prisma",
    expectedModel: EXPECTED_MODEL || null,
    pricingAssumption: {
      inputUsdPerMillionTokens: INPUT_RATE,
      outputUsdPerMillionTokens: OUTPUT_RATE,
    },
    realModelCases: cases,
    fixedInvestigationZeroModel: investigation,
    totals: {
      ...totals,
      estimatedCostUsd: Number(totals.estimatedCostUsd.toFixed(8)),
    },
    assertions: {
      fiveRealLogicalCalls: totals.logicalCalls === 5,
      providerRequestIdsPresent: cases.every((item) => Boolean(item.providerRequestId)),
      threeDistinctContactReplies: new Set(contactReplies).size === 3,
      fixedInvestigationCreatedNoAiTask: investigation.aiTaskDelta === 0,
      modelOutputDidNotOwnStatePatch: cases.every((item) => !item.aiOutputKeys.includes("statePatch")),
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`OPENOVEL_MANEUVER_R2_4_PRODUCT_MODEL_PASS ${path.join(EVIDENCE_ROOT, "report.json")}\n`);
} catch (error) {
  await mkdir(EVIDENCE_ROOT, { recursive: true }).catch(() => undefined);
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify({
    schemaVersion: "openovel_maneuver_r2_4_product_model_v1",
    verdict: "FAIL",
    cases,
    error: serializeError(error),
    startedAt,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8").catch(() => undefined);
  throw error;
} finally {
  await prisma.$disconnect();
}

async function executeCase(input: {
  id: string;
  targetTurn: number;
  maneuverType: "contact" | "leverage";
  targetRoleKey: string;
  messageText?: string;
  leverageKey?: string;
}) {
  let projection = await createFreshRun(input.id);
  projection = await advanceToTurn(projection, input.targetTurn, input.id);
  const section = projection.maneuverPanel?.[input.maneuverType];
  assert.equal(section?.enabled, true, `${input.id} maneuver is not enabled`);
  if (input.maneuverType === "contact") {
    assert.ok(section.options.some((item: any) => item.roleKey === input.targetRoleKey));
  } else {
    assert.ok(section.options.some((item: any) => item.leverageKey === input.leverageKey));
  }
  const before = {
    version: Number(projection.maneuverVersion),
    remaining: Number(projection.maneuverPanel.quota.remaining),
    worldSequence: Number(projection.worldSequence),
  };
  const runId = projection.room.id;
  const idempotencyKey = `r24-model-${input.id}-${randomUUID()}`;
  const command = input.maneuverType === "contact"
    ? {
        version: before.version,
        idempotencyKey,
        maneuverType: "contact",
        targetRoleKey: input.targetRoleKey,
        messageText: input.messageText,
      }
    : {
        version: before.version,
        idempotencyKey,
        maneuverType: "leverage",
        leverageKey: input.leverageKey,
        targetRoleKey: input.targetRoleKey,
      };
  const eventBefore = await prisma.storyEvent.count({ where: { runId, type: "openovel_maneuver_result" } });
  const taskBefore = await prisma.aiTask.count({ where: { runId, taskType: "resolve_maneuver_narrative" } });
  const preview = await post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/preview`, command);
  assert.ok(preview.status >= 200 && preview.status < 300, JSON.stringify(preview.payload));
  assert.equal(preview.payload.accepted, true);
  assert.equal(await prisma.storyEvent.count({ where: { runId, type: "openovel_maneuver_result" } }), eventBefore);
  assert.equal(await prisma.aiTask.count({ where: { runId, taskType: "resolve_maneuver_narrative" } }), taskBefore);

  const confirmed = await post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/confirm`, {
    previewToken: preview.payload.previewToken,
  });
  assert.ok(confirmed.status >= 200 && confirmed.status < 300, JSON.stringify(confirmed.payload));
  assert.equal(confirmed.payload.accepted, true);
  const eventId = String(confirmed.payload.result?.id || confirmed.payload.resolution?.id || "");
  assert.ok(eventId);
  const [event, task, refreshed] = await Promise.all([
    prisma.storyEvent.findUniqueOrThrow({ where: { id: eventId } }),
    prisma.aiTask.findFirstOrThrow({
      where: { runId, eventId, taskType: "resolve_maneuver_narrative" },
      orderBy: { createdAt: "desc" },
    }),
    gameProjection(runId),
  ]);
  const payload = record(event.payloadJson);
  const taskResult = record(task.resultJson);
  const tokenUsage = record(payload.tokenUsage || taskResult.tokenUsage);
  const output = record(taskResult.output);
  const inputTokens = Number(tokenUsage.inputTokens || task.inputTokens || 0);
  const outputTokens = Number(tokenUsage.outputTokens || task.outputTokens || 0);
  const after = {
    version: Number(refreshed.maneuverVersion),
    remaining: Number(refreshed.maneuverPanel.quota.remaining),
    worldSequence: Number(refreshed.worldSequence),
  };
  assert.equal(after.worldSequence, before.worldSequence);
  assert.equal(task.status, "completed", JSON.stringify(taskResult));
  assert.match(String(task.provider || task.modelName || ""), /deepseek/i);
  if (EXPECTED_MODEL) assert.ok(String(task.modelName || task.provider || "").includes(EXPECTED_MODEL));
  return {
    id: input.id,
    runId,
    sceneKey: String(payload.sceneKey || projection.maneuverPanel.sceneKey || ""),
    maneuverType: input.maneuverType,
    targetRoleKey: input.targetRoleKey,
    leverageKey: input.leverageKey || null,
    modelName: String(tokenUsage.providerModelName || task.modelName || task.provider || ""),
    providerRequestId: String(tokenUsage.providerRequestId || "") || null,
    logicalCalls: 1,
    httpAttempts: Number(tokenUsage.attempts || 0),
    inputTokens,
    outputTokens,
    latencyMs: Number(tokenUsage.elapsedMs || 0),
    estimatedCostUsd: estimateCost(inputTokens, outputTokens),
    playerVisibleResult: String(confirmed.payload.result?.narrative || confirmed.payload.resolution?.resultNarrative || ""),
    aiTask: {
      id: task.id,
      status: task.status,
      fallbackReason: taskResult.fallbackReason || null,
    },
    aiOutputKeys: Object.keys(output).sort(),
    before,
    after,
  };
}

async function executeInvestigationZeroModelCase() {
  const projection = await createFreshRun("investigation-zero-model");
  const runId = projection.room.id;
  const beforeTasks = await prisma.aiTask.count({ where: { runId, taskType: "resolve_maneuver_narrative" } });
  const option = projection.maneuverPanel.investigate.options[0];
  assert.ok(option?.intentKey);
  const preview = await post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/preview`, {
    version: projection.maneuverVersion,
    idempotencyKey: `r24-model-investigation-${randomUUID()}`,
    maneuverType: "investigate",
    intentKey: option.intentKey,
  });
  assert.equal(preview.payload.accepted, true);
  const confirmed = await post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/confirm`, {
    previewToken: preview.payload.previewToken,
  });
  assert.equal(confirmed.payload.accepted, true);
  const afterTasks = await prisma.aiTask.count({ where: { runId, taskType: "resolve_maneuver_narrative" } });
  assert.equal(afterTasks, beforeTasks);
  return {
    runId,
    intentKey: option.intentKey,
    aiTaskBefore: beforeTasks,
    aiTaskAfter: afterTasks,
    aiTaskDelta: afterTasks - beforeTasks,
  };
}

async function createFreshRun(label: string) {
  const response = await post("/v4/rooms/solo", {
    worldId: "sangtian",
    roleKey: ROLE_KEY,
    idempotencyKey: `r24-product-model-${label}-${randomUUID()}`,
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
    const turn = current.currentTurn;
    const candidate = turn?.decisions?.[0];
    assert.ok(turn && candidate, `${label} has no main decision at worldSequence ${current.worldSequence}`);
    const response = await post(
      `/v4/rooms/${encodeURIComponent(current.room.id)}/game/turns/${encodeURIComponent(turn.id)}/decision`,
      {
        idempotencyKey: `r24-product-model-main-${label}-${ordinal}-${randomUUID()}`,
        turnRevision: turn.revision,
        controlEpoch: current.control.epoch,
        intent: candidate.intentDraft,
        decisionForm: "STORY_CHOICE",
        candidateId: candidate.id,
      },
    );
    assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response.payload));
    current = response.payload.gameProjection;
  }
  assert.equal(Number(current.worldSequence), targetTurn);
  return current;
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

function estimateCost(inputTokens: number, outputTokens: number) {
  return Number((
    (inputTokens / 1_000_000) * INPUT_RATE
    + (outputTokens / 1_000_000) * OUTPUT_RATE
  ).toFixed(8));
}

function normalize(value: unknown) {
  return String(value || "").replace(/\s+/g, "").replace(/[“”‘’"'，。！？；：、]/g, "");
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
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
