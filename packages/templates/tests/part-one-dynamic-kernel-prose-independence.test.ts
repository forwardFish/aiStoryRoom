import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildDynamicPartOneRuntimeWorkingSet,
} from "../src/story-package/dynamic-kernel-lite-runtime.js";
import {
  createInitialPartOneState,
  partOneSceneForSection,
} from "../src/story-package/part-one-runtime-engine.js";
import { loadPlayablePartOneRuntimePackage } from "../src/story-package/playable-part-one-runtime.js";
import type {
  PartOneAffordanceTemplate,
  PartOneRuntimePackage,
  PartOneState,
} from "../src/story-package/part-one-runtime-types.js";

const configRoot = resolve(__dirname, "../config");
const SURFACE_SUFFIX = " [surface-only rewrite]";

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

function rewriteSurface(option: PartOneAffordanceTemplate) {
  return {
    ...option,
    title: `${option.title}${SURFACE_SUFFIX}`,
    actionText: `${option.actionText}${SURFACE_SUFFIX}`,
    method: `${option.method}${SURFACE_SUFFIX}`,
    immediateIntent: `${option.immediateIntent}${SURFACE_SUFFIX}`,
    visibleTradeoff: `${option.visibleTradeoff}${SURFACE_SUFFIX}`,
    ...(option.protectedNarrative
      ? {
        protectedNarrative:
          `${option.protectedNarrative}${SURFACE_SUFFIX}`,
      }
      : {}),
    ...(option.fallbackContinuation
      ? {
        fallbackContinuation:
          `${option.fallbackContinuation}${SURFACE_SUFFIX}`,
      }
      : {}),
    ...(option.playerVisibleFallback
      ? {
        playerVisibleFallback: Object.fromEntries(
          Object.entries(option.playerVisibleFallback).map(
            ([key, value]) => [key, `${value}${SURFACE_SUFFIX}`],
          ),
        ) as PartOneAffordanceTemplate["playerVisibleFallback"],
      }
      : {}),
  };
}

test("surface prose rewrites cannot change Dynamic Kernel selection, pair, scores or Outcome hashes", () => {
  const originalPackage = packageUnderTest();
  const state = authorityState(originalPackage);
  const original = buildDynamicPartOneRuntimeWorkingSet(
    originalPackage,
    state,
    4,
  );

  const rewrittenPackage = structuredClone(originalPackage);
  rewrittenPackage.assets = rewrittenPackage.assets.map((asset) => {
    if (
      asset.assetType !== "DECISION_KERNEL"
      || !asset.sectionIds.includes("SEC-P1-02")
      || !Array.isArray(asset.payload.options)
    ) {
      return asset;
    }
    return {
      ...asset,
      payload: {
        ...asset.payload,
        options: asset.payload.options.map(rewriteSurface),
      },
    };
  });

  const rewritten = buildDynamicPartOneRuntimeWorkingSet(
    rewrittenPackage,
    state,
    4,
  );

  assert.equal(
    rewritten.openDecisionKernel.assetId,
    original.openDecisionKernel.assetId,
  );
  assert.equal(
    rewritten.decisionPoint.decisionPointId,
    original.decisionPoint.decisionPointId,
  );
  assert.deepEqual(
    rewritten.kernelSelection.selectedAffordanceIds,
    original.kernelSelection.selectedAffordanceIds,
  );
  assert.deepEqual(
    rewritten.kernelSelection.selectedOutcomeHashes,
    original.kernelSelection.selectedOutcomeHashes,
  );
  assert.deepEqual(
    rewritten.kernelSelection.candidates.map((candidate) => ({
      kernelId: candidate.kernelId,
      score: candidate.score,
      tieBreaker: candidate.tieBreaker,
      eligible: candidate.eligible,
      validAffordanceIds: candidate.validAffordanceIds,
      outcomeHashes: candidate.outcomeHashes,
      maximumOutcomeDistance: candidate.maximumOutcomeDistance,
    })),
    original.kernelSelection.candidates.map((candidate) => ({
      kernelId: candidate.kernelId,
      score: candidate.score,
      tieBreaker: candidate.tieBreaker,
      eligible: candidate.eligible,
      validAffordanceIds: candidate.validAffordanceIds,
      outcomeHashes: candidate.outcomeHashes,
      maximumOutcomeDistance: candidate.maximumOutcomeDistance,
    })),
  );

  assert.equal(
    rewritten.decisionAffordances.every(
      (affordance) => affordance.actionText.endsWith(SURFACE_SUFFIX),
    ),
    true,
  );
  assert.notDeepEqual(
    rewritten.decisionAffordances.map((item) => item.actionText),
    original.decisionAffordances.map((item) => item.actionText),
  );
});
