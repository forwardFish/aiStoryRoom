import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main() {
  const evidenceRoot = path.resolve(
    process.env.SOLO_ENDGAME_STAGE_C_EVIDENCE_DIR
      || path.join(root, "artifacts", "solo-endgame-stage-c"),
  );
  const childArgs = [
    "--env-file-if-exists=.env.test",
    "scripts/e2e/solo-endgame-mvp.mjs",
  ];

  await mkdir(evidenceRoot, { recursive: true });
  const execution = await run(process.execPath, childArgs, root);
  await writeFile(path.join(evidenceRoot, "solo-endgame-mvp.stdout.log"), execution.stdout, "utf8");
  await writeFile(path.join(evidenceRoot, "solo-endgame-mvp.stderr.log"), execution.stderr, "utf8");
  assert.equal(execution.code, 0, `technical MVP E2E failed with exit ${execution.code}`);

  const summary = lastJsonObject(execution.stdout);
  assert.equal(summary.status, "PASS");
  const outputDir = path.resolve(root, String(summary.outputDir || ""));
  assert.equal(outputDir.startsWith(`${root}${path.sep}`), true, "E2E output escaped the repository");
  const evidence = JSON.parse(await readFile(path.join(outputDir, "evidence.json"), "utf8"));
  const validated = validateTechnicalEvidence(evidence);
  const final = {
    schemaVersion: "solo_endgame_stage_c_technical_v1",
    candidateSha: String(process.env.GITHUB_SHA || process.env.CANDIDATE_SHA || ""),
    remoteBranch: String(process.env.GITHUB_REF_NAME || "codex/chatgpt-pro-main-game-final-v1"),
    sourceEvidenceDirectory: path.relative(root, outputDir),
    ...validated,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(evidenceRoot, "stage-c-technical.json"),
    `${JSON.stringify(final, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(final)}\n`);
}

export function validateTechnicalEvidence(value) {
  const rootValue = record(value);
  assert.equal(rootValue.schemaVersion, "solo_endgame_mvp_evidence_v1");
  assert.equal(rootValue.testOnly, true);
  const database = record(rootValue.database);
  assert.match(String(database.host || ""), /supabase/i);
  assert.equal(database.migrationExecuted, false);

  const services = record(rootValue.services);
  assert.equal(services.restartedRuntime, true);
  assert.equal(services.restartedApi, true);

  const routes = Array.isArray(rootValue.routes) ? rootValue.routes : [];
  assert.equal(routes.length, 2, "exactly two legal T01-T20 routes are required");
  const endingKeys = new Set();
  const runIds = new Set();
  for (const [index, candidate] of routes.entries()) {
    const route = record(candidate);
    assert.equal(Number(route.actionCount), 20, `route ${index} must persist exactly twenty actions`);
    assert.equal(Number(route.sceneCount), 20, `route ${index} must persist exactly twenty scenes`);
    assert.equal(Array.isArray(route.route), true, `route ${index} must retain its submitted choice history`);
    assert.equal(route.route.length, 20, `route ${index} must contain T01-T20`);
    assert.match(String(route.runId || ""), /^solo_ovl_[a-f0-9]{32}$/);
    assert.ok(String(route.endingKey || ""), `route ${index} must have an authoritative endingKey`);
    endingKeys.add(String(route.endingKey));
    runIds.add(String(route.runId));
    const causeCount = Number(route.causeCount);
    assert.ok(causeCount >= 1 && causeCount <= 3, `route ${index} must expose 1-3 causes`);
    assert.equal(route.scope, "PART");
    assert.equal(route.sourceTurnId, "T20");
    assert.equal(route.sourceRevision, 20);
  }
  assert.equal(runIds.size, 2, "the two routes must use independent Runs");
  assert.equal(endingKeys.size, 2, "the two routes must produce different authoritative endings");

  const deterministic = record(rootValue.deterministic);
  assert.ok(String(deterministic.initialPresentationHash || ""));
  assert.equal(deterministic.afterRuntimeRestartHash, deterministic.initialPresentationHash);
  assert.equal(deterministic.afterApiRestartHash, deterministic.initialPresentationHash);

  const permissions = record(rootValue.permissions);
  assert.equal(permissions.outsiderResultRejected, true);
  const historical = record(rootValue.historical);
  assert.equal(historical.resultType, "LEGACY_ENDING");
  assert.equal(historical.proseGuessed, false);
  const replay = record(rootValue.replay);
  assert.equal(replay.oldRunPreserved, true);
  assert.notEqual(replay.oldRunId, replay.newRunId);
  assert.equal(replay.changeRoleEnabled, false);
  assert.equal(replay.nextPartEnabled, false);

  const browser = record(rootValue.browser);
  assert.equal(record(browser.layout).left, true);
  assert.equal(record(browser.layout).center, true);
  assert.equal(record(browser.layout).right, true);
  assert.ok(Number(browser.causeCount) >= 1 && Number(browser.causeCount) <= 3);
  assert.equal(Array.isArray(browser.runtimeExceptions), true);
  assert.equal(browser.runtimeExceptions.length, 0);

  return {
    status: "STAGE_C_TECHNICAL_PASSED",
    routeCount: routes.length,
    distinctEndingCount: endingKeys.size,
    realSupabaseTestDatabase: true,
    realGamePage: true,
    deterministicRestartReadback: true,
    outsiderRejected: true,
    replayPreservesOldRun: true,
    humanAcceptanceStatus: "REQUIRED_SEPARATELY",
  };
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function lastJsonObject(text) {
  for (const line of String(text || "").trim().split(/\r?\n/u).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Child services may emit normal logs; only the final JSON summary counts.
    }
  }
  throw new Error("SOLO_ENDGAME_STAGE_C_SUMMARY_MISSING");
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: `${stderr}${error.stack || error}\n` }));
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
