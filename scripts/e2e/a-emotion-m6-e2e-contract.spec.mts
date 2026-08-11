import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  A_EMOTION_E2E_ACTION_IDS,
  A_EMOTION_E2E_CHECKPOINT_IDS,
  A_EMOTION_E2E_GENERATION_POLL_DEADLINE_MS,
  A_EMOTION_E2E_MODEL_REQUEST_TIMEOUT_MS,
  A_EMOTION_E2E_ROLE_KEYS,
  A_EMOTION_E2E_RUNTIME_MARKERS,
  A_EMOTION_E2E_SHORT_REQUEST_TIMEOUT_MS,
  A_EMOTION_M4_PROMISE_COMMAND_SCHEMA_VERSION,
  assertExactRoles,
  buildAEmotionE2ESimplePromiseCommand,
  createRandomSchema,
  findForbiddenNetworkPaths,
  generationTimeoutDiagnostic,
  isStoryGenerationInProgress,
  isUnsafeArchivePath,
  pnpmInvocation,
  redactDynamicApiPath,
  requireNonProductionSupabaseUrl,
  resolvePnpmTransport,
  sanitizeEvidence,
  scopedDatabaseUrl
} from "./a-emotion-m6-e2e-contract.mts";

const contractPath = new URL("./a-emotion-m6-e2e-contract.mts", import.meta.url);
const harnessPath = new URL("./a-emotion-m6-three-role-harness.mts", import.meta.url);
const orchestratorPath = new URL("./a-emotion-m6-real-e2e-orchestrator.mts", import.meta.url);
const acceptancePath = new URL("../acceptance/a-emotion-m6-supabase-random-schema.mts", import.meta.url);
const packagePath = new URL("../../package.json", import.meta.url);

async function sources() {
  const [contract, harness, orchestrator, acceptance, packageJson] = await Promise.all([
    readFile(contractPath, "utf8"),
    readFile(harnessPath, "utf8"),
    readFile(orchestratorPath, "utf8"),
    readFile(acceptancePath, "utf8"),
    readFile(packagePath, "utf8")
  ]);
  return { contract, harness, orchestrator, acceptance, packageJson };
}

test("E2E contract freezes exact roles, typed catalog identifiers and E2E-01 through E2E-10", () => {
  assertExactRoles([...A_EMOTION_E2E_ROLE_KEYS]);
  assert.equal(A_EMOTION_E2E_ACTION_IDS.hiddenCopyOnly, "main_s2_xunfu_seize_drafts");
  assert.equal(A_EMOTION_E2E_ACTION_IDS.suspectedInvestigation, "main_s2_governor_dual_verification");
  assert.equal(A_EMOTION_E2E_ACTION_IDS.confirmedEvidence, "main_s4_governor_seal_evidence");
  assert.deepEqual([...A_EMOTION_E2E_CHECKPOINT_IDS], [
    "E2E-01", "E2E-02", "E2E-03", "E2E-04", "E2E-05",
    "E2E-06", "E2E-07", "E2E-08", "E2E-09", "E2E-10"
  ]);
});

test("Supabase URL gate accepts official direct and Pooler hosts while rejecting local and production markers", () => {
  assert.throws(() => requireNonProductionSupabaseUrl("postgresql://u:p@127.0.0.1:5432/test", "I_ACKNOWLEDGE_NON_PROD"), /Local PostgreSQL/u);
  assert.throws(() => requireNonProductionSupabaseUrl("postgresql://u:p@db.demo.supabase.co:5432/production", "I_ACKNOWLEDGE_NON_PROD"), /Production\/public/u);
  for (const raw of [
    "postgresql://u:p@db.demo.supabase.co:5432/postgres?sslmode=require",
    "postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require"
  ]) {
    const base = requireNonProductionSupabaseUrl(raw, "I_ACKNOWLEDGE_NON_PROD");
    const schema = createRandomSchema();
    assert.equal(new URL(scopedDatabaseUrl(base, schema)).searchParams.get("schema"), schema);
  }
});

test("Windows pnpm transport executes npm_execpath through Node and never relies on a bare pnpm shim", () => {
  const transport = resolvePnpmTransport(
    { npm_execpath: "C:\\Users\\tester\\AppData\\Local\\pnpm\\pnpm.cjs" },
    "C:\\Program Files\\nodejs\\node.exe"
  );
  assert.equal(transport.program, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(transport.prefixArgs, ["C:\\Users\\tester\\AppData\\Local\\pnpm\\pnpm.cjs"]);
  assert.deepEqual(pnpmInvocation(transport, ["exec", "prisma", "generate"]).args, [
    "C:\\Users\\tester\\AppData\\Local\\pnpm\\pnpm.cjs", "exec", "prisma", "generate"
  ]);
  assert.throws(() => resolvePnpmTransport({ npm_execpath: "C:\\npm\\npm-cli.js" }, "C:\\node\\node.exe"), /not a pnpm entrypoint/u);
  assert.throws(() => resolvePnpmTransport({}, "/usr/bin/node"), /npm_execpath is required/u);
});



test("formal promise command uses the exact M4 authority keys, real target role and current stage", () => {
  const command = buildAEmotionE2ESimplePromiseCommand({
    idempotencyKey: "e2e-promise:xunfu:zhejiang_governor:turn-12345678:formal",
    promiseCode: "DELIVER_ORIGINAL_LEDGER",
    targetRoleKey: "zhejiang_governor",
    expectedStage: 2
  });
  assert.deepEqual(Object.keys(command).sort(), ["expectedStage", "idempotencyKey", "promiseCode", "schemaVersion", "targetRoleKey"]);
  assert.equal(command.schemaVersion, A_EMOTION_M4_PROMISE_COMMAND_SCHEMA_VERSION);
  assert.equal(command.targetRoleKey, "zhejiang_governor");
  assert.equal(command.expectedStage, 2);
  assert.equal("relatedObjectId" in command, false);
  assert.throws(() => buildAEmotionE2ESimplePromiseCommand({ idempotencyKey: "short", promiseCode: "DELIVER_ORIGINAL_LEDGER", targetRoleKey: "zhejiang_governor", expectedStage: 2 }), /idempotency/u);
  assert.throws(() => buildAEmotionE2ESimplePromiseCommand({ idempotencyKey: "valid-promise-key-123", promiseCode: "DELIVER_ORIGINAL_LEDGER", targetRoleKey: "zhejiang_governor", expectedStage: 0 }), /stage/u);
});

test("decision transport distinguishes short requests from bounded model generation and recognizes the accepted-pending code", () => {
  assert.equal(A_EMOTION_E2E_SHORT_REQUEST_TIMEOUT_MS, 30_000);
  assert.equal(A_EMOTION_E2E_MODEL_REQUEST_TIMEOUT_MS, 120_000);
  assert.equal(A_EMOTION_E2E_GENERATION_POLL_DEADLINE_MS, 240_000);
  assert.equal(isStoryGenerationInProgress(503, "STORY_GENERATION_IN_PROGRESS"), true);
  assert.equal(isStoryGenerationInProgress(503, "OPENING_STORY_GENERATING"), false);
  assert.equal(isStoryGenerationInProgress(500, "STORY_GENERATION_IN_PROGRESS"), false);
});

test("generation timeout diagnostics hash dynamic IDs and expose only bounded authoritative state", () => {
  const diagnostic = generationTimeoutDiagnostic({
    status: 503,
    code: "STORY_GENERATION_IN_PROGRESS",
    roomId: "room_raw_sensitive_identifier_1234567890",
    turnId: "turn_raw_sensitive_identifier_1234567890",
    polls: 9,
    lastState: { worldSequence: 12, currentTurnStatus: "RESOLVING", token: "do-not-store" }
  });
  const text = JSON.stringify(diagnostic);
  assert.doesNotMatch(text, /room_raw|turn_raw|do-not-store/u);
  assert.match(text, /roomHash/u);
  assert.match(text, /turnHash/u);
  assert.equal(diagnostic.polls, 9);
});

test("harness uses the real maneuver selector, explicit bounded decision timeout and authoritative pending-generation polling", async () => {
  const { harness } = await sources();
  assert.match(harness, /#maneuverSubmit/u);
  assert.doesNotMatch(harness, /#submitManeuver/u);
  assert.match(harness, /const timeoutMs = options\.timeoutMs \?\? A_EMOTION_E2E_SHORT_REQUEST_TIMEOUT_MS/u);
  assert.match(harness, /timeout:\s*timeoutMs/u);
  assert.match(harness, /timeoutMs:\s*A_EMOTION_E2E_MODEL_REQUEST_TIMEOUT_MS/u);
  assert.match(harness, /STORY_GENERATION_IN_PROGRESS/u);
  assert.match(harness, /waitForAuthoritativeDecisionCompletion/u);
  assert.match(harness, /worldSequenceAdvanced/u);
  assert.match(harness, /currentTurnChanged/u);
  assert.match(harness, /pendingGenerationRecovered/u);
  assert.match(harness, /decision generation deadline exceeded/u);
  assert.match(harness, /stableIdempotencyKey/u);
  assert.match(harness, /persistedActions\.length, 1/u);
  assert.doesNotMatch(harness, /relatedObjectId:\s*["']original-grain-ledger/u);
});

test("evidence sanitizer hashes dynamic identifiers and rejects secret or state archive paths", () => {
  const sanitized = sanitizeEvidence({
    authorization: "Bearer abc",
    roomId: "room_abcdefghijklmnopqrstuvwxyz",
    nested: { url: "postgresql://user:password@db.demo.supabase.co/postgres?token=secret", text: "key-123456" }
  }, ["key-123456"]);
  assert.equal(sanitized.authorization, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(sanitized), /password|secret|key-123456|room_abcdefghijklmnopqrstuvwxyz/u);
  assert.deepEqual(findForbiddenNetworkPaths({ safe: { sourceRoleId: "role-x" } }), ["$.safe.sourceRoleId"]);
  assert.match(redactDynamicApiPath("/v4/rooms/room_abcdefghijklmnopqrstuvwxyz/events/event_1234567890?cursor=secret"), /id-[a-f0-9]{12}/u);
  for (const path of ["../secret", "/tmp/file", "C:/file", ".env.test", "node_modules/x", "evidence/storageState.json", ".git/config"]) assert.equal(isUnsafeArchivePath(path), true, path);
  assert.equal(isUnsafeArchivePath("scripts/e2e/a-emotion-m6-e2e-contract.mts"), false);
});

test("orchestrator validates safety, generates before Prisma import/connect, grants bounded credits and retries only OPENING_STORY_GENERATING", async () => {
  const { orchestrator } = await sources();
  const safetyIndex = orchestrator.indexOf("requireNonProductionSupabaseUrl");
  const generateIndex = orchestrator.indexOf('runPnpm(["exec", "prisma", "generate"]');
  const importIndex = orchestrator.indexOf('await import("@prisma/client")');
  const connectIndex = orchestrator.indexOf("await admin.$connect()");
  assert.ok(safetyIndex >= 0 && generateIndex > safetyIndex && importIndex > generateIndex && connectIndex > importIndex, "Prisma generate must run after safety validation and before Prisma import/connect");
  assert.match(orchestrator, /ALLOW_TEST_CREDIT_GRANT: "true"/u);
  assert.match(orchestrator, /\/v4\/credits\/test-grant/u);
  assert.match(orchestrator, /balance\.available/u);
  assert.match(orchestrator, /response\.status !== 503 \|\| response\.code !== "OPENING_STORY_GENERATING"/u);
  assert.match(orchestrator, /waitForPlayableOpening/u);
  assert.match(orchestrator, /currentTurn|turn\?\.status === "OPEN"/u);
  assert.match(orchestrator, /redactDynamicApiPath/u);
  assert.doesNotMatch(orchestrator, /spawn\(["']pnpm["']/u);
});

test("all child pnpm work uses the argument-safe transport and Windows finally stops only the started process trees", async () => {
  const { orchestrator, acceptance } = await sources();
  for (const source of [orchestrator, acceptance]) {
    assert.match(source, /resolvePnpmTransport/u);
    assert.match(source, /pnpmInvocation/u);
    assert.doesNotMatch(source, /spawn\(["']pnpm["']/u);
    assert.doesNotMatch(source, /shell:\s*true/u);
  }
  assert.match(orchestrator, /taskkill\.exe/u);
  assert.match(orchestrator, /\["\/PID", String\(child\.pid\), "\/T", "\/F"\]/u);
  assert.match(orchestrator, /waitForPortClosed\(apiPort/u);
  assert.match(orchestrator, /waitForPortClosed\(webPort/u);
  assert.match(orchestrator, /workerProcessesStopped/u);
});

test("worker readiness is based on the worker process output rather than an orchestrator SELECT 1", async () => {
  const { orchestrator } = await sources();
  assert.match(orchestrator, /waitForWorkerSignal/u);
  assert.match(orchestrator, /Nest application successfully started/u);
  assert.doesNotMatch(orchestrator, /function waitForWorker[\s\S]*\$queryRaw`SELECT 1`/u);
});

test("harness creates exactly six windows from three isolated contexts and fails on pageerror or non-whitelisted severe console", async () => {
  const { harness } = await sources();
  assert.match(harness, /browser\.newContext/u);
  assert.match(harness, /primary: await context\.newPage\(\), secondary: await context\.newPage\(\)/u);
  assert.match(harness, /windowRecords = states\.flatMap/u);
  assert.match(harness, /severeBrowserErrors/u);
  assert.match(harness, /pageerror/u);
  assert.match(harness, /assertNoBrowserErrors/u);
});

test("strict E2E-03/06/07/08/09/10 assertions cover authoritative state, modal-once, 3/6 feed and second-window reconnect", async () => {
  const { harness } = await sources();
  for (const marker of [
    "metricValue(beforeProjection, \"imperial_trust\")",
    '"visibleSourceRoleId" in related',
    'item.category === "SUSPICIOUS"',
    "unrelated/source viewer must receive no extra delivery",
    "CONFIRMED must upgrade the original aggregate",
    "second window must not replay the durable modal",
    "23→18",
    "18→16 must not produce a second CRISIS modal",
    "reward.metricBefore, 0",
    "reward.metricAfter, 12",
    "collapsed feed must show exactly 3",
    "expanded feed must show exactly 6",
    "overflow.scrollHeight > overflow.clientHeight",
    "replaceSecondaryWindow",
    "conditional skipping is forbidden"
  ]) assert.ok(harness.includes(marker), `missing strict Repair8 marker: ${marker}`);
});

test("runtime proof measures 10 Feed, 100 history, 7-second polling, five-event SSE, bounded DOM and active input", async () => {
  const { contract, harness } = await sources();
  for (const marker of A_EMOTION_E2E_RUNTIME_MARKERS) assert.match(`${contract}\n${harness}`, new RegExp(marker, "u"));
  assert.match(harness, /ensureRealFeedCount\("zhejiang_governor", 10\)/u);
  assert.match(harness, /length: 100/u);
  assert.match(harness, /EventSource/u);
  assert.match(harness, /sseMessages\.length >= 5/u);
  assert.match(harness, /value >= 5_000 && value <= 10_000/u);
  assert.match(harness, /active input dispatch must remain responsive/u);
  assert.match(harness, /aggregated feed DOM must remain bounded/u);
});

test("network and database evidence is whitelist-only and never persists raw room/run/user/state data", async () => {
  const { harness, orchestrator } = await sources();
  assert.match(harness, /roomIdHash/u);
  assert.match(harness, /route: redactDynamicApiPath/u);
  assert.equal((harness.match(/checkpoint\.json/g) || []).length, 2);
  assert.equal((harness.match(/roomIdHash:/g) || []).length >= 3, true);
  assert.match(orchestrator, /runIdHash/u);
  assert.doesNotMatch(orchestrator, /select: \{ id: true, version: true, worldSequence: true, stateJson: true/u);
  assert.match(orchestrator, /players: players\.map/u);
});

test("test-only repair uses production routes, exact catalog IDs, currentTurn narrative and no Chinese semantic matching", async () => {
  const { harness, orchestrator, packageJson } = await sources();
  for (const id of A_EMOTION_E2E_CHECKPOINT_IDS) assert.match(harness, new RegExp(id, "u"));
  for (const actionId of Object.values(A_EMOTION_E2E_ACTION_IDS)) assert.match(harness, new RegExp(actionId, "u"));
  assert.match(harness, /entry\.actionKey === actionKey/u);
  assert.match(orchestrator, /\/v4\/rooms/u);
  assert.doesNotMatch(`${harness}\n${orchestrator}`, /test-only(?:-|_)route|__aemotion_test|fixture-api/iu);
  assert.doesNotMatch(`${harness}\n${orchestrator}`, /\.match\([^\n]*(?:原册|粮册|巡抚)|new RegExp\([^\n]*(?:桑田|原册|粮册)/u);
  const scripts = JSON.parse(packageJson).scripts;
  assert.match(scripts["test:a-emotion-m6:e2e"], /a-emotion-m6-real-e2e-orchestrator\.mts/u);
  assert.doesNotMatch(scripts["test:a-emotion-m6:e2e"], /--env-file|--import\s+tsx/u);
});
