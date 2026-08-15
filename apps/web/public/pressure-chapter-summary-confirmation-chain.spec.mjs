import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PressureMainGameStorageV1 } from "./pressure-main-game-storage-v1.js";

function projection(state = "AWAITING_CONFIRMATION") {
  return {
    schemaVersion: "pressure_chapter_game_projection_v1", projectionVersion: 8, runId: "run-1",
    route: { routeHash: "r".repeat(64) },
    chapter: { chapterRuntimeId: "runtime-n1", chapterId: "N1", chapterNumber: 1, title: "九堰将决", phase: "FROZEN", workingRevision: 8 },
    viewer: { seatId: "zhejiang_governor", roleName: "浙江总督", control: { controlEpoch: 1, submissionFenceToken: "fence", mode: "HUMAN_ACTIVE" } },
    situation: { goal: "完成N1", risk: "灾情", judgment: "等待确认" }, metrics: [], resources: [], tokens: [], decision: null,
    narrative: { text: "章末", projectionKind: "CHAPTER_NARRATIVE", status: "PUBLISHED" }, capabilities: { canSubmitDecision: false },
    chapterSummary: { sourceChapterRuntimeId: "runtime-n1", chapterId: "N1", title: "九堰将决", closingNarrative: "章末", playerActions: [], actualResults: [], completedObjectives: [], incompleteObjectives: [], metricChanges: [], remainingPressures: [], nextChapterHook: "N2", confirmationState: state },
  };
}

test("Pressure storage confirms through existing game/action and then reloads authoritative game projection", async () => {
  const requests = [];
  const storage = new PressureMainGameStorageV1({
    runId: "run-1", initialProjection: projection(), narrativePollAttempts: 0,
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      if (String(url).endsWith("/game/action")) return new Response(JSON.stringify({ schemaVersion: "pressure_chapter_summary_confirmation_response_v2", accepted: true, idempotencyKey: "chapter-summary:run-1:runtime-n1:zhejiang_governor" }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(projection("CONFIRMED")), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const view = await storage.confirmChapterSummary(storage.toView(projection()));
  assert.equal(view.pressureProjection.chapterSummary.confirmationState, "CONFIRMED");
  assert.equal(requests.length, 2);
  const command = JSON.parse(requests[0].init.body);
  assert.equal(command.commandType, "CONFIRM_CHAPTER_SUMMARY");
  assert.equal(requests[0].url, "/api/v4/rooms/run-1/game/action");
  assert.equal(requests[1].url, "/api/v4/rooms/run-1/game");
});

test("formal app has no advanceDay fallback in the chapter-summary confirmation path", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const start = app.indexOf("async function confirmChapterSummary()");
  const end = app.indexOf("async function finalize()", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(app.slice(start, end), /advanceDay\s*\(/u);
});
