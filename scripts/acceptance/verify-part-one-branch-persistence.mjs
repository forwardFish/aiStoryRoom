import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const runtimePath = resolve(root, "packages/templates/config/sangtian/story-package/part-one-runtime.json");
const pkg = JSON.parse(readFileSync(runtimePath, "utf8"));
const runtime = await import(pathToFileURL(
  resolve(root, "packages/templates/dist/runtime-entry.js"),
).href);
const buildWorkingSet = runtime.buildPartOneRuntimeWorkingSet;
const settleAction = runtime.settlePartOneAction;
if (typeof buildWorkingSet !== "function" || typeof settleAction !== "function") {
  throw new Error("PART_ONE_RUNTIME_ENGINE_EXPORTS_MISSING");
}

const initialState = clone(pkg.worldStart.state);
const g00 = buildWorkingSet(pkg, initialState, 0);
assert(Array.isArray(g00.decisionAffordances) && g00.decisionAffordances.length === 2, "G00_TWO_AFFORDANCES_REQUIRED");
assert(g00.openDecisionKernel?.assetId, "G00_OPEN_KERNEL_REQUIRED");

const capabilityAction = "只询问当前急令由谁具名、县令亲随亲眼见过什么，不替任何一项处置下令。";
const observeSettlement = settleAction(pkg, initialState, {
  source: "FREE_TEXT",
  actionText: encodeCapabilityAction(g00.decisionPoint.decisionPointId, capabilityAction),
  targetRef: g00.decisionPoint?.actorRefs?.[0] || "public_frame",
}, 1);
const observedState = stateFrom(observeSettlement);
assert(!array(observedState.completedKernelIds).includes(g00.openDecisionKernel.assetId), "OBSERVE_ONLY_COMPLETED_KERNEL");
assert(array(observedState.pendingConsequences).length === array(initialState.pendingConsequences).length, "OBSERVE_ONLY_CREATED_CONSEQUENCE");
const observedWorkingSet = buildWorkingSet(pkg, observedState, 1);
assert(observedWorkingSet.openDecisionKernel?.assetId === g00.openDecisionKernel.assetId, "OBSERVE_ONLY_MOVED_DECISION_POINT");

const branchA = runBranch("A", initialState, 0, 5, (options) => options[0]);
const branchB = runBranch("B", initialState, 0, 5, (options) => options[options.length - 1]);
assert(branchA.turns.length === 5 && branchB.turns.length === 5, "BRANCH_TURN_COUNT");
assert(branchA.finalStateHash !== branchB.finalStateHash, "BRANCHES_DID_NOT_DIVERGE");
assert(JSON.stringify(branchA.finalState) !== JSON.stringify(branchB.finalState), "BRANCH_FINAL_STATE_IDENTICAL");
assert(branchA.turns.some((turn, index) => turn.stateHash !== branchB.turns[index]?.stateHash), "BRANCH_DIVERGENCE_NOT_PERSISTENT");
for (const branch of [branchA, branchB]) {
  let completed = new Set();
  let pending = new Map();
  for (const turn of branch.turns) {
    const nextCompleted = new Set(turn.completedKernelIds);
    for (const id of completed) assert(nextCompleted.has(id), `COMPLETED_KERNEL_DISAPPEARED:${branch.branchId}:${id}`);
    completed = nextCompleted;
    const nextPending = new Map(turn.pendingConsequences.map((item) => [consequenceId(item), item]));
    for (const [id, previous] of pending) {
      assert(nextPending.has(id), `PENDING_CONSEQUENCE_DISAPPEARED:${branch.branchId}:${id}`);
      const next = nextPending.get(id);
      assert(validConsequenceTransition(previous, next), `PENDING_CONSEQUENCE_INVALID_TRANSITION:${branch.branchId}:${id}`);
    }
    pending = nextPending;
    if (!turn.storyComplete) {
      assert(turn.nextOptionCount === 2, `POST_CANON_OPTIONS_NOT_TWO:${branch.branchId}:T${pad(turn.turnNumber)}`);
      assert(turn.nextDecisionKernelId && !turn.completedKernelIds.includes(turn.nextDecisionKernelId), `POST_CANON_OPTIONS_FROM_COMPLETED_KERNEL:${branch.branchId}:T${pad(turn.turnNumber)}`);
    }
  }
}

const evidence = {
  schemaVersion: "omw.part-one-branch-persistence.v1",
  verdict: "PASS",
  runtimePackageHash: pkg.immutableHash,
  g00: {
    decisionKernelId: g00.openDecisionKernel.assetId,
    decisionPointId: g00.decisionPoint?.decisionPointId || null,
    optionIds: g00.decisionAffordances.map((option) => option.affordanceTemplateId),
  },
  capabilityObservation: {
    completionMode: "OBSERVE_ONLY",
    kernelStillOpen: observedWorkingSet.openDecisionKernel?.assetId === g00.openDecisionKernel.assetId,
    pendingConsequenceDelta: array(observedState.pendingConsequences).length - array(initialState.pendingConsequences).length,
    stateHash: hash(observedState),
  },
  branches: [summarizeBranch(branchA), summarizeBranch(branchB)],
  divergence: {
    firstDifferentTurn: branchA.turns.find((turn, index) => turn.stateHash !== branchB.turns[index]?.stateHash)?.turnNumber || null,
    finalStateHashesDifferent: branchA.finalStateHash !== branchB.finalStateHash,
    completedKernelSetsDifferent: JSON.stringify(branchA.finalState.completedKernelIds) !== JSON.stringify(branchB.finalState.completedKernelIds),
    durableStateDifferent: JSON.stringify(branchA.finalState.durableState) !== JSON.stringify(branchB.finalState.durableState),
  },
  generatedAt: new Date().toISOString(),
};
const outputPath = resolve(
  process.env.AI_STORY_BRANCH_EVIDENCE_PATH
    || resolve(root, "docs/auto-execute/evidence/chatgpt-pro-convergence/branch-persistence.json"),
);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify(evidence, null, 2));

function runBranch(branchId, seedState, seedTurn, count, choose) {
  let state = clone(seedState);
  const turns = [];
  for (let offset = 1; offset <= count; offset += 1) {
    const turnNumber = seedTurn + offset;
    const beforeHash = hash(state);
    const workingSet = buildWorkingSet(pkg, state, turnNumber - 1);
    const options = array(workingSet.decisionAffordances);
    if (!options.length) break;
    const option = choose(options, turnNumber);
    assert(option, `NO_OPTION_SELECTED:${branchId}:T${pad(turnNumber)}`);
    const action = {
      source: "RECOMMENDED",
      decisionId: option.affordanceTemplateId,
      decisionKernelId: option.decisionKernelId || workingSet.openDecisionKernel?.assetId,
      affordanceTemplateId: option.affordanceTemplateId,
      label: option.title || option.actionText,
      actionText: option.actionText,
      targetRef: option.targetRef,
    };
    const settlement = settleAction(pkg, state, action, turnNumber);
    const nextState = stateFrom(settlement);
    const nextHash = hash(nextState);
    assert(nextHash !== beforeHash, `SETTLEMENT_DID_NOT_CHANGE_STATE:${branchId}:T${pad(turnNumber)}`);
    const nextWorkingSet = nextState.partCompletionStatus === "HANDOFF_READY"
      ? null
      : buildWorkingSet(pkg, nextState, turnNumber);
    turns.push({
      turnNumber,
      selectedAffordanceId: option.affordanceTemplateId,
      selectedKernelId: action.decisionKernelId,
      beforeStateHash: beforeHash,
      stateHash: nextHash,
      completedKernelIds: [...array(nextState.completedKernelIds)].sort(),
      pendingConsequences: clone(array(nextState.pendingConsequences)),
      nextDecisionKernelId: nextWorkingSet?.openDecisionKernel?.assetId || null,
      nextOptionIds: array(nextWorkingSet?.decisionAffordances).map((entry) => entry.affordanceTemplateId),
      nextOptionCount: array(nextWorkingSet?.decisionAffordances).length,
      storyComplete: nextState.partCompletionStatus === "HANDOFF_READY",
      changedStatePaths: array(settlement.changedStatePaths),
      createdPendingConsequenceIds: array(settlement.createdPendingConsequences).map(consequenceId),
    });
    state = nextState;
  }
  return { branchId, turns, finalState: state, finalStateHash: hash(state) };
}

function encodeCapabilityAction(decisionPointId, action) {
  const envelope = Buffer.from(JSON.stringify({
    schemaVersion: "omw-capability-action-v1",
    decisionPointId,
    action,
  }), "utf8").toString("base64url");
  return `\u2063OMW_CAPABILITY_V1:${envelope}\u2063`;
}

function stateFrom(settlement) {
  for (const key of ["proposedState", "nextState", "state", "settledState"]) {
    if (settlement?.[key] && typeof settlement[key] === "object") return clone(settlement[key]);
  }
  throw new Error(`SETTLEMENT_STATE_MISSING:${Object.keys(settlement || {}).join(",")}`);
}

function validConsequenceTransition(previous, next) {
  const allowed = {
    PENDING: new Set(["PENDING", "DUE", "PAID", "DEFERRED_WITH_REASON", "TRANSFORMED"]),
    DUE: new Set(["DUE", "PAID", "DEFERRED_WITH_REASON", "TRANSFORMED"]),
    DEFERRED_WITH_REASON: new Set(["DEFERRED_WITH_REASON", "DUE", "PAID", "TRANSFORMED"]),
    TRANSFORMED: new Set(["TRANSFORMED", "DUE", "PAID", "DEFERRED_WITH_REASON"]),
    PAID: new Set(["PAID"]),
  };
  const from = String(previous?.status || "PENDING");
  const to = String(next?.status || "PENDING");
  return Boolean(allowed[from]?.has(to));
}

function summarizeBranch(branch) {
  return {
    branchId: branch.branchId,
    finalStateHash: branch.finalStateHash,
    finalSectionId: branch.finalState.sectionId,
    finalCompletionStatus: branch.finalState.partCompletionStatus,
    completedKernelIds: array(branch.finalState.completedKernelIds),
    pendingConsequences: array(branch.finalState.pendingConsequences).map((item) => ({
      consequenceId: consequenceId(item),
      status: item.status || null,
      causedByEventId: item.causedByEventId || null,
      dueWindow: item.dueWindow || null,
    })),
    turns: branch.turns,
  };
}

function consequenceId(value) {
  return String(value?.consequenceId || value?.id || value?.ruleId || hash(value).slice(0, 16));
}
function array(value) {
  return Array.isArray(value) ? value : [];
}
function clone(value) {
  return structuredClone(value);
}
function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
function assert(condition, code) {
  if (!condition) throw new Error(code);
}
function pad(value) {
  return String(value).padStart(2, "0");
}
