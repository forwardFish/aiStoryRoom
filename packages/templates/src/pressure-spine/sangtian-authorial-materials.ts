import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { canonicalJson, sha256Bytes } from "./canonical";
import type {
  PressureActionCatalogReferenceV1,
  PressureAuthorialMaterialReferenceV1,
} from "./beat-authoring";
import { PressureSpineValidationError } from "./errors";

export interface LoadedSangtianAuthorialContentV1 {
  content: Readonly<Record<string, unknown>>;
  sourceBinding: Readonly<Record<string, unknown>>;
}

export function loadSangtianAuthorialContentV1(
  configRoot: string,
  manifestPath: string,
): LoadedSangtianAuthorialContentV1 {
  const manifest = record(json(safePath(configRoot, manifestPath)), "authorialManifest");
  exactKeys(manifest, [
    "schemaVersion", "contentSchemaVersion", "nodeId", "sourceBinding", "sourceArtifactSha256",
    "assembledContentSha256", "publicMainlinePath", "seatLensPaths",
    "npcReactionPaths", "chapterSummaryFramesPath",
  ], "authorialManifest");
  if (manifest.schemaVersion !== "pressure_chapter_authorial_content_manifest_v1") {
    invalid("authorialManifest.schemaVersion", "UNSUPPORTED");
  }
  if (manifest.contentSchemaVersion !== "sangtian_n1_authorial_content_v1") {
    invalid("authorialManifest.contentSchemaVersion", "UNSUPPORTED");
  }
  const nodeId = text(manifest.nodeId, "authorialManifest.nodeId");
  const sourceBinding = record(manifest.sourceBinding, "authorialManifest.sourceBinding");
  sha256(manifest.sourceArtifactSha256, "authorialManifest.sourceArtifactSha256");
  const expectedAssembledHash = sha256(
    manifest.assembledContentSha256,
    "authorialManifest.assembledContentSha256",
  );
  const manifestDirectory = relativeToConfig(manifestPath);
  const publicFile = record(json(safePath(configRoot, resolveRelative(
    manifestDirectory,
    text(manifest.publicMainlinePath, "authorialManifest.publicMainlinePath"),
  ))), "authorialPublic");
  const publicMainline = record(publicFile.publicMainline, "authorialPublic.publicMainline");

  const seatLensPaths = record(manifest.seatLensPaths, "authorialManifest.seatLensPaths");
  const seatLenses = Object.entries(seatLensPaths)
    .map(([seatId, filePath]) => {
      const file = record(json(safePath(configRoot, resolveRelative(
        manifestDirectory,
        text(filePath, `authorialManifest.seatLensPaths.${seatId}`),
      ))), `authorialSeat.${seatId}`);
      const lens = record(file.seatLens, `authorialSeat.${seatId}.seatLens`);
      if (lens.seatId !== seatId) invalid(`authorialSeat.${seatId}.seatLens.seatId`, "MISMATCH");
      return lens;
    });

  const npcReactionPaths = record(
    manifest.npcReactionPaths,
    "authorialManifest.npcReactionPaths",
  );
  const phaseOrder = ["AFTER_PREPARE", "BEFORE_COMMIT", "SETTLEMENT"];
  const npcReactions = phaseOrder.flatMap((phase) => {
    const filePath = text(
      npcReactionPaths[phase],
      `authorialManifest.npcReactionPaths.${phase}`,
    );
    const file = record(json(safePath(configRoot, resolveRelative(
      manifestDirectory,
      filePath,
    ))), `authorialNpc.${phase}`);
    if (!Array.isArray(file.npcReactions)) invalid(`authorialNpc.${phase}.npcReactions`, "ARRAY");
    return file.npcReactions.map((item, index) => {
      const reaction = record(item, `authorialNpc.${phase}.npcReactions[${index}]`);
      if (reaction.phase !== phase) invalid(`authorialNpc.${phase}.npcReactions[${index}].phase`, "MISMATCH");
      return reaction;
    });
  });
  const summaryFile = record(json(safePath(configRoot, resolveRelative(
    manifestDirectory,
    text(manifest.chapterSummaryFramesPath, "authorialManifest.chapterSummaryFramesPath"),
  ))), "authorialSummary");
  const chapterSummaryFrames = record(
    summaryFile.chapterSummaryFrames,
    "authorialSummary.chapterSummaryFrames",
  );
  const content = {
    schemaVersion: "sangtian_n1_authorial_content_v1",
    nodeId,
    sourceBinding: structuredClone(sourceBinding),
    publicMainline: structuredClone(publicMainline),
    seatLenses: structuredClone(seatLenses),
    npcReactions: structuredClone(npcReactions),
    chapterSummaryFrames: structuredClone(chapterSummaryFrames),
  };
  const actualAssembledHash = sha256Bytes(canonicalJson(content));
  if (actualAssembledHash !== expectedAssembledHash) {
    invalid("authorialManifest.assembledContentSha256", `EXPECTED_${actualAssembledHash}`);
  }
  return Object.freeze({
    content: deepFreeze(content),
    sourceBinding: deepFreeze(structuredClone(sourceBinding)),
  });
}

export function assertSangtianAuthorialSourceBindingV1(input: Readonly<{
  configRoot: string;
  sourceBinding: Readonly<Record<string, unknown>>;
  sourceBindingPaths: Record<string, string>;
}>): void {
  for (const [hashField, relativePath] of Object.entries(input.sourceBindingPaths)) {
    const expectedHash = sha256(input.sourceBinding[hashField], `sourceBinding.${hashField}`);
    const actualHash = sha256Bytes(readFileSync(safePath(input.configRoot, relativePath)));
    if (actualHash !== expectedHash) invalid(`sourceBinding.${hashField}`, `EXPECTED_${actualHash}`);
  }
}

export function compileSangtianMaterialReferencesV1(
  authorialContent: Record<string, unknown>,
): PressureAuthorialMaterialReferenceV1[] {
  const result: PressureAuthorialMaterialReferenceV1[] = [];
  collectMaterialLeaves(
    record(authorialContent.publicMainline, "authorialContent.publicMainline"),
    "publicMainline",
    "PUBLIC",
    [],
    result,
  );
  if (!Array.isArray(authorialContent.seatLenses) || authorialContent.seatLenses.length === 0) {
    invalid("authorialContent.seatLenses", "NON_EMPTY_ARRAY");
  }
  const seatIds = new Set<string>();
  authorialContent.seatLenses.forEach((value, index) => {
    const lens = record(value, `authorialContent.seatLenses[${index}]`);
    const seatId = text(lens.seatId, `authorialContent.seatLenses[${index}].seatId`);
    if (seatIds.has(seatId)) invalid(`authorialContent.seatLenses[${index}].seatId`, "DUPLICATE");
    seatIds.add(seatId);
    for (const [key, child] of Object.entries(lens)) {
      if (["seatId", "actorId"].includes(key)) continue;
      collectMaterialLeaves(child, `seatLenses.${seatId}.${key}`, "SEAT_PRIVATE", [seatId], result);
    }
  });
  if (!Array.isArray(authorialContent.npcReactions)) invalid("authorialContent.npcReactions", "ARRAY");
  authorialContent.npcReactions.forEach((value, index) => {
    const reaction = record(value, `authorialContent.npcReactions[${index}]`);
    const knownBy = strings(reaction.knownBy, `authorialContent.npcReactions[${index}].knownBy`);
    if (knownBy.length === 0 || knownBy.some((seatId) => !seatIds.has(seatId))) {
      invalid(`authorialContent.npcReactions[${index}].knownBy`, "UNKNOWN_OR_EMPTY_SEAT");
    }
    assertMaterialBody(reaction, `authorialContent.npcReactions[${index}]`);
    result.push({
      materialRef: `npcReactions.${String(index + 1).padStart(2, "0")}`,
      visibility: "SEAT_PRIVATE",
      authorizedSeatIds: [...knownBy].sort(compareText),
    });
  });
  collectMaterialLeaves(
    record(authorialContent.chapterSummaryFrames, "authorialContent.chapterSummaryFrames"),
    "chapterSummaryFrames",
    "PUBLIC",
    [],
    result,
  );
  const seen = new Set<string>();
  for (const material of result) {
    if (seen.has(material.materialRef)) invalid(`material.${material.materialRef}`, "DUPLICATE");
    seen.add(material.materialRef);
  }
  return result.sort((left, right) => compareText(left.materialRef, right.materialRef));
}

export function compileSangtianActionCatalogReferencesV1(
  actionCatalog: unknown,
  chapterId: string,
): PressureActionCatalogReferenceV1[] {
  const catalog = record(actionCatalog, "actionCatalog");
  if (!Array.isArray(catalog.chapters)) invalid("actionCatalog.chapters", "ARRAY");
  const chapter = catalog.chapters
    .map((value, index) => record(value, `actionCatalog.chapters[${index}]`))
    .find((value) => value.chapterId === chapterId);
  if (!chapter) invalid("actionCatalog.chapters", `MISSING_${chapterId}`);
  if (!Array.isArray(chapter.decisions) || chapter.decisions.length === 0) {
    invalid(`actionCatalog.${chapterId}.decisions`, "NON_EMPTY_ARRAY");
  }
  return chapter.decisions.map((value, index) => {
    const decision = record(value, `actionCatalog.${chapterId}.decisions[${index}]`);
    const decisionPointRef = text(
      decision.decisionPointKey,
      `actionCatalog.${chapterId}.decisions[${index}].decisionPointKey`,
    );
    if (!Array.isArray(decision.actions) || decision.actions.length === 0) {
      invalid(`actionCatalog.${decisionPointRef}.actions`, "NON_EMPTY_ARRAY");
    }
    const legalActionRefs = decision.actions.map((actionValue, actionIndex) => {
      const action = record(actionValue, `actionCatalog.${decisionPointRef}.actions[${actionIndex}]`);
      return `${decisionPointRef}#${text(action.actionType, `actionCatalog.${decisionPointRef}.actions[${actionIndex}].actionType`)}`;
    });
    return { decisionPointRef, legalActionRefs };
  });
}

export function readSangtianAuthoringJsonV1(configRoot: string, path: string): unknown {
  return json(safePath(configRoot, path));
}

function collectMaterialLeaves(
  value: unknown,
  materialRef: string,
  visibility: PressureAuthorialMaterialReferenceV1["visibility"],
  authorizedSeatIds: string[],
  output: PressureAuthorialMaterialReferenceV1[],
): void {
  const item = record(value, `authorialContent.${materialRef}`);
  if (isMaterialBody(item)) {
    assertMaterialBody(item, `authorialContent.${materialRef}`);
    output.push({ materialRef, visibility, authorizedSeatIds: [...authorizedSeatIds].sort(compareText) });
    return;
  }
  const entries = Object.entries(item);
  if (entries.length === 0) invalid(`authorialContent.${materialRef}`, "EMPTY_GROUP");
  for (const [key, child] of entries) {
    collectMaterialLeaves(child, `${materialRef}.${key}`, visibility, authorizedSeatIds, output);
  }
}

function isMaterialBody(value: Record<string, unknown>): boolean {
  return typeof value.text === "string" || typeof value.literaryClosing === "string";
}

function assertMaterialBody(value: Record<string, unknown>, path: string): void {
  if (!isMaterialBody(value)) invalid(path, "MATERIAL_TEXT_REQUIRED");
  if (value.factRefs !== undefined) strings(value.factRefs, `${path}.factRefs`);
}

function relativeToConfig(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "." : path.slice(0, index);
}

function resolveRelative(directory: string, path: string): string {
  return directory === "." ? path : `${directory}/${path}`;
}

function safePath(configRoot: string, path: string): string {
  const target = resolve(configRoot, path);
  const allowedRoot = resolve(configRoot, "..");
  const fromAllowedRoot = relative(allowedRoot, target);
  if (fromAllowedRoot.startsWith("..") || isAbsolute(fromAllowedRoot)) {
    invalid("authorial.path", "OUTSIDE_CONFIG_ROOT");
  }
  return target;
}

function json(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new PressureSpineValidationError("CONTENT_JSON_INVALID", path, String(error));
  }
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

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(path, "ARRAY");
  const result = value.map((item, index) => text(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) invalid(path, "DUPLICATE");
  return result;
}

function sha256(value: unknown, path: string): string {
  const normalized = text(value, path).toUpperCase();
  if (!/^[A-F0-9]{64}$/u.test(normalized)) invalid(path, "SHA256");
  return normalized;
}

function invalid(path: string, detail: string): never {
  throw new PressureSpineValidationError(
    "PRESSURE_CHAPTER_BEAT_AUTHORING_SOURCE_INVALID",
    path,
    detail,
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
