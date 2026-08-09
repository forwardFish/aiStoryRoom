import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyManeuverDrafts,
  renderFourManeuverPanel,
} from "../public/maneuver-four-ui.js";

function projection() {
  const section = { enabled: true, usedToday: false, count: 1, disabledReason: null, options: [] };
  return {
    maneuverPanel: {
      enabled: true,
      disabledReason: null,
      quota: { perDay: 2, remaining: 2, usedToday: 0, usedTypesToday: [] },
      contact: section,
      investigate: section,
      leverage: section,
      custom: { enabled: true, usedToday: false, disabledReason: null, maxLength: 200 },
    },
  };
}

function state(overrides = {}) {
  return {
    activeManeuverType: "custom",
    maneuverDrafts: emptyManeuverDrafts(),
    maneuverPreview: null,
    maneuverGuard: null,
    busy: false,
    ...overrides,
  };
}

test("busy maneuver state disables action cards and the active workbench", () => {
  const html = renderFourManeuverPanel(projection(), state({ busy: true }));

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /正在处理主动谋划/);
  assert.equal((html.match(/data-maneuver-type=/g) || []).length, 4);
  assert.equal((html.match(/data-maneuver-type=[^>]+disabled/g) || []).length, 4);
  assert.match(html, /id="customManeuverText"[^>]+disabled/);
  assert.match(html, /id="maneuverSubmit"[^>]+disabled/);
});

test("a stale Preview value never restores the retired preview card", () => {
  const html = renderFourManeuverPanel(projection(), state({
    busy: true,
    activeManeuverType: null,
    maneuverPreview: {
      previewId: "busy-preview",
      title: "确认主动谋划",
      summary: "检查当前记录",
      costLabel: "确认后消耗一次谋划",
      confirmLabel: "确认执行",
    },
  }));

  assert.doesNotMatch(html, /预演|预览|确认主动谋划/);
  assert.doesNotMatch(html, /id="maneuverPreviewCancel"|id="maneuverConfirm"/);
});
