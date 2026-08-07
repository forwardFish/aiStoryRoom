import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeepSeekMvpNarrativeProvider } from "../../apps/api/src/mvp-narrative-provider";
import { sangtianOpenNovelManeuverPackage } from "../../apps/api/src/openovel-adapter/sangtian-openovel-maneuver.package";

const API_KEY = requiredEnv("DEEPSEEK_API_KEY");
const BASE_URL = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const MODEL = String(process.env.DEEPSEEK_MODEL || "deepseek-v4-pro");
const EVIDENCE_ROOT = path.resolve(
  process.env.OPENOVEL_R2_4_EVIDENCE_ROOT
  || path.join(process.cwd(), "artifacts", "openovel-maneuver-r2-4-real-model"),
);
const INPUT_RATE = numberEnv("OPENOVEL_R2_4_INPUT_USD_PER_MILLION", 0.435);
const OUTPUT_RATE = numberEnv("OPENOVEL_R2_4_OUTPUT_USD_PER_MILLION", 0.87);
const HIDDEN_SENTINEL = "HIDDEN_FACT_SENTINEL_R2_4_9F31";
const startedAt = new Date().toISOString();

const realProvider = new DeepSeekMvpNarrativeProvider({
  apiKey: API_KEY,
  baseUrl: BASE_URL,
  model: MODEL,
  timeoutMs: Number(process.env.AI_CAUSAL_TIMEOUT_MS || 30_000),
  maxAttempts: Number(process.env.AI_CAUSAL_MAX_ATTEMPTS || 1),
});

const cases = [
  contactCase("county_magistrate", "d1_1", "原始底册是否完整？明日之前能否送到总督府？"),
  contactCase("xunfu", "d1_1", "为何首批名册在诏令送达前已经形成？"),
  contactCase("merchant", "d1_2", "商会承诺的粮食究竟来自哪些仓号？"),
  leverageCase("land_contract_fragment", "merchant", "d2_1"),
  leverageCase("county_letter", "xunfu", "d2_1"),
];

try {
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  const calls = [];
  for (const item of cases) {
    const before = structuredClone(realProvider.lastCall);
    const output = await realProvider.generateManeuverCandidate(item.context);
    const call = structuredClone(realProvider.lastCall);
    validateOutput(output, item.id);
    assert.notDeepEqual(call, before, `${item.id} did not create a provider call record`);
    assert.ok(call.attempts >= 1, `${item.id} must record at least one HTTP attempt`);
    calls.push({
      id: item.id,
      kind: item.kind,
      targetRoleKey: item.targetRoleKey,
      model: realProvider.name,
      logicalCalls: 1,
      httpAttempts: call.attempts,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      latencyMs: call.elapsedMs,
      estimatedCostUsd: estimateCost(call.inputTokens, call.outputTokens),
      output,
    });
  }

  const contactReplies = calls
    .filter((item) => item.kind === "contact")
    .map((item) => normalize(String(item.output.replyText || item.output.narrative || "")));
  assert.equal(new Set(contactReplies).size, contactReplies.length, "three characters returned indistinguishable replies");
  assert.equal(calls.reduce((sum, item) => sum + item.logicalCalls, 0), 5);

  const timeoutFallback = await verifyTimeoutFallback();
  const totals = calls.reduce((result, item) => ({
    logicalCalls: result.logicalCalls + item.logicalCalls,
    httpAttempts: result.httpAttempts + item.httpAttempts,
    inputTokens: result.inputTokens + item.inputTokens,
    outputTokens: result.outputTokens + item.outputTokens,
    latencyMs: result.latencyMs + item.latencyMs,
    estimatedCostUsd: result.estimatedCostUsd + item.estimatedCostUsd,
  }), {
    logicalCalls: 0,
    httpAttempts: 0,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    estimatedCostUsd: 0,
  });

  const report = {
    schemaVersion: "openovel_maneuver_r2_4_real_model_v1",
    verdict: "PASS",
    provider: realProvider.name,
    baseUrl: redactUrl(BASE_URL),
    model: MODEL,
    pricingAssumption: {
      inputUsdPerMillionTokens: INPUT_RATE,
      outputUsdPerMillionTokens: OUTPUT_RATE,
      source: "acceptance configuration; override with OPENOVEL_R2_4_*_USD_PER_MILLION",
    },
    realModelCalls: calls,
    totals,
    timeoutFallback,
    assertions: {
      exactlyFiveRealLogicalCalls: totals.logicalCalls === 5,
      threeDistinctCharacterReplies: new Set(contactReplies).size === 3,
      noHiddenSentinelLeak: calls.every((item) => !JSON.stringify(item.output).includes(HIDDEN_SENTINEL)),
      noStatePatchOutput: calls.every((item) => !Object.prototype.hasOwnProperty.call(item.output, "statePatch")),
      controlledTimeoutNotCountedAsRealModelCall: true,
    },
    startedAt,
    completedAt: new Date().toISOString(),
  };
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`OPENOVEL_MANEUVER_R2_4_REAL_MODEL_PASS ${path.join(EVIDENCE_ROOT, "report.json")}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  await mkdir(EVIDENCE_ROOT, { recursive: true }).catch(() => undefined);
  await writeFile(path.join(EVIDENCE_ROOT, "report.json"), `${JSON.stringify({
    schemaVersion: "openovel_maneuver_r2_4_real_model_v1",
    verdict: "FAIL",
    provider: realProvider.name,
    model: MODEL,
    error: serializeError(error),
    startedAt,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8").catch(() => undefined);
  throw error;
}

function contactCase(roleKey: string, sceneKey: string, playerMessage: string) {
  const actor = sangtianOpenNovelManeuverPackage.actor(roleKey);
  assert.ok(actor, `missing actor ${roleKey}`);
  return {
    id: `contact:${roleKey}`,
    kind: "contact",
    targetRoleKey: roleKey,
    context: context({
      sceneKey,
      maneuverType: "contact",
      target: actor,
      playerMessage,
      leverage: null,
    }),
  };
}

function leverageCase(leverageKey: string, targetRoleKey: string, sceneKey: string) {
  const actor = sangtianOpenNovelManeuverPackage.actor(targetRoleKey);
  const leverage = sangtianOpenNovelManeuverPackage.leverage(leverageKey);
  assert.ok(actor, `missing actor ${targetRoleKey}`);
  assert.ok(leverage, `missing leverage ${leverageKey}`);
  return {
    id: `leverage:${leverageKey}:${targetRoleKey}`,
    kind: "leverage",
    targetRoleKey,
    context: context({
      sceneKey,
      maneuverType: "leverage",
      target: actor,
      playerMessage: "",
      leverage,
    }),
  };
}

function context(input: {
  sceneKey: string;
  maneuverType: "contact" | "leverage";
  target: NonNullable<ReturnType<typeof sangtianOpenNovelManeuverPackage.actor>>;
  playerMessage: string;
  leverage: ReturnType<typeof sangtianOpenNovelManeuverPackage.leverage>;
}) {
  return {
    world: {
      worldId: sangtianOpenNovelManeuverPackage.worldId,
      maneuverPackageVersion: sangtianOpenNovelManeuverPackage.packageVersion,
      language: "zh-CN",
    },
    task: input.maneuverType === "contact"
      ? "character_response"
      : "leverage_character_response",
    sceneKey: input.sceneKey,
    maneuverType: input.maneuverType,
    target: {
      roleKey: input.target.roleKey,
      displayName: input.target.displayName,
      publicIdentity: input.target.publicIdentity,
      publicGoal: input.target.publicGoal,
      informationStyle: input.target.informationStyle,
    },
    playerMessage: input.playerMessage,
    leverage: input.leverage ? {
      leverageKey: input.leverage.leverageKey,
      label: input.leverage.label,
      description: input.leverage.description,
    } : null,
    recentCanon: "浙江总督正在处理改桑执行、县册复核与首份奏报解释权。当前只允许人物依据公开身份和已知场景作出一次回应。",
    immutableRuleResult: {
      statePatchKeys: ["server_owned_metric"],
      factKeys: [],
      traces: ["server-owned trace"],
      forbiddenClaims: [HIDDEN_SENTINEL],
    },
  };
}

function validateOutput(value: unknown, id: string) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${id} output must be an object`);
  const output = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(output).sort(), ["narrative", "replyText", "title"]);
  for (const key of ["title", "narrative", "replyText"]) {
    assert.equal(typeof output[key], "string", `${id}.${key} must be a string`);
    assert.ok(String(output[key]).trim(), `${id}.${key} must not be empty`);
  }
  const text = JSON.stringify(output);
  assert.equal(text.includes(HIDDEN_SENTINEL), false, `${id} leaked a hidden fact sentinel`);
  assert.doesNotMatch(text, /statePatch|factKeys|usedLeverageKeys|metrics/i);
  assert.doesNotMatch(text, /你已经决定|你答应了|你下令了/u, `${id} made a decision for the player`);
}

async function verifyTimeoutFallback() {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      if (response.writableEnded) return;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
    }, 2_500);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const provider = new DeepSeekMvpNarrativeProvider({
    apiKey: "controlled-timeout-not-a-real-model-call",
    baseUrl: `http://127.0.0.1:${address.port}`,
    model: "controlled-timeout-transport",
    timeoutMs: 1_000,
    maxAttempts: 1,
  });
  const definition = sangtianOpenNovelManeuverPackage
    .scene("d1_1")
    ?.contacts.find((item) => item.roleKey === "county_magistrate");
  assert.ok(definition);
  const started = Date.now();
  let errorMessage = "";
  try {
    await provider.generateManeuverCandidate(contactCase(
      "county_magistrate",
      "d1_1",
      "请说明原册是否齐全。",
    ).context);
    throw new Error("controlled timeout unexpectedly succeeded");
  } catch (error) {
    errorMessage = String((error as Error)?.message || error);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const fallbackNarrative = sangtianOpenNovelManeuverPackage.surfaces.contactFallback(definition);
  assert.ok(fallbackNarrative.includes(definition.fallbackReply));
  assert.equal(provider.lastCall.attempts, 1);
  return {
    mode: "controlled_timeout_transport",
    countedAsRealModelCall: false,
    httpAttempts: provider.lastCall.attempts,
    elapsedMs: Date.now() - started,
    errorMessage,
    fallbackTitle: definition.fallbackTitle,
    fallbackNarrative,
  };
}

function estimateCost(inputTokens: number, outputTokens: number) {
  return Number((
    (inputTokens / 1_000_000) * INPUT_RATE
    + (outputTokens / 1_000_000) * OUTPUT_RATE
  ).toFixed(8));
}

function normalize(value: string) {
  return value.replace(/\s+/g, "").replace(/[“”‘’"'，。！？；：、]/g, "");
}

function redactUrl(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
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

function serializeError(error: unknown) {
  return {
    name: (error as Error)?.name || "Error",
    message: (error as Error)?.message || String(error),
    stack: (error as Error)?.stack || null,
  };
}
