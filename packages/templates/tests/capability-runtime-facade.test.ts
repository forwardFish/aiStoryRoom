import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildPartOneRuntimeWorkingSet,
  createInitialPartOneState,
  loadPartOneRuntimePackage,
  settlePartOneAction,
} from "../src/runtime-entry";

const configRoot = resolve(__dirname, "../config");
const CAPABILITY_ACTION_PREFIX = "\u2063OMW_CAPABILITY_V1:";
const CAPABILITY_ACTION_SUFFIX = "\u2063";

function capabilityEnvelope(decisionPointId: string, action: string) {
  const encoded = Buffer.from(JSON.stringify({
    schemaVersion: "omw-capability-action-v1",
    decisionPointId,
    action,
  }), "utf8").toString("base64url");
  return `${CAPABILITY_ACTION_PREFIX}${encoded}${CAPABILITY_ACTION_SUFFIX}`;
}

test("a capability action consumes a turn without completing or impersonating an authored option", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const state = createInitialPartOneState(pkg);
  const workingSet = buildPartOneRuntimeWorkingSet(pkg, state, 0);
  const action = "先询问在场见证人：当前谁有权接触原册，再决定正式处置。";

  const settlement = settlePartOneAction(pkg, state, {
    source: "FREE_TEXT",
    actionText: capabilityEnvelope(workingSet.decisionPoint.decisionPointId, action),
    targetRef: "public_frame",
  }, 1);

  assert.equal(settlement.event.actionSource, "FREE_TEXT_CAPABILITY");
  assert.equal(settlement.event.actionText, action);
  assert.equal(settlement.event.decisionKernelId, workingSet.openDecisionKernel.assetId);
  assert.equal(settlement.event.nextDecisionPoint.decisionPointId, workingSet.decisionPoint.decisionPointId);
  assert.equal(settlement.event.affordanceTemplateId, null);
  assert.deepEqual(settlement.event.statePatch, {});
  assert.deepEqual(settlement.event.durableEffects, []);
  assert.deepEqual(settlement.event.createdPendingConsequenceIds, []);
  assert.equal(settlement.appliedAffordance, null);
  assert.deepEqual(
    settlement.proposedState.completedKernelIds,
    settlement.beforeState.completedKernelIds,
  );
  assert.equal(settlement.proposedState.sectionId, settlement.beforeState.sectionId);
  assert.deepEqual(settlement.proposedState.durableState, settlement.beforeState.durableState);
  assert.equal(settlement.proposedState.turnNumber, 1);
  assert.equal(settlement.proposedState.sectionTurnNumber, 1);
  assert.match(
    settlement.event.narrativePlan.nextStoryBeat.playerOutcome,
    /没有完成当前正式处置/u,
  );
  assert.equal(
    settlement.event.narrativePlan.nextStoryBeat.stopCondition,
    workingSet.decisionPoint.prompt,
  );
});

test("an unmarked free-text action remains fail-closed", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const state = createInitialPartOneState(pkg);

  assert.throws(
    () => settlePartOneAction(pkg, state, {
      source: "FREE_TEXT",
      actionText: "Do something unrelated without a bound capability.",
      targetRef: "public_frame",
    }, 1),
    /PART_ONE_NEXT_STORY_BEAT_KERNEL_MISSING/u,
  );
});

test("an authored option still uses the original settlement path", () => {
  const pkg = loadPartOneRuntimePackage("sangtian", configRoot).package;
  const state = createInitialPartOneState(pkg);
  const workingSet = buildPartOneRuntimeWorkingSet(pkg, state, 0);
  const option = workingSet.decisionAffordances[0]!;

  const settlement = settlePartOneAction(pkg, state, {
    source: "RECOMMENDED",
    decisionKernelId: option.decisionKernelId,
    affordanceTemplateId: option.affordanceTemplateId,
    label: option.title,
    actionText: option.actionText,
    targetRef: option.target.id,
  }, 1);

  assert.equal(settlement.event.actionSource, "RECOMMENDED");
  assert.equal(settlement.event.affordanceTemplateId, option.affordanceTemplateId);
  assert.equal(settlement.appliedAffordance?.affordanceTemplateId, option.affordanceTemplateId);
  assert.equal(
    settlement.proposedState.completedKernelIds?.includes(option.decisionKernelId),
    true,
  );
});
