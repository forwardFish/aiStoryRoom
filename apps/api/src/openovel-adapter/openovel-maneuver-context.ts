import type {
  ObservableTraceProjectionV2,
  OpenNovelConfirmedManeuverContextV1,
  VisibleAssetV2,
} from "@ai-story/shared";
import {
  OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_SCHEMA,
} from "@ai-story/shared";
import {
  ensureOpenNovelManeuverState,
  withOpenNovelManeuverState,
  type OpenNovelManeuverResult,
  type OpenNovelManeuverState,
} from "./openovel-maneuver";
import type { OpenNovelManeuverPackage } from "./openovel-maneuver-package";

export type OpenNovelManeuverKnowledgeProjection = {
  visibleFacts: Array<{ factKey: string; content: string }>;
  evidenceHoldings: VisibleAssetV2[];
  observableTraces: ObservableTraceProjectionV2[];
};

export function hydrateOpenNovelManeuverStateFromEvents(input: {
  stateJson: unknown;
  eventPayloads: unknown[];
  turnNumber: number;
  maneuverPackage: OpenNovelManeuverPackage;
}) {
  const root = record(input.stateJson);
  const prior = record(root.openovelManeuver);
  const priorResults = array(prior.results);
  const rawResults = uniqueById([
    ...priorResults,
    ...input.eventPayloads.map(extractEventResult).filter(Boolean),
  ]);
  const candidateStateJson = {
    ...root,
    openovelManeuver: {
      ...prior,
      results: rawResults,
    },
  };
  const state = ensureOpenNovelManeuverState(
    candidateStateJson,
    input.turnNumber,
    input.maneuverPackage,
  );
  if (!Object.keys(record(prior.metrics)).length && state.results.length) {
    state.metrics = recomputeMetrics(state.results);
  }
  const recoveredEventCount = Math.max(0, rawResults.length - priorResults.length);
  const needsPersistence = recoveredEventCount > 0
    || prior.schemaVersion !== state.schemaVersion
    || !Array.isArray(prior.results)
    || !Array.isArray(prior.usedTypesToday)
    || !Array.isArray(prior.usedLeverageKeys)
    || !Array.isArray(prior.discoveredFactKeys)
    || !Array.isArray(prior.canonConsumedResultIds)
    || Number(prior.usageDay) !== state.usageDay
    || String(prior.sceneKey || "") !== state.sceneKey
    || Number(prior.maneuversUsedToday) !== state.maneuversUsedToday
    || Number(prior.maneuverOpportunitiesRemaining) !== state.maneuverOpportunitiesRemaining
    || Number(prior.totalManeuversUsed) !== state.totalManeuversUsed
    || !sameStringSet(prior.usedTypesToday, state.usedTypesToday)
    || !sameStringSet(prior.usedLeverageKeys, state.usedLeverageKeys)
    || !sameStringSet(prior.discoveredFactKeys, state.discoveredFactKeys)
    || !sameStringSet(prior.canonConsumedResultIds, state.canonConsumedResultIds)
    || !sameNumericRecord(prior.metrics, state.metrics)
    || normalizeNullableInteger(prior.lastCanonBridgeTurnNumber) !== state.lastCanonBridgeTurnNumber;
  return {
    state,
    stateJson: withOpenNovelManeuverState(root, state),
    recoveredEventCount,
    needsPersistence,
  };
}

export function compileConfirmedManeuverContext(input: {
  stateJson: unknown;
  turnNumber: number;
  maneuverPackage: OpenNovelManeuverPackage;
  maxResults?: number;
}): OpenNovelConfirmedManeuverContextV1 | null {
  const state = ensureOpenNovelManeuverState(
    input.stateJson,
    input.turnNumber,
    input.maneuverPackage,
  );
  const consumed = new Set(state.canonConsumedResultIds);
  const pending = [...state.results]
    .filter((result) => !consumed.has(result.id) && result.turnNumber <= input.turnNumber)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  if (!pending.length) return null;
  const selected = pending.slice(0, Math.max(1, Math.min(12, Number(input.maxResults || 8))));
  const visibleFacts = uniqueFacts(selected);
  return {
    schemaVersion: OPENOVEL_CONFIRMED_MANEUVER_CONTEXT_SCHEMA,
    instruction: "这些内容来自已经确认并持久化的主动谋划。把它们视为主角已经经历或掌握的玩家可见事实；不得引用包装标签，不得把传闻扩张为事实，不得替玩家新增决定。",
    preparedAtTurnNumber: Math.max(0, Math.floor(input.turnNumber)),
    sourceResultIds: selected.map((result) => result.id),
    summaries: selected.map((result) => ({
      resultId: result.id,
      decisionForm: result.decisionForm,
      title: compact(result.title, 160),
      content: compact(result.narrative, 900),
      sceneKey: result.sceneKey,
      turnNumber: result.turnNumber,
    })),
    visibleFacts,
    consumedLeverageKeys: unique(
      selected.map((result) => result.consumedLeverageKey || "").filter(Boolean),
    ),
  };
}

export function markConfirmedManeuverContextConsumed(input: {
  stateJson: unknown;
  turnNumber: number;
  maneuverPackage: OpenNovelManeuverPackage;
  resultIds: string[];
}) {
  const state = ensureOpenNovelManeuverState(
    input.stateJson,
    input.turnNumber,
    input.maneuverPackage,
  );
  const existingIds = new Set(state.results.map((result) => result.id));
  state.canonConsumedResultIds = unique([
    ...state.canonConsumedResultIds,
    ...input.resultIds.filter((id) => existingIds.has(id)),
  ]);
  state.lastCanonBridgeTurnNumber = Math.max(
    state.lastCanonBridgeTurnNumber ?? 0,
    Math.max(0, Math.floor(input.turnNumber)),
  );
  return withOpenNovelManeuverState(input.stateJson, state);
}

export function projectOpenNovelManeuverKnowledge(
  state: OpenNovelManeuverState,
): OpenNovelManeuverKnowledgeProjection {
  const facts = uniqueFacts(state.results);
  const byFact = new Map<string, OpenNovelManeuverResult>();
  for (const result of state.results) {
    for (const factKey of result.discoveredFactKeys) {
      if (!byFact.has(factKey)) byFact.set(factKey, result);
    }
  }
  const evidenceHoldings = facts.map((fact): VisibleAssetV2 => {
    const source = byFact.get(fact.factKey);
    return {
      assetKey: fact.factKey,
      kind: "EVIDENCE",
      label: source?.title || fact.factKey,
      quantity: 1,
      status: "DISCOVERED",
    };
  });
  const observableTraces: ObservableTraceProjectionV2[] = state.results.flatMap((result) =>
    result.traces.map((trace, index) => ({
      id: `${result.id}:trace:${index + 1}`,
      content: trace,
      worldSequence: result.turnNumber,
      createdAt: result.createdAt,
    })),
  );
  return {
    visibleFacts: facts.map(({ factKey, content }) => ({ factKey, content })),
    evidenceHoldings,
    observableTraces,
  };
}

export function pendingManeuverResultIds(
  state: OpenNovelManeuverState,
  turnNumber: number,
) {
  const consumed = new Set(state.canonConsumedResultIds);
  return state.results
    .filter((result) => result.turnNumber <= turnNumber && !consumed.has(result.id))
    .map((result) => result.id);
}

function uniqueFacts(results: OpenNovelManeuverResult[]) {
  const seen = new Set<string>();
  const facts: Array<{ factKey: string; content: string; sourceResultId: string }> = [];
  for (const result of results) {
    for (const factKey of result.discoveredFactKeys) {
      if (!factKey || seen.has(factKey)) continue;
      seen.add(factKey);
      facts.push({
        factKey,
        content: compact(`${result.title}：${result.narrative}`, 700),
        sourceResultId: result.id,
      });
    }
  }
  return facts;
}

function extractEventResult(value: unknown) {
  const source = record(value);
  const nested = record(source.result);
  const candidate = String(source.id || "").trim() ? source : nested;
  return String(candidate.id || "").trim() ? candidate : null;
}

function uniqueById(items: unknown[]) {
  const map = new Map<string, unknown>();
  for (const item of items) {
    const id = String(record(item).id || "").trim();
    if (id) map.set(id, item);
  }
  return [...map.values()];
}

function recomputeMetrics(results: OpenNovelManeuverResult[]) {
  const metrics: Record<string, number> = {};
  for (const result of results) {
    for (const [key, delta] of Object.entries(result.statePatch)) {
      metrics[key] = clampMetric(Number(metrics[key] || 0) + Number(delta || 0));
    }
  }
  return metrics;
}

function sameStringSet(value: unknown, expected: string[]) {
  if (!Array.isArray(value)) return false;
  const actual = unique(value.map(String)).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((item, index) => item === sortedExpected[index]);
}

function sameNumericRecord(value: unknown, expected: Record<string, number>) {
  const actual = record(value);
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => (
      key === expectedKeys[index]
      && Number(actual[key]) === Number(expected[key])
    ));
}

function normalizeNullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function clampMetric(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function compact(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
