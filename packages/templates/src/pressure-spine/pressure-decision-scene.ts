import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  type SeatIdV1,
} from "@ai-story/shared";

export type SangtianPressureSceneRecordV1 = {
  sceneId?: unknown;
  nodeId?: unknown;
  sceneType?: unknown;
  title?: unknown;
  text?: unknown;
  knownBy?: unknown;
  visibility?: unknown;
};

export type SangtianPressureDecisionSceneV1 = Readonly<{
  schemaVersion: "sangtian_pressure_decision_scene_v1";
  chapterId: string;
  seatId: SeatIdV1;
  title: string;
  sceneIds: readonly [string, string, string];
  paragraphs: readonly [string, string, string];
  postBeatFrame: Readonly<{
    sceneId: string;
    title: string;
    text: string;
  }>;
  text: string;
}>;

/**
 * Pure, chapter-neutral selector for the four authored scene roles used by a
 * decision story pack. It never reads runtime state or supplies settlement facts.
 */
export function compileSangtianPressureDecisionSceneV1(
  scenes: readonly SangtianPressureSceneRecordV1[],
  chapterId: string,
  seatId: SeatIdV1,
): SangtianPressureDecisionSceneV1 {
  const normalizedChapterId = requiredText(chapterId, "chapterId");
  if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId)) {
    throw invalid(normalizedChapterId, `seatId:${seatId}`);
  }
  const chapterScenes = scenes.filter(
    (scene) => scene.nodeId === normalizedChapterId,
  );
  const publicOpening = requiredScene(
    chapterScenes,
    (scene) => scene.sceneType === "OPENING" && scene.visibility === "PUBLIC",
    normalizedChapterId,
    "publicOpening",
  );
  const privateOpening = requiredScene(
    chapterScenes,
    (scene) => scene.sceneType === "PRIVATE_OPENING"
      && textArray(scene.knownBy).includes(`seat.${seatId}`),
    normalizedChapterId,
    `privateOpening.${seatId}`,
  );
  const urgentPressure = requiredScene(
    chapterScenes,
    (scene) => scene.sceneType === "NPC_URGENT",
    normalizedChapterId,
    "urgentPressure",
  );
  const postBeatFrame = requiredScene(
    chapterScenes,
    (scene) => scene.sceneType === "AFTER_PREPARE_COMMON",
    normalizedChapterId,
    "postBeatFrame",
  );
  const selected = [publicOpening, privateOpening, urgentPressure] as const;
  const sceneIds = selected.map((scene, index) =>
    requiredText(scene.sceneId, `scenes[${index}].sceneId`)) as [string, string, string];
  const paragraphs = selected.map((scene, index) =>
    requiredText(scene.text, `scenes[${index}].text`)) as [string, string, string];

  return Object.freeze({
    schemaVersion: "sangtian_pressure_decision_scene_v1",
    chapterId: normalizedChapterId,
    seatId,
    title: requiredText(publicOpening.title, "publicOpening.title"),
    sceneIds: Object.freeze(sceneIds),
    paragraphs: Object.freeze(paragraphs),
    postBeatFrame: Object.freeze({
      sceneId: requiredText(postBeatFrame.sceneId, "postBeatFrame.sceneId"),
      title: requiredText(postBeatFrame.title, "postBeatFrame.title"),
      text: requiredText(postBeatFrame.text, "postBeatFrame.text"),
    }),
    text: paragraphs.join("\n\n"),
  });
}

function requiredScene(
  scenes: readonly SangtianPressureSceneRecordV1[],
  predicate: (scene: SangtianPressureSceneRecordV1) => boolean,
  chapterId: string,
  field: string,
): SangtianPressureSceneRecordV1 {
  const matches = scenes.filter(predicate);
  if (matches.length !== 1) throw invalid(chapterId, `${field}:${matches.length}`);
  return matches[0]!;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`SANGTIAN_PRESSURE_SCENE_INVALID:${field}`);
  }
  return value.trim();
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function invalid(chapterId: string, field: string): Error {
  return new Error(`SANGTIAN_PRESSURE_SCENE_INVALID:${chapterId}:${field}`);
}
