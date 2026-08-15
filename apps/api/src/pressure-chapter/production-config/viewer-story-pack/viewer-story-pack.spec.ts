import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import type { ResolvedPressureChapterBeatV1 } from "@ai-story/templates";
import {
  PRESSURE_VIEWER_STORY_PACK_ERROR_CODES_V1 as ERROR,
  PressureViewerStoryPackCompileErrorV1,
  compilePressureViewerStoryPackV1,
  type CompilePressureViewerStoryPackInputV1,
} from ".";

const VIEWERS = PRESSURE_CHAPTER_SEAT_IDS_V1.slice(0, 3);

test("three concurrent viewers receive isolated private materials, prior actions and cache keys", async () => {
  const inputs = VIEWERS.map((seatId, index) => fixture(seatId, index + 2));
  const snapshots = inputs.map((input) => structuredClone(input));
  const packs = await Promise.all(inputs.map(async (input) => compilePressureViewerStoryPackV1(input)));

  assert.equal(new Set(packs.map((pack) => pack.cacheKey)).size, 3);
  assert.equal(new Set(packs.map((pack) => pack.packHash)).size, 3);
  packs.forEach((pack, index) => {
    const seatId = VIEWERS[index]!;
    assert.equal(pack.identity.viewerSeatId, seatId);
    assert.equal(pack.previousAction?.actionId, `action-${seatId}`);
    assert.deepEqual(
      pack.authorialMaterials.map((item) => item.materialRef),
      ["material.public", `material.private.${seatId}`],
    );
    assert.doesNotMatch(
      JSON.stringify(pack),
      new RegExp(VIEWERS.filter((candidate) => candidate !== seatId).join("|"), "u"),
    );
    assert.equal(pack.packHash, sha256Canonical((({ packHash: _hash, ...body }) => body)(pack)));
    assert.equal(Object.isFrozen(pack), true);
    assert.deepEqual(inputs[index], snapshots[index]);
  });
});

test("other-seat private and SYSTEM_ONLY material fail closed", () => {
  const privateLeak = fixture(VIEWERS[0]!, 2);
  privateLeak.authorialMaterials[1]!.authorizedSeatIds = [VIEWERS[1]!];
  codeOf(() => compilePressureViewerStoryPackV1(privateLeak), ERROR.SCOPE_VIOLATION);

  const systemLeak = fixture(VIEWERS[0]!, 2);
  systemLeak.authorialMaterials[1]!.visibility = "SYSTEM_ONLY";
  systemLeak.authorialMaterials[1]!.authorizedSeatIds = [];
  codeOf(() => compilePressureViewerStoryPackV1(systemLeak), ERROR.SCOPE_VIOLATION);
});

test("decision, state and prior-result identity drift fail closed", () => {
  const decision = fixture(VIEWERS[0]!, 2);
  decision.nextDecision.decisionPointRef = "N1.foreign";
  codeOf(() => compilePressureViewerStoryPackV1(decision), ERROR.DECISION_MISMATCH);

  const prior = fixture(VIEWERS[0]!, 2);
  prior.sealedViewerAction!.sourceBeatId = "N1.B99";
  codeOf(() => compilePressureViewerStoryPackV1(prior), ERROR.IDENTITY_MISMATCH);

  const claim = fixture(VIEWERS[0]!, 2);
  claim.authority.allowedClaims[0]!.refId = "fact.not-visible";
  codeOf(() => compilePressureViewerStoryPackV1(claim), ERROR.AUTHORITY_MISMATCH);
});

test("opening compiles without prior result and exposes no persistence or Provider capability", () => {
  const input = fixture(VIEWERS[0]!, 1);
  input.previousBeatId = null;
  input.sealedViewerAction = null;
  input.visibleSeatResults = [];
  const pack = compilePressureViewerStoryPackV1(input);
  assert.equal(pack.previousAction, null);
  assert.equal("provider" in pack, false);
  assert.equal("database" in pack, false);
  assert.equal("settlement" in pack, false);
  assert.equal("nextState" in pack, false);
});

function fixture(viewerSeatId: SeatIdV1, ordinal: number): CompilePressureViewerStoryPackInputV1 {
  const previousBeatId = `N1.B${String(ordinal - 1).padStart(2, "0")}`;
  const beatId = `N1.B${String(ordinal).padStart(2, "0")}`;
  const decisionPointRef = `N1.decision.${ordinal}`;
  const beat: ResolvedPressureChapterBeatV1 = {
    beatId,
    ordinal,
    phase: ordinal === 8 ? "COMMIT" : "DEVELOPMENT",
    title: `Beat ${ordinal}`,
    storyPurpose: "Compile one viewer-safe decision scene.",
    sourceMaterialRefs: [
      "material.public",
      ...PRESSURE_CHAPTER_SEAT_IDS_V1.map((seat) => `material.private.${seat}`),
    ],
    decisionContractRef: `N1.contract.${ordinal}`,
    successorBeatIds: ordinal === 8 ? [] : [`N1.B${String(ordinal + 1).padStart(2, "0")}`],
    closesChapter: ordinal === 8,
    catalogDecisionPointRef: decisionPointRef,
    actionPhase: ordinal < 5 ? "PREPARE" : "COMMIT",
    pressure: "The current authority state requires one legal choice.",
    advanceCondition: ordinal === 8
      ? { kind: "CHAPTER_SUMMARY_READY", successorDecisionContractRefs: [] }
      : {
          kind: "AUTHORITY_NEXT_DECISION_PIN",
          successorDecisionContractRefs: [`N1.contract.${ordinal + 1}`],
        },
    legalActionRefs: [`${decisionPointRef}#ACT_A`, `${decisionPointRef}#ACT_B`],
    sourceMaterials: [],
  };
  return {
    runId: "run-m2",
    routeHash: sha256Canonical("route-m2"),
    chapterRuntimeId: "runtime-n1",
    chapterId: "N1",
    beatId,
    previousBeatId,
    viewerSeatId,
    authorityRevision: ordinal,
    stateAfterHash: sha256Canonical({ viewerSeatId, ordinal }),
    beat,
    sealedViewerAction: {
      runId: "run-m2",
      chapterRuntimeId: "runtime-n1",
      sourceBeatId: previousBeatId,
      viewerSeatId,
      authorityRevision: ordinal,
      actionId: `action-${viewerSeatId}`,
      actionType: "ACT_A",
      summary: `Only ${viewerSeatId} sees this action.`,
    },
    visibleSeatResults: [{
      runId: "run-m2",
      chapterRuntimeId: "runtime-n1",
      sourceBeatId: previousBeatId,
      authorityRevision: ordinal,
      sourceSeatId: viewerSeatId,
      actionId: `result-${viewerSeatId}`,
      summary: `Private result for ${viewerSeatId}`,
      resultFactRefs: [`fact.result.${viewerSeatId}`],
      visibility: "SEAT_PRIVATE",
      authorizedSeatIds: [viewerSeatId],
    }],
    authority: {
      facts: [
        {
          factRef: "fact.public",
          text: "A public authority fact.",
          source: "WORKING_LEDGER",
          visibility: "PUBLIC",
          authorizedSeatIds: [],
        },
        {
          factRef: `fact.result.${viewerSeatId}`,
          text: `Private authority fact for ${viewerSeatId}.`,
          source: "WORKING_LEDGER",
          visibility: "SEAT_PRIVATE",
          authorizedSeatIds: [viewerSeatId],
        },
      ],
      metrics: [{
        metricRef: "metric.public",
        label: "Public metric",
        displayValue: "50",
        visibility: "PUBLIC",
        authorizedSeatIds: [],
      }],
      allowedClaims: [{
        kind: "RESULT",
        refId: `fact.result.${viewerSeatId}`,
        statement: `The viewer's prior action has a sealed result.`,
        required: true,
        visibility: "SEAT_PRIVATE",
        authorizedSeatIds: [viewerSeatId],
      }],
    },
    authorialMaterials: [
      {
        materialRef: "material.public",
        title: "Public pressure",
        text: "The shared scene continues.",
        factRefs: ["fact.public"],
        stopCondition: "Stop before the player chooses.",
        visibility: "PUBLIC",
        authorizedSeatIds: [],
      },
      {
        materialRef: `material.private.${viewerSeatId}`,
        title: "Private pressure",
        text: `Only ${viewerSeatId} may read this material.`,
        factRefs: [`fact.result.${viewerSeatId}`],
        stopCondition: null,
        visibility: "SEAT_PRIVATE",
        authorizedSeatIds: [viewerSeatId],
      },
    ],
    nextDecision: {
      decisionPointRef,
      legalActionRefs: [...beat.legalActionRefs],
      catalogActions: beat.legalActionRefs.map((actionRef, index) => ({
        actionRef,
        actionType: index === 0 ? "ACT_A" : "ACT_B",
        label: `Action ${index + 1}`,
        description: `Choose legal action ${index + 1}.`,
        preferredEntry: "PLAN",
      })),
    },
  };
}

function codeOf(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => (
    error instanceof PressureViewerStoryPackCompileErrorV1 && error.code === code
  ));
}
