import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import templatesPackage, {
  type DynamicPartOneRuntimeWorkingSet,
  type PartOneRuntimePackage,
  type PartOneState,
} from "@ai-story/templates";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const configRoot = path.resolve(
  currentDir,
  "../../../packages/templates/config",
);

function packageUnderTest() {
  return templatesPackage.loadPartOneRuntimePackage(
    "sangtian",
    configRoot,
  ).package;
}

function authorityState(pkg: PartOneRuntimePackage): PartOneState {
  const state = templatesPackage.createInitialPartOneState(pkg);
  state.sectionId = "SEC-P1-02";
  state.scene = templatesPackage.partOneSceneForSection("SEC-P1-02");
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

function pairWorkingSets(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
) {
  const selected = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    state.turnNumber,
  );
  const candidate = selected.kernelSelection.candidates.find(
    (item) => item.kernelId === selected.decisionPoint.decisionKernelId,
  );
  assert.ok(candidate);
  const kernel = pkg.assets.find(
    (item) => item.assetId === selected.decisionPoint.decisionKernelId,
  );
  assert.ok(kernel);
  const validIds = (Array.isArray(kernel.payload.options)
    ? kernel.payload.options
    : [])
    .map((option) => option.affordanceTemplateId)
    .filter((id) => candidate.validAffordanceIds.includes(id));
  assert.ok(validIds.length >= 3);

  const alternateIds = [validIds[0]!, validIds[1]!];
  if (sameStringArray(
    alternateIds,
    selected.kernelSelection.selectedAffordanceIds,
  )) {
    alternateIds[1] = validIds[2]!;
  }
  const alternate = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    state.turnNumber,
    {
      mode: "DYNAMIC_LITE",
      pin: {
        decisionKernelId: selected.decisionPoint.decisionKernelId,
        decisionPointId: selected.decisionPoint.decisionPointId,
        affordanceIds: alternateIds,
      },
    },
  );
  assert.notDeepEqual(
    alternate.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
    selected.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
  );
  return {
    selected,
    alternate,
  } satisfies {
    selected: DynamicPartOneRuntimeWorkingSet;
    alternate: DynamicPartOneRuntimeWorkingSet;
  };
}

test("concurrent exact WorkingSet scopes do not leak between runs", async () => {
  const pkg = packageUnderTest();
  const state = authorityState(pkg);
  const fixtures = pairWorkingSets(pkg, state);

  const [selected, alternate] = await Promise.all([
    templatesPackage.withPartOneDecisionWorkingSet(
      fixtures.selected,
      async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return templatesPackage.buildPartOneRuntimeWorkingSet(
          pkg,
          structuredClone(state),
          state.turnNumber,
        );
      },
    ),
    templatesPackage.withPartOneDecisionWorkingSet(
      fixtures.alternate,
      async () => {
        await Promise.resolve();
        return templatesPackage.buildPartOneRuntimeWorkingSet(
          pkg,
          structuredClone(state),
          state.turnNumber,
        );
      },
    ),
  ]);

  assert.deepEqual(
    selected.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
    fixtures.selected.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
  );
  assert.deepEqual(
    alternate.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
    fixtures.alternate.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
  );
});

test("an exact WorkingSet scope rejects semantic state drift before binding", () => {
  const pkg = packageUnderTest();
  const state = authorityState(pkg);
  const fixtures = pairWorkingSets(pkg, state);
  const drifted = structuredClone(state);
  drifted.review.authority = "TAMPERED";

  assert.throws(() => templatesPackage.withPartOneDecisionWorkingSet(
    fixtures.selected,
    () => templatesPackage.buildPartOneRuntimeWorkingSet(
      pkg,
      drifted,
      drifted.turnNumber,
    ),
  ), /PART_ONE_COMMITTED_WORKING_SET_MISMATCH/u);
});

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
