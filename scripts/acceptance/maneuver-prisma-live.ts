import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { PrismaClient } from "@prisma/client";
import { issueAccessToken } from "../../apps/api/src/auth/auth.service";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EVIDENCE_DIR = resolve(process.env.MANEUVER_ACCEPTANCE_DIR || join(ROOT, "artifacts/maneuver-r1"));
const API_PORT = Number(process.env.API_PORT || process.env.PORT || 3102);
const API_BASE = `http://127.0.0.1:${API_PORT}/api`;
const EXPECTED_PARENT = String(process.env.EXPECTED_R1_PARENT_SHA || "");
const AUTH_SECRET = String(process.env.AUTH_TOKEN_SECRET || "maneuver-r1-isolated-session-secret");
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

type Json = Record<string, any>;
type CaseResult = { name: string; status: "PASS" | "FAIL" | "SKIP"; durationMs: number; detail?: unknown };

const cases: CaseResult[] = [];
let apiGeneration = 0;

async function check(name: string, action: () => Promise<unknown> | unknown) {
  const startedAt = Date.now();
  try {
    const detail = await action();
    cases.push({ name, status: "PASS", durationMs: Date.now() - startedAt, ...(detail === undefined ? {} : { detail }) });
  } catch (error) {
    cases.push({ name, status: "FAIL", durationMs: Date.now() - startedAt, detail: serializeError(error) });
    throw error;
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { value: String(error) };
}

function apiLogPath(label: string) {
  apiGeneration += 1;
  return join(EVIDENCE_DIR, `api-${String(apiGeneration).padStart(2, "0")}-${label}.log`);
}

async function startApi(label: string) {
  const logPath = apiLogPath(label);
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(PNPM, ["--filter", "@apps/api", "dev"], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: String(process.env.DATABASE_URL || ""),
      MVP_STORY_STORAGE: "prisma",
      AI_CAUSAL_PROVIDER: "rules",
      AUTH_TOKEN_SECRET: AUTH_SECRET,
      PORT: String(API_PORT),
      API_PORT: String(API_PORT),
      NODE_ENV: "test",
      STORY_WORKER_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.once("exit", (code, signal) => log.write(`\n[api-exit] code=${code} signal=${signal}\n`));
  await waitForHealth(child, logPath);
  return { child, logPath, log };
}

async function waitForHealth(child: ChildProcess, logPath: string) {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited before health check; see ${logPath}`);
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`API health timeout: ${lastError}; see ${logPath}`);
}

async function stopApi(api: { child: ChildProcess; log: ReturnType<typeof createWriteStream> }) {
  const { child, log } = api;
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      sleep(5_000).then(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      })
    ]).catch(() => undefined);
  }
  await new Promise<void>((resolvePromise) => log.end(resolvePromise));
}

async function request(method: string, path: string, token: string, body?: Json) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({})) as Json;
  return { status: response.status, ok: response.ok, payload };
}

async function mustRequest(method: string, path: string, token: string, body?: Json) {
  const result = await request(method, path, token, body);
  if (!result.ok) throw new Error(`${method} ${path} -> ${result.status}: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function createRun(token: string, label: string) {
  const view = await mustRequest("POST", "/v4/story-runs", token, { storyId: "sangtian", acceptanceLabel: label });
  assert.match(String(view.run?.id || ""), /^mvp_/);
  return view;
}

async function submitDecision(token: string, view: Json, key: string) {
  return mustRequest(
    "POST",
    `/v4/story-runs/${encodeURIComponent(view.run.id)}/messages/${encodeURIComponent(view.activeDecision.messageId)}/decisions`,
    token,
    { version: view.run.version, optionKey: "A", idempotencyKey: key }
  );
}

function errorCode(result: { status: number; payload: Json }) {
  return String(result.payload?.code || result.payload?.message?.code || result.payload?.error?.code || "");
}

function winnerSummary(results: Array<{ status: number; ok: boolean; payload: Json }>) {
  const successes = results.filter((item) => item.ok);
  const failures = results.filter((item) => !item.ok);
  assert.equal(successes.length, 1, `expected one success, got ${JSON.stringify(results)}`);
  assert.equal(failures.length, 1, `expected one failure, got ${JSON.stringify(results)}`);
  assert.equal(failures[0].status, 409);
  assert.equal(errorCode(failures[0]), "VERSION_CONFLICT");
  return { successStatus: successes[0].status, failureStatus: failures[0].status, failureCode: errorCode(failures[0]) };
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const prisma = new PrismaClient();
  let api: Awaited<ReturnType<typeof startApi>> | null = null;
  const startedAt = new Date().toISOString();
  let databaseVersion = "";
  let primaryRunId = "";
  let finalPrimary: Json | null = null;
  try {
    await check("R1-01 exact parent, Prisma mode, and PostgreSQL engine", async () => {
      assert.equal(process.env.MVP_STORY_STORAGE, "prisma");
      assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
      const parent = execFileSync("git", ["rev-parse", "HEAD^"], { cwd: ROOT, encoding: "utf8" }).trim();
      assert.equal(parent, EXPECTED_PARENT);
      const rows = await prisma.$queryRawUnsafe<Array<{ version: string }>>("select version() as version");
      databaseVersion = String(rows[0]?.version || "");
      assert.match(databaseVersion, /PostgreSQL 16/i);
      return { parent, storage: "prisma", databaseVersion };
    });

    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        openid: `maneuver-r1-${stamp}`,
        email: `maneuver-r1-${stamp}@example.test`,
        emailVerifiedAt: new Date(),
        nickname: "Maneuver R1 Acceptance",
        policyAgreedAt: new Date()
      }
    });
    process.env.AUTH_TOKEN_SECRET = AUTH_SECRET;
    const token = issueAccessToken(user);

    api = await startApi("initial");
    let primary: Json = {};
    let leverageCommand: Json = {};
    let preReplayEventCount = 0;

    await check("R1-02 create a fresh run through the real API", async () => {
      primary = await createRun(token, "r1-primary");
      primaryRunId = primary.run.id;
      const stored = await prisma.storyRun.findUnique({ where: { id: primaryRunId } });
      assert.ok(stored);
      assert.equal(stored.version, primary.run.version);
      assert.equal(stored.templateKey, "sangtian");
      return { runId: primaryRunId, version: primary.run.version };
    });

    await check("R1-03 persist one contact maneuver", async () => {
      const before = primary.run.version;
      primary = await mustRequest("POST", `/v4/story-runs/${primaryRunId}/maneuvers`, token, {
        version: before,
        idempotencyKey: `r1-contact-${stamp}`,
        maneuverType: "contact",
        targetRoleKey: "county_magistrate",
        messageText: "原始名册为何早于诏令形成？"
      });
      assert.equal(primary.run.version, before + 1);
      assert.deepEqual(primary.maneuverState.usedTypesToday, ["contact"]);
      assert.equal(primary.maneuverState.maneuverOpportunitiesRemaining, 1);
      const eventTypes = (await prisma.storyEvent.findMany({ where: { runId: primaryRunId }, select: { type: true } })).map((item) => item.type);
      assert.ok(eventTypes.includes("contact_resolved"));
      return { beforeVersion: before, afterVersion: primary.run.version, remaining: primary.maneuverState.maneuverOpportunitiesRemaining };
    });

    primary = await submitDecision(token, primary, `r1-primary-decision-${stamp}`);
    assert.equal(primary.activeDecision?.decisionKey, "d1_2");

    await check("R1-04 consume and persist a one-use leverage card", async () => {
      const before = primary.run.version;
      leverageCommand = {
        version: before,
        idempotencyKey: `r1-leverage-${stamp}`,
        maneuverType: "leverage",
        leverageKey: "xunfu_merchant_old_pact_rumor",
        targetRoleKey: "merchant"
      };
      primary = await mustRequest("POST", `/v4/story-runs/${primaryRunId}/maneuvers`, token, leverageCommand);
      assert.equal(primary.run.version, before + 1);
      assert.equal(primary.maneuverState.maneuverOpportunitiesRemaining, 0);
      assert.deepEqual([...primary.maneuverState.usedTypesToday].sort(), ["contact", "leverage"]);
      assert.ok(primary.maneuverState.usedLeverageKeys.includes("xunfu_merchant_old_pact_rumor"));
      assert.equal(primary.leverageHand.items.some((item: Json) => item.leverageKey === "xunfu_merchant_old_pact_rumor"), false);
      preReplayEventCount = await prisma.storyEvent.count({ where: { runId: primaryRunId } });
      return { beforeVersion: before, afterVersion: primary.run.version, eventCount: preReplayEventCount };
    });

    await stopApi(api);
    api = null;
    api = await startApi("restart-readback");

    await check("R1-05 restart API and read back the same authoritative run", async () => {
      finalPrimary = await mustRequest("GET", `/v4/story-runs/${primaryRunId}`, token);
      assert.equal(finalPrimary.run.version, primary.run.version);
      assert.equal(finalPrimary.maneuverState.maneuverOpportunitiesRemaining, 0);
      assert.deepEqual([...finalPrimary.maneuverState.usedTypesToday].sort(), ["contact", "leverage"]);
      assert.ok(finalPrimary.maneuverState.usedLeverageKeys.includes("xunfu_merchant_old_pact_rumor"));
      const persisted = await prisma.storyRun.findUniqueOrThrow({ where: { id: primaryRunId } });
      const events = await prisma.storyEvent.findMany({ where: { runId: primaryRunId }, orderBy: { createdAt: "asc" } });
      assert.equal(persisted.version, finalPrimary.run.version);
      assert.equal(events.length, preReplayEventCount);
      assert.ok(events.some((event) => event.type === "maneuver_submitted"));
      assert.ok(events.some((event) => event.type === "leverage_used"));
      return { version: persisted.version, eventCount: events.length, usedTypesToday: finalPrimary.maneuverState.usedTypesToday };
    });

    await check("R1-06 idempotent replay remains stable after API restart", async () => {
      const replay = await mustRequest("POST", `/v4/story-runs/${primaryRunId}/maneuvers`, token, leverageCommand);
      assert.equal(replay.run.version, finalPrimary?.run.version);
      assert.equal(replay.maneuverState.maneuversUsedToday, 2);
      assert.equal(await prisma.storyEvent.count({ where: { runId: primaryRunId } }), preReplayEventCount);
      return { replayVersion: replay.run.version, eventCount: preReplayEventCount };
    });

    await check("R1-07 consumed leverage no longer projects after refresh", async () => {
      const refreshed = await mustRequest("GET", `/v4/story-runs/${primaryRunId}`, token);
      assert.equal(refreshed.leverageHand.items.some((item: Json) => item.leverageKey === "xunfu_merchant_old_pact_rumor"), false);
      assert.equal(refreshed.maneuverPanel.leverage.options.some((item: Json) => item.leverageKey === "xunfu_merchant_old_pact_rumor"), false);
      return { availableHand: refreshed.leverageHand.items.map((item: Json) => item.leverageKey) };
    });

    await check("R1-08 two requests racing for the final opportunity have one winner", async () => {
      let run = await createRun(token, "r1-last-opportunity-race");
      run = await mustRequest("POST", `/v4/story-runs/${run.run.id}/maneuvers`, token, {
        version: run.run.version,
        idempotencyKey: `r1-race-contact-${stamp}`,
        maneuverType: "contact",
        targetRoleKey: "xunfu",
        messageText: "首批名册为何准备得如此迅速？"
      });
      const version = run.run.version;
      const results = await Promise.all([
        request("POST", `/v4/story-runs/${run.run.id}/maneuvers`, token, {
          version,
          idempotencyKey: `r1-race-investigate-${stamp}`,
          maneuverType: "investigate",
          intentKey: "inspect_first_register_timing"
        }),
        request("POST", `/v4/story-runs/${run.run.id}/maneuvers`, token, {
          version,
          idempotencyKey: `r1-race-custom-${stamp}`,
          maneuverType: "custom",
          customText: "派幕僚核验巡抚府书吏的签押。"
        })
      ]);
      const summary = winnerSummary(results);
      const stored = await mustRequest("GET", `/v4/story-runs/${run.run.id}`, token);
      assert.equal(stored.maneuverState.maneuversUsedToday, 2);
      assert.equal(stored.maneuverState.maneuverOpportunitiesRemaining, 0);
      return { runId: run.run.id, ...summary, usedTypesToday: stored.maneuverState.usedTypesToday };
    });

    await check("R1-09 two requests racing for the same leverage card have one winner", async () => {
      let run = await createRun(token, "r1-leverage-race");
      run = await submitDecision(token, run, `r1-chip-race-decision-${stamp}`);
      assert.equal(run.activeDecision?.decisionKey, "d1_2");
      const version = run.run.version;
      const results = await Promise.all([
        request("POST", `/v4/story-runs/${run.run.id}/maneuvers`, token, {
          version,
          idempotencyKey: `r1-chip-race-a-${stamp}`,
          maneuverType: "leverage",
          leverageKey: "xunfu_merchant_old_pact_rumor",
          targetRoleKey: "merchant"
        }),
        request("POST", `/v4/story-runs/${run.run.id}/maneuvers`, token, {
          version,
          idempotencyKey: `r1-chip-race-b-${stamp}`,
          maneuverType: "leverage",
          leverageKey: "xunfu_merchant_old_pact_rumor",
          targetRoleKey: "xunfu"
        })
      ]);
      const summary = winnerSummary(results);
      const stored = await mustRequest("GET", `/v4/story-runs/${run.run.id}`, token);
      assert.equal(stored.maneuverState.maneuversUsedToday, 1);
      assert.deepEqual(stored.maneuverState.usedLeverageKeys, ["xunfu_merchant_old_pact_rumor"]);
      assert.equal(await prisma.storyEvent.count({ where: { runId: run.run.id, type: "leverage_used" } }), 1);
      return { runId: run.run.id, ...summary, usedLeverageKeys: stored.maneuverState.usedLeverageKeys };
    });

    await check("R1-10 legacy stateJson is restored by the migration path", async () => {
      let run = await createRun(token, "r1-legacy-state");
      run = await mustRequest("POST", `/v4/story-runs/${run.run.id}/maneuvers`, token, {
        version: run.run.version,
        idempotencyKey: `r1-legacy-contact-${stamp}`,
        maneuverType: "contact",
        targetRoleKey: "county_magistrate",
        messageText: "县衙是否提前收到催报？"
      });
      const row = await prisma.storyRun.findUniqueOrThrow({ where: { id: run.run.id } });
      const legacy = JSON.parse(JSON.stringify(row.stateJson)) as Json;
      delete legacy.maneuverState.usedTypesToday;
      delete legacy.maneuverState.discoveredFactKeys;
      delete legacy.maneuverState.usageDay;
      delete legacy.player.leverageKeys;
      legacy.player.leverage = ["田契暗账（半页）", "清流县令密信", "巡抚与商会旧约传闻"];
      await prisma.storyRun.update({ where: { id: run.run.id }, data: { stateJson: legacy } });
      await stopApi(api!);
      api = null;
      api = await startApi("legacy-migration");
      const restored = await mustRequest("GET", `/v4/story-runs/${run.run.id}`, token);
      assert.deepEqual(restored.maneuverState.usedTypesToday, ["contact"]);
      assert.ok(restored.leverageHand.items.some((item: Json) => item.leverageKey === "land_contract_fragment"));
      assert.ok(restored.leverageHand.items.some((item: Json) => item.leverageKey === "county_letter"));
      assert.equal(restored.run.version, run.run.version);
      return { runId: run.run.id, usedTypesToday: restored.maneuverState.usedTypesToday, leverageKeys: restored.leverageHand.items.map((item: Json) => item.leverageKey) };
    });

    await check("R1-11 no Prisma table or migration was added", async () => {
      const changed = execFileSync("git", ["diff", "--name-only", "HEAD^", "HEAD", "--", "prisma/schema.prisma", "prisma/migrations"], { cwd: ROOT, encoding: "utf8" }).trim();
      assert.equal(changed, "");
      return { changedPrismaPaths: [] };
    });
  } finally {
    if (api) await stopApi(api).catch(() => undefined);
    await prisma.$disconnect();
  }

  const failed = cases.filter((item) => item.status === "FAIL").length;
  const skipped = cases.filter((item) => item.status === "SKIP").length;
  const report = {
    checkpoint: failed ? "CHECKPOINT_R1_FAILED" : "CHECKPOINT_R1_PUSHED",
    status: failed ? "FAIL" : "PASS",
    commitSha: process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    remoteSha: process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    expectedParentSha: EXPECTED_PARENT,
    databaseType: "PostgreSQL",
    databaseVersion,
    storage: "PrismaMvpStoryStorage",
    mvpStoryStorage: process.env.MVP_STORY_STORAGE,
    primaryRunId,
    finalPrimaryState: finalPrimary ? {
      version: finalPrimary.run.version,
      maneuverOpportunitiesRemaining: finalPrimary.maneuverState.maneuverOpportunitiesRemaining,
      usedTypesToday: finalPrimary.maneuverState.usedTypesToday,
      usedLeverageKeys: finalPrimary.maneuverState.usedLeverageKeys
    } : null,
    total: cases.length,
    pass: cases.length - failed - skipped,
    fail: failed,
    skip: skipped,
    cases,
    startedAt,
    completedAt: new Date().toISOString(),
    logs: {
      evidence: join(EVIDENCE_DIR, "r1-prisma-report.json"),
      apiPattern: join(EVIDENCE_DIR, "api-*.log")
    }
  };
  await writeFile(join(EVIDENCE_DIR, "r1-prisma-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("R1_PRISMA_ACCEPTANCE_SUMMARY", JSON.stringify(report));
  if (failed) process.exitCode = 1;
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

main().catch(async (error) => {
  await mkdir(EVIDENCE_DIR, { recursive: true }).catch(() => undefined);
  const fatal = {
    checkpoint: "CHECKPOINT_R1_FAILED",
    status: "FAIL",
    total: cases.length || 1,
    pass: cases.filter((item) => item.status === "PASS").length,
    fail: Math.max(1, cases.filter((item) => item.status === "FAIL").length),
    skip: cases.filter((item) => item.status === "SKIP").length,
    cases,
    fatal: serializeError(error),
    completedAt: new Date().toISOString()
  };
  await writeFile(join(EVIDENCE_DIR, "r1-prisma-report.json"), `${JSON.stringify(fatal, null, 2)}\n`, "utf8").catch(() => undefined);
  console.error(error instanceof Error ? error.stack || error.message : error);
  console.log("R1_PRISMA_ACCEPTANCE_SUMMARY", JSON.stringify(fatal));
  process.exitCode = 1;
});
