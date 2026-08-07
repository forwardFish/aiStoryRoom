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
  PartOneState,
} from "./part-one-runtime-types.js";

/**
 * The provisional pass exists only to obtain the authoritative post-action
 * state. It must not fail because a later unrelated Kernel is malformed or a
 * legacy section has no authored Floor entry. Restrict the cloned section to
 * the exact current Primary and provide one deterministic Floor exit. The
 * final pass receives the real next WorkingSet and remains the committed
 * decision surface.
 */
export function forcePackageForProvisionalSettlement(
  pkg: PartOneRuntimePackage,
  state: PartOneState,
  workingSet: DynamicPartOneRuntimeWorkingSet,
): PartOneRuntimePackage {
  const projected = forcePackageForDynamicWorkingSets(
    pkg,
    [{ state, workingSet }],
  );
  if (
    workingSet.decisionPoint.decisionPointId
    !== workingSet.decisionPoint.decisionKernelId
  ) {
    return projected;
  }

  const section = projected.sections.find(
    (item) => item.sectionId === state.sectionId,
  );
  if (!section) {
    throw new Error(`PART_ONE_RUNTIME_SECTION_MISSING:${state.sectionId}`);
  }
  const floor = selectOrCreateFloor(projected, section.floorObligationIds[0]);
  const index = Math.max(0, Number(state.sectionTurnNumber || 0));
  const continuation = continuationTemplate(
    state.sectionId,
    floor.assetId,
    index,
    workingSet,
  );
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
          sectionId: state.sectionId,
          floorId: floor.assetId,
          index: fillIndex,
          kernelId: workingSet.decisionPoint.decisionKernelId,
        }).slice(0, 20)}`,
    });
  }
  existing[index] = continuation;

  projected.sections = projected.sections.map((candidate) => (
    candidate.sectionId === state.sectionId
      ? {
        ...candidate,
        activeDecisionKernelIds: [
          workingSet.decisionPoint.decisionKernelId,
        ],
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
  floorId: string | undefined,
): PartOneRuntimeAsset {
  if (floorId) {
    const existing = pkg.assets.find((asset) => asset.assetId === floorId);
    if (existing) return existing;
  }
  const sectionId = pkg.sections.find((section) => (
    section.floorObligationIds.includes(String(floorId || ""))
  ))?.sectionId || "UNSCOPED";
  const id = floorId || `FLOOR-${stableSha256(sectionId).slice(0, 20)}`;
  return {
    schemaVersion: "runtime-story-asset-v1",
    assetId: id,
    assetType: "SECTION_FLOOR_OBLIGATION",
    partIds: [pkg.partId],
    sectionIds: sectionId === "UNSCOPED" ? [] : [sectionId],
    requirementIds: [],
    decisionKernelIds: [],
    causalArcIds: [],
    actorRefs: [],
    stateDependencies: [],
    visibilityRules: [],
    sourceClaimIds: [],
    adaptationDecisionIds: [],
    retrievalTags: ["SECTION_FLOOR_OBLIGATION"],
    payload: {},
  };
}
