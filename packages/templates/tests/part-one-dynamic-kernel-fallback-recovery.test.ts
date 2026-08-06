import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildDynamicPartOneRuntimeWorkingSet,
  type KernelSelectionTrace,
} from "../src/story-package/dynamic-kernel-lite-runtime.js";
import {
  buildCommittedLegacyFallbackWorkingSet,
} from "../src/story-package/dynamic-kernel-lite-settlement.js";
import {
  createInitialPartOneState,
  partOneSceneForSection,
} from "../src/story-package/part-one-runtime-engine.js";
import {
  settlePartOneAction as settleProductionPartOneAction,
} from "../src/runtime-entry.js";
import { loadPlayablePartOneRuntimePackage } from "../src/story-package/playable-part-one-runtime.js";
import type {
  PartOneRuntimePackage,
  PartOneState,
} from "../src/story-package/part-one-runtime-types.js";

const configRoot = resolve(__dirname, "../config");
const CAPABILITY_ACTION_PREFIX = "\u2063OMW_CAPABILITY_V1:";
const CAPABILITY_ACTION_SUFFIX = "\u2063";

function packageUnderTest() {
  return loadPlayablePartOneRuntimePackage(
    "sangtian",
    configRoot,
  ).package;
}

function authorityState(pkg: PartOneRuntimePackage): PartOneState {
  const state = createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = partOneSceneForSection("SEC-P1-02");
  state.turnNumber = 4;
  state.sectionTurnNumber = 0;
  state.completedKernelIds = [];
  state.pendingConsequences = [];
  state.partCompletionStatus = "IN_PROGRESS";
  state.review.authority = "UNDECIDED";
  state.review.procedureStatus = "UNDECIDED";
  state.witness.accessStatus = "PROTECTED_SECRETLY";
  state.evidence.chainStatus = "TRACEABLE";
  state.evidence.primaryCustodianRef = "actor.qingliu_magistrate";
  state.causalArcStages = {
    ...(state.causalArcStages || {}),
    "ARC-P1-CUSTODY-CONTEST": "OPEN",
  };
  return state;
}

function duplicateOutcomePackage() {
  const pkg = structuredClone(packageUnderTest());
  const section = pkg.sections.find(
    (item) => item.sectionId === "SEC-P1-02",
  );
  assert.ok(section);
  section.activeDecisionKernelIds = ["DK-P1-REVIEW-AUTHORITY"];
  const kernel = pkg.assets.find(
    (item) => item.assetId === "DK-P1-REVIEW-AUTHORITY",
  );
  assert.ok(kernel);
  const options = Array.isArray(kernel.payload.options)
    ? kernel.payload.options
    : [];
  kernel.payload.options = options.map((option) => ({
    ...option,
    stateEffects: ["review.authority"],
    statePatch: { "review.authority": "JOINT" },
    durableEffects: [],
  }));
  return pkg;
}

function encodedCapabilityAction(
  decisionPointId: string,
  action: string,
) {
  const envelope = Buffer.from(JSON.stringify({
    schemaVersion: "omw-capability-action-v1",
    decisionPointId,
    action,
  }), "utf8").toString("base64url");
  return `${CAPABILITY_ACTION_PREFIX}${envelope}${CAPABILITY_ACTION_SUFFIX}`;
}

test("a committed Legacy fallback pair recovers without reapplying the Dynamic diversity gate", () => {
  const pkg = duplicateOutcomePackage();
  const state = authorityState(pkg);
  const fallback = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);

  assert.equal(fallback.kernelSelection.mode, "LEGACY_FALLBACK");
  assert.equal(fallback.kernelSelection.selectedAffordanceIds.length, 2);
  assert.equal(fallback.kernelSelection.selectedOutcomeHashes.length, 0);

  const recovered = buildCommittedLegacyFallbackWorkingSet(
    pkg,
    state,
    4,
    fallback.kernelSelection,
  );
  assert.equal(recovered.kernelSelection.mode, "PINNED_RECOVERY");
  assert.equal(
    recovered.decisionPoint.decisionKernelId,
    fallback.decisionPoint.decisionKernelId,
  );
  assert.equal(
    recovered.decisionPoint.decisionPointId,
    fallback.decisionPoint.decisionPointId,
  );
  assert.deepEqual(
    recovered.decisionAffordances.map(
      (item) => item.affordanceTemplateId,
    ),
    fallback.kernelSelection.selectedAffordanceIds,
  );
});

test("observe-only capability turns preserve and freeze an existing Legacy fallback surface", () => {
  const pkg = duplicateOutcomePackage();
  const state = authorityState(pkg);
  const fallback = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);
  assert.equal(fallback.kernelSelection.mode, "LEGACY_FALLBACK");

  const settlement = settleProductionPartOneAction(
    pkg,
    structuredClone(state),
    {
      source: "FREE_TEXT",
      actionText: encodedCapabilityAction(
        fallback.decisionPoint.decisionPointId,
        "Inspect only the public record without making a formal disposition.",
      ),
      targetRef: "public_frame",
    },
    5,
  );
  const event = settlement.event as typeof settlement.event & {
    nextKernelSelection?: KernelSelectionTrace;
  };

  assert.equal(event.actionSource, "FREE_TEXT_CAPABILITY");
  assert.equal(event.affordanceTemplateId, null);
  assert.deepEqual(event.statePatch, {});
  assert.deepEqual(event.durableEffects, []);
  assert.deepEqual(
    settlement.proposedState.completedKernelIds,
    state.completedKernelIds,
  );
  assert.equal(
    event.nextDecisionPoint.decisionKernelId,
    fallback.decisionPoint.decisionKernelId,
  );
  assert.equal(
    event.nextDecisionPoint.decisionPointId,
    fallback.decisionPoint.decisionPointId,
  );
  assert.ok(event.nextKernelSelection);
  assert.equal(event.nextKernelSelection.mode, "LEGACY_FALLBACK");
  assert.equal(event.nextKernelSelection.selectedAffordanceIds.length, 2);
  assert.equal(event.nextKernelSelection.selectedOutcomeHashes.length, 0);

  const recovered = buildCommittedLegacyFallbackWorkingSet(
    pkg,
    settlement.proposedState,
    5,
    event.nextKernelSelection,
  );
  assert.deepEqual(
    recovered.decisionAffordances.map(
      (item) => item.affordanceTemplateId,
    ),
    event.nextKernelSelection.selectedAffordanceIds,
  );
});

test("committed Legacy fallback recovery rejects a missing or tampered Affordance", () => {
  const pkg = duplicateOutcomePackage();
  const state = authorityState(pkg);
  const fallback = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);
  const tampered = structuredClone(fallback.kernelSelection);
  tampered.selectedAffordanceIds = [
    tampered.selectedAffordanceIds[0]!,
    "MISSING-FALLBACK-AFFORDANCE",
  ];

  assert.throws(() => buildCommittedLegacyFallbackWorkingSet(
    pkg,
    state,
    4,
    tampered,
  ), /PART_ONE_DYNAMIC_AFFORDANCE_NOT_FOUND|PART_ONE_COMMITTED_FALLBACK_RECOVERY_MISMATCH/u);
});

test("committed Legacy fallback recovery rejects a trace or state fingerprint mismatch", () => {
  const pkg = duplicateOutcomePackage();
  const state = authorityState(pkg);
  const fallback = buildDynamicPartOneRuntimeWorkingSet(pkg, state, 4);

  const tamperedTrace = structuredClone(fallback.kernelSelection);
  tamperedTrace.stateFingerprint = "TAMPERED";
  assert.throws(() => buildCommittedLegacyFallbackWorkingSet(
    pkg,
    state,
    4,
    tamperedTrace,
  ), /PART_ONE_COMMITTED_FALLBACK_STATE_FINGERPRINT_MISMATCH/u);

  const tamperedState = structuredClone(state);
  tamperedState.review.authority = "TAMPERED";
  assert.throws(() => buildCommittedLegacyFallbackWorkingSet(
    pkg,
    tamperedState,
    4,
    fallback.kernelSelection,
  ), /PART_ONE_COMMITTED_FALLBACK_STATE_FINGERPRINT_MISMATCH/u);
});
