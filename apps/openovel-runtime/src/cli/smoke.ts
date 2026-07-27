import path from "node:path";
import { fileURLToPath } from "node:url";
import { NoopMirror } from "../mirror.js";
import { OpenAICompatibleProvider } from "../provider.js";
import { runtimeRoot } from "../paths.js";
import { OpenNovelRuntime } from "../runtime.js";
import { StorykeeperDrain } from "../storykeeper.js";
import { FileStoryWorkspace } from "../workspace.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..", "..", "..");
const upstreamCommit = "1b4404e85d03d1e41e5d745e303372333b29c610";
const provider = OpenAICompatibleProvider.fromEnv();
const workspace = new FileStoryWorkspace(runtimeRoot(), projectRoot, upstreamCommit);
const storykeeper = process.argv.includes("--no-storykeeper")
  ? {
      kick: async () => {},
      isRunning: () => false,
    }
  : new StorykeeperDrain(workspace, provider);
const runtime = new OpenNovelRuntime(workspace, provider, storykeeper, new NoopMirror());

const turns = boundedArg("--turns", 1, 1, 20);
const runId = arg("--run-id") || `openovel_smoke_${Date.now()}`;
const waitForStorykeeper = !process.argv.includes("--no-storykeeper-wait");
const actionOverride = decodeActionArg();

await runtime.createRun({
  runId,
  worldId: "sangtian",
  roleId: "zhejiang_governor",
  storyPackageVersion: "2026-07-21.v3",
  openingVersion: "fixed_story_opening_v1",
});

process.stdout.write(`RUN ${runId}\n`);
for (let index = 0; index < turns; index += 1) {
  const current = await runtime.getRun(runId);
  const action = index === 0 && actionOverride
    ? actionOverride
    : index === 0
      ? "暂不签发放行文书，留下巡抚书吏，同时核对密信中指出的县册疑点。"
      : current.options[0]?.label
        || "先顺着眼前局势追问一层，不作尚无证据支撑的结论。";
  const selectedOption = current.options.find((option) => option.label === action) || null;
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
