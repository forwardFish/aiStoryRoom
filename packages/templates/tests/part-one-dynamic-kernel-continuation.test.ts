import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildDynamicPartOneRuntimeWorkingSet,
} from "../src/story-package/dynamic-kernel-lite-runtime.js";
import {
  packageForDynamicCapabilityAction,
  settleDynamicPartOneAction,
} from "../src/story-package/dynamic-kernel-lite-settlement.js";
import {
  createInitialPartOneState,
  partOneSceneForSection,
} from "../src/story-package/part-one-runtime-engine.js";
import { loadPlayablePartOneRuntimePackage } from "../src/story-package/playable-part-one-runtime.js";
import type {
  PartOneRuntimePackage,
  PartOneState,
} from "../src/story-package/part-one-runtime-types.js";

const configRoot = resolve(__dirname, "../config");

function packageUnderTest() {
  return loadPlayablePartOneRuntimePackage("sangtian", configRoot).package;
}

function sectionTwoState(pkg: PartOneRuntimePackage): PartOneState {
  const state = createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = partOneSceneForSection("SEC-P1-02");
  state.turnNumber = 8;
  state.sectionTurnNumber = 0;
  state.completedKernelIds = [];
  state.pendingConsequences = [];
  state.partCompletionStatus = "IN_PROGRESS";
  state.causalArcStages = {
    ...(state.causalArcStages || {}),
    "ARC-P1-CUSTODY-CONTEST": "OPEN",
  };
  return state;
}

function continuationState(pkg: PartOneRuntimePackage) {
  const state = sectionTwoState(pkg);
  const section = pkg.sections.find((item) => item.sectionId === state.sectionId);
  assert.ok(section);
  state.completedKernelIds = [...section.activeDecisionKernelIds];
  state.sectionTurnNumber = section.activeDecisionKernelIds.length;
  return state;
}

test("a Floor continuation affordance settles without forcing the base Kernel option list", () => {
  const pkg = packageUnderTest();
  const state = continuationState(pkg);
  const current = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 8);
  assert.notEqual(
    current.decisionPoint.decisionPointId,
    current.decisionPoint.decisionKernelId,
  );
  const chosen = current.decisionAffordances[0]!;
  const settlement = settleDynamicPartOneAction(pkg, state, {
    source: "RECOMMENDED",
    decisionId: chosen.affordanceTemplateId,
    decisionKernelId: chosen.decisionKernelId,
    affordanceTemplateId: chosen.affordanceTemplateId,
    label: chosen.title,
    actionText: chosen.actionText,
    targetRef: chosen.target.id,
  }, 9);
  assert.equal(
    settlement.appliedAffordance?.affordanceTemplateId,
    chosen.affordanceTemplateId,
  );
  assert.equal(settlement.event.affordanceTemplateId, chosen.affordanceTemplateId);
  assert.ok(settlement.event.nextKernelSelection);
});

test("the observe-only capability scaffold leaves a Floor continuation package unchanged", () => {
  const pkg = packageUnderTest();
  const state = continuationState(pkg);
  assert.equal(packageForDynamicCapabilityAction(pkg, state, 9), pkg);
});
