import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MvpStoryEngine } from "../../apps/api/src/mvp-causal-runtime";
import { MemoryMvpStoryStorage } from "../../apps/api/src/mvp-storage";
import { installFourManeuverRuntime } from "../../apps/api/src/mvp-four-maneuver-runtime";
import { installFourManeuverResolution } from "../../apps/api/src/mvp-four-maneuver-resolution";

installFourManeuverRuntime();
installFourManeuverResolution();

type Scenario = "maneuver" | "paths" | "security" | "concurrency" | "continuous" | "ai-failure" | "all";

class CapturingStorage extends MemoryMvpStoryStorage {
  readonly aiTasks: Array<Record<string, unknown>> = [];
  async recordAiTask(task: Record<string, unknown>) {
    this.aiTasks.push(structuredClone(task));
  }
}

class SlowMemoryStorage extends MemoryMvpStoryStorage {
  async save(view: any, expectedVersion: number) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return super.save(view, expectedVersion);
  }
}

function errorCode(error: any) {
  const response = error?.response;
  if (response && typeof response === "object") return String(response.code || response.message?.code || "");
  return String(error?.code || "");
}

function expectThrow(action: () => Promise<unknown>, code?: string) {
  return action().then(
    () => { throw new Error(`Expected rejection${code ? ` ${code}` : ""}`); },
    (error: any) => {
      if (code && errorCode(error) !== code && !JSON.stringify(error?.response || error).includes(code)) throw error;
      return error;
    }
  );
}

function createEngine(storage = new MemoryMvpStoryStorage(), provider?: any) {
  return { engine: new MvpStoryEngine(storage, provider), storage };
}

async function advanceToScene(engine: any, view: any, sceneKey: string, prefix: string) {
  let step = 0;
  while (view.activeDecision?.decisionKey !== sceneKey) {
    step += 1;
    if (step > 30) throw new Error(`Unable to reach scene ${sceneKey}`);
    if (view.activeDecision) {
      view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
        version: view.run.version,
        optionKey: "A",
        idempotencyKey: `${prefix}-decision-${step}`
      });
    } else if (view.run.status === "awaiting_day_advance") {
      view = await engine.advanceDay(view.run.id, { version: view.run.version });
    } else {
      throw new Error(`Unexpected path state ${view.run.status}`);
    }
  }
  return view;
}

async function maneuverMatrix() {
  const cases: Array<{ sceneKey: string; input: Record<string, unknown> }> = [
    {
      sceneKey: "d1_1",
      input: {
        maneuverType: "contact",
        targetRoleKey: "county_magistrate",
        messageText: "原始名册为何早于诏令形成？"
      }
    },
    {
      sceneKey: "d1_1",
      input: {
        maneuverType: "investigate",
        intentKey: "inspect_first_register_timing"
      }
    },
    {
      sceneKey: "d1_2",
      input: {
        maneuverType: "leverage",
        leverageKey: "xunfu_merchant_old_pact_rumor",
        targetRoleKey: "merchant"
      }
    },
    {
      sceneKey: "d1_1",
      input: {
        maneuverType: "custom",
        customText: "派遣幕僚核对田亩账册。"
      }
    }
  ];

  const outputs: any[] = [];
  for (const item of cases) {
    const { engine } = createEngine();
    let view: any = await engine.create({ storyId: "sangtian" });
    const type = String(item.input.maneuverType);
    view = await advanceToScene(engine, view, item.sceneKey, `matrix-${type}`);
    const beforeVersion = view.run.version;
    const command = {
      version: beforeVersion,
      idempotencyKey: `matrix-${type}`,
      ...item.input
    };
    view = await engine.submitManeuver(view.run.id, command);
    assert.equal(view.maneuverState.maneuverOpportunitiesRemaining, 1);
    assert.ok(view.messages.some((entry: any) => entry.type === "maneuver_result"));
    const duplicate: any = await engine.submitManeuver(view.run.id, command);
    assert.equal(duplicate.run.version, view.run.version);
    assert.equal(duplicate.maneuverState.maneuverOpportunitiesRemaining, 1);
    outputs.push({
      type,
      sceneKey: item.sceneKey,
      version: view.run.version,
      remaining: view.maneuverState.maneuverOpportunitiesRemaining,
      eventVisible: true,
      duplicateIdempotent: true
    });
  }

  const { engine } = createEngine();
  let blocked: any = await engine.create({ storyId: "sangtian" });
  const blockedVersion = blocked.run.version;
  const blockedResult: any = await engine.submitManeuver(blocked.run.id, {
    version: blockedVersion,
    maneuverType: "custom",
    customText: "命令巡抚立即认罪",
    idempotencyKey: "matrix-blocked"
  });
  assert.equal(blockedResult.accepted, false);
  blocked = await engine.get(blocked.run.id);
  assert.equal(blocked.run.version, blockedVersion);
  assert.equal(blocked.maneuverState.maneuverOpportunitiesRemaining, 2);

  let quota: any = await engine.create({ storyId: "sangtian" });
  quota = await engine.submitManeuver(quota.run.id, {
    version: quota.run.version,
    maneuverType: "contact",
    targetRoleKey: "county_magistrate",
    messageText: "县衙是否提前收到催报？",
    idempotencyKey: "quota-contact"
  });
  await expectThrow(() => engine.submitManeuver(quota.run.id, {
    version: quota.run.version,
    maneuverType: "contact",
    targetRoleKey: "xunfu",
    messageText: "巡抚府是否提前准备名册？",
    idempotencyKey: "quota-contact-again"
  }), "MANEUVER_TYPE_ALREADY_USED");
  quota = await engine.submitManeuver(quota.run.id, {
    version: quota.run.version,
    maneuverType: "investigate",
    intentKey: "inspect_first_register_timing",
    idempotencyKey: "quota-investigate"
  });
  await expectThrow(() => engine.submitManeuver(quota.run.id, {
    version: quota.run.version,
    maneuverType: "custom",
    customText: "派人再核对书吏签押。",
    idempotencyKey: "quota-third"
  }), "MANEUVER_LIMIT_REACHED");
  assert.equal(quota.maneuverState.maneuverOpportunitiesRemaining, 0);

  return {
    cases: outputs,
    blockedGuardPreservedState: true,
    quotaGuard: true,
    perTypeGuard: true,
    directSubmissionWithoutPreview: true
  };
}

async function runPath(keys: string[]) {
  const { engine } = createEngine();
  let view: any = await engine.create({ storyId: "sangtian" });
  let step = 0;
  while (view.run.status !== "finished") {
    if (view.activeDecision) {
      const optionKey = keys[step % keys.length];
      view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
        version: view.run.version,
        optionKey,
        idempotencyKey: `path-${keys.join("")}-${step}`
      });
      step += 1;
    } else if (view.run.status === "awaiting_day_advance") {
      assert.equal(view.maneuverPanel.quota.remaining, 0);
      view = await engine.advanceDay(view.run.id, { version: view.run.version });
      if (view.run.currentDay <= 6) {
        assert.equal(view.maneuverPanel.quota.remaining, 2);
        assert.deepEqual(view.maneuverState.usedTypesToday, []);
      }
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
  assert.equal(a.maneuverState.totalManeuversUsed, 0);
  const signatures = [a, b, c].map((item) => JSON.stringify({
    state: item.dashboard.worldState,
    global: item.outcome.globalEnding.key,
    personal: item.outcome.personalEnding.grade
  }));
  assert.equal(new Set(signatures).size, 3);
  return {
    paths: [a.outcome, b.outcome, c.outcome],
    distinctSignatures: signatures.length,
    optionalInvestigationsSkipped: true,
    sevenDayFlowCompleted: true
  };
}

async function securityProjection() {
  const { engine, storage } = createEngine();
  let view: any = await engine.create({ storyId: "sangtian" });
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
    version: view.run.version,
    optionKey: "CUSTOM",
    customText: "暗中核对田亩账册 SECURITY_SENTINEL"
  });
  const publicJson = JSON.stringify(view);
  assert.equal(publicJson.includes("SECURITY_SENTINEL"), false);
  const internal: any = await storage.load(view.run.id);
  assert.equal(JSON.stringify(internal.messages).includes("SECURITY_SENTINEL"), false);
  assert.equal(publicJson.includes("hiddenMeaning"), false);
  assert.equal(publicJson.includes("privateReasoningSummary"), false);
  assert.equal(publicJson.includes("statePatch"), false);
  return {
    customTextNotLeaked: true,
    hiddenFieldsNotLeaked: true,
    maneuverRulePatchNotProjected: true
  };
}

async function concurrencyMatrix() {
  const { engine } = createEngine();
  let view: any = await engine.create({ storyId: "sangtian" });
  const staleVersion = view.run.version;
  const firstMessageId = view.activeDecision.messageId;
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
    version: staleVersion,
    optionKey: "A",
    idempotencyKey: "concurrency-decision-a"
  });
  await expectThrow(() => engine.submitDecision(view.run.id, view.activeDecision?.messageId || "missing", {
    version: staleVersion,
    optionKey: "B",
    idempotencyKey: "concurrency-decision-b"
  }), "VERSION_CONFLICT");
  const duplicated: any = await engine.submitDecision(view.run.id, firstMessageId, {
    version: staleVersion,
    optionKey: "A",
    idempotencyKey: "concurrency-decision-a"
  } as any);
  assert.equal(duplicated.run.version, view.run.version);

  const slowStorage = new SlowMemoryStorage();
  const maneuverEngine: any = new MvpStoryEngine(slowStorage);
  let maneuverView: any = await maneuverEngine.create({ storyId: "sangtian" });
  maneuverView = await maneuverEngine.submitManeuver(maneuverView.run.id, {
    version: maneuverView.run.version,
    maneuverType: "contact",
    targetRoleKey: "county_magistrate",
    messageText: "县衙是否提前收到催报？",
    idempotencyKey: "concurrency-contact"
  });
  const lastSlotVersion = maneuverView.run.version;
  const lastSlot = await Promise.allSettled([
    maneuverEngine.submitManeuver(maneuverView.run.id, {
      version: lastSlotVersion,
      maneuverType: "investigate",
      intentKey: "inspect_first_register_timing",
      idempotencyKey: "concurrency-last-investigate"
    }),
    maneuverEngine.submitManeuver(maneuverView.run.id, {
      version: lastSlotVersion,
      maneuverType: "custom",
      customText: "派幕僚核对巡抚府书吏签押。",
      idempotencyKey: "concurrency-last-custom"
    })
  ]);
  assert.equal(lastSlot.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(lastSlot.filter((item) => item.status === "rejected").length, 1);
  const afterLastSlot: any = await maneuverEngine.get(maneuverView.run.id);
  assert.equal(afterLastSlot.maneuverState.maneuverOpportunitiesRemaining, 0);
  assert.equal(afterLastSlot.maneuverState.maneuversUsedToday, 2);

  const chipStorage = new SlowMemoryStorage();
  const chipEngine: any = new MvpStoryEngine(chipStorage);
  let chipView: any = await chipEngine.create({ storyId: "sangtian" });
  chipView = await advanceToScene(chipEngine, chipView, "d1_2", "concurrency-chip");
  const chipVersion = chipView.run.version;
  const chipRace = await Promise.allSettled([
    chipEngine.submitManeuver(chipView.run.id, {
      version: chipVersion,
      maneuverType: "leverage",
      leverageKey: "xunfu_merchant_old_pact_rumor",
      targetRoleKey: "merchant",
      idempotencyKey: "concurrency-chip-a"
    }),
    chipEngine.submitManeuver(chipView.run.id, {
      version: chipVersion,
      maneuverType: "leverage",
      leverageKey: "xunfu_merchant_old_pact_rumor",
      targetRoleKey: "xunfu",
      idempotencyKey: "concurrency-chip-b"
    })
  ]);
  assert.equal(chipRace.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(chipRace.filter((item) => item.status === "rejected").length, 1);
  const afterChip: any = await chipEngine.get(chipView.run.id);
  assert.deepEqual(afterChip.maneuverState.usedLeverageKeys, ["xunfu_merchant_old_pact_rumor"]);
  assert.equal(afterChip.maneuverState.maneuversUsedToday, 1);

  return {
    staleVersionRejected: true,
    idempotencyKeyStable: true,
    lastOpportunitySingleWinner: true,
    oneUseLeverageSingleWinner: true
  };
}

async function continuousRuns() {
  const outcomes: any[] = [];
  for (let index = 0; index < 20; index += 1) {
    const view: any = await runPath([index % 3 === 0 ? "A" : index % 3 === 1 ? "B" : "C"]);
    assert.equal(view.run.status, "finished");
    outcomes.push({
      run: index + 1,
      global: view.outcome.globalEnding.key,
      personal: view.outcome.personalEnding.grade,
      events: view.meta.eventCount
    });
  }
  return { runs: outcomes.length, deadlocks: 0, outcomes };
}

async function aiFailureMatrix() {
  const decisionStorage = new CapturingStorage();
  const decisionProvider = {
    name: "failing-test-provider",
    lastCall: { attempts: 2, elapsedMs: 4, maxAttempts: 2 },
    async generateDecisionCandidate() {
      throw new Error("injected decision provider failure");
    }
  };
  const decisionEngine: any = new MvpStoryEngine(decisionStorage, decisionProvider);
  let decisionView: any = await decisionEngine.create({ storyId: "sangtian" });
  decisionView = await decisionEngine.submitDecision(decisionView.run.id, decisionView.activeDecision.messageId, {
    version: decisionView.run.version,
    optionKey: "A",
    idempotencyKey: "ai-decision-failure"
  });
  assert.equal(decisionView.runtime.fallbackUsed, true);
  assert.equal(decisionStorage.aiTasks.length, 1);
  const decisionTask: any = decisionStorage.aiTasks[0];
  assert.equal(decisionTask.status, "fallback");
  assert.equal(decisionTask.resultJson.attempts, 2);

  const maneuverStorage = new CapturingStorage();
  let maneuverCalls = 0;
  const maneuverProvider = {
    name: "failing-maneuver-provider",
    lastCall: { attempts: 2, elapsedMs: 4, maxAttempts: 2, inputTokens: 0, outputTokens: 0 },
    async generateDecisionCandidate() { return {}; },
    async generateManeuverCandidate() {
      maneuverCalls += 1;
      throw new Error("injected maneuver provider failure");
    }
  };
  const maneuverEngine: any = new MvpStoryEngine(maneuverStorage, maneuverProvider);
  let maneuverView: any = await maneuverEngine.create({ storyId: "sangtian" });
  maneuverView = await maneuverEngine.submitManeuver(maneuverView.run.id, {
    version: maneuverView.run.version,
    maneuverType: "contact",
    targetRoleKey: "county_magistrate",
    messageText: "原始名册是否完整？",
    idempotencyKey: "ai-maneuver-failure"
  });
  assert.equal(maneuverCalls, 1);
  assert.equal(maneuverView.runtime.fallbackUsed, true);
  assert.equal(maneuverStorage.aiTasks.length, 1);
  assert.equal((maneuverStorage.aiTasks[0] as any).status, "fallback");
  assert.equal(maneuverView.maneuverState.maneuverOpportunitiesRemaining, 1);

  return {
    fallbackCompleted: true,
    attempts: decisionTask.resultJson.attempts,
    taskStatus: decisionTask.status,
    ruleOutcomePreserved: true,
    maneuverLogicalCalls: maneuverCalls,
    maneuverFallbackCompleted: true
  };
}

async function main() {
  const scenario = (process.argv[2] || "all") as Scenario;
  const result: Record<string, unknown> = {
    schemaVersion: "mvp-acceptance-matrix-v2",
    scenario,
    startedAt: new Date().toISOString()
  };
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
