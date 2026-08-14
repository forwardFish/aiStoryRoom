import { canonicalJson, sha256Bytes } from "./canonical";
import {
  PRESSURE_CHAPTER_BEAT_AUTHORING_ERROR_CODES_V1 as ERROR,
  type PressureChapterBeatAuthoringPackageV1,
  type ResolvedPressureChapterBeatV1,
} from "./beat-authoring-contracts";
import {
  failPressureChapterBeatAuthoringV1 as fail,
  freezePressureBeatValueV1 as deepFreeze,
  validatePressureChapterBeatAuthoringV1,
  validatePressureChapterBeatBindingsV1,
  validatePressureChapterBeatReferenceIndexV1,
} from "./beat-authoring-validation";

export * from "./beat-authoring-contracts";
export * from "./beat-authoring-validation";

/**
 * Generic, side-effect-free compiler for authoring data. It validates shape,
 * graph topology, visibility and all external references before producing a
 * deterministic ordered package. It never reads runtime state or adjudicates
 * an action.
 */
export function compilePressureChapterBeatAuthoringPackageV1(input: Readonly<{
  authoring: unknown;
  bindings: unknown;
  referenceIndex: unknown;
}>): Readonly<PressureChapterBeatAuthoringPackageV1> {
  const authoring = validatePressureChapterBeatAuthoringV1(input.authoring);
  const bindings = validatePressureChapterBeatBindingsV1(input.bindings);
  const referenceIndex = validatePressureChapterBeatReferenceIndexV1(input.referenceIndex);
  if (bindings.chapterId !== authoring.chapterId) {
    fail(ERROR.BINDING_MISMATCH, "bindings.chapterId", `EXPECTED_${authoring.chapterId}`);
  }

  const materialsByRef = new Map(referenceIndex.materials.map((item) => [
    item.materialRef,
    item,
  ]));
  const decisionsByRef = new Map(referenceIndex.decisions.map((item) => [
    item.decisionPointRef,
    item,
  ]));
  const bindingsByRef = new Map(bindings.decisionContracts.map((item) => [
    item.decisionContractRef,
    item,
  ]));
  const beatsById = new Map(authoring.beats.map((beat) => [beat.beatId, beat]));
  if (
    bindingsByRef.size !== authoring.beats.length
    || bindings.decisionContracts.length !== authoring.beats.length
  ) {
    fail(ERROR.BINDING_MISMATCH, "bindings.decisionContracts", "EXACTLY_ONE_PER_BEAT");
  }

  const beats = authoring.beats.map((beat) => {
    const binding = bindingsByRef.get(beat.decisionContractRef);
    if (!binding) {
      fail(ERROR.BINDING_MISMATCH, `beats.${beat.beatId}.decisionContractRef`, beat.decisionContractRef);
    }
    const decision = decisionsByRef.get(binding.catalogDecisionPointRef);
    if (!decision) {
      fail(
        ERROR.REFERENCE_MISSING,
        `bindings.${binding.decisionContractRef}.catalogDecisionPointRef`,
        binding.catalogDecisionPointRef,
      );
    }
    const expectedSuccessorContracts = beat.successorBeatIds.map((beatId) => {
      const successor = beatsById.get(beatId);
      if (!successor) fail(ERROR.SUCCESSOR_MISSING, `beats.${beat.beatId}.successorBeatIds`, beatId);
      return successor.decisionContractRef;
    }).sort(compareText);
    const actualSuccessorContracts = [...binding.advanceCondition.successorDecisionContractRefs]
      .sort(compareText);
    if (JSON.stringify(expectedSuccessorContracts) !== JSON.stringify(actualSuccessorContracts)) {
      fail(
        ERROR.BINDING_MISMATCH,
        `bindings.${binding.decisionContractRef}.advanceCondition.successorDecisionContractRefs`,
        `EXPECTED_${expectedSuccessorContracts.join(",")}`,
      );
    }
    const expectedKind = beat.closesChapter
      ? "CHAPTER_SUMMARY_READY"
      : "AUTHORITY_NEXT_DECISION_PIN";
    if (binding.advanceCondition.kind !== expectedKind) {
      fail(
        ERROR.BINDING_MISMATCH,
        `bindings.${binding.decisionContractRef}.advanceCondition.kind`,
        `EXPECTED_${expectedKind}`,
      );
    }
    const sourceMaterials = beat.sourceMaterialRefs.map((materialRef) => {
      const material = materialsByRef.get(materialRef);
      if (!material) fail(ERROR.REFERENCE_MISSING, `beats.${beat.beatId}.sourceMaterialRefs`, materialRef);
      return material;
    });
    return {
      ...structuredClone(beat),
      catalogDecisionPointRef: binding.catalogDecisionPointRef,
      actionPhase: binding.actionPhase,
      pressure: binding.pressure,
      advanceCondition: structuredClone(binding.advanceCondition),
      legalActionRefs: [...decision.legalActionRefs],
      sourceMaterials: sourceMaterials.map((item) => structuredClone(item)),
    } satisfies ResolvedPressureChapterBeatV1;
  });

  const summaryRefs = [
    authoring.chapterSummary.outcomeFrameRefs.HIGH,
    authoring.chapterSummary.outcomeFrameRefs.MID,
    authoring.chapterSummary.outcomeFrameRefs.LOW,
    ...bindings.chapterSummaryMaterialRefs,
  ];
  const summaryMaterials = [...new Set(summaryRefs)].map((materialRef) => {
    const material = materialsByRef.get(materialRef);
    if (!material) fail(ERROR.REFERENCE_MISSING, "chapterSummary.materialRefs", materialRef);
    return structuredClone(material);
  });
  const packageWithoutHash = {
    schemaVersion: "pressure_chapter_beat_authoring_package_v1" as const,
    contentStatus: authoring.contentStatus,
    chapterId: authoring.chapterId,
    title: authoring.title,
    entryBeatId: authoring.entryBeatId,
    beats,
    chapterSummary: {
      ...structuredClone(authoring.chapterSummary),
      materialRefs: summaryMaterials,
    },
  };
  return deepFreeze({
    ...packageWithoutHash,
    packageHash: sha256Bytes(canonicalJson(packageWithoutHash)),
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
