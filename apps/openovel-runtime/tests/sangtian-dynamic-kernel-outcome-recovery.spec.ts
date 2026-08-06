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

async function workspaceFixture(
  state: PartOneState,
  event: unknown,
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "sangtian-outcome-recovery-"),
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

test("recovery rejects same-cardinality committed Outcome Hash drift", async () => {
  const pkg = packageUnderTest();
  const state = authorityState(pkg);
  const workingSet = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    state.turnNumber,
  );
  const chosen = workingSet.decisionAffordances[0]!;
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
  const finalized = templatesPackage.finalizePartOneSettlement(
    settlement,
    [...settlement.event.duePendingConsequenceIds],
  );
  const tampered = structuredClone(
    finalized.event,
  ) as EventWithKernelTrace;
  assert.ok(tampered.nextKernelSelection);
  assert.equal(tampered.nextKernelSelection.selectedOutcomeHashes.length, 2);
  tampered.nextKernelSelection.selectedOutcomeHashes[0] =
    "TAMPERED_OUTCOME_HASH";

  const fixture = await workspaceFixture(
    finalized.proposedState,
    tampered,
  );
  try {
    await assert.rejects(
      currentSangtianOptions(
        fixture.workspace,
        "run.outcome-hash-drift",
      ),
      /PART_ONE_PINNED_OUTCOME_HASH_MISMATCH/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
