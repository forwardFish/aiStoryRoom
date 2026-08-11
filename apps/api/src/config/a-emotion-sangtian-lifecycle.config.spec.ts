import assert from "node:assert/strict";
import test from "node:test";
import {
  aEmotionSangtianLifecycleAction,
  aEmotionSangtianLifecycleBridge,
  aEmotionSangtianPromiseBreakCodes,
  aEmotionSangtianPromiseRevealFactCodes
} from "./a-emotion-sangtian-lifecycle.config";

test("Sangtian lifecycle bridge uses exact author asset identifiers only", () => {
  const bridge = aEmotionSangtianLifecycleBridge();
  assert.equal(bridge.templateKey, "sangtian");
  assert.equal(bridge.custodyAssetKey, "asset_s2_document_custody");
  assert.equal(bridge.sharedObjectId, "original-grain-ledger");
  assert.equal(bridge.actions.some((action) => action.actionKey === "main_s2_xunfu_seize_drafts"), true);
  assert.equal(bridge.actions.some((action) => action.actionKey === "main_s2_governor_dual_verification"), true);
  assert.equal(bridge.actions.every((action) => !/[\u4e00-\u9fff]/u.test(`${action.actionKey}:${action.effectKey}:${action.factKey}`)), true);
});

test("promise mappings distinguish copy-only, custody fulfillment and evidence reveal", () => {
  const broken = aEmotionSangtianPromiseBreakCodes();
  assert.ok(broken.actionCodes.includes("main_s2_xunfu_seize_drafts"));
  assert.ok(broken.actionCodes.includes("main_s2_magistrate_send_copy"));
  assert.ok(broken.actionCodes.includes("main_s2_magistrate_hide_original"));
  assert.ok(aEmotionSangtianPromiseRevealFactCodes().includes("fact_s4_clerk_certify_transfer_chain"));
  assert.equal(aEmotionSangtianLifecycleAction("main_s2_governor_dual_verification")?.promiseOutcome, "CUSTODY_RECEIVER_FULFILLED");
  assert.equal(aEmotionSangtianLifecycleAction("unrelated") , null);
});
