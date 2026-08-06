import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import templatesPackage, {
  type PartOneRuntimePackage,
  type PartOneState,
} from "@ai-story/templates";
import { sangtianDecisionAdapter } from "../src/sangtian-decisions.js";
import type { FileStoryWorkspace } from "../src/workspace.js";
import type { OpenNovelOption } from "../src/types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..", "..", "..");
const configRoot = path.resolve(projectRoot, "packages", "templates", "config");

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

function optionFor(
  affordance: ReturnType<
    typeof templatesPackage.buildPartOneRuntimeWorkingSet
  >["decisionAffordances"][number],
): OpenNovelOption {
  return {
    id: affordance.affordanceTemplateId,
    label: affordance.actionText,
    key: true,
    effect: {
      decisionPointId: affordance.decisionPointId,
      intent: affordance.immediateIntent,
      consequence: affordance.visibleTradeoff,
      reversible: false,
    },
  };
}

async function workspaceFixture(
  state: PartOneState,
  event: unknown,
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "sangtian-stale-option-"),
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
    snapshot: async () => ({ previousOptions: [] }),
    recordSceneEvent: async () => ({}),
  } as unknown as FileStoryWorkspace;
  return { root, workspace };
}

test("a committed state rejects an option from the previous Dynamic Kernel revision", async () => {
  const pkg = packageUnderTest();
  const state = stateForAuthority(pkg);
  const current = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    4,
  );
  const chosen = current.decisionAffordances[0]!;
  const staleOption = optionFor(chosen);
  const settlement = templatesPackage.settlePartOneAction(pkg, state, {
    source: "RECOMMENDED",
    decisionId: chosen.affordanceTemplateId,
    decisionKernelId: chosen.decisionKernelId,
    affordanceTemplateId: chosen.affordanceTemplateId,
    label: chosen.title,
    actionText: chosen.actionText,
    targetRef: chosen.target.id,
  }, 5);
  assert.notEqual(
    settlement.event.nextDecisionPoint.decisionPointId,
    staleOption.effect?.decisionPointId,
  );

  const fixture = await workspaceFixture(
    settlement.proposedState,
    settlement.event,
  );
  try {
    await assert.rejects(
      sangtianDecisionAdapter.prepare(fixture.workspace, {
        runId: "run.stale-option",
        turnNumber: 6,
        action: staleOption.label,
        selectedOption: staleOption,
      }),
      /SANGTIAN_PINNED_SELECTED_OPTION_MISSING|SANGTIAN_PINNED_SELECTED_OPTION_DECISION_POINT_MISMATCH/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
