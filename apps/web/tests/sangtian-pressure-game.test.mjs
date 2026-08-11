import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createStoryApp } from "../public/app.js";
import { createPressureConfirmCommand, createPressurePreviewCommand, pressureActionAvailability, pressurePreviewFromResponse, validatePressureGameProjection } from "../public/sangtian-pressure-game.js";
import { createSleepPressureProjectionFixture, DeterministicSleepPressureStorage } from "./fixtures/sangtian-pressure-game.fixture.mjs";

function createHarness(storage = new DeterministicSleepPressureStorage()) {
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: "http://127.0.0.1:5200/game?runId=run-sleep-fixture&debug=1"
  });
  const root = dom.window.document.querySelector("#app");
  const app = createStoryApp({ root, window: dom.window, storage });
  return { app, dom, root, storage };
}

async function waitFor(assertion, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError || new Error("condition was not met");
}

test("PressureGameProjectionV1 renders identity, institutional mission, private opening, suggestions, and six seats", async () => {
  const harness = createHarness();
  await harness.app.boot();

  assert.equal(harness.root.querySelector("[data-runtime-profile]")?.dataset.runtimeProfile, "SANGTIAN_PRESSURE_SPINE_V1");
  assert.match(harness.root.querySelector('[data-testid="pressure-identity"]').textContent, /浙江总督/);
  assert.match(harness.root.querySelector('[data-testid="pressure-mission"]').textContent, /东南军务和浙江基本秩序/);
  assert.match(harness.root.querySelector('[data-testid="pressure-private-opening"]').textContent, /省府和织造局会各自先动/);
  assert.equal(harness.root.querySelectorAll("[data-pressure-suggestion-id]").length, 3);
  assert.equal([...harness.root.querySelectorAll("[data-pressure-suggestion-id]")].every((button) => button.dataset.requiresPreview === "true"), true);
  assert.equal(harness.root.querySelectorAll("[data-seat-id]").length, 6);
  assert.equal(harness.root.querySelector('[data-testid="pressure-latest-feedback"]'), null);
  harness.dom.window.close();
});

test("a suggested input enters Preview and cannot directly Confirm", async () => {
  const harness = createHarness();
  await harness.app.boot();

  const suggestion = [...harness.root.querySelectorAll("[data-pressure-suggestion-id]")]
    .find((button) => button.textContent.includes("我先睡一下"));
  assert.ok(suggestion);
  suggestion.click();

  await waitFor(() => assert.ok(harness.root.querySelector('[data-testid="pressure-preview"]')));
  assert.equal(harness.storage.previewCalls.length, 1);
  assert.equal(harness.storage.confirmCalls.length, 0, "suggestion click must not confirm");
  assert.equal(harness.root.querySelector("#pressureActionInput").value, "我先睡一下");
  assert.match(harness.root.querySelector('[data-testid="pressure-preview-action"]').textContent, /REST/);
  assert.match(harness.root.querySelector('[data-testid="pressure-preview-action"]').textContent, /DELAY/);
  assert.equal(harness.root.querySelector("#pressureConfirmBtn").disabled, false);
  harness.dom.window.close();
});

test("free input follows Preview then Confirm and displays the structured half-day sleep consequences", async () => {
  const harness = createHarness();
  await harness.app.boot();

  const input = harness.root.querySelector("#pressureActionInput");
  input.value = "我先睡一下";
  input.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));
  harness.root.querySelector("#pressurePreviewBtn").click();
  await waitFor(() => assert.ok(harness.root.querySelector("#pressureConfirmBtn")));
  assert.equal(harness.storage.previewCalls.length, 1);
  assert.equal(harness.storage.confirmCalls.length, 0);

  harness.root.querySelector("#pressureConfirmBtn").click();
  await waitFor(() => assert.ok(harness.root.querySelector('[data-testid="pressure-latest-feedback"]')));
  assert.equal(harness.storage.confirmCalls.length, 1);
  assert.match(harness.root.querySelector('[data-testid="pressure-world-clock"]').textContent, /半日已过/);
  assert.equal(harness.root.querySelector('[data-testid="pressure-level"]').textContent.trim(), "2");
  assert.match(harness.root.querySelector('[data-testid="pressure-action-echo"]').textContent, /休息了半日/);
  assert.equal(harness.root.querySelectorAll('[data-testid="pressure-visible-reactions"] li').length, 5);
  assert.match(harness.root.querySelector('[data-change-kind="时间"]').textContent, /时间推进半日/);
  assert.match(harness.root.querySelector('[data-change-kind="压力"]').textContent, /节点压力 \+1/);
  assert.match(harness.root.querySelector('[data-change-kind="后果"]').textContent, /lost_initiative/);
  assert.match(harness.root.querySelector('[data-testid="pressure-public-scene"]').textContent, /急报闯入/);
  assert.match(harness.root.querySelector('[data-testid="pressure-next-pressure"]').textContent, /九堰险情急报将你唤醒/);
  assert.match(harness.root.querySelector('[data-testid="pressure-feedback-source-ids"]').textContent, /action\.n1\.governor\.rest\.1/);
  assert.equal(harness.root.querySelectorAll("[data-pressure-suggestion-id]").length, 3, "next actionable phase still offers preview-only suggestions");

  harness.root.querySelector("#pressureRefreshBtn").click();
  await waitFor(() => assert.equal(harness.storage.getRunCalls, 1));
  assert.equal(harness.storage.confirmCalls.length, 1, "refresh must not replay confirm");
  assert.match(harness.root.querySelector('[data-testid="pressure-next-pressure"]').textContent, /九堰险情急报/);
  harness.dom.window.close();
});

test("sealed, settling, frozen, and recoverable phases lock every action input", async () => {
  for (const phase of ["PREPARE_LOCKED", "SETTLING", "FROZEN", "FAILED_RECOVERABLE"]) {
    const projection = createSleepPressureProjectionFixture({ phase });
    const storage = {
      restoreOrCreate: async () => structuredClone(projection),
      getRun: async () => structuredClone(projection)
    };
    const harness = createHarness(storage);
    await harness.app.boot();
    assert.equal(harness.root.querySelectorAll("[data-pressure-suggestion-id]").length, 0, phase);
    assert.equal(harness.root.querySelector("#pressureActionInput").disabled, true, phase);
    assert.equal(harness.root.querySelector("#pressurePreviewBtn").disabled, true, phase);
    assert.equal(harness.root.querySelector("#pressureConfirmBtn"), null, phase);
    harness.dom.window.close();
  }
});

test("projection validation fails closed instead of inventing suggestions or private facts", async () => {
  const malformed = createSleepPressureProjectionFixture();
  malformed.seats = malformed.seats.slice(0, 5);
  malformed.privateScene = null;
  malformed.actionSurface.suggestedInputs[0].requiresPreview = false;
  assert.equal(validatePressureGameProjection(malformed).length >= 3, true);
  assert.equal(pressureActionAvailability(malformed).actionable, false);

  const storage = {
    restoreOrCreate: async () => structuredClone(malformed),
    getRun: async () => structuredClone(malformed)
  };
  const harness = createHarness(storage);
  await harness.app.boot();
  assert.ok(harness.root.querySelector('[data-testid="pressure-projection-error"]'));
  assert.equal(harness.root.querySelector("#pressureActionInput"), null);
  assert.match(harness.root.textContent, /不会自行补造人物、行动或后果/);
  harness.dom.window.close();
});

test("preview and confirm commands contain guards but no client-authored effect or state patch", () => {
  const projection = createSleepPressureProjectionFixture();
  const previewCommand = createPressurePreviewCommand(projection, "我先睡一下", { idempotencyKey: "preview:test" });
  assert.deepEqual(Object.keys(previewCommand.input).sort(), ["actionType", "condition", "freeText", "objectVersionIds", "resourceCommitments", "targetIds", "visibility"]);
  assert.equal(JSON.stringify(previewCommand).includes("statePatch"), false);
  assert.equal(JSON.stringify(previewCommand).includes("effect"), false);
  const confirmCommand = createPressureConfirmCommand(projection, {
    previewToken: "token",
    requestFingerprint: "fingerprint",
    normalizedIntent: { actionType: "REST", intentText: "sleep" },
    validation: "ACCEPT"
  }, { idempotencyKey: "confirm:test" });
  assert.equal(confirmCommand.expectedRunVersion, 3);
  assert.equal(confirmCommand.expectedProjectionRevision, 11);
  assert.deepEqual(confirmCommand.normalizedIntent, { actionType: "REST", intentText: "sleep" });
  assert.equal(Object.hasOwn(confirmCommand, "input"), false);
});

test("Preview responses fail closed when required contract fields are missing or stale", () => {
  const complete = {
    previewId: "preview.sleep.1",
    previewToken: "signed-preview-token.sleep.1",
    requestFingerprint: "fingerprint.sleep.1",
    normalizedIntent: { actionType: "REST" },
    compiledAction: { actionType: "REST" },
    validation: "ACCEPT_WITH_COST",
    timeCost: "半日",
    opportunityCost: "其他五席与 NPC 获得先手",
    expiresAt: "1566-05-12T06:05:00.000Z",
    currentProjectionRevision: 11
  };
  assert.equal(pressurePreviewFromResponse(complete, { expectedProjectionRevision: 11 }), complete);

  for (const field of ["previewId", "normalizedIntent", "compiledAction", "timeCost", "opportunityCost", "expiresAt", "currentProjectionRevision"]) {
    const malformed = structuredClone(complete);
    delete malformed[field];
    assert.throws(
      () => pressurePreviewFromResponse(malformed, { expectedProjectionRevision: 11 }),
      /完整 Preview 合同/,
      field
    );
  }
  assert.throws(
    () => pressurePreviewFromResponse({ ...complete, validation: "MAYBE" }, { expectedProjectionRevision: 11 }),
    /完整 Preview 合同/
  );
  assert.throws(
    () => pressurePreviewFromResponse({ ...complete, currentProjectionRevision: 10 }, { expectedProjectionRevision: 11 }),
    (error) => error.code === "PREVIEW_STALE"
  );
});

test("Confirm retries reuse one idempotency key and do not require a second Preview", async () => {
  class FlakyConfirmStorage extends DeterministicSleepPressureStorage {
    constructor() {
      super();
      this.confirmAttempts = [];
    }

    async confirmPressureAction(projection, command) {
      this.confirmAttempts.push(structuredClone(command));
      if (this.confirmAttempts.length === 1) {
        const error = new Error("temporary network failure");
        error.code = "NETWORK_ERROR";
        throw error;
      }
      return super.confirmPressureAction(projection, command);
    }
  }

  const storage = new FlakyConfirmStorage();
  const harness = createHarness(storage);
  await harness.app.boot();
  const input = harness.root.querySelector("#pressureActionInput");
  input.value = "我先睡一下";
  input.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));
  harness.root.querySelector("#pressurePreviewBtn").click();
  await waitFor(() => assert.ok(harness.root.querySelector("#pressureConfirmBtn")));

  harness.root.querySelector("#pressureConfirmBtn").click();
  await waitFor(() => assert.match(harness.root.textContent, /temporary network failure/));
  assert.ok(harness.root.querySelector("#pressureConfirmBtn"), "the accepted Preview remains retryable");
  harness.root.querySelector("#pressureConfirmBtn").click();
  await waitFor(() => assert.ok(harness.root.querySelector('[data-testid="pressure-latest-feedback"]')));

  assert.equal(storage.previewCalls.length, 1);
  assert.equal(storage.confirmAttempts.length, 2);
  assert.equal(storage.confirmAttempts[0].idempotencyKey, storage.confirmAttempts[1].idempotencyKey);
  harness.dom.window.close();
});

test("P0 is a real locked scene and acknowledge projects once into N1", async () => {
  const { DeterministicPressurePrologueStorage } = await import("./fixtures/sangtian-pressure-game.fixture.mjs");
  const storage = new DeterministicPressurePrologueStorage();
  const harness = createHarness(storage);
  await harness.app.boot();

  assert.ok(harness.root.querySelector('[data-testid="pressure-prologue"]'));
  assert.match(harness.root.querySelector('[data-testid="pressure-public-scene"]').textContent, /桑田诏下|国库亏空/);
  assert.match(harness.root.querySelector('[data-testid="pressure-mission"]').textContent, /总督职责|东南军务/);
  assert.match(harness.root.querySelector('[data-testid="pressure-private-opening"]').textContent, /总督署/);
  assert.equal(harness.root.querySelector("#pressureActionInput"), null);
  assert.equal(harness.root.querySelector("#pressurePreviewBtn"), null);
  assert.equal(harness.root.querySelector("#pressureConfirmBtn"), null);

  harness.root.querySelector("#pressureAcknowledgePrologueBtn").click();
  await waitFor(() => assert.equal(harness.app.getState().view.run.nodeId, "N1"));
  assert.equal(storage.acknowledgeCalls.length, 1);
  assert.ok(harness.root.querySelector("#pressureActionInput"));
  assert.equal(harness.root.querySelector('[data-testid="pressure-prologue"]'), null);

  await harness.app.refresh();
  assert.equal(storage.acknowledgeCalls.length, 1, "refresh must not project P0 again");
  harness.dom.window.close();
});
