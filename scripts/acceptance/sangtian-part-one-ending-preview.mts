import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenNovelRuntime } from "../../apps/openovel-runtime/src/runtime.js";
import { FileStoryWorkspace } from "../../apps/openovel-runtime/src/workspace.js";
import { OpenAICompatibleProvider } from "../../apps/openovel-runtime/src/provider.js";
import { scenePipelineModulesFromEnv } from "../../apps/openovel-runtime/src/scene-pipeline.js";
import { sangtianDecisionAdapter } from "../../apps/openovel-runtime/src/sangtian-decisions.js";
import { sangtianWorkspaceSeeder } from "../../apps/openovel-runtime/src/sangtian-workspace.js";
import { sangtianEndingModule } from "../../apps/openovel-runtime/src/sangtian-ending.js";
import { NoopMirror } from "../../apps/openovel-runtime/src/mirror.js";
import type {
  OpenNovelOption,
  OpenNovelProvider,
  ProviderRequest,
  ProviderResult,
} from "../../apps/openovel-runtime/src/types.js";

async function main() {
const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const runId = argument("--run-id") || `sangtian_ending_preview_${Date.now()}`;
const routeProfile = endingRouteProfile(argument("--route") || "protective");
const workspaceRoot = path.resolve(
  argument("--workspace-root")
    || path.join(os.tmpdir(), "omw-sangtian-ending-preview", runId),
);
const realTurnsArgument = argument("--real-turns") || "1,2,20";
const realTurns = new Set(
  (realTurnsArgument.toLowerCase() === "none" ? "" : realTurnsArgument)
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 20),
);
if (realTurns.size > 0 && !realTurns.has(20)) {
  throw new Error("ENDING_PREVIEW_FINAL_TURN_MUST_BE_REAL");
}

const providerEnv = {
  ...process.env,
  OPENOVEL_PROVIDER_BASE_URL: "https://api.deepseek.com",
  OPENOVEL_API_KEY: String(
    process.env.DEEPSEEK_API_KEY || process.env.SOLO_STORY_API_KEY || "",
  ).trim(),
  OPENOVEL_MODEL: String(process.env.DEEPSEEK_MODEL || "deepseek-v4-pro").trim(),
  OPENOVEL_NARRATOR_MODEL: String(process.env.DEEPSEEK_MODEL || "deepseek-v4-pro").trim(),
  OPENOVEL_REVIEWER_MODEL: String(process.env.DEEPSEEK_MODEL || "deepseek-v4-pro").trim(),
  OPENOVEL_OPTIONS_MODEL: String(process.env.DEEPSEEK_MODEL || "deepseek-v4-pro").trim(),
};
const realProvider = OpenAICompatibleProvider.fromEnv(providerEnv);
if (realTurns.size > 0 && !realProvider.describe().configured) {
  throw new Error("ENDING_PREVIEW_DEEPSEEK_KEY_MISSING");
}
const provider = new TurnSelectiveProvider(
  realTurns.size > 0 ? realProvider : null,
  realTurns,
);
await mkdir(workspaceRoot, { recursive: true });
const workspace = new FileStoryWorkspace(
  workspaceRoot,
  projectRoot,
  "ending-preview",
  sangtianWorkspaceSeeder,
);
const runtime = new OpenNovelRuntime(
  workspace,
  provider,
  { kick: async () => {} },
  new NoopMirror(),
  {
    decisionMode: "AUTHORED_WHEN_AVAILABLE",
    authoredDecisionAdapter: sangtianDecisionAdapter,
    endingModule: sangtianEndingModule,
    scenePipelineModules: scenePipelineModulesFromEnv(provider),
  },
);

await runtime.createRun({
  runId,
  worldId: "sangtian",
  roleId: "zhejiang_governor",
  storyPackageVersion: "2026-08-05.ending-preview",
  openingVersion: "fixed_story_opening_v1",
});

const route: Array<{
  turn: number;
  optionId: string;
  action: string;
  generationMode: "REAL_MODEL" | "DETERMINISTIC_FAST_FORWARD";
}> = [];
const visibleTurns: Array<{
  turn: number;
  action: string;
  narration: string;
  options: string[];
  narrativeOwner: string;
}> = [];

for (let turn = 1; turn <= 20; turn += 1) {
  const current = await runtime.getRun(runId);
  const selected = choosePolicyOption(current.options, turn, routeProfile);
  provider.activeTurn = turn;
  const result = await runtime.processAction({
    runId,
    action: selected.label,
    submissionId: `${runId}:T${String(turn).padStart(2, "0")}`,
    boundOption: { id: selected.id, label: selected.label },
  });
  route.push({
    turn,
    optionId: selected.id,
    action: selected.label,
    generationMode: realTurns.has(turn) ? "REAL_MODEL" : "DETERMINISTIC_FAST_FORWARD",
  });
  if (realTurns.has(turn)) {
    const head = await readJson<Record<string, unknown>>(
      path.join(workspace.paths(runId).headsDir, "current.json"),
    ).catch(() => ({}));
    visibleTurns.push({
      turn,
      action: selected.label,
      narration: result.narration,
      options: result.options.map((option) => option.label),
      narrativeOwner: String(head.narrativeOwner || result.narrator.model || "UNKNOWN"),
    });
  }
}

const publicRun = await workspace.readPublicRun(runId);
const finalState = await readJson<Record<string, unknown>>(workspace.paths(runId).partOneState);
assert.equal(finalState.turnNumber, 20, "ending preview must settle exactly twenty turns");
assert.equal(
  finalState.partCompletionStatus,
  "HANDOFF_READY",
  "ending preview must reach the authored Part One handoff",
);
assert.equal(publicRun.status, "COMPLETED", "the final public run must be complete");
assert.deepEqual(publicRun.options, [], "a completed part must not expose another decision");
assert.ok(publicRun.ending, "a completed part must expose an ending");
assert.equal(publicRun.ending?.sourceTurnId, "T20", "ending must be bound to the final turn");
assert.ok(String(publicRun.ending?.title || "").trim(), "ending title is required");
assert.ok(
  String(publicRun.ending?.protagonistFate || "").trim().length >= 40,
  "ending must state the protagonist's fate",
);
assert.ok(
  Array.isArray(publicRun.ending?.aftermath) && publicRun.ending.aftermath.length >= 2,
  "ending must expose at least two world aftermaths",
);
assert.doesNotMatch(
  [
    publicRun.ending?.finalSceneNarrative,
    publicRun.ending?.protagonistFate,
    ...(publicRun.ending?.aftermath || []),
  ].join("\n"),
  /entityId|allowedPredicates|requiredVisiblePredicates|narrativeSeed|reviewer confidence|内部状态路径/iu,
  "ending must not leak runtime protocol fields",
);
const output = {
  schemaVersion: "sangtian-ending-preview-v1",
  testOnly: true,
  normalProductFlowChanged: false,
  previewMode: realTurns.size > 0 ? "REAL_PREFIX_AND_ENDING" : "STRUCTURAL_ONLY",
  runId,
  routeProfile,
  workspace: workspace.paths(runId).root,
  provider: provider.describe(),
  realTurns: [...realTurns].sort((left, right) => left - right),
  skippedNarrativeTurns: route.filter((item) => (
    item.generationMode === "DETERMINISTIC_FAST_FORWARD"
  )).map((item) => item.turn),
  route,
  visibleTurns,
  ending: publicRun.ending,
  acceptance: {
    exactFinalTurn: true,
    authoritativeHandoffReady: true,
    completedRunHasNoFurtherOptions: true,
    endingBoundToT20: true,
    protagonistFatePresent: true,
    directAftermathPresent: true,
    protocolFieldsHidden: true,
  },
  finalState: {
    turnNumber: finalState.turnNumber,
    partCompletionStatus: finalState.partCompletionStatus,
    sectionId: finalState.sectionId,
    evidence: finalState.evidence,
    grain: finalState.grain,
    land: finalState.land,
    merchant: finalState.merchant,
    report: finalState.report,
    responsibility: finalState.responsibility,
  },
  modelCalls: provider.calls,
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

type EndingRouteProfile = "protective" | "grain-first";

function endingRouteProfile(value: string): EndingRouteProfile {
  if (value === "protective" || value === "grain-first") return value;
  throw new Error(`ENDING_PREVIEW_ROUTE_UNKNOWN:${value}`);
}

function choosePolicyOption(
  options: OpenNovelOption[],
  turn: number,
  routeProfile: EndingRouteProfile,
) {
  if (!options.length) throw new Error(`ENDING_PREVIEW_OPTIONS_MISSING:T${turn}`);
  const sharedOpening = [
    "opening_d2",
    "DK-P1-EXECUTION-SCOPE-OPT-01",
    "DK-P1-RESPONSIBILITY-RECORD-OPT-01",
    "DK-P1-REVIEW-AUTHORITY-OPT-01",
    "DK-P1-EVIDENCE-CUSTODY-OPT-01",
    "DK-P1-WITNESS-ACCESS-OPT-01",
    "DK-P1-DISCLOSURE-SCOPE-OPT-01",
    "DK-P1-GRAIN-SOURCE-OPT-03",
    "DK-P1-MERCHANT-CONDITIONS-OPT-01",
  ];
  const protectiveEnding = [
    "DK-P1-LAND-SAFEGUARD-OPT-02",
    "DK-P1-RELIEF-PRIORITY-OPT-01",
    "CD-P1-S3-RELIEF-RECEIPTS-OPT-01",
    "DK-P1-REPORT-AUTHORSHIP-OPT-01",
    "DK-P1-EVIDENCE-ATTACHMENT-OPT-01",
    "DK-P1-RESPONSIBILITY-SCOPE-OPT-01",
    "DK-P1-CAPITAL-CHANNEL-OPT-03",
    "CD-P1-S4-XUNFU-COPY-REQUEST-OPT-01",
    "CD-P1-S4-MERCHANT-DAILY-TERMS-OPT-01",
    "CD-P1-S4-WITNESS-PROTECTION-ORDER-OPT-01",
    "CD-P1-S4-WAITING-FOR-CAPITAL-OPT-01",
  ];
  const grainFirstEnding = [
    "DK-P1-LAND-SAFEGUARD-OPT-03",
    "DK-P1-RELIEF-PRIORITY-OPT-03",
    "CD-P1-S3-RELIEF-RECEIPTS-OPT-01",
    "DK-P1-REPORT-AUTHORSHIP-OPT-03",
    "DK-P1-EVIDENCE-ATTACHMENT-OPT-02",
    "DK-P1-RESPONSIBILITY-SCOPE-OPT-02",
    "DK-P1-CAPITAL-CHANNEL-OPT-01",
    "CD-P1-S4-XUNFU-COPY-REQUEST-OPT-02",
    "CD-P1-S4-MERCHANT-DAILY-TERMS-OPT-01",
    "CD-P1-S4-WITNESS-PROTECTION-ORDER-OPT-02",
    "CD-P1-S4-WAITING-FOR-CAPITAL-OPT-02",
  ];
  const preferredIds = [
    ...sharedOpening,
    ...(routeProfile === "protective" ? protectiveEnding : grainFirstEnding),
  ];
  return preferredIds
    .map((id) => options.find((option) => option.id === id))
    .find((option): option is OpenNovelOption => Boolean(option))
    || options[0]!;
}

function argument(name: string) {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

class TurnSelectiveProvider implements OpenNovelProvider {
  activeTurn = 0;
  readonly calls: Array<{
    turn: number;
    profile: ProviderRequest["profile"];
    mode: "REAL_MODEL" | "SKIPPED";
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
  }> = [];

  constructor(
    private readonly realProvider: OpenNovelProvider | null,
    private readonly realTurns: Set<number>,
  ) {}

  describe() {
    return this.realProvider?.describe() || {
      provider: "ending-preview-structural",
      model: "no-model",
      configured: true,
    };
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    if (!this.realTurns.has(this.activeTurn)) {
      this.calls.push({ turn: this.activeTurn, profile: request.profile, mode: "SKIPPED" });
      throw new Error(`ENDING_PREVIEW_MODEL_SKIPPED:T${this.activeTurn}`);
    }
    if (!this.realProvider) {
      throw new Error("ENDING_PREVIEW_REAL_PROVIDER_MISSING");
    }
    const result = await this.realProvider.generate(request);
    this.calls.push({
      turn: this.activeTurn,
      profile: request.profile,
      mode: "REAL_MODEL",
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
    });
    return result;
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
