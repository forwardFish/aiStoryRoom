import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MvpStoryEngine } from "./mvp-causal-runtime";
import { FileMvpStoryStorage, MemoryMvpStoryStorage } from "./mvp-storage";
import { installFourManeuverRuntime } from "./mvp-four-maneuver-runtime";
import { installFourManeuverResolution } from "./mvp-four-maneuver-resolution";

installFourManeuverRuntime();
installFourManeuverResolution();

class CapturingStorage extends MemoryMvpStoryStorage {
  readonly aiTasks: Array<Record<string, any>> = [];
  async recordAiTask(task: Record<string, any>) {
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

async function expectCode(action: () => Promise<unknown>, code: string) {
  await assert.rejects(action, (error: any) => errorCode(error) === code);
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
      throw new Error(`Unexpected state while reaching ${sceneKey}: ${view.run.status}`);
    }
  }
  return view;
}

async function runWithoutManeuvers() {
  const storage = new MemoryMvpStoryStorage();
  const engine: any = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });
  let step = 0;
  while (view.run.status !== "finished") {
    if (view.activeDecision) {
      view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
        version: view.run.version,
        optionKey: "A",
        idempotencyKey: `skip-maneuver-decision-${step++}`
      });
    } else if (view.run.status === "awaiting_day_advance") {
      view = await engine.advanceDay(view.run.id, { version: view.run.version });
    } else if (view.run.status === "awaiting_finalization") {
      view = await engine.finalize(view.run.id, { version: view.run.version });
    } else {
      throw new Error(`Unexpected story state ${view.run.status}`);
    }
  }
  return view;
}

test("daily quota accepts two different maneuver types and fails closed on a third", async () => {
  const storage = new MemoryMvpStoryStorage();
  const engine: any = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });

  view = await engine.submitManeuver(view.run.id, {
    version: view.run.version,
    idempotencyKey: "p5-quota-contact",
    maneuverType: "contact",
    targetRoleKey: "county_magistrate",
    messageText: "原始名册为何早于诏令形成？"
  });
  view = await engine.submitManeuver(view.run.id, {
    version: view.run.version,
    idempotencyKey: "p5-quota-investigate",
    maneuverType: "investigate",
    intentKey: "inspect_first_register_timing"
  });

  assert.equal(view.maneuverState.maneuverOpportunitiesRemaining, 0);
  assert.deepEqual(view.maneuverState.usedTypesToday.sort(), ["contact", "investigate"]);
  const version = view.run.version;
  await expectCode(() => engine.submitManeuver(view.run.id, {
    version,
    idempotencyKey: "p5-quota-third",
    maneuverType: "custom",
    customText: "派幕僚核验巡抚府书吏的签押。"
  }), "MANEUVER_LIMIT_REACHED");
  const persisted: any = await engine.get(view.run.id);
  assert.equal(persisted.run.version, version);
  assert.equal(persisted.maneuverState.maneuversUsedToday, 2);
});

test("each maneuver type can only be used once per day", async () => {
  const storage = new MemoryMvpStoryStorage();
  const engine: any = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });

  view = await engine.submitManeuver(view.run.id, {
    version: view.run.version,
    idempotencyKey: "p5-type-contact-1",
    maneuverType: "contact",
    targetRoleKey: "xunfu",
    messageText: "首批名册为何准备得如此迅速？"
  });
  const version = view.run.version;
  await expectCode(() => engine.submitManeuver(view.run.id, {
    version,
    idempotencyKey: "p5-type-contact-2",
    maneuverType: "contact",
    targetRoleKey: "county_magistrate",
    messageText: "县衙是否提前收到催报？"
  }), "MANEUVER_TYPE_ALREADY_USED");
  const persisted: any = await engine.get(view.run.id);
  assert.equal(persisted.run.version, version);
  assert.equal(persisted.maneuverState.maneuverOpportunitiesRemaining, 1);
});

test("file storage preserves one-use leverage across engine restart and refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "mvp-four-p5-"));
  try {
    const firstStorage = new FileMvpStoryStorage(root);
    const firstEngine: any = new MvpStoryEngine(firstStorage);
    let view: any = await firstEngine.create({ storyId: "sangtian" });
    view = await advanceToScene(firstEngine, view, "d1_2", "p5-file");
    view = await firstEngine.submitManeuver(view.run.id, {
      version: view.run.version,
      idempotencyKey: "p5-file-leverage",
      maneuverType: "leverage",
      leverageKey: "xunfu_merchant_old_pact_rumor",
      targetRoleKey: "merchant"
    });
    assert.equal(view.leverageHand.items.some((item: any) => item.leverageKey === "xunfu_merchant_old_pact_rumor"), false);

    const secondStorage = new FileMvpStoryStorage(root);
    const secondEngine: any = new MvpStoryEngine(secondStorage);
    const restored: any = await secondEngine.get(view.run.id);
    assert.equal(restored.run.version, view.run.version);
    assert.equal(restored.leverageHand.items.some((item: any) => item.leverageKey === "xunfu_merchant_old_pact_rumor"), false);
    assert.ok(restored.maneuverState.usedLeverageKeys.includes("xunfu_merchant_old_pact_rumor"));
    await expectCode(() => secondEngine.submitManeuver(restored.run.id, {
      version: restored.run.version,
      idempotencyKey: "p5-file-leverage-again",
      maneuverType: "leverage",
      leverageKey: "xunfu_merchant_old_pact_rumor",
      targetRoleKey: "merchant"
    }), "MANEUVER_TYPE_ALREADY_USED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent requests for the same leverage consume it exactly once", async () => {
  const storage = new SlowMemoryStorage();
  const engine: any = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });
  view = await advanceToScene(engine, view, "d1_2", "p5-race");
  const version = view.run.version;
  const attempts = await Promise.allSettled([
    engine.submitManeuver(view.run.id, {
      version,
      idempotencyKey: "p5-race-a",
      maneuverType: "leverage",
      leverageKey: "xunfu_merchant_old_pact_rumor",
      targetRoleKey: "merchant"
    }),
    engine.submitManeuver(view.run.id, {
      version,
      idempotencyKey: "p5-race-b",
      maneuverType: "leverage",
      leverageKey: "xunfu_merchant_old_pact_rumor",
      targetRoleKey: "xunfu"
    })
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
  const persisted: any = await engine.get(view.run.id);
  assert.equal(persisted.maneuverState.maneuversUsedToday, 1);
  assert.equal(persisted.maneuverState.maneuverOpportunitiesRemaining, 1);
  assert.deepEqual(persisted.maneuverState.usedLeverageKeys, ["xunfu_merchant_old_pact_rumor"]);
  const internal: any = await storage.load(view.run.id);
  assert.equal(internal.events.filter((event: any) => event.type === "leverage_used").length, 1);
});

test("idempotency replay is stable while key reuse and stale versions do not mutate state", async () => {
  const storage = new MemoryMvpStoryStorage();
  const engine: any = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });
  const originalVersion = view.run.version;
  const command = {
    version: originalVersion,
    idempotencyKey: "p5-idempotent",
    maneuverType: "investigate",
    intentKey: "inspect_first_register_timing"
  };

  const accepted: any = await engine.submitManeuver(view.run.id, command);
  const replay: any = await engine.submitManeuver(view.run.id, command);
  assert.equal(replay.run.version, accepted.run.version);
  assert.equal(replay.maneuverState.maneuversUsedToday, 1);

  await expectCode(() => engine.submitManeuver(view.run.id, {
    ...command,
    intentKey: "inspect_merchant_grain_source"
  }), "IDEMPOTENCY_KEY_REUSED");
  await expectCode(() => engine.submitManeuver(view.run.id, {
    version: originalVersion,
    idempotencyKey: "p5-stale",
    maneuverType: "custom",
    customText: "派人核对驿站签押。"
  }), "VERSION_CONFLICT");

  const persisted: any = await engine.get(view.run.id);
  assert.equal(persisted.run.version, accepted.run.version);
  assert.equal(persisted.maneuverState.maneuversUsedToday, 1);
});

test("day end expires leftover quota and next day resets types while keeping consumed leverage", async () => {
  const storage = new MemoryMvpStoryStorage();
  const engine: any = new MvpStoryEngine(storage);
  let view: any = await engine.create({ storyId: "sangtian" });

  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
    version: view.run.version,
    optionKey: "A",
    idempotencyKey: "p5-day-d1-1"
  });
  assert.equal(view.activeDecision.decisionKey, "d1_2");
  view = await engine.submitManeuver(view.run.id, {
    version: view.run.version,
    idempotencyKey: "p5-day-leverage",
    maneuverType: "leverage",
    leverageKey: "xunfu_merchant_old_pact_rumor",
    targetRoleKey: "merchant"
  });
  assert.equal(view.maneuverState.maneuverOpportunitiesRemaining, 1);
  view = await engine.submitDecision(view.run.id, view.activeDecision.messageId, {
    version: view.run.version,
    optionKey: "A",
    idempotencyKey: "p5-day-d1-2"
  });
  assert.equal(view.run.status, "awaiting_day_advance");
  assert.equal(view.maneuverPanel.quota.remaining, 0);

  view = await engine.advanceDay(view.run.id, { version: view.run.version });
  assert.equal(view.run.currentDay, 2);
  assert.equal(view.maneuverPanel.quota.remaining, 2);
  assert.deepEqual(view.maneuverState.usedTypesToday, []);
  assert.ok(view.maneuverState.usedLeverageKeys.includes("xunfu_merchant_old_pact_rumor"));
  assert.equal(view.leverageHand.items.some((item: any) => item.leverageKey === "xunfu_merchant_old_pact_rumor"), false);
});

test("maneuver provider failure completes with one logical call and deterministic fallback", async () => {
  const storage = new CapturingStorage();
  let calls = 0;
  const provider: any = {
    name: "p5-failing-maneuver-provider",
    lastCall: { attempts: 2, elapsedMs: 4, maxAttempts: 2, inputTokens: 0, outputTokens: 0 },
    async generateDecisionCandidate() { return {}; },
    async generateManeuverCandidate() {
      calls += 1;
      throw new Error("injected P5 maneuver failure");
    }
  };
  const engine: any = new MvpStoryEngine(storage, provider);
  let view: any = await engine.create({ storyId: "sangtian" });
  view = await engine.submitManeuver(view.run.id, {
    version: view.run.version,
    idempotencyKey: "p5-ai-fallback",
    maneuverType: "contact",
    targetRoleKey: "county_magistrate",
    messageText: "原始名册是否完整？"
  });
  assert.equal(calls, 1);
  assert.equal(view.runtime.fallbackUsed, true);
  assert.equal(storage.aiTasks.length, 1);
  assert.equal(storage.aiTasks[0].status, "fallback");
  assert.equal(view.maneuverState.maneuverOpportunitiesRemaining, 1);
  assert.match(view.messages.at(-1).body, /卢象升/);
});

test("all optional maneuvers can be skipped through the real seven-day decision and ending flow", async () => {
  const view: any = await runWithoutManeuvers();
  assert.equal(view.run.status, "finished");
  assert.equal(view.run.totalDecisionsCompleted, 12);
  assert.equal(view.maneuverState.totalManeuversUsed, 0);
  assert.ok(view.outcome?.globalEnding?.key);
  assert.ok(view.outcome?.personalEnding?.grade);
});
