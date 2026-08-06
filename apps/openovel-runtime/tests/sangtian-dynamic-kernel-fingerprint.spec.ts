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

function committedPrimary(pkg: PartOneRuntimePackage) {
  const state = authorityState(pkg);
  const current = templatesPackage.buildPartOneRuntimeWorkingSet(
    pkg,
    state,
    4,
  );
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
  const event = settlement.event as EventWithKernelTrace;
  assert.ok(event.nextKernelSelection);
  return { settlement, event };
}

async function workspaceFixture(
  state: PartOneState,
  event: unknown,
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "sangtian-fingerprint-recovery-"),
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

function rewritePresentationOnly(state: PartOneState) {
  const rewritten = structuredClone(state);
  rewritten.scene.situation = "A different player-facing scene summary.";
  rewritten.scene.locationLabel = "A renamed player-facing location.";
  rewritten.scene.timeLabel = "A rewritten player-facing time label.";
  rewritten.scene.observableFacts = ["A different visible paraphrase."];
  rewritten.scene.documentStates = (rewritten.scene.documentStates || [])
    .map((document) => ({
      ...document,
      label: `${document.label} [rewritten]`,
      continuityNote: `${document.continuityNote} [rewritten]`,
    }));
  rewritten.pendingConsequences = (rewritten.pendingConsequences || [])
    .map((pending) => ({
      ...pending,
      summary: `${pending.summary} [rewritten]`,
      payoffBeat: {
        ...pending.payoffBeat,
        action: `${pending.payoffBeat.action} [rewritten]`,
        requiredTermGroups: [["rewritten visible anchor"]],
        resultCeiling: `${pending.payoffBeat.resultCeiling} [rewritten]`,
      },
    }));
  return rewritten;
}

test("presentation-only state rewrites preserve committed Dynamic recovery", async () => {
  const pkg = packageUnderTest();
  const { settlement, event } = committedPrimary(pkg);
  const presentationOnly = rewritePresentationOnly(
    settlement.proposedState,
  );
  assert.equal(
    templatesPackage.stableSha256(presentationOnly),
    event.nextKernelSelection!.stateFingerprint,
  );
  const fixture = await workspaceFixture(presentationOnly, event);
  try {
    const recovered = await currentSangtianOptions(
      fixture.workspace,
      "run.presentation-only",
    );
    assert.ok(recovered);
    assert.deepEqual(
      recovered.map((option) => option.id),
      event.nextKernelSelection!.selectedAffordanceIds,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a structured state mutation at the same revision cannot reuse a committed Dynamic trace", async () => {
  const pkg = packageUnderTest();
  const { settlement, event } = committedPrimary(pkg);
  const tamperedState = structuredClone(settlement.proposedState);
  tamperedState.relations.governorXunfu += 1;
  assert.notEqual(
    templatesPackage.stableSha256(tamperedState),
    event.nextKernelSelection!.stateFingerprint,
  );
  const fixture = await workspaceFixture(tamperedState, event);
  try {
    await assert.rejects(
      currentSangtianOptions(
        fixture.workspace,
        "run.structured-state-tamper",
      ),
      /SANGTIAN_COMMITTED_KERNEL_TRACE_FINGERPRINT_MISMATCH/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a tampered committed fingerprint fails closed before option recovery", async () => {
  const pkg = packageUnderTest();
  const { settlement, event } = committedPrimary(pkg);
  const tamperedEvent = structuredClone(event) as EventWithKernelTrace;
  assert.ok(tamperedEvent.nextKernelSelection);
  tamperedEvent.nextKernelSelection.stateFingerprint = "TAMPERED";
  const fixture = await workspaceFixture(
    settlement.proposedState,
    tamperedEvent,
  );
  try {
    await assert.rejects(
      currentSangtianOptions(
        fixture.workspace,
        "run.trace-fingerprint-tamper",
      ),
      /SANGTIAN_COMMITTED_KERNEL_TRACE_FINGERPRINT_MISMATCH/u,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
