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
import { currentSangtianOptions } from "../src/sangtian-decisions.js";
import type { FileStoryWorkspace } from "../src/workspace.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..", "..");
const configRoot = path.resolve(projectRoot, "packages", "templates", "config");

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

async function workspaceFixture(
  state: PartOneState,
  events: unknown[],
  turnNumber: number,
) {
  const root = await mkdtemp(path.join(tmpdir(), "sangtian-kernel-recovery-"));
  const partOneState = path.join(root, "part-one-state.json");
  const partOneEvents = path.join(root, "part-one-events.jsonl");
  await writeFile(partOneState, JSON.stringify(state, null, 2), "utf8");
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
  } as unknown as FileStoryWorkspace;
  return { root, workspace, partOneState, partOneEvents };
}

test("current options recover the exact committed primary pair and fail closed on tampering", async () => {
  const pkg = packageUnderTest();
  const state = stateForAuthority(pkg);
  const workingSet = templatesPackage.buildPartOneRuntimeWorkingSet(pkg, state, 4);
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
  const event = settlement.event as EventWithKernelTrace;
  assert.ok(event.nextKernelSelection);
  const fixture = await workspaceFixture(
    settlement.proposedState,
    [event],
    settlement.event.turnNumber,
  );
  try {
    const recovered = await currentSangtianOptions(fixture.workspace, "run.primary");
    assert.ok(recovered);
    assert.deepEqual(
      recovered.map((option) => option.id),
      event.nextKernelSelection.selectedAffordanceIds,
    );
    assert.equal(
      recovered.every((option) => (
        option.effect?.decisionPointId === event.nextDecisionPoint.decisionPointId
      )),
      true,
    );

    const tampered = structuredClone(event) as EventWithKernelTrace;
    assert.ok(tampered.nextKernelSelection);
    tampered.nextKernelSelection.selectedAffordanceIds = ["missing.a", "missing.b"];
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

test("current options recover the exact Floor continuation decision point", async () => {
  const pkg = packageUnderTest();
  const state = sectionTwoState(pkg);
  const section = pkg.sections.find((item) => item.sectionId === state.sectionId);
  assert.ok(section);
  state.completedKernelIds = [...section.activeDecisionKernelIds];
  state.sectionTurnNumber = section.activeDecisionKernelIds.length;
  state.turnNumber = 8;
  const continuation = templatesPackage.buildPartOneRuntimeWorkingSet(pkg, state, 8);
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
    const recovered = await currentSangtianOptions(fixture.workspace, "run.continuation");
    assert.ok(recovered);
    assert.deepEqual(
      recovered.map((option) => option.id),
      continuation.decisionAffordances.map((item) => item.affordanceTemplateId),
    );
    assert.equal(
      recovered.every((option) => (
        option.effect?.decisionPointId === continuation.decisionPoint.decisionPointId
      )),
      true,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
