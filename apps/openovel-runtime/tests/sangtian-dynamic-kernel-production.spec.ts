import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import templatesPackage, {
  settleDynamicPartOneAction,
  type KernelSelectionTrace,
  type PartOneActionSettlement,
  type PartOneRuntimePackage,
  type PartOneState,
} from "@ai-story/templates";
import {
  currentSangtianOptions,
  sangtianDecisionAdapter,
  type PreparedSangtianDecision,
} from "../src/sangtian-decisions.js";
import type { FileStoryWorkspace } from "../src/workspace.js";
import type { OpenNovelOption } from "../src/types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..", "..");
const configRoot = path.resolve(projectRoot, "packages", "templates", "config");
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

function stateForAuthority(pkg: PartOneRuntimePackage): PartOneState {
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

function incomingFor(
  affordance: ReturnType<
    typeof templatesPackage.buildPartOneRuntimeWorkingSet
  >["decisionAffordances"][number],
) {
  return {
    source: "RECOMMENDED",
    decisionId: affordance.affordanceTemplateId,
    decisionKernelId: affordance.decisionKernelId,
    affordanceTemplateId: affordance.affordanceTemplateId,
    label: affordance.title,
    actionText: affordance.actionText,
    targetRef: affordance.target.id,
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

async function workspaceFixture(
  state: PartOneState,
  event: unknown,
  initialOptions: OpenNovelOption[] = [],
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "sangtian-dynamic-production-"),
  );
  const partOneState = path.join(root, "part-one-state.json");
  const partOneEvents = path.join(root, "part-one-events.jsonl");
  await writeFile(
    partOneState,
    JSON.stringify(state, null, 2),
    "utf8",
  );
  await writeFile(
    partOneEvents,
    `${JSON.stringify(event)}\n`,
    "utf8",
  );

  let modelCalls = 0;
  let previousOptions = [...initialOptions];
  const workspace = {
    projectRoot,
    metadata: async () => ({
      worldId: "sangtian",
      roleId: "zhejiang_governor",
      turnNumber: state.turnNumber,
    }),
    paths: () => ({ partOneState, partOneEvents }),
    snapshot: async () => ({ previousOptions }),
    recordSceneEvent: async () => ({}),
    recordModelCall: async () => {
      modelCalls += 1;
      throw new Error("DYNAMIC_KERNEL_SELECTION_MUST_NOT_CALL_MODEL");
    },
  } as unknown as FileStoryWorkspace;

  return {
    root,
    workspace,
    modelCalls: () => modelCalls,
    setPreviousOptions: (options: OpenNovelOption[]) => {
      previousOptions = [...options];
    },
  };
}

test("production runtime entry and the settlement coordinator commit the same authoritative result", () => {
  const pkg = packageUnderTest();
  const state = stateForAuthority(pkg);
  const workingSet = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    4,
  );
  const chosen = workingSet.decisionAffordances[0]!;
  const action = incomingFor(chosen);

  const coordinated = settleDynamicPartOneAction(
    pkg,
    structuredClone(state),
    action,
    5,
  );
  const production = templatesPackage.settlePartOneAction(
    pkg,
    structuredClone(state),
    action,
    5,
  );
  const coordinatedEvent = coordinated.event as EventWithKernelTrace;
  const productionEvent = production.event as EventWithKernelTrace;

  assert.deepEqual(production.proposedState, coordinated.proposedState);
  assert.deepEqual(productionEvent.statePatch, coordinatedEvent.statePatch);
  assert.deepEqual(
    productionEvent.durableEffects,
    coordinatedEvent.durableEffects,
  );
  assert.deepEqual(
    productionEvent.nextDecisionPoint,
    coordinatedEvent.nextDecisionPoint,
  );
  assert.deepEqual(
    productionEvent.nextKernelSelection,
    coordinatedEvent.nextKernelSelection,
  );
});

test("committed option recovery, equivalent free text and click settlement use one dynamic pair without model calls", async () => {
  const pkg = packageUnderTest();
  const state = stateForAuthority(pkg);
  const eventId = "EVENT-DYNAMIC-FREE-TEXT";
  state.lastCommittedEventId = eventId;
  const workingSet = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    4,
  );
  const event = {
    eventId,
    turnNumber: state.turnNumber,
    sectionIdAfter: state.sectionId,
    nextDecisionPoint: workingSet.decisionPoint,
    nextKernelSelection: workingSet.kernelSelection,
  };
  const fixture = await workspaceFixture(state, event);

  try {
    const recovered = await currentSangtianOptions(
      fixture.workspace,
      "run.dynamic-recovery",
    );
    assert.ok(recovered);
    assert.deepEqual(
      recovered.map((option) => option.id),
      workingSet.kernelSelection.selectedAffordanceIds,
    );
    assert.equal(
      recovered.every((option) => (
        option.effect?.decisionPointId
        === workingSet.decisionPoint.decisionPointId
      )),
      true,
    );
    fixture.setPreviousOptions(recovered);

    const target = recovered[0]!;
    const freeText = `${target.label}。`;
    const freePrepared = await sangtianDecisionAdapter.prepare(
      fixture.workspace,
      {
        runId: "run.dynamic-free-text",
        turnNumber: 5,
        action: freeText,
        selectedOption: null,
      },
    );
    const clickPrepared = await sangtianDecisionAdapter.prepare(
      fixture.workspace,
      {
        runId: "run.dynamic-click",
        turnNumber: 5,
        action: target.label,
        selectedOption: target,
      },
    );

    assert.ok(freePrepared);
    assert.ok(clickPrepared);
    const resolution = freePrepared.audit.intentResolution
      as Record<string, unknown>;
    assert.equal(resolution.moduleStatus, "BOUND_AFFORDANCE");
    assert.equal(resolution.intentType, "AFFORDANCE_EQUIVALENT");
    assert.equal(resolution.matchedAffordanceId, target.id);
    assert.equal(resolution.affordanceSource, "DISPLAYED_OPTIONS");

    const freePayload = freePrepared.payload as PreparedSangtianDecision;
    const clickPayload = clickPrepared.payload as PreparedSangtianDecision;
    assert.equal(
      freePayload.settlement.event.affordanceTemplateId,
      target.id,
    );
    assert.ok(freePrepared.selectedOption?.effect?.beatContract);
    assert.ok(clickPrepared.selectedOption?.effect?.beatContract);
    assert.deepEqual(
      freePayload.settlement.event.statePatch,
      clickPayload.settlement.event.statePatch,
    );
    assert.deepEqual(
      freePayload.settlement.event.durableEffects,
      clickPayload.settlement.event.durableEffects,
    );
    assert.deepEqual(
      freePayload.settlement.proposedState,
      clickPayload.settlement.proposedState,
    );
    assert.deepEqual(
      (freePayload.settlement.event as EventWithKernelTrace)
        .nextKernelSelection,
      (clickPayload.settlement.event as EventWithKernelTrace)
        .nextKernelSelection,
    );
    assert.equal(fixture.modelCalls(), 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("observe-only capability turns preserve the open Kernel and freeze their next dynamic pair", async () => {
  const pkg = packageUnderTest();
  const state = stateForAuthority(pkg);
  const current = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    4,
  );
  const actionText = "先核对当前在场人和已经公开的材料，不作正式处置。";
  const settlement = templatesPackage.settlePartOneAction(
    pkg,
    structuredClone(state),
    {
      source: "FREE_TEXT",
      actionText: encodedCapabilityAction(
        current.decisionPoint.decisionPointId,
        actionText,
      ),
      targetRef: "public_frame",
    },
    5,
  );
  const event = settlement.event as EventWithKernelTrace;

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
    current.decisionPoint.decisionKernelId,
  );
  assert.equal(
    event.nextDecisionPoint.decisionPointId,
    current.decisionPoint.decisionPointId,
  );
  assert.ok(event.nextKernelSelection);
  assert.equal(
    event.nextKernelSelection.selectedKernelId,
    event.nextDecisionPoint.decisionKernelId,
  );
  assert.equal(event.nextKernelSelection.selectedAffordanceIds.length, 2);
  assert.equal(event.nextKernelSelection.selectedOutcomeHashes.length, 2);

  const fixture = await workspaceFixture(
    settlement.proposedState,
    event,
  );
  try {
    const recovered = await currentSangtianOptions(
      fixture.workspace,
      "run.capability-recovery",
    );
    assert.ok(recovered);
    assert.deepEqual(
      recovered.map((option) => option.id),
      event.nextKernelSelection.selectedAffordanceIds,
    );
    assert.equal(fixture.modelCalls(), 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
