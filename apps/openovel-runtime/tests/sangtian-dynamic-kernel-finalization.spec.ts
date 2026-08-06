import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import templatesPackage, {
  type KernelSelectionTrace,
  type PartOneActionSettlement,
  type PartOnePendingConsequenceState,
  type PartOneRuntimePackage,
  type PartOneState,
} from "@ai-story/templates";
import {
  nextSangtianOptions,
  type PreparedSangtianDecision,
} from "../src/sangtian-decisions.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const configRoot = path.resolve(
  currentDir,
  "../../../packages/templates/config",
);
const SYNTHETIC_RULE_ID = "PCR-NEUTRAL-FINALIZATION-DUE";
const SYNTHETIC_CONSEQUENCE_ID = "PC-NEUTRAL-FINALIZATION-DUE";

type EventWithKernelTrace = PartOneActionSettlement["event"] & {
  nextKernelSelection?: KernelSelectionTrace;
};

function packageUnderTest() {
  const pkg = structuredClone(
    templatesPackage.loadPartOneRuntimePackage(
      "sangtian",
      configRoot,
    ).package,
  );
  const templateRule = pkg.assets.find((asset) => (
    asset.assetType === "PENDING_CONSEQUENCE_RULE"
    && asset.sectionIds.includes("SEC-P1-02")
  ));
  assert.ok(templateRule);
  pkg.assets.push({
    ...structuredClone(templateRule),
    assetId: SYNTHETIC_RULE_ID,
    sectionIds: ["SEC-P1-02"],
    requirementIds: [],
    decisionKernelIds: ["DK-P1-WITNESS-ACCESS"],
    causalArcIds: [],
    actorRefs: [],
    retrievalTags: [
      "PART-01",
      "SEC-P1-02",
      "PENDING_CONSEQUENCE",
    ],
  });
  return pkg;
}

function authorityState(pkg: PartOneRuntimePackage): PartOneState {
  const state = templatesPackage.createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = templatesPackage.partOneSceneForSection("SEC-P1-02");
  state.turnNumber = 4;
  state.sectionTurnNumber = 0;
  state.completedKernelIds = [];
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
  state.pendingConsequences = [dueConsequence()];
  return state;
}

function dueConsequence(): PartOnePendingConsequenceState {
  return {
    consequenceId: SYNTHETIC_CONSEQUENCE_ID,
    causedByEventId: "EVENT-NEUTRAL-FINALIZATION-CAUSE",
    ruleAssetId: SYNTHETIC_RULE_ID,
    summary: "presentation-only-finalization-pressure",
    payoffBeat: {
      beatId: "BEAT-NEUTRAL-FINALIZATION-DUE",
      actorRefs: [],
      action: "presentation-only-finalization-pressure",
      requiredTermGroups: [],
      resultCeiling: "presentation-only-finalization-pressure",
    },
    dueTurn: 5,
    priority: "P0",
    status: "PENDING",
  };
}

test("next Kernel trace is compiled from the final PAID consequence state", () => {
  assert.equal(
    typeof templatesPackage.projectFinalizedPartOneSelectionState,
    "function",
  );
  assert.equal(typeof templatesPackage.withPartOneDecisionPin, "function");
  assert.equal(typeof templatesPackage.finalizePartOneSettlement, "function");

  const pkg = packageUnderTest();
  const state = authorityState(pkg);
  const current = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    state.turnNumber,
  );
  const chosen = current.decisionAffordances[0]!;

  const settlement = templatesPackage.settlePartOneAction(
    pkg,
    state,
    {
      source: "RECOMMENDED",
      decisionId: chosen.affordanceTemplateId,
      decisionKernelId: chosen.decisionKernelId,
      affordanceTemplateId: chosen.affordanceTemplateId,
      label: chosen.title,
      actionText: chosen.actionText,
      targetRef: chosen.target.id,
    },
    5,
  );
  const event = settlement.event as EventWithKernelTrace;
  assert.ok(
    event.duePendingConsequenceIds.includes(SYNTHETIC_CONSEQUENCE_ID),
  );
  assert.ok(event.nextKernelSelection);
  assert.notEqual(
    event.nextKernelSelection.stateFingerprint,
    templatesPackage.stableSha256(settlement.proposedState),
  );

  const prepared: PreparedSangtianDecision = {
    package: pkg,
    settlement,
    selectedOption: null,
  };
  const precommitOptions = nextSangtianOptions(prepared);
  assert.deepEqual(
    precommitOptions.map((option) => option.id),
    event.nextKernelSelection.selectedAffordanceIds,
  );
  assert.equal(
    precommitOptions.every((option) => (
      option.effect?.decisionPointId
      === event.nextDecisionPoint.decisionPointId
    )),
    true,
  );

  const finalized = templatesPackage.finalizePartOneSettlement(
    settlement,
    [...event.duePendingConsequenceIds],
  );
  const paid = finalized.proposedState.pendingConsequences.find(
    (item) => item.consequenceId === SYNTHETIC_CONSEQUENCE_ID,
  );
  assert.equal(paid?.status, "PAID");
  assert.equal(
    event.nextKernelSelection.stateFingerprint,
    templatesPackage.stableSha256(finalized.proposedState),
  );

  const recovered = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    finalized.proposedState,
    finalized.proposedState.turnNumber,
    {
      mode: "DYNAMIC_LITE",
      pin: {
        decisionKernelId: event.nextDecisionPoint.decisionKernelId,
        decisionPointId: event.nextDecisionPoint.decisionPointId,
        affordanceIds: [
          ...event.nextKernelSelection.selectedAffordanceIds,
        ],
        outcomeHashes: [
          ...event.nextKernelSelection.selectedOutcomeHashes,
        ],
      },
    },
  );
  assert.equal(
    recovered.decisionPoint.decisionKernelId,
    event.nextDecisionPoint.decisionKernelId,
  );
  assert.equal(
    recovered.decisionPoint.decisionPointId,
    event.nextDecisionPoint.decisionPointId,
  );
  assert.deepEqual(
    recovered.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
    event.nextKernelSelection.selectedAffordanceIds,
  );
  assert.deepEqual(
    recovered.kernelSelection.selectedOutcomeHashes,
    event.nextKernelSelection.selectedOutcomeHashes,
  );
});
