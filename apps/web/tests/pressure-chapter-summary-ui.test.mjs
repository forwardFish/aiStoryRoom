import assert from "node:assert/strict";
import test from "node:test";
import { pressureChapterSummaryFromView, renderPressureChapterSummary, shouldShowPressureChapterSummary } from "../public/pressure-chapter-summary-ui.js";

const summary = {
  chapterId: "N1", title: "九堰将决", closingNarrative: "诸令封缄。", playerActions: ["先撤百姓"],
  actualResults: ["多数百姓撤离"], completedObjectives: ["完成疏散"], incompleteObjectives: ["部分堰口待援"],
  metricChanges: [{ label: "民生", displayBefore: "50", displayDelta: "+2", displayAfter: "52" }],
  remainingPressures: ["朝廷等待奏疏"], nextChapterHook: "进入灾后第一道奏疏。", confirmationState: "AWAITING_CONFIRMATION",
  factId: "must-not-render", metricId: "must-not-render", provider: "must-not-render", hash: "must-not-render"
};

test("existing /game center renders the full viewer-safe chapter summary and confirmation gate", () => {
  const view = { pressureProjection: { chapterSummary: summary } };
  assert.equal(shouldShowPressureChapterSummary(view), true);
  const html = renderPressureChapterSummary(view);
  for (const text of ["九堰将决", "诸令封缄", "先撤百姓", "多数百姓撤离", "完成疏散", "部分堰口待援", "50 → 52", "+2", "朝廷等待奏疏", "进入下一章"]) assert.match(html, new RegExp(text.replace(/[+]/g, "\\+")));
  assert.doesNotMatch(html, /factId|metricId|provider|must-not-render|hash|fence|Prompt|Reviewer/u);
});

test("refresh keeps the same summary and confirmation state is viewer-owned", () => {
  const first = { pressureProjection: { chapterSummary: structuredClone(summary) } };
  const refreshed = { pressureProjection: { chapterSummary: structuredClone(summary) } };
  assert.deepEqual(pressureChapterSummaryFromView(refreshed), pressureChapterSummaryFromView(first));
  const otherViewer = { pressureProjection: { chapterSummary: null } };
  assert.equal(shouldShowPressureChapterSummary(otherViewer), false);
});
