import type { SeatIdV1 } from "@ai-story/shared";
import type { PressureViewerStoryAclV1 } from "./viewer-story-pack-values";
import { storyFail, storyUnique } from "./story-pack-validate";

export function storyVisible(
  value: PressureViewerStoryAclV1,
  viewerSeatId: SeatIdV1,
  path: string,
): void {
  storyUnique(value.authorizedSeatIds, `${path}.authorizedSeatIds`);
  if (value.visibility === "SYSTEM_ONLY") storyFail("SCOPE", `${path}.visibility`, "SYSTEM_ONLY");
  if (value.visibility === "PUBLIC") {
    if (value.authorizedSeatIds.length !== 0) {
      storyFail("SCOPE", `${path}.authorizedSeatIds`, "PUBLIC_ACL");
    }
    return;
  }
  if (!value.authorizedSeatIds.includes(viewerSeatId)) {
    storyFail("SCOPE", `${path}.authorizedSeatIds`, "OTHER_SEAT");
  }
}

export function storyScoped<T extends PressureViewerStoryAclV1, R>(
  items: readonly T[],
  viewerSeatId: SeatIdV1,
  path: string,
  map: (item: T, index: number) => R,
): R[] {
  return items.map((item, index) => {
    storyVisible(item, viewerSeatId, `${path}[${index}]`);
    return map(item, index);
  });
}
