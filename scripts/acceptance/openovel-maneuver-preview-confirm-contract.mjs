import assert from "node:assert/strict";

const MANEUVER_PATH = /\/api\/v4\/rooms\/[^/]+\/game\/maneuvers(?:\/(preview|confirm))?$/;

export function classifyManeuverRequest(url) {
  let pathname = "";
  try {
    pathname = new URL(String(url || ""), "http://acceptance.local").pathname;
  } catch {
    return null;
  }
  const match = pathname.match(MANEUVER_PATH);
  if (!match) return null;
  return match[1] || "legacy";
}

export function stableClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function projectionSnapshot(projection) {
  return {
    maneuverVersion: Number(projection?.maneuverVersion || 0),
    worldSequence: Number(projection?.worldSequence || 0),
    quota: stableClone(projection?.maneuverPanel?.quota || null),
    maneuverState: stableClone(projection?.maneuverState || null),
    leverageHand: stableClone(projection?.leverageHand || null),
    timeline: (projection?.timeline || []).map((item) => ({
      id: item?.id || null,
      decisionForm: item?.decisionForm || null,
      messageType: item?.messageType || item?.type || null,
      maneuverType: item?.maneuverType || null,
      originEventId: item?.originEventId || null,
    })),
  };
}

export function providerCallTotal(value) {
  if (!value || typeof value !== "object") return null;
  return Object.values(value).reduce((total, item) => total + (Number(item) || 0), 0);
}

export function assertPreviewZeroSideEffects({
  label,
  beforeProjection,
  afterProjection,
  beforeDatabase,
  afterDatabase,
  beforeProviderCalls = null,
  afterProviderCalls = null,
}) {
  assert.deepEqual(
    afterProjection,
    beforeProjection,
    `${label}: Preview changed the authoritative game projection`,
  );
  assert.deepEqual(
    afterDatabase,
    beforeDatabase,
    `${label}: Preview wrote PostgreSQL state, events, or AI tasks`,
  );
  if (beforeProviderCalls != null || afterProviderCalls != null) {
    assert.deepEqual(
      afterProviderCalls,
      beforeProviderCalls,
      `${label}: Preview called the narrative provider`,
    );
  }
}

export function assertConfirmAppliedOnce({
  label,
  maneuverType,
  beforeProjection,
  afterProjection,
  beforeDatabase,
  afterDatabase,
  expectedAiTaskDelta,
  beforeProviderCalls = null,
  afterProviderCalls = null,
  expectedProviderCallDelta = null,
}) {
  assert.equal(
    afterProjection.worldSequence,
    beforeProjection.worldSequence,
    `${label}: Confirm advanced the main-story world sequence`,
  );
  assert.equal(
    afterProjection.maneuverVersion,
    beforeProjection.maneuverVersion + 1,
    `${label}: Confirm did not advance the maneuver revision exactly once`,
  );
  assert.equal(
    Number(afterProjection.quota?.remaining),
    Number(beforeProjection.quota?.remaining) - 1,
    `${label}: Confirm did not consume exactly one maneuver opportunity`,
  );
  assert.equal(
    Number(afterDatabase.run.version),
    Number(beforeDatabase.run.version) + 1,
    `${label}: Confirm did not advance StoryRun.version exactly once`,
  );
  assert.equal(
    Number(afterDatabase.run.worldSequence),
    Number(beforeDatabase.run.worldSequence),
    `${label}: Confirm advanced StoryRun.worldSequence`,
  );

  const beforeEventIds = new Set(beforeDatabase.events.map((item) => item.id));
  const newEvents = afterDatabase.events.filter((item) => !beforeEventIds.has(item.id));
  assert.equal(newEvents.length, 1, `${label}: Confirm did not create exactly one formal result event`);
  assert.equal(newEvents[0].maneuverType, maneuverType, `${label}: formal event type mismatch`);

  const beforeTaskIds = new Set(beforeDatabase.tasks.map((item) => item.id));
  const newTasks = afterDatabase.tasks.filter((item) => !beforeTaskIds.has(item.id));
  assert.equal(
    newTasks.length,
    expectedAiTaskDelta,
    `${label}: Confirm created an unexpected number of AI tasks`,
  );

  if (expectedProviderCallDelta != null) {
    const beforeTotal = providerCallTotal(beforeProviderCalls);
    const afterTotal = providerCallTotal(afterProviderCalls);
    assert.notEqual(beforeTotal, null, `${label}: provider call baseline is unavailable`);
    assert.notEqual(afterTotal, null, `${label}: provider call result is unavailable`);
    assert.equal(
      afterTotal - beforeTotal,
      expectedProviderCallDelta,
      `${label}: Confirm called the provider an unexpected number of times`,
    );
  }

  return { newEvents, newTasks };
}

export function requestDelta(requests, startIndex, kind) {
  return requests
    .slice(startIndex)
    .filter((item) => classifyManeuverRequest(item.url) === kind);
}
