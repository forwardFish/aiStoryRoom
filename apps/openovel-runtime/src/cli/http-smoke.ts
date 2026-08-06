import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const serverEntry = path.join(projectRoot, "apps", "openovel-runtime", "dist", "server.js");
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "omw-openovel-http-smoke-"));
const provider = scriptedProvider();
const providerPort = await listen(provider.server);
const runtimePort = await reservePort();
const token = "local-http-smoke-token";
const runId = `http_smoke_${Date.now()}`;
let runtime: ChildProcess | null = null;

try {
  runtime = startRuntime(runtimePort, providerPort);
  await waitForHealth(runtimePort);
  const created = await runtimeJson(runtimePort, "/internal/openovel/runs", {
    method: "POST",
    body: JSON.stringify({
      runId,
      worldId: "sangtian",
      roleId: "zhejiang_governor",
      storyPackageVersion: "http-smoke",
      openingVersion: "http-smoke",
    }),
  });
  assert.equal(created.turnNumber, 0);

  const actions = [
    "暂不签发，先让两边把各自知道的事说清。",
    "让巡抚书吏说明中丞究竟催的是落印，还是一份可带回去的答复。",
  ];
  const turnEvidence = [];
  for (let index = 0; index < 3; index += 1) {
    const action = index < actions.length
      ? actions[index]!
      : await currentPublishedAction(runtimePort, runId);
    const events = await runtimeSse(runtimePort, runId, action);
    const committed = events.find((event) => event.type === "turn.committed");
    assert.ok(committed, `missing turn.committed for ${action}`);
    assert.equal("causalDelta" in committed.data, false);
    assert.equal("narrator" in committed.data, false);
    assert.equal("optionsProvider" in committed.data, false);
    assert.equal("warnings" in committed.data, false);
    turnEvidence.push({
      turnId: committed.data.turnId,
      eventTypes: events.map((event) => event.type),
      options: committed.data.options.length,
      warningCodes: events
        .filter((event) => event.type === "runtime.warning")
        .map((event) => event.data?.code)
        .filter(Boolean),
    });
  }

  assert.equal(turnEvidence[0].turnId, "T01");
  assert.equal(turnEvidence[1].turnId, "T02");
  assert.equal(turnEvidence[2].turnId, "T03");
  assert.ok(turnEvidence[1].options >= 2);
  assert.equal(turnEvidence[1].warningCodes.includes("OPTIONS_UNAVAILABLE"), false);

  await waitForStorykeeper(runtimePort, runId, 3);
  const beforeRestart = await runtimeJson(
    runtimePort,
    `/internal/openovel/runs/${encodeURIComponent(runId)}`,
  );
  assert.equal(beforeRestart.turnNumber, 3);
  assert.equal(beforeRestart.status, "READY");
  assert.equal((beforeRestart.canon.match(/^\*\*读者选择\*\*：/gm) || []).length, 3);

  await stopRuntime(runtime);
  runtime = startRuntime(runtimePort, providerPort);
  await waitForHealth(runtimePort);
  const afterRestart = await runtimeJson(
    runtimePort,
    `/internal/openovel/runs/${encodeURIComponent(runId)}`,
  );
  assert.equal(afterRestart.turnNumber, 3);
  assert.equal(afterRestart.canon, beforeRestart.canon);
  assert.equal(afterRestart.recentCanon, beforeRestart.recentCanon);

  const report = {
    schemaVersion: "openovel_http_g00_t03_smoke_v1",
    verdict: "PASS",
    runId,
    runtimeMode: afterRestart.runtimeMode,
    currentTurn: afterRestart.turnNumber,
    canonTurns: (afterRestart.canon.match(/^\*\*读者选择\*\*：/gm) || []).length,
    committedOptionsAvailableAfterCanon: turnEvidence[1].options >= 2
      && !turnEvidence[1].warningCodes.includes("OPTIONS_UNAVAILABLE"),
    freeTextTurns: turnEvidence.length,
    storykeeperApplied: 3,
    restartRecoveredCanon: afterRestart.canon === beforeRestart.canon,
    providerCalls: provider.calls,
    turns: turnEvidence,
    workspaceRoot,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(path.join(workspaceRoot, "http-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (runtime) await stopRuntime(runtime);
  await closeServer(provider.server);
}

function startRuntime(port: number, providerPortValue: number) {
  return spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      OPENOVEL_RUNTIME_HOST: "127.0.0.1",
      OPENOVEL_WORKSPACE_ROOT: workspaceRoot,
      OPENOVEL_INTERNAL_TOKEN: token,
      OPENOVEL_PROVIDER_BASE_URL: `http://127.0.0.1:${providerPortValue}/v1`,
      OPENOVEL_API_KEY: "local-http-smoke-key",
      OPENOVEL_MODEL: "mock-narrator",
      OPENOVEL_NARRATOR_MODEL: "mock-narrator",
      OPENOVEL_OPTIONS_MODEL: "mock-options",
      OPENOVEL_STORYKEEPER_MODEL: "mock-storykeeper",
      OPENOVEL_PROVIDER_TIMEOUT_MS: "10000",
      OPENOVEL_MIRROR_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function waitForHealth(port: number) {
  let lastError = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok && (await response.json() as any).ok) return;
    } catch (error) {
      lastError = String((error as Error).message || error);
    }
    await delay(50);
  }
  throw new Error(`runtime health did not become ready: ${lastError}`);
}

async function waitForStorykeeper(port: number, targetRunId: string, target: number) {
  const sceneLog = path.join(
    workspaceRoot,
    targetRunId,
    "story",
    "canon",
    "scene_log.jsonl",
  );
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const text = await readFile(sceneLog, "utf8").catch(() => "");
    const applied = (text.match(/"type":"storykeeper_applied"/g) || []).length;
    if (applied >= target) return;
    await runtimeJson(
      port,
      `/internal/openovel/runs/${encodeURIComponent(targetRunId)}/jobs`,
    ).catch(() => null);
    await delay(50);
  }
  throw new Error("Storykeeper did not apply all three committed turns");
}

async function runtimeJson(port: number, route: string, init: RequestInit = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`runtime HTTP ${response.status}: ${JSON.stringify(payload)}`);
  return payload as any;
}

async function runtimeSse(port: number, targetRunId: string, action: string) {
  const response = await fetch(
    `http://127.0.0.1:${port}/internal/openovel/runs/${encodeURIComponent(targetRunId)}/actions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action, boundOption: null }),
    },
  );
  assert.equal(response.status, 200);
  const text = await response.text();
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/);
    const type = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    return type && data ? [{ type, data: JSON.parse(data) }] : [];
  });
}

async function currentPublishedAction(port: number, targetRunId: string) {
  const run = await runtimeJson(
    port,
    `/internal/openovel/runs/${encodeURIComponent(targetRunId)}`,
  );
  const action = String(run.options?.[0]?.label || "").trim();
  assert.ok(action, "current published option required for the next free-text smoke turn");
  return action;
}

function scriptedProvider() {
  let narratorIndex = 0;
  let optionsIndex = 0;
  const calls = { narrator: 0, options: 0, storykeeper: 0 };
  const narrations = [
    "巡抚书吏听见“暂不签发”四字，捧匣的手略沉了一沉，却没有立刻争辩。他只说中丞等的是一句明白话，今日若仍无回文，催办的责任便只能照原样记下。县令亲随趁这空当说明，密信确是县令亲笔，原册仍在清流，并未随人带来。两边各自说清了一层，案上的公文却仍没有落印。",
    "书吏把目光收回公文末页，答得比先前慢：“中丞催的是浙江不能没有章程。大人若不肯落印，也该给一句何时、由谁查清的准话。”他说完便住口，没有替巡抚多加条件。县令亲随在旁听着，低声提醒清流路远，今日若发命，明早还能赶在开衙前到县。时辰正把一桩口头争执逼成必须选择的路径。",
    "县令亲随说，档房钥匙平日由典史收着，原册是否仍在原处，他不敢隔着百里担保；但只要总督府的命令在明早开衙前赶到，县令至少能够先叫经手人留衙，等上差到场再一同启看。巡抚书吏随即提醒，若总督府越过巡抚直接发令，巡抚衙门必会追问缘由。清流的门尚未打开，两条彼此牵制的路却已经摆到案前。",
  ];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw || "{}") as { model?: string; stream?: boolean };
    if (body.model === "mock-narrator") {
      calls.narrator += 1;
      const text = narrations[narratorIndex++] || narrations[narrations.length - 1];
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      for (const piece of splitText(text, 32)) {
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      response.write(`data: ${JSON.stringify({
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 100, completion_tokens: 80 },
      })}\n\n`);
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }
    if (body.model === "mock-options") {
      optionsIndex += 1;
      calls.options += 1;
      if (optionsIndex === 2) {
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "scripted options outage" } }));
        return;
      }
      return completion(response, JSON.stringify({
        framing: "",
        options: [
          { label: "让两边各自写下一句可核对的话。" },
          { label: "先定下明早去清流的查验人选。" },
        ],
        tension: "期限正在收紧",
        storyComplete: false,
      }));
    }
    if (body.model === "mock-storykeeper") {
      calls.storykeeper += 1;
      return completion(response, JSON.stringify({
        summary: "已将本轮变化写入下一轮工作集。",
        sections: {
          "scene.md": "## Scene\n\n- 总督府内厅，双方仍在案前。",
          "open-threads.md": "## Open Threads\n\n- 巡抚需要答复；清流原册仍待到场查验。",
        },
        contextCards: [],
        qualityNotes: "",
      }));
    }
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `unknown mock model ${body.model}` } }));
  });
  return { server, calls };
}

function completion(response: any, content: string) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({
    model: "local-smoke",
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 80 },
  }));
}

function splitText(value: string, size: number) {
  const pieces = [];
  for (let index = 0; index < value.length; index += size) pieces.push(value.slice(index, index + size));
  return pieces;
}

async function reservePort() {
  const server = createServer();
  const port = await listen(server);
  await closeServer(server);
  return port;
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not expose a TCP port");
  return address.port;
}

async function closeServer(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function stopRuntime(child: ChildProcess) {
  if (child.exitCode !== null || child.killed) return;
  child.kill();
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(2_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
