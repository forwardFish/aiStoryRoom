import type { SeatIdV1 } from "@ai-story/shared";
import type { CompilePressureViewerStoryPackInputV1 } from "./viewer-story-pack-input";
import { storyVisible } from "./story-pack-scope";
import { storyFail, storyText, storyUnique } from "./story-pack-validate";

export function compileStoryPackAuthorialMaterialsV1(
  input: Readonly<CompilePressureViewerStoryPackInputV1>,
  viewerSeatId: SeatIdV1,
) {
  const allowedRefs = new Set(storyUnique(
    input.allowedAuthorialFactRefs,
    "allowedAuthorialFactRefs",
  ));
  const materials = input.authorialMaterials.map((item, index) => {
    const path = `authorialMaterials[${index}]`;
    storyVisible(item, viewerSeatId, path);
    const factRefs = storyUnique(item.factRefs, `${path}.factRefs`);
    for (const ref of factRefs) {
      if (!allowedRefs.has(ref)) storyFail("REFERENCE", `${path}.factRefs`, ref);
    }
    return {
      materialRef: storyText(item.materialRef, `${path}.materialRef`),
      title: storyText(item.title, `${path}.title`),
      text: storyText(item.text, `${path}.text`),
      factRefs,
      stopCondition: item.stopCondition === null
        ? null
        : storyText(item.stopCondition, `${path}.stopCondition`),
    };
  });
  if (materials.length === 0) storyFail("INVALID", "authorialMaterials", "NON_EMPTY");
  storyUnique(materials.map((item) => item.materialRef), "authorialMaterials.materialRef");
  return materials;
}
