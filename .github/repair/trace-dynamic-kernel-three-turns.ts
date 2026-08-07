import { resolve } from "node:path";
import {
  loadPlayablePartOneRuntimePackage,
} from "../../packages/templates/src/story-package/playable-part-one-runtime";
import {
  buildDynamicPartOneRuntimeWorkingSet,
} from "../../packages/templates/src/story-package/dynamic-kernel-lite-runtime";
import {
  settleDynamicPartOneAction,
} from "../../packages/templates/src/story-package/dynamic-kernel-lite-settlement";
import {
  createInitialPartOneState,
} from "../../packages/templates/src/story-package/part-one-runtime-engine";
import type {
  PartOneRuntimeAffordance,
} from "../../packages/templates/src/story-package/part-one-runtime-types";

const pkg = loadPlayablePartOneRuntimePackage(
  "sangtian",
  resolve("packages/templates/config"),
).package;

function incoming(affordance: PartOneRuntimeAffordance) {
  return {
    source: "RECOMMENDED" as const,
    decisionId: affordance.affordanceTemplateId,
    decisionKernelId: affordance.decisionKernelId,
    affordanceTemplateId: affordance.affordanceTemplateId,
    label: affordance.title,
    actionText: affordance.actionText,
    targetRef: affordance.target.id,
  };
}

function pinned(
  state: ReturnType<typeof createInitialPartOneState>,
  turnNumber: number,
  kernelId: string,
  affordanceId: string,
) {
  const workingSet = buildDynamicPartOneRuntimeWorkingSet(
    pkg,
    state,
    turnNumber,
    {
      mode: "DYNAMIC_LITE",
      pin: {
        decisionKernelId: kernelId,
        decisionPointId: kernelId,
      },
    },
  );
  const affordance = workingSet.decisionAffordances.find(
    (item) => item.affordanceTemplateId === affordanceId,
  );
  if (!affordance) {
    throw new Error(`TRACE_AFFORDANCE_MISSING:${affordanceId}`);
  }
  return { workingSet, affordance };
}

const initial = createInitialPartOneState(pkg);
const opening = settleDynamicPartOneAction(
  pkg,
  initial,
  {
    source: "RECOMMENDED",
    decisionId: "opening_d1",
    actionText: "opening_d1",
  },
  1,
);
const execution = pinned(
  opening.proposedState,
  1,
  "DK-P1-EXECUTION-SCOPE",
  "DK-P1-EXECUTION-SCOPE-OPT-01",
);
const executionSettlement = settleDynamicPartOneAction(
  pkg,
  opening.proposedState,
  incoming(execution.affordance),
  2,
  { currentWorkingSetOverride: execution.workingSet },
);
const responsibility = pinned(
  executionSettlement.proposedState,
  2,
  "DK-P1-RESPONSIBILITY-RECORD",
  "DK-P1-RESPONSIBILITY-RECORD-OPT-01",
);
const responsibilitySettlement = settleDynamicPartOneAction(
  pkg,
  executionSettlement.proposedState,
  incoming(responsibility.affordance),
  3,
  { currentWorkingSetOverride: responsibility.workingSet },
);
const trace = responsibilitySettlement.event.nextKernelSelection;

console.log(JSON.stringify({
  opening: {
    changedStatePaths: opening.event.changedStatePaths,
    completedKernelIds: opening.proposedState.completedKernelIds,
    next: opening.event.nextKernelSelection,
  },
  execution: {
    changedStatePaths: executionSettlement.event.changedStatePaths,
    completedKernelIds: executionSettlement.proposedState.completedKernelIds,
    next: executionSettlement.event.nextKernelSelection,
  },
  responsibility: {
    changedStatePaths: responsibilitySettlement.event.changedStatePaths,
    sectionId: responsibilitySettlement.proposedState.sectionId,
    completedKernelIds: responsibilitySettlement.proposedState.completedKernelIds,
    review: responsibilitySettlement.proposedState.review,
    evidence: responsibilitySettlement.proposedState.evidence,
    witness: responsibilitySettlement.proposedState.witness,
    responsibility: responsibilitySettlement.proposedState.responsibility,
    pendingConsequences: responsibilitySettlement.proposedState.pendingConsequences,
    nextDecisionPoint: responsibilitySettlement.event.nextDecisionPoint,
    next: trace,
  },
  sectionTwoKernelStructures: pkg.assets
    .filter((asset) => asset.assetType === "DECISION_KERNEL")
    .filter((asset) => asset.sectionIds.includes("SEC-P1-02"))
    .map((asset) => ({
      kernelId: asset.assetId,
      requirementIds: asset.requirementIds,
      causalArcIds: asset.causalArcIds,
      stateDependencies: asset.stateDependencies,
    })),
}, null, 2));
