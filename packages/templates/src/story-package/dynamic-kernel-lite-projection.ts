import { stableSha256 } from "../runtime-contract/kernel-selector-lite.js";
import {
  forcePackageForDynamicWorkingSets,
  type DynamicPartOneRuntimeWorkingSet,
} from "./dynamic-kernel-lite-runtime.js";
import type {
  PartOneAffordanceTemplate,
  PartOneContinuationDecisionTemplate,
  PartOneRuntimeAsset,
  PartOneRuntimePackage,
  PartOneSectionContract,
  PartOneState,
} from "./part-one-runtime-types.js";

/**
 * The provisional/scaffold pass exists only to obtain an authoritative
 * post-action state. It must not fail because a later unrelated Kernel is
 * malformed or because a legacy section has no authored next Floor entry.
 * Primary projections are isolated to the exact current Kernel; continuation
 * projections retain their current entry and receive one deterministic
 * successor so the frozen engine can finish its internal scaffold Settlement.
 */
export function forcePackageForProvisionalSettlement(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  workingSet: DynamicPartOneRuntimeWorkingSet,
): PartOneRuntimePackage {
  let projected = forcePackageForDynamicWorkingSets(
    pkg,
    [{ state, workingSet }],
  );
  const section = projected.sections.find(
    (item) => item.sectionId === state.sectionId,
  );
  if (!section) {
    throw new Error(`PART_ONE_RUNTIME_SECTION_MISSING:${state.sectionId}`);
  }
  const continuation = isContinuation(workingSet);
  const currentIndex = continuation
    ? Math.max(
      0,
      Number(state.sectionTurnNumber || 0)
        - section.activeDecisionKernelIds.length,
    )
    : Math.max(0, Number(state.sectionTurnNumber || 0));
  const successorIndex = continuation ? currentIndex + 1 : currentIndex;
  const floorId = workingSet.nextDecisionPressure?.sourceFloorAssetId
    || section.floorObligationIds[0];
  const floor = selectOrCreateFloor(projected, section, floorId);
  const successor = continuationTemplate(
    state.sectionId,
    floor.assetId,
    successorIndex,
    workingSet,
  );
  projected = upsertContinuation(
    projected,
    section,
    floor,
    successorIndex,
    successor,
    !continuation,
    workingSet.decisionPoint.decisionKernelId,
  );
  return projected;
}

function upsertContinuation(
  pkg: PartOneRuntimePackage,
  section: PartOneSectionContract,
  floor: PartOneRuntimeAsset,
  index: number,
  continuation: PartOneContinuationDecisionTemplate,
  restrictPrimary: boolean,
  currentKernelId: string,
) {
  const projected = structuredClone(pkg);
  const existing = Array.isArray(floor.payload.continuationDecisions)
    ? structuredClone(floor.payload.continuationDecisions)
    : [];
  while (existing.length <= index) {
    const fillIndex = existing.length;
    existing.push({
      ...structuredClone(continuation),
      continuationDecisionId: fillIndex === index
        ? continuation.continuationDecisionId
        : `CONT-${stableSha256({
          sectionId: section.sectionId,
          floorId: floor.assetId,
          index: fillIndex,
          kernelId: currentKernelId,
        }).slice(0, 20)}`,
    });
  }
  existing[index] = continuation;

  projected.sections = projected.sections.map((candidate) => (
    candidate.sectionId === section.sectionId
      ? {
        ...candidate,
        ...(restrictPrimary
          ? { activeDecisionKernelIds: [currentKernelId] }
          : {}),
        floorObligationIds: [floor.assetId],
      }
      : candidate
  ));
  const hasFloor = projected.assets.some(
    (asset) => asset.assetId === floor.assetId,
  );
  projected.assets = projected.assets.map((asset) => (
    asset.assetId === floor.assetId
      ? {
        ...asset,
        payload: {
          ...asset.payload,
          continuationDecisions: existing,
        },
      }
      : asset
  ));
  if (!hasFloor) {
    projected.assets.push({
      ...floor,
      payload: {
        ...floor.payload,
        continuationDecisions: existing,
      },
    });
  }
  return projected;
}

function continuationTemplate(
  sectionId: string,
  floorId: string,
  index: number,
  workingSet: DynamicPartOneRuntimeWorkingSet,
): PartOneContinuationDecisionTemplate {
  return {
    continuationDecisionId: `CONT-${stableSha256({
      sectionId,
      floorId,
      index,
      kernelId: workingSet.decisionPoint.decisionKernelId,
      affordanceIds: workingSet.decisionAffordances.map(
        (item) => item.affordanceTemplateId,
      ),
    }).slice(0, 20)}`,
    basedOnDecisionKernelId: workingSet.decisionPoint.decisionKernelId,
    worldPressure: {
      pressureId: `PRESSURE-${stableSha256({
        sectionId,
        floorId,
        index,
      }).slice(0, 20)}`,
      summary: `The unresolved obligation ${floorId} remains active.`,
      sourceFloorAssetId: floorId,
    },
    options: workingSet.decisionAffordances.map(toTemplate),
  };
}

function toTemplate(
  affordance: DynamicPartOneRuntimeWorkingSet["decisionAffordances"][number],
): PartOneAffordanceTemplate {
  const {
    decisionKernelId: _decisionKernelId,
    decisionPointId: _decisionPointId,
    target: _target,
    ...template
  } = affordance;
  return structuredClone(template);
}

function selectOrCreateFloor(
  pkg: PartOneRuntimePackage,
  section: PartOneSectionContract,
  floorId: string | undefined,
): PartOneRuntimeAsset {
  if (floorId) {
    const existing = pkg.assets.find((asset) => asset.assetId === floorId);
    if (existing) return existing;
  }
  const id = floorId
    || `FLOOR-${stableSha256(section.sectionId).slice(0, 20)}`;
  return {
    schemaVersion: "runtime-story-asset-v1",
    assetId: id,
    assetType: "SECTION_FLOOR_OBLIGATION",
    partIds: [section.partId],
    sectionIds: [section.sectionId],
    requirementIds: [...section.requiredRequirementIds],
    decisionKernelIds: [...section.activeDecisionKernelIds],
    causalArcIds: [...section.activeCausalArcIds],
    actorRefs: [...section.foregroundActorRefs],
    stateDependencies: [],
    visibilityRules: [],
    sourceClaimIds: [],
    adaptationDecisionIds: [],
    retrievalTags: ["SECTION_FLOOR_OBLIGATION"],
    payload: {},
  };
}

function isContinuation(workingSet: DynamicPartOneRuntimeWorkingSet) {
  return workingSet.decisionPoint.decisionPointId
    !== workingSet.decisionPoint.decisionKernelId;
}
