import assert from "node:assert/strict";
import test from "node:test";
import {
  NARRATIVE_BEAT_TYPES,
  buildNarrativeSceneBrief,
  assertNarrativeRequestBinding,
  assertNarrativeResponse,
  resolveNarrativeWithAuthoredFallback,
  type NarrativeActionOutcome,
  type NarrativeRequestV1,
  type NarrativeResponseV1,
  type NarrativeSceneBriefV1,
} from "../src/sangtian-pressure-narrative.js";

const outcomes: NarrativeActionOutcome[] = ["SUCCESS", "PARTIAL", "FAILURE", "DEFAULT"];

for (const actionOutcome of outcomes) {
  test(`builds one four-beat brief for a settled ${actionOutcome} batch`, () => {
    const brief = makeBrief(actionOutcome);

    assert.equal(brief.schemaVersion, "narrative_scene_brief_v1");
    assert.equal(brief.requiredBeats.length, 4);
    assert.deepEqual(
      brief.requiredBeats.map((beat) => beat.beatType),
      NARRATIVE_BEAT_TYPES,
    );
    assert.deepEqual(brief.sourceActionIds, ["action-human", "action-ai-visible"]);
    assert.ok(brief.requiredBeats.every((beat) => referenceCount(beat) > 0));
    assert.ok(Object.isFrozen(brief));
  });
}

test("aggregates multiple visible actions into one brief rather than one Narrator call per seat", () => {
  const brief = makeBrief("SUCCESS");
  assert.equal(brief.briefId, "brief-run-1-n1-governor-snapshot-1");
  assert.deepEqual(brief.sourceActionIds, ["action-human", "action-ai-visible"]);
  assert.equal(brief.requiredBeats.length, 4);
});

test("request binding fails closed on viewer or authoritative snapshot mismatch", () => {
  const request = makeRequest(makeBrief("SUCCESS"));
  assert.doesNotThrow(() => assertNarrativeRequestBinding(request, expectation()));
  assert.throws(() => assertNarrativeRequestBinding(request, {
    ...expectation(),
    viewerSeatId: "seat-merchant",
  }), /NARRATIVE_VIEWER_MISMATCH/);
  assert.throws(() => assertNarrativeRequestBinding(request, {
    ...expectation(),
    snapshotHash: "snapshot-stale",
  }), /NARRATIVE_SNAPSHOT_MISMATCH/);
  assert.throws(() => assertNarrativeRequestBinding(request, {
    ...expectation(),
    viewerKnownFactIds: ["fact-public-water-rise", "fact-hidden-1"],
  }), /NARRATIVE_VIEWER_KNOWLEDGE_MISMATCH/);
});

test("coverage guard requires every known beat exactly once", () => {
  const request = makeRequest(makeBrief("SUCCESS"));
  const valid = makeResponse(request);
  assert.doesNotThrow(() => assertNarrativeResponse(request, valid));

  assert.throws(() => assertNarrativeResponse(request, {
    ...valid,
    coveredBeatIds: valid.coveredBeatIds.slice(0, 3),
  }), /NARRATIVE_BEAT_COVERAGE_INVALID/);
  assert.throws(() => assertNarrativeResponse(request, {
    ...valid,
    coveredBeatIds: [...valid.coveredBeatIds, valid.coveredBeatIds[0]!],
  }), /NARRATIVE_BEAT_DUPLICATE/);
  assert.throws(() => assertNarrativeResponse(request, {
    ...valid,
    coveredBeatIds: [...valid.coveredBeatIds.slice(0, 3), "unknown-beat"],
  }), /NARRATIVE_BEAT_COVERAGE_INVALID/);
});

test("coverage guard rejects action, event, fact, object and content references outside allowlists", () => {
  const request = makeRequest(makeBrief("SUCCESS"));
  const valid = makeResponse(request);
  const cases: Array<[keyof NarrativeResponseV1, string, RegExp]> = [
    ["usedActionIds", "hidden-action", /ACTION_REFERENCE_OUTSIDE_ALLOWLIST/],
    ["usedSettledEventIds", "hidden-event", /EVENT_REFERENCE_OUTSIDE_ALLOWLIST/],
    ["usedFactIds", "hidden-fact", /FACT_REFERENCE_OUTSIDE_ALLOWLIST/],
    ["usedObjectVersionIds", "hidden-object", /OBJECT_REFERENCE_OUTSIDE_ALLOWLIST/],
    ["usedContentSourceRefs", "hidden-content", /CONTENT_REFERENCE_OUTSIDE_ALLOWLIST/],
  ];
  for (const [field, invalid, pattern] of cases) {
    assert.throws(() => assertNarrativeResponse(request, {
      ...valid,
      [field]: [invalid],
    }), pattern);
  }
});

test("forbidden stable fact and knowledge IDs cannot leak through safe quote or scene text", () => {
  assert.throws(() => makeBrief("SUCCESS", {
    safeSourceQuote: "玩家看见了 knowledge-hidden-1",
  }), /BRIEF_SAFE_QUOTE_REVEALS_FORBIDDEN_ID/);

  const request = makeRequest(makeBrief("SUCCESS"));
  assert.throws(() => assertNarrativeResponse(request, {
    ...makeResponse(request),
    sceneText: "公开场景里不应出现 fact-hidden-1。",
  }), /NARRATIVE_TEXT_REVEALS_FORBIDDEN_ID/);
});

test("invalid model result falls back through the same coverage and reference guard", () => {
  const request = makeRequest(makeBrief("PARTIAL"));
  const fallback = makeResponse(request, "作者层备用场景完整兑现四个节拍。");
  const result = resolveNarrativeWithAuthoredFallback({
    request,
    expected: expectation(),
    candidate: {
      ...makeResponse(request),
      coveredBeatIds: request.sceneBrief.requiredBeats.slice(0, 2).map((beat) => beat.beatId),
    },
    authoredFallback: fallback,
  });

  assert.equal(result.source, "AUTHORED_FALLBACK");
  assert.equal(result.response.sceneText, fallback.sceneText);
  assert.match(result.rejectedCandidateReason || "", /NARRATIVE_BEAT_COVERAGE_INVALID/);

  assert.throws(() => resolveNarrativeWithAuthoredFallback({
    request,
    expected: expectation(),
    candidate: { ...fallback, coveredBeatIds: [] },
    authoredFallback: { ...fallback, usedFactIds: ["hidden-fact"] },
  }), /NARRATIVE_FACT_REFERENCE_OUTSIDE_ALLOWLIST/);
});

test("the four-beat contract works for a neutral second world without story keywords", () => {
  const brief = buildNarrativeSceneBrief({
    briefId: "brief-orbit-7",
    runId: "run-orbit",
    nodeId: "oxygen-window",
    viewerSeatId: "seat-engineer",
    sourceActionIds: ["action-seal-valve"],
    safeSourceQuote: "The engineer sealed the damaged valve.",
    actionOutcome: "PARTIAL",
    beatEvidence: {
      PLAYER_ACTION: refs({ sourceActionIds: ["action-seal-valve"] }),
      VISIBLE_REACTION: refs({ settledEventIds: ["event-crew-relocates"] }),
      CONSEQUENCE_OR_NEW_INFO: refs({ factIds: ["fact-oxygen-stable-two-hours"] }),
      NEXT_PRESSURE: refs({ contentSourceRefs: ["content-orbit-next-window"] }),
    },
    mustNotRevealFactIds: ["fact-hidden-saboteur"],
    mustNotRevealKnowledgeIds: ["knowledge-command-only"],
    allowedFactIds: ["fact-oxygen-stable-two-hours"],
    allowedObjectVersionIds: [],
    allowedSettledEventIds: ["event-crew-relocates"],
    allowedContentSourceRefs: ["content-orbit-next-window"],
    snapshotHash: "snapshot-orbit-7",
  });

  assert.deepEqual(brief.requiredBeats.map((beat) => beat.beatType), NARRATIVE_BEAT_TYPES);
  assert.equal(brief.nodeId, "oxygen-window");
});

function makeBrief(
  actionOutcome: NarrativeActionOutcome,
  override: { safeSourceQuote?: string } = {},
): NarrativeSceneBriefV1 {
  return buildNarrativeSceneBrief({
    briefId: "brief-run-1-n1-governor-snapshot-1",
    runId: "run-1",
    nodeId: "N1",
    viewerSeatId: "seat-governor",
    sourceActionIds: ["action-human", "action-ai-visible"],
    safeSourceQuote: override.safeSourceQuote || "玩家下令疏散堰下百姓，并暂缓签押。",
    actionOutcome,
    beatEvidence: {
      PLAYER_ACTION: refs({ sourceActionIds: ["action-human"] }),
      VISIBLE_REACTION: refs({
        sourceActionIds: ["action-ai-visible"],
        settledEventIds: ["event-visible-reaction"],
      }),
      CONSEQUENCE_OR_NEW_INFO: refs({
        settledEventIds: ["event-consequence"],
        factIds: ["fact-public-water-rise"],
        objectVersionIds: ["object-order-v2"],
      }),
      NEXT_PRESSURE: refs({ contentSourceRefs: ["content-next-pressure-n1"] }),
    },
    mustNotRevealFactIds: ["fact-hidden-1"],
    mustNotRevealKnowledgeIds: ["knowledge-hidden-1"],
    allowedFactIds: ["fact-public-water-rise", "fact-private-authorized"],
    allowedObjectVersionIds: ["object-order-v2"],
    allowedSettledEventIds: ["event-visible-reaction", "event-consequence"],
    allowedContentSourceRefs: ["content-next-pressure-n1"],
    snapshotHash: "snapshot-1",
  });
}

function makeRequest(brief: NarrativeSceneBriefV1): NarrativeRequestV1 {
  return {
    runId: brief.runId,
    nodeId: brief.nodeId,
    sceneId: "scene-after-prepare",
    viewerSeatId: brief.viewerSeatId,
    currentActorId: "actor-governor",
    publicFactIds: ["fact-public-water-rise"],
    privateFactIds: ["fact-private-authorized"],
    visibleObjectVersions: ["object-order-v2"],
    settledEventIds: ["event-visible-reaction", "event-consequence"],
    pressure: { flood: 3 },
    worldTime: { day: 1, period: "PM" },
    styleRules: ["Explain settled facts only."],
    forbiddenFactIds: ["fact-hidden-1"],
    allowedContentSourceRefs: ["content-next-pressure-n1"],
    sceneBrief: brief,
    snapshotHash: brief.snapshotHash,
  };
}

function makeResponse(
  request: NarrativeRequestV1,
  sceneText = "玩家的命令被执行；属吏作出可见回应，水势变化被确认，而下一道压力已经迫近。",
): NarrativeResponseV1 {
  return {
    sceneText,
    usedFactIds: ["fact-public-water-rise"],
    usedObjectVersionIds: ["object-order-v2"],
    usedActionIds: ["action-human", "action-ai-visible"],
    usedSettledEventIds: ["event-visible-reaction", "event-consequence"],
    usedContentSourceRefs: ["content-next-pressure-n1"],
    coveredBeatIds: request.sceneBrief.requiredBeats.map((beat) => beat.beatId),
    endingState: "DECISION_STOP",
  };
}

function expectation() {
  return {
    viewerSeatId: "seat-governor",
    snapshotHash: "snapshot-1",
    viewerKnownFactIds: ["fact-public-water-rise", "fact-private-authorized"],
    visibleObjectVersionIds: ["object-order-v2"],
    settledEventIds: ["event-visible-reaction", "event-consequence"],
    allowedContentSourceRefs: ["content-next-pressure-n1"],
    forbiddenFactIds: ["fact-hidden-1"],
    mustNotRevealKnowledgeIds: ["knowledge-hidden-1"],
  };
}

function refs(overrides: Partial<{
  sourceActionIds: string[];
  settledEventIds: string[];
  factIds: string[];
  objectVersionIds: string[];
  contentSourceRefs: string[];
}> = {}) {
  return {
    sourceActionIds: overrides.sourceActionIds || [],
    settledEventIds: overrides.settledEventIds || [],
    factIds: overrides.factIds || [],
    objectVersionIds: overrides.objectVersionIds || [],
    contentSourceRefs: overrides.contentSourceRefs || [],
  };
}

function referenceCount(value: {
  sourceActionIds: readonly string[];
  settledEventIds: readonly string[];
  factIds: readonly string[];
  objectVersionIds: readonly string[];
  contentSourceRefs: readonly string[];
}) {
  return value.sourceActionIds.length
    + value.settledEventIds.length
    + value.factIds.length
    + value.objectVersionIds.length
    + value.contentSourceRefs.length;
}
