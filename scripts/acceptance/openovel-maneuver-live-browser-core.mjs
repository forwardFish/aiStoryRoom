import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EVIDENCE_ROOT = path.resolve(
  process.env.OPENOVEL_MANEUVER_EVIDENCE_ROOT
  || path.join(ROOT, "artifacts", "openovel-maneuver-live"),
);
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const STAMP = Date.now();
const EMAIL = `openovel-maneuver-${STAMP}@example.test`;
const PASSWORD = "OpenNovelManeuverLive2026!";
const AUTH_SECRET = "openovel-maneuver-live-session-secret";
const INTERNAL_TOKEN = "openovel-maneuver-live-runtime-token";

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});

async function main() {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required for live browser acceptance");

  const dirs = {
    logs: path.join(EVIDENCE_ROOT, "process-logs"),
    workspaces: path.join(EVIDENCE_ROOT, "openovel-workspaces"),
  };
  for (const dir of [EVIDENCE_ROOT, ...Object.values(dirs)]) await mkdir(dir, { recursive: true });
  const mailSink = path.join(EVIDENCE_ROOT, "auth-mail.ndjson");
  await writeFile(mailSink, "", "utf8");

  const provider = scriptedProvider();
  const providerPort = await listen(provider.server);
  const runtimePort = await reservePort();
  const apiPort = await reservePort();
  const webPort = await reservePort();
  const runtimeBase = `http://127.0.0.1:${runtimePort}`;
  const apiBase = `http://127.0.0.1:${apiPort}/api`;
  const webBase = `http://127.0.0.1:${webPort}`;
  const processes = [];
  const previousEnv = captureEnv([
    "OPENOVEL_R2_4_WEB_BASE",
    "OPENOVEL_R2_4_API_BASE",
    "OPENOVEL_R2_4_SESSION_COOKIE",
    "OPENOVEL_R2_4_EVIDENCE_ROOT",
    "OPENOVEL_R2_4_COMMIT_SHA",
  ]);

  try {
    processes.push(startProcess(
      "openovel-runtime",
      process.execPath,
      [path.join(ROOT, "apps/openovel-runtime/dist/server.js")],
      dirs.logs,
      {
        NODE_ENV: "test",
        PORT: String(runtimePort),
        OPENOVEL_RUNTIME_HOST: "127.0.0.1",
        OPENOVEL_WORKSPACE_ROOT: dirs.workspaces,
        OPENOVEL_INTERNAL_TOKEN: INTERNAL_TOKEN,
        OPENOVEL_PROVIDER_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
        OPENOVEL_API_KEY: "openovel-live-browser-fixture-key",
        OPENOVEL_MODEL: "mock-narrator",
        OPENOVEL_NARRATOR_MODEL: "mock-narrator",
        OPENOVEL_OPTIONS_MODEL: "mock-options",
        OPENOVEL_STORYKEEPER_MODEL: "mock-storykeeper",
        OPENOVEL_PROVIDER_TIMEOUT_MS: "10000",
        OPENOVEL_MIRROR_URL: "",
      },
    ));
    await waitJson(`${runtimeBase}/health`, (value) => value?.ok === true, 60_000);

    processes.push(startProcess(
      "api",
      process.execPath,
      [path.join(ROOT, "apps/api/dist/main.js")],
      dirs.logs,
      {
        NODE_ENV: "test",
        PORT: String(apiPort),
        API_PORT: String(apiPort),
        DATABASE_URL,
        SUPABASE_DATABASE_URL: "",
        MVP_STORY_STORAGE: "prisma",
        AUTH_TOKEN_SECRET: AUTH_SECRET,
        AUTH_COOKIE_SECURE: "false",
        STORY_WORKER_ENABLED: "false",
        AI_CAUSAL_PROVIDER: "rules",
        EMAIL_PROVIDER: "file",
        AUTH_MAIL_SINK_FILE: mailSink,
        PUBLIC_WEB_ORIGIN: webBase,
        PAYMENT_RETURN_ORIGIN: webBase,
        OPENOVEL_RUNTIME_URL: runtimeBase,
        OPENOVEL_INTERNAL_TOKEN: INTERNAL_TOKEN,
        CREDIT_ACTION_METERING_MODE: "OFF",
        CREEM_ENV: "test",
        CREEM_API_KEY: "creem_test_placeholder",
        CREEM_WEBHOOK_SECRET: "creem_webhook_placeholder",
      },
    ));
    await waitJson(`${apiBase}/health`, (value) => value?.ok === true, 60_000);

    processes.push(startProcess(
      "web",
      process.execPath,
      [path.join(ROOT, "apps/web/src/server.mjs")],
      dirs.logs,
      {
        NODE_ENV: "test",
        PORT: String(webPort),
        API_PORT: String(apiPort),
      },
    ));
    await waitHttp(`${webBase}/role-select?story=sangtian&start=new`, 60_000);

    const sessionToken = await createAccount(apiBase, mailSink);
    Object.assign(process.env, {
      OPENOVEL_R2_4_WEB_BASE: webBase,
      OPENOVEL_R2_4_API_BASE: apiBase,
      OPENOVEL_R2_4_SESSION_COOKIE: `many_worlds_session=${sessionToken}`,
      OPENOVEL_R2_4_EVIDENCE_ROOT: EVIDENCE_ROOT,
      OPENOVEL_R2_4_COMMIT_SHA: process.env.GITHUB_SHA
        || process.env.OPENOVEL_MANEUVER_COMMIT_SHA
        || "",
    });
    globalThis.__OPENOVEL_MANEUVER_PROVIDER_CALLS__ = provider.calls;

    const browserJourney = new URL("./openovel-maneuver-r2-4-browser.mjs", import.meta.url);
    browserJourney.searchParams.set("live", String(STAMP));
    await import(browserJourney.href);
  } catch (error) {
    await writeFile(path.join(EVIDENCE_ROOT, "orchestrator-failure.json"), `${JSON.stringify({
      verdict: "FAIL",
      error: serializeError(error),
      providerCalls: provider.calls,
      completedAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8").catch(() => undefined);
    throw error;
  } finally {
    delete globalThis.__OPENOVEL_MANEUVER_PROVIDER_CALLS__;
    restoreEnv(previousEnv);
    for (const processInfo of [...processes].reverse()) {
      await stopProcess(processInfo).catch(() => undefined);
    }
    await closeServer(provider.server).catch(() => undefined);
  }
}

async function createAccount(apiBase, mailSink) {
  const registration = await jsonRequest(apiBase, "/v4/auth/register", {
    method: "POST",
    body: {
      email: EMAIL,
      password: PASSWORD,
      nickname: "OpenNovel Maneuver Live Browser",
    },
  });
  assert.equal(registration.payload.accepted, true);

  const verification = await verificationToken(mailSink, EMAIL);
  const verified = await jsonRequest(apiBase, "/v4/auth/verify", {
    method: "POST",
    body: { token: verification },
  });
  assert.equal(verified.payload.verified, true);

  const login = await jsonRequest(apiBase, "/v4/auth/login", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  const sessionToken = cookieValue(login.response);
  const cookie = `many_worlds_session=${sessionToken}`;
  const me = await jsonRequest(apiBase, "/v4/auth/me", { credential: cookie });
  assert.equal(me.payload.email, EMAIL);
  await jsonRequest(apiBase, "/v4/credits/onboarding", {
    method: "POST",
    credential: cookie,
    body: {},
  });
  return sessionToken;
}

async function verificationToken(mailSink, email) {
  return waitUntil(async () => {
    const content = await readFile(mailSink, "utf8").catch(() => "");
    for (const line of content.trim().split(/\r?\n/).filter(Boolean).reverse()) {
      const message = JSON.parse(line);
      if (String(message.to || "").toLowerCase() !== email.toLowerCase()) continue;
      const link = String(message.text || message.html || "").match(/https?:\/\/[^\s<]+/)?.[0];
      if (!link) continue;
      const token = new URL(link.replace(/&amp;/g, "&")).searchParams.get("token");
      if (token) return token;
    }
    return false;
  }, 15_000, "verification mail was not written");
}

function startProcess(name, command, args, logRoot, extraEnv) {
  const log = createWriteStream(path.join(logRoot, `${name}.log`), { flags: "w" });
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code, signal) => {
    log.write(`\n[process-exit] code=${code} signal=${signal}\n`);
  });
  return { child, log };
}

async function stopProcess(value) {
  await stopChild(value.child);
  await endStream(value.log);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(2_000),
    ]);
  }
}

async function endStream(stream) {
  if (!stream || stream.closed) return;
  await new Promise((resolve) => stream.end(resolve));
}

async function jsonRequest(base, route, options = {}) {
  const headers = new Headers({ accept: "application/json", ...(options.headers || {}) });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.credential) headers.set("cookie", options.credential);
  const response = await fetch(`${base}${route}`, {
    method: options.method || "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${route} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return { response, payload };
}

function cookieValue(response) {
  for (const value of response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""]) {
    const match = String(value).match(/(?:^|,\s*)many_worlds_session=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  throw new Error("login did not issue a session cookie");
}

async function waitJson(url, predicate, timeout) {
  return waitUntil(async () => {
    const response = await fetch(url).catch(() => null);
    if (!response?.ok) return false;
    const value = await response.json().catch(() => null);
    return predicate(value) ? value : false;
  }, timeout, `JSON endpoint unavailable: ${url}`);
}

async function waitHttp(url, timeout) {
  return waitUntil(
    async () => (await fetch(url).catch(() => null))?.ok || false,
    timeout,
    `HTTP endpoint unavailable: ${url}`,
  );
}

async function waitUntil(action, timeout = 30_000, message = "condition not met") {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message || lastError}` : ""}`);
}

function scriptedProvider() {
  let narratorIndex = 0;
  const calls = { narrator: 0, options: 0, storykeeper: 0 };
  const narrations = [
    "巡抚书吏听见总督的选择，捧匣的手略沉了一沉。他没有替中丞多说，只把催办时限与当前卷册一并陈明。县令亲随则守在案侧，提醒清流原册仍待正式命令。",
    "书吏把目光收回公文末页，答得比先前更慢：浙江不能没有章程，总督若暂缓，也必须给出何时、由谁查清的准话。",
    "总督府的命令一经落笔，内厅里的争执便从口头变成了可追查的路径。双方都没有替对方承担尚未承认的责任。",
    "次日的消息陆续回到总督府。原册、催办文书与商会说辞并未自然吻合，反而留下了几处需要继续核对的空隙。",
    "新的回报没有替总督作出结论，只把人物立场和可核验事实进一步分开。主线选择仍然掌握在总督手中。",
    "局势继续向前推进。此前的人物回应、调查记录与已消耗筹码都被保留在同一故事线上。",
  ];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw || "{}");

    if (body.model === "mock-narrator") {
      calls.narrator += 1;
      const text = narrations[narratorIndex++] || narrations.at(-1);
      if (body.stream === false) return completion(response, text, "mock-narrator");
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "x-request-id": `fixture-narrator-${calls.narrator}`,
      });
      for (const part of chunks(text, 32)) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
      }
      response.write(`data: ${JSON.stringify({
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 120, completion_tokens: 90 },
      })}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }

    if (body.model === "mock-options") {
      calls.options += 1;
      return completion(response, JSON.stringify({
        framing: "",
        options: [
          { label: "让两边各自写下一句可核对的话。" },
          { label: "先定下明早查验原册的人选。" },
          { label: "暂缓落印，要求补齐经手记录。" },
        ],
        tension: "期限正在收紧",
        storyComplete: false,
      }), "mock-options");
    }

    if (body.model === "mock-storykeeper") {
      calls.storykeeper += 1;
      return completion(response, JSON.stringify({
        summary: "已将本轮变化写入下一轮工作集。",
        sections: {
          "scene.md": "## Scene\n\n- 总督府内厅，人物立场与卷册事实继续分开核验。",
          "open-threads.md": "## Open Threads\n\n- 巡抚需要答复；清流原册与商会说辞仍待核验。",
        },
        contextCards: [],
        qualityNotes: "",
      }), "mock-storykeeper");
    }

    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `unknown mock model ${body.model}` } }));
  });
  return { server, calls };
}

function completion(response, content, model) {
  response.writeHead(200, {
    "content-type": "application/json",
    "x-request-id": `fixture-${model}-${Date.now()}`,
  });
  response.end(JSON.stringify({
    model,
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 120, completion_tokens: 90 },
  }));
}

function chunks(value, size) {
  const output = [];
  for (let index = 0; index < value.length; index += size) {
    output.push(value.slice(index, index + size));
  }
  return output;
}

async function reservePort() {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not expose a port");
  return address.port;
}

async function closeServer(server) {
  if (server.listening) await new Promise((resolve) => server.close(resolve));
}

function captureEnv(keys) {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(values) {
  for (const [key, value] of values) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function serializeError(error) {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { value: String(error) };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
