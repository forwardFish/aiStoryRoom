import assert from "node:assert/strict";
import test from "node:test";
import { PRESSURE_CHAPTER_SEAT_IDS_V1 } from "@ai-story/shared";
import {
  compileInitialWorldState,
  loadSangtianPressureChapterPackageV1,
} from "@ai-story/templates";
import { SangtianPressureGameWorldReaderAdapterV1 } from "../integration/game-projection.adapters";
import {
  SANGTIAN_INITIAL_PLAYER_METRICS_V1,
  SANGTIAN_INITIAL_RESOURCES_BY_SEAT_V1,
} from "./sangtian-initial-player-state";

test("Sangtian N1 projects the approved five opening metrics", async () => {
  const worldState = compileInitialWorldState(loadSangtianPressureChapterPackageV1());
  const reader = new SangtianPressureGameWorldReaderAdapterV1({
    readCurrentWorld: async (runId) => ({
      runId,
      routeHash: "a".repeat(64),
      worldState,
    }),
  });

  const projection = await reader.readWorld("run-initial-personal-state");
  assert.deepEqual(
    projection?.metrics.map(({ label, value }) => ({ label, value })),
    [
      { label: "国库余裕", value: 35 },
      { label: "民心", value: 55 },
      { label: "粮价压力", value: 60 },
      { label: "改桑进度", value: 8 },
      { label: "皇帝信任", value: 45 },
    ],
  );
});
test("all six seats own separate three-resource opening catalogs", () => {
  assert.equal(SANGTIAN_INITIAL_PLAYER_METRICS_V1.length, 5);
  const catalogs = PRESSURE_CHAPTER_SEAT_IDS_V1.map(
    (seatId) => SANGTIAN_INITIAL_RESOURCES_BY_SEAT_V1[seatId],
  );
  assert.equal(catalogs.length, 6);
  assert.equal(catalogs.every((resources) => resources.length === 3), true);
  assert.equal(
    new Set(catalogs.map((resources) => resources.map((resource) => resource.resourceId).join("|"))).size,
    6,
  );
});
