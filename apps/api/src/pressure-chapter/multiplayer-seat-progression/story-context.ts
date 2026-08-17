import type { SeatIdV1 } from "@ai-story/shared";
import {
  loadSangtianPressureChapterBeatAuthoringSourceV1,
} from "@ai-story/templates";

export interface MultiplayerSeatBeatStoryContextV1 {
  schemaVersion: "pressure_multiplayer_seat_beat_story_context_v1";
  beatId: string;
  title: string;
  storyPurpose: string;
  authorialMaterials: Array<{
    materialRef: string;
    title: string;
    text: string;
    stopCondition: string | null;
    requiredFactRefs: string[];
    supportedByAuthority: boolean;
  }>;
}

/**
 * Compiles authorial guidance for one viewer and one Beat. Materials that need
 * unresolved fact refs are excluded: prose guidance may shape the scene but
 * can never manufacture an intermediate Multiplayer result.
 */
export function compileMultiplayerSeatBeatStoryContextV1(input: Readonly<{
  chapterId: string;
  beatId: string;
  viewerSeatId: SeatIdV1;
  availableFactRefs?: readonly string[];
}>): Readonly<MultiplayerSeatBeatStoryContextV1> {
  const source = loadSangtianPressureChapterBeatAuthoringSourceV1(input.chapterId);
  const beat = source.package.beats.find((candidate) => candidate.beatId === input.beatId);
  if (!beat) throw new Error(`PRESSURE_MULTIPLAYER_STORY_BEAT_NOT_FOUND:${input.beatId}`);
  const availableFactRefs = new Set(input.availableFactRefs ?? []);
  const alternativeParents = detectAlternativeMaterialParents(
    beat.sourceMaterials.map((material) => material.materialRef),
  );
  const authorialMaterials = beat.sourceMaterials
    .filter((material) => visibleToViewer(material, input.viewerSeatId))
    .filter((material) => !alternativeParents.has(parentRef(material.materialRef)))
    .map((material) => resolveMaterial(source.authorialContent, material.materialRef))
    .filter((material): material is NonNullable<typeof material> => material !== null)
    .slice(0, 8)
    .map(({ factRefs, ...material }) => ({
      ...material,
      requiredFactRefs: [...factRefs],
      supportedByAuthority: factRefs.every((factRef) => (
        factRef.startsWith("obj.") || availableFactRefs.has(factRef)
      )),
    }));
  return Object.freeze({
    schemaVersion: "pressure_multiplayer_seat_beat_story_context_v1",
    beatId: beat.beatId,
    title: beat.title,
    storyPurpose: beat.storyPurpose,
    authorialMaterials,
  });
}

function detectAlternativeMaterialParents(materialRefs: readonly string[]): Set<string> {
  const childrenByParent = new Map<string, Set<string>>();
  for (const materialRef of materialRefs) {
    const segments = materialRef.split(".");
    const child = segments.at(-1) ?? "";
    if (/^\d+$/u.test(child)) continue;
    const parent = parentRef(materialRef);
    const children = childrenByParent.get(parent) ?? new Set<string>();
    children.add(child);
    childrenByParent.set(parent, children);
  }
  return new Set(
    [...childrenByParent.entries()]
      .filter(([, children]) => children.size >= 3)
      .map(([parent]) => parent),
  );
}

function parentRef(materialRef: string): string {
  const index = materialRef.lastIndexOf(".");
  return index < 0 ? "" : materialRef.slice(0, index);
}

function visibleToViewer(
  material: Readonly<{
    visibility: "PUBLIC" | "SEAT_PRIVATE" | "SYSTEM_ONLY";
    authorizedSeatIds: readonly string[];
  }>,
  viewerSeatId: SeatIdV1,
): boolean {
  if (material.visibility === "PUBLIC") return true;
  if (material.visibility === "SYSTEM_ONLY") return false;
  return material.authorizedSeatIds.includes(viewerSeatId)
    || material.authorizedSeatIds.includes(`seat.${viewerSeatId}`);
}

function resolveMaterial(
  content: Readonly<Record<string, unknown>>,
  materialRef: string,
): {
  materialRef: string;
  title: string;
  text: string;
  factRefs: string[];
  stopCondition: string | null;
} | null {
  const segments = materialRef.split(".");
  let value: unknown;
  if (segments[0] === "seatLenses" && segments[1] === "seat") {
    const seatId = `seat.${segments[2] ?? ""}`;
    const lenses = Array.isArray(content.seatLenses) ? content.seatLenses : [];
    value = lenses.find((candidate) => (
      isRecord(candidate) && candidate.seatId === seatId
    ));
    value = walk(value, segments.slice(3));
  } else if (segments[0] === "npcReactions") {
    const reactions = Array.isArray(content.npcReactions) ? content.npcReactions : [];
    const ordinal = Number(segments[1]);
    value = Number.isSafeInteger(ordinal) && ordinal > 0
      ? reactions[ordinal - 1]
      : null;
  } else {
    value = walk(content, segments);
  }
  if (!isRecord(value)) return null;
  const text = textValue(value.text) || textValue(value.literaryClosing);
  if (!text) return null;
  return {
    materialRef,
    title: textValue(value.title) || textValue(value.sceneTitle) || materialRef,
    text,
    factRefs: Array.isArray(value.factRefs)
      ? value.factRefs.filter((item): item is string => typeof item === "string" && !!item.trim())
      : [],
    stopCondition: textValue(value.stopCondition) || null,
  };
}

function walk(source: unknown, segments: readonly string[]): unknown {
  let current = source;
  for (const segment of segments) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
