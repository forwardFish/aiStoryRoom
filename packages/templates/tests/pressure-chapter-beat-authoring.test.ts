import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_CHAPTER_BEAT_AUTHORING_ERROR_CODES_V1 as ERROR,
  compilePressureChapterBeatAuthoringPackageV1,
  type PressureChapterBeatAuthoringV1,
  type PressureChapterBeatBindingsV1,
  type PressureChapterBeatReferenceIndexV1,
} from "../src/pressure-spine/beat-authoring";
import { loadSangtianPressureChapterBeatAuthoringSourceV1 } from "../src/pressure-spine/sangtian-beat-authoring";

function synthetic() {
  const authoring: PressureChapterBeatAuthoringV1 = {
    schemaVersion: "pressure_chapter_beat_authoring_v1",
    contentStatus: "READY_FOR_IMPORT",
    chapterId: "C42",
    title: "Neutral chapter",
    entryBeatId: "C42.B01",
    beats: [
      {
        beatId: "C42.B01",
        ordinal: 1,
        phase: "OPENING",
        title: "Entry",
        storyPurpose: "Introduce a neutral pressure and open a legal choice.",
        sourceMaterialRefs: ["material.public.entry", "material.private.a"],
        decisionContractRef: "C42.decision.entry",
        successorBeatIds: ["C42.B02"],
        closesChapter: false,
      },
      {
        beatId: "C42.B02",
        ordinal: 2,
        phase: "COMMIT",
        title: "Close",
        storyPurpose: "Make the last legal choice without pre-writing its result.",
        sourceMaterialRefs: ["material.public.close"],
        decisionContractRef: "C42.decision.close",
        successorBeatIds: [],
        closesChapter: true,
      },
    ],
    chapterSummary: {
      outcomeFrameRefs: {
        HIGH: "summary.high",
        MID: "summary.mid",
        LOW: "summary.low",
      },
      nextChapterId: "C43",
    },
  };
  const bindings: PressureChapterBeatBindingsV1 = {
    schemaVersion: "pressure_chapter_beat_bindings_v1",
    chapterId: "C42",
    decisionContracts: [
      {
        decisionContractRef: "C42.decision.entry",
        catalogDecisionPointRef: "catalog.neutral",
        actionPhase: "PREPARE",
        pressure: "The neutral pressure is unresolved.",
        advanceCondition: {
          kind: "AUTHORITY_NEXT_DECISION_PIN",
          successorDecisionContractRefs: ["C42.decision.close"],
        },
      },
      {
        decisionContractRef: "C42.decision.close",
        catalogDecisionPointRef: "catalog.neutral",
        actionPhase: "COMMIT",
        pressure: "The chapter must now close through authority.",
        advanceCondition: {
          kind: "CHAPTER_SUMMARY_READY",
          successorDecisionContractRefs: [],
        },
      },
    ],
    chapterSummaryMaterialRefs: ["summary.high", "summary.mid", "summary.low"],
  };
  const referenceIndex: PressureChapterBeatReferenceIndexV1 = {
    materials: [
      { materialRef: "material.public.entry", visibility: "PUBLIC", authorizedSeatIds: [] },
      { materialRef: "material.public.close", visibility: "PUBLIC", authorizedSeatIds: [] },
      { materialRef: "material.private.a", visibility: "SEAT_PRIVATE", authorizedSeatIds: ["seat-a"] },
      { materialRef: "summary.high", visibility: "PUBLIC", authorizedSeatIds: [] },
      { materialRef: "summary.mid", visibility: "PUBLIC", authorizedSeatIds: [] },
      { materialRef: "summary.low", visibility: "PUBLIC", authorizedSeatIds: [] },
    ],
    decisions: [{
      decisionPointRef: "catalog.neutral",
      legalActionRefs: ["catalog.neutral#ACT_A", "catalog.neutral#ACT_B"],
    }],
  };
  return { authoring, bindings, referenceIndex };
}

function codeOf(fn: () => unknown, expected: string): void {
  assert.throws(fn, (error: unknown) => {
    assert.equal(typeof error, "object");
    assert.equal((error as { code?: string }).code, expected);
    return true;
  });
}

test("an arbitrary chapter compiles multiple ordered beats without an N1 constant", () => {
  const input = synthetic();
  const compiled = compilePressureChapterBeatAuthoringPackageV1(input);
  assert.equal(compiled.chapterId, "C42");
  assert.deepEqual(compiled.beats.map((beat) => beat.beatId), ["C42.B01", "C42.B02"]);
  assert.deepEqual(compiled.beats[0]!.legalActionRefs, [
    "catalog.neutral#ACT_A",
    "catalog.neutral#ACT_B",
  ]);
  assert.equal(compiled.beats[0]!.sourceMaterials[1]!.visibility, "SEAT_PRIVATE");
  assert.equal(Object.isFrozen(compiled), true);
  assert.match(compiled.packageHash, /^[A-F0-9]{64}$/u);
});

test("duplicate beat and decision refs fail closed", () => {
  const duplicateBeat = synthetic();
  duplicateBeat.authoring.beats[1]!.beatId = duplicateBeat.authoring.beats[0]!.beatId;
  codeOf(() => compilePressureChapterBeatAuthoringPackageV1(duplicateBeat), ERROR.BEAT_DUPLICATE);

  const duplicateDecision = synthetic();
  duplicateDecision.authoring.beats[1]!.decisionContractRef =
    duplicateDecision.authoring.beats[0]!.decisionContractRef;
  codeOf(
    () => compilePressureChapterBeatAuthoringPackageV1(duplicateDecision),
    ERROR.DECISION_CONTRACT_DUPLICATE,
  );
});

test("ordinal gaps, broken successors and unreachable beats fail closed", () => {
  const gap = synthetic();
  gap.authoring.beats[1]!.ordinal = 3;
  codeOf(() => compilePressureChapterBeatAuthoringPackageV1(gap), ERROR.ORDINAL_GAP);

  const missing = synthetic();
  missing.authoring.beats[0]!.successorBeatIds = ["C42.MISSING"];
  codeOf(() => compilePressureChapterBeatAuthoringPackageV1(missing), ERROR.SUCCESSOR_MISSING);

  const unreachable = synthetic();
  unreachable.authoring.beats[0]!.closesChapter = true;
  unreachable.authoring.beats[0]!.successorBeatIds = [];
  codeOf(() => compilePressureChapterBeatAuthoringPackageV1(unreachable), ERROR.UNREACHABLE);
});

test("backward edges and invalid terminal topology fail closed", () => {
  const backward = synthetic();
  backward.authoring.beats[1]!.closesChapter = false;
  backward.authoring.beats[1]!.successorBeatIds = ["C42.B01"];
  codeOf(
    () => compilePressureChapterBeatAuthoringPackageV1(backward),
    ERROR.SUCCESSOR_NOT_FORWARD,
  );

  const terminalWithSuccessor = synthetic();
  terminalWithSuccessor.authoring.beats[0]!.closesChapter = true;
  codeOf(
    () => compilePressureChapterBeatAuthoringPackageV1(terminalWithSuccessor),
    ERROR.TERMINAL_HAS_SUCCESSOR,
  );

  const noTerminal = synthetic();
  noTerminal.authoring.beats[1]!.closesChapter = false;
  codeOf(
    () => compilePressureChapterBeatAuthoringPackageV1(noTerminal),
    ERROR.NON_TERMINAL_WITHOUT_SUCCESSOR,
  );
});

test("missing material, missing Catalog decision and illegal visibility fail closed", () => {
  const missingMaterial = synthetic();
  missingMaterial.authoring.beats[0]!.sourceMaterialRefs = ["material.missing"];
  codeOf(
    () => compilePressureChapterBeatAuthoringPackageV1(missingMaterial),
    ERROR.REFERENCE_MISSING,
  );

  const missingDecision = synthetic();
  missingDecision.bindings.decisionContracts[0]!.catalogDecisionPointRef = "catalog.missing";
  codeOf(
    () => compilePressureChapterBeatAuthoringPackageV1(missingDecision),
    ERROR.REFERENCE_MISSING,
  );

  const visibility = synthetic();
  visibility.referenceIndex.materials[2]!.authorizedSeatIds = [];
  codeOf(
    () => compilePressureChapterBeatAuthoringPackageV1(visibility),
    ERROR.VISIBILITY_INVALID,
  );
});

test("binding successor and chapter-ending strategy must match the authoring graph", () => {
  const mismatch = synthetic();
  mismatch.bindings.decisionContracts[0]!.advanceCondition.successorDecisionContractRefs = [];
  codeOf(
    () => compilePressureChapterBeatAuthoringPackageV1(mismatch),
    ERROR.BINDING_MISMATCH,
  );
  const wrongTerminal = synthetic();
  wrongTerminal.bindings.decisionContracts[1]!.advanceCondition.kind =
    "AUTHORITY_NEXT_DECISION_PIN";
  codeOf(
    () => compilePressureChapterBeatAuthoringPackageV1(wrongTerminal),
    ERROR.BINDING_MISMATCH,
  );
});

test("registered N1 is READY, has eight causal beats, six seat lenses and all 24 NPC reactions", () => {
  const source = loadSangtianPressureChapterBeatAuthoringSourceV1("N1");
  const compiled = source.package;
  assert.equal(compiled.contentStatus, "READY_FOR_IMPORT");
  assert.equal(compiled.beats.length, 8);
  assert.deepEqual(compiled.beats.map((beat) => beat.ordinal), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(compiled.beats.filter((beat) => beat.actionPhase === "PREPARE").length, 4);
  assert.equal(compiled.beats.filter((beat) => beat.actionPhase === "COMMIT").length, 4);
  assert.equal(compiled.beats.at(-1)?.closesChapter, true);
  assert.deepEqual(compiled.chapterSummary.outcomeFrameRefs, {
    HIGH: "chapterSummaryFrames.high",
    MID: "chapterSummaryFrames.mid",
    LOW: "chapterSummaryFrames.low",
  });
  assert.equal(compiled.chapterSummary.nextChapterId, "N2");

  const materialRefs = new Set(source.referenceIndex.materials.map((item) => item.materialRef));
  const seats = [...materialRefs].filter((ref) => ref.endsWith(".opening") && ref.startsWith("seatLenses."));
  const npcs = [...materialRefs].filter((ref) => /^npcReactions\.\d{2}$/u.test(ref));
  assert.equal(seats.length, 6);
  assert.equal(npcs.length, 24);
  const referenced = new Set([
    ...compiled.beats.flatMap((beat) => beat.sourceMaterialRefs),
    ...compiled.chapterSummary.materialRefs.map((item) => item.materialRef),
  ]);
  assert.equal(npcs.every((ref) => referenced.has(ref)), true);
  assert.equal(seats.every((ref) => referenced.has(ref)), true);
  assert.equal(compiled.beats.every((beat) =>
    beat.legalActionRefs.every((ref) => ref.startsWith("N1.weir_crisis#"))), true);
});
