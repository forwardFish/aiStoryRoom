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
const workspaceRoot = path.resolve(
  argument("--workspace-root")
    || path.join(os.tmpdir(), "omw-sangtian-ending-preview", runId),
);
const realTurns = new Set(
  (argument("--real-turns") || "1,2,20")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 20),
);
if (!realTurns.has(20)) throw new Error("ENDING_PREVIEW_FINAL_TURN_MUST_BE_REAL");

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
if (!realProvider.describe().configured) {
  throw new Error("ENDING_PREVIEW_DEEPSEEK_KEY_MISSING");
}
const provider = new TurnSelectiveProvider(realProvider, realTurns);
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
  const selected = choosePolicyOption(current.options, turn);
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
const output = {
  schemaVersion: "sangtian-ending-preview-v1",
  testOnly: true,
  normalProductFlowChanged: false,
  runId,
  workspace: workspace.paths(runId).root,
  provider: realProvider.describe(),
  realTurns: [...realTurns].sort((left, right) => left - right),
  skippedNarrativeTurns: route.filter((item) => (
    item.generationMode === "DETERMINISTIC_FAST_FORWARD"
  )).map((item) => item.turn),
  route,
  visibleTurns,
  ending: publicRun.ending,
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

function choosePolicyOption(options: OpenNovelOption[], turn: number) {
  if (!options.length) throw new Error(`ENDING_PREVIEW_OPTIONS_MISSING:T${turn}`);
  const preferredIds = [
    "opening_d2",
    "DK-P1-EXECUTION-SCOPE-OPT-01",
    "DK-P1-RESPONSIBILITY-RECORD-OPT-01",
    "DK-P1-REVIEW-AUTHORITY-OPT-01",
    "DK-P1-EVIDENCE-CUSTODY-OPT-01",
    "DK-P1-WITNESS-ACCESS-OPT-01",
    "DK-P1-DISCLOSURE-SCOPE-OPT-01",
    "DK-P1-GRAIN-SOURCE-OPT-03",
    "DK-P1-MERCHANT-CONDITIONS-OPT-01",
    "DK-P1-LAND-SAFEGUARD-OPT-02",
    "DK-P1-RELIEF-PRIORITY-OPT-01",
    "CD-P1-S3-RELIEF-RECEIPTS-OPT-01",
    "DK-P1-REPORT-AUTHORSHIP-OPT-01",
    "DK-P1-EVIDENCE-ATTACHMENT-OPT-01",
    "DK-P1-RESPONSIBILITY-SCOPE-OPT-01",
    "DK-P1-CAPITAL-CHANNEL-OPT-03",
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
    private readonly realProvider: OpenNovelProvider,
    private readonly realTurns: Set<number>,
  ) {}

  describe() {
    return this.realProvider.describe();
  }

  async generate(request: ProviderRequest): Promise<ProviderResult> {
    if (!this.realTurns.has(this.activeTurn)) {
      this.calls.push({ turn: this.activeTurn, profile: request.profile, mode: "SKIPPED" });
      throw new Error(`ENDING_PREVIEW_MODEL_SKIPPED:T${this.activeTurn}`);
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
