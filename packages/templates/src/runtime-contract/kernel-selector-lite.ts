import { createHash } from "node:crypto";

export const KERNEL_SELECTOR_LITE_VERSION = "kernel-selector-lite-v1" as const;

export const KERNEL_SELECTOR_LITE_WEIGHTS = {
  DUE_PRESSURE: 60,
  UNMET_EXIT_GATE: 40,
  UNMET_MUST_ESTABLISH: 30,
  PENDING_PRESSURE: 20,
  ACTIVE_ARC: 10,
  PRESENT_PRESSURE_ACTOR: 4,
  RECENT_REQUIREMENT_CONTINUITY: 20,
} as const;

const RUNTIME_IDENTITY_KEYS = new Set([
  "eventId",
  "lastCommittedEventId",
  "causedByEventId",
  "transferId",
  "consequenceId",
  "beatId",
  "reactionEventId",
  "sourceEventId",
]);

const STATE_PRESENTATION_KEYS = new Set([
  "label",
  "situation",
  "observableFacts",
  "continuityNote",
  "timeLabel",
  "locationLabel",
  "summary",
  "action",
  "requiredTermGroups",
  "resultCeiling",
]);

export type AffordanceOutcomeSignature = {
  affordanceId: string;
  stateFeatures: string[];
  durablePredicateFeatures: string[];
  pendingRuleFeatures: string[];
  sectionAfter: string;
  partCompletionStatusAfter: string | null;
  hash: string;
};

export type KernelSelectorLiteAffordance<TPayload = unknown> = {
  affordanceId: string;
  sourceOrder: number;
  outcome: AffordanceOutcomeSignature;
  payload: TPayload;
};

export type KernelSelectorLiteCandidate<TPayload = unknown> = {
  kernelId: string;
  completed: boolean;
  allowedInCurrentScope: boolean;
  structurallyResolved: boolean;
  unmetMustEstablishCount: number;
  unmetExitGateCount: number;
  duePressureCount: number;
  pendingPressureCount: number;
  activeArcCount: number;
  availablePressureActorCount: number;
  /** Shared structured Requirements with the most recently settled Kernel. */
  recentRequirementContinuityCount?: number;
  validAffordances: Array<KernelSelectorLiteAffordance<TPayload>>;
  rejectionCodes: string[];
};

export type KernelSelectorLiteOutcomePair<TPayload = unknown> = {
  left: KernelSelectorLiteAffordance<TPayload>;
  right: KernelSelectorLiteAffordance<TPayload>;
  distance: number;
};

export type KernelSelectorLiteEvaluation<TPayload = unknown> = {
  kernelId: string;
  score: number;
  tieBreaker: string;
  eligible: boolean;
  reasonCodes: string[];
  validAffordanceIds: string[];
  outcomeHashes: string[];
  maximumOutcomeDistance: number;
  pair: KernelSelectorLiteOutcomePair<TPayload> | null;
  candidate: KernelSelectorLiteCandidate<TPayload>;
};

export type KernelSelectorLiteResult<TPayload = unknown> = {
  selectorVersion: typeof KERNEL_SELECTOR_LITE_VERSION;
  stateFingerprint: string;
  selected: KernelSelectorLiteEvaluation<TPayload> | null;
  evaluations: Array<KernelSelectorLiteEvaluation<TPayload>>;
};

export function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? "null";
}

/**
 * Selector hashes are semantic rather than byte-for-byte state hashes. Runtime
 * identities and state presentation prose cannot affect candidate ordering,
 * retry stability or a tie breaker. String inputs are already canonical
 * payloads and are therefore hashed verbatim.
 */
export function stableSha256(value: unknown): string {
  const payload = typeof value === "string"
    ? value
    : stableCanonicalJson(stripSelectionTransientFields(value));
  return createHash("sha256")
    .update(payload)
    .digest("hex")
    .toUpperCase();
}

export function kernelTieBreaker(
  stateFingerprint: string,
  kernelId: string,
): string {
  return stableSha256({ stateFingerprint, kernelId });
}

/**
 * Normalize one `state:<path>=<json>` feature before hashing. Runtime-generated
 * event, transfer, consequence and beat identities are replay metadata rather
 * than causal outcomes; retaining them would let action wording or retry IDs
 * manufacture false option diversity. All semantic fields remain intact.
 */
export function normalizeOutcomeStateFeature(feature: string): string {
  const separator = feature.indexOf("=");
  if (!feature.startsWith("state:") || separator < 0) return feature;
  const prefix = feature.slice(0, separator + 1);
  const encoded = feature.slice(separator + 1);
  try {
    return `${prefix}${stableCanonicalJson(
      stripRuntimeIdentity(JSON.parse(encoded)),
    )}`;
  } catch {
    return feature;
  }
}

export function createOutcomeSignature(input: Omit<AffordanceOutcomeSignature, "hash">): AffordanceOutcomeSignature {
  const normalized = {
    ...input,
    stateFeatures: uniqueSorted(
      input.stateFeatures.map(normalizeOutcomeStateFeature),
    ),
    durablePredicateFeatures: uniqueSorted(input.durablePredicateFeatures),
    pendingRuleFeatures: uniqueSorted(input.pendingRuleFeatures),
  };
  return {
    ...normalized,
    hash: stableSha256({
      stateFeatures: normalized.stateFeatures,
      durablePredicateFeatures: normalized.durablePredicateFeatures,
      pendingRuleFeatures: normalized.pendingRuleFeatures,
      sectionAfter: normalized.sectionAfter,
      partCompletionStatusAfter: normalized.partCompletionStatusAfter,
    }),
  };
}

export function outcomeDistance(
  left: AffordanceOutcomeSignature,
  right: AffordanceOutcomeSignature,
): number {
  return symmetricDifferenceSize(left.stateFeatures, right.stateFeatures) * 4
    + symmetricDifferenceSize(left.durablePredicateFeatures, right.durablePredicateFeatures) * 3
    + symmetricDifferenceSize(left.pendingRuleFeatures, right.pendingRuleFeatures) * 2
    + (left.sectionAfter === right.sectionAfter ? 0 : 5)
    + (left.partCompletionStatusAfter === right.partCompletionStatusAfter ? 0 : 5);
}

export function chooseMostDifferentOutcomePair<TPayload>(
  affordances: Array<KernelSelectorLiteAffordance<TPayload>>,
): KernelSelectorLiteOutcomePair<TPayload> | null {
  const unique = deduplicateOutcomes(affordances);
  if (unique.length < 2) return null;

  const pairs: Array<KernelSelectorLiteOutcomePair<TPayload>> = [];
  for (let leftIndex = 0; leftIndex < unique.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex += 1) {
      const first = unique[leftIndex]!;
      const second = unique[rightIndex]!;
      const [left, right] = first.affordanceId.localeCompare(second.affordanceId) <= 0
        ? [first, second]
        : [second, first];
      pairs.push({ left, right, distance: outcomeDistance(left.outcome, right.outcome) });
    }
  }

  const selected = pairs
    .filter((pair) => pair.distance > 0 && pair.left.outcome.hash !== pair.right.outcome.hash)
    .sort((left, right) => (
      right.distance - left.distance
      || left.left.affordanceId.localeCompare(right.left.affordanceId)
      || left.right.affordanceId.localeCompare(right.right.affordanceId)
    ))[0];

  if (!selected) return null;
  const ordered = [selected.left, selected.right].sort((left, right) => (
    left.sourceOrder - right.sourceOrder
    || left.affordanceId.localeCompare(right.affordanceId)
  ));
  return { left: ordered[0]!, right: ordered[1]!, distance: selected.distance };
}

export function scoreKernelCandidate(candidate: KernelSelectorLiteCandidate): number {
  return candidate.duePressureCount * KERNEL_SELECTOR_LITE_WEIGHTS.DUE_PRESSURE
    + candidate.unmetExitGateCount * KERNEL_SELECTOR_LITE_WEIGHTS.UNMET_EXIT_GATE
    + candidate.unmetMustEstablishCount * KERNEL_SELECTOR_LITE_WEIGHTS.UNMET_MUST_ESTABLISH
    + candidate.pendingPressureCount * KERNEL_SELECTOR_LITE_WEIGHTS.PENDING_PRESSURE
    + candidate.activeArcCount * KERNEL_SELECTOR_LITE_WEIGHTS.ACTIVE_ARC
    + Math.min(candidate.availablePressureActorCount, 3)
      * KERNEL_SELECTOR_LITE_WEIGHTS.PRESENT_PRESSURE_ACTOR
    + (candidate.recentRequirementContinuityCount || 0)
      * KERNEL_SELECTOR_LITE_WEIGHTS.RECENT_REQUIREMENT_CONTINUITY;
}

export function selectKernelLite<TPayload>(
  candidates: Array<KernelSelectorLiteCandidate<TPayload>>,
  stateFingerprint: string,
): KernelSelectorLiteResult<TPayload> {
  const evaluations = candidates.map((candidate) => {
    const uniqueAffordances = deduplicateOutcomes(candidate.validAffordances);
    const pair = chooseMostDifferentOutcomePair(uniqueAffordances);
    const reasons = [
      ...candidate.rejectionCodes,
      ...duplicateOutcomeRejectionCodes(candidate.validAffordances),
    ];
    if (candidate.completed) reasons.push("KERNEL_COMPLETED");
    if (!candidate.allowedInCurrentScope) reasons.push("KERNEL_OUTSIDE_SCOPE");
    if (candidate.structurallyResolved) reasons.push("OBLIGATION_ALREADY_SATISFIED");
    if (!pair) reasons.push("INSUFFICIENT_DISTINCT_OUTCOMES");
    const eligible = !candidate.completed
      && candidate.allowedInCurrentScope
      && !candidate.structurallyResolved
      && Boolean(pair);
    return {
      kernelId: candidate.kernelId,
      score: scoreKernelCandidate(candidate),
      tieBreaker: kernelTieBreaker(stateFingerprint, candidate.kernelId),
      eligible,
      reasonCodes: uniqueSorted(reasons),
      validAffordanceIds: uniqueAffordances
        .map((item) => item.affordanceId)
        .sort((left, right) => left.localeCompare(right)),
      outcomeHashes: uniqueSorted(uniqueAffordances.map((item) => item.outcome.hash)),
      maximumOutcomeDistance: pair?.distance || 0,
      pair,
      candidate,
    } satisfies KernelSelectorLiteEvaluation<TPayload>;
  }).sort((left, right) => left.kernelId.localeCompare(right.kernelId));

  const selected = evaluations
    .filter((evaluation) => evaluation.eligible)
    .sort((left, right) => (
      right.score - left.score
      || right.maximumOutcomeDistance - left.maximumOutcomeDistance
      || left.tieBreaker.localeCompare(right.tieBreaker)
      || left.kernelId.localeCompare(right.kernelId)
    ))[0] || null;

  return {
    selectorVersion: KERNEL_SELECTOR_LITE_VERSION,
    stateFingerprint,
    selected,
    evaluations,
  };
}

function duplicateOutcomeRejectionCodes<TPayload>(
  affordances: Array<KernelSelectorLiteAffordance<TPayload>>,
) {
  const groups = new Map<string, Array<KernelSelectorLiteAffordance<TPayload>>>();
  for (const affordance of affordances) {
    const group = groups.get(affordance.outcome.hash) || [];
    group.push(affordance);
    groups.set(affordance.outcome.hash, group);
  }
  const codes: string[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((left, right) => (
      left.sourceOrder - right.sourceOrder
      || left.affordanceId.localeCompare(right.affordanceId)
    ));
    const retained = ordered[0];
    if (!retained) continue;
    for (const duplicate of ordered.slice(1)) {
      codes.push(
        `DUPLICATE_OUTCOME:${duplicate.affordanceId}:${retained.affordanceId}`,
      );
    }
  }
  return uniqueSorted(codes);
}

function deduplicateOutcomes<TPayload>(
  affordances: Array<KernelSelectorLiteAffordance<TPayload>>,
) {
  const byHash = new Map<string, KernelSelectorLiteAffordance<TPayload>>();
  for (const affordance of [...affordances].sort((left, right) => (
    left.sourceOrder - right.sourceOrder
    || left.affordanceId.localeCompare(right.affordanceId)
  ))) {
    if (!byHash.has(affordance.outcome.hash)) byHash.set(affordance.outcome.hash, affordance);
  }
  return [...byHash.values()];
}

function symmetricDifferenceSize(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let size = 0;
  for (const value of leftSet) if (!rightSet.has(value)) size += 1;
  for (const value of rightSet) if (!leftSet.has(value)) size += 1;
  return size;
}

function stripRuntimeIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRuntimeIdentity);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !RUNTIME_IDENTITY_KEYS.has(key))
      .map(([key, entry]) => [key, stripRuntimeIdentity(entry)]),
  );
}

function stripSelectionTransientFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSelectionTransientFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => (
        !RUNTIME_IDENTITY_KEYS.has(key)
        && !STATE_PRESENTATION_KEYS.has(key)
      ))
      .map(([key, entry]) => [key, stripSelectionTransientFields(entry)]),
  );
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}
