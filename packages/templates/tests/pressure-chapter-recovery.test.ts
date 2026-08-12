import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPressureBeatResult,
  completePressureBeat,
  resolvePressureBeat,
} from "../src/pressure-chapter/beat";
import {
  assertPressureChapterDefinition,
  createChapterWorkingState,
} from "../src/pressure-chapter/chapter";
import {
  fingerprintChapterSelectionState,
  fingerprintChapterWorkingState,
  selectNextDecisionPoint,
} from "../src/pressure-chapter/kernel-selector";
import {
  buildChapterWorkingSet,
  pinChapterWorkingSet,
  recoverPinnedChapterWorkingSet,
} from "../src/pressure-chapter/working-set";
import type {
  DecisionPointDefinition,
  PressureChapterDefinition,
} from "../src/pressure-chapter/types";

function point(input: {
  id: string;
  sourceOrder: number;
  prompt?: string;
  priority?: DecisionPointDefinition["priority"];
  activation?: DecisionPointDefinition["activation"];
  setFacts?: Record<string, string | number | boolean | null>;
  reaction?: string;
}): DecisionPointDefinition {
  return {
    decisionPointId: `point.${input.id}`,
    kernelId: `kernel.${input.id}`,
    chapterId: "N4",
    sourceOrder: input.sourceOrder,
    prompt: input.prompt ?? `Prompt ${input.id}`,
    requirementIds: [`req.${input.id}`],
    activation: input.activation,
    priority: input.priority,
    options: [{
      optionId: `option.${input.id}.b`,
      sourceOrder: 2,
      label: `Option ${input.id} B`,
      workingDelta: {
        setFacts: input.setFacts,
        satisfyRequirementIds: [`req.${input.id}`],
        reaction: input.reaction ? {
          kind: "ACTION_SETTLED",
          summary: input.reaction,
          audience: "RELATED",
          causalFactIds: [`fact.${input.id}`],
        } : undefined,
      },
    }, {
      optionId: `option.${input.id}.a`,
      sourceOrder: 1,
      label: `Option ${input.id} A`,
      workingDelta: {
        setFacts: input.setFacts,
        satisfyRequirementIds: [`req.${input.id}`],
        reaction: input.reaction ? {
          kind: "ACTION_SETTLED",
          summary: input.reaction,
          audience: "RELATED",
          causalFactIds: [`fact.${input.id}`],
        } : undefined,
      },
    }],
  };
}

function definition(points: DecisionPointDefinition[]): PressureChapterDefinition {
  return assertPressureChapterDefinition({
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N4",
    sequence: 4,
    decisionPoints: points,
    requirementDependencies: [],
  });
}

function commandFor(
  workingSet: NonNullable<ReturnType<typeof buildChapterWorkingSet>>,
  actionId: string,
) {
  return {
    actionId,
    expectedRevision: workingSet.stateRevision,
    expectedStateFingerprint: workingSet.stateFingerprint,
    decisionPointId: workingSet.decisionPoint.decisionPointId,
    optionId: workingSet.optionIds[0]!,
  };
}

test("selection and fingerprints are deterministic across input ordering", () => {
  const alpha = point({ id: "alpha", sourceOrder: 1 });
  const beta = point({ id: "beta", sourceOrder: 2 });
  const definitionA = definition([alpha, beta]);
  const definitionB = definition([beta, alpha]);
  const stateA = createChapterWorkingState({
    runId: "run-determinism",
    chapterId: "N4",
    facts: { zeta: 2, alpha: 1 },
    counters: { second: 2, first: 1 },
  });
  const stateB = createChapterWorkingState({
    runId: "run-determinism",
    chapterId: "N4",
    facts: { alpha: 1, zeta: 2 },
    counters: { first: 1, second: 2 },
  });

  assert.equal(fingerprintChapterWorkingState(stateA), fingerprintChapterWorkingState(stateB));
  const workingSetA = buildChapterWorkingSet(definitionA, stateA);
  const workingSetB = buildChapterWorkingSet(definitionB, stateB);
  assert.ok(workingSetA);
  assert.ok(workingSetB);
  assert.equal(workingSetA.decisionPoint.decisionPointId, workingSetB.decisionPoint.decisionPointId);
  assert.deepEqual(workingSetA.optionIds, workingSetB.optionIds);
  assert.deepEqual(workingSetA.optionIds, [
    `option.${workingSetA.decisionPoint.decisionPointId.slice("point.".length)}.a`,
    `option.${workingSetA.decisionPoint.decisionPointId.slice("point.".length)}.b`,
  ]);
});

test("selection fingerprint ignores run identity and presentation prose only", () => {
  const base = createChapterWorkingState({
    runId: "run-semantic-a",
    chapterId: "N4",
    facts: {
      authority: "JOINT",
      scene: {
        eventId: "event-a",
        situation: "Stable causal situation",
        structuredState: "SEALED",
      },
    },
  });
  base.lastBeatId = "beat-a";
  base.settledReactions = [{
    reactionId: "reaction-a",
    sourceDecisionPointId: "point.prior",
    sourceOptionId: "option.prior",
    kind: "ACTION_SETTLED",
    summary: "First prose summary",
    audience: "RELATED",
    causalFactIds: ["fact.stable"],
  }];
  const retry = structuredClone(base);
  retry.runId = "run-semantic-b";
  retry.lastBeatId = "beat-b";
  retry.facts.scene = {
    eventId: "event-b",
    situation: "Stable causal situation",
    structuredState: "SEALED",
  };
  retry.settledReactions[0]!.reactionId = "reaction-b";
  retry.settledReactions[0]!.summary = "Reworded prose summary";

  assert.notEqual(fingerprintChapterWorkingState(base), fingerprintChapterWorkingState(retry));
  assert.equal(
    fingerprintChapterSelectionState(base),
    fingerprintChapterSelectionState(retry),
  );

  retry.facts.scene.structuredState = "OPEN";
  assert.notEqual(
    fingerprintChapterSelectionState(base),
    fingerprintChapterSelectionState(retry),
  );
});

test("causal facts are retained even when their keys resemble presentation fields", () => {
  const base = createChapterWorkingState({
    runId: "run-causal-fields",
    chapterId: "N4",
    facts: {
      action: "SEAL",
      summary: "LEDGER_VALID",
      resultCeiling: "LIMITED",
      requiredTermGroups: [["seal", "ledger"]],
    },
  });

  for (const [key, value] of [
    ["action", "BURN"],
    ["summary", "LEDGER_VOID"],
    ["resultCeiling", "TOTAL"],
    ["requiredTermGroups", [["burn", "ledger"]]],
  ] as const) {
    const changed = structuredClone(base);
    changed.facts[key] = value;
    assert.notEqual(
      fingerprintChapterSelectionState(base),
      fingerprintChapterSelectionState(changed),
      key,
    );
  }
});

test("semantic tie breaking is stable across run ids, prose, candidate order, and retries", () => {
  const alpha = point({ id: "semantic-alpha", sourceOrder: 1 });
  const beta = point({ id: "semantic-beta", sourceOrder: 2 });
  const normalChapter = definition([alpha, beta]);
  const reversedChapter = definition([beta, alpha]);
  const firstState = createChapterWorkingState({
    runId: "run-selection-a",
    chapterId: "N4",
    facts: { eventId: "event-a", authority: "JOINT" },
  });
  const retryState = createChapterWorkingState({
    runId: "run-selection-b",
    chapterId: "N4",
    facts: { eventId: "event-b", authority: "JOINT" },
  });
  firstState.settledReactions = [{
    reactionId: "reaction-selection-a",
    sourceDecisionPointId: "point.prior",
    sourceOptionId: "option.prior",
    kind: "ACTION_SETTLED",
    summary: "First narrative rendering",
    audience: "RELATED",
    causalFactIds: ["fact.stable"],
  }];
  retryState.settledReactions = [{
    ...firstState.settledReactions[0]!,
    reactionId: "reaction-selection-b",
    summary: "Reworded narrative rendering",
  }];
  const expected = selectNextDecisionPoint(normalChapter, firstState);
  const reversed = selectNextDecisionPoint(reversedChapter, retryState);

  assert.ok(expected.selected);
  assert.equal(reversed.selected?.decisionPointId, expected.selected.decisionPointId);
  assert.deepEqual(reversed.trace.evaluations, expected.trace.evaluations);
  assert.notEqual(reversed.trace.stateFingerprint, expected.trace.stateFingerprint);
  for (let index = 0; index < 100; index += 1) {
    assert.equal(
      selectNextDecisionPoint(normalChapter, structuredClone(retryState)).selected?.decisionPointId,
      expected.selected.decisionPointId,
    );
  }
});

test("a pinned decision recovers exactly at the same state revision and fingerprint", () => {
  const chapter = definition([point({ id: "pinned", sourceOrder: 1 })]);
  const state = createChapterWorkingState({ runId: "run-pin", chapterId: "N4" });
  const workingSet = buildChapterWorkingSet(chapter, state);
  assert.ok(workingSet);
  const pin = pinChapterWorkingSet(workingSet);
  const recovered = recoverPinnedChapterWorkingSet(chapter, structuredClone(state), pin);

  assert.equal(recovered.decisionPoint.decisionPointId, workingSet.decisionPoint.decisionPointId);
  assert.equal(recovered.stateFingerprint, workingSet.stateFingerprint);
  assert.deepEqual(recovered.optionIds, workingSet.optionIds);
  assert.equal(recovered.selection.selectedDecisionPointId, workingSet.decisionPoint.decisionPointId);
});

test("semantic selection equivalence never relaxes the full recovery fence", () => {
  const chapter = definition([
    point({ id: "semantic-fence-a", sourceOrder: 1 }),
    point({ id: "semantic-fence-b", sourceOrder: 2 }),
  ]);
  const state = createChapterWorkingState({
    runId: "run-fence-a",
    chapterId: "N4",
    facts: { eventId: "event-fence-a", authority: "JOINT" },
  });
  const workingSet = buildChapterWorkingSet(chapter, state);
  assert.ok(workingSet);
  const pin = pinChapterWorkingSet(workingSet);
  const equivalentRetry = structuredClone(state);
  equivalentRetry.runId = "run-fence-b";
  equivalentRetry.facts.eventId = "event-fence-b";

  assert.equal(
    fingerprintChapterSelectionState(state),
    fingerprintChapterSelectionState(equivalentRetry),
  );
  assert.notEqual(
    fingerprintChapterWorkingState(state),
    fingerprintChapterWorkingState(equivalentRetry),
  );
  assert.throws(
    () => recoverPinnedChapterWorkingSet(chapter, equivalentRetry, pin),
    /PRESSURE_CHAPTER_PIN_STALE/u,
  );
});

test("stale command, repeated BeatResult, and stale recovery pin fail closed", () => {
  const chapter = definition([point({ id: "stale", sourceOrder: 1 })]);
  const state = createChapterWorkingState({ runId: "run-stale", chapterId: "N4" });
  const workingSet = buildChapterWorkingSet(chapter, state);
  assert.ok(workingSet);
  const pin = pinChapterWorkingSet(workingSet);

  assert.throws(
    () => resolvePressureBeat(workingSet, {
      ...commandFor(workingSet, "stale-command"),
      expectedRevision: workingSet.stateRevision + 1,
    }),
    /PRESSURE_CHAPTER_STALE_REVISION/u,
  );

  const result = resolvePressureBeat(workingSet, commandFor(workingSet, "settled-once"));
  const nextState = applyPressureBeatResult(state, result);
  assert.throws(
    () => applyPressureBeatResult(nextState, result),
    /PRESSURE_CHAPTER_STALE_REVISION/u,
  );
  assert.throws(
    () => recoverPinnedChapterWorkingSet(chapter, nextState, pin),
    /PRESSURE_CHAPTER_PIN_STALE/u,
  );
});

test("the current settled reaction is not replaced by the next decision prompt", () => {
  const first = point({
    id: "commitment",
    sourceOrder: 1,
    priority: { duePressureCount: 1 },
    prompt: "Choose whether to make the commitment.",
    setFacts: { commitmentSettled: true },
    reaction: "The commitment has been accepted and is now binding.",
  });
  const next = point({
    id: "investigation",
    sourceOrder: 2,
    priority: { duePressureCount: 9 },
    activation: { factEquals: { commitmentSettled: true } },
    prompt: "Who should be investigated next?",
  });
  const chapter = definition([next, first]);
  const state = createChapterWorkingState({ runId: "run-reaction", chapterId: "N4" });
  const firstWorkingSet = buildChapterWorkingSet(chapter, state);
  assert.ok(firstWorkingSet);
  assert.equal(firstWorkingSet.decisionPoint.decisionPointId, first.decisionPointId);

  const result = resolvePressureBeat(
    firstWorkingSet,
    commandFor(firstWorkingSet, "settle-commitment"),
  );
  const transition = completePressureBeat(chapter, state, result);

  assert.equal(
    transition.currentReaction?.summary,
    "The commitment has been accepted and is now binding.",
  );
  assert.equal(transition.nextWorkingSet?.decisionPoint.prompt, "Who should be investigated next?");
  assert.notEqual(
    transition.currentReaction?.summary,
    transition.nextWorkingSet?.decisionPoint.prompt,
  );
  assert.equal(
    transition.state.settledReactions.at(-1)?.summary,
    transition.currentReaction?.summary,
  );
  assert.ok(transition.nextDecisionPin);
  const recoveredNext = recoverPinnedChapterWorkingSet(
    chapter,
    transition.state,
    transition.nextDecisionPin,
  );
  assert.equal(recoveredNext.decisionPoint.prompt, "Who should be investigated next?");
  assert.equal(
    transition.currentReaction?.summary,
    "The commitment has been accepted and is now binding.",
  );
});
