import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import templatesPackage, {
  type KernelSelectionTrace,
  type PartOneActionSettlement,
  type PartOneDecisionPin,
  type PartOneRuntimePackage,
  type PartOneState,
} from "@ai-story/templates";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const configRoot = path.resolve(
  currentDir,
  "../../../packages/templates/config",
);
const CAPABILITY_ACTION_PREFIX = "\u2063OMW_CAPABILITY_V1:";
const CAPABILITY_ACTION_SUFFIX = "\u2063";

type EventWithKernelTrace = PartOneActionSettlement["event"] & {
  nextKernelSelection?: KernelSelectionTrace;
};

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

function pairFixtures(pkg: PartOneRuntimePackage, state: PartOneState) {
  const workingSet = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    state.turnNumber,
  );
  const candidate = workingSet.kernelSelection.candidates.find(
    (item) => item.kernelId === workingSet.decisionPoint.decisionKernelId,
  );
  assert.ok(candidate);
  const kernel = pkg.assets.find(
    (item) => item.assetId === workingSet.decisionPoint.decisionKernelId,
  );
  assert.ok(kernel);
  const authoredIds = (Array.isArray(kernel.payload.options)
    ? kernel.payload.options
    : [])
    .map((option) => option.affordanceTemplateId)
    .filter((id) => candidate.validAffordanceIds.includes(id));
  assert.ok(authoredIds.length >= 3);

  const pairs: string[][] = [];
  for (let left = 0; left < authoredIds.length; left += 1) {
    for (let right = left + 1; right < authoredIds.length; right += 1) {
      pairs.push([authoredIds[left]!, authoredIds[right]!]);
    }
  }
  const defaultIds = [...workingSet.kernelSelection.selectedAffordanceIds];
  const alternateIds = pairs.find((pair) => !sameStringArray(pair, defaultIds));
  assert.ok(alternateIds);

  const pin = (affordanceIds: string[]): PartOneDecisionPin => ({
    decisionKernelId: workingSet.decisionPoint.decisionKernelId,
    decisionPointId: workingSet.decisionPoint.decisionPointId,
    affordanceIds: [...affordanceIds],
  });
  return {
    workingSet,
    defaultIds,
    alternateIds,
    defaultPin: pin(defaultIds),
    alternatePin: pin(alternateIds),
  };
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

test("an observe-only capability turn preserves a committed non-default Affordance pair", () => {
  const pkg = packageUnderTest();
  const state = authorityState(pkg);
  const fixture = pairFixtures(pkg, state);

  const settlement = templatesPackage.withPartOneDecisionPin(
    fixture.alternatePin,
    () => templatesPackage.settlePartOneAction(
      pkg,
      structuredClone(state),
      {
        source: "FREE_TEXT",
        actionText: encodedCapabilityAction(
          fixture.alternatePin.decisionPointId,
          "Inspect the public record without making a formal disposition.",
        ),
        targetRef: "public_frame",
      },
      state.turnNumber + 1,
    ),
  );
  const event = settlement.event as EventWithKernelTrace;

  assert.equal(event.actionSource, "FREE_TEXT_CAPABILITY");
  assert.deepEqual(event.statePatch, {});
  assert.deepEqual(event.durableEffects, []);
  assert.deepEqual(
    settlement.proposedState.completedKernelIds,
    state.completedKernelIds,
  );
  assert.equal(
    event.nextDecisionPoint.decisionKernelId,
    fixture.alternatePin.decisionKernelId,
  );
  assert.equal(
    event.nextDecisionPoint.decisionPointId,
    fixture.alternatePin.decisionPointId,
  );
  assert.ok(event.nextKernelSelection);
  assert.deepEqual(
    event.nextKernelSelection.selectedAffordanceIds,
    fixture.alternateIds,
  );
  assert.equal(event.nextKernelSelection.selectedOutcomeHashes.length, 2);
});

test("concurrent committed Pin scopes cannot leak Affordance pairs between runs", async () => {
  const pkg = packageUnderTest();
  const state = authorityState(pkg);
  const fixture = pairFixtures(pkg, state);

  const [defaultResult, alternateResult] = await Promise.all([
    templatesPackage.withPartOneDecisionPin(
      fixture.defaultPin,
      async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        return templatesPackage.buildPartOneRuntimeWorkingSet(
          pkg,
          structuredClone(state),
          state.turnNumber,
        );
      },
    ),
    templatesPackage.withPartOneDecisionPin(
      fixture.alternatePin,
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
    defaultResult.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
    fixture.defaultIds,
  );
  assert.deepEqual(
    alternateResult.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
    fixture.alternateIds,
  );
});

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
