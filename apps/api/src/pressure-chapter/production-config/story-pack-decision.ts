import type { CompilePressureViewerStoryPackInputV1 } from "./viewer-story-pack-input";
import { storyFail, storyText, storyUnique } from "./story-pack-validate";

export function compileStoryPackDecisionV1(
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
) {
  const legalActionRefs = storyUnique(
    input.nextDecision.legalActionRefs,
    "nextDecision.legalActionRefs",
  );
  const catalogActions = input.nextDecision.catalogActions.map((item, index) => ({
    actionRef: storyText(item.actionRef, `catalogActions[${index}].actionRef`),
    actionType: storyText(item.actionType, `catalogActions[${index}].actionType`),
    label: storyText(item.label, `catalogActions[${index}].label`),
    description: storyText(item.description, `catalogActions[${index}].description`),
  }));
  const legal = [...legalActionRefs].sort();
  const catalog = catalogActions.map((item) => item.actionRef).sort();
  if (JSON.stringify(legal) !== JSON.stringify(catalog)) {
    storyFail("CATALOG", "nextDecision", "LEGAL_ACTION_BINDING");
  }
  return {
    decisionContractRef: storyText(
      input.nextDecision.decisionContractRef,
      "nextDecision.decisionContractRef",
    ),
    decisionPointRef: storyText(
      input.nextDecision.decisionPointRef,
      "nextDecision.decisionPointRef",
    ),
    legalActionRefs,
    catalogActions,
  };
}
