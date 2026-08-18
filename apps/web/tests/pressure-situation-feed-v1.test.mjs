import assert from "node:assert/strict";
import test from "node:test";
import {
  createPressureSituationFeedStateV1,
  hasPressureSituationFeedV1,
  renderPressureRightRailV1,
  renderPressureSituationFeedV1,
} from "../public/pressure-situation-feed-v1.js";

test("Pressure situation Feed renders only viewer-safe fields and defaults to three items", () => {
  const view = feedView();
  const state = createPressureSituationFeedStateV1();
  assert.equal(hasPressureSituationFeedV1(view), true);

  const html = renderPressureRightRailV1({ view, uiState: state, maneuverHtml: '<section data-testid="maneuver-panel">maneuver</section>' });
  assert.match(html, /局势动向/);
  assert.match(html, /谋划中枢/);
  assert.match(html, /原始船队出现异常/);
  assert.match(html, /巡抚正式承诺提交原册/);
  assert.match(html, /有人正在接触你的幕僚/);
  assert.doesNotMatch(html, /第四条不应默认出现/);
  assert.doesNotMatch(html, /fact\.private\.secret|seat\.internal/);
  assert.doesNotMatch(html, /data-testid="maneuver-panel"/);
});

test("Pressure situation Feed supports filtering, expansion, safe detail and maneuver tab", () => {
  const view = feedView();
  const state = createPressureSituationFeedStateV1();
  state.expanded = true;
  state.filter = "SUSPICIOUS";
  state.selectedEventId = "event-3";
  const feed = renderPressureSituationFeedV1(view, state);
  assert.match(feed, /有人正在接触你的幕僚/);
  assert.match(feed, /只显示当前人物获准知道的安全摘要/);
  assert.match(feed, /关系压力/);
  assert.doesNotMatch(feed, /原始船队出现异常|第四条不应默认出现/);

  state.activeTab = "maneuver";
  const rail = renderPressureRightRailV1({ view, uiState: state, maneuverHtml: '<section data-testid="maneuver-panel">maneuver</section>' });
  assert.match(rail, /data-testid="maneuver-panel"/);
  assert.doesNotMatch(rail, /data-testid="pressure-situation-feed"/);
});

test("non-Pressure pages retain the existing maneuver rail", () => {
  const html = renderPressureRightRailV1({ view: {}, uiState: {}, maneuverHtml: '<section data-testid="maneuver-panel">unchanged</section>' });
  assert.equal(hasPressureSituationFeedV1({}), false);
  assert.equal(html, '<section data-testid="maneuver-panel">unchanged</section>');
});

function feedView() {
  const categories = ["RELATED", "PUBLIC", "SUSPICIOUS", "PUBLIC"];
  const titles = ["原始船队出现异常", "巡抚正式承诺提交原册", "有人正在接触你的幕僚", "第四条不应默认出现"];
  return {
    pressureProjection: {
      feedPage: {
        schemaVersion: "a_emotion_feed_page_v1",
        roomId: "room-feed",
        runId: "run-feed",
        viewerSeatId: "zhejiang_governor",
        unreadCount: 3,
        nextCursor: null,
        serverSequence: 4,
        items: titles.map((title, index) => ({
          eventId: `event-${index + 1}`,
          category: categories[index],
          title,
          safeSummary: index === 2 ? "只显示当前人物获准知道的安全摘要" : `安全摘要 ${index + 1}`,
          statusLabel: index === 1 ? "尚未验证" : "来源可信",
          occurredAt: new Date(Date.now() - index * 3_600_000).toISOString(),
          isUnread: index < 3,
          visibleImpacts: index === 2 ? [{ label: "关系压力", value: "+1" }] : [],
          knownFactRefs: ["fact.private.secret"],
          visibleSourceSeatId: "seat.internal",
        })),
      },
    },
  };
}
