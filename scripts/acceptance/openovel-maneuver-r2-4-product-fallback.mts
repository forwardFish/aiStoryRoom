import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const DATABASE_URL = requiredEnv("DATABASE_URL");
const SESSION_COOKIE = normalizeCookie(requiredEnv("OPENOVEL_R2_4_SESSION_COOKIE"));
const AUTH_TOKEN_SECRET = requiredEnv("AUTH_TOKEN_SECRET");
const EVIDENCE_ROOT = path.resolve(
  process.env.OPENOVEL_R2_4_EVIDENCE_ROOT
  || path.join(process.cwd(), "artifacts", "openovel-maneuver-r2-4-product-fallback"),
);
const API_PORT = Number(process.env.OPENOVEL_R2_4_FALLBACK_API_PORT || 3399);
const API_BASE = `http://127.0.0.1:${API_PORT}/api`;
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

process.env.DATABASE_URL = DATABASE_URL;
const prisma = new PrismaClient();
let timeoutServer: Server | null = null;
let apiProcess: ChildProcess | null = null;
let timeoutRequests = 0;
const startedAt = new Date().toISOString();

try {
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  timeoutServer = createServer((_request, response) => {
    timeoutRequests += 1;
    setTimeout(() => {
      if (response.writableEnded) return;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        id: "controlled-timeout-response",
        model: "controlled-timeout-model",
        choices: [{ message: { content: "{}" } }],
      }));
    }, 2_500);
  });
  await new Promise<void>((resolve) => timeoutServer!.listen(0, "127.0.0.1", resolve));
  const address = timeoutServer.address();
  assert.ok(address && typeof address === "object");
  const providerBaseUrl = `http://127.0.0.1:${address.port}`;

  const logPath = path.join(EVIDENCE_ROOT, "fallback-api.log");
  const log = createWriteStream(logPath, { flags: "a" });
  apiProcess = spawn(PNPM, ["--filter", "@apps/api", "dev"], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      DATABASE_URL,
      AUTH_TOKEN_SECRET,
      PORT: String(API_PORT),
      API_PORT: String(API_PORT),
      AI_CAUSAL_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "controlled-timeout-not-a-real-model-key",
      DEEPSEEK_BASE_URL: providerBaseUrl,
      DEEPSEEK_MODEL: "controlled-timeout-model",
      AI_CAUSAL_TIMEOUT_MS: "1000",
      AI_CAUSAL_MAX_ATTEMPTS: "1",
      OPENOVEL_V1_ENABLED: "1",
      NODE_ENV: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout?.pipe(log);
  apiProcess.stderr?.pipe(log);
  await waitForHealth(apiProcess, logPath);

  const created = await post("/v4/rooms/solo", {
    worldId: "sangtian",
    roleKey: "zhejiang_governor",
    idempotencyKey: `r24-product-fallback-${randomUUID()}`,
    resumeExisting: false,
  });
  assert.ok(created.status >= 200 && created.status < 300, JSON.stringify(created.payload));
  const runId = String(created.payload.id || created.payload.runId || created.payload.roomId || "");
  assert.match(runId, /^solo_ovl_[a-f0-9]{32}$/);
  const projection = await gameProjection(runId);
  const target = projection.maneuverPanel.contact.options.find(
    (item: any) => item.roleKey === "county_magistrate",
  );
  assert.ok(target);
  const before = {
    version: projection.maneuverVersion,
    remaining: projection.maneuverPanel.quota.remaining,
    worldSequence: projection.worldSequence,
  };
  const preview = await post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/preview`, {
    version: before.version,
    idempotencyKey: `r24-product-fallback-contact-${randomUUID()}`,
    maneuverType: "contact",
    targetRoleKey: target.roleKey,
    messageText: "请说明原始名册是否齐全。",
  });
  assert.equal(preview.payload.accepted, true, JSON.stringify(preview.payload));
  assert.equal(timeoutRequests, 0, "Preview must not call the provider");

  const confirmed = await post(`/v4/rooms/${encodeURIComponent(runId)}/game/maneuvers/confirm`, {
    previewToken: preview.payload.previewToken,
  });
  assert.ok(confirmed.status >= 200 && confirmed.status < 300, JSON.stringify(confirmed.payload));
  assert.equal(confirmed.payload.accepted, true);
  assert.equal(timeoutRequests, 1, "Confirm must make exactly one HTTP attempt before fallback");
  const eventId = String(confirmed.payload.result?.id || confirmed.payload.resolution?.id || "");
  const [task, event, refreshed] = await Promise.all([
    prisma.aiTask.findFirstOrThrow({
      where: { runId, eventId, taskType: "resolve_maneuver_narrative" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.storyEvent.findUniqueOrThrow({ where: { id: eventId } }),
    gameProjection(runId),
  ]);
  const resultJson = record(task.resultJson);
  const eventPayload = record(event.payloadJson);
  const tokenUsage = record(eventPayload.tokenUsage || resultJson.tokenUsage);
  assert.equal(task.status, "fallback");
  assert.equal(resultJson.fallbackReason, "provider_failed_or_invalid");
  assert.equal(Number(tokenUsage.attempts), 1);
  assert.equal(refreshed.maneuverVersion, before.version + 1);
  assert.equal(refreshed.maneuverPanel.quota.remaining, before.remaining - 1);
  assert.equal(refreshed.worldSequence, before.worldSequence);
  assert.match(String(confirmed.payload.result?.narrative || ""), /卢象升|原册|县令/);

  const report = {
    schemaVersion: "openovel_maneuver_r2_4_product_fallback_v1",
    verdict: "PASS",
    commitSha: process.env.OPENOVEL_R2_4_COMMIT_SHA || null,
    runId,
    apiBase: API_BASE,
    providerBaseUrl,
    countedAsRealModelCall: false,
    logicalCalls: 1,
    httpAttempts: timeoutRequests,
    aiTask: {
      id: task.id,
      status: task.status,
      fallbackReason: resultJson.fallbackReason,
      tokenUsage,
    },
    before,
    after: {
      version: refreshed.maneuverVersion,
      remaining: refreshed.maneuverPanel.quota.remaining,
      worldSequence: refreshed.worldSequence,
    },
    playerVisibleResult: confirmed.payload.result?.narrative,
    logPath,
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`OPENOVEL_MANEUVER_R2_4_PRODUCT_FALLBACK_PASS ${path.join(EVIDENCE_ROOT, "report.json")}\n`);
} catch (error) {
  await mkdir(EVIDENCE_ROOT, { recursive: true }).catch(() => undefined);
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify({
    schemaVersion: "openovel_maneuver_r2_4_product_fallback_v1",
    verdict: "FAIL",
    timeoutRequests,
    error: serializeError(error),
    startedAt,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8").catch(() => undefined);
  throw error;
} finally {
  await stopProcessTree(apiProcess).catch(() => undefined);
  await closeServer(timeoutServer).catch(() => undefined);
  await prisma.$disconnect();
}

async function waitForHealth(processHandle: ChildProcess, logPath: string) {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error(`fallback API exited; see ${logPath}`);
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String((error as Error)?.message || error);
    }
    await sleep(250);
  }
  throw new Error(`fallback API health timeout: ${lastError}; see ${logPath}`);
}

async function stopProcessTree(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => resolve());
    });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  }
  await Promise.race([once(child, "exit"), sleep(5_000)]).catch(() => undefined);
}

async function closeServer(server: Server | null) {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(error: unknown) {
  return {
    name: (error as Error)?.name || "Error",
    message: (error as Error)?.message || String(error),
    stack: (error as Error)?.stack || null,
  };
}
