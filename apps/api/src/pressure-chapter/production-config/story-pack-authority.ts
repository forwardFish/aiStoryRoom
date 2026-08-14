import type { SeatIdV1 } from "@ai-story/shared";
import type { CompilePressureViewerStoryPackInputV1 } from "./viewer-story-pack-input";
import { storyScoped } from "./story-pack-scope";
import { storyFail, storyText, storyUnique } from "./story-pack-validate";

export function compileStoryPackAuthorityV1(
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
  viewerSeatId: SeatIdV1,
) {
  const facts = storyScoped(input.facts, viewerSeatId, "facts", (item, index) => ({
    factRef: storyText(item.factRef, `facts[${index}].factRef`),
    text: storyText(item.text, `facts[${index}].text`),
    source: item.source,
  }));
  const metrics = storyScoped(input.metrics, viewerSeatId, "metrics", (item, index) => ({
    metricRef: storyText(item.metricRef, `metrics[${index}].metricRef`),
    label: storyText(item.label, `metrics[${index}].label`),
    displayValue: storyText(item.displayValue, `metrics[${index}].displayValue`),
  }));
  storyUnique(facts.map((item) => item.factRef), "facts.factRef");
  storyUnique(metrics.map((item) => item.metricRef), "metrics.metricRef");
  const knownRefs = new Set([
    ...facts.map((item) => item.factRef),
    ...metrics.map((item) => item.metricRef),
  ]);
  const allowedClaims = storyScoped(
    input.allowedClaims,
    viewerSeatId,
    "allowedClaims",
    (item, index) => {
      const refId = storyText(item.refId, `allowedClaims[${index}].refId`);
      if (!knownRefs.has(refId)) storyFail("REFERENCE", `allowedClaims[${index}].refId`, refId);
      return {
        kind: item.kind,
        refId,
        statement: storyText(item.statement, `allowedClaims[${index}].statement`),
        required: Boolean(item.required),
      };
    },
  );
  return { stateAfterHash: input.stateAfterHash, facts, metrics, allowedClaims };
}
