import { PrismaClient } from "@prisma/client";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { issueAccessToken } from "../../apps/api/src/auth/auth.service";

const SAMPLE_COUNT = 60;
const SSE_P95_LIMIT_MS = 1_000;

async function main() {
  const evidenceDir = path.resolve(requiredEnv("OPENOVEL_MP_EVIDENCE_DIR"));
  await mkdir(evidenceDir, { recursive: true });
  const prisma = new PrismaClient();
  const suffix = `${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const secret = `openovel-transport-${randomBytes(16).toString("hex")}`;
  const user = { id: `transport_user_${suffix}`, openid: `transport_openid_${suffix}` };
  const outsider = { id: `transport_outsider_${suffix}`, openid: `transport_outsider_openid_${suffix}` };
  const runId = `transport_room_${suffix}`;
  const report: Record<string, unknown> = {
    schemaVersion: "openovel_mp_transport_v1",
    lane: "transport",
    status: "RUNNING",
    database: { provider: "postgresql", schema: process.env.OPENOVEL_MP_DB_SCHEMA, isolated: true },
    startedAt: new Date().toISOString(),
    limits: { sseEstablishmentP95Ms: SSE_P95_LIMIT_MS, sampleCount: SAMPLE_COUNT }
  };
  let api: ChildProcess | null = null;
  let stdout = "";
  let stderr = "";

  try {
    await seed(prisma, { runId, user, outsider });
    process.env.AUTH_TOKEN_SECRET = secret;
    const memberToken = issueAccessToken(user);
    const outsiderToken = issueAccessToken(outsider);
    const apiPort = await reservePort();
    api = spawn(process.execPath, ["--import", "tsx", "apps/api/src/main.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(apiPort),
        DATABASE_URL: requiredEnv("DATABASE_URL"),
        AUTH_TOKEN_SECRET: secret,
        STORY_WORKER_ENABLED: "false",
        STORY_WORKER_EMBEDDED: "false",
        MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED: "true",
        CONTINUOUS_OPENOVEL_V1_ENABLED: "true",
        CONTINUOUS_OPENOVEL_ROOM_IDS: runId,
        EMAIL_PROVIDER: "file-sink",
        AUTH_MAIL_SINK_FILE: path.join(evidenceDir, "auth-mail-sink.ndjson")
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    api.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    api.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const apiBase = `http://127.0.0.1:${apiPort}/api`;
    await waitForHttp(`${apiBase}/health`, api, 45_000);

    const outsiderResponse = await fetch(`${apiBase}/v4/rooms/${encodeURIComponent(runId)}/events?afterDeliverySequence=0`, {
      headers: { authorization: `Bearer ${outsiderToken}`, accept: "application/json" }
    });
    assert(outsiderResponse.status === 403, `OUTSIDER_EVENT_FEED_STATUS:${outsiderResponse.status}`);

    const warmup = await openFirstFrame(apiBase, runId, memberToken, 0);
    assert(warmup.page.deliveries?.[0]?.eventId === `transport_event_${suffix}`, "SSE_WARMUP_EVENT_MISSING");
    assert(warmup.page.nextAfterDeliverySequence === 1, `SSE_WARMUP_CURSOR:${warmup.page.nextAfterDeliverySequence}`);

    const samples: Array<{ durationMs: number; cursor: number; deliveryCount: number }> = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      const opened = await openFirstFrame(apiBase, runId, memberToken, 1);
      assert(opened.page.nextAfterDeliverySequence === 1, `SSE_RESUME_CURSOR:${opened.page.nextAfterDeliverySequence}`);
      assert(Array.isArray(opened.page.deliveries) && opened.page.deliveries.length === 0, "SSE_RESUME_DUPLICATED_DELIVERY");
      samples.push({ durationMs: opened.durationMs, cursor: opened.page.nextAfterDeliverySequence, deliveryCount: opened.page.deliveries.length });
    }
    const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const p95Ms = percentile(durations, 0.95);
    report.transport = {
      endpoint: `/api/v4/rooms/${runId}/events/stream`,
      protocol: "HTTP SSE",
      authentication: "member bearer token",
      firstFrameIncludesDurableDelivery: true,
      reconnectAfterDeliverySequence: 1,
      reconnectDuplicatedDeliveries: 0,
      outsiderEventFeedStatus: outsiderResponse.status,
      sampleCount: samples.length,
      latencyMs: {
        min: durations[0],
        p50: percentile(durations, 0.5),
        p95: p95Ms,
        max: durations.at(-1)
      }
    };
    report.samples = samples;
    assert(p95Ms < SSE_P95_LIMIT_MS, `SSE_ESTABLISHMENT_P95_EXCEEDED:${p95Ms}`);
    report.status = "PASS";
    report.completedAt = new Date().toISOString();
  } catch (error) {
    report.status = "FAIL";
    report.message = redact(String((error as Error)?.stack || (error as Error)?.message || error));
    report.failedAt = new Date().toISOString();
    throw error;
  } finally {
    if (api && api.exitCode === null) {
      api.kill("SIGTERM");
      await Promise.race([onceExit(api), delay(5_000)]);
      if (api.exitCode === null) api.kill("SIGKILL");
    }
    await writeFile(path.join(evidenceDir, "api.out.log"), redact(stdout), "utf8");
    await writeFile(path.join(evidenceDir, "api.err.log"), redact(stderr), "utf8");
    await writeFile(path.join(evidenceDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await prisma.$disconnect();
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function seed(prisma: PrismaClient, input: {
  runId: string;
  user: { id: string; openid: string };
  outsider: { id: string; openid: string };
}) {
  const templateId = `transport_template_${input.runId}`;
  const roleId = `transport_role_${input.runId}`;
  const eventId = input.runId.replace("transport_room_", "transport_event_");
  await prisma.worldTemplate.create({
    data: { id: templateId, name: "Transport acceptance", genre: "acceptance", hook: "SSE", worldBase: "SSE", status: "published", configJson: {} }
  });
  await prisma.user.createMany({
    data: [input.user, input.outsider].map((value) => ({
      ...value,
      email: `${value.id}@example.test`,
      emailVerifiedAt: new Date(),
      nickname: value.id,
      status: "active"
    }))
  });
  await prisma.storyRun.create({
    data: {
      id: input.runId,
      templateId,
      ownerUserId: input.user.id,
      title: "Transport acceptance",
      hook: "SSE",
      mode: "room",
      templateKey: "sangtian",
      status: "playing",
      stateJson: {},
      inviteCode: `SSE${randomBytes(4).toString("hex")}`,
      engineVersion: "continuous_openovel_v1",
      strategyVersion: "continuous_story_v2",
      billingPolicyVersion: "active_action_v1"
    }
  });
  await prisma.storyRole.create({
    data: {
      id: roleId,
      runId: input.runId,
      roleKey: "zhejiang_governor",
      roleName: "浙江总督",
      identity: "transport member",
      publicInfo: "member",
      personalGoal: "receive events",
      currentState: "active",
      knownInfoJson: [],
      cannotDoJson: [],
      status: "locked"
    }
  });
  await prisma.storyPlayer.create({
    data: { runId: input.runId, userId: input.user.id, roleId, playerType: "human", status: "active" }
  });
  await prisma.storyEvent.create({
    data: {
      id: eventId,
      runId: input.runId,
      day: 1,
      type: "TRANSPORT_ACCEPTANCE",
      visibility: "PRIVATE",
      payloadJson: { safe: true },
      sequence: 1,
      dedupeKey: `transport:${input.runId}`,
      audienceType: "MEMBER",
      audienceRoleIdsJson: [roleId]
    }
  });
  await prisma.eventDeliveryCursor.create({ data: { roomId: input.runId, userId: input.user.id, nextSequence: 2 } });
  await prisma.eventDelivery.create({
    data: {
      eventId,
      roomId: input.runId,
      userId: input.user.id,
      roleId,
      deliverySequence: 1,
      payloadJson: { type: "TRANSPORT_ACCEPTANCE", visibility: "PRIVATE", payload: { safe: true } }
    }
  });
}

async function openFirstFrame(apiBase: string, runId: string, token: string, afterDeliverySequence: number) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5_000);
  const startedAt = performance.now();
  try {
    const response = await fetch(`${apiBase}/v4/rooms/${encodeURIComponent(runId)}/events/stream?afterDeliverySequence=${afterDeliverySequence}`, {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
      signal: abort.signal
    });
    assert(response.status === 200, `SSE_STATUS:${response.status}`);
    assert(String(response.headers.get("content-type") || "").includes("text/event-stream"), "SSE_CONTENT_TYPE_INVALID");
    const reader = response.body?.getReader();
    assert(reader, "SSE_BODY_MISSING");
    const decoder = new TextDecoder();
    let buffer = "";
    while (!buffer.includes("\n\n")) {
      const next = await reader.read();
      assert(!next.done, "SSE_CLOSED_BEFORE_FIRST_FRAME");
      buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n/g, "\n");
    }
    const durationMs = round(performance.now() - startedAt);
    const block = buffer.slice(0, buffer.indexOf("\n\n"));
    const data = block.split("\n").filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n");
    assert(data, "SSE_FIRST_FRAME_DATA_MISSING");
    const page = JSON.parse(data) as { deliveries: Array<{ eventId: string }>; nextAfterDeliverySequence: number };
    await reader.cancel();
    return { durationMs, page };
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

function percentile(sorted: number[], quantile: number) {
  assert(sorted.length > 0, "PERCENTILE_EMPTY");
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHttp(url: string, child: ChildProcess, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API_EXITED:${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("API_READINESS_TIMEOUT");
}

function onceExit(child: ChildProcess) {
  return new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredEnv(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function redact(value: string) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL_REDACTED]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
}

main().catch((error) => {
  process.stderr.write(`${redact(String((error as Error)?.stack || error))}\n`);
  process.exitCode = 1;
});
