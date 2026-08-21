import { resolve } from "node:path";
import {
  compilePressureChapterBeatAuthoringPackageV1,
  type PressureActionCatalogReferenceV1,
  type PressureAuthorialMaterialReferenceV1,
  type PressureChapterBeatAuthoringPackageV1,
} from "./beat-authoring";
import { PressureSpineValidationError } from "./errors";
import {
  assertSangtianAuthorialSourceBindingV1,
  compileSangtianActionCatalogReferencesV1,
  compileSangtianMaterialReferencesV1,
  loadSangtianAuthorialContentV1,
  readSangtianAuthoringJsonV1,
} from "./sangtian-authorial-materials";

const CONFIG_ROOT = resolve(__dirname, "../../config/sangtian/pressure-chapter-v1");
const REGISTRY_PATH = "chapter-beat-authoring-registry-v1.json";
const ACTION_CATALOG_PATH = "release/action-presentation-catalog.json";
const CONTENT_PATH = "content.json";

export interface SangtianPressureBeatAuthoringSourceV1 {
  package: Readonly<PressureChapterBeatAuthoringPackageV1>;
  authorialContent: Readonly<Record<string, unknown>>;
  referenceIndex: Readonly<{
    materials: readonly PressureAuthorialMaterialReferenceV1[];
    decisions: readonly PressureActionCatalogReferenceV1[];
  }>;
}

type RegistryEntry = {
  authoringPath: string;
  bindingsPath: string;
  authorialContentManifestPath: string;
  sourceBindingPaths: Record<string, string>;
};

const cache = new Map<string, SangtianPressureBeatAuthoringSourceV1>();
let registeredChapterIdsCache: ReadonlySet<string> | null = null;

/**
 * Returns whether a chapter has the complete authored multi-Beat package
 * required by the independent per-seat flow. Invalid registered content still
 * fails closed when loaded; this only distinguishes an absent registration.
 */
export function isSangtianPressureChapterBeatAuthoringRegisteredV1(
  chapterId: string,
): boolean {
  const normalizedChapterId = text(chapterId, "chapterId");
  if (!registeredChapterIdsCache) {
    const registry = record(
      readSangtianAuthoringJsonV1(CONFIG_ROOT, REGISTRY_PATH),
      "registry",
    );
    if (registry.schemaVersion !== "pressure_chapter_beat_authoring_registry_v1") {
      invalid("registry.schemaVersion", "UNSUPPORTED");
    }
    const chapters = record(registry.chapters, "registry.chapters");
    registeredChapterIdsCache = new Set(Object.keys(chapters).map((id) => text(
      id,
      "registry.chapters.chapterId",
    )));
  }
  return registeredChapterIdsCache.has(normalizedChapterId)
    || dynamicChapterRecord(normalizedChapterId) !== null;
}

/**
 * Content-driven loader. Chapter registration selects files; the TypeScript
 * path has no chapter-specific branch and never reads runtime or database state.
 */
export function loadSangtianPressureChapterBeatAuthoringV1(
  chapterId: string,
): Readonly<PressureChapterBeatAuthoringPackageV1> {
  return loadSangtianPressureChapterBeatAuthoringSourceV1(chapterId).package;
}

export function loadSangtianPressureChapterBeatAuthoringSourceV1(
  chapterId: string,
): Readonly<SangtianPressureBeatAuthoringSourceV1> {
  const normalizedChapterId = text(chapterId, "chapterId");
  const cached = cache.get(normalizedChapterId);
  if (cached) return cached;
  const registry = record(
    readSangtianAuthoringJsonV1(CONFIG_ROOT, REGISTRY_PATH),
    "registry",
  );
  if (registry.schemaVersion !== "pressure_chapter_beat_authoring_registry_v1") {
    invalid("registry.schemaVersion", "UNSUPPORTED");
  }
  const chapters = record(registry.chapters, "registry.chapters");
  if (!(normalizedChapterId in chapters)) {
    const dynamic = compileDynamicChapterSourceV1(normalizedChapterId);
    cache.set(normalizedChapterId, dynamic);
    return dynamic;
  }
  const entry = registryEntry(chapters[normalizedChapterId], normalizedChapterId);
  const authoring = readSangtianAuthoringJsonV1(CONFIG_ROOT, entry.authoringPath);
  const bindings = readSangtianAuthoringJsonV1(CONFIG_ROOT, entry.bindingsPath);
  const loadedAuthorial = loadSangtianAuthorialContentV1(
    CONFIG_ROOT,
    entry.authorialContentManifestPath,
  );
  const authorialContent = loadedAuthorial.content;
  if (authorialContent.nodeId !== normalizedChapterId) {
    invalid("authorialContent.nodeId", `EXPECTED_${normalizedChapterId}`);
  }
  assertSangtianAuthorialSourceBindingV1({
    configRoot: CONFIG_ROOT,
    sourceBinding: loadedAuthorial.sourceBinding,
    sourceBindingPaths: entry.sourceBindingPaths,
  });
  const referenceIndex = Object.freeze({
    materials: Object.freeze(compileSangtianMaterialReferencesV1(authorialContent)),
    decisions: Object.freeze(compileSangtianActionCatalogReferencesV1(
      readSangtianAuthoringJsonV1(CONFIG_ROOT, ACTION_CATALOG_PATH),
      normalizedChapterId,
    )),
  });
  const source = Object.freeze({
    package: compilePressureChapterBeatAuthoringPackageV1({
      authoring,
      bindings,
      referenceIndex,
    }),
    authorialContent,
    referenceIndex,
  });
  cache.set(normalizedChapterId, source);
  return source;
}

export function clearSangtianPressureBeatAuthoringCacheForTestsV1(): void {
  cache.clear();
  registeredChapterIdsCache = null;
}

function compileDynamicChapterSourceV1(
  chapterId: string,
): SangtianPressureBeatAuthoringSourceV1 {
  const chapter = dynamicChapterRecord(chapterId);
  if (!chapter) invalid(`content.chapters.${chapterId}`, "NOT_REGISTERED");
  const decisions = arrayRecords(chapter.decisionPoints, `content.chapters.${chapterId}.decisionPoints`)
    .sort((left, right) => integer(left.ordinal, "decision.ordinal") - integer(right.ordinal, "decision.ordinal"));
  if (decisions.length === 0) invalid(`content.chapters.${chapterId}.decisionPoints`, "NON_EMPTY");
  const chapterOrder = dynamicChapters();
  const chapterIndex = chapterOrder.findIndex((item) => item.chapterId === chapterId);
  const nextChapterId = chapterOrder[chapterIndex + 1]?.chapterId ?? null;
  const beatIds = decisions.map((_, index) => `${chapterId}.B${String(index + 1).padStart(2, "0")}`);
  const materialRefs = beatIds.map((_, index) => `publicMainline.beatScenes.B${String(index + 1).padStart(2, "0")}`);
  const summaryRefs = {
    HIGH: "chapterSummaryFrames.high",
    MID: "chapterSummaryFrames.mid",
    LOW: "chapterSummaryFrames.low",
  };
  const title = text(chapter.title, `content.chapters.${chapterId}.title`);
  const pressure = text(chapter.pressure, `content.chapters.${chapterId}.pressure`);
  const authorialContent = {
    schemaVersion: "sangtian_dynamic_authorial_content_v1",
    nodeId: chapterId,
    publicMainline: {
      beatScenes: Object.fromEntries(decisions.map((decision, index) => {
        const purpose = text(decision.purpose, `content.chapters.${chapterId}.decisionPoints.${index}.purpose`);
        const key = `B${String(index + 1).padStart(2, "0")}`;
        return [key, {
          title: purpose,
          text: `${title}。${pressure}\n${purpose}`,
          factRefs: [],
          stopCondition: "停在当前玩家必须亲自回应的具体压力上，不得替玩家作出决定。",
        }];
      })),
    },
    seatLenses: [],
    npcReactions: [],
    chapterSummaryFrames: {
      high: { title: `${title}·上`, text: `${title}以较强控制收束。`, factRefs: [] },
      mid: { title: `${title}·中`, text: `${title}在妥协中收束。`, factRefs: [] },
      low: { title: `${title}·下`, text: `${title}留下更重压力。`, factRefs: [] },
    },
  };
  const authoring = {
    schemaVersion: "pressure_chapter_beat_authoring_v1",
    contentStatus: "REFERENCE",
    chapterId,
    title,
    entryBeatId: beatIds[0],
    beats: decisions.map((decision, index) => {
      const decisionPointKey = text(
        decision.decisionPointKey,
        `content.chapters.${chapterId}.decisionPoints.${index}.decisionPointKey`,
      );
      const closesChapter = index === decisions.length - 1;
      return {
        beatId: beatIds[index],
        ordinal: index + 1,
        phase: closesChapter ? "COMMIT" : index === 0 ? "OPENING" : "DEVELOPMENT",
        title: text(decision.purpose, `content.chapters.${chapterId}.decisionPoints.${index}.purpose`),
        storyPurpose: text(decision.purpose, `content.chapters.${chapterId}.decisionPoints.${index}.purpose`),
        sourceMaterialRefs: [materialRefs[index]],
        decisionContractRef: `${decisionPointKey}.dynamic`,
        successorBeatIds: closesChapter ? [] : [beatIds[index + 1]],
        closesChapter,
      };
    }),
    chapterSummary: { outcomeFrameRefs: summaryRefs, nextChapterId },
  };
  const bindings = {
    schemaVersion: "pressure_chapter_beat_bindings_v1",
    chapterId,
    decisionContracts: decisions.map((decision, index) => {
      const decisionPointKey = text(
        decision.decisionPointKey,
        `content.chapters.${chapterId}.decisionPoints.${index}.decisionPointKey`,
      );
      const closesChapter = index === decisions.length - 1;
      return {
        decisionContractRef: `${decisionPointKey}.dynamic`,
        catalogDecisionPointRef: decisionPointKey,
        actionPhase: closesChapter ? "COMMIT" : "PREPARE",
        pressure: text(decision.purpose, `content.chapters.${chapterId}.decisionPoints.${index}.purpose`),
        advanceCondition: {
          kind: closesChapter ? "CHAPTER_SUMMARY_READY" : "AUTHORITY_NEXT_DECISION_PIN",
          successorDecisionContractRefs: closesChapter
            ? []
            : [`${text(decisions[index + 1]?.decisionPointKey, "successor.decisionPointKey")}.dynamic`],
        },
      };
    }),
    chapterSummaryMaterialRefs: Object.values(summaryRefs),
  };
  const referenceIndex = Object.freeze({
    materials: Object.freeze([
      ...materialRefs.map((materialRef) => ({
        materialRef,
        visibility: "PUBLIC" as const,
        authorizedSeatIds: [],
      })),
      ...Object.values(summaryRefs).map((materialRef) => ({
        materialRef,
        visibility: "PUBLIC" as const,
        authorizedSeatIds: [],
      })),
    ]),
    decisions: Object.freeze(compileSangtianActionCatalogReferencesV1(
      readSangtianAuthoringJsonV1(CONFIG_ROOT, ACTION_CATALOG_PATH),
      chapterId,
    )),
  });
  return Object.freeze({
    package: compilePressureChapterBeatAuthoringPackageV1({
      authoring,
      bindings,
      referenceIndex,
    }),
    authorialContent: Object.freeze(structuredClone(authorialContent)),
    referenceIndex,
  });
}

function dynamicChapterRecord(chapterId: string): Record<string, unknown> | null {
  return dynamicChapters().find((chapter) => chapter.chapterId === chapterId) ?? null;
}

function dynamicChapters(): Record<string, unknown>[] {
  const content = record(
    readSangtianAuthoringJsonV1(CONFIG_ROOT, CONTENT_PATH),
    "content",
  );
  return arrayRecords(content.chapters, "content.chapters");
}

function arrayRecords(value: unknown, path: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) invalid(path, "ARRAY");
  return value.map((item, index) => record(item, `${path}.${index}`));
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) invalid(path, "SAFE_INTEGER");
  return value as number;
}

function registryEntry(value: unknown, chapterId: string): RegistryEntry {
  const entry = record(value, `registry.chapters.${chapterId}`);
  exactKeys(entry, [
    "authoringPath",
    "bindingsPath",
    "authorialContentManifestPath",
    "sourceBindingPaths",
  ], `registry.chapters.${chapterId}`);
  const sourceBindingPaths = record(
    entry.sourceBindingPaths,
    `registry.chapters.${chapterId}.sourceBindingPaths`,
  );
  if (Object.keys(sourceBindingPaths).length === 0) {
    invalid(`registry.chapters.${chapterId}.sourceBindingPaths`, "NON_EMPTY");
  }
  return {
    authoringPath: text(entry.authoringPath, `registry.chapters.${chapterId}.authoringPath`),
    bindingsPath: text(entry.bindingsPath, `registry.chapters.${chapterId}.bindingsPath`),
    authorialContentManifestPath: text(
      entry.authorialContentManifestPath,
      `registry.chapters.${chapterId}.authorialContentManifestPath`,
    ),
    sourceBindingPaths: Object.fromEntries(Object.entries(sourceBindingPaths).map(([key, path]) => [
      text(key, `registry.chapters.${chapterId}.sourceBindingPaths.key`),
      text(path, `registry.chapters.${chapterId}.sourceBindingPaths.${key}`),
    ])),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "OBJECT");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) invalid(`${path}.${unknown}`, "UNKNOWN_FIELD");
  const missing = keys.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "MISSING_FIELD");
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path, "NON_EMPTY_STRING");
  return value.trim();
}

function invalid(path: string, detail: string): never {
  throw new PressureSpineValidationError(
    "PRESSURE_CHAPTER_BEAT_AUTHORING_SOURCE_INVALID",
    path,
    detail,
  );
}
