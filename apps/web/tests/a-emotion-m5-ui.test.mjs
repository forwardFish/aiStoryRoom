import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createAEmotionM1Ui } from "../public/a-emotion-m1-ui.js";

const eventId = `evt_${"a".repeat(32)}`;
const modalId = `mdl_${"b".repeat(32)}`;
const aggregateId = `agg_${"c".repeat(32)}`;

function fixture() {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"><main class="causal-center"><article data-testid="existing-center">现有中央剧情</article></main><aside class="causal-right"><section class="maneuver-panel" data-testid="maneuver-panel"><textarea id="maneuverCustomText">保留草稿</textarea></section></aside></div></body></html>`, { url: "http://game.test/game?runId=room-m5" });
  return { dom, root: dom.window.document.querySelector("#root") };
}
function modal() { return { schemaVersion: "a_emotion_key_modal_v1", modalId, eventId, modalType: "STAGE_VICTORY", triggerCode: "CONTROL_ORIGINAL_LEDGER", triggerVersion: 1, projectionVersion: 1, stateVersion: 1, priority: 100, title: "你夺回了主动权", summary: "已确认的行动和证据让你取得了一项具体、可继续利用的阶段收益。", facts: ["里程碑：CONTROL_ORIGINAL_LEDGER", "reform_progress +12"], responseOptions: [{ code: "CONTINUE_AFTER_MILESTONE", label: "继续推进", preferredEntry: "PLAN", intentKey: "continue_after_milestone", prefillText: "利用阶段收益规划下一步行动。" }, { code: "DEFER_RESPONSE", label: "稍后查看", preferredEntry: "DEFER", intentKey: null, prefillText: null }], ariaLive: "polite", occurredAt: "2026-08-10T00:00:00.000Z", isShown: false, isAcknowledged: false }; }
function item() { return { schemaVersion: "a_emotion_m2_projection_v1", projectionVersion: 1, stateVersion: 1, eventSequence: 5, aggregateId, stageId: "stage-4", sharedObjectId: "stage-milestone", eventFamily: "STAGE_MILESTONE", category: "RELATED", disclosure: "CONFIRMED", severity: "MAJOR", centerCardType: "STAGE_VICTORY", title: "阶段胜利", summary: "一个由已确认行动与证据支持的阶段里程碑已经达成。", sourceStatus: "里程碑与收益已确认", knownFacts: ["里程碑首次从未达成进入已达成"], visibleImpacts: [{ key: "reform_progress", label: "改桑进度", before: 0, after: 12, delta: 12, suffix: "%", safeReason: "阶段里程碑的确定性收益" }], responseOptions: [{ code: "CONTINUE_AFTER_MILESTONE", label: "继续推进", preferredEntry: "PLAN", targetRoleKey: null, intentKey: "continue_after_milestone", prefillText: "利用刚刚取得的确定性收益，规划下一步行动。" }, { code: "DEFER_RESPONSE", label: "稍后查看", preferredEntry: "DEFER", targetRoleKey: null, intentKey: null, prefillText: null }], evidenceRefs: ["fact-code:ORIGINAL_DOCUMENT_CONTROL_CONFIRMED"], keyModal: modal(), occurredAt: "2026-08-10T00:00:00.000Z", eventId, deliverySequence: 5, isUnread: true, isAcknowledged: false, isResolved: false }; }
function page() { return { schemaVersion: "event_delivery_page_v1", deliveries: [], nextAfterDeliverySequence: 0, hasMore: false, interactionFeed: { schemaVersion: "a_emotion_m2_feed_v1", items: [item()], unreadCount: 1, nextCursor: null, hasMore: false }, keyModals: [modal()] }; }
function receipt(acknowledgedAt = null) { return { schemaVersion: "a_emotion_key_modal_receipt_v1", modalId, eventId, projectionVersion: 1, stateVersion: 1, triggerVersion: 1, shownAt: "2026-08-10T00:00:01.000Z", acknowledgedAt }; }
function response(value, status = 200) { return Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })); }

test("M5 STAGE_VICTORY renders only in approved modal and right-rail world situation", async () => {
  const { dom, root } = fixture();
  const textarea = root.querySelector("#maneuverCustomText"); textarea.focus(); textarea.setSelectionRange(1, 4);
  let prefills = 0;
  const calls = [];
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: "room-m5", fetchImpl: async (url) => { calls.push(String(url)); if (String(url).endsWith(`/${modalId}/shown`)) return response(receipt()); if (String(url).endsWith(`/${modalId}/ack`)) return response(receipt("2026-08-10T00:00:02.000Z")); return response(page()); }, getProjection: () => ({}), prefillWorkbench(input) { prefills += 1; assert.equal(input.intentKey, "continue_after_milestone"); } });
  await ui.refresh();
  assert.ok(root.querySelector('[aria-label="世界局势"]'));
  assert.ok(root.querySelector('[data-testid="aemotion-stage-victory-modal"]'));
  assert.ok(root.querySelector('[data-testid="existing-center"]'));
  assert.equal(root.querySelector("[data-aemotion-m1-metric-hint]"), null);
  assert.equal(root.querySelector("#maneuverCustomText").value, "保留草稿");
  root.querySelector('[data-aemotion-modal-response="CONTINUE_AFTER_MILESTONE"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(prefills, 1);
  assert.equal(root.querySelector("[data-aemotion-key-modal]"), null);
  assert.equal(root.querySelector("#maneuverCustomText").value, "保留草稿");
  assert.equal(dom.window.document.activeElement.id, "maneuverCustomText");
  assert.equal(calls.filter((value) => value.endsWith(`/${modalId}/shown`)).length, 1);
  assert.equal(calls.filter((value) => value.endsWith(`/${modalId}/ack`)).length, 1);
  ui.destroy(); dom.window.close();
});

test("M5 stale modal receipt is fail-closed and does not prefill", async () => {
  const { dom, root } = fixture(); let prefills = 0;
  const ui = createAEmotionM1Ui({ root, window: dom.window, runId: "room-m5", fetchImpl: async (url) => { if (String(url).endsWith(`/${modalId}/shown`)) return response(receipt()); if (String(url).endsWith(`/${modalId}/ack`)) return response({ code: "STALE_KEY_MODAL_VERSION" }, 409); return response(page()); }, getProjection: () => ({}), prefillWorkbench() { prefills += 1; } });
  await ui.refresh();
  root.querySelector('[data-aemotion-modal-response="CONTINUE_AFTER_MILESTONE"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(root.querySelector('[data-testid="aemotion-stage-victory-modal"]'));
  assert.equal(prefills, 0);
  ui.destroy(); dom.window.close();
});
