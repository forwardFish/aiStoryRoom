import { ConfigDrivenEndingDetailError, deepFreeze } from "./ending-detail-common-v1.mjs";

export function enrichResolvedAxes(axisDefinitions, resolvedAxes) {
  const axisById = new Map(axisDefinitions.map((axis) => [axis.axisId, axis]));
  return Object.freeze(resolvedAxes.map((resolved) => {
    const axis = axisById.get(resolved.axisId);
    const outcome = axis?.outcomes.find((candidate) => candidate.outcomeId === resolved.outcomeId);
    if (!axis || !outcome) {
      throw new ConfigDrivenEndingDetailError(
        "ENDGAME_DETAIL_AXIS_UNKNOWN",
        "Resolved axis cannot be enriched from the frozen package.",
        resolved
      );
    }
    return deepFreeze({
      axisId: axis.axisId,
      outcomeId: outcome.outcomeId,
      title: outcome.title,
      summary: outcome.summary
    });
  }));
}

export function enforceMinimumVariation({ minimumVariation, slots, selectedFactIds, facts }) {
  for (const slotId of minimumVariation.requiredSlots) {
    if (!Array.isArray(slots[slotId]) || slots[slotId].length === 0) {
      throw new ConfigDrivenEndingDetailError(
        "ENDGAME_DETAIL_MINIMUM_REQUIRED_SLOT",
        "minimumVariation required slot is empty.",
        { slotId }
      );
    }
  }
  if (selectedFactIds.size < minimumVariation.minimumDistinctSourceFacts) {
    throw new ConfigDrivenEndingDetailError(
      "ENDGAME_DETAIL_MINIMUM_FACTS",
      "The blueprint does not use enough distinct committed facts.",
      { selected: selectedFactIds.size, required: minimumVariation.minimumDistinctSourceFacts }
    );
  }
  const selectedSet = new Set(selectedFactIds);
  const sourceActionIds = new Set(
    facts
      .filter((fact) => selectedSet.has(fact.factId) && fact.sourceActionId !== null)
      .map((fact) => fact.sourceActionId)
  );
  if (sourceActionIds.size < minimumVariation.minimumDistinctSourceActions) {
    throw new ConfigDrivenEndingDetailError(
      "ENDGAME_DETAIL_MINIMUM_ACTIONS",
      "The blueprint does not use enough distinct committed source actions.",
      { selected: sourceActionIds.size, required: minimumVariation.minimumDistinctSourceActions }
    );
  }
}

export function assertCompiledBlueprintEvidence(blueprint, facts) {
  const factIds = new Set(facts.map((fact) => fact.factId));
  const allowed = new Set(blueprint.allowedFactRefs);
  if (allowed.size !== blueprint.allowedFactRefs.length) {
    throw new ConfigDrivenEndingDetailError("ENDGAME_DETAIL_ALLOWED_FACT_DUPLICATE", "allowedFactRefs must be unique.");
  }
  for (const factId of allowed) {
    if (!factIds.has(factId)) {
      throw new ConfigDrivenEndingDetailError(
        "ENDGAME_DETAIL_ALLOWED_FACT_UNKNOWN",
        "Blueprint references a fact that was not committed and player-safe.",
        { factId }
      );
    }
  }
  for (const items of Object.values(blueprint.slots)) {
    for (const item of items) {
      for (const factId of item.evidenceRefs) {
        if (!allowed.has(factId)) {
          throw new ConfigDrivenEndingDetailError("ENDGAME_DETAIL_EVIDENCE_NOT_ALLOWED", "Slot evidence must be in allowedFactRefs.");
        }
      }
    }
  }
  for (const factId of blueprint.style?.evidenceRefs ?? []) {
    if (!allowed.has(factId)) throw new ConfigDrivenEndingDetailError("ENDGAME_DETAIL_STYLE_EVIDENCE_NOT_ALLOWED", "Style evidence must be allowed.");
  }
  for (const factId of blueprint.scene.anchorFactRefs) {
    if (!allowed.has(factId)) throw new ConfigDrivenEndingDetailError("ENDGAME_DETAIL_SCENE_EVIDENCE_NOT_ALLOWED", "Scene evidence must be allowed.");
  }
}
