import {
  createOutcomeSignature,
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
  PartOneCommittedEvent,
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
};
type Evaluation = {
  kernelId: string;
  workingSet: PartOneRuntimeWorkingSet;
  authoredOrder: Map<string, number>;
  previews: Preview[];
  candidate: KernelSelectorLiteCandidate<Preview>;
};

const ACTIVE_PENDING = new Set(["PENDING", "DUE", "DEFERRED_WITH_REASON", "TRANSFORMED"]);
const RESOLVED_ARCS = new Set(["RESOLVED", "CLOSED", "COMPLETE", "COMPLETED"]);
const IGNORED_PATHS = new Set([
  "turnNumber", "sectionTurnNumber", "lastCommittedEventId", "completedKernelIds",
  "scene", "durableState", "pendingConsequences", "partCompletionStatus",
]);

export function buildDynamicPartOneRuntimeWorkingSet(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  options: PartOneWorkingSetSelectionOptions = {},
): DynamicPartOneRuntimeWorkingSet {
  const section = requireSection(pkg, state.sectionId);
  const fingerprint = fingerprintState(state);
  if (state.partCompletionStatus === "HANDOFF_READY") {
    return traced(buildLegacyWorkingSet(pkg, state, turnNumber), baseTrace("HANDOFF", section, state, fingerprint));
  }
  if (options.pin) return pinnedWorkingSet(pkg, state, turnNumber, options.pin, fingerprint);
  if (options.mode === "LEGACY_FIXED") {
    const legacy = buildLegacyWorkingSet(pkg, state, turnNumber);
    return traced(legacy, baseTrace(isContinuation(legacy) ? "CONTINUATION" : "LEGACY_FIXED", section, state, fingerprint));
  }

  const completed = new Set(state.completedKernelIds || []);
  const unresolved = section.activeDecisionKernelIds.filter((id) => !completed.has(id));
  if (!unresolved.length) {
    return traced(buildLegacyWorkingSet(pkg, state, turnNumber), baseTrace("CONTINUATION", section, state, fingerprint));
  }

  const evaluated = unresolved.map((kernelId) => evaluateKernel(pkg, state, section, kernelId, turnNumber));
  const selection = selectKernelLite(evaluated.map((item) => item.candidate), fingerprint);
  if (!selection.selected?.pair) {
    const fallback = buildLegacyWorkingSet(pkg, state, turnNumber);
    return traced(fallback, {
      ...selectionTrace(selection, section, state, fallback),
      mode: "LEGACY_FALLBACK",
      fallbackReason: "NO_ELIGIBLE_DYNAMIC_KERNEL",
    });
  }

  const evaluation = evaluated.find((item) => item.kernelId === selection.selected!.kernelId);
  if (!evaluation) throw new Error("PART_ONE_DYNAMIC_KERNEL_SELECTION_MISSING");
  const selectedIds = [selection.selected.pair.left.affordanceId, selection.selected.pair.right.affordanceId];
  const affordances = selectAffordances(evaluation, selectedIds);
  const workingSet = { ...evaluation.workingSet, decisionAffordances: affordances };
  return traced(workingSet, { ...selectionTrace(selection, section, state, workingSet), mode: "DYNAMIC_LITE" });
}

export function settleDynamicPartOneAction(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  action: PartOneIncomingAction,
  turnNumber: number,
): DynamicPartOneActionSettlement {
  const current = buildDynamicPartOneRuntimeWorkingSet(pkg, state, Math.max(0, turnNumber - 1));
  const opening = Boolean(action.decisionId?.startsWith("opening_"));
  if (!opening && action.affordanceTemplateId) {
    const bound = current.decisionAffordances.some((candidate) => (
      candidate.affordanceTemplateId === action.affordanceTemplateId
      && candidate.decisionKernelId === action.decisionKernelId
      && candidate.actionText === action.actionText
    ));
    if (!bound) throw new Error("PART_ONE_DYNAMIC_STALE_OR_TAMPERED_AFFORDANCE");
  }
  const currentKernelId = opening
    ? "DK-P1-REVIEW-INITIATION"
    : action.decisionKernelId || current.decisionPoint.decisionKernelId;
  const currentAffordanceId = opening ? null : action.affordanceTemplateId || null;
  const currentRequest = { sectionId: state.sectionId, kernelId: currentKernelId, affordanceId: currentAffordanceId };
  const provisional = settleLegacyAction(forcePackage(pkg, [currentRequest]), state, action, turnNumber);
  const next = buildDynamicPartOneRuntimeWorkingSet(pkg, provisional.proposedState, turnNumber);
  const finalPkg = forcePackage(pkg, [
    currentRequest,
    {
      sectionId: provisional.proposedState.sectionId,
      kernelId: next.decisionPoint.decisionKernelId,
      affordanceId: null,
    },
  ]);
  const finalized = settleLegacyAction(finalPkg, state, action, turnNumber);
  if (finalized.event.nextDecisionPoint.decisionKernelId !== next.decisionPoint.decisionKernelId
    || finalized.event.nextDecisionPoint.decisionPointId !== next.decisionPoint.decisionPointId) {
    throw new Error("PART_ONE_DYNAMIC_NEXT_DECISION_MISMATCH");
  }
  (finalized.event as DynamicPartOneCommittedEvent).nextKernelSelection = clone(next.kernelSelection);
  return finalized as DynamicPartOneActionSettlement;
}

export function packageForDynamicCapabilityAction(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
): PartOneRuntimePackage {
  const current = buildDynamicPartOneRuntimeWorkingSet(pkg, state, Math.max(0, turnNumber - 1));
  return forcePackage(pkg, [{
    sectionId: state.sectionId,
    kernelId: current.decisionPoint.decisionKernelId,
    affordanceId: current.decisionAffordances[0]?.affordanceTemplateId || null,
  }]);
}

export function isDynamicCapabilityAction(action: PartOneIncomingAction) {
  return String(action.actionText || "").startsWith("\u2063OMW_CAPABILITY_V1:");
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
    const legacy = buildLegacyWorkingSet(pkg, state, turnNumber);
    if (legacy.decisionPoint.decisionKernelId !== pin.decisionKernelId
      || legacy.decisionPoint.decisionPointId !== pin.decisionPointId) {
      throw new Error("PART_ONE_PINNED_DECISION_POINT_NOT_FOUND");
    }
    return traced(legacy, baseTrace("CONTINUATION", section, state, fingerprint));
  }
  if (!section.activeDecisionKernelIds.includes(pin.decisionKernelId)) {
    throw new Error("PART_ONE_PINNED_KERNEL_NOT_IN_SECTION");
  }

  const evaluation = evaluateKernel(pkg, state, section, pin.decisionKernelId, turnNumber);
  let ids = pin.affordanceIds ? [...new Set(pin.affordanceIds)] : [];
  if (!ids.length) {
    const selected = selectKernelLite([evaluation.candidate], fingerprint).selected;
    if (!selected?.pair) throw new Error("PART_ONE_PINNED_AFFORDANCE_PREVIEW_REJECTED");
    ids = [selected.pair.left.affordanceId, selected.pair.right.affordanceId];
  }
  const affordances = selectAffordances(evaluation, ids);
  const hashes = ids.map((id) => evaluation.previews.find((item) => item.affordance.affordanceTemplateId === id)?.signature.hash);
  if (hashes.some((hash) => !hash)) throw new Error("PART_ONE_PINNED_AFFORDANCE_NOT_FOUND");
  if (pin.outcomeHashes?.length && (
    pin.outcomeHashes.length !== hashes.length
    || pin.outcomeHashes.some((hash, index) => hash !== hashes[index])
  )) throw new Error("PART_ONE_PINNED_OUTCOME_HASH_MISMATCH");

  return traced({ ...evaluation.workingSet, decisionAffordances: affordances }, {
    schemaVersion: "kernel-selection-trace-v1",
    selectorVersion: "kernel-selector-lite-v1",
    mode: "PINNED_RECOVERY",
    sectionId: section.sectionId,
    stateRevision: revisionOf(state, turnNumber),
    stateFingerprint: fingerprint,
    selectedKernelId: pin.decisionKernelId,
    selectedDecisionPointId: pin.decisionPointId,
    selectedAffordanceIds: affordances.map((item) => item.affordanceTemplateId),
    selectedOutcomeHashes: hashes as string[],
    candidates: [{
      kernelId: evaluation.kernelId,
      score: 0,
      eligible: true,
      reasonCodes: ["PINNED_RECOVERY"],
      validAffordanceIds: evaluation.previews.map((item) => item.affordance.affordanceTemplateId).sort(),
      outcomeHashes: evaluation.previews.map((item) => item.signature.hash).sort(),
      maximumOutcomeDistance: 0,
    }],
  });
}

function evaluateKernel(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  section: PartOneSectionContract,
  kernelId: string,
  turnNumber: number,
): Evaluation {
  const kernel = requireKernel(pkg, kernelId);
  const options = Array.isArray(kernel.payload.options) ? kernel.payload.options : [];
  const authoredOrder = new Map(options.map((option, index) => [option.affordanceTemplateId, index]));
  const materialized = options.map((option) => materializeAffordance(pkg, state, turnNumber, kernelId, option.affordanceTemplateId));
  const first = materialized[0]?.workingSet || buildLegacyWorkingSet(
    forcePackage(pkg, [{ sectionId: section.sectionId, kernelId, affordanceId: null }]),
    state,
    turnNumber,
  );
  const affordances = materialized.flatMap((item) => item.affordance ? [item.affordance] : []);
  const candidateWorkingSet = { ...first, decisionAffordances: affordances };
  const previews: Preview[] = [];
  for (const affordance of affordances) {
    try {
      const preview = settleLegacyAction(
        forcePackage(pkg, [{ sectionId: section.sectionId, kernelId, affordanceId: affordance.affordanceTemplateId }]),
        state,
        incomingForAffordance(affordance),
        turnNumber + 1,
      );
      const signature = outcomeSignature(preview, affordance.affordanceTemplateId);
      if (hasMaterialOutcome(signature, preview)) previews.push({ affordance, signature });
    } catch {
      // A candidate that cannot pass the authoritative Settlement is ineligible.
    }
  }

  const coveredPaths = new Set([...kernel.stateDependencies, ...options.flatMap((option) => option.stateEffects || [])]);
  const mustRules = uniqueRules(section.mustEstablish).filter((rule) => coveredPaths.has(rule.statePath));
  const exitRules = uniqueRules(section.exitGates).filter((rule) => coveredPaths.has(rule.statePath));
  const unmetMust = mustRules.filter((rule) => !evaluatePartOneRule(state, rule));
  const unmetExit = exitRules.filter((rule) => !evaluatePartOneRule(state, rule));
  const pending = linkedPending(pkg, state, kernel);
  const nextTurn = turnNumber + 1;
  const present = new Set(state.scene?.presentActorRefs || []);
  const rejectionCodes: string[] = [];
  if (options.length < 2) rejectionCodes.push("KERNEL_OPTIONS_MISSING");
  if (affordances.length !== options.length) rejectionCodes.push("AFFORDANCE_MATERIALIZATION_FAILED");
  if (previews.length < 2) rejectionCodes.push("AFFORDANCE_PREVIEW_FAILED");

  return {
    kernelId,
    workingSet: candidateWorkingSet,
    authoredOrder,
    previews,
    candidate: {
      kernelId,
      completed: Boolean(state.completedKernelIds?.includes(kernelId)),
      allowedInCurrentScope: section.activeDecisionKernelIds.includes(kernelId) && kernel.sectionIds.includes(section.sectionId),
      structurallyResolved: mustRules.length + exitRules.length > 0
        && unmetMust.length === 0 && unmetExit.length === 0 && pending.length === 0,
      unmetMustEstablishCount: unmetMust.length,
      unmetExitGateCount: unmetExit.length,
      duePressureCount: pending.filter((item) => item.dueTurn <= nextTurn).length,
      pendingPressureCount: pending.filter((item) => item.dueTurn > nextTurn).length,
      activeArcCount: kernel.causalArcIds.filter((arcId) => !RESOLVED_ARCS.has(String(state.causalArcStages?.[arcId] || "OPEN").toUpperCase())).length,
      availablePressureActorCount: candidateWorkingSet.decisionPoint.actorRefs.filter((actorId) => present.has(actorId)).length,
      validAffordances: previews.map((preview) => ({
        affordanceId: preview.affordance.affordanceTemplateId,
        sourceOrder: authoredOrder.get(preview.affordance.affordanceTemplateId) ?? Number.MAX_SAFE_INTEGER,
        outcome: preview.signature,
        payload: preview,
      })),
      rejectionCodes,
    },
  };
}

function materializeAffordance(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  turnNumber: number,
  kernelId: string,
  affordanceId: string,
) {
  const workingSet = buildLegacyWorkingSet(
    forcePackage(pkg, [{ sectionId: state.sectionId, kernelId, affordanceId }]),
    state,
    turnNumber,
  );
  return {
    workingSet,
    affordance: workingSet.decisionAffordances.find((item) => item.affordanceTemplateId === affordanceId) || null,
  };
}

function outcomeSignature(settlement: PartOneActionSettlement, affordanceId: string) {
  const stateFeatures = [...new Set(settlement.event.changedStatePaths)]
    .filter((path) => !IGNORED_PATHS.has(path))
    .flatMap((path) => {
      const before = getPath(settlement.beforeState, path);
      const after = getPath(settlement.proposedState, path);
      return deepEqual(before, after) ? [] : [`state:${path}=${stableCanonicalJson(after)}`];
    });
  const beforeDurable = new Set((settlement.beforeState.durableState?.predicates || []).map(stableCanonicalJson));
  const durablePredicateFeatures = (settlement.proposedState.durableState?.predicates || [])
    .map(stableCanonicalJson)
    .filter((predicate) => !beforeDurable.has(predicate))
    .map((predicate) => `durable:${predicate}`);
  const beforePending = new Set((settlement.beforeState.pendingConsequences || []).map((item) => item.consequenceId));
  const pendingRuleFeatures = (settlement.proposedState.pendingConsequences || [])
    .filter((item) => !beforePending.has(item.consequenceId))
    .map((item) => `pending:${item.ruleAssetId}:${item.status}:${item.dueTurn - settlement.event.turnNumber}`);
  return createOutcomeSignature({
    affordanceId,
    stateFeatures,
    durablePredicateFeatures,
    pendingRuleFeatures,
    sectionAfter: settlement.event.sectionIdAfter,
    partCompletionStatusAfter: settlement.proposedState.partCompletionStatus || null,
  });
}

function hasMaterialOutcome(signature: AffordanceOutcomeSignature, settlement: PartOneActionSettlement) {
  return signature.stateFeatures.length > 0
    || signature.durablePredicateFeatures.length > 0
    || signature.pendingRuleFeatures.length > 0
    || settlement.event.sectionIdBefore !== settlement.event.sectionIdAfter
    || settlement.beforeState.partCompletionStatus !== settlement.proposedState.partCompletionStatus;
}

function forcePackage(
  pkg: PartOneRuntimePackage,
  requests: Array<{ sectionId: string; kernelId: string; affordanceId: string | null }>,
): PartOneRuntimePackage {
  const kernelsBySection = new Map<string, string[]>();
  const affordanceByKernel = new Map<string, string>();
  for (const request of requests) {
    const ids = kernelsBySection.get(request.sectionId) || [];
    if (!ids.includes(request.kernelId)) ids.push(request.kernelId);
    kernelsBySection.set(request.sectionId, ids);
    if (request.affordanceId) affordanceByKernel.set(request.kernelId, request.affordanceId);
  }
  return {
    ...pkg,
    sections: pkg.sections.map((section) => {
      const preferred = kernelsBySection.get(section.sectionId);
      return !preferred?.length ? section : {
        ...section,
        activeDecisionKernelIds: [...preferred, ...section.activeDecisionKernelIds.filter((id) => !preferred.includes(id))],
      };
    }),
    assets: pkg.assets.map((asset) => {
      const affordanceId = affordanceByKernel.get(asset.assetId);
      if (!affordanceId || asset.assetType !== "DECISION_KERNEL") return asset;
      const options = Array.isArray(asset.payload.options) ? asset.payload.options : [];
      const selected = options.find((option) => option.affordanceTemplateId === affordanceId);
      if (!selected) throw new Error(`PART_ONE_DYNAMIC_AFFORDANCE_NOT_FOUND:${affordanceId}`);
      return {
        ...asset,
        payload: { ...asset.payload, options: [selected, ...options.filter((option) => option !== selected)] },
      };
    }),
  };
}

function linkedPending(pkg: PartOneRuntimePackage, state: PartOneState, kernel: PartOneRuntimeAsset) {
  const requirements = new Set(kernel.requirementIds);
  const arcs = new Set(kernel.causalArcIds);
  return (state.pendingConsequences || []).filter((pending) => {
    if (!ACTIVE_PENDING.has(String(pending.status))) return false;
    const rule = pkg.assets.find((asset) => asset.assetId === pending.ruleAssetId);
    return Boolean(rule && rule.assetType === "PENDING_CONSEQUENCE_RULE" && (
      rule.decisionKernelIds.includes(kernel.assetId)
      || rule.requirementIds.some((id) => requirements.has(id))
      || rule.causalArcIds.some((id) => arcs.has(id))
    ));
  });
}

function selectAffordances(evaluation: Evaluation, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  const affordances = uniqueIds
    .map((id) => evaluation.previews.find((item) => item.affordance.affordanceTemplateId === id)?.affordance)
    .filter((item): item is PartOneRuntimeAffordance => Boolean(item));
  if (affordances.length !== 2 || affordances.length !== uniqueIds.length) {
    throw new Error("PART_ONE_DYNAMIC_AFFORDANCE_PAIR_MISSING");
  }
  return affordances.sort((left, right) => (
    (evaluation.authoredOrder.get(left.affordanceTemplateId) ?? Number.MAX_SAFE_INTEGER)
    - (evaluation.authoredOrder.get(right.affordanceTemplateId) ?? Number.MAX_SAFE_INTEGER)
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
    selectedAffordanceIds: workingSet.decisionAffordances.map((item) => item.affordanceTemplateId),
    selectedOutcomeHashes: selection.selected?.pair
      ? [selection.selected.pair.left.outcome.hash, selection.selected.pair.right.outcome.hash]
      : [],
    candidates: selection.evaluations.map((item: KernelSelectorLiteEvaluation<Preview>) => ({
      kernelId: item.kernelId,
      score: item.score,
      eligible: item.eligible,
      reasonCodes: item.reasonCodes,
      validAffordanceIds: item.validAffordanceIds,
      outcomeHashes: item.outcomeHashes,
      maximumOutcomeDistance: item.maximumOutcomeDistance,
    })),
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

function traced(workingSet: PartOneRuntimeWorkingSet, trace: KernelSelectionTrace): DynamicPartOneRuntimeWorkingSet {
  return {
    ...workingSet,
    kernelSelection: {
      ...trace,
      selectedKernelId: trace.selectedKernelId || workingSet.decisionPoint.decisionKernelId,
      selectedDecisionPointId: trace.selectedDecisionPointId || workingSet.decisionPoint.decisionPointId,
      selectedAffordanceIds: trace.selectedAffordanceIds.length
        ? trace.selectedAffordanceIds
        : workingSet.decisionAffordances.map((item) => item.affordanceTemplateId),
    },
  };
}

function incomingForAffordance(affordance: PartOneRuntimeAffordance): PartOneIncomingAction {
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
  return workingSet.decisionPoint.decisionPointId !== workingSet.decisionPoint.decisionKernelId;
}
function fingerprintState(state: PartOneState) {
  return stableSha256({ ...state, scene: state.scene ? { ...state.scene, situation: undefined } : state.scene });
}
function revisionOf(state: PartOneState, fallback: number) {
  return Number(state.durableState?.revision ?? state.turnNumber ?? fallback);
}
function requireSection(pkg: PartOneRuntimePackage, sectionId: string) {
  const section = pkg.sections.find((item) => item.sectionId === sectionId);
  if (!section) throw new Error(`PART_ONE_RUNTIME_SECTION_MISSING:${sectionId}`);
  return section;
}
function requireKernel(pkg: PartOneRuntimePackage, kernelId: string) {
  const kernel = pkg.assets.find((item) => item.assetId === kernelId && item.assetType === "DECISION_KERNEL");
  if (!kernel) throw new Error(`PART_ONE_RUNTIME_KERNEL_MISSING:${kernelId}`);
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
function deepEqual(left: unknown, right: unknown) {
  return stableCanonicalJson(left) === stableCanonicalJson(right);
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
