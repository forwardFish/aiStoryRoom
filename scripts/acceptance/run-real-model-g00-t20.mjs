import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "../..");
const evidenceRoot = resolve(
  process.env.AI_STORY_REAL_MODEL_EVIDENCE_ROOT
    || resolve(repoRoot, "docs/auto-execute/evidence/chatgpt-pro-g00-t20"),
);
mkdirSync(evidenceRoot, { recursive: true });

const expectedModel = String(process.env.OPENOVEL_MODEL || "deepseek-v4-pro").trim();
const providerBaseUrl = String(process.env.OPENOVEL_PROVIDER_BASE_URL || "https://api.deepseek.com").trim();
const apiKey = [
  process.env.OPENOVEL_PROVIDER_API_KEY,
  process.env.OPENOVEL_API_KEY,
  process.env.DEEPSEEK_API_KEY,
].map((value) => String(value || "").trim()).find(Boolean);
if (!apiKey) {
  throw new Error("REAL_MODEL_API_KEY_MISSING");
}
if (!/deepseek/iu.test(providerBaseUrl)) {
  throw new Error(`REAL_MODEL_PROVIDER_NOT_DEEPSEEK:${providerBaseUrl}`);
}
if (!/deepseek/iu.test(expectedModel)) {
  throw new Error(`REAL_MODEL_NAME_NOT_DEEPSEEK:${expectedModel}`);
}

const auditSourcePath = resolve(repoRoot, "apps/openovel-runtime/src/cli/audit-run.ts");
const auditSource = readFileSync(auditSourcePath, "utf8");
const args = [];
const add = (flag, value) => {
  if (auditSource.includes(flag)) args.push(flag, value);
};
add("--turns", "20");
if (!args.includes("--turns")) add("--max-turns", "20");
add("--world-id", "sangtian");
if (!args.includes("--world-id")) add("--world", "sangtian");
add("--role-id", "zhejiang_governor");
if (!args.includes("--role-id")) add("--role", "zhejiang_governor");
add("--output-dir", evidenceRoot);
if (!args.includes("--output-dir")) add("--output", resolve(evidenceRoot, "audit-run.json"));

const env = {
  ...process.env,
  OPENOVEL_PROVIDER_BASE_URL: providerBaseUrl,
  OPENOVEL_PROVIDER_API_KEY: apiKey,
  OPENOVEL_API_KEY: apiKey,
  DEEPSEEK_API_KEY: apiKey,
  OPENOVEL_MODEL: expectedModel,
  OPENOVEL_NARRATOR_MODEL: String(process.env.OPENOVEL_NARRATOR_MODEL || expectedModel),
  OPENOVEL_REVIEWER_MODEL: String(process.env.OPENOVEL_REVIEWER_MODEL || expectedModel),
  OPENOVEL_OPTIONS_MODEL: String(process.env.OPENOVEL_OPTIONS_MODEL || expectedModel),
  OPENOVEL_STORYKEEPER_MODEL: String(process.env.OPENOVEL_STORYKEEPER_MODEL || expectedModel),
  OPENOVEL_DEEPSEEK_THINKING: String(process.env.OPENOVEL_DEEPSEEK_THINKING || "disabled"),
  OPENOVEL_AUDIT_TURNS: "20",
  OPENOVEL_AUDIT_MAX_TURNS: "20",
  OPENOVEL_AUDIT_OUTPUT_DIR: evidenceRoot,
  OPENOVEL_AUDIT_WORLD_ID: "sangtian",
  OPENOVEL_AUDIT_ROLE_ID: "zhejiang_governor",
  OPENOVEL_AUDIT_REAL_PROVIDER_REQUIRED: "1",
  OPENOVEL_ALLOW_FIXTURE_PROVIDER: "0",
};

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commandArgs = ["--filter", "@apps/openovel-runtime", "audit:run", "--", ...args];
const startedAt = new Date().toISOString();
const result = spawnSync(command, commandArgs, {
  cwd: repoRoot,
  env,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  timeout: Number(process.env.AI_STORY_REAL_MODEL_TIMEOUT_MS || 45 * 60 * 1000),
});
writeFileSync(resolve(evidenceRoot, "audit-run.stdout.log"), result.stdout || "", "utf8");
writeFileSync(resolve(evidenceRoot, "audit-run.stderr.log"), result.stderr || "", "utf8");
writeFileSync(resolve(evidenceRoot, "audit-run-command.json"), JSON.stringify({
  command,
  args: commandArgs,
  providerBaseUrl,
  expectedModel,
  startedAt,
  finishedAt: new Date().toISOString(),
  exitCode: result.status,
  signal: result.signal,
  apiKeyPresent: true,
}, null, 2) + "\n", "utf8");
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`REAL_MODEL_AUDIT_RUN_FAILED:${result.status}`);
}

const jsonValues = [];
for (const file of walk(evidenceRoot)) {
  if (!file.endsWith(".json") || file.endsWith("real-model-g00-t20-summary.json")) continue;
  try {
    jsonValues.push({ source: file, value: JSON.parse(readFileSync(file, "utf8")) });
  } catch {
    // A malformed auxiliary file is ignored; the authoritative evidence still
    // has to satisfy all checks below.
  }
}
for (const [index, line] of String(result.stdout || "").split(/\r?\n/u).entries()) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
  try {
    jsonValues.push({ source: `stdout:${index + 1}`, value: JSON.parse(trimmed) });
  } catch {
    // Human-readable stdout is permitted.
  }
}

const allNodes = [];
for (const entry of jsonValues) collect(entry.value, entry.source, allNodes);
const providerRecords = allNodes.filter(({ value }) => isObject(value) && (
  hasText(value.provider)
  || hasText(value.model)
  || hasText(value.modelId)
  || hasText(value.providerBaseUrl)
  || hasText(value.requestId)
));
const modelNames = unique(providerRecords.flatMap(({ value }) => [
  value.model,
  value.modelId,
  value.narratorModel,
  value.reviewerModel,
  value.optionsModel,
  value.storykeeperModel,
].filter(hasText).map(String)));
const providerNames = unique(providerRecords.flatMap(({ value }) => [
  value.provider,
  value.providerName,
  value.providerBaseUrl,
  value.baseUrl,
].filter(hasText).map(String)));
const fixtureSignals = providerRecords.filter(({ value }) => JSON.stringify(value).match(/fixture|mock|stub|fake-provider/iu));
const providerCallRecords = allNodes.filter(({ value }) => isObject(value) && (
  value.type === "provider_call"
  || value.kind === "PROVIDER_CALL"
  || hasText(value.requestId)
  || hasText(value.providerRequestId)
  || (Number.isFinite(value.inputTokens) && Number.isFinite(value.outputTokens))
));
if (!providerCallRecords.length) throw new Error("REAL_MODEL_PROVIDER_CALL_EVIDENCE_MISSING");
if (fixtureSignals.length) throw new Error("REAL_MODEL_FIXTURE_SIGNAL_DETECTED");
if (modelNames.length && modelNames.some((name) => !/deepseek/iu.test(name))) {
  throw new Error(`REAL_MODEL_UNEXPECTED_MODEL:${modelNames.join(",")}`);
}
if (providerNames.length && providerNames.some((name) => !/deepseek/iu.test(name))) {
  throw new Error(`REAL_MODEL_UNEXPECTED_PROVIDER:${providerNames.join(",")}`);
}

const turnRecords = findTurnRecords(allNodes);
const opening = turnRecords.find((turn) => turn.turnNumber === 0 || turn.turnId === "G00" || turn.phase === "G00");
const playerTurns = turnRecords
  .filter((turn) => Number.isInteger(turn.turnNumber) && turn.turnNumber >= 1 && turn.turnNumber <= 20)
  .sort((left, right) => left.turnNumber - right.turnNumber);
const distinctPlayerTurns = unique(playerTurns.map((turn) => turn.turnNumber));
if (!opening) throw new Error("REAL_MODEL_G00_EVIDENCE_MISSING");
if (distinctPlayerTurns.length !== 20 || distinctPlayerTurns.some((turn, index) => turn !== index + 1)) {
  throw new Error(`REAL_MODEL_T01_T20_INCOMPLETE:${distinctPlayerTurns.join(",")}`);
}
for (const turn of playerTurns) {
  if (!hasPlayerAction(turn)) throw new Error(`REAL_MODEL_PLAYER_ACTION_MISSING:T${pad(turn.turnNumber)}`);
  if (!hasNarrative(turn)) throw new Error(`REAL_MODEL_NARRATIVE_MISSING:T${pad(turn.turnNumber)}`);
  if (!hasCanonBinding(turn)) throw new Error(`REAL_MODEL_CANON_BINDING_MISSING:T${pad(turn.turnNumber)}`);
  if (!hasReviewStatus(turn)) throw new Error(`REAL_MODEL_REVIEW_STATUS_MISSING:T${pad(turn.turnNumber)}`);
}

const summary = {
  schemaVersion: "omw.chatgpt-pro-real-model-g00-t20.v1",
  verdict: "PASS",
  repository: "forwardFish/aiStoryRoom",
  branch: "codex/chatgpt-pro-ai-story-convergence",
  providerBaseUrl,
  expectedModel,
  observedModels: modelNames,
  observedProviders: providerNames,
  providerCallCount: providerCallRecords.length,
  fixtureSignalCount: 0,
  opening: summarizeTurn(opening),
  turns: playerTurns.map(summarizeTurn),
  turnCount: playerTurns.length,
  evidenceFiles: jsonValues.map(({ source }) => relativeEvidencePath(source)),
  auditSourceSha256: sha256(auditSource),
  generatedAt: new Date().toISOString(),
};
writeFileSync(
  resolve(evidenceRoot, "real-model-g00-t20-summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
  "utf8",
);
console.log(JSON.stringify(summary, null, 2));

function walk(root) {
  const files = [];
  for (const name of readdirSync(root)) {
    const path = resolve(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function collect(value, source, output, path = "$", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  output.push({ source, path, value });
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collect(entry, source, output, `${path}[${index}]`, seen));
  } else {
    Object.entries(value).forEach(([key, entry]) => collect(entry, source, output, `${path}.${key}`, seen));
  }
}

function findTurnRecords(nodes) {
  const candidates = [];
  for (const { value, source, path } of nodes) {
    if (!isObject(value)) continue;
    const turnNumber = numericTurn(value);
    const turnId = hasText(value.turnId) ? String(value.turnId) : null;
    const phase = hasText(value.phase) ? String(value.phase) : null;
    if (turnNumber === null && turnId !== "G00" && phase !== "G00") continue;
    const score = scoreTurn(value);
    if (score < 2) continue;
    candidates.push({ ...value, turnNumber: turnNumber ?? 0, turnId, phase, __source: source, __path: path, __score: score });
  }
  const bestByTurn = new Map();
  for (const candidate of candidates) {
    const key = candidate.turnNumber === 0 ? "G00" : `T${pad(candidate.turnNumber)}`;
    const current = bestByTurn.get(key);
    if (!current || candidate.__score > current.__score) bestByTurn.set(key, candidate);
  }
  return [...bestByTurn.values()];
}

function numericTurn(value) {
  for (const key of ["turnNumber", "turn", "turnIndex", "sequence"]) {
    const number = Number(value[key]);
    if (Number.isInteger(number) && number >= 0 && number <= 100) return number;
  }
  const id = String(value.turnId || value.id || "");
  const match = id.match(/^(?:T|TURN[-_ ]?)(\d{1,3})$/iu);
  return match ? Number(match[1]) : null;
}

function scoreTurn(value) {
  return [
    hasPlayerAction(value),
    hasNarrative(value),
    hasCanonBinding(value),
    hasReviewStatus(value),
    hasOptions(value),
  ].filter(Boolean).length;
}

function hasPlayerAction(value) {
  return ["playerAction", "action", "selectedAction", "input", "actionText"]
    .some((key) => hasText(value[key]) || isObject(value[key]));
}

function hasNarrative(value) {
  return ["narrative", "story", "output", "renderedText", "playerVisibleText", "scene"]
    .some((key) => hasText(value[key]) || isObject(value[key]));
}

function hasCanonBinding(value) {
  return ["canonHash", "headHash", "canonRevision", "worldSequence", "committedEventId", "commitId", "stateHash"]
    .some((key) => hasText(value[key]) || Number.isFinite(value[key]));
}

function hasReviewStatus(value) {
  return ["reviewStatus", "reviewVerdict", "verdict", "validationStatus", "accepted"]
    .some((key) => hasText(value[key]) || typeof value[key] === "boolean");
}

function hasOptions(value) {
  return ["options", "nextOptions", "affordances"].some((key) => Array.isArray(value[key]));
}

function summarizeTurn(value) {
  return {
    turnId: value.turnNumber === 0 ? "G00" : `T${pad(value.turnNumber)}`,
    turnNumber: value.turnNumber,
    playerAction: firstText(value, ["playerAction", "actionText", "selectedAction", "action", "input"]),
    narrativePreview: firstText(value, ["narrative", "renderedText", "playerVisibleText", "story", "output"]).slice(0, 500),
    canonBinding: firstScalar(value, ["canonHash", "headHash", "canonRevision", "worldSequence", "committedEventId", "commitId", "stateHash"]),
    reviewStatus: firstScalar(value, ["reviewStatus", "reviewVerdict", "verdict", "validationStatus", "accepted"]),
    optionCount: firstArrayLength(value, ["options", "nextOptions", "affordances"]),
    source: value.__source,
    sourcePath: value.__path,
  };
}

function firstText(value, keys) {
  for (const key of keys) {
    if (hasText(value[key])) return String(value[key]);
    if (isObject(value[key])) return JSON.stringify(value[key]);
  }
  return "";
}

function firstScalar(value, keys) {
  for (const key of keys) {
    if (hasText(value[key]) || Number.isFinite(value[key]) || typeof value[key] === "boolean") return value[key];
  }
  return null;
}

function firstArrayLength(value, keys) {
  for (const key of keys) if (Array.isArray(value[key])) return value[key].length;
  return null;
}

function relativeEvidencePath(source) {
  if (!source.startsWith(evidenceRoot)) return source;
  return source.slice(evidenceRoot.length).replace(/^[/\\]/u, "");
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function unique(values) {
  return [...new Set(values)];
}
function pad(value) {
  return String(value).padStart(2, "0");
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
