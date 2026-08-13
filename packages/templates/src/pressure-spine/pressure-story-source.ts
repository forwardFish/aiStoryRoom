import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SeatIdV1 } from "@ai-story/shared";
import {
  compileSangtianPressureDecisionSceneV1,
  type SangtianPressureDecisionSceneV1,
  type SangtianPressureSceneRecordV1,
} from "./pressure-decision-scene";
import { loadPressureSpinePackage } from "./loader";

const VERSION = "sangtian_pressure_v1_0";
const REGISTRY = resolve(__dirname, "../../config/sangtian/strategy-registry.json");

type JsonRecord = Record<string, unknown>;

export type SangtianPressureStorySourceV1 = Readonly<{
  schemaVersion: "sangtian_pressure_story_source_v1";
  chapterId: string;
  worldAndStyle: Readonly<{
    worldPressure: string;
    invariants: readonly string[];
    narrativeStyle: string;
  }>;
  currentScene: SangtianPressureDecisionSceneV1;
  playerIdentity: Readonly<{
    seatId: SeatIdV1;
    roleName: string;
    actorName: string;
    institutionalMission: string;
    coreQuestion: string;
    publicPower: string;
    hardLimit: string;
  }>;
  characterRules: Readonly<{
    privatePressure: string;
    ruleHint: string;
    dialogueSeeds: readonly string[];
  }>;
}>;

type AuthoredChapterV1 = Readonly<{
  seatContent: JsonRecord[];
  scenes: SangtianPressureSceneRecordV1[];
}>;

let cachedGlobal: Readonly<{
  root: string;
  spine: JsonRecord;
  seats: JsonRecord[];
  actors: JsonRecord[];
  style: string;
  nodeFiles: ReadonlyMap<string, Readonly<{ sceneFlow: string; seatContent: string }>>;
}> | null = null;
const cachedChapters = new Map<string, AuthoredChapterV1>();

/** Loads authored, hash-verified chapter material; runtime results are never read here. */
export function loadSangtianPressureStorySourceV1(
  chapterId: string,
  seatId: SeatIdV1,
): SangtianPressureStorySourceV1 {
  const global = authoredGlobal();
  const chapter = authoredChapter(chapterId, global);
  const externalSeatId = `seat.${seatId}`;
  const seat = unique(global.seats, (item) => item.seatId === externalSeatId, `seat.${seatId}`);
  const seatContent = unique(
    chapter.seatContent,
    (item) => item.seatId === externalSeatId && item.nodeId === chapterId,
    `seatContent.${chapterId}.${seatId}`,
  );
  const actorId = text(seatContent.currentActorId, `seatContent.${chapterId}.${seatId}.currentActorId`);
  const actor = unique(global.actors, (item) => item.actorId === actorId, `actor.${actorId}`);
  const node = unique(records(global.spine.nodes, "pressureSpine.nodes"), (item) => item.nodeId === chapterId, `pressureSpine.${chapterId}`);
  const dialogueSeeds = records(seatContent.dialogueSeeds, `seatContent.${chapterId}.${seatId}.dialogueSeeds`)
    .map((item, index) => `${dialogueOccasion(item.purpose, index)}：${text(item.text, `dialogueSeeds.${index}.text`)}`);

  return Object.freeze({
    schemaVersion: "sangtian_pressure_story_source_v1",
    chapterId,
    worldAndStyle: Object.freeze({
      worldPressure: text(node.pressure, `pressureSpine.${chapterId}.pressure`),
      invariants: Object.freeze(strings(global.spine.invariants, "pressureSpine.invariants")),
      narrativeStyle: global.style,
    }),
    currentScene: compileSangtianPressureDecisionSceneV1(chapter.scenes, chapterId, seatId),
    playerIdentity: Object.freeze({
      seatId,
      roleName: text(seat.displayName, `seat.${seatId}.displayName`),
      actorName: text(actor.name, `actor.${actorId}.name`),
      institutionalMission: text(seat.institutionalMission, `seat.${seatId}.institutionalMission`),
      coreQuestion: text(seat.coreQuestion, `seat.${seatId}.coreQuestion`),
      publicPower: text(seat.publicPower, `seat.${seatId}.publicPower`),
      hardLimit: text(seat.hardLimit, `seat.${seatId}.hardLimit`),
    }),
    characterRules: Object.freeze({
      privatePressure: text(seatContent.privatePressure, `seatContent.${chapterId}.${seatId}.privatePressure`),
      ruleHint: text(seatContent.ruleHint, `seatContent.${chapterId}.${seatId}.ruleHint`),
      dialogueSeeds: Object.freeze(dialogueSeeds),
    }),
  });
}

function dialogueOccasion(value: unknown, index: number): string {
  const purpose = text(value, `dialogueSeeds.${index}.purpose`);
  const labels: Record<string, string> = {
    PROBE_OR_FRAME: "冷静追问",
    BARGAIN_OR_THREAT: "对同级施压",
    HANDOFF_OR_COMMITMENT: "对下属下令",
    CONSULTATION: "与幕僚商议",
    ANGER_WITH_RESTRAINT: "动怒但不失身份",
    WIT_OR_FATIGUE: "调侃、讥讽或疲惫",
  };
  return labels[purpose] ?? purpose;
}

function authoredGlobal() {
  if (cachedGlobal) return cachedGlobal;
  const loaded = loadPressureSpinePackage(REGISTRY, VERSION);
  const root = loaded.artifactRoot;
  cachedGlobal = Object.freeze({
    root,
    spine: json(resolve(root, "source/global/pressure-spine.json")),
    seats: records(json(resolve(root, "source/global/seats.json")).seats, "seats"),
    actors: records(json(resolve(root, "source/global/actors.json")).actors, "actors"),
    style: readFileSync(resolve(root, "source/global/narrative-style.md"), "utf8").trim(),
    nodeFiles: new Map(loaded.runtimeIndex.nodes.map((node) => [
      node.nodeId,
      Object.freeze({ sceneFlow: node.files.sceneFlow, seatContent: node.files.seatContent }),
    ])),
  });
  return cachedGlobal;
}

function authoredChapter(chapterId: string, global: NonNullable<typeof cachedGlobal>): AuthoredChapterV1 {
  const cached = cachedChapters.get(chapterId);
  if (cached) return cached;
  const files = global.nodeFiles.get(chapterId);
  if (!files) throw invalid(`node.${chapterId}`);
  const sceneFlow = json(resolve(global.root, files.sceneFlow));
  const seatContent = json(resolve(global.root, files.seatContent));
  const chapter = Object.freeze({
    seatContent: records(seatContent.seats, `seatContent.${chapterId}`),
    scenes: records(sceneFlow.scenes, `sceneFlow.${chapterId}.scenes`) as SangtianPressureSceneRecordV1[],
  });
  cachedChapters.set(chapterId, chapter);
  return chapter;
}

function json(path: string): JsonRecord {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(path);
  return value as JsonRecord;
}

function records(value: unknown, path: string): JsonRecord[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw invalid(path);
  }
  return value as JsonRecord[];
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw invalid(path);
  return value.map((item, index) => text(item, `${path}.${index}`));
}

function unique(items: JsonRecord[], predicate: (item: JsonRecord) => boolean, path: string): JsonRecord {
  const matches = items.filter(predicate);
  if (matches.length !== 1) throw invalid(`${path}:${matches.length}`);
  return matches[0]!;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalid(path);
  return value.trim();
}

function invalid(path: string): Error {
  return new Error(`SANGTIAN_PRESSURE_STORY_SOURCE_INVALID:${path}`);
}
