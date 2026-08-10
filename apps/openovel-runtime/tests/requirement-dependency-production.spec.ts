import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPartOneRuntimeWorkingSet,
  createInitialPartOneState,
  loadPartOneRuntimePackage,
  partOneSceneForSection,
} from "@ai-story/templates";

test("production runtime honors the tracked Requirement dependency graph", () => {
  const pkg = loadPartOneRuntimePackage("sangtian").package;
  const state = createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = partOneSceneForSection("SEC-P1-02");
  state.turnNumber = 3;
  state.sectionTurnNumber = 0;
  state.completedKernelIds = [
    "DK-P1-REVIEW-INITIATION",
    "DK-P1-EXECUTION-SCOPE",
    "DK-P1-RESPONSIBILITY-RECORD",
  ];
  state.review.authority = "UNDECIDED";
  state.review.procedureStatus = "UNSET";
  state.evidence.chainStatus = "UNKNOWN";
  state.evidence.primaryCustodianRef = null;
  state.witness.accessStatus = "UNKNOWN";
  state.pendingConsequences = [];

  const workingSet = buildPartOneRuntimeWorkingSet(pkg, state, 3);
  assert.equal(
    workingSet.openDecisionKernel.assetId,
    "DK-P1-REVIEW-AUTHORITY",
  );
  assert.equal(
    pkg.selectionRules.requirementDependencies.some((dependency) => (
      dependency.predecessorRequirementId === "REQ-P1-REVIEW-AUTHORITY"
      && dependency.successorRequirementId === "REQ-P1-KNOWLEDGE-CHAIN"
    )),
    true,
  );
});
