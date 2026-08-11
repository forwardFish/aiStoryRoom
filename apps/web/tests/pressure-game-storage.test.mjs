import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { bootGamePage } from "../public/game-bootstrap.js";
import { PressureGameStorage } from "../public/pressure-game-storage.js";
import { createSleepPressureProjectionFixture } from "./fixtures/sangtian-pressure-game.fixture.mjs";

test("PressureGameStorage consumes the bootstrap projection, then reads the authoritative room endpoint", async () => {
  const initial = createSleepPressureProjectionFixture();
  const refreshed = createSleepPressureProjectionFixture({ settled: true });
  const requests = [];
  const storage = new PressureGameStorage({
    roomId: "room/pressure 1",
    initialProjection: structuredClone(initial),
    fetchImpl: async (path, init) => {
      requests.push({ path, init });
      return json(refreshed);
    }
  });

  assert.deepEqual(await storage.restoreOrCreate(), initial);
  assert.equal(requests.length, 0, "bootstrap payload must not trigger a duplicate GET");
  assert.deepEqual(await storage.getRun(), refreshed);
  assert.equal(requests[0].path, "/api/v4/rooms/room%2Fpressure%201/game");
  assert.equal(requests[0].init.credentials, "include");
});

test("PressureGameStorage sends Preview and Confirm only to the frozen pressure endpoints", async () => {
  const initial = createSleepPressureProjectionFixture();
  const settled = createSleepPressureProjectionFixture({ settled: true });
  const requests = [];
  const storage = new PressureGameStorage({
    roomId: "run-sleep-fixture",
    initialProjection: initial,
    fetchImpl: async (path, init) => {
      requests.push({ path, init, body: init.body ? JSON.parse(init.body) : null });
      return path.endsWith("/actions/preview")
        ? json(validPreview())
        : json({ projection: settled });
    }
  });

  const previewCommand = { idempotencyKey: "preview:1", expectedProjectionRevision: 11 };
  const preview = await storage.previewPressureAction(initial, previewCommand);
  assert.equal(preview.previewId, "preview.sleep.1");
  const confirmCommand = { idempotencyKey: "confirm:1", previewToken: "token" };
  const confirmed = await storage.confirmPressureAction(initial, confirmCommand);
  assert.equal(confirmed.projection.projectionRevision, 12);

  assert.deepEqual(requests.map((item) => item.path), [
    "/api/v4/rooms/run-sleep-fixture/game/actions/preview",
    "/api/v4/rooms/run-sleep-fixture/game/actions/confirm"
  ]);
  assert.deepEqual(requests.map((item) => item.body), [previewCommand, confirmCommand]);
  assert.equal(requests.every((item) => item.init.method === "POST" && item.init.credentials === "include"), true);
});

test("PressureGameStorage preserves server conflict codes and rejects malformed Confirm projections", async () => {
  const initial = createSleepPressureProjectionFixture();
  const conflictStorage = new PressureGameStorage({
    roomId: "run-sleep-fixture",
    initialProjection: initial,
    fetchImpl: async () => json({ code: "RUN_VERSION_CONFLICT", message: "stale" }, 409)
  });
  await assert.rejects(
    conflictStorage.previewPressureAction(initial, {}),
    (error) => error.code === "RUN_VERSION_CONFLICT" && error.status === 409
  );

  const malformedStorage = new PressureGameStorage({
    roomId: "run-sleep-fixture",
    initialProjection: initial,
    fetchImpl: async () => json({ accepted: true })
  });
  await assert.rejects(
    malformedStorage.confirmPressureAction(initial, {}),
    (error) => error.code === "INVALID_PRESSURE_CONFIRM_RESPONSE"
  );
});

test("/game bootstrap selects PressureGameStorage and the existing story shell for a pressure projection", async () => {
  const projection = createSleepPressureProjectionFixture();
  const dom = new JSDOM('<!doctype html><main id="app"></main>', {
    url: "http://game.test/game?runId=run-sleep-fixture"
  });
  let storageInput = null;
  let appInput = null;
  let booted = false;

  const result = await bootGamePage({
    root: dom.window.document.querySelector("#app"),
    window: dom.window,
    fetchImpl: async () => json(projection),
    loadPressureStorage: async () => ({
      PressureGameStorage: class {
        constructor(input) { storageInput = input; }
      }
    }),
    loadSolo: async () => ({
      createStoryApp: (input) => {
        appInput = input;
        return { boot: async () => { booted = true; } };
      }
    }),
    loadContinuous: async () => { throw new Error("continuous client must not load"); },
    loadRoomStorage: async () => { throw new Error("legacy room storage must not load"); }
  });

  assert.equal(booted, true);
  assert.equal(result !== null, true);
  assert.equal(storageInput.roomId, "run-sleep-fixture");
  assert.deepEqual(storageInput.initialProjection, projection);
  assert.equal(appInput.storage instanceof Object, true);
  dom.window.close();
});

function validPreview() {
  return {
    previewId: "preview.sleep.1",
    previewToken: "signed-preview-token.sleep.1",
    requestFingerprint: "fingerprint.sleep.1",
    normalizedIntent: { actionType: "REST" },
    compiledAction: { actionType: "REST" },
    validation: "ACCEPT_WITH_COST",
    timeCost: "半日",
    opportunityCost: "五席获得先手",
    expiresAt: "1566-05-12T06:05:00.000Z",
    currentProjectionRevision: 11
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
