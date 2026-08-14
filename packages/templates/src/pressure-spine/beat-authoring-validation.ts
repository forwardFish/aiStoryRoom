import { PressureSpineValidationError } from "./errors";
import {
  PRESSURE_AUTHORIAL_MATERIAL_VISIBILITIES_V1,
  PRESSURE_CHAPTER_ACTION_PHASES_V1,
  PRESSURE_CHAPTER_BEAT_AUTHORING_ERROR_CODES_V1 as ERROR,
  PRESSURE_CHAPTER_BEAT_PHASES_V1,
  type PressureActionCatalogReferenceV1,
  type PressureAuthorialMaterialReferenceV1,
  type PressureChapterBeatAuthoringBeatV1,
  type PressureChapterBeatAuthoringV1,
  type PressureChapterBeatBindingsV1,
  type PressureChapterBeatDecisionBindingV1,
  type PressureChapterBeatReferenceIndexV1,
} from "./beat-authoring-contracts";

export function validatePressureChapterBeatAuthoringV1(
  value: unknown,
): Readonly<PressureChapterBeatAuthoringV1> {
  const record = exactRecord(value, [
    "schemaVersion", "contentStatus", "chapterId", "title",
    "entryBeatId", "beats", "chapterSummary",
  ], "authoring");
  literal(record.schemaVersion, "pressure_chapter_beat_authoring_v1", "authoring.schemaVersion");
  const contentStatus = enumValue(record.contentStatus, [
    "REFERENCE", "READY_FOR_IMPORT",
  ] as const, "authoring.contentStatus");
  const chapterId = nonEmpty(record.chapterId, "authoring.chapterId");
  const title = nonEmpty(record.title, "authoring.title");
  const entryBeatId = nonEmpty(record.entryBeatId, "authoring.entryBeatId");
  if (!Array.isArray(record.beats) || record.beats.length < 2) {
    fail(ERROR.CONTRACT_INVALID, "authoring.beats", "MIN_TWO");
  }
  const beats = record.beats.map((item, index) => validateBeat(item, index));
  validateGraph(beats, entryBeatId);
  const summary = exactRecord(record.chapterSummary, [
    "outcomeFrameRefs", "nextChapterId",
  ], "authoring.chapterSummary");
  const frames = exactRecord(summary.outcomeFrameRefs, [
    "HIGH", "MID", "LOW",
  ], "authoring.chapterSummary.outcomeFrameRefs");
  const nextChapterId = summary.nextChapterId === null
    ? null
    : nonEmpty(summary.nextChapterId, "authoring.chapterSummary.nextChapterId");
  return deepFreeze({
    schemaVersion: "pressure_chapter_beat_authoring_v1",
    contentStatus,
    chapterId,
    title,
    entryBeatId,
    beats,
    chapterSummary: {
      outcomeFrameRefs: {
        HIGH: nonEmpty(frames.HIGH, "authoring.chapterSummary.outcomeFrameRefs.HIGH"),
        MID: nonEmpty(frames.MID, "authoring.chapterSummary.outcomeFrameRefs.MID"),
        LOW: nonEmpty(frames.LOW, "authoring.chapterSummary.outcomeFrameRefs.LOW"),
      },
      nextChapterId,
    },
  });
}

export function validatePressureChapterBeatBindingsV1(
  value: unknown,
): Readonly<PressureChapterBeatBindingsV1> {
  const record = exactRecord(value, [
    "schemaVersion", "chapterId", "decisionContracts", "chapterSummaryMaterialRefs",
  ], "bindings");
  literal(record.schemaVersion, "pressure_chapter_beat_bindings_v1", "bindings.schemaVersion");
  if (!Array.isArray(record.decisionContracts) || record.decisionContracts.length === 0) {
    fail(ERROR.CONTRACT_INVALID, "bindings.decisionContracts", "NON_EMPTY_ARRAY");
  }
  const seen = new Set<string>();
  const decisionContracts = record.decisionContracts.map((item, index) => {
    const path = `bindings.decisionContracts[${index}]`;
    const binding = exactRecord(item, [
      "decisionContractRef", "catalogDecisionPointRef", "actionPhase",
      "pressure", "advanceCondition",
    ], path);
    const decisionContractRef = nonEmpty(binding.decisionContractRef, `${path}.decisionContractRef`);
    if (seen.has(decisionContractRef)) {
      fail(ERROR.DECISION_CONTRACT_DUPLICATE, `${path}.decisionContractRef`, decisionContractRef);
    }
    seen.add(decisionContractRef);
    const advance = exactRecord(binding.advanceCondition, [
      "kind", "successorDecisionContractRefs",
    ], `${path}.advanceCondition`);
    return {
      decisionContractRef,
      catalogDecisionPointRef: nonEmpty(
        binding.catalogDecisionPointRef,
        `${path}.catalogDecisionPointRef`,
      ),
      actionPhase: enumValue(
        binding.actionPhase,
        PRESSURE_CHAPTER_ACTION_PHASES_V1,
        `${path}.actionPhase`,
      ),
      pressure: nonEmpty(binding.pressure, `${path}.pressure`),
      advanceCondition: {
        kind: enumValue(advance.kind, [
          "AUTHORITY_NEXT_DECISION_PIN", "CHAPTER_SUMMARY_READY",
        ] as const, `${path}.advanceCondition.kind`),
        successorDecisionContractRefs: uniqueStrings(
          advance.successorDecisionContractRefs,
          `${path}.advanceCondition.successorDecisionContractRefs`,
        ),
      },
    } satisfies PressureChapterBeatDecisionBindingV1;
  });
  return deepFreeze({
    schemaVersion: "pressure_chapter_beat_bindings_v1",
    chapterId: nonEmpty(record.chapterId, "bindings.chapterId"),
    decisionContracts,
    chapterSummaryMaterialRefs: uniqueStrings(
      record.chapterSummaryMaterialRefs,
      "bindings.chapterSummaryMaterialRefs",
    ),
  });
}

export function validatePressureChapterBeatReferenceIndexV1(
  value: unknown,
): Readonly<PressureChapterBeatReferenceIndexV1> {
  const record = exactRecord(value, ["materials", "decisions"], "referenceIndex");
  if (!Array.isArray(record.materials) || !Array.isArray(record.decisions)) {
    fail(ERROR.CONTRACT_INVALID, "referenceIndex", "ARRAYS_REQUIRED");
  }
  const materialRefs = new Set<string>();
  const materials = record.materials.map((item, index) => {
    const path = `referenceIndex.materials[${index}]`;
    const material = exactRecord(item, [
      "materialRef", "visibility", "authorizedSeatIds",
    ], path);
    const materialRef = nonEmpty(material.materialRef, `${path}.materialRef`);
    if (materialRefs.has(materialRef)) {
      fail(ERROR.CONTRACT_INVALID, `${path}.materialRef`, "DUPLICATE");
    }
    materialRefs.add(materialRef);
    const visibility = enumValue(
      material.visibility,
      PRESSURE_AUTHORIAL_MATERIAL_VISIBILITIES_V1,
      `${path}.visibility`,
    );
    const authorizedSeatIds = uniqueStrings(material.authorizedSeatIds, `${path}.authorizedSeatIds`);
    if (visibility === "PUBLIC" && authorizedSeatIds.length !== 0) {
      fail(ERROR.VISIBILITY_INVALID, `${path}.authorizedSeatIds`, "PUBLIC_MUST_BE_EMPTY");
    }
    if (visibility === "SEAT_PRIVATE" && authorizedSeatIds.length === 0) {
      fail(ERROR.VISIBILITY_INVALID, `${path}.authorizedSeatIds`, "PRIVATE_REQUIRES_SEAT");
    }
    if (visibility === "SYSTEM_ONLY" && authorizedSeatIds.length !== 0) {
      fail(ERROR.VISIBILITY_INVALID, `${path}.authorizedSeatIds`, "SYSTEM_MUST_BE_EMPTY");
    }
    return { materialRef, visibility, authorizedSeatIds } satisfies PressureAuthorialMaterialReferenceV1;
  });
  const decisionRefs = new Set<string>();
  const decisions = record.decisions.map((item, index) => {
    const path = `referenceIndex.decisions[${index}]`;
    const decision = exactRecord(item, ["decisionPointRef", "legalActionRefs"], path);
    const decisionPointRef = nonEmpty(decision.decisionPointRef, `${path}.decisionPointRef`);
    if (decisionRefs.has(decisionPointRef)) {
      fail(ERROR.CONTRACT_INVALID, `${path}.decisionPointRef`, "DUPLICATE");
    }
    decisionRefs.add(decisionPointRef);
    const legalActionRefs = uniqueStrings(decision.legalActionRefs, `${path}.legalActionRefs`);
    if (legalActionRefs.length === 0) {
      fail(ERROR.CONTRACT_INVALID, `${path}.legalActionRefs`, "NON_EMPTY_ARRAY");
    }
    return { decisionPointRef, legalActionRefs } satisfies PressureActionCatalogReferenceV1;
  });
  return deepFreeze({ materials, decisions });
}

function validateBeat(value: unknown, index: number): PressureChapterBeatAuthoringBeatV1 {
  const path = `authoring.beats[${index}]`;
  const record = exactRecord(value, [
    "beatId", "ordinal", "phase", "title", "storyPurpose",
    "sourceMaterialRefs", "decisionContractRef", "successorBeatIds", "closesChapter",
  ], path);
  const ordinal = integer(record.ordinal, `${path}.ordinal`);
  if (ordinal < 1) fail(ERROR.CONTRACT_INVALID, `${path}.ordinal`, "MIN_1");
  if (typeof record.closesChapter !== "boolean") {
    fail(ERROR.CONTRACT_INVALID, `${path}.closesChapter`, "BOOLEAN");
  }
  const sourceMaterialRefs = uniqueStrings(record.sourceMaterialRefs, `${path}.sourceMaterialRefs`);
  if (sourceMaterialRefs.length === 0) {
    fail(ERROR.CONTRACT_INVALID, `${path}.sourceMaterialRefs`, "NON_EMPTY_ARRAY");
  }
  return {
    beatId: nonEmpty(record.beatId, `${path}.beatId`),
    ordinal,
    phase: enumValue(record.phase, PRESSURE_CHAPTER_BEAT_PHASES_V1, `${path}.phase`),
    title: nonEmpty(record.title, `${path}.title`),
    storyPurpose: nonEmpty(record.storyPurpose, `${path}.storyPurpose`),
    sourceMaterialRefs,
    decisionContractRef: nonEmpty(record.decisionContractRef, `${path}.decisionContractRef`),
    successorBeatIds: uniqueStrings(record.successorBeatIds, `${path}.successorBeatIds`),
    closesChapter: record.closesChapter,
  };
}

function validateGraph(
  beats: readonly PressureChapterBeatAuthoringBeatV1[],
  entryBeatId: string,
): void {
  const ids = new Set<string>();
  const decisionRefs = new Set<string>();
  const ordinalMap = new Map<number, PressureChapterBeatAuthoringBeatV1>();
  for (const beat of beats) {
    if (ids.has(beat.beatId)) fail(ERROR.BEAT_DUPLICATE, "authoring.beats", beat.beatId);
    ids.add(beat.beatId);
    if (decisionRefs.has(beat.decisionContractRef)) {
      fail(ERROR.DECISION_CONTRACT_DUPLICATE, "authoring.beats", beat.decisionContractRef);
    }
    decisionRefs.add(beat.decisionContractRef);
    if (ordinalMap.has(beat.ordinal)) {
      fail(ERROR.ORDINAL_GAP, "authoring.beats", `DUPLICATE_${beat.ordinal}`);
    }
    ordinalMap.set(beat.ordinal, beat);
  }
  for (let ordinal = 1; ordinal <= beats.length; ordinal += 1) {
    if (!ordinalMap.has(ordinal)) fail(ERROR.ORDINAL_GAP, "authoring.beats", `MISSING_${ordinal}`);
  }
  const entry = beats.find((beat) => beat.beatId === entryBeatId);
  if (!entry) fail(ERROR.ENTRY_MISSING, "authoring.entryBeatId", entryBeatId);
  const byId = new Map(beats.map((beat) => [beat.beatId, beat]));
  let terminals = 0;
  for (const beat of beats) {
    if (beat.closesChapter) {
      terminals += 1;
      if (beat.successorBeatIds.length !== 0) {
        fail(ERROR.TERMINAL_HAS_SUCCESSOR, `authoring.beats.${beat.beatId}`, "SUCCESSOR_NOT_ALLOWED");
      }
    } else if (beat.successorBeatIds.length === 0) {
      fail(ERROR.NON_TERMINAL_WITHOUT_SUCCESSOR, `authoring.beats.${beat.beatId}`, "SUCCESSOR_REQUIRED");
    }
    for (const successorId of beat.successorBeatIds) {
      const successor = byId.get(successorId);
      if (!successor) fail(ERROR.SUCCESSOR_MISSING, `authoring.beats.${beat.beatId}`, successorId);
      if (successor.ordinal <= beat.ordinal) {
        fail(ERROR.SUCCESSOR_NOT_FORWARD, `authoring.beats.${beat.beatId}`, successorId);
      }
    }
  }
  if (terminals === 0) fail(ERROR.TERMINAL_MISSING, "authoring.beats", "AT_LEAST_ONE");
  const reachable = new Set<string>();
  const queue = [entryBeatId];
  while (queue.length > 0) {
    const beatId = queue.shift()!;
    if (reachable.has(beatId)) continue;
    reachable.add(beatId);
    const beat = byId.get(beatId);
    if (beat) queue.push(...beat.successorBeatIds);
  }
  const unreachable = beats.find((beat) => !reachable.has(beat.beatId));
  if (unreachable) fail(ERROR.UNREACHABLE, "authoring.beats", unreachable.beatId);
}

export function beatAuthoringExactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  return exactRecord(value, keys, path);
}

export function beatAuthoringNonEmpty(value: unknown, path: string): string {
  return nonEmpty(value, path);
}

export function beatAuthoringUniqueStrings(value: unknown, path: string): string[] {
  return uniqueStrings(value, path);
}

export function failPressureChapterBeatAuthoringV1(
  code: string,
  path: string,
  detail: string,
): never {
  return fail(code, path, detail);
}

export function freezePressureBeatValueV1<T>(value: T): Readonly<T> {
  return deepFreeze(value);
}

function exactRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(ERROR.CONTRACT_INVALID, path, "OBJECT");
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => !keys.includes(key));
  if (unknown) fail(ERROR.CONTRACT_INVALID, `${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in record));
  if (missing) fail(ERROR.CONTRACT_INVALID, `${path}.${missing}`, "MISSING_FIELD");
  return record;
}

function uniqueStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(ERROR.CONTRACT_INVALID, path, "ARRAY");
  const result = value.map((item, index) => nonEmpty(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) fail(ERROR.CONTRACT_INVALID, path, "DUPLICATE");
  return result;
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(ERROR.CONTRACT_INVALID, path, "NON_EMPTY_STRING");
  }
  return value.trim();
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(ERROR.CONTRACT_INVALID, path, "INTEGER");
  }
  return value;
}

function literal(value: unknown, expected: string, path: string): void {
  if (value !== expected) fail(ERROR.CONTRACT_INVALID, path, `EXPECTED_${expected}`);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(ERROR.CONTRACT_INVALID, path, `ENUM_${values.join("_")}`);
  }
  return value as T;
}

function fail(code: string, path: string, detail: string): never {
  throw new PressureSpineValidationError(code, path, detail);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
