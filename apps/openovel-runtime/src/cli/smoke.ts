import path from "node:path";
import { fileURLToPath } from "node:url";
import { NoopMirror } from "../mirror.js";
import { OpenAICompatibleProvider } from "../provider.js";
import { runtimeRoot } from "../paths.js";
import { OpenNovelRuntime } from "../runtime.js";
import { scenePipelineModulesFromEnv } from "../scene-pipeline.js";
import { StorykeeperDrain } from "../storykeeper.js";
import { sangtianDecisionAdapter } from "../sangtian-decisions.js";
import { sangtianWorkspaceSeeder } from "../sangtian-workspace.js";
import { FileStoryWorkspace } from "../workspace.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..", "..", "..");
const upstreamCommit = "1b4404e85d03d1e41e5d745e303372333b29c610";
const provider = OpenAICompatibleProvider.fromEnv();
const workspace = new FileStoryWorkspace(
  runtimeRoot(),
  projectRoot,
  upstreamCommit,
  sangtianWorkspaceSeeder,
);
const storykeeper = process.argv.includes("--no-storykeeper")
  ? {
      kick: async () => {},
      isRunning: () => false,
    }
  : new StorykeeperDrain(workspace, provider);
const runtime = new OpenNovelRuntime(
  workspace,
  provider,
  storykeeper,
  new NoopMirror(),
  {
    decisionMode: "AUTHORED_WHEN_AVAILABLE",
    authoredDecisionAdapter: sangtianDecisionAdapter,
    scenePipelineModules: scenePipelineModulesFromEnv(provider),
  },
);

const turns = boundedArg("--turns", 1, 1, 20);
const runId = arg("--run-id") || `openovel_smoke_${Date.now()}`;
const waitForStorykeeper = !process.argv.includes("--no-storykeeper-wait");
const actionOverride = decodeActionArg();
const optionIdOverride = arg("--option-id");
const choiceSequence = parseChoiceSequence(arg("--choice-sequence"));
const drainOnly = process.argv.includes("--drain-only");
if (drainOnly && process.argv.includes("--no-storykeeper")) {
  throw new Error("--drain-only cannot be combined with --no-storykeeper");
}

await runtime.createRun({
  runId,
  worldId: "sangtian",
  roleId: "zhejiang_governor",
  storyPackageVersion: "2026-07-21.v3",
  openingVersion: "fixed_story_opening_v1",
});

process.stdout.write(`RUN ${runId}\n`);
if (drainOnly) {
  await storykeeper.kick(runId);
  const inbox = await workspace.inbox(runId);
  process.stdout.write(
    `STORYKEEPER processed=${inbox.state.processed.length} pending=${
      inbox.items.filter((item) => !inbox.state.processed.includes(item.id)).length
    }\n`,
  );
  process.stdout.write(`\nWORKSPACE ${workspace.paths(runId).root}\n`);
  process.exit(0);
}

for (let index = 0; index < turns; index += 1) {
  const current = await runtime.getRun(runId);
  const choiceIndex = choiceSequence[index] ?? 0;
  const sequenceOption = current.options[choiceIndex];
  if (choiceSequence[index] !== undefined && !sequenceOption) {
    throw new Error(
      `SMOKE_CHOICE_INDEX_NOT_FOUND:T${String(current.turnNumber + 1).padStart(2, "0")}:${choiceIndex}`,
    );
  }
  const optionOverride = index === 0 && optionIdOverride
    ? current.options.find((option) => option.id === optionIdOverride)
    : undefined;
  if (index === 0 && optionIdOverride && !optionOverride) {
    throw new Error(`SMOKE_OPTION_ID_NOT_FOUND:${optionIdOverride}`);
  }
  const action = optionOverride
    ? optionOverride.label
    : index === 0 && actionOverride
      ? actionOverride
      : sequenceOption?.label
        || "先顺着眼前局势追问一层，不作尚无证据支撑的结论。";
  const selectedOption = optionOverride
    || current.options.find((option) => option.label === action)
    || null;
  process.stdout.write(`\nACTION T${String(current.turnNumber + 1).padStart(2, "0")}: ${action}\n`);
  const result = await runtime.processAction({
    runId,
    action,
    boundOption: selectedOption
      ? { id: selectedOption.id, label: selectedOption.label }
      : null,
  });
  process.stdout.write(`\nNARRATION ${result.turnId}\n${result.narration}\n`);
  process.stdout.write(`\nOPTIONS ${result.turnId}\n`);
  if (result.options.length) {
    result.options.forEach((option, optionIndex) => {
      process.stdout.write(`${optionIndex + 1}. ${option.label}\n`);
    });
  } else {
    process.stdout.write("(free-text only)\n");
  }
  if (result.warnings.length) {
    process.stdout.write(`WARNINGS: ${result.warnings.map((warning) => warning.code).join(", ")}\n`);
  }
  if (waitForStorykeeper) await storykeeper.kick(runId);
}

process.stdout.write(`\nWORKSPACE ${workspace.paths(runId).root}\n`);

function arg(name: string) {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

function boundedArg(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(arg(name));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

function decodeActionArg() {
  const encoded = arg("--action-base64");
  if (!encoded) return arg("--action");
  const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
  if (!decoded) throw new Error("--action-base64 did not contain a UTF-8 action");
  return decoded;
}

function parseChoiceSequence(value: string) {
  if (!value.trim()) return [];
  return value.split(",").map((item, index) => {
    const parsed = Number(item.trim());
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`SMOKE_CHOICE_SEQUENCE_INVALID:${index}:${item}`);
    }
    return parsed;
  });
}
