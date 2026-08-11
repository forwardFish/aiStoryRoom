import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  A_EMOTION_E2E_ROLE_KEYS,
  createRandomSchema,
  hashIdentifier,
  pnpmInvocation,
  redactDynamicApiPath,
  requireNonProductionSupabaseUrl,
  resolvePnpmTransport,
  sanitizeEvidence,
  scopedDatabaseUrl,
  sha256Text,
  type PnpmTransport
} from "./a-emotion-m6-e2e-contract.mts";

const root = resolve(import.meta.dirname, "../..");
const configuredEnvFile = process.env.A_EMOTION_M6_ENV_FILE?.trim();
const envFile = resolve(root, configuredEnvFile || ".env.test");
const fileEnv = await readEnvFile(envFile, Boolean(configuredEnvFile));
const inherited = { ...fileEnv, ...process.env } as NodeJS.ProcessEnv;
const baseDatabase = requireNonProductionSupabaseUrl(
  requiredFrom(inherited, "A_EMOTION_M6_E2E_SUPABASE_URL", "A_EMOTION_M6_SUPABASE_URL", "DATABASE_URL"),
  inherited.A_EMOTION_M6_NONPROD_CONFIRM
);
requireRealModelConfiguration(inherited);
const pnpmTransport = resolvePnpmTransport(inherited);

const stamp = `${Date.now()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const schema = createRandomSchema();
const baseDatabaseUrl = baseDatabase.toString();
const scopedUrl = scopedDatabaseUrl(baseDatabase, schema);
const apiPort = numberEnv(inherited.A_EMOTION_M6_API_PORT, 3312);
const webPort = numberEnv(inherited.A_EMOTION_M6_WEB_PORT, 5377);
const apiBase = `http://127.0.0.1:${apiPort}/api`;
const webBase = `http://127.0.0.1:${webPort}`;
const runtimeDir = resolve(root, ".runtime", `aemotion-m6-e2e-${stamp}`);
const privateDir = resolve(runtimeDir, "private");
const evidenceDir = resolve(runtimeDir, "evidence");
const logsDir = resolve(runtimeDir, "logs");
const stateFile = resolve(privateDir, "players.json");
const creditMarker = `aemotion-m6-credit-${hashIdentifier(stamp, 12)}`;
const knownSecrets = [baseDatabaseUrl, scopedUrl, inherited.DEEPSEEK_API_KEY || "", inherited.OPENAI_API_KEY || ""].filter((value) => value.length >= 6);
const serviceEnv: NodeJS.ProcessEnv = {
  ...inherited,
  NODE_ENV: "test",
  APP_ENV: "test",
  DATABASE_URL: scopedUrl,
  API_PORT: String(apiPort),
  PUBLIC_APP_URL: webBase,
  AUTH_COOKIE_SECURE: "false",
  STORY_WORKER_EMBEDDED: "false",
  MULTIPLAYER_CONTINUOUS_STRATEGY_ENABLED: "true",
  A_EMOTION_MVP_ENABLED: "true",
  A_EMOTION_M1_ENABLED: "true",
  A_EMOTION_M2_ENABLED: "true",
  A_EMOTION_M3_ENABLED: "true",
  A_EMOTION_M4_ENABLED: "true",
  A_EMOTION_M5_ENABLED: "true",
  A_EMOTION_M6_ENABLED: "true",
  A_EMOTION_SITUATION_FEED_ENABLED: "true",
  A_EMOTION_CROSS_IMPACT_CARD_ENABLED: "true",
  A_EMOTION_KEY_MODALS_ENABLED: "true",
  A_EMOTION_SIMPLE_PROMISE_ENABLED: "true",
  A_EMOTION_STAGE_MILESTONES_ENABLED: "true",
  A_EMOTION_INTERACTION_HISTORY_ENABLED: "true",
  A_EMOTION_M6_RECOVERY_ENABLED: "true",
  A_EMOTION_M6_E2E_HARNESS_ENABLED: "true",
  A_EMOTION_M6_RETRY_BASE_MS: "60000",
  A_EMOTION_M6_DEADLINE_MS: "300000",
  A_EMOTION_M6_MAX_ATTEMPTS: "5",
  A_EMOTION_M6_DEAD_LETTER_ATTEMPTS: "5",
  A_EMOTION_POLL_INTERVAL_MS: "7000",
  ALLOW_FAULT_INJECTION: "true",
  ALLOW_TEST_CREDIT_GRANT: "true",
  ROLE_AGENT_PROVIDER: inherited.ROLE_AGENT_PROVIDER || "deepseek"
};

type ManagedChild = { label: string; child: ChildProcess; output: string[]; logPath: string };
let admin: PrismaClient | null = null;
let scoped: PrismaClient | null = null;
const children: ManagedChild[] = [];
let workerChild: ManagedChild | null = null;
let schemaCreated = false;
let roomId = "";

await mkdir(privateDir, { recursive: true, mode: 0o700 });
await mkdir(evidenceDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

try {
  // Windows must not have a Prisma Client connected when generate replaces the
  // query-engine DLL. The non-production URL and real-model safety gates have
  // already run, but no Prisma module/client/database operation exists yet.
  await runPnpm(["exec", "prisma", "generate"], serviceEnv, "prisma-generate.log");
  const prismaModule = await import("@prisma/client");
  const PrismaClientConstructor = prismaModule.PrismaClient;
  admin = new PrismaClientConstructor({ datasources: { db: { url: baseDatabaseUrl } } });
  scoped = new PrismaClientConstructor({ datasources: { db: { url: scopedUrl } } });

  await admin.$connect();
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  await runPnpm(["exec", "prisma", "db", "push", "--skip-generate"], serviceEnv, "prisma-push.log");
  await runPnpm(["db:seed"], serviceEnv, "prisma-seed.log");
  await scoped.$connect();

  const players = await createOneTimePlayers(scoped, webBase, creditMarker, privateDir, serviceEnv);
  const apiChild = startPnpm("api", ["--filter", "@apps/api", "dev"], { ...serviceEnv, PORT: String(apiPort) }, resolve(logsDir, "api.log"));
  children.push(apiChild);
  await waitForHttp(`${apiBase}/health`, 120_000);
  await grantAcceptanceCredits(apiBase, players, creditMarker, 600);

  const webChild = startPnpm("web", ["--filter", "@apps/web", "dev"], { ...serviceEnv, PORT: String(webPort), API_PORT: String(apiPort) }, resolve(logsDir, "web.log"));
  children.push(webChild);
  await waitForHttp(`${webBase}/game`, 120_000);

  workerChild = startPnpm("worker", ["--filter", "@apps/api", "worker"], { ...serviceEnv, STORY_WORKER_PROCESS: "true", PORT: "" }, resolve(logsDir, "worker.log"));
  children.push(workerChild);
  await waitForWorkerSignal(workerChild, 60_000);

  const setup = await createThreeRoleRoom(apiBase, players, stamp);
  roomId = setup.roomId;
  const playerStates = players.map((player) => ({
    roleKey: player.roleKey,
    roleId: setup.roleByKey[player.roleKey],
    userId: player.userId,
    storageState: player.storageState
  }));
  await writeFile(stateFile, `${JSON.stringify(playerStates, null, 2)}\n`, { mode: 0o600 });

  await runPnpm(["exec", "tsx", "scripts/e2e/a-emotion-m6-three-role-harness.mts"], {
    ...serviceEnv,
    A_EMOTION_M6_BASE_URL: webBase,
    A_EMOTION_M6_API_BASE: apiBase,
    A_EMOTION_M6_ROOM_ID: roomId,
    A_EMOTION_M6_PLAYER_STATES_JSON: stateFile,
    A_EMOTION_M6_EVIDENCE_DIR: evidenceDir,
    A_EMOTION_M6_REQUIRE_REAL_MODEL: "true"
  }, "harness.log", true);

  const recoveryProof = await exerciseWorkerCrashRecovery({
    prisma: scoped,
    apiBase,
    hostToken: players.find((entry) => entry.roleKey === "zhejiang_governor")!.token,
    roomId,
    serviceEnv,
    currentWorker: workerChild
  });
  workerChild = recoveryProof.worker;
  children.push(workerChild);
  await writeJson(resolve(evidenceDir, "recovery-proof.json"), sanitizeEvidence(recoveryProof.proof, knownSecrets));

  const databaseProof = await collectDatabaseProof(scoped, roomId);
  await writeJson(resolve(evidenceDir, "database-proof.json"), sanitizeEvidence(databaseProof, knownSecrets));
  const tableCount = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM information_schema.tables WHERE table_schema = '${schema}'`
  );
  assert.ok(Number(tableCount[0]?.count || 0) > 0, "random schema must contain persisted E2E state before cleanup");
  await writeJson(resolve(evidenceDir, "orchestrator-result.json"), sanitizeEvidence({
    schemaVersion: "a_emotion_m6_orchestrator_result_v2",
    status: "PASS",
    roomIdHash: sha256Text(roomId),
    schemaFingerprint: sha256Text(schema),
    users: playerStates.map(({ roleKey, userId }) => ({ roleKey, userIdHash: sha256Text(userId) })),
    services: { api: true, web: true, worker: true, realModel: true },
    databaseProof
  }, knownSecrets));
  console.log(JSON.stringify({ status: "PASS", roomIdHash: sha256Text(roomId), schemaFingerprint: sha256Text(schema) }));
} finally {
  for (const managed of uniqueChildren(children).reverse()) await stopProcessTree(managed);
  const [apiClosed, webClosed] = await Promise.all([
    waitForPortClosed(apiPort, 15_000),
    waitForPortClosed(webPort, 15_000)
  ]);
  const workersStopped = uniqueChildren(children).filter((entry) => entry.label.includes("worker")).every((entry) => entry.child.exitCode !== null || entry.child.signalCode !== null);
  await scoped?.$disconnect().catch(() => undefined);
  await rm(privateDir, { recursive: true, force: true });
  if (schemaCreated && admin) await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  const absent = admin
    ? await admin.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS count FROM information_schema.schemata WHERE schema_name = '${schema}'`).catch(() => [{ count: 1n }])
    : [{ count: schemaCreated ? 1n : 0n }];
  const schemaAbsent = Number(absent[0]?.count || 0) === 0;
  await writeJson(resolve(evidenceDir, "cleanup-proof.json"), {
    schemaVersion: "a_emotion_m6_e2e_cleanup_v2",
    schemaFingerprint: sha256Text(schema),
    schemaAbsent,
    privateStateRemoved: true,
    processesStopped: apiClosed && webClosed && workersStopped,
    apiPortClosed: apiClosed,
    webPortClosed: webClosed,
    workerProcessesStopped: workersStopped,
    finishedAt: new Date().toISOString()
  });
  assert.equal(apiClosed, true, "API process tree must release its configured port in finally");
  assert.equal(webClosed, true, "Web process tree must release its configured port in finally");
  assert.equal(workersStopped, true, "worker process tree must be stopped in finally");
  assert.equal(schemaAbsent, true, "random E2E schema must be absent after finally cleanup");
  await admin?.$disconnect().catch(() => undefined);
  console.log(JSON.stringify({ cleanup: "PASS", schemaAbsent: true, processesStopped: true, schemaFingerprint: sha256Text(schema), roomIdHash: roomId ? sha256Text(roomId) : null }));
}

type RoleKey = "zhejiang_governor" | "xunfu" | "county_magistrate";
type OneTimePlayer = { roleKey: RoleKey; userId: string; openid: string; token: string; storageState: string; email: string };

async function createOneTimePlayers(prisma: PrismaClient, origin: string, marker: string, outputDir: string, authEnv: NodeJS.ProcessEnv): Promise<OneTimePlayer[]> {
  const roles: RoleKey[] = [...A_EMOTION_E2E_ROLE_KEYS];
  const url = new URL(origin);
  const output: OneTimePlayer[] = [];
  for (const [index, roleKey] of roles.entries()) {
    const userId = `aemotion-m6-user-${marker}-${index + 1}`;
    const openid = `aemotion-m6-openid-${marker}-${index + 1}`;
    const email = `${marker}-${index + 1}@example.test`;
    await prisma.user.create({ data: {
      id: userId,
      openid,
      email,
      emailVerifiedAt: new Date(),
      nickname: `AEmotion E2E ${roleKey}`,
      status: "active",
      policyAgreedAt: new Date()
    } });
    const token = issueE2EAccessToken({ id: userId, openid }, authEnv);
    const storageState = resolve(outputDir, `${roleKey}.storage-state.json`);
    await writeJson(storageState, {
      cookies: [
        { name: "many_worlds_session", value: token, domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
        { name: "many_worlds_session_hint", value: "1", domain: url.hostname, path: "/", httpOnly: false, secure: url.protocol === "https:", sameSite: "Lax" }
      ],
      origins: []
    }, 0o600);
    output.push({ roleKey, userId, openid, token, storageState, email });
  }
  return output;
}

async function grantAcceptanceCredits(apiBaseUrl: string, players: OneTimePlayer[], marker: string, amount: number) {
  for (const player of players) {
    const grant = await api(apiBaseUrl, player.token, "POST", "/v4/credits/test-grant", { runId: marker, amount });
    assert.ok(String(grant.ledgerId || ""), "test credit grant must return one ledger id");
    assert.ok(Number(grant.balance?.available || 0) >= amount, "test credit grant must prepare a bounded usable balance");
    const balance = await api(apiBaseUrl, player.token, "GET", "/v4/credits/balance");
    assert.equal(Number(balance.available || 0), Number(grant.balance.available || 0), "credit balance readback must match the idempotent grant response");
  }
}

async function createThreeRoleRoom(apiBaseUrl: string, players: OneTimePlayer[], marker: string) {
  const host = players.find((entry) => entry.roleKey === "zhejiang_governor")!;
  const created = await api(apiBaseUrl, host.token, "POST", "/v4/rooms", {
    worldId: "sangtian",
    title: `A-Emotion M6 E2E ${hashIdentifier(marker, 12)}`,
    visibility: "private",
    maxPlayers: 3,
    idempotencyKey: `aemotion-m6-room:${marker}`
  });
  const createdRoomId = String(created.id || created.roomId || "");
  const code = String(created.code || created.inviteCode || "");
  assert.ok(createdRoomId && code, "room create must return id and invite code");
  const roleByKey: Record<RoleKey, string> = {} as never;

  for (const [index, player] of players.entries()) {
    if (index > 0) await api(apiBaseUrl, player.token, "POST", "/v4/rooms/join-by-code", { code });
    const room = await api(apiBaseUrl, player.token, "GET", `/v4/rooms/${createdRoomId}`);
    const role = (room.roles || []).find((entry: any) => entry.roleKey === player.roleKey);
    assert.ok(role?.id, `room must expose exact role ${player.roleKey}`);
    roleByKey[player.roleKey] = String(role.id);
    await api(apiBaseUrl, player.token, "POST", `/v4/rooms/${createdRoomId}/role`, { roleId: role.id });
    if (player.roleKey === "zhejiang_governor") await api(apiBaseUrl, player.token, "POST", `/v4/rooms/${createdRoomId}/role/lock`, {});
  }
  for (const player of players) await api(apiBaseUrl, player.token, "POST", `/v4/rooms/${createdRoomId}/ready`, { ready: true });

  let started: any = null;
  const startDeadline = Date.now() + 240_000;
  let attempt = 0;
  while (Date.now() < startDeadline) {
    attempt += 1;
    const response = await apiResult(apiBaseUrl, host.token, "POST", `/v4/rooms/${createdRoomId}/start`, {});
    if (response.ok) { started = response.payload; break; }
    if (response.status !== 503 || response.code !== "OPENING_STORY_GENERATING") throw apiFailure("POST", `/v4/rooms/${createdRoomId}/start`, response.status, response.code, response.message);
    await sleep(Math.min(5_000, 500 * 2 ** Math.min(attempt, 4)));
  }
  if (!started) throw new Error(`room opening did not leave OPENING_STORY_GENERATING before the bounded deadline; room=${hashIdentifier(createdRoomId, 12)}`);
  assert.equal(started.status, "playing");
  await waitForPlayableOpening(apiBaseUrl, host.token, createdRoomId, 180_000);
  return { roomId: createdRoomId, roleByKey };
}

async function waitForPlayableOpening(apiBaseUrl: string, token: string, targetRoomId: string, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const response = await apiResult(apiBaseUrl, token, "GET", `/v4/rooms/${targetRoomId}/game`);
    if (response.ok) {
      const turn = response.payload.currentTurn;
      if (turn?.status === "OPEN" && String(turn.narrative || "").trim() && Array.isArray(turn.decisions) && turn.decisions.length > 0) return response.payload;
    } else if (response.status < 500 || response.code !== "OPENING_STORY_GENERATING") {
      throw apiFailure("GET", `/v4/rooms/${targetRoomId}/game`, response.status, response.code, response.message);
    }
    await sleep(1_000);
  }
  throw new Error(`authoritative opening narrative did not become playable before timeout; room=${hashIdentifier(targetRoomId, 12)}`);
}

async function exerciseWorkerCrashRecovery(input: { prisma: PrismaClient; apiBase: string; hostToken: string; roomId: string; serviceEnv: NodeJS.ProcessEnv; currentWorker: ManagedChild | null }) {
  if (input.currentWorker) await stopProcessTree(input.currentWorker);
  const status = await api(input.apiBase, input.hostToken, "GET", `/v4/rooms/${input.roomId}/a-emotion/recovery/status`);
  const paused = await api(input.apiBase, input.hostToken, "POST", `/v4/rooms/${input.roomId}/a-emotion/recovery/pause`, { expectedVersion: status.runVersion, reason: "M6_E2E_WORKER_CRASH" });
  assert.equal(paused.paused, true);
  const run = await input.prisma.storyRun.findUniqueOrThrow({ where: { id: input.roomId }, select: { currentNodeId: true, roles: { select: { id: true }, take: 1 } } });
  assert.ok(run.currentNodeId, "worker recovery requires an authoritative current node");
  const now = new Date();
  const leaseExpiredAt = new Date(now.getTime() - 30_000);
  const recoverCreatedAt = new Date(now.getTime() - 60_000);
  const deadCreatedAt = new Date(now.getTime() - 600_000);
  const recoverKey = `M6_E2E_RECOVER:${randomUUID()}`;
  const deadKey = `M6_E2E_DEAD:${randomUUID()}`;
  await input.prisma.storyTaskOutbox.createMany({ data: [
    { runId: input.roomId, nodeId: run.currentNodeId, roleId: run.roles[0]?.id || null, inputRefId: recoverKey, actionSlot: "M6_E2E_RECOVERY", taskType: "INTERACTION_COMPILE_REQUESTED", status: "RUNNING", dedupeKey: recoverKey, attempt: 1, maxAttempts: 5, leaseOwner: "m6-e2e-crashed-worker", leaseExpiresAt: leaseExpiredAt, leaseVersion: 2, startedAt: recoverCreatedAt, createdAt: recoverCreatedAt, nextRetryAt: recoverCreatedAt },
    { runId: input.roomId, nodeId: run.currentNodeId, roleId: run.roles[0]?.id || null, inputRefId: deadKey, actionSlot: "M6_E2E_RECOVERY", taskType: "INTERACTION_COMPILE_REQUESTED", status: "RUNNING", dedupeKey: deadKey, attempt: 5, maxAttempts: 5, leaseOwner: "m6-e2e-crashed-worker", leaseExpiresAt: leaseExpiredAt, leaseVersion: 3, startedAt: deadCreatedAt, createdAt: deadCreatedAt, nextRetryAt: deadCreatedAt }
  ] });

  const replacement = startPnpm("worker-restarted", ["--filter", "@apps/api", "worker"], { ...input.serviceEnv, STORY_WORKER_PROCESS: "true", PORT: "" }, resolve(logsDir, "worker-restarted.log"));
  await waitForWorkerSignal(replacement, 60_000);
  const whilePaused = await input.prisma.storyTaskOutbox.findMany({ where: { dedupeKey: { in: [recoverKey, deadKey] } }, select: { dedupeKey: true, status: true, leaseOwner: true, leaseVersion: true } });
  assert.equal(whilePaused.length, 2);
  assert.ok(whilePaused.every((row: { status: string; leaseOwner: string | null }) => row.status === "RUNNING" && row.leaseOwner === "m6-e2e-crashed-worker"), "paused room must not recover expired A-Emotion tasks");
  const resumed = await api(input.apiBase, input.hostToken, "POST", `/v4/rooms/${input.roomId}/a-emotion/recovery/resume`, { expectedVersion: paused.runVersion, reason: "M6_E2E_WORKER_RESTART" });
  assert.equal(resumed.paused, false);

  const deadline = Date.now() + 30_000;
  let finalRows: Array<{ dedupeKey: string; status: string; outcome: string | null; lastError: string | null; leaseOwner: string | null; leaseVersion: number }> = [];
  while (Date.now() < deadline) {
    finalRows = await input.prisma.storyTaskOutbox.findMany({ where: { dedupeKey: { in: [recoverKey, deadKey] } }, select: { dedupeKey: true, status: true, outcome: true, lastError: true, leaseOwner: true, leaseVersion: true } });
    const recovered = finalRows.find((row) => row.dedupeKey === recoverKey);
    const dead = finalRows.find((row) => row.dedupeKey === deadKey);
    if (recovered?.status === "PENDING" && recovered.lastError === "A_EMOTION_M6_EXPIRED_LEASE_RECOVERED" && dead?.status === "FAILED" && dead.outcome === "DEAD_LETTER") break;
    await sleep(250);
  }
  const recovered = finalRows.find((row) => row.dedupeKey === recoverKey);
  const dead = finalRows.find((row) => row.dedupeKey === deadKey);
  assert.equal(recovered?.status, "PENDING");
  assert.equal(recovered?.lastError, "A_EMOTION_M6_EXPIRED_LEASE_RECOVERED");
  assert.equal(dead?.status, "FAILED");
  assert.equal(dead?.outcome, "DEAD_LETTER");
  return { worker: replacement, proof: { schemaVersion: "a_emotion_m6_worker_recovery_proof_v2", pausedStatePreserved: true, resumed: true, crashedWorkerLeaseRecovered: true, boundedTaskDeadLettered: true, rows: finalRows.map((row) => ({ status: row.status, outcome: row.outcome, lastError: row.lastError, leaseVersion: row.leaseVersion, dedupeKeyHash: sha256Text(row.dedupeKey) })), verifiedAt: new Date().toISOString() } };
}

async function collectDatabaseProof(prisma: PrismaClient, runId: string) {
  const [run, players, events, deliveries, promises, milestones, metrics, tasks] = await Promise.all([
    prisma.storyRun.findUnique({ where: { id: runId }, select: { version: true, worldSequence: true, status: true } }),
    prisma.storyPlayer.findMany({ where: { runId }, select: { userId: true, role: { select: { roleKey: true } }, playerType: true, status: true } }),
    prisma.storyEvent.count({ where: { runId } }),
    prisma.eventDelivery.count({ where: { roomId: runId } }),
    prisma.commitmentV2.findMany({ where: { runId, promiseCode: { not: null } }, select: { promiseCode: true, status: true, lifecycleVersion: true } }),
    prisma.aEmotionStageMilestone.findMany({ where: { runId }, select: { milestoneCode: true, status: true, stateVersion: true } }),
    prisma.aEmotionMetricTransition.findMany({ where: { runId }, select: { metricKey: true, previousValue: true, currentValue: true, triggerVersion: true } }),
    prisma.storyTaskOutbox.groupBy({ by: ["status", "taskType"], where: { runId }, _count: { _all: true } })
  ]);
  return {
    schemaVersion: "a_emotion_m6_database_proof_v2",
    runIdHash: sha256Text(runId),
    run,
    players: players.map((player: { userId: string | null; role: { roleKey: string } | null; playerType: string; status: string }) => ({ userIdHash: player.userId ? sha256Text(player.userId) : null, roleKey: player.role?.roleKey || null, playerType: player.playerType, status: player.status })),
    counts: { events, deliveries },
    promises,
    milestones,
    metrics,
    tasks
  };
}

async function api(base: string, token: string, method: string, path: string, body?: unknown) {
  const result = await apiResult(base, token, method, path, body);
  if (!result.ok) throw apiFailure(method, path, result.status, result.code, result.message);
  return result.payload;
}

async function apiResult(base: string, token: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, code: String(payload.code || "UNKNOWN"), message: String(payload.message || "request failed"), payload };
}

function apiFailure(method: string, path: string, status: number, code: string, message: string) {
  return new Error(`${method} ${redactDynamicApiPath(path)} -> ${status} ${code}: ${sanitizeEvidence(message, knownSecrets)}`);
}

function startPnpm(label: string, args: string[], env: NodeJS.ProcessEnv, logPath: string) {
  const invocation = pnpmInvocation(pnpmTransport, args);
  return start(label, invocation.program, invocation.args, env, logPath);
}

function start(label: string, program: string, args: string[], env: NodeJS.ProcessEnv, logPath: string): ManagedChild {
  const child = spawn(program, args, { cwd: root, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], shell: false });
  const output: string[] = [];
  void writeFile(logPath, "", "utf8");
  const record = (chunk: Buffer) => {
    const safe = redact(chunk.toString("utf8"));
    output.push(safe);
    if (output.join("").length > 2_000_000) output.splice(0, Math.max(0, output.length - 100));
    void appendFile(logPath, safe, "utf8");
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);
  child.once("error", (error) => record(Buffer.from(`${label}: ${redact(String(error))}\n`)));
  return { label, child, output, logPath };
}

async function stopProcessTree(managed: ManagedChild) {
  const child = managed.child;
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false });
      killer.once("error", () => resolvePromise());
      killer.once("exit", () => resolvePromise());
    });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    await Promise.race([new Promise((resolvePromise) => child.once("exit", resolvePromise)), sleep(5_000)]);
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
  }
  await Promise.race([new Promise((resolvePromise) => child.once("exit", resolvePromise)), sleep(10_000)]);
}

async function waitForHttp(url: string, timeout: number) {
  const deadline = Date.now() + timeout;
  let last = "";
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; last = `HTTP ${response.status}`; } catch (error) { last = String(error); }
    await sleep(250);
  }
  throw new Error(`service did not become ready: ${sanitizeEvidence(url)}; last=${redact(last)}`);
}

async function waitForWorkerSignal(worker: ManagedChild, timeout: number) {
  const deadline = Date.now() + timeout;
  const readyPattern = /(Nest application successfully started|Nest application context|Story task|ApplicationContext)/iu;
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) throw new Error(`worker exited before readiness; exit=${worker.child.exitCode}`);
    if (readyPattern.test(worker.output.join(""))) return;
    await sleep(100);
  }
  throw new Error("worker did not emit its own ready/processing signal before timeout");
}

async function runPnpm(args: string[], env: NodeJS.ProcessEnv, logName: string, inherit = false) {
  const invocation = pnpmInvocation(pnpmTransport, args);
  return run(invocation.program, invocation.args, env, logName, inherit);
}

async function run(program: string, args: string[], env: NodeJS.ProcessEnv, logName: string, inherit = false) {
  const logPath = resolve(logsDir, logName);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd: root, env, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"], shell: false });
    const chunks: string[] = [];
    child.stdout?.on("data", (chunk) => chunks.push(redact(chunk.toString("utf8"))));
    child.stderr?.on("data", (chunk) => chunks.push(redact(chunk.toString("utf8"))));
    child.once("error", reject);
    child.once("exit", (code) => {
      void writeFile(logPath, chunks.join(""), "utf8");
      code === 0 ? resolvePromise() : reject(new Error(`pnpm command exited ${code}; log=${logPath}`));
    });
  });
}

async function waitForPortClosed(port: number, timeout: number) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolvePromise) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolvePromise(true); });
      socket.once("error", () => resolvePromise(false));
      socket.setTimeout(500, () => { socket.destroy(); resolvePromise(false); });
    });
    if (!open) return true;
    await sleep(250);
  }
  return false;
}

async function readEnvFile(path: string, required: boolean): Promise<Record<string, string>> {
  let source = "";
  try { source = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (required) throw new Error("Configured A_EMOTION_M6_ENV_FILE was not found");
  }
  const output: Record<string, string> = {};
  for (const raw of source.split(/\r?\n/u)) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("="); if (index < 1) continue;
    const key = line.slice(0, index).trim(); let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

function issueE2EAccessToken(user: { id: string; openid: string }, env: NodeJS.ProcessEnv, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, openid: user.openid, aud: "many-worlds-v4", authMethod: "PASSWORD", exp: Math.floor(now / 1000) + authSessionTtlSeconds(env) })).toString("base64url");
  const signature = createHmac("sha256", authTokenSecret(env)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function authTokenSecret(env: NodeJS.ProcessEnv) { const configured = env.AUTH_TOKEN_SECRET?.trim(); if (configured) return configured; if (env.NODE_ENV === "production") throw new Error("AUTH_TOKEN_SECRET must be configured in production"); return "many-worlds-local-development-token-secret"; }
function authSessionTtlSeconds(env: NodeJS.ProcessEnv) { const configured = Number(env.AUTH_SESSION_TTL_DAYS || 30); const days = Number.isFinite(configured) ? Math.min(90, Math.max(1, Math.floor(configured))) : 30; return days * 24 * 60 * 60; }
function requireRealModelConfiguration(env: NodeJS.ProcessEnv) { const provider = String(env.ROLE_AGENT_PROVIDER || "deepseek").toLowerCase(); if (provider === "deepseek" && !env.DEEPSEEK_API_KEY?.trim()) throw new Error("DEEPSEEK_API_KEY is required for the real-model M6 E2E gate"); if (provider !== "deepseek" && !env.DEEPSEEK_API_KEY?.trim() && !env.OPENAI_API_KEY?.trim()) throw new Error("a real model credential is required; deterministic/mock providers are not accepted"); if (/mock|deterministic|fixture|stub/iu.test(provider)) throw new Error("mock/deterministic model providers are forbidden for the M6 browser gate"); }
function uniqueChildren(values: ManagedChild[]) { const seen = new Set<number>(); return values.filter((entry) => { const pid = entry.child.pid || -1; if (seen.has(pid)) return false; seen.add(pid); return true; }); }
function requiredFrom(env: NodeJS.ProcessEnv, ...names: string[]) { for (const name of names) { const value = env[name]?.trim(); if (value) return value; } throw new Error(`${names.join(" or ")} is required`); }
function numberEnv(value: string | undefined, fallback: number) { const parsed = Number(value || fallback); if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > 65535) throw new Error("invalid port"); return parsed; }
function redact(value: string) { return sanitizeEvidence(value, knownSecrets); }
function sleep(ms: number) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
async function writeJson(path: string, value: unknown, mode = 0o644) { await writeFile(path, `${JSON.stringify(value, jsonReplacer, 2)}\n`, { encoding: "utf8", mode }); }
function jsonReplacer(_key: string, value: unknown) { return typeof value === "bigint" ? value.toString() : value; }
