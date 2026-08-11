import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  initializePressureRuntime,
  loadPressureRuntimeContent,
  projectP0ToN1,
} from "@ai-story/templates";
import { buildPressureGameProjection, classifyPressureFreeText } from "./pressure-spine-viewer";

const registryPath = path.resolve(process.cwd(), "packages/templates/config/sangtian/strategy-registry.json");

test("generic free text classification turns sleeping into REST without story-specific keywords", () => {
  assert.equal(classifyPressureFreeText("什么都不管，我先睡一下"), "REST");
  assert.equal(classifyPressureFreeText("先调查现场记录"), "INVESTIGATE");
  assert.equal(classifyPressureFreeText("提出一套执行方案"), "PLAN");
});

test("accepted content produces a six-seat actionable viewer projection", () => {
  const content = loadPressureRuntimeContent(registryPath, "sangtian_pressure_v1_0");
  const initialized = initializePressureRuntime(content, { runId: "run.viewer", runSeed: "seed.viewer", nowEpochMs: 1_000 });
  const state = projectP0ToN1(content, initialized, 1_001, 601_001).state;
  const roles = content.seatIds.map((seatId) => {
    const runtimeSeat = state.seats[seatId];
    return { id: `role.${seatId}`, roleKey: runtimeSeat.roleKey };
  });
  const projection = buildPressureGameProjection({
    run: { id: state.runId, version: 3, status: "playing", roles, roleControls: [] },
    state,
    content,
    viewerSeatId: "seat.zhejiang_governor",
  }) as any;
  assert.equal(projection.schemaVersion, "pressure_game_projection_v1");
  assert.equal(projection.runtimeProfile, "SANGTIAN_PRESSURE_SPINE_V1");
  assert.equal(projection.seats.length, 6);
  assert.equal(projection.actionSurface.phase, "PREPARE");
  assert.ok(projection.actionSurface.suggestedInputs.length >= 2 && projection.actionSurface.suggestedInputs.length <= 3);
  assert.ok(projection.actionSurface.suggestedInputs.every((item: any) => item.requiresPreview === true));
  assert.match(projection.publicScene.text, /总督府|河图|急报/);
  assert.match(projection.privateScene.text, /胡宗宪|海防|堰口/);
});
