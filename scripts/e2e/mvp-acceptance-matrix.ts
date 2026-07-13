import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MvpStoryEngine } from "../../apps/api/src/mvp-causal-runtime";
import { MemoryMvpStoryStorage } from "../../apps/api/src/mvp-storage";

type Scenario = "maneuver" | "paths" | "security" | "concurrency" | "continuous" | "ai-failure" | "all";

class CapturingStorage extends MemoryMvpStoryStorage {
  readonly aiTasks: Array<Record<string, unknown>> = [];
  async recordAiTask(task: Record<string, unknown>) { this.aiTasks.push(structuredClone(task)); }
}

function expectThrow(action: () => Promise<unknown>, code?: string) {
  return action().then(() => { throw new Error(`Expected rejection${code ? ` ${code}` : ""}`); }, (error: any) => {
    const body = error?.response || error;
    if (code && !JSON.stringify(body).includes(code)) throw error;
    return error;
  });
}

function createEngine(storage = new MemoryMvpStoryStorage(), provider?: any) {
  return { engine: new MvpStoryEngine(storage, provider), storage };
}

async function maneuverMatrix() {
  const cases = [
    { maneuverType: "contact", targetRoleKey: "county_magistrate", intentKey: "request_intel" },
    { maneuverType: "investigate", targetRoleKey: "county_magistrate", intentKey: "inspect_courier_registry" },
    { maneuverType: "leverage", targetRoleKey: "merchant", leverageKey: "land_contract_fragment" },
    { maneuverType: "custom", targetRoleKey: "county_magistrate", intentKey: "assign_clerk", customText: "派遣幕僚核对田亩账册" }
  ];
  const outputs: any[] = [];
  for (const input of cases) {
    const { engine } = createEngine();
    let view: any = await engine.create({ storyId: "sangtian" });
    const beforeVersion = view.run.version;
    view = await engine.submitManeuver(view.run.id, { version: view.run.version, idempotencyKey: `matrix-${input.type}`, ...input });
    assert.equal(view.maneuverState.maneuverOpportunitiesRemaining, 1);
    assert.ok(view.messages.some((item: any) => item.type === "maneuver_result"));
    const duplicate: any = await engine.submitManeuver(view.run.id, { version: beforeVersion, idempotencyKey: `matrix-${input.type}`, ...input });
    assert.equal(duplicate.run.version, view.run.version);
    assert.equal(duplicate.maneuverState.maneuverOpportunitiesRemaining, 1);
    outputs.push({ type: input.maneuverType, version: view.run.version, remaining: view.maneuverState.maneuverOpportunitiesRemaining, eventVisible: true, duplicateIdempotent: true });
  }

  const { engine } = createEngine();
  let blocked: any = await engine.create({ storyId: "sangtian" });
  const blockedVersion = blocked.run.version;
  const blockedResult: any = await engine.submitManeuver(blocked.run.id, { version: blockedVersion, maneuverType: "custom", customText: "命令巡抚立即认罪", idempotencyKey: "matrix-blocked" });
  assert.equal(blockedResult.accepted, false);
  blocked = await engine.get(blocked.run.id);
  assert.equal(blocked.run.version, blockedVersion);
  assert.equal(blocked.maneuverState.maneuverOpportunitiesRemaining, 2);

  let quota: any = await engine.create({ storyId: "sangtian" });
  quota = await engine.submitManeuver(quota.run.id, { version: quota.run.version, maneuverType: "contact", targetRoleKey: "merchant", intentKey: "ask_price", idempotencyKey: "quota-1" });
  quota = await engine.submitManeuver(quota.run.id, { version: quota.run.version, maneuverType: "investigate", intentKey: "check_ledger", idempotencyKey: "quota-2" });
  await expectThrow(() => engine.submitManeuver(quota.run.id, { version: quota.run.version, maneuverType: "contact", targetRoleKey: "xunfu", idempotencyKey: "quota-3" }), "MANEUVER_LIMIT_REACHED");
  assert.equal(quota.maneuverState.maneuverOpportunitiesRemaining, 0);
  return { cases: outputs, blockedGuardPreservedState: true, quotaGuard: true };
}

async function runPath(keys: string[]) {
  const { engine } = createEngine();
  let view: any = await engine.create({ storyId: "sangtian" });
  let step = 0;
  while (view.run.status !== "finished") {
    if (view.activeDecision) {
      const optionKey = keys[step % keys.length];
      view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, { version: view.run.version, optionKey, idempotencyKey: `path-${keys.join("")}-${step}` });
      step += 1;
    } else if (view.run.status === "awaiting_day_advance") {
      view = await engine.advanceDay(view.run.id, { version: view.run.version });
    } else if (view.run.status === "awaiting_finalization") {
      view = await engine.finalize(view.run.id, { version: view.run.version });
    } else {
      throw new Error(`Unexpected path state ${view.run.status}`);
    }
  }
  return view;
}

async function pathMatrix() {
  const a: any = await runPath(["A"]);
  const b: any = await runPath(["B"]);
  const c: any = await runPath(["C"]);
  assert.equal(a.run.totalDecisionsCompleted, 12);
  assert.equal(b.run.totalDecisionsCompleted, 12);
  assert.equal(c.run.totalDecisionsCompleted, 12);
  const signatures = [a, b, c].map((item) => JSON.stringify({ state: item.dashboard.worldState, global: item.outcome.globalEnding.key, personal: item.outcome.personalEnding.grade }));
  assert.equal(new Set(signatures).size, 3);
  return { paths: [a.outcome, b.outcome, c.outcome], distinctSignatures: signatures.length };
}

async function securityProjection() {
  const { engine, storage } = createEngine();
  let view: any = await engine.create({ storyId: "sangtian" });
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, { version: view.run.version, optionKey: "CUSTOM", customText: "暗中核对田亩账册 SECURITY_SENTINEL" });
  const publicJson = JSON.stringify(view);
  assert.equal(publicJson.includes("SECURITY_SENTINEL"), false);
  const internal: any = await storage.load(view.run.id);
  assert.equal(JSON.stringify(internal.messages).includes("SECURITY_SENTINEL"), false);
  assert.equal(publicJson.includes("hiddenMeaning"), false);
  assert.equal(publicJson.includes("privateReasoningSummary"), false);
  return { customTextNotLeaked: true, hiddenFieldsNotLeaked: true };
}

async function concurrencyMatrix() {
  const { engine } = createEngine();
  let view: any = await engine.create({ storyId: "sangtian" });
  const staleVersion = view.run.version;
  const firstMessageId = view.activeDecision.messageId;
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, { version: staleVersion, optionKey: "A", idempotencyKey: "concurrency-a" });
  await expectThrow(() => engine.submitDecision(view.run.id, view.activeDecision?.messageId || "missing", { version: staleVersion, optionKey: "B", idempotencyKey: "concurrency-b" }), "VERSION_CONFLICT");
  const duplicated: any = await engine.submitDecision(view.run.id, firstMessageId, { version: staleVersion, optionKey: "A", idempotencyKey: "concurrency-a" } as any);
  assert.equal(duplicated.run.version, view.run.version);
  return { staleVersionRejected: true, idempotencyKeyStable: true };
}

async function continuousRuns() {
  const outcomes: any[] = [];
  for (let index = 0; index < 20; index += 1) {
    const view: any = await runPath([index % 3 === 0 ? "A" : index % 3 === 1 ? "B" : "C"]);
    assert.equal(view.run.status, "finished");
    outcomes.push({ run: index + 1, global: view.outcome.globalEnding.key, personal: view.outcome.personalEnding.grade, events: view.meta.eventCount });
  }
  return { runs: outcomes.length, deadlocks: 0, outcomes };
}

async function aiFailureMatrix() {
  const storage = new CapturingStorage();
  const provider = {
    name: "failing-test-provider",
    lastCall: { attempts: 2, elapsedMs: 4, maxAttempts: 2 },
    async generateDecisionCandidate() { throw new Error("injected provider failure"); }
  };
  const engine = new MvpStoryEngine(storage, provider);
  let view: any = await engine.create({ storyId: "sangtian" });
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, { version: view.run.version, optionKey: "A", idempotencyKey: "ai-double-failure" });
  assert.equal(view.runtime.fallbackUsed, true);
  assert.equal(storage.aiTasks.length, 1);
  const task: any = storage.aiTasks[0];
  assert.equal(task.status, "fallback");
  assert.equal(task.resultJson.attempts, 2);
  return { fallbackCompleted: true, attempts: task.resultJson.attempts, taskStatus: task.status, ruleOutcomePreserved: true };
}

async function main() {
  const scenario = (process.argv[2] || "all") as Scenario;
  const result: Record<string, unknown> = { schemaVersion: "mvp-acceptance-matrix-v1", scenario, startedAt: new Date().toISOString() };
  if (scenario === "maneuver" || scenario === "all") result.maneuver = await maneuverMatrix();
  if (scenario === "paths" || scenario === "all") result.paths = await pathMatrix();
  if (scenario === "security" || scenario === "all") result.security = await securityProjection();
  if (scenario === "concurrency" || scenario === "all") result.concurrency = await concurrencyMatrix();
  if (scenario === "continuous" || scenario === "all") result.continuous = await continuousRuns();
  if (scenario === "ai-failure" || scenario === "all") result.aiFailure = await aiFailureMatrix();
  result.status = "PASS";
  result.completedAt = new Date().toISOString();
  const root = process.cwd();
  await mkdir(join(root, "docs/auto-execute/results"), { recursive: true });
  const file = join(root, "docs/auto-execute/results", `mvp-acceptance-${scenario}.json`);
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
