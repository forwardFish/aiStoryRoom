import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyManeuverDrafts,
  renderFourManeuverPanel,
} from "../public/maneuver-four-ui.js";

function state() {
  return {
    activeManeuverType: null,
    maneuverDrafts: emptyManeuverDrafts(),
    maneuverPreview: null,
    maneuverGuard: null,
  };
}

test("missing maneuver projection fails closed with an actionable message instead of an endless loading state", () => {
  const html = renderFourManeuverPanel({
    maneuverState: {
      maneuverOpportunitiesRemaining: 2,
    },
  }, state());

  assert.equal(html.includes("主动谋划配置正在加载"), false);
  assert.equal(html.includes("主动谋划暂不可用，请刷新页面后重试"), true);
  assert.equal((html.match(/data-maneuver-type=/g) || []).length, 4);
  assert.equal((html.match(/ disabled/g) || []).length >= 4, true);
});

test("authoritative exhausted quota keeps the specific daily-limit reason", () => {
  const html = renderFourManeuverPanel({
    maneuverState: {
      maneuverOpportunitiesRemaining: 0,
    },
  }, state());

  assert.equal(html.includes("今日谋划机会已用完"), true);
  assert.equal(html.includes("请刷新页面后重试"), false);
});
