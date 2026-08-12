import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPressureBeatResult,
  completePressureBeat,
  resolvePressureBeat,
} from "../src/pressure-chapter/beat";
import {
  assertPressureChapterDefinition,
  chapterSequence,
  createChapterWorkingState,
} from "../src/pressure-chapter/chapter";
import { buildChapterWorkingSet } from "../src/pressure-chapter/working-set";
import type {
  ChapterWorkingState,
  DecisionPointDefinition,
  JsonValue,
  PressureChapterDefinition,
  PressureChapterId,
} from "../src/pressure-chapter/types";
import { PRESSURE_CHAPTER_IDS } from "../src/pressure-chapter/types";

function decisionPoint(input: {
  chapterId: PressureChapterId;
  index: number;
  priority?: DecisionPointDefinition["priority"];
  activation?: DecisionPointDefinition["activation"];
  requirementId?: string;
  satisfyRequirementIds?: string[];
  setFacts?: Record<string, JsonValue>;
  prompt?: string;
}): DecisionPointDefinition {
  const requirementId = input.requirementId ?? `req.${input.chapterId}.${input.index}`;
  return {
    decisionPointId: `point.${input.chapterId}.${input.index}`,
    kernelId: `kernel.${input.chapterId}.${input.index}`,
    chapterId: input.chapterId,
    sourceOrder: input.index,
    prompt: input.prompt ?? `Prompt ${input.index}`,
    requirementIds: [requirementId],
    activation: input.activation,
    priority: input.priority,
    options: [{
      optionId: `option.${input.chapterId}.${input.index}`,
      sourceOrder: 0,
      label: `Option ${input.index}`,
      workingDelta: {
        setFacts: input.setFacts,
        satisfyRequirementIds: input.satisfyRequirementIds ?? [requirementId],
      },
    }],
  };
}

function chapter(chapterId: PressureChapterId, pointCount: number): PressureChapterDefinition {
  return assertPressureChapterDefinition({
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId,
    sequence: chapterSequence(chapterId),
    decisionPoints: Array.from({ length: pointCount }, (_, index) => decisionPoint({
      chapterId,
      index: index + 1,
    })),
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

function playChapter(
  definition: PressureChapterDefinition,
  sourceState: ChapterWorkingState,
): ChapterWorkingState {
  let state = sourceState;
  for (;;) {
    const workingSet = buildChapterWorkingSet(definition, state);
    if (!workingSet) return state;
    const result = resolvePressureBeat(
      workingSet,
      commandFor(workingSet, `action.${state.revision + 1}`),
    );
    state = completePressureBeat(definition, state, result).state;
  }
}

test("N1-N7 are the only ordered playable chapter identifiers", () => {
  assert.deepEqual(PRESSURE_CHAPTER_IDS, ["N1", "N2", "N3", "N4", "N5", "N6", "N7"]);
  for (const [index, chapterId] of PRESSURE_CHAPTER_IDS.entries()) {
    const definition = chapter(chapterId, 1);
    assert.equal(definition.sequence, index + 1);
    assert.equal(definition.decisionPoints[0]?.chapterId, chapterId);
  }
});

test("a chapter supports content-authored 1, 4, or 7 decision points", () => {
  for (const pointCount of [1, 4, 7]) {
    const definition = chapter("N3", pointCount);
    const initial = createChapterWorkingState({ runId: `run-${pointCount}`, chapterId: "N3" });
    const settled = playChapter(definition, initial);

    assert.equal(settled.revision, pointCount);
    assert.equal(settled.completedDecisionPointIds.length, pointCount);
    assert.equal(buildChapterWorkingSet(definition, settled), null);
  }
});

test("a dynamic decision point becomes eligible after an earlier WorkingDelta", () => {
  const first = decisionPoint({
    chapterId: "N2",
    index: 1,
    requirementId: "req.open-clue",
    satisfyRequirementIds: ["req.open-clue"],
    setFacts: { clueOpened: true },
    priority: { duePressureCount: 1 },
  });
  const dynamic = decisionPoint({
    chapterId: "N2",
    index: 2,
    requirementId: "req.follow-clue",
    activation: { factEquals: { clueOpened: true } },
    priority: { duePressureCount: 9 },
  });
  const definition = assertPressureChapterDefinition({
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N2",
    sequence: 2,
    decisionPoints: [dynamic, first],
    requirementDependencies: [{
      dependencyId: "dep.open-before-follow",
      predecessorRequirementId: "req.open-clue",
      successorRequirementId: "req.follow-clue",
    }],
  });
  const state = createChapterWorkingState({ runId: "run-dynamic", chapterId: "N2" });
  const firstWorkingSet = buildChapterWorkingSet(definition, state);
  assert.ok(firstWorkingSet);
  assert.equal(firstWorkingSet.decisionPoint.decisionPointId, first.decisionPointId);
  assert.equal(
    firstWorkingSet.selection.evaluations.find(
      (item) => item.decisionPointId === dynamic.decisionPointId,
    )?.eligible,
    false,
  );

  const firstResult = resolvePressureBeat(firstWorkingSet, commandFor(firstWorkingSet, "open-clue"));
  const transition = completePressureBeat(definition, state, firstResult);
  assert.equal(transition.state.facts.clueOpened, true);
  assert.equal(transition.nextWorkingSet?.decisionPoint.decisionPointId, dynamic.decisionPointId);
});

test("RequirementDependency is an eligibility gate, not a score bonus", () => {
  const predecessor = decisionPoint({
    chapterId: "N5",
    index: 1,
    requirementId: "req.predecessor",
    satisfyRequirementIds: ["req.predecessor"],
  });
  const successor = decisionPoint({
    chapterId: "N5",
    index: 2,
    requirementId: "req.successor",
    priority: { duePressureCount: 100 },
  });
  const definition = assertPressureChapterDefinition({
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N5",
    sequence: 5,
    decisionPoints: [successor, predecessor],
    requirementDependencies: [{
      dependencyId: "dep.predecessor",
      predecessorRequirementId: "req.predecessor",
      successorRequirementId: "req.successor",
    }],
  });
  const state = createChapterWorkingState({ runId: "run-dependency", chapterId: "N5" });

  const workingSet = buildChapterWorkingSet(definition, state);
  assert.ok(workingSet);
  assert.equal(workingSet.decisionPoint.decisionPointId, predecessor.decisionPointId);
  const evaluation = workingSet.selection.evaluations.find(
    (item) => item.decisionPointId === successor.decisionPointId,
  );
  assert.equal(evaluation?.score, 6000);
  assert.equal(evaluation?.eligible, false);
  assert.match(evaluation?.reasonCodes.join("|") ?? "", /REQUIREMENT_DEPENDENCY_BLOCKED/u);
});

test("BeatResult can only mutate chapter WorkingState and rejects authority fields", () => {
  const definition = chapter("N6", 1);
  const state = createChapterWorkingState({ runId: "run-working-only", chapterId: "N6" });
  const workingSet = buildChapterWorkingSet(definition, state);
  assert.ok(workingSet);
  const result = resolvePressureBeat(workingSet, commandFor(workingSet, "working-only"));

  assert.equal("worldSequence" in result, false);
  assert.equal(JSON.stringify(result).includes("worldSequence"), false);
  assert.equal(applyPressureBeatResult(state, result).revision, 1);

  const invalidDefinition = chapter("N7", 1);
  invalidDefinition.decisionPoints[0]!.options[0]!.workingDelta.setFacts = {
    nested: { worldSequence: 9 },
  };
  assert.throws(
    () => assertPressureChapterDefinition(invalidDefinition),
    /PRESSURE_CHAPTER_AUTHORITY_FIELD_FORBIDDEN/u,
  );
});
