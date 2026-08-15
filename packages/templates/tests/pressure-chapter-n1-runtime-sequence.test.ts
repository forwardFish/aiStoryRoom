import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  applyPressureBeatResult,
  completePressureBeat,
  resolvePressureBeat,
} from "../src/pressure-chapter/beat";
import {
  assertPressureChapterDefinition,
  createChapterWorkingState,
} from "../src/pressure-chapter/chapter";
import { buildChapterWorkingSet } from "../src/pressure-chapter/working-set";
import type {
  PressureChapterDefinition,
} from "../src/pressure-chapter/types";

type ContentDecision = {
  decisionPointKey: string;
  ordinal: number;
  purpose: string;
  beatResolutionPolicy: string;
  closeFactRef: string;
  allowedActionTypes: string[];
};

type BeatBinding = {
  decisionContractRef: string;
  catalogDecisionPointRef: string;
  advanceCondition: {
    kind: "AUTHORITY_NEXT_DECISION_PIN" | "CHAPTER_SUMMARY_READY";
    successorDecisionContractRefs: string[];
  };
};

const CONFIG_ROOT = resolve(
  __dirname,
  "../config/sangtian/pressure-chapter-v1",
);
const content = readJson(resolve(CONFIG_ROOT, "content.json"));
const bindings = readJson(
  resolve(CONFIG_ROOT, "authoring/n1-beat-bindings-v1.json"),
);
const n1 = (content.chapters as Array<Record<string, unknown>>)
  .find((chapter) => chapter.chapterId === "N1") as {
    decisionPoints: ContentDecision[];
    closePolicy: { exitPredicate: { factRef: string } };
  };
const decisionBindings = bindings.decisionContracts as BeatBinding[];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function optionId(actionType: string): string {
  return `action.${actionType.toLowerCase()}`;
}

function runtimeDefinition(): PressureChapterDefinition {
  const decisionCount = n1.decisionPoints.length;
  return assertPressureChapterDefinition({
    schemaVersion: "pressure_chapter_definition_v1",
    chapterId: "N1",
    sequence: 1,
    decisionPoints: n1.decisionPoints.map((point, index) => ({
      decisionPointId: point.decisionPointKey,
      kernelId: point.beatResolutionPolicy,
      chapterId: "N1",
      sourceOrder: point.ordinal,
      prompt: point.purpose,
      requirementIds: [],
      priority: {
        // This is the exact generic content-adapter ordering rule. No N1
        // branch or custom state machine is introduced by the correction.
        duePressureCount: decisionCount - index,
      },
      options: point.allowedActionTypes.map((actionType, optionIndex) => ({
        optionId: optionId(actionType),
        sourceOrder: optionIndex + 1,
        label: `internal:${actionType}`,
        workingDelta: {
          setFacts: { [point.closeFactRef]: true },
        },
      })),
    })),
    requirementDependencies: [],
  });
}

test("the existing generic Working kernel executes N1 B01 through B08 in source order and exhausts only after B08", () => {
  const chapter = runtimeDefinition();
  let state = createChapterWorkingState({
    runId: "run-n1-multibeat-runtime-sequence",
    chapterId: "N1",
  });

  n1.decisionPoints.forEach((decision, index) => {
    const workingSet = buildChapterWorkingSet(chapter, state);
    assert.ok(workingSet);
    assert.equal(workingSet.decisionPoint.decisionPointId, decision.decisionPointKey);
    assert.equal(state.facts[n1.closePolicy.exitPredicate.factRef], undefined);

    const selectedOption = workingSet.decisionPoint.options
      .find((option) => !option.optionId.endsWith("default_pass"));
    assert.ok(selectedOption);
    const result = resolvePressureBeat(workingSet, {
      actionId: `action-n1-b${String(index + 1).padStart(2, "0")}`,
      expectedRevision: workingSet.stateRevision,
      expectedStateFingerprint: workingSet.stateFingerprint,
      decisionPointId: decision.decisionPointKey,
      optionId: selectedOption.optionId,
    });
    const transition = completePressureBeat(chapter, state, result);
    assert.equal(transition.state.facts[decision.closeFactRef], true);
    assert.equal(
      transition.state.completedDecisionPointIds.includes(decision.decisionPointKey),
      true,
    );

    assert.throws(
      () => applyPressureBeatResult(transition.state, result),
      /PRESSURE_CHAPTER_STALE_REVISION|PRESSURE_CHAPTER_DECISION_ALREADY_COMPLETED/u,
    );

    const binding = decisionBindings[index]!;
    assert.equal(binding.catalogDecisionPointRef, decision.decisionPointKey);
    if (index < n1.decisionPoints.length - 1) {
      assert.equal(binding.advanceCondition.kind, "AUTHORITY_NEXT_DECISION_PIN");
      assert.deepEqual(binding.advanceCondition.successorDecisionContractRefs, [
        decisionBindings[index + 1]!.decisionContractRef,
      ]);
      assert.equal(
        transition.nextWorkingSet?.decisionPoint.decisionPointId,
        n1.decisionPoints[index + 1]!.decisionPointKey,
      );
      assert.equal(transition.state.facts[n1.closePolicy.exitPredicate.factRef], undefined);
    } else {
      assert.equal(binding.advanceCondition.kind, "CHAPTER_SUMMARY_READY");
      assert.deepEqual(binding.advanceCondition.successorDecisionContractRefs, []);
      assert.equal(transition.nextWorkingSet, null);
      assert.equal(transition.nextDecisionPin, null);
      assert.equal(transition.state.facts[n1.closePolicy.exitPredicate.factRef], true);
    }
    state = transition.state;
  });

  assert.equal(buildChapterWorkingSet(chapter, state), null);
  assert.deepEqual(
    state.completedDecisionPointIds,
    n1.decisionPoints.map((point) => point.decisionPointKey).sort(),
  );
});

test("a later N1 decision cannot be submitted before the active source-order decision completes", () => {
  const chapter = runtimeDefinition();
  const state = createChapterWorkingState({
    runId: "run-n1-multibeat-out-of-order",
    chapterId: "N1",
  });
  const workingSet = buildChapterWorkingSet(chapter, state);
  assert.ok(workingSet);
  const later = n1.decisionPoints[1]!;
  assert.throws(
    () => resolvePressureBeat(workingSet, {
      actionId: "action-n1-out-of-order",
      expectedRevision: workingSet.stateRevision,
      expectedStateFingerprint: workingSet.stateFingerprint,
      decisionPointId: later.decisionPointKey,
      optionId: optionId(later.allowedActionTypes[0]!),
    }),
    /PRESSURE_CHAPTER_DECISION_POINT_MISMATCH/u,
  );
  assert.equal(state.revision, 0);
  assert.deepEqual(state.completedDecisionPointIds, []);
});
