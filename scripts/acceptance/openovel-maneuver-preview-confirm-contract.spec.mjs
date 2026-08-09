import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  assertConfirmAppliedOnce,
  assertPreviewZeroSideEffects,
  classifyManeuverRequest,
  projectionSnapshot,
  providerCallTotal,
  requestDelta,
} from "./openovel-maneuver-preview-confirm-contract.mjs";

test("classifies Preview, Confirm, legacy, and unrelated requests", () => {
  const root = "http://127.0.0.1:3000/api/v4/rooms/run-1/game/maneuvers";
  assert.equal(classifyManeuverRequest(`${root}/preview`), "preview");
  assert.equal(classifyManeuverRequest(`${root}/confirm`), "confirm");
  assert.equal(classifyManeuverRequest(root), "legacy");
  assert.equal(classifyManeuverRequest(`${root}/preview/extra`), null);
  assert.equal(classifyManeuverRequest("not a maneuver url"), null);
});

test("projectionSnapshot keeps only authoritative maneuver and timeline fields", () => {
  const input = {
    maneuverVersion: 7,
    worldSequence: 3,
    maneuverPanel: { quota: { perDay: 2, remaining: 1 } },
    maneuverState: { usedTypesToday: ["contact"] },
    leverageHand: { items: [{ leverageKey: "letter" }] },
    timeline: [{ id: "event-1", decisionForm: "CONVERSATION", ignored: "value" }],
    volatile: Date.now(),
  };
  assert.deepEqual(projectionSnapshot(input), {
    maneuverVersion: 7,
    worldSequence: 3,
    quota: { perDay: 2, remaining: 1 },
    maneuverState: { usedTypesToday: ["contact"] },
    leverageHand: { items: [{ leverageKey: "letter" }] },
    timeline: [{ id: "event-1", decisionForm: "CONVERSATION", messageType: null, maneuverType: null, originEventId: null }],
  });
});

test("Preview invariant accepts identical projection, database, and provider snapshots", () => {
  const projection = { maneuverVersion: 2, worldSequence: 0, quota: { remaining: 2 } };
  const database = { run: { version: 2 }, events: [], tasks: [] };
  const provider = { narrator: 0, options: 0 };
  assert.doesNotThrow(() => assertPreviewZeroSideEffects({
    label: "contact",
    beforeProjection: projection,
    afterProjection: structuredClone(projection),
    beforeDatabase: database,
    afterDatabase: structuredClone(database),
    beforeProviderCalls: provider,
    afterProviderCalls: structuredClone(provider),
  }));
});

test("Preview invariant rejects a quota or database write", () => {
  assert.throws(() => assertPreviewZeroSideEffects({
    label: "investigate",
    beforeProjection: { quota: { remaining: 2 } },
    afterProjection: { quota: { remaining: 1 } },
    beforeDatabase: { events: [] },
    afterDatabase: { events: [{ id: "event-1" }] },
  }), /Preview changed the authoritative game projection/);
});

test("Confirm invariant requires one revision, quota, event, and configured AI-task delta", () => {
  const result = assertConfirmAppliedOnce({
    label: "contact",
    maneuverType: "contact",
    beforeProjection: { maneuverVersion: 4, worldSequence: 1, quota: { remaining: 2 } },
    afterProjection: { maneuverVersion: 5, worldSequence: 1, quota: { remaining: 1 } },
    beforeDatabase: { run: { version: 4, worldSequence: 1 }, events: [], tasks: [] },
    afterDatabase: {
      run: { version: 5, worldSequence: 1 },
      events: [{ id: "event-1", maneuverType: "contact" }],
      tasks: [{ id: "task-1" }],
    },
    expectedAiTaskDelta: 1,
    beforeProviderCalls: { narrator: 0, options: 0 },
    afterProviderCalls: { narrator: 1, options: 0 },
    expectedProviderCallDelta: 1,
  });
  assert.equal(result.newEvents.length, 1);
  assert.equal(result.newTasks.length, 1);
});

test("Confirm invariant rejects duplicate settlement", () => {
  assert.throws(() => assertConfirmAppliedOnce({
    label: "leverage",
    maneuverType: "leverage",
    beforeProjection: { maneuverVersion: 9, worldSequence: 4, quota: { remaining: 2 } },
    afterProjection: { maneuverVersion: 11, worldSequence: 4, quota: { remaining: 0 } },
    beforeDatabase: { run: { version: 9, worldSequence: 4 }, events: [], tasks: [] },
    afterDatabase: {
      run: { version: 11, worldSequence: 4 },
      events: [
        { id: "event-1", maneuverType: "leverage" },
        { id: "event-2", maneuverType: "leverage" },
      ],
      tasks: [],
    },
    expectedAiTaskDelta: 0,
  }), /exactly once|exactly one/);
});

test("requestDelta separates Preview and Confirm requests after a marker", () => {
  const requests = [
    { url: "/api/v4/rooms/r/game/maneuvers/preview" },
    { url: "/api/v4/rooms/r/game/maneuvers/confirm" },
    { url: "/api/v4/rooms/r/game/maneuvers/preview" },
  ];
  assert.equal(requestDelta(requests, 1, "preview").length, 1);
  assert.equal(requestDelta(requests, 1, "confirm").length, 1);
});

test("providerCallTotal sums named provider counters", () => {
  assert.equal(providerCallTotal({ narrator: 2, options: 3, storykeeper: 4 }), 9);
  assert.equal(providerCallTotal(null), null);
});


test("live browser journey wires all four forms through cancel, re-Preview, and single Confirm", async () => {
  const entry = await readFile(new URL("./openovel-maneuver-r2-4-browser.mjs", import.meta.url), "utf8");
  const harness = await readFile(new URL("./openovel-maneuver-r2-4-browser-harness.mjs", import.meta.url), "utf8");
  const source = `${entry}\n${harness}`;
  assert.equal((entry.match(/await harness\.exerciseManeuver\(\{/g) || []).length, 4);
  assert.match(source, /doubleClick\(cdp, "#maneuverSubmit"\)/);
  assert.match(source, /click\(cdp, "#maneuverPreviewCancel"\)/);
  assert.match(source, /doubleClick\(cdp, "#maneuverConfirm"\)/);
  assert.match(source, /previewRequestCount: previewRequests\.length/);
  assert.match(source, /confirmRequestCount: confirmRequests\.length/);
});

test("live browser journey compares Preview and refresh against authoritative database snapshots", async () => {
  const entry = await readFile(new URL("./openovel-maneuver-r2-4-browser.mjs", import.meta.url), "utf8");
  const harness = await readFile(new URL("./openovel-maneuver-r2-4-browser-harness.mjs", import.meta.url), "utf8");
  const source = `${entry}\n${harness}`;
  assert.match(source, /assertPreviewZeroSideEffects\(\{/);
  assert.match(source, /stateJson: stableClone\(run\.stateJson\)/);
  assert.match(source, /taskType: "resolve_maneuver_narrative"/);
  assert.match(source, /refresh replayed Preview or Confirm/);
  assert.doesNotMatch(source, /\/game\/maneuvers`/);
});
