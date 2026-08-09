import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { verifySoloEndgameInBrowser } from "./solo-endgame-browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const databaseUrl = String(process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "").trim();
assert.ok(databaseUrl, "SOLO_ENDGAME_SUPABASE_TEST_CONFIG_REQUIRED");
assert.notEqual(process.env.NODE_ENV, "production", "Solo endgame E2E cannot run in production");
const dbUrl = new URL(databaseUrl);
assert.match(dbUrl.hostname, /supabase/i, "Solo endgame E2E requires the configured Supabase test database");
process.env.DATABASE_URL = databaseUrl;

const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const outputDir = path.join(root, "scripts", "test-reports", `solo-endgame-mvp-${stamp}`);
const workspaceRoot = path.join(os.tmpdir(), `omw-solo-endgame-${stamp}`);
const mailSink = path.join(outputDir, "auth-mail.ndjson");
const authSecret = `solo-endgame-${randomUUID()}`;
const runtimeToken = `runtime-${randomUUID()}`;
const [runtimePort, apiPort, webPort] = await Promise.all([freePort(), freePort(), freePort()]);
const runtimeBase = `http://127.0.0.1:${runtimePort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const apiBase = `${apiOrigin}/api`;
const webBase = `http://127.0.0.1:${webPort}`;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

await mkdir(outputDir, { recursive: true });
await rm(workspaceRoot, { recursive: true, force: true });
await rm(mailSink, { force: true });

const prisma = new PrismaClient();
const children = new Map();
const testEmails = [];
let endingBackup = null;
let endingPath = "";
let report = null;

const baseEnv = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  SUPABASE_DATABASE_URL: databaseUrl,
  AUTH_TOKEN_SECRET: authSecret,
  AUTH_COOKIE_SECURE: "false",
  EMAIL_PROVIDER: "file-sink",
  AUTH_MAIL_SINK_FILE: mailSink,
  PUBLIC_WEB_URL: webBase,
  OPENOVEL_RUNTIME_URL: runtimeBase,
  OPENOVEL_INTERNAL_TOKEN: runtimeToken,
  OPENOVEL_V1_ENABLED: "1",
  CREDIT_DEFAULT_POLICY: "active_action_v1",
  CREDIT_ACTION_METERING_MODE: "OFF",
  OPENOVEL_API_KEY: "",
  SOLO_STORY_API_KEY: "",
  DEEPSEEK_API_KEY: "",
  GLM_API_KEY: "",
  OPENOVEL_PROVIDER_BASE_URL: "https://api.deepseek.com",
};

try {
  const databaseIdentity = await prisma.$queryRawUnsafe("select current_database() as database, current_user as username");
  await startRuntime();
  await startApi();
  await startWeb();

  const owner = await createVerifiedAccount("owner");
  const outsider = await createVerifiedAccount("outsider");

  const routeA = await completeRoute(owner, "protective");
  const routeB = await completeRoute(owner, "grain-first");
  assert.notEqual(routeA.ending.endingKey, routeB.ending.endingKey, "the two legal T01-T20 routes must produce different authoritative endings");

  await assertForbiddenResult(outsider.cookie, routeA.runId);

  const initialHash = presentationHash(routeA.result.presentation);
  await restartRuntime();
  const afterRuntimeRestart = await jsonRequest(`/v4/rooms/${routeA.runId}/result`, { cookie: owner.cookie });
  assert.equal(presentationHash(afterRuntimeRestart.presentation), initialHash, "runtime restart changed the result projection");

  await restartApi();
  const afterApiRestart = await jsonRequest(`/v4/rooms/${routeA.runId}/result`, { cookie: owner.cookie });
  assert.equal(presentationHash(afterApiRestart.presentation), initialHash, "API restart changed the result projection");

  const browser = await verifySoloEndgameInBrowser({
    webBase,
    runId: routeA.runId,
    sessionCookie: owner.cookie,
    expected: { title: routeA.result.presentation.title },
    outputDir,
  });
  const oldAfterRestart = await jsonRequest(`/v4/rooms/${routeA.runId}/result`, { cookie: owner.cookie });
  assert.equal(presentationHash(oldAfterRestart.presentation), initialHash, "creating a fresh Run changed the old Run result");
  const freshRun = await prisma.storyRun.findUnique({ where: { id: browser.newRunId } });
  assert.ok(freshRun, "restart action did not create a new StoryRun");
  assert.notEqual(browser.newRunId, routeA.runId);

  endingPath = path.join(workspaceRoot, routeB.runId, "story", "frontend", "ending.json");
  endingBackup = await readFile(endingPath);
  await rm(endingPath);
  const historical = await jsonRequest(`/v4/rooms/${routeB.runId}/result`, { cookie: owner.cookie });
  assert.equal(historical.presentation.resultType, "LEGACY_ENDING");
  assert.equal(historical.presentation.verdict, "UNAVAILABLE");
  assert.deepEqual(historical.presentation.causes, []);
  await writeFile(endingPath, endingBackup);
  endingBackup = null;

  report = {
    schemaVersion: "solo_endgame_mvp_evidence_v1",
    testOnly: true,
    database: {
      host: dbUrl.hostname,
      identity: databaseIdentity,
      migrationExecuted: false,
    },
    services: {
      runtimeBase,
      apiBase,
      webBase,
      restartedRuntime: true,
      restartedApi: true,
    },
    routes: [routeEvidence(routeA), routeEvidence(routeB)],
    deterministic: {
      initialPresentationHash: initialHash,
      afterRuntimeRestartHash: presentationHash(afterRuntimeRestart.presentation),
      afterApiRestartHash: presentationHash(afterApiRestart.presentation),
    },
    permissions: { outsiderResultRejected: true },
    historical: {
      resultType: historical.presentation.resultType,
      verdict: historical.presentation.verdict,
      proseGuessed: false,
    },
    replay: {
      oldRunId: routeA.runId,
      newRunId: browser.newRunId,
      oldRunPreserved: true,
      changeRoleEnabled: routeA.result.presentation.replayActions.find((item) => item.type === "CHANGE_ROLE")?.enabled,
      nextPartEnabled: routeA.result.presentation.replayActions.find((item) => item.type === "CONTINUE_NEXT_PART")?.enabled,
    },
    browser,
    completedAt: new Date().toISOString(),
  };
  await writeFile(path.join(outputDir, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    outputDir: path.relative(root, outputDir),
    routes: report.routes.map((route) => ({ profile: route.profile, endingKey: route.endingKey })),
    presentationHash: initialHash,
  })}\n`);
} finally {
  if (endingBackup && endingPath) await writeFile(endingPath, endingBackup).catch(() => undefined);
  await stopAll();
  if (testEmails.length) {
    await prisma.user.deleteMany({ where: { email: { in: testEmails } } }).catch(async (error) => {
      await writeFile(path.join(outputDir, "cleanup-error.log"), String(error?.stack || error), "utf8").catch(() => undefined);
    });
  }
  await prisma.$disconnect().catch(() => undefined);
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
}

async function startRuntime() {
  const child = spawnLogged("runtime", pnpm, ["--filter", "@apps/openovel-runtime", "dev"], {
    ...baseEnv,
    PORT: String(runtimePort),
    OPENOVEL_RUNTIME_PORT: String(runtimePort),
    OPENOVEL_RUNTIME_HOST: "127.0.0.1",
    OPENOVEL_WORKSPACE_ROOT: workspaceRoot,
    OPENOVEL_PROJECT_ROOT: root,
    OPENOVEL_MIRROR_URL: "",
    OPENOVEL_MIRROR_TOKEN: "",
    OPENOVEL_PLAYTEST_ENABLED: "0",
  });
  children.set("runtime", child);
  await waitHttp(`${runtimeBase}/health`, "runtime");
}

async function startApi() {
  const child = spawnLogged("api", pnpm, ["--filter", "@apps/api", "dev"], {
    ...baseEnv,
    PORT: String(apiPort),
    API_PORT: String(apiPort),
  });
  children.set("api", child);
  await waitHttp(`${apiBase}/health`, "API");
}

async function startWeb() {
  const child = spawnLogged("web", process.execPath, ["apps/web/src/server.mjs"], {
    ...baseEnv,
    PORT: String(webPort),
    API_PORT: String(apiPort),
  });
  children.set("web", child);
  await waitHttp(`${webBase}/game`, "web");
}

async function restartRuntime() {
  await stopNamed("runtime");
  await startRuntime();
}

async function restartApi() {
  await stopNamed("api");
  await startApi();
}

async function createVerifiedAccount(label) {
  const email = `solo-endgame-${label}-${stamp}@example.test`;
  const password = `Solo-${randomUUID()}!9`;
  testEmails.push(email);
  await jsonRequest("/v4/auth/register", {
    method: "POST",
    body: { email, password, nickname: `Solo Endgame ${label}` },
  });
  const token = await verificationToken(email);
  await jsonRequest("/v4/auth/verify", { method: "POST", body: { token } });
  const login = await rawRequest("/v4/auth/login", { method: "POST", body: { email, password } });
  assert.equal(login.response.status, 201);
  const cookie = sessionCookie(login.response);
  assert.match(cookie, /many_worlds_session=/);
  await jsonRequest("/v4/onboarding/complete", {
    method: "POST",
    cookie,
    body: { intendedMode: "solo", discoverySource: "solo-endgame-mvp-e2e" },
  });
  const me = await jsonRequest("/v4/auth/me", { cookie });
  return { email, cookie, userId: me.id };
}

async function completeRoute(account, profile) {
  const created = await jsonRequest("/v4/rooms/solo", {
    method: "POST",
    cookie: account.cookie,
    body: {
      worldId: "sangtian",
      roleKey: "zhejiang_governor",
      idempotencyKey: `solo-endgame-${profile}-${stamp}`,
      resumeExisting: false,
    },
  });
  const runId = String(created.runId || created.roomId || created.id || "");
  assert.match(runId, /^solo_ovl_[a-f0-9]{32}$/);
  let projection = created.gameProjection;
  const route = [];
  let replayEvidence = null;
  for (let turnNumber = 1; turnNumber <= 20; turnNumber += 1) {
    const turn = projection?.currentTurn;
    assert.ok(turn, `${profile} missing turn ${turnNumber}`);
    const selected = chooseOption(turn.decisions, profile, turnNumber);
    const body = {
      idempotencyKey: `${profile}-${stamp}-turn-${String(turnNumber).padStart(2, "0")}`,
      turnRevision: turn.revision,
      controlEpoch: projection.control.epoch,
      candidateId: selected.id,
      decisionForm: "STORY_CHOICE",
      intent: selected.intentDraft,
    };
    const pathName = `/v4/rooms/${runId}/game/turns/${turn.id}/decision`;
    const resolved = await jsonRequest(pathName, { method: "POST", cookie: account.cookie, body });
    route.push({ turnNumber, turnId: turn.id, optionId: selected.id, label: selected.label });
    if (turnNumber === 1 || turnNumber === 20) {
      const replayed = await jsonRequest(pathName, { method: "POST", cookie: account.cookie, body });
      assert.deepEqual(replayed.resolution, resolved.resolution, `${profile} replay changed turn ${turnNumber}`);
      replayEvidence = { turnNumber, resolutionId: resolved.resolution.id };
    }
    projection = resolved.gameProjection;
  }
  assert.equal(projection.completed, true);
  assert.equal(projection.currentTurn, null);
  const result = await jsonRequest(`/v4/rooms/${runId}/result`, { cookie: account.cookie });
  assert.equal(result.presentation.schemaVersion, "endgame_presentation_v1");
  assert.equal(result.presentation.resultType, "SOLO_PART_END");
  assert.ok(result.presentation.causes.length >= 1 && result.presentation.causes.length <= 3);
  assert.equal(result.presentation.replayActions.find((item) => item.type === "CHANGE_ROLE")?.enabled, false);
  assert.equal(result.presentation.replayActions.find((item) => item.type === "CONTINUE_NEXT_PART")?.enabled, false);
  const runtimeRun = await absoluteJson(`${runtimeBase}/internal/openovel/runs/${runId}`, {
    headers: { authorization: `Bearer ${runtimeToken}` },
  });
  assert.equal(runtimeRun.status, "COMPLETED");
  assert.equal(runtimeRun.turnNumber, 20);
  assert.equal(runtimeRun.ending?.scope, "PART");
  assert.equal(runtimeRun.ending?.sourceTurnId, "T20");
  assert.equal(runtimeRun.ending?.sourceRevision, 20);
  assert.deepEqual(runtimeRun.options, []);

  const [actionCount, sceneCount, runRow] = await Promise.all([
    prisma.playerAction.count({ where: { runId } }),
    prisma.sceneNode.count({ where: { runId, status: "resolved" } }),
    prisma.storyRun.findUnique({ where: { id: runId } }),
  ]);
  assert.equal(actionCount, 20, `${profile} idempotent replays created extra PlayerActions`);
  assert.equal(sceneCount, 20, `${profile} expected twenty committed scene nodes`);
  assert.equal(runRow?.status, "chapter_generated");
  return {
    profile,
    runId,
    route,
    ending: runtimeRun.ending,
    result,
    actionCount,
    sceneCount,
    replayEvidence,
  };
}

function chooseOption(decisions, profile, turnNumber) {
  assert.ok(Array.isArray(decisions) && decisions.length > 0, `no decisions at turn ${turnNumber}`);
  const preferred = profile === "protective"
    ? [
      "opening_d2", "DK01_A", "DK02_A", "DK03_A", "DK04_A", "DK05_A", "DK06_A", "DK07_A", "DK08_A", "DK09_A",
      "DK10_A", "DK11_A", "DK12_A", "DK13_A", "DK14_A", "DK15_A", "DK16_A", "DK17_A", "DK18_A", "DK19_A",
    ]
    : [
      "opening_d1", "DK01_B", "DK02_A", "DK03_A", "DK04_A", "DK05_A", "DK06_A", "DK07_B", "DK08_A", "DK09_A",
      "DK10_A", "DK11_A", "DK12_A", "DK13_A", "DK14_A", "DK15_A", "DK16_A", "DK17_A", "DK18_A", "DK19_A",
    ];
  const selected = decisions.find((item) => preferred.includes(item.id) || preferred.includes(item.actionKey));
  return selected || decisions[(turnNumber - 1) % decisions.length];
}

async function assertForbiddenResult(cookie, runId) {
  const response = await rawRequest(`/v4/rooms/${runId}/result`, { cookie });
  assert.ok([403, 404].includes(response.response.status), `outsider result returned ${response.response.status}`);
}

async function verificationToken(email) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const text = await readFile(mailSink, "utf8").catch(() => "");
    for (const line of text.split(/\r?\n/).filter(Boolean).reverse()) {
      const row = JSON.parse(line);
      if (String(row.to || "").toLowerCase() !== email.toLowerCase()) continue;
      const match = `${row.text || ""}\n${row.html || ""}`.match(/[?&]token=([^&\s"'<>]+)/);
      if (match) return decodeURIComponent(match[1].replace(/&amp;$/i, ""));
    }
    await sleep(100);
  }
  throw new Error(`verification token not found for ${email}`);
}

async function jsonRequest(pathName, options = {}) {
  const { response, payload } = await rawRequest(pathName, options);
  if (!response.ok) throw Object.assign(new Error(payload?.message || payload?.code || `HTTP ${response.status}`), {
    status: response.status,
    payload,
  });
  return payload;
}

async function rawRequest(pathName, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${apiBase}${pathName}`, {
    method,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function absoluteJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${url}: ${JSON.stringify(payload)}`);
  return payload;
}

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";")[0]).join("; ");
}

function spawnLogged(name, command, args, env) {
  const logPath = path.join(outputDir, `${name}.log`);
  const stream = createWriteStream(logPath, { flags: "a" });
  const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  child.once("exit", (code, signal) => stream.write(`\n[exit] code=${code} signal=${signal}\n`));
  child.logPath = logPath;
  return child;
}

async function waitHttp(url, label, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = new Error(`${response.status} ${url}`);
    } catch (error) { last = error; }
    await sleep(250);
  }
  const details = [];
  for (const child of children.values()) {
    if (child.logPath && existsSync(child.logPath)) details.push(await tail(child.logPath));
  }
  throw new Error(`${label} did not become ready: ${last}; logs=${details.join("\n---\n")}`);
}

async function stopNamed(name) {
  const child = children.get(name);
  children.delete(name);
  await stopProcess(child);
}

async function stopAll() {
  await Promise.all([...children.keys()].map(stopNamed));
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }).once("exit", resolve));
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function freePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function presentationHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function routeEvidence(route) {
  return {
    profile: route.profile,
    runId: route.runId,
    endingKey: route.ending.endingKey,
    endingTitle: route.ending.title,
    scope: route.ending.scope,
    sourceTurnId: route.ending.sourceTurnId,
    sourceRevision: route.ending.sourceRevision,
    verdict: route.result.presentation.verdict,
    causeCount: route.result.presentation.causes.length,
    actionCount: route.actionCount,
    sceneCount: route.sceneCount,
    replayEvidence: route.replayEvidence,
    route: route.route,
  };
}

async function tail(file) {
  const text = await readFile(file, "utf8").catch(() => "");
  return text.slice(-8_000);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
