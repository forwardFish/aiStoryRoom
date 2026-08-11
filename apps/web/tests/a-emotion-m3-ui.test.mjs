import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createAEmotionM1Ui } from "../public/a-emotion-m1-ui.js";

const eventId = `evt_${"e".repeat(32)}`;
const modalId = `mdl_${"m".repeat(32)}`;
function jsonResponse(value, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(value); } }; }
function fixture(width = 1440) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"><aside class="causal-right"><section class="maneuver-panel"><textarea id="maneuverCustomText">保留草稿</textarea></section></aside><main class="causal-center"><section data-testid="existing-center">现有决策</section></main></div></body></html>`, { url: "http://game.test/game?runId=room-m3" });
  Object.defineProperty(dom.window, "innerWidth", { value: width, configurable: true });
  return { dom, root: dom.window.document.querySelector("#root") };
}
function page(modals) { return { schemaVersion: "event_delivery_page_v1", deliveries: [], nextAfterDeliverySequence: 0, hasMore: false, interactionFeed: { schemaVersion: "a_emotion_m2_feed_v1", items: [], unreadCount: 0, nextCursor: null, hasMore: false }, keyModals: modals }; }
function modal(overrides = {}) { return {
  schemaVersion: "a_emotion_key_modal_v1", modalId, eventId, modalType: "CRISIS",
  triggerCode: "LOSE_REFORM_AUTHORITY_RISK", triggerVersion: 1, projectionVersion: 1,
  stateVersion: 9, priority: 300, title: "你正在失去主持权", summary: "皇帝信任已进入危险区。",
  facts: ["皇帝信任当前为 18", "危险线为 20"],
  responseOptions: [
    { code: "INVESTIGATE_PRESSURE_SOURCE", label: "派遣调查", preferredEntry: "INVESTIGATE", intentKey: "inspect_metric_pressure", prefillText: "核查已确认事件和记录。" },
    { code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", intentKey: null, prefillText: null }
  ],
  ariaLive: "assertive", occurredAt: "2026-08-10T00:00:00.000Z", isShown: false, isAcknowledged: false, ...overrides
}; }
function receipt(acknowledgedAt = null) { return { schemaVersion: "a_emotion_key_modal_receipt_v1", modalId, eventId, projectionVersion: 1, stateVersion: 9, triggerVersion: 1, shownAt: "2026-08-10T00:00:01.000Z", acknowledgedAt }; }

for (const width of [1440, 390]) test(`M3 CRISIS modal is durable, assertive and preserves the approved /game surface at ${width}px`, async () => {
  const { dom, root } = fixture(width);
  const requests = [];
  const textarea = root.querySelector("#maneuverCustomText");
  textarea.focus(); textarea.setSelectionRange(2, 5);
  const fetchImpl = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith(`/${modalId}/shown`)) return jsonResponse(receipt());
    if (String(url).endsWith(`/${modalId}/ack`)) return jsonResponse(receipt("2026-08-10T00:00:02.000Z"));
    return jsonResponse(page([modal()]));
  };
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: "room-m3", fetchImpl, getProjection: () => ({ world: { presentation: { statusMetrics: [] } } }), prefillWorkbench() {} });
  await ui.refresh();
  const dialog = root.querySelector('[data-testid="aemotion-crisis-modal"]');
  assert.ok(dialog); assert.equal(dialog.getAttribute("aria-live"), "assertive");
  assert.ok(root.querySelector('[data-testid="existing-center"]'), "central decision remains mounted");
  assert.equal(root.querySelector("#maneuverCustomText").value, "保留草稿");
  dialog.querySelector('[data-aemotion-modal-response="DEFER_RESPONSE"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(root.querySelector("[data-aemotion-key-modal]"), null);
  assert.equal(root.querySelector("#maneuverCustomText").value, "保留草稿");
  assert.equal(dom.window.document.activeElement.id, "maneuverCustomText");
  assert.equal(requests.filter((value) => value.endsWith(`/${modalId}/shown`)).length, 1);
  assert.equal(requests.filter((value) => value.endsWith(`/${modalId}/ack`)).length, 1);
  ui.destroy(); dom.window.close();
});

test("M3 modal fails closed when shown receipt is stale or unavailable", async () => {
  const { dom, root } = fixture();
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: "room-m3", fetchImpl: async (url) => String(url).endsWith(`/${modalId}/shown`) ? jsonResponse({ code: "STALE_KEY_MODAL_VERSION" }, 409) : jsonResponse(page([modal()])), getProjection: () => ({ world: { presentation: { statusMetrics: [] } } }), prefillWorkbench() {} });
  await ui.refresh();
  assert.equal(root.querySelector("[data-aemotion-key-modal]"), null);
  ui.destroy(); dom.window.close();
});

test("M3 modal acknowledgement failure does not close locally or prefill workbench", async () => {
  const { dom, root } = fixture();
  let prefills = 0;
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: "room-m3", fetchImpl: async (url) => {
    if (String(url).endsWith(`/${modalId}/shown`)) return jsonResponse(receipt());
    if (String(url).endsWith(`/${modalId}/ack`)) return jsonResponse({ code: "STALE_KEY_MODAL_VERSION" }, 409);
    return jsonResponse(page([modal()]));
  }, getProjection: () => ({ world: { presentation: { statusMetrics: [] } } }), prefillWorkbench() { prefills += 1; } });
  await ui.refresh();
  root.querySelector('[data-aemotion-modal-response="INVESTIGATE_PRESSURE_SOURCE"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(root.querySelector("[data-aemotion-key-modal]"));
  assert.equal(prefills, 0);
  ui.destroy(); dom.window.close();
});
