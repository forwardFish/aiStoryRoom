import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createAEmotionM1Ui } from "../public/a-emotion-m1-ui.js";

const eventId = `evt_${"e".repeat(32)}`;
const modalId = `mdl_${"m".repeat(32)}`;
function jsonResponse(value, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(value); } }; }
function fixture() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"><aside class="causal-right"><section class="maneuver-panel"><textarea id="maneuverCustomText">保留草稿</textarea></section></aside><main class="causal-center"><section data-testid="existing-center">现有决策</section></main></div></body></html>`, { url: "http://game.test/game?runId=room-m4" });
  return { dom, root: dom.window.document.querySelector("#root") };
}
function modal(overrides = {}) { return {
  schemaVersion: "a_emotion_key_modal_v1", modalId, eventId, modalType: "PROMISE_BROKEN",
  triggerCode: "PROMISE_BROKEN_REVEALED", triggerVersion: 2, projectionVersion: 2,
  stateVersion: 2, priority: 200, title: "承诺破裂", summary: "权威证据确认正式承诺已被违背。",
  facts: ["承诺双方和期限已登记", "证据已经确认"],
  responseOptions: [
    { code: "RESPOND_TO_REVEALED_PROMISE", label: "立即回应", preferredEntry: "TALK", intentKey: "respond_to_revealed_promise", prefillText: "就已确认的承诺违背提出回应。" },
    { code: "DEFER_RESPONSE", label: "稍后处理", preferredEntry: "DEFER", intentKey: null, prefillText: null }
  ],
  ariaLive: "assertive", occurredAt: "2026-08-10T00:00:00.000Z", isShown: false, isAcknowledged: false, ...overrides
}; }
function page(modals) { return { schemaVersion: "event_delivery_page_v1", deliveries: [], nextAfterDeliverySequence: 0, hasMore: false, interactionFeed: { schemaVersion: "a_emotion_m2_feed_v1", items: [], unreadCount: 0, nextCursor: null, hasMore: false }, keyModals: modals }; }
function receipt(acknowledgedAt = null) { return { schemaVersion: "a_emotion_key_modal_receipt_v1", modalId, eventId, projectionVersion: 2, stateVersion: 2, triggerVersion: 2, shownAt: "2026-08-10T00:00:01.000Z", acknowledgedAt }; }

test("M4 PROMISE_BROKEN uses the approved modal and preserves central content, draft and focus", async () => {
  const { dom, root } = fixture();
  const textarea = root.querySelector("#maneuverCustomText");
  textarea.focus(); textarea.setSelectionRange(1, 4);
  const requests = [];
  let prefills = 0;
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: "room-m4", fetchImpl: async (url) => {
    requests.push(String(url));
    if (String(url).endsWith(`/${modalId}/shown`)) return jsonResponse(receipt());
    if (String(url).endsWith(`/${modalId}/ack`)) return jsonResponse(receipt("2026-08-10T00:00:02.000Z"));
    return jsonResponse(page([modal()]));
  }, getProjection: () => ({}), prefillWorkbench(input) { prefills += 1; assert.equal(input.intentKey, "respond_to_revealed_promise"); } });
  await ui.refresh();
  const dialog = root.querySelector('[data-testid="aemotion-promise-broken-modal"]');
  assert.ok(dialog); assert.equal(dialog.getAttribute("aria-live"), "assertive");
  assert.ok(root.querySelector('[data-testid="existing-center"]'));
  assert.equal(root.querySelector("#maneuverCustomText").value, "保留草稿");
  dialog.querySelector('[data-aemotion-modal-response="RESPOND_TO_REVEALED_PROMISE"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(prefills, 1);
  assert.equal(root.querySelector("[data-aemotion-key-modal]"), null);
  assert.equal(root.querySelector("#maneuverCustomText").value, "保留草稿");
  assert.equal(dom.window.document.activeElement.id, "maneuverCustomText");
  assert.equal(requests.filter((value) => value.endsWith(`/${modalId}/shown`)).length, 1);
  assert.equal(requests.filter((value) => value.endsWith(`/${modalId}/ack`)).length, 1);
  ui.destroy(); dom.window.close();
});

test("M4 modal is not locally acknowledged when server receipt is stale", async () => {
  const { dom, root } = fixture();
  let prefills = 0;
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: "room-m4", fetchImpl: async (url) => {
    if (String(url).endsWith(`/${modalId}/shown`)) return jsonResponse(receipt());
    if (String(url).endsWith(`/${modalId}/ack`)) return jsonResponse({ code: "STALE_KEY_MODAL_VERSION" }, 409);
    return jsonResponse(page([modal()]));
  }, getProjection: () => ({}), prefillWorkbench() { prefills += 1; } });
  await ui.refresh();
  root.querySelector('[data-aemotion-modal-response="RESPOND_TO_REVEALED_PROMISE"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(root.querySelector('[data-testid="aemotion-promise-broken-modal"]'));
  assert.equal(prefills, 0);
  ui.destroy(); dom.window.close();
});
