import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  currentSangtianOptions,
  sangtianDecisionAdapter,
  type PreparedSangtianDecision,
} from "../src/sangtian-decisions.js";
import type { FileStoryWorkspace } from "../src/workspace.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..", "..");
const configRoot = path.resolve(projectRoot, "packages", "templates", "config");

type EventWithKernelTrace = PartOneActionSettlement["event"] & {
  nextKernelSelection?: KernelSelectionTrace;
};

function packageUnderTest() {
  return templatesPackage.loadPartOneRuntimePackage(
    "sangtian",
    configRoot,
  ).package;
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

function committedPrimary(pkg: PartOneRuntimePackage) {
  const state = stateForAuthority(pkg);
  const workingSet = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    4,
  );
  const chosen = workingSet.decisionAffordances[0]!;
  const settlement = templatesPackage.settlePartOneAction(pkg, state, {
    source: "RECOMMENDED",
    decisionId: chosen.affordanceTemplateId,
    decisionKernelId: chosen.decisionKernelId,
    affordanceTemplateId: chosen.affordanceTemplateId,
    label: chosen.title,
    actionText: chosen.actionText,
    targetRef: chosen.target.id,
  }, 5);
  return {
    workingSet,
    settlement,
    event: settlement.event as EventWithKernelTrace,
  };
}

async function workspaceFixture(
  state: PartOneState,
  events: unknown[],
  turnNumber: number,
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "sangtian-kernel-recovery-"),
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
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8",
  );
  const workspace = {
    projectRoot,
    metadata: async () => ({
      worldId: "sangtian",
      roleId: "zhejiang_governor",
      turnNumber,
    }),
    paths: () => ({ partOneState, partOneEvents }),
    recordSceneEvent: async () => ({}),
  } as unknown as FileStoryWorkspace;
  return { root, workspace, partOneState, partOneEvents };
}

test("current options recover the exact committed primary pair and fail closed on tampering", async () => {
  const pkg = packageUnderTest();
  const { settlement, event } = committedPrimary(pkg);
  assert.ok(event.nextKernelSelection);
  const fixture = await workspaceFixture(
    settlement.proposedState,
    [event],
    settlement.event.turnNumber,
  );
  try {
    const recovered = await currentSangtianOptions(
      fixture.workspace,
      "run.primary",
    );
    assert.ok(recovered);
    assert.deepEqual(
      recovered.map((option) => option.id),
      event.nextKernelSelection.selectedAffordanceIds,
    );
    assert.equal(
      recovered.every((option) => (
        option.effect?.decisionPointId
        === event.nextDecisionPoint.decisionPointId
      )),
      true,
    );

    const tampered = structuredClone(event) as EventWithKernelTrace;
    assert.ok(tampered.nextKernelSelection);
    tampered.nextKernelSelection.selectedAffordanceIds = [
      "missing.a",
      "missing.b",
    ];
    await writeFile(
      fixture.partOneEvents,
      `${JSON.stringify(tampered)}\n`,
      "utf8",
    );
    await assert.rejects(
      currentSangtianOptions(fixture.workspace, "run.primary"),
      /PART_ONE_DYNAMIC_AFFORDANCE_PAIR_MISSING|PART_ONE_PINNED_AFFORDANCE_NOT_FOUND/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a committed non-default primary pair remains authoritative when its option settles", async () => {
  const pkg = packageUnderTest();
  const state = stateForAuthority(pkg);
  const defaultWorkingSet = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    state.turnNumber,
  );
  const candidate = defaultWorkingSet.kernelSelection.candidates.find(
    (item) => item.kernelId === defaultWorkingSet.decisionPoint.decisionKernelId,
  );
  assert.ok(candidate);
  const kernel = pkg.assets.find(
    (item) => item.assetId === defaultWorkingSet.decisionPoint.decisionKernelId,
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
  const defaultIds = defaultWorkingSet.kernelSelection.selectedAffordanceIds;
  const alternateIds = pairs.find((pair) => !sameStringArray(pair, defaultIds));
  assert.ok(alternateIds);
  const alternateOnlyId = alternateIds.find((id) => !defaultIds.includes(id));
  assert.ok(alternateOnlyId);

  const pin = {
    decisionKernelId: defaultWorkingSet.decisionPoint.decisionKernelId,
    decisionPointId: defaultWorkingSet.decisionPoint.decisionPointId,
    affordanceIds: [...alternateIds],
  };
  const pinnedWorkingSet = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    state.turnNumber,
    { mode: "DYNAMIC_LITE", pin },
  );
  assert.deepEqual(
    pinnedWorkingSet.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
    alternateIds,
  );

  const eventId = "EVENT-COMMITTED-NON-DEFAULT-PAIR";
  state.lastCommittedEventId = eventId;
  const trace = structuredClone(defaultWorkingSet.kernelSelection);
  trace.selectedKernelId = pin.decisionKernelId;
  trace.selectedDecisionPointId = pin.decisionPointId;
  trace.selectedAffordanceIds = [...alternateIds];
  trace.selectedOutcomeHashes = [];
  trace.stateRevision = state.turnNumber;
  trace.stateFingerprint = templatesPackage.stableSha256(state);
  const event = {
    eventId,
    turnNumber: state.turnNumber,
    sectionIdAfter: state.sectionId,
    nextDecisionPoint: pinnedWorkingSet.decisionPoint,
    nextKernelSelection: trace,
  };
  const fixture = await workspaceFixture(
    state,
    [event],
    state.turnNumber,
  );
  try {
    const recovered = await currentSangtianOptions(
      fixture.workspace,
      "run.non-default-pair",
    );
    assert.ok(recovered);
    assert.deepEqual(
      recovered.map((option) => option.id),
      alternateIds,
    );
    const selectedOption = recovered.find(
      (option) => option.id === alternateOnlyId,
    );
    assert.ok(selectedOption);

    const prepared = await sangtianDecisionAdapter.prepare(
      fixture.workspace,
      {
        runId: "run.non-default-pair",
        turnNumber: state.turnNumber + 1,
        action: selectedOption.label,
        selectedOption,
      },
    );
    assert.ok(prepared);
    const payload = prepared.payload as PreparedSangtianDecision;
    assert.equal(
      payload.settlement.event.affordanceTemplateId,
      alternateOnlyId,
    );
    assert.equal(
      payload.settlement.appliedAffordance?.affordanceTemplateId,
      alternateOnlyId,
    );
    assert.ok(prepared.selectedOption?.effect?.beatContract);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a legacy primary event without KernelSelectionTrace recovers deterministically", async () => {
  const pkg = packageUnderTest();
  const { settlement, event } = committedPrimary(pkg);
  const legacy = structuredClone(event) as EventWithKernelTrace;
  delete legacy.nextKernelSelection;
  const expected = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    settlement.proposedState,
    settlement.event.turnNumber,
    {
      mode: "DYNAMIC_LITE",
      pin: {
        decisionKernelId: event.nextDecisionPoint.decisionKernelId,
        decisionPointId: event.nextDecisionPoint.decisionPointId,
      },
    },
  );
  const fixture = await workspaceFixture(
    settlement.proposedState,
    [legacy],
    settlement.event.turnNumber,
  );
  try {
    const recovered = await currentSangtianOptions(
      fixture.workspace,
      "run.legacy-primary",
    );
    assert.ok(recovered);
    assert.deepEqual(
      recovered.map((option) => option.id),
      expected.decisionAffordances.map(
        (affordance) => affordance.affordanceTemplateId,
      ),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("committed trace revision, cardinality and fingerprint tampering fail closed", async () => {
  const pkg = packageUnderTest();
  const { settlement, event } = committedPrimary(pkg);
  assert.ok(event.nextKernelSelection);
  const fixture = await workspaceFixture(
    settlement.proposedState,
    [event],
    settlement.event.turnNumber,
  );
  try {
    const cases: Array<{
      mutate: (trace: KernelSelectionTrace) => void;
      code: RegExp;
    }> = [
      {
        mutate: (trace) => {
          trace.stateRevision += 1;
        },
        code: /SANGTIAN_COMMITTED_KERNEL_TRACE_REVISION_MISMATCH/u,
      },
      {
        mutate: (trace) => {
          trace.selectedAffordanceIds = ["only.one"];
          trace.selectedOutcomeHashes = ["HASH"];
        },
        code: /SANGTIAN_COMMITTED_KERNEL_TRACE_AFFORDANCE_COUNT_INVALID/u,
      },
      {
        mutate: (trace) => {
          trace.selectedOutcomeHashes = ["HASH"];
        },
        code: /SANGTIAN_COMMITTED_KERNEL_TRACE_OUTCOME_COUNT_INVALID/u,
      },
      {
        mutate: (trace) => {
          trace.stateFingerprint = "";
        },
        code: /SANGTIAN_COMMITTED_KERNEL_TRACE_FINGERPRINT_MISSING/u,
      },
    ];

    for (const entry of cases) {
      const tampered = structuredClone(event) as EventWithKernelTrace;
      assert.ok(tampered.nextKernelSelection);
      entry.mutate(tampered.nextKernelSelection);
      await writeFile(
        fixture.partOneEvents,
        `${JSON.stringify(tampered)}\n`,
        "utf8",
      );
      await assert.rejects(
        currentSangtianOptions(fixture.workspace, "run.trace-tamper"),
        entry.code,
      );
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("missing and duplicate authoritative events fail closed", async () => {
  const pkg = packageUnderTest();
  const { settlement, event } = committedPrimary(pkg);
  const missing = await workspaceFixture(
    settlement.proposedState,
    [],
    settlement.event.turnNumber,
  );
  try {
    await assert.rejects(
      currentSangtianOptions(missing.workspace, "run.missing"),
      /SANGTIAN_COMMITTED_EVENT_MISSING/u,
    );
  } finally {
    await rm(missing.root, { recursive: true, force: true });
  }

  const duplicate = await workspaceFixture(
    settlement.proposedState,
    [event, event],
    settlement.event.turnNumber,
  );
  try {
    await assert.rejects(
      currentSangtianOptions(duplicate.workspace, "run.duplicate"),
      /SANGTIAN_COMMITTED_EVENT_DUPLICATE/u,
    );
  } finally {
    await rm(duplicate.root, { recursive: true, force: true });
  }
});

test("current options recover the exact Floor continuation decision point", async () => {
  const pkg = packageUnderTest();
  const state = sectionTwoState(pkg);
  const section = pkg.sections.find(
    (item) => item.sectionId === state.sectionId,
  );
  assert.ok(section);
  state.completedKernelIds = [...section.activeDecisionKernelIds];
  state.sectionTurnNumber = section.activeDecisionKernelIds.length;
  state.turnNumber = 8;
  const continuation = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    8,
  );
  assert.notEqual(
    continuation.decisionPoint.decisionPointId,
    continuation.decisionPoint.decisionKernelId,
  );
  const eventId = "EVENT-CONTINUATION-PIN";
  state.lastCommittedEventId = eventId;
  const event = {
    eventId,
    turnNumber: state.turnNumber,
    sectionIdAfter: state.sectionId,
    nextDecisionPoint: continuation.decisionPoint,
  };
  const fixture = await workspaceFixture(state, [event], 8);
  try {
    const recovered = await currentSangtianOptions(
      fixture.workspace,
      "run.continuation",
    );
    assert.ok(recovered);
    assert.deepEqual(
      recovered.map((option) => option.id),
      continuation.decisionAffordances.map(
        (item) => item.affordanceTemplateId,
      ),
    );
    assert.equal(
      recovered.every((option) => (
        option.effect?.decisionPointId
        === continuation.decisionPoint.decisionPointId
      )),
      true,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
