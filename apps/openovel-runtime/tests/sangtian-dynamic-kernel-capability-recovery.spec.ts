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
const configRoot = path.resolve(
  projectRoot,
  "packages",
  "templates",
  "config",
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
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "sangtian-capability-recovery-"),
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
  const workspace = {
    projectRoot,
    metadata: async () => ({
      worldId: "sangtian",
      roleId: "zhejiang_governor",
      turnNumber: state.turnNumber,
    }),
    paths: () => ({ partOneState, partOneEvents }),
  } as unknown as FileStoryWorkspace;
  return { root, workspace };
}

test("a finalized observe-only capability turn recovers its exact decision surface", async () => {
  const pkg = packageUnderTest();
  const state = authorityState(pkg);
  const current = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    state.turnNumber,
  );
  const settlement = templatesPackage.withPartOneDecisionWorkingSet(
    current,
    () => templatesPackage.settlePartOneAction(
      pkg,
      structuredClone(state),
      {
        source: "FREE_TEXT",
        actionText: encodedCapabilityAction(
          current.decisionPoint.decisionPointId,
          "Inspect the public record without making a formal disposition.",
        ),
        targetRef: "public_frame",
      },
      state.turnNumber + 1,
    ),
  );
  const event = settlement.event as EventWithKernelTrace;
  assert.equal(event.actionSource, "FREE_TEXT_CAPABILITY");
  assert.ok(event.nextKernelSelection);
  assert.equal(event.nextKernelSelection.stateRevision, event.turnNumber);

  const finalized = templatesPackage.finalizePartOneSettlement(
    settlement,
    [...event.duePendingConsequenceIds],
  );
  assert.equal(
    event.nextKernelSelection.stateFingerprint,
    templatesPackage.stableSha256(finalized.proposedState),
  );

  const fixture = await workspaceFixture(
    finalized.proposedState,
    finalized.event,
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
    assert.equal(
      recovered.every((option) => (
        option.effect?.decisionPointId
        === event.nextDecisionPoint.decisionPointId
      )),
      true,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
