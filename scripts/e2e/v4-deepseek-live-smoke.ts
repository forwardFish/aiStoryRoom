import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MvpStoryEngine } from "../../apps/api/src/mvp-causal-runtime";
import { MemoryMvpStoryStorage } from "../../apps/api/src/mvp-storage";
import { createConfiguredMvpNarrativeProvider } from "../../apps/api/src/mvp-narrative-provider";

async function main() {
  if (!String(process.env.DEEPSEEK_API_KEY || "").trim()) throw new Error("DEEPSEEK_API_KEY is not available to the live smoke process");
  process.env.AI_CAUSAL_PROVIDER = "deepseek";
  const provider = createConfiguredMvpNarrativeProvider();
  if (!provider) throw new Error("DeepSeek provider was not configured");
  const storage = new MemoryMvpStoryStorage() as MemoryMvpStoryStorage & { aiTasks?: unknown[] };
  const aiTasks: unknown[] = [];
  (storage as any).recordAiTask = async (task: unknown) => aiTasks.push(structuredClone(task));
  const engine = new MvpStoryEngine(storage, provider);
  let view: any = await engine.create({ storyId: "sangtian" });
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
    version: view.run.version,
    optionKey: "A",
    idempotencyKey: "deepseek-live-v4-1"
  });
  assert.equal(view.runtime.fallbackUsed, false);
  assert.match(view.runtime.narrativeProvider, /^deepseek:/);
  assert.equal(aiTasks.length, 1);
  const task: any = aiTasks[0];
  assert.equal(task.status, "completed");
  assert.match(task.provider, /^deepseek:/);
  assert.equal(task.resultJson.fallbackUsed, false);
  const result = {
    schemaVersion: "deepseek-live-v4-v1",
    status: "PASS",
    provider: task.provider,
    taskStatus: task.status,
    attempts: task.resultJson.attempts,
    elapsedMs: task.resultJson.elapsedMs,
    fallbackUsed: task.resultJson.fallbackUsed,
    ruleStateAuthoritative: true,
    completedAt: new Date().toISOString()
  };
  await mkdir(join(process.cwd(), "docs/auto-execute/results"), { recursive: true });
  await writeFile(join(process.cwd(), "docs/auto-execute/results/deepseek-live-v4.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
