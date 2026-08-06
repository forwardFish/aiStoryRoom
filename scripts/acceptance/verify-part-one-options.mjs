import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const runtimePackagePath = resolve(
  root,
  "packages/templates/config/sangtian/story-package/part-one-runtime.json",
);
const pkg = JSON.parse(readFileSync(runtimePackagePath, "utf8"));
const runtime = await import(pathToFileURL(
  resolve(root, "packages/templates/dist/runtime-entry.js"),
).href);
const buildWorkingSet = runtime.buildPartOneRuntimeWorkingSet;
const settleAction = runtime.settlePartOneAction;
if (typeof buildWorkingSet !== "function" || typeof settleAction !== "function") {
  throw new Error("PART_ONE_OPTIONS_RUNTIME_EXPORTS_MISSING");
}

const forbiddenPlayerSurface = /statePatch|pendingConsequence|decisionKernel|affordanceTemplate|resultCeiling|sourceRef|fixture|mock|token|测试|后台|内部字段/iu;
const primaryKernels = pkg.assets.filter((asset) => (
  asset.assetType === "DECISION_KERNEL"
  && String(asset.assetId).startsWith("DK-P1-")
));
assert(primaryKernels.length === 15, `PRIMARY_KERNEL_COUNT:${primaryKernels.length}`);

const continuationById = new Map();
for (const floor of pkg.assets.filter((asset) => asset.assetType === "SECTION_FLOOR_OBLIGATION")) {
  for (const continuation of array(floor.payload?.continuationDecisions)) {
    const id = text(continuation.continuationDecisionId, "continuationDecisionId");
    assert(!continuationById.has(id), `CONTINUATION_DUPLICATE:${id}`);
    continuationById.set(id, {
      basedOnDecisionKernelId: text(
        continuation.basedOnDecisionKernelId,
        `${id}.basedOnDecisionKernelId`,
      ),
      optionIds: array(continuation.options).map((option) => (
        text(option.affordanceTemplateId, `${id}.optionId`)
      )),
    });
  }
}
assert(continuationById.size === 5, `CONTINUATION_COUNT:${continuationById.size}`);

const staticKernels = primaryKernels.map((kernel) => {
  const options = array(kernel.payload?.options);
  validateOptionSet({
    label: kernel.assetId,
    options,
    getId: (option) => option.affordanceTemplateId,
    getAction: (option) => option.actionText,
    getTarget: (option) => option.targetRef,
    getMethod: (option) => option.method,
  });
  return {
    decisionKernelId: kernel.assetId,
    optionIds: options.map((option) => option.affordanceTemplateId),
  };
});

const branches = [
  runBranch("A", (options) => options[0]),
  runBranch("B", (options) => options[options.length - 1]),
];
for (const branch of branches) {
  assert(branch.turnCount === 20, `TURN_COUNT:${branch.branchId}:${branch.turnCount}`);
  assert(branch.primaryCount === 15, `PRIMARY_TURN_COUNT:${branch.branchId}:${branch.primaryCount}`);
  assert(branch.continuationCount === 5, `CONTINUATION_TURN_COUNT:${branch.branchId}:${branch.continuationCount}`);
  assert(branch.partCompletionStatus === "HANDOFF_READY", `PART_NOT_COMPLETE:${branch.branchId}`);
}

const evidence = {
  schemaVersion: "omw.part-one-options-after-canon.v1",
  verdict: "PASS",
  runtimePackageHash: pkg.immutableHash,
  staticKernelCount: primaryKernels.length,
  continuationDefinitionCount: continuationById.size,
  staticKernels,
  branches,
  generatedAt: new Date().toISOString(),
};
const outputPath = resolve(
  process.env.AI_STORY_OPTIONS_EVIDENCE_PATH
    || resolve(root, "docs/auto-execute/evidence/chatgpt-pro-convergence/options-after-canon.json"),
);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
console.log(JSON.stringify(evidence, null, 2));

function runBranch(branchId, choose) {
  let state = structuredClone(pkg.worldStart.state);
  const turns = [];
  for (let turnNumber = 1; turnNumber <= 20; turnNumber += 1) {
    assert(state.partCompletionStatus !== "HANDOFF_READY", `EARLY_PART_END:${branchId}:T${pad(turnNumber)}`);
    const workingSet = buildWorkingSet(pkg, state, turnNumber - 1);
    const pointId = text(workingSet.decisionPoint?.decisionPointId, "decisionPointId");
    const kernelId = text(workingSet.openDecisionKernel?.assetId, "openDecisionKernel");
    const completed = array(state.completedKernelIds).includes(kernelId);
    let decisionKind = "PRIMARY";
    if (pointId === kernelId) {
      assert(!completed, `COMPLETED_PRIMARY_REOPENED:${branchId}:T${pad(turnNumber)}:${kernelId}`);
    } else {
      decisionKind = "CONTINUATION";
      const continuation = continuationById.get(pointId);
      assert(continuation, `CONTINUATION_UNKNOWN:${branchId}:T${pad(turnNumber)}:${pointId}`);
      assert(
        continuation.basedOnDecisionKernelId === kernelId,
        `CONTINUATION_KERNEL_MISMATCH:${branchId}:T${pad(turnNumber)}:${pointId}`,
      );
      assert(completed, `CONTINUATION_BASE_NOT_COMPLETED:${branchId}:T${pad(turnNumber)}:${kernelId}`);
    }

    const options = array(workingSet.decisionAffordances);
    validateOptionSet({
      label: `${branchId}:T${pad(turnNumber)}:${pointId}`,
      options,
      getId: (option) => option.affordanceTemplateId,
      getAction: (option) => option.actionText,
      getTarget: (option) => option.target?.id,
      getMethod: (option) => option.method,
    });
    for (const option of options) {
      assert(option.decisionKernelId === kernelId, `OPTION_KERNEL_MISMATCH:${branchId}:T${pad(turnNumber)}`);
      assert(option.decisionPointId === pointId, `OPTION_POINT_MISMATCH:${branchId}:T${pad(turnNumber)}`);
      if (decisionKind === "CONTINUATION") {
        assert(
          continuationById.get(pointId).optionIds.includes(option.affordanceTemplateId),
          `CONTINUATION_OPTION_UNBOUND:${branchId}:T${pad(turnNumber)}:${option.affordanceTemplateId}`,
        );
      }
    }

    const selected = choose(options, turnNumber);
    assert(selected, `OPTION_NOT_SELECTED:${branchId}:T${pad(turnNumber)}`);
    const beforeHash = hash(state);
    const settlement = settleAction(pkg, state, {
      source: "RECOMMENDED",
      decisionId: selected.affordanceTemplateId,
      decisionKernelId: selected.decisionKernelId,
      affordanceTemplateId: selected.affordanceTemplateId,
      label: selected.title,
      actionText: selected.actionText,
      targetRef: selected.target.id,
    }, turnNumber);
    state = structuredClone(settlement.proposedState);
    assert(hash(state) !== beforeHash, `OPTION_DID_NOT_SETTLE:${branchId}:T${pad(turnNumber)}`);
    turns.push({
      turnId: `T${pad(turnNumber)}`,
      decisionKind,
      decisionPointId: pointId,
      decisionKernelId: kernelId,
      optionIds: options.map((option) => option.affordanceTemplateId),
      selectedOptionId: selected.affordanceTemplateId,
    });
  }
  return {
    branchId,
    turnCount: turns.length,
    primaryCount: turns.filter((turn) => turn.decisionKind === "PRIMARY").length,
    continuationCount: turns.filter((turn) => turn.decisionKind === "CONTINUATION").length,
    partCompletionStatus: state.partCompletionStatus || null,
    finalStateHash: hash(state),
    turns,
  };
}

function validateOptionSet(input) {
  const options = input.options;
  assert(
    options.length >= 2 && options.length <= 4,
    `OPTION_COUNT:${input.label}:${options.length}`,
  );
  const ids = new Set();
  const actions = new Set();
  for (const option of options) {
    const id = text(input.getId(option), `${input.label}.optionId`);
    const action = text(input.getAction(option), `${id}.actionText`);
    const target = text(input.getTarget(option), `${id}.target`);
    const method = text(input.getMethod(option), `${id}.method`);
    assert(!ids.has(id), `OPTION_ID_DUPLICATE:${input.label}:${id}`);
    assert(!actions.has(action), `OPTION_ACTION_DUPLICATE:${input.label}:${id}`);
    assert(!forbiddenPlayerSurface.test(action), `OPTION_INTERNAL_SURFACE:${input.label}:${id}`);
    ids.add(id);
    actions.add(action);
    option.__validatedTarget = target;
    option.__validatedMethod = method;
  }
  for (let left = 0; left < options.length; left += 1) {
    for (let right = left + 1; right < options.length; right += 1) {
      assert(
        options[left].__validatedTarget !== options[right].__validatedTarget
          || options[left].__validatedMethod !== options[right].__validatedMethod,
        `OPTION_NOT_MATERIALLY_DISTINCT:${input.label}:${input.getId(options[left])}:${input.getId(options[right])}`,
      );
    }
  }
  for (const option of options) {
    delete option.__validatedTarget;
    delete option.__validatedMethod;
  }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
function text(value, label) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`TEXT_REQUIRED:${label}`);
  return result;
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
