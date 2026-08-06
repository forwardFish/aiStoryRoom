import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import templatesPackage, {
  type KernelSelectionTrace,
  type PartOneActionSettlement,
  type PartOneRuntimePackage,
  type PartOneState,
} from "@ai-story/templates";
import {
  nextSangtianOptions,
  type PreparedSangtianDecision,
} from "../src/sangtian-decisions.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const configRoot = path.resolve(currentDir, "../../../packages/templates/config");

type EventWithKernelTrace = PartOneActionSettlement["event"] & {
  nextKernelSelection?: KernelSelectionTrace;
};

function packageUnderTest() {
  return templatesPackage.loadPartOneRuntimePackage("sangtian", configRoot).package;
}

function sectionTwoState(pkg: PartOneRuntimePackage): PartOneState {
  const state = templatesPackage.createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = templatesPackage.partOneSceneForSection("SEC-P1-02");
  state.turnNumber = 4;
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

function stateForAuthority(pkg: PartOneRuntimePackage) {
  const state = sectionTwoState(pkg);
  state.review.authority = "UNDECIDED";
  state.review.procedureStatus = "UNDECIDED";
  state.witness.accessStatus = "PROTECTED_SECRETLY";
  state.evidence.chainStatus = "TRACEABLE";
  state.evidence.primaryCustodianRef = "actor.qingliu_magistrate";
  return state;
}

function stateForWitness(pkg: PartOneRuntimePackage) {
  const state = sectionTwoState(pkg);
  state.review.authority = "JOINT";
  state.review.procedureStatus = "JOINT_REVIEW";
  state.witness.accessStatus = "UNKNOWN";
  state.evidence.chainStatus = "TRACEABLE";
  state.evidence.primaryCustodianRef = "actor.qingliu_magistrate";
  return state;
}

test("production template entry exposes state-driven Dynamic Kernel selection", () => {
  const pkg = packageUnderTest();
  const authority = templatesPackage.buildPartOneRuntimeWorkingSet(pkg, stateForAuthority(pkg), 4);
  const witness = templatesPackage.buildPartOneRuntimeWorkingSet(pkg, stateForWitness(pkg), 4);
  assert.equal(authority.openDecisionKernel.assetId, "DK-P1-REVIEW-AUTHORITY");
  assert.equal(witness.openDecisionKernel.assetId, "DK-P1-WITNESS-ACCESS");
  assert.equal(authority.kernelSelection.mode, "DYNAMIC_LITE");
  assert.equal(witness.kernelSelection.mode, "DYNAMIC_LITE");
});

test("next Sangtian options replay the committed pair without a model provider", () => {
  const pkg = packageUnderTest();
  const state = stateForAuthority(pkg);
  const current = templatesPackage.buildPartOneRuntimeWorkingSet(pkg, state, 4);
  const chosen = current.decisionAffordances[0]!;
  const settlement = templatesPackage.settlePartOneAction(pkg, state, {
    source: "RECOMMENDED",
    decisionId: chosen.affordanceTemplateId,
    decisionKernelId: chosen.decisionKernelId,
    affordanceTemplateId: chosen.affordanceTemplateId,
    label: chosen.title,
    actionText: chosen.actionText,
    targetRef: chosen.target.id,
  }, 5);
  const prepared: PreparedSangtianDecision = {
    package: pkg,
    settlement,
    selectedOption: null,
  };
  const first = nextSangtianOptions(prepared);
  const second = nextSangtianOptions(prepared);
  const event = settlement.event as EventWithKernelTrace;
  assert.ok(event.nextKernelSelection);
  assert.deepEqual(first.map((option) => option.id), second.map((option) => option.id));
  assert.deepEqual(
    first.map((option) => option.id),
    event.nextKernelSelection.selectedAffordanceIds,
  );
  assert.equal(
    first.every((option) => (
      option.effect?.decisionPointId === event.nextDecisionPoint.decisionPointId
    )),
    true,
  );
});
