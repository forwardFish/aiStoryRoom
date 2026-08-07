import {
  createOutcomeSignature,
  kernelTieBreaker,
  selectKernelLite,
  stableCanonicalJson,
  stableSha256,
  type AffordanceOutcomeSignature,
  type KernelSelectorLiteCandidate,
  type KernelSelectorLiteEvaluation,
  type KernelSelectorLiteResult,
} from "../runtime-contract/kernel-selector-lite.js";
import {
  buildPartOneRuntimeWorkingSet as buildLegacyWorkingSet,
  evaluatePartOneRule,
  settlePartOneAction as settleLegacyAction,
  type PartOneIncomingAction,
} from "./part-one-runtime-engine.js";
import type {
  PartOneActionSettlement,
  PartOneAffordanceTemplate,
  PartOneCommittedEvent,
  PartOneContinuationDecisionTemplate,
  PartOneRuntimeAffordance,
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
  PartOneRuntimeWorkingSet,
  PartOneSectionContract,
  PartOneState,
  PartOneStateRule,
} from "./part-one-runtime-types.js";

export type PartOneKernelSelectionMode = "DYNAMIC_LITE" | "LEGACY_FIXED";
export type PartOneDecisionPin = {
  decisionKernelId: string;
  decisionPointId: string;
  affordanceIds?: string[];
  outcomeHashes?: string[];
};
export type PartOneWorkingSetSelectionOptions = {
  mode?: PartOneKernelSelectionMode;
  pin?: PartOneDecisionPin | null;
};
export type KernelSelectionTrace = {
  schemaVersion: "kernel-selection-trace-v1";
  selectorVersion: "kernel-selector-lite-v1";
  mode: "DYNAMIC_LITE" | "PINNED_RECOVERY" | "LEGACY_FIXED" | "LEGACY_FALLBACK" | "CONTINUATION" | "HANDOFF";
  sectionId: string;
  stateRevision: number;
  stateFingerprint: string;
  selectedKernelId: string;
  selectedDecisionPointId: string;
  selectedAffordanceIds: string[];
  selectedOutcomeHashes: string[];
  candidates: Array<{
    kernelId: string;
    score: number;
    tieBreaker: string;
    eligible: boolean;
    reasonCodes: string[];
    validAffordanceIds: string[];
    outcomeHashes: string[];
    maximumOutcomeDistance: number;
  }>;
  fallbackReason?: string;
};
export type DynamicPartOneRuntimeWorkingSet = PartOneRuntimeWorkingSet & {
  kernelSelection: KernelSelectionTrace;
};
export type DynamicPartOneCommittedEvent = PartOneCommittedEvent & {
  nextKernelSelection?: KernelSelectionTrace;
};
export type DynamicPartOneActionSettlement = Omit<PartOneActionSettlement, "event"> & {
  event: DynamicPartOneCommittedEvent;
};

type Preview = {
  affordance: PartOneRuntimeAffordance;
  signature: AffordanceOutcomeSignature;
  changedStatePaths: string[];
};
type Evaluation = {
  kernelId: string;
  workingSet: PartOneRuntimeWorkingSet | null;
  authoredOrder: Map<string, number>;
  previews: Preview[];
  candidate: KernelSelectorLiteCandidate<Preview>;
};
type WorkingSetProjection = {
  state: PartOneState;
  workingSet: PartOneRuntimeWorkingSet;
};

const ACTIVE_PENDING = new Set([
  "PENDING",
  "DUE",
  "DEFERRED_WITH_REASON",
  "TRANSFORMED",
]);
const RESOLVED_ARCS = new Set([
  "RESOLVED",
  "CLOSED",
  "COMPLETE",
  "COMPLETED",
]);
const IGNORED_PATHS = new Set([
  "turnNumber",
  "sectionTurnNumber",
  "lastCommittedEventId",
  "completedKernelIds",
  "scene",
  "durableState",
  "pendingConsequences",
  "partCompletionStatus",
]);
const CONTINUATION_EXHAUSTED = "PART_ONE_RUNTIME_CONTINUATION_EXHAUSTED";

/**
 * Select and materialize one existing Decision Kernel from authoritative state.
 * Primary Dynamic, Legacy Fallback and Floor Continuation are mutually
 * exclusive paths. Floor Continuation remains authored-affordance based; when
 * an old section has no explicit continuation entry, the runtime compiles a
 * deterministic entry from the section's structural Floor links instead of
 * guessing from prose or silently reopening a Primary Kernel.
 */
export function buildDynamicPartOneRuntimeWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  options: PartOneWorkingSetSelectionOptions = {},
): DynamicPartOneRuntimeWorkingSet {
  const section = requireSection(pkg, state.sectionId);
  const fingerprint = fingerprintState(state);
  if (state.partCompletionStatus === "HANDOFF_READY") {
    return traced(
      buildLegacyWorkingSet(pkg, state, turnNumber),
      baseTrace("HANDOFF", section, state, fingerprint),
    );
  }
  if (options.pin) {
    return pinnedWorkingSet(
      pkg,
      state,
      turnNumber,
      options.pin,
      fingerprint,
    );
  }

  const completed = new Set(state.completedKernelIds || []);
  const unresolved = section.activeDecisionKernelIds.filter(
    (id) => !completed.has(id),
  );
  if (!unresolved.length) {
    return buildContinuationWorkingSet(
      pkg,
      state,
      turnNumber,
      null,
      fingerprint,
    );
  }
  if (options.mode === "LEGACY_FIXED") {
    return legacyFallbackWorkingSet(
      pkg,
      state,
      turnNumber,
      section,
      fingerprint,
      "LEGACY_FIXED",
    );
  }

  const evaluated = unresolved.map((kernelId) => evaluateKernelSafely(
    pkg,
    state,
    section,
    kernelId,
    turnNumber,
  ));
  const selection = selectKernelLite(
    evaluated.map((item) => item.candidate),
    fingerprint,
  );
  if (!selection.selected?.pair) {
    return legacyFallbackWorkingSet(
      pkg,
      state,
      turnNumber,
      section,
      fingerprint,
      "LEGACY_FALLBACK",
      selection,
    );
  }

  const evaluation = evaluated.find(
    (item) => item.kernelId === selection.selected!.kernelId,
  );
  if (!evaluation?.workingSet) {
    throw new Error("PART_ONE_DYNAMIC_KERNEL_SELECTION_MISSING");
  }
  const selectedIds = [
    selection.selected.pair.left.affordanceId,
    selection.selected.pair.right.affordanceId,
  ];
  const affordances = selectAffordances(evaluation, selectedIds);
  const workingSet = {
    ...evaluation.workingSet,
    decisionAffordances: affordances,
  };
  return traced(workingSet, {
    ...selectionTrace(selection, section, state, workingSet),
    mode: "DYNAMIC_LITE",
  });
}

export function isDynamicCapabilityAction(action: PartOneIncomingAction) {
  return String(action.actionText || "")
    .startsWith("\u2063OMW_CAPABILITY_V1:");
}

export function forcePackageForDynamicWorkingSets(
  pkg: PartOneRuntimePackage,
  projections: WorkingSetProjection[],
): PartOneRuntimePackage {
  let projected = clone(pkg);
  const primaryBySection = new Map<string, string[]>();
  const affordanceIdsByKernel = new Map<string, string[]>();

  for (const projection of projections) {
    const { state, workingSet } = projection;
    if (isContinuation(workingSet)) {
      projected = injectContinuationForWorkingSet(
        projected,
        state,
        workingSet,
      );
      continue;
    }
    const sectionId = state.sectionId;
    const preferred = primaryBySection.get(sectionId) || [];
    if (!preferred.includes(workingSet.decisionPoint.decisionKernelId)) {
      preferred.push(workingSet.decisionPoint.decisionKernelId);
    }
    primaryBySection.set(sectionId, preferred);
    affordanceIdsByKernel.set(
      workingSet.decisionPoint.decisionKernelId,
      workingSet.decisionAffordances.map(
        (affordance) => affordance.affordanceTemplateId,
      ),
    );
  }

  projected.sections = projected.sections.map((section) => {
    const preferred = primaryBySection.get(section.sectionId);
    if (!preferred?.length) return section;
    return {
      ...section,
      activeDecisionKernelIds: [
        ...preferred,
        ...section.activeDecisionKernelIds.filter(
          (id) => !preferred.includes(id),
        ),
      ],
    };
  });
  projected.assets = projected.assets.map((asset) => {
    const ids = affordanceIdsByKernel.get(asset.assetId);
    if (!ids?.length || asset.assetType !== "DECISION_KERNEL") {
      return asset;
    }
    return reorderKernelOptions(asset, ids);
  });
  return projected;
}

function pinnedWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  pin: PartOneDecisionPin,
  fingerprint: string,
): DynamicPartOneRuntimeWorkingSet {
  const section = requireSection(pkg, state.sectionId);
  if (pin.decisionPointId !== pin.decisionKernelId) {
    return buildContinuationWorkingSet(
      pkg,
      state,
      turnNumber,
      pin,
      fingerprint,
    );
  }
  if (!section.activeDecisionKernelIds.includes(pin.decisionKernelId)) {
    throw new Error("PART_ONE_PINNED_KERNEL_NOT_IN_SECTION");
  }

  const evaluation = evaluateKernelSafely(
    pkg,
    state,
    section,
    pin.decisionKernelId,
    turnNumber,
  );
  if (!evaluation.workingSet) {
    throw new Error("PART_ONE_PINNED_KERNEL_EVALUATION_FAILED");
  }
  let ids = pin.affordanceIds ? [...new Set(pin.affordanceIds)] : [];
  if (!ids.length) {
    const selected = selectKernelLite(
      [evaluation.candidate],
      fingerprint,
    ).selected;
    if (!selected?.pair) {
      throw new Error("PART_ONE_PINNED_AFFORDANCE_PREVIEW_REJECTED");
    }
    ids = [
      selected.pair.left.affordanceId,
      selected.pair.right.affordanceId,
    ];
  }
  const affordances = selectAffordances(evaluation, ids);
  const hashes = ids.map((id) => evaluation.previews.find(
    (item) => item.affordance.affordanceTemplateId === id,
  )?.signature.hash);
  if (hashes.some((hash) => !hash)) {
    throw new Error("PART_ONE_PINNED_AFFORDANCE_NOT_FOUND");
  }
  if (
    pin.outcomeHashes?.length
    && (
      pin.outcomeHashes.length !== hashes.length
      || pin.outcomeHashes.some((hash, index) => hash !== hashes[index])
    )
  ) {
    throw new Error("PART_ONE_PINNED_OUTCOME_HASH_MISMATCH");
  }

  return traced({
    ...evaluation.workingSet,
    decisionAffordances: affordances,
  }, {
    schemaVersion: "kernel-selection-trace-v1",
    selectorVersion: "kernel-selector-lite-v1",
    mode: "PINNED_RECOVERY",
    sectionId: section.sectionId,
    stateRevision: revisionOf(state, turnNumber),
    stateFingerprint: fingerprint,
    selectedKernelId: pin.decisionKernelId,
    selectedDecisionPointId: pin.decisionPointId,
    selectedAffordanceIds: affordances.map(
      (item) => item.affordanceTemplateId,
    ),
    selectedOutcomeHashes: hashes as string[],
    candidates: [{
      kernelId: evaluation.kernelId,
      score: 0,
      tieBreaker: kernelTieBreaker(fingerprint, evaluation.kernelId),
      eligible: true,
      reasonCodes: [
        ...evaluation.candidate.rejectionCodes,
        "PINNED_RECOVERY",
      ],
      validAffordanceIds: evaluation.previews
        .map((item) => item.affordance.affordanceTemplateId)
        .sort(),
      outcomeHashes: evaluation.previews
        .map((item) => item.signature.hash)
        .sort(),
      maximumOutcomeDistance: 0,
    }],
  });
}

function buildContinuationWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  pin: PartOneDecisionPin | null,
  fingerprint: string,
): DynamicPartOneRuntimeWorkingSet {
  const section = requireSection(pkg, state.sectionId);
  try {
    const authored = buildLegacyWorkingSet(pkg, state, turnNumber);
    if (!isContinuation(authored)) {
      throw new Error("PART_ONE_CONTINUATION_PRIMARY_PATH_COLLISION");
    }
    if (!pin || continuationMatchesPin(authored, pin)) {
      return traced(
        authored,
        continuationTrace(authored, section, state, fingerprint, pin),
      );
    }
    // The authoritative event may pin the previously committed continuation
    // even though sectionTurnNumber now points at the next authored entry. In
    // that case the pin, not array position, owns recovery. Fall through to the
    // deterministic synthesis path below; invalid kernel or Affordance IDs
    // still fail closed during synthesis.
  } catch (error) {
    if (!String(error instanceof Error ? error.message : error)
      .startsWith(CONTINUATION_EXHAUSTED)) {
      throw error;
    }
  }

  const synthesized = synthesizeContinuationPackage(
    pkg,
    state,
    pin,
  );
  const workingSet = buildLegacyWorkingSet(
    synthesized,
    state,
    turnNumber,
  );
  if (!isContinuation(workingSet)) {
    throw new Error("PART_ONE_SYNTHETIC_CONTINUATION_NOT_SELECTED");
  }
  assertContinuationPin(workingSet, pin);
  return traced(
    workingSet,
    continuationTrace(workingSet, section, state, fingerprint, pin),
  );
}

function continuationMatchesPin(
  workingSet: PartOneRuntimeWorkingSet,
  pin: PartOneDecisionPin,
) {
  if (
    workingSet.decisionPoint.decisionKernelId !== pin.decisionKernelId
    || workingSet.decisionPoint.decisionPointId !== pin.decisionPointId
  ) {
    return false;
  }
  if (!pin.affordanceIds?.length) return true;
  return sameStringArray(
    workingSet.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
    pin.affordanceIds,
  );
}

function continuationTrace(
  workingSet: PartOneRuntimeWorkingSet,
  section: PartOneSectionContract,
  state: PartOneState,
  fingerprint: string,
  pin: PartOneDecisionPin | null,
): KernelSelectionTrace {
  const actualIds = workingSet.decisionAffordances.map(
    (item) => item.affordanceTemplateId,
  );
  if (pin?.affordanceIds?.length && !sameStringArray(
    actualIds,
    pin.affordanceIds,
  )) {
    throw new Error("PART_ONE_PINNED_CONTINUATION_AFFORDANCE_MISMATCH");
  }
  return {
    ...baseTrace("CONTINUATION", section, state, fingerprint),
    selectedKernelId: workingSet.decisionPoint.decisionKernelId,
    selectedDecisionPointId: workingSet.decisionPoint.decisionPointId,
    selectedAffordanceIds: actualIds,
  };
}

function assertContinuationPin(
  workingSet: PartOneRuntimeWorkingSet,
  pin: PartOneDecisionPin | null,
) {
  if (!pin) return;
  if (
    workingSet.decisionPoint.decisionKernelId !== pin.decisionKernelId
    || workingSet.decisionPoint.decisionPointId !== pin.decisionPointId
  ) {
    throw new Error("PART_ONE_PINNED_DECISION_POINT_NOT_FOUND");
  }
}

function legacyFallbackWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  section: PartOneSectionContract,
  fingerprint: string,
  mode: "LEGACY_FIXED" | "LEGACY_FALLBACK",
  selection: KernelSelectorLiteResult<Preview> | null = null,
): DynamicPartOneRuntimeWorkingSet {
  const completed = new Set(state.completedKernelIds || []);
  const failures: string[] = [];
  for (const kernelId of section.activeDecisionKernelIds) {
    if (completed.has(kernelId)) continue;
    try {
      const workingSet = buildLegacyWorkingSet(
        forcePrimaryPackage(pkg, section.sectionId, kernelId, null, false),
        state,
        turnNumber,
      );
      const trace = selection
        ? selectionTrace(selection, section, state, workingSet)
        : baseTrace(mode, section, state, fingerprint);
      return traced(workingSet, {
        ...trace,
        mode,
        fallbackReason: mode === "LEGACY_FALLBACK"
          ? "NO_ELIGIBLE_DYNAMIC_KERNEL"
          : undefined,
      });
    } catch (error) {
      failures.push(`${kernelId}:${normalizeErrorCode(error)}`);
    }
  }
  if (!section.activeDecisionKernelIds.some((id) => !completed.has(id))) {
    return buildContinuationWorkingSet(
      pkg,
      state,
      turnNumber,
      null,
      fingerprint,
    );
  }
  throw new Error(
    `PART_ONE_DYNAMIC_LEGACY_FALLBACK_UNAVAILABLE:${failures.join(",")}`,
  );
}

function evaluateKernelSafely(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  section: PartOneSectionContract,
  kernelId: string,
  turnNumber: number,
): Evaluation {
  try {
    return evaluateKernel(pkg, state, section, kernelId, turnNumber);
  } catch (error) {
    return {
      kernelId,
      workingSet: null,
      authoredOrder: new Map(),
      previews: [],
      candidate: {
        kernelId,
        completed: Boolean(state.completedKernelIds?.includes(kernelId)),
        allowedInCurrentScope:
          section.activeDecisionKernelIds.includes(kernelId),
        structurallyResolved: false,
        unmetMustEstablishCount: 0,
        unmetExitGateCount: 0,
        duePressureCount: 0,
        pendingPressureCount: 0,
        activeArcCount: 0,
        availablePressureActorCount: 0,
        validAffordances: [],
        rejectionCodes: [
          `KERNEL_EVALUATION_FAILED:${normalizeErrorCode(error)}`,
        ],
      },
    };
  }
}

function evaluateKernel(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  section: PartOneSectionContract,
  kernelId: string,
  turnNumber: number,
): Evaluation {
  const kernel = requireKernel(pkg, kernelId);
  const options = Array.isArray(kernel.payload.options)
    ? kernel.payload.options
    : [];
  if (!options.length) {
    throw new Error(`PART_ONE_RUNTIME_KERNEL_OPTIONS_MISSING:${kernelId}`);
  }
  const authoredOrder = new Map(options.map(
    (option, index) => [option.affordanceTemplateId, index],
  ));
  const rejectionCodes: string[] = [];
  const materialized: Array<{
    workingSet: PartOneRuntimeWorkingSet;
    affordance: PartOneRuntimeAffordance;
  }> = [];

  for (const option of options) {
    try {
      const result = materializeAffordance(
        pkg,
        state,
        turnNumber,
        kernelId,
        option.affordanceTemplateId,
      );
      if (!result.affordance) {
        rejectionCodes.push(
          `AFFORDANCE_NOT_SURFACED:${option.affordanceTemplateId}`,
        );
        continue;
      }
      materialized.push({
        workingSet: result.workingSet,
        affordance: result.affordance,
      });
    } catch (error) {
      rejectionCodes.push(
        `AFFORDANCE_MATERIALIZATION_FAILED:${option.affordanceTemplateId}:${normalizeErrorCode(error)}`,
      );
    }
  }

  const first = materialized[0]?.workingSet;
  if (!first) {
    throw new Error("PART_ONE_DYNAMIC_KERNEL_WORKING_SET_UNAVAILABLE");
  }
  const affordances = materialized.map((item) => item.affordance);
  const candidateWorkingSet = {
    ...first,
    decisionAffordances: affordances,
  };
  const previews: Preview[] = [];
  for (const affordance of affordances) {
    try {
      const previewPackage = buildPreviewPackage(
        pkg,
        state,
        kernelId,
        affordance.affordanceTemplateId,
      );
      const preview = settleLegacyAction(
        previewPackage,
        state,
        incomingForAffordance(affordance),
        turnNumber + 1,
      );
      const signature = outcomeSignature(
        preview,
        affordance.affordanceTemplateId,
      );
      if (hasMaterialOutcome(signature, preview)) {
        previews.push({
          affordance,
          signature,
          changedStatePaths: [...new Set(preview.event.changedStatePaths)]
            .filter((path) => !IGNORED_PATHS.has(path)),
        });
      } else {
        rejectionCodes.push(
          `NO_MATERIAL_OUTCOME:${affordance.affordanceTemplateId}`,
        );
      }
    } catch (error) {
      rejectionCodes.push(
        `AFFORDANCE_PREVIEW_REJECTED:${affordance.affordanceTemplateId}:${normalizeErrorCode(error)}`,
      );
    }
  }

  const coveredPaths = requirementCoveragePaths(
    pkg,
    section,
    kernel,
    options,
    previews,
  );
  const mustRules = uniqueRules(section.mustEstablish).filter(
    (rule) => coveredPaths.has(rule.statePath),
  );
  const exitRules = uniqueRules(section.exitGates).filter(
    (rule) => coveredPaths.has(rule.statePath),
  );
  const unmetMust = mustRules.filter(
    (rule) => !evaluatePartOneRule(state, rule),
  );
  const unmetExit = exitRules.filter(
    (rule) => !evaluatePartOneRule(state, rule),
  );
  const pending = linkedPending(pkg, state, kernel);
  const nextTurn = turnNumber + 1;
  const present = new Set(state.scene?.presentActorRefs || []);
  if (options.length < 2) rejectionCodes.push("KERNEL_OPTIONS_MISSING");
  if (affordances.length !== options.length) {
    rejectionCodes.push("AFFORDANCE_MATERIALIZATION_FAILED");
  }
  if (previews.length < 2) {
    rejectionCodes.push("AFFORDANCE_PREVIEW_FAILED");
  }

  return {
    kernelId,
    workingSet: candidateWorkingSet,
    authoredOrder,
    previews,
    candidate: {
      kernelId,
      completed: Boolean(state.completedKernelIds?.includes(kernelId)),
      allowedInCurrentScope:
        section.activeDecisionKernelIds.includes(kernelId)
        && kernel.sectionIds.includes(section.sectionId),
      structurallyResolved:
        mustRules.length + exitRules.length > 0
        && unmetMust.length === 0
        && unmetExit.length === 0
        && pending.length === 0,
      unmetMustEstablishCount: unmetMust.length,
      unmetExitGateCount: unmetExit.length,
      duePressureCount: pending.filter(
        (item) => item.dueTurn <= nextTurn,
      ).length,
      pendingPressureCount: pending.filter(
        (item) => item.dueTurn > nextTurn,
      ).length,
      activeArcCount: kernel.causalArcIds.filter((arcId) => (
        !RESOLVED_ARCS.has(
          String(state.causalArcStages?.[arcId] || "OPEN").toUpperCase(),
        )
      )).length,
      availablePressureActorCount: candidateWorkingSet.decisionPoint.actorRefs
        .filter((actorId) => present.has(actorId)).length,
      validAffordances: previews.map((preview) => ({
        affordanceId: preview.affordance.affordanceTemplateId,
        sourceOrder: authoredOrder.get(
          preview.affordance.affordanceTemplateId,
        ) ?? Number.MAX_SAFE_INTEGER,
        outcome: preview.signature,
        payload: preview,
      })),
      rejectionCodes,
    },
  };
}

function requirementCoveragePaths(
  pkg: PartOneRuntimePackage,
  section: PartOneSectionContract,
  kernel: PartOneRuntimeAsset,
  options: PartOneAffordanceTemplate[],
  previews: Preview[],
) {
  const linkedRequirements = pkg.requirements.filter((requirement) => (
    requirement.sectionIds.includes(section.sectionId)
    && (
      requirement.decisionKernelIds.includes(kernel.assetId)
      || kernel.requirementIds.includes(requirement.requirementId)
    )
  ));
  const requirementPaths = linkedRequirements.flatMap((requirement) => (
    asStringArray(requirement.stateEffects)
  ));
  return new Set([
    ...requirementPaths,
    ...kernel.stateDependencies,
    ...options.flatMap((option) => option.stateEffects || []),
    ...options.flatMap((option) => Object.keys(option.statePatch || {})),
    ...previews.flatMap((preview) => preview.changedStatePaths),
  ]);
}

function materializeAffordance(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  kernelId: string,
  affordanceId: string,
) {
  const workingSet = buildLegacyWorkingSet(
    forcePrimaryPackage(
      pkg,
      state.sectionId,
      kernelId,
      [affordanceId],
      true,
    ),
    state,
    turnNumber,
  );
  return {
    workingSet,
    affordance: workingSet.decisionAffordances.find(
      (item) => item.affordanceTemplateId === affordanceId,
    ) || null,
  };
}

function buildPreviewPackage(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  kernelId: string,
  affordanceId: string,
) {
  const isolated = forcePrimaryPackage(
    pkg,
    state.sectionId,
    kernelId,
    [affordanceId],
    true,
  );
  return synthesizeContinuationPackage(
    isolated,
    state,
    null,
    Number(state.sectionTurnNumber || 0),
    kernelId,
  );
}

function outcomeSignature(
  settlement: PartOneActionSettlement,
  affordanceId: string,
) {
  const stateFeatures = [...new Set(settlement.event.changedStatePaths)]
    .filter((path) => !IGNORED_PATHS.has(path))
    .flatMap((path) => {
      const before = getPath(settlement.beforeState, path);
      const after = getPath(settlement.proposedState, path);
      return deepEqual(before, after)
        ? []
        : [`state:${path}=${stableCanonicalJson(after)}`];
    });
  const beforeDurable = new Set(
    (settlement.beforeState.durableState?.predicates || [])
      .map(stableCanonicalJson),
  );
  const durablePredicateFeatures = (
    settlement.proposedState.durableState?.predicates || []
  )
    .map(stableCanonicalJson)
    .filter((predicate) => !beforeDurable.has(predicate))
    .map((predicate) => `durable:${predicate}`);
  const beforePending = new Set(
    (settlement.beforeState.pendingConsequences || [])
      .map((item) => item.consequenceId),
  );
  const pendingRuleFeatures = (
    settlement.proposedState.pendingConsequences || []
  )
    .filter((item) => !beforePending.has(item.consequenceId))
    .map((item) => (
      `pending:${item.ruleAssetId}:${item.status}:${item.dueTurn - settlement.event.turnNumber}`
    ));
  return createOutcomeSignature({
    affordanceId,
    stateFeatures,
    durablePredicateFeatures,
    pendingRuleFeatures,
    sectionAfter: settlement.event.sectionIdAfter,
    partCompletionStatusAfter:
      settlement.proposedState.partCompletionStatus || null,
  });
}

function hasMaterialOutcome(
  signature: AffordanceOutcomeSignature,
  settlement: PartOneActionSettlement,
) {
  return signature.stateFeatures.length > 0
    || signature.durablePredicateFeatures.length > 0
    || signature.pendingRuleFeatures.length > 0
    || settlement.event.sectionIdBefore !== settlement.event.sectionIdAfter
    || settlement.beforeState.partCompletionStatus
      !== settlement.proposedState.partCompletionStatus;
}

function synthesizeContinuationPackage(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  pin: PartOneDecisionPin | null,
  explicitIndex?: number,
  explicitKernelId?: string,
): PartOneRuntimePackage {
  const section = requireSection(pkg, state.sectionId);
  const index = explicitIndex ?? Math.max(
    0,
    Number(state.sectionTurnNumber || 0)
      - section.activeDecisionKernelIds.length,
  );
  const floor = selectFloorAsset(pkg, section);
  const baseKernel = selectContinuationBaseKernel(
    pkg,
    section,
    floor,
    pin?.decisionKernelId || explicitKernelId || null,
  );
  const selectedOptions = selectContinuationOptions(
    baseKernel,
    pin?.affordanceIds || null,
  );
  const continuationId = pin?.decisionPointId
    || `CONT-${stableSha256({
      sectionId: section.sectionId,
      floorId: floor.assetId,
      index,
      kernelId: baseKernel.assetId,
    }).slice(0, 20)}`;
  const template: PartOneContinuationDecisionTemplate = {
    continuationDecisionId: continuationId,
    basedOnDecisionKernelId: baseKernel.assetId,
    worldPressure: {
      pressureId: `PRESSURE-${stableSha256({
        floorId: floor.assetId,
        index,
      }).slice(0, 20)}`,
      summary: floorPressureSummary(floor),
      sourceFloorAssetId: floor.assetId,
    },
    options: selectedOptions,
  };
  const existing = Array.isArray(floor.payload.continuationDecisions)
    ? clone(floor.payload.continuationDecisions)
    : [];
  while (existing.length <= index) {
    const fillIndex = existing.length;
    existing.push({
      ...clone(template),
      continuationDecisionId: fillIndex === index
        ? continuationId
        : `CONT-${stableSha256({
          sectionId: section.sectionId,
          floorId: floor.assetId,
          index: fillIndex,
          kernelId: baseKernel.assetId,
        }).slice(0, 20)}`,
    });
  }
  existing[index] = template;

  const projected = clone(pkg);
  projected.sections = projected.sections.map((candidate) => (
    candidate.sectionId === section.sectionId
      ? { ...candidate, floorObligationIds: [floor.assetId] }
      : candidate
  ));
  const floorExists = projected.assets.some(
    (asset) => asset.assetId === floor.assetId,
  );
  projected.assets = projected.assets.map((asset) => (
    asset.assetId === floor.assetId
      ? {
        ...asset,
        payload: {
          ...asset.payload,
          continuationDecisions: existing,
        },
      }
      : asset
  ));
  if (!floorExists) {
    projected.assets.push({
      ...floor,
      payload: {
        ...floor.payload,
        continuationDecisions: existing,
      },
    });
  }
  return projected;
}

function injectContinuationForWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  workingSet: PartOneRuntimeWorkingSet,
) {
  const pin: PartOneDecisionPin = {
    decisionKernelId: workingSet.decisionPoint.decisionKernelId,
    decisionPointId: workingSet.decisionPoint.decisionPointId,
    affordanceIds: workingSet.decisionAffordances.map(
      (affordance) => affordance.affordanceTemplateId,
    ),
  };
  return synthesizeContinuationPackage(pkg, state, pin);
}

function selectFloorAsset(
  pkg: PartOneRuntimePackage,
  section: PartOneSectionContract,
): PartOneRuntimeAsset {
  for (const floorId of section.floorObligationIds) {
    const floor = pkg.assets.find((asset) => asset.assetId === floorId);
    if (floor) return floor;
  }
  const floorId = `FLOOR-${stableSha256(section.sectionId).slice(0, 20)}`;
  return {
    schemaVersion: "runtime-story-asset-v1",
    assetId: floorId,
    assetType: "SECTION_FLOOR_OBLIGATION",
    partIds: [section.partId],
    sectionIds: [section.sectionId],
    requirementIds: [...section.requiredRequirementIds],
    decisionKernelIds: [...section.activeDecisionKernelIds],
    causalArcIds: [...section.activeCausalArcIds],
    actorRefs: [...section.foregroundActorRefs],
    stateDependencies: [],
    visibilityRules: [],
    sourceClaimIds: [],
    adaptationDecisionIds: [],
    retrievalTags: ["SECTION_FLOOR_OBLIGATION"],
    payload: {},
  };
}

function selectContinuationBaseKernel(
  pkg: PartOneRuntimePackage,
  section: PartOneSectionContract,
  floor: PartOneRuntimeAsset,
  preferredKernelId: string | null,
) {
  if (preferredKernelId) {
    const preferred = requireKernel(pkg, preferredKernelId);
    if (!section.activeDecisionKernelIds.includes(preferred.assetId)) {
      throw new Error("PART_ONE_PINNED_KERNEL_NOT_IN_SECTION");
    }
    requireTwoContinuationOptions(preferred, null);
    return preferred;
  }
  const floorRequirements = new Set(floor.requirementIds);
  const floorArcs = new Set(floor.causalArcIds);
  const candidates = section.activeDecisionKernelIds
    .map((kernelId) => requireKernel(pkg, kernelId))
    .filter((kernel) => (
      Array.isArray(kernel.payload.options)
      && kernel.payload.options.length >= 2
    ))
    .map((kernel) => ({
      kernel,
      score:
        (floor.decisionKernelIds.includes(kernel.assetId) ? 100 : 0)
        + kernel.requirementIds.filter((id) => floorRequirements.has(id)).length * 10
        + kernel.causalArcIds.filter((id) => floorArcs.has(id)).length * 5,
    }))
    .sort((left, right) => (
      right.score - left.score
      || left.kernel.assetId.localeCompare(right.kernel.assetId)
    ));
  const selected = candidates[0]?.kernel;
  if (!selected) {
    throw new Error("PART_ONE_FLOOR_CONTINUATION_KERNEL_UNAVAILABLE");
  }
  return selected;
}

function selectContinuationOptions(
  kernel: PartOneRuntimeAsset,
  pinnedIds: string[] | null,
): PartOneAffordanceTemplate[] {
  const options = Array.isArray(kernel.payload.options)
    ? kernel.payload.options
    : [];
  if (pinnedIds?.length) {
    const ids = [...new Set(pinnedIds)];
    if (ids.length !== 2) {
      throw new Error("PART_ONE_PINNED_CONTINUATION_AFFORDANCE_COUNT_INVALID");
    }
    const selected = ids.map((id) => options.find(
      (option) => option.affordanceTemplateId === id,
    ));
    if (selected.some((option) => !option)) {
      throw new Error("PART_ONE_PINNED_CONTINUATION_AFFORDANCE_NOT_FOUND");
    }
    return selected as PartOneAffordanceTemplate[];
  }
  return requireTwoContinuationOptions(kernel, options);
}

function requireTwoContinuationOptions(
  kernel: PartOneRuntimeAsset,
  supplied: PartOneAffordanceTemplate[] | null,
) {
  const options = supplied || (
    Array.isArray(kernel.payload.options) ? kernel.payload.options : []
  );
  const pairs: Array<{
    left: PartOneAffordanceTemplate;
    right: PartOneAffordanceTemplate;
    distance: number;
    leftIndex: number;
    rightIndex: number;
  }> = [];
  for (let leftIndex = 0; leftIndex < options.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < options.length; rightIndex += 1) {
      const left = options[leftIndex]!;
      const right = options[rightIndex]!;
      const distance = rawOptionDistance(left, right);
      if (distance > 0) {
        pairs.push({ left, right, distance, leftIndex, rightIndex });
      }
    }
  }
  const selected = pairs.sort((left, right) => (
    right.distance - left.distance
    || left.leftIndex - right.leftIndex
    || left.rightIndex - right.rightIndex
  ))[0];
  if (!selected) {
    throw new Error(
      `PART_ONE_FLOOR_CONTINUATION_OPTIONS_UNAVAILABLE:${kernel.assetId}`,
    );
  }
  return [selected.left, selected.right];
}

function rawOptionDistance(
  left: PartOneAffordanceTemplate,
  right: PartOneAffordanceTemplate,
) {
  const features = (option: PartOneAffordanceTemplate) => new Set([
    ...option.stateEffects.map((path) => `path:${path}`),
    ...Object.entries(option.statePatch || {}).map(
      ([path, value]) => `patch:${path}=${stableCanonicalJson(value)}`,
    ),
    ...(option.durableEffects || []).map(
      (effect) => `durable:${stableCanonicalJson(effect)}`,
    ),
    `pending:${String(option.createsPendingConsequence)}`,
  ]);
  const leftFeatures = features(left);
  const rightFeatures = features(right);
  let distance = 0;
  for (const value of leftFeatures) {
    if (!rightFeatures.has(value)) distance += 1;
  }
  for (const value of rightFeatures) {
    if (!leftFeatures.has(value)) distance += 1;
  }
  return distance;
}

function floorPressureSummary(floor: PartOneRuntimeAsset) {
  for (const key of ["summary", "dramaticPurpose", "obligation"]) {
    const value = floor.payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `The unresolved obligation ${floor.assetId} remains active.`;
}

function forcePrimaryPackage(
  pkg: PartOneRuntimePackage,
  sectionId: string,
  kernelId: string,
  affordanceIds: string[] | null,
  restrictToKernel: boolean,
): PartOneRuntimePackage {
  const projected = clone(pkg);
  projected.sections = projected.sections.map((section) => {
    if (section.sectionId !== sectionId) return section;
    return {
      ...section,
      activeDecisionKernelIds: restrictToKernel
        ? [kernelId]
        : [
          kernelId,
          ...section.activeDecisionKernelIds.filter((id) => id !== kernelId),
        ],
    };
  });
  if (affordanceIds?.length) {
    projected.assets = projected.assets.map((asset) => (
      asset.assetId === kernelId && asset.assetType === "DECISION_KERNEL"
        ? reorderKernelOptions(asset, affordanceIds)
        : asset
    ));
  }
  return projected;
}

function reorderKernelOptions(
  asset: PartOneRuntimeAsset,
  affordanceIds: string[],
) {
  const authored = Array.isArray(asset.payload.options)
    ? asset.payload.options
    : [];
  const ids = [...new Set(affordanceIds)];
  const selected = ids.map((id) => authored.find(
    (option) => option.affordanceTemplateId === id,
  ));
  if (selected.some((option) => !option)) {
    throw new Error(
      `PART_ONE_DYNAMIC_AFFORDANCE_NOT_FOUND:${ids.join(",")}`,
    );
  }
  const remaining = authored.filter(
    (option) => !ids.includes(option.affordanceTemplateId),
  );
  const reordered = selected.length === 1
    ? [selected[0]!, ...remaining]
    : [selected[0]!, ...remaining, selected[1]!];
  return {
    ...asset,
    payload: { ...asset.payload, options: reordered },
  };
}

function linkedPending(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  kernel: PartOneRuntimeAsset,
) {
  const requirements = new Set(kernel.requirementIds);
  const arcs = new Set(kernel.causalArcIds);
  return (state.pendingConsequences || []).filter((pending) => {
    if (!ACTIVE_PENDING.has(String(pending.status))) return false;
    const rule = pkg.assets.find(
      (asset) => asset.assetId === pending.ruleAssetId,
    );
    return Boolean(
      rule
      && rule.assetType === "PENDING_CONSEQUENCE_RULE"
      && (
        rule.decisionKernelIds.includes(kernel.assetId)
        || rule.requirementIds.some((id) => requirements.has(id))
        || rule.causalArcIds.some((id) => arcs.has(id))
      )
    );
  });
}

function selectAffordances(evaluation: Evaluation, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  const affordances = uniqueIds
    .map((id) => evaluation.previews.find(
      (item) => item.affordance.affordanceTemplateId === id,
    )?.affordance)
    .filter((item): item is PartOneRuntimeAffordance => Boolean(item));
  if (affordances.length !== 2 || affordances.length !== uniqueIds.length) {
    throw new Error("PART_ONE_DYNAMIC_AFFORDANCE_PAIR_MISSING");
  }
  return affordances.sort((left, right) => (
    (evaluation.authoredOrder.get(left.affordanceTemplateId)
      ?? Number.MAX_SAFE_INTEGER)
    - (evaluation.authoredOrder.get(right.affordanceTemplateId)
      ?? Number.MAX_SAFE_INTEGER)
  ));
}

function selectionTrace(
  selection: KernelSelectorLiteResult<Preview>,
  section: PartOneSectionContract,
  state: PartOneState,
  workingSet: PartOneRuntimeWorkingSet,
): KernelSelectionTrace {
  return {
    schemaVersion: "kernel-selection-trace-v1",
    selectorVersion: "kernel-selector-lite-v1",
    mode: "DYNAMIC_LITE",
    sectionId: section.sectionId,
    stateRevision: revisionOf(state, workingSet.turnNumber),
    stateFingerprint: selection.stateFingerprint,
    selectedKernelId: workingSet.decisionPoint.decisionKernelId,
    selectedDecisionPointId: workingSet.decisionPoint.decisionPointId,
    selectedAffordanceIds: workingSet.decisionAffordances.map(
      (item) => item.affordanceTemplateId,
    ),
    selectedOutcomeHashes: selection.selected?.pair
      ? [
        selection.selected.pair.left.outcome.hash,
        selection.selected.pair.right.outcome.hash,
      ]
      : [],
    candidates: selection.evaluations.map(
      (item: KernelSelectorLiteEvaluation<Preview>) => ({
        kernelId: item.kernelId,
        score: item.score,
        tieBreaker: item.tieBreaker,
        eligible: item.eligible,
        reasonCodes: item.reasonCodes,
        validAffordanceIds: item.validAffordanceIds,
        outcomeHashes: item.outcomeHashes,
        maximumOutcomeDistance: item.maximumOutcomeDistance,
      }),
    ),
  };
}

function baseTrace(
  mode: KernelSelectionTrace["mode"],
  section: PartOneSectionContract,
  state: PartOneState,
  fingerprint: string,
): KernelSelectionTrace {
  return {
    schemaVersion: "kernel-selection-trace-v1",
    selectorVersion: "kernel-selector-lite-v1",
    mode,
    sectionId: section.sectionId,
    stateRevision: revisionOf(state, state.turnNumber),
    stateFingerprint: fingerprint,
    selectedKernelId: "",
    selectedDecisionPointId: "",
    selectedAffordanceIds: [],
    selectedOutcomeHashes: [],
    candidates: [],
  };
}

function traced(
  workingSet: PartOneRuntimeWorkingSet,
  trace: KernelSelectionTrace,
): DynamicPartOneRuntimeWorkingSet {
  return {
    ...workingSet,
    kernelSelection: {
      ...trace,
      selectedKernelId:
        trace.selectedKernelId || workingSet.decisionPoint.decisionKernelId,
      selectedDecisionPointId:
        trace.selectedDecisionPointId || workingSet.decisionPoint.decisionPointId,
      selectedAffordanceIds: trace.selectedAffordanceIds.length
        ? trace.selectedAffordanceIds
        : workingSet.decisionAffordances.map(
          (item) => item.affordanceTemplateId,
        ),
    },
  };
}

function incomingForAffordance(
  affordance: PartOneRuntimeAffordance,
): PartOneIncomingAction {
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

function isContinuation(workingSet: PartOneRuntimeWorkingSet) {
  return workingSet.decisionPoint.decisionPointId
    !== workingSet.decisionPoint.decisionKernelId;
}

function fingerprintState(state: PartOneState) {
  return stableSha256({
    ...state,
    scene: state.scene
      ? { ...state.scene, situation: undefined }
      : state.scene,
  });
}

function revisionOf(state: PartOneState, fallback: number) {
  const turnRevision = Number(state.turnNumber);
  if (Number.isFinite(turnRevision)) return turnRevision;
  const durableRevision = Number(state.durableState?.revision);
  if (Number.isFinite(durableRevision)) return durableRevision;
  return Number(fallback);
}

function requireSection(
  pkg: PartOneRuntimePackage,
  sectionId: string,
) {
  const section = pkg.sections.find((item) => item.sectionId === sectionId);
  if (!section) {
    throw new Error(`PART_ONE_RUNTIME_SECTION_MISSING:${sectionId}`);
  }
  return section;
}

function requireKernel(
  pkg: PartOneRuntimePackage,
  kernelId: string,
) {
  const kernel = pkg.assets.find(
    (item) => item.assetId === kernelId
      && item.assetType === "DECISION_KERNEL",
  );
  if (!kernel) {
    throw new Error(`PART_ONE_RUNTIME_KERNEL_MISSING:${kernelId}`);
  }
  return kernel;
}

function uniqueRules(rules: PartOneStateRule[]) {
  return [...new Map(rules.map((rule) => [rule.ruleId, rule])).values()];
}

function getPath(value: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, key) => (
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)[key]
      : undefined
  ), value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function deepEqual(left: unknown, right: unknown) {
  return stableCanonicalJson(left) === stableCanonicalJson(right);
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function normalizeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  const code = message.split(":", 1)[0] || "UNKNOWN_ERROR";
  return code
    .trim()
    .replace(/[^A-Za-z0-9_]+/gu, "_")
    .toUpperCase()
    .slice(0, 96) || "UNKNOWN_ERROR";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
