import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CHAPTER_IDS_V1,
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  TRACK_IDS_V1,
  compareCanonicalText,
  hashWithoutField,
  isSha256,
  sha256Canonical,
  validateDeterministicPredicateV1,
  type ChapterIdV1,
  type SeatIdV1,
  type TrackIdV1,
} from "@ai-story/shared";
import {
  SANGTIAN_CONTENT_FINALE_POLICY_VERSION_V1,
  SANGTIAN_CONTENT_FINALE_RULE_SCHEMA_VERSION_V1,
  SANGTIAN_DISCLOSURE_RULE_REFS_V1,
  expectedSeatVerdictRuleRefsV1,
  expectedWorldOutcomeRuleRefsV1,
} from "../finale/content-rules";
import { compileSangtianDecisionPointDefinitionV1 } from "./decision-points";
import {
  SANGTIAN_CONTENT_ERROR_CODES_V1 as ERROR,
  failSangtianContentV1,
} from "./errors";
import type {
  CompiledSangtianChapterContentV1,
  LoadedSangtianPressureChapterPackageV1,
  SangtianChapterContentV1,
  SangtianChapterSettlementBranchV1,
  SangtianInitialEvidenceV1,
  SangtianInitialKnowledgeV1,
  SangtianInitialResponsibilityV1,
  SangtianObjectContentV1,
  SangtianPressureChapterContentV1,
  SangtianPressureChapterManifestV1,
  SangtianResourceContentV1,
  SangtianSeatContentV1,
  SangtianSettlementPredicateV1,
  SangtianTrackContentV1,
} from "./types";

type Raw = Record<string, unknown>;

export const SANGTIAN_PRESSURE_CHAPTER_PACKAGE_ROOT_V1 = path.resolve(
  __dirname,
  "../../../config/sangtian/pressure-chapter-v1",
);

export const FORBIDDEN_LEGACY_FIXED_WINDOW_FIELDS_V1 = Object.freeze([
  "actionBudget",
  "commitPerSeat",
  "fixedWindowCount",
  "phase",
  "preparePerSeat",
  "reactionPerSeat",
  "slot",
  "window",
  "windowCount",
] as const);

const MANIFEST_KEYS = [
  "schemaVersion",
  "packageId",
  "packageVersion",
  "runtimeProfile",
  "sourceCommitSha",
  "sourcePackageId",
  "sourcePackageVersion",
  "sourceStorySha256",
  "contentFile",
  "contentSha256",
  "forbiddenLegacyFields",
  "sourceTrace",
  "manifestSha256",
] as const;

export function loadSangtianPressureChapterPackageV1(
  packageRoot = SANGTIAN_PRESSURE_CHAPTER_PACKAGE_ROOT_V1,
): LoadedSangtianPressureChapterPackageV1 {
  const manifest = JSON.parse(readFileSync(path.resolve(packageRoot, "manifest.json"), "utf8"));
  const rawManifest = object(manifest, "manifest");
  if (rawManifest.contentFile !== "content.json") invalid("manifest.contentFile", "CONTENT_JSON");
  const content = JSON.parse(readFileSync(path.resolve(packageRoot, "content.json"), "utf8"));
  return validateSangtianPressureChapterPackageV1(manifest, content);
}

export function validateSangtianPressureChapterPackageV1(
  manifestValue: unknown,
  contentValue: unknown,
): LoadedSangtianPressureChapterPackageV1 {
  const manifest = validateManifest(manifestValue);
  const forbidden = findForbiddenField(contentValue, new Set(manifest.forbiddenLegacyFields), "content");
  if (forbidden) {
    failSangtianContentV1(ERROR.LEGACY_FIXED_WINDOW_FORBIDDEN, forbidden, "REMOVE_FIXED_WINDOW_CLOCK");
  }
  if (sha256Canonical(contentValue) !== manifest.contentSha256) {
    failSangtianContentV1(
      ERROR.PACKAGE_HASH_MISMATCH,
      "manifest.contentSha256",
      `EXPECTED_${sha256Canonical(contentValue)}`,
    );
  }
  const content = validateContent(contentValue, manifest);
  const chapters = content.chapters.map((chapter) => compileChapter(chapter, content));
  return deepFreeze({
    manifest: structuredClone(manifest),
    content: structuredClone(content),
    chapters,
  });
}

function validateManifest(value: unknown): SangtianPressureChapterManifestV1 {
  const manifest = object(value, "manifest");
  exact(manifest, MANIFEST_KEYS, "manifest");
  literal(manifest.schemaVersion, "sangtian_pressure_chapter_manifest_v1", "manifest.schemaVersion");
  literal(manifest.packageId, "sangtian_pressure_chapter_v1", "manifest.packageId");
  version(manifest.packageVersion, "manifest.packageVersion");
  literal(manifest.runtimeProfile, "SANGTIAN_CONTINUOUS_CHAPTER_V1", "manifest.runtimeProfile");
  hex(manifest.sourceCommitSha, 40, "manifest.sourceCommitSha");
  nonEmpty(manifest.sourcePackageId, "manifest.sourcePackageId");
  version(manifest.sourcePackageVersion, "manifest.sourcePackageVersion");
  sha(manifest.sourceStorySha256, "manifest.sourceStorySha256");
  literal(manifest.contentFile, "content.json", "manifest.contentFile");
  sha(manifest.contentSha256, "manifest.contentSha256");
  const forbidden = stringArray(manifest.forbiddenLegacyFields, "manifest.forbiddenLegacyFields", true);
  if (
    sha256Canonical(forbidden) !== sha256Canonical([...FORBIDDEN_LEGACY_FIXED_WINDOW_FIELDS_V1])
  ) invalid("manifest.forbiddenLegacyFields", "CATALOG_MISMATCH");
  if (!Array.isArray(manifest.sourceTrace) || manifest.sourceTrace.length === 0) {
    failSangtianContentV1(ERROR.SOURCE_TRACE_INVALID, "manifest.sourceTrace", "NON_EMPTY_ARRAY");
  }
  const trace = manifest.sourceTrace.map((item, index) => {
    const pathName = `manifest.sourceTrace[${index}]`;
    const record = object(item, pathName);
    exact(record, ["path", "gitBlobSha1"], pathName);
    nonEmpty(record.path, `${pathName}.path`);
    hex(record.gitBlobSha1, 40, `${pathName}.gitBlobSha1`);
    return record as unknown as { path: string; gitBlobSha1: string };
  });
  assertSorted(trace, (item) => item.path, "manifest.sourceTrace");
  sha(manifest.manifestSha256, "manifest.manifestSha256");
  const expectedManifestHash = hashWithoutField(manifest, "manifestSha256");
  if (manifest.manifestSha256 !== expectedManifestHash) {
    failSangtianContentV1(
      ERROR.MANIFEST_HASH_MISMATCH,
      "manifest.manifestSha256",
      `EXPECTED_${expectedManifestHash}`,
    );
  }
  return structuredClone(manifest) as unknown as SangtianPressureChapterManifestV1;
}

function validateContent(
  value: unknown,
  manifest: SangtianPressureChapterManifestV1,
): SangtianPressureChapterContentV1 {
  const content = object(value, "content");
  exact(content, [
    "schemaVersion",
    "packageId",
    "packageVersion",
    "runtimeProfile",
    "defaultPolicies",
    "genesis",
    "chapters",
    "finale",
  ], "content");
  literal(content.schemaVersion, "sangtian_pressure_chapter_content_v1", "content.schemaVersion");
  literal(content.packageId, manifest.packageId, "content.packageId");
  literal(content.packageVersion, manifest.packageVersion, "content.packageVersion");
  literal(content.runtimeProfile, manifest.runtimeProfile, "content.runtimeProfile");
  validateDefaultPolicies(content.defaultPolicies);
  validateGenesis(content.genesis);
  if (!Array.isArray(content.chapters) || content.chapters.length !== CHAPTER_IDS_V1.length) {
    failSangtianContentV1(ERROR.CHAPTER_INCOMPLETE, "content.chapters", "EXACT_N1_N7");
  }
  const chapters = content.chapters.map((chapter, index) =>
    validateChapter(chapter, CHAPTER_IDS_V1[index]!),
  );
  validateFinale(content.finale);
  return {
    ...(structuredClone(content) as unknown as SangtianPressureChapterContentV1),
    chapters,
  };
}

function validateDefaultPolicies(value: unknown): void {
  const policies = object(value, "content.defaultPolicies");
  exact(policies, ["absence", "aiFailure"], "content.defaultPolicies");
  for (const key of ["absence", "aiFailure"] as const) {
    const policy = object(policies[key], `content.defaultPolicies.${key}`);
    exact(policy, ["policyRef", "actionType", "payload"], `content.defaultPolicies.${key}`);
    nonEmpty(policy.policyRef, `content.defaultPolicies.${key}.policyRef`);
    nonEmpty(policy.actionType, `content.defaultPolicies.${key}.actionType`);
    const payload = object(policy.payload, `content.defaultPolicies.${key}.payload`);
    for (const [field, item] of Object.entries(payload)) {
      nonEmpty(field, `content.defaultPolicies.${key}.payload.key`);
      if (!["string", "number", "boolean"].includes(typeof item) && item !== null) {
        invalid(`content.defaultPolicies.${key}.payload.${field}`, "SCALAR");
      }
    }
  }
}

function validateGenesis(value: unknown): void {
  const genesis = object(value, "content.genesis");
  exact(genesis, [
    "nodeId",
    "title",
    "pressure",
    "lockedFacts",
    "factValues",
    "resources",
    "seats",
    "tracks",
    "objects",
    "knowledgeBySeat",
    "evidence",
    "responsibilities",
    "sourceRefs",
  ], "content.genesis");
  literal(genesis.nodeId, "P0", "content.genesis.nodeId");
  nonEmpty(genesis.title, "content.genesis.title");
  nonEmpty(genesis.pressure, "content.genesis.pressure");
  stringArray(genesis.lockedFacts, "content.genesis.lockedFacts", true);
  scalarRecord(genesis.factValues, "content.genesis.factValues");
  validateResources(genesis.resources);
  validateSeats(genesis.seats);
  validateTracks(genesis.tracks);
  validateObjects(genesis.objects);
  validateKnowledge(genesis.knowledgeBySeat);
  validateEvidence(genesis.evidence);
  validateResponsibilities(genesis.responsibilities);
  stringArray(genesis.sourceRefs, "content.genesis.sourceRefs", true);
}

function validateResources(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    invalid("content.genesis.resources", "NON_EMPTY_ARRAY");
  }
  const resources = value.map((item, index) => {
    const pathName = `content.genesis.resources[${index}]`;
    const resource = object(item, pathName);
    exact(resource, ["resourceId", "label", "initialValue", "displaySuffix"], pathName);
    nonEmpty(resource.resourceId, `${pathName}.resourceId`);
    if (!/^resource\.[a-z][a-z0-9_]*$/u.test(resource.resourceId)) {
      invalid(`${pathName}.resourceId`, "RESOURCE_ID");
    }
    nonEmpty(resource.label, `${pathName}.label`);
    finite(resource.initialValue, `${pathName}.initialValue`, 0);
    if (typeof resource.displaySuffix !== "string" || resource.displaySuffix.length > 20) {
      invalid(`${pathName}.displaySuffix`, "SHORT_STRING");
    }
    return resource as unknown as SangtianResourceContentV1;
  });
  if (new Set(resources.map((resource) => resource.resourceId)).size !== resources.length) {
    invalid("content.genesis.resources", "DUPLICATE_RESOURCE_ID");
  }
}

function validateSeats(value: unknown): void {
  if (!Array.isArray(value) || value.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    invalid("content.genesis.seats", "EXACT_SIX_SEATS");
  }
  const seats = value.map((item, index) => {
    const pathName = `content.genesis.seats[${index}]`;
    const seat = object(item, pathName);
    exact(seat, [
      "seatId",
      "sourceSeatId",
      "displayName",
      "institutionalMission",
      "initialActorId",
      "persistentObjectRefs",
    ], pathName);
    const expectedSeatId = PRESSURE_CHAPTER_SEAT_IDS_V1[index]!;
    literal(seat.seatId, expectedSeatId, `${pathName}.seatId`);
    literal(seat.sourceSeatId, `seat.${expectedSeatId}`, `${pathName}.sourceSeatId`);
    for (const field of ["displayName", "institutionalMission", "initialActorId"] as const) {
      nonEmpty(seat[field], `${pathName}.${field}`);
    }
    stringArray(seat.persistentObjectRefs, `${pathName}.persistentObjectRefs`, true, true);
    return seat as unknown as SangtianSeatContentV1;
  });
  assertSorted(seats, (seat) => seat.seatId, "content.genesis.seats", PRESSURE_CHAPTER_SEAT_IDS_V1);
}

function validateTracks(value: unknown): void {
  if (!Array.isArray(value) || value.length !== TRACK_IDS_V1.length) {
    invalid("content.genesis.tracks", "EXACT_FIVE_TRACKS");
  }
  const tracks = value.map((item, index) => {
    const pathName = `content.genesis.tracks[${index}]`;
    const track = object(item, pathName);
    exact(track, ["trackId", "sourceTrackId", "name", "low", "mid", "high", "initialValue"], pathName);
    const expectedTrack = TRACK_IDS_V1[index]!;
    literal(track.trackId, expectedTrack, `${pathName}.trackId`);
    literal(track.sourceTrackId, `track.${expectedTrack}`, `${pathName}.sourceTrackId`);
    for (const field of ["name", "low", "mid", "high"] as const) nonEmpty(track[field], `${pathName}.${field}`);
    finite(track.initialValue, `${pathName}.initialValue`);
    return track as unknown as SangtianTrackContentV1;
  });
  assertSorted(tracks, (track) => track.trackId, "content.genesis.tracks", TRACK_IDS_V1);
}

function validateObjects(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) invalid("content.genesis.objects", "NON_EMPTY_ARRAY");
  const objects = value.map((item, index) => {
    const pathName = `content.genesis.objects[${index}]`;
    const objectValue = object(item, pathName);
    exact(objectValue, [
      "objectId",
      "name",
      "kind",
      "initialHolderSeatId",
      "sourceCustody",
      "sourceStatus",
    ], pathName);
    for (const field of ["objectId", "name", "kind", "sourceCustody"] as const) {
      nonEmpty(objectValue[field], `${pathName}.${field}`);
    }
    if (
      objectValue.initialHolderSeatId !== null
      && !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(objectValue.initialHolderSeatId as SeatIdV1)
    ) invalid(`${pathName}.initialHolderSeatId`, "SEAT_OR_NULL");
    if (!["SOURCE_FACT", "ADAPTATION_RULE"].includes(String(objectValue.sourceStatus))) {
      invalid(`${pathName}.sourceStatus`, "SOURCE_STATUS");
    }
    return objectValue as unknown as SangtianObjectContentV1;
  });
  assertSorted(objects, (item) => item.objectId, "content.genesis.objects");
}

function validateKnowledge(value: unknown): void {
  if (!Array.isArray(value) || value.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    invalid("content.genesis.knowledgeBySeat", "EXACT_SIX_SEATS");
  }
  const knowledge = value.map((item, index) => {
    const pathName = `content.genesis.knowledgeBySeat[${index}]`;
    const entry = object(item, pathName);
    exact(entry, ["seatId", "knownFactRefs", "secretRefs"], pathName);
    literal(entry.seatId, PRESSURE_CHAPTER_SEAT_IDS_V1[index]!, `${pathName}.seatId`);
    stringArray(entry.knownFactRefs, `${pathName}.knownFactRefs`, true, true);
    stringArray(entry.secretRefs, `${pathName}.secretRefs`, false, true);
    return entry as unknown as SangtianInitialKnowledgeV1;
  });
  assertSorted(knowledge, (item) => item.seatId, "content.genesis.knowledgeBySeat", PRESSURE_CHAPTER_SEAT_IDS_V1);
}

function validateEvidence(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) invalid("content.genesis.evidence", "NON_EMPTY_ARRAY");
  const evidence = value.map((item, index) => {
    const pathName = `content.genesis.evidence[${index}]`;
    const entry = object(item, pathName);
    exact(entry, ["evidenceId", "holderSeatIds", "supportsFactRefs", "visibilityPolicyRef"], pathName);
    nonEmpty(entry.evidenceId, `${pathName}.evidenceId`);
    seatArray(entry.holderSeatIds, `${pathName}.holderSeatIds`, true);
    stringArray(entry.supportsFactRefs, `${pathName}.supportsFactRefs`, true, true);
    nonEmpty(entry.visibilityPolicyRef, `${pathName}.visibilityPolicyRef`);
    return entry as unknown as SangtianInitialEvidenceV1;
  });
  assertSorted(evidence, (item) => item.evidenceId, "content.genesis.evidence");
}

function validateResponsibilities(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    invalid("content.genesis.responsibilities", "NON_EMPTY_ARRAY");
  }
  const responsibilities = value.map((item, index) => {
    const pathName = `content.genesis.responsibilities[${index}]`;
    const entry = object(item, pathName);
    exact(entry, ["responsibilityId", "subjectSeatId", "sourceFactRefs", "level"], pathName);
    nonEmpty(entry.responsibilityId, `${pathName}.responsibilityId`);
    if (!PRESSURE_CHAPTER_SEAT_IDS_V1.includes(entry.subjectSeatId as SeatIdV1)) {
      invalid(`${pathName}.subjectSeatId`, "SEAT");
    }
    stringArray(entry.sourceFactRefs, `${pathName}.sourceFactRefs`, true, true);
    finite(entry.level, `${pathName}.level`, 0);
    return entry as unknown as SangtianInitialResponsibilityV1;
  });
  assertSorted(responsibilities, (item) => item.responsibilityId, "content.genesis.responsibilities");
}

function validateChapter(value: unknown, expectedChapterId: ChapterIdV1): SangtianChapterContentV1 {
  const pathName = `content.chapters.${expectedChapterId}`;
  const chapter = object(value, pathName);
  exact(chapter, [
    "chapterId",
    "title",
    "pressure",
    "lockedFacts",
    "decisionPlan",
    "decisionPoints",
    "closePolicy",
    "settlementPolicy",
    "sourceRefs",
  ], pathName);
  literal(chapter.chapterId, expectedChapterId, `${pathName}.chapterId`);
  nonEmpty(chapter.title, `${pathName}.title`);
  nonEmpty(chapter.pressure, `${pathName}.pressure`);
  stringArray(chapter.lockedFacts, `${pathName}.lockedFacts`, true);
  if (!["STATIC", "DYNAMIC"].includes(String(chapter.decisionPlan))) {
    invalid(`${pathName}.decisionPlan`, "STATIC_OR_DYNAMIC");
  }
  if (!Array.isArray(chapter.decisionPoints) || chapter.decisionPoints.length === 0) {
    failSangtianContentV1(ERROR.CHAPTER_INCOMPLETE, `${pathName}.decisionPoints`, "NON_EMPTY_ARRAY");
  }
  const points = chapter.decisionPoints as unknown[];
  const ordinals = points.map((point) => Number(object(point, `${pathName}.decisionPoint`).ordinal));
  if (ordinals.some((ordinal, index) => ordinal !== index + 1)) {
    failSangtianContentV1(ERROR.DECISION_POINT_INVALID, `${pathName}.decisionPoints`, "CONTIGUOUS_ORDINALS");
  }
  if (chapter.decisionPlan === "DYNAMIC") {
    const conditionalCount = points.filter(
      (point) => object(point, `${pathName}.decisionPoint`).availability !== null,
    ).length;
    if (conditionalCount === 0) invalid(`${pathName}.decisionPoints`, "DYNAMIC_REQUIRES_CONDITIONAL_POINT");
  } else if (points.some((point) => object(point, `${pathName}.decisionPoint`).availability !== null)) {
    invalid(`${pathName}.decisionPoints`, "STATIC_FORBIDS_AVAILABILITY");
  }
  const close = object(chapter.closePolicy, `${pathName}.closePolicy`);
  exact(close, ["exitPredicate", "settlementPolicyRef", "failureMode"], `${pathName}.closePolicy`);
  validateDeterministicPredicateV1(close.exitPredicate, `${pathName}.closePolicy.exitPredicate`);
  nonEmpty(close.settlementPolicyRef, `${pathName}.closePolicy.settlementPolicyRef`);
  literal(close.failureMode, "FAIL_CLOSED", `${pathName}.closePolicy.failureMode`);
  validateSettlementPolicy(chapter.settlementPolicy, expectedChapterId, String(close.settlementPolicyRef));
  stringArray(chapter.sourceRefs, `${pathName}.sourceRefs`, true, true);
  return structuredClone(chapter) as unknown as SangtianChapterContentV1;
}

function validateSettlementPolicy(value: unknown, chapterId: ChapterIdV1, expectedRef: string): void {
  const pathName = `content.chapters.${chapterId}.settlementPolicy`;
  const policy = object(value, pathName);
  exact(policy, ["policyVersion", "evaluationOrder", "branches"], pathName);
  literal(policy.policyVersion, expectedRef, `${pathName}.policyVersion`);
  const order = stringArray(policy.evaluationOrder, `${pathName}.evaluationOrder`, true);
  if (sha256Canonical(order) !== sha256Canonical(["HIGH", "LOW", "MID"])) {
    failSangtianContentV1(ERROR.SETTLEMENT_POLICY_INVALID, `${pathName}.evaluationOrder`, "HIGH_LOW_MID");
  }
  if (!Array.isArray(policy.branches) || policy.branches.length !== 3) {
    failSangtianContentV1(ERROR.SETTLEMENT_POLICY_INVALID, `${pathName}.branches`, "EXACT_THREE");
  }
  const bands = policy.branches.map((branch, index) =>
    validateSettlementBranch(branch, chapterId, index),
  );
  if (bands.join(",") !== "HIGH,LOW,MID") {
    failSangtianContentV1(ERROR.SETTLEMENT_POLICY_INVALID, `${pathName}.branches`, "HIGH_LOW_MID_ORDER");
  }
}

function validateSettlementBranch(
  value: unknown,
  chapterId: ChapterIdV1,
  index: number,
): string {
  const pathName = `content.chapters.${chapterId}.settlementPolicy.branches[${index}]`;
  const branch = object(value, pathName);
  exact(branch, [
    "branchId",
    "outcomeBand",
    "selector",
    "trackDelta",
    "seatArcProgressDelta",
    "objectRefs",
    "evidenceRefs",
    "carryForwardRefs",
    "sourceRefs",
  ], pathName);
  nonEmpty(branch.branchId, `${pathName}.branchId`);
  if (!["HIGH", "MID", "LOW"].includes(String(branch.outcomeBand))) {
    invalid(`${pathName}.outcomeBand`, "BAND");
  }
  validateSettlementPredicate(branch.selector, `${pathName}.selector`);
  const trackDelta = object(branch.trackDelta, `${pathName}.trackDelta`);
  for (const [trackId, amount] of Object.entries(trackDelta)) {
    if (!TRACK_IDS_V1.includes(trackId as TrackIdV1)) invalid(`${pathName}.trackDelta.${trackId}`, "TRACK");
    finite(amount, `${pathName}.trackDelta.${trackId}`);
  }
  finite(branch.seatArcProgressDelta, `${pathName}.seatArcProgressDelta`);
  for (const field of ["objectRefs", "evidenceRefs", "carryForwardRefs", "sourceRefs"] as const) {
    stringArray(branch[field], `${pathName}.${field}`, true, true);
  }
  return String(branch.outcomeBand);
}

function validateSettlementPredicate(value: unknown, pathName: string): SangtianSettlementPredicateV1 {
  const predicate = object(value, pathName);
  const op = String(predicate.op || "");
  if (op === "ALL" || op === "ANY") {
    exact(predicate, ["op", "clauses"], pathName);
    if (!Array.isArray(predicate.clauses) || predicate.clauses.length === 0) {
      invalid(`${pathName}.clauses`, "NON_EMPTY_ARRAY");
    }
    predicate.clauses.forEach((clause, index) =>
      validateSettlementPredicate(clause, `${pathName}.clauses[${index}]`),
    );
  } else if (op === "COMPARE") {
    exact(predicate, ["op", "factRef", "comparator", "value"], pathName);
    nonEmpty(predicate.factRef, `${pathName}.factRef`);
    if (!["EQ", "NE", "GT", "GTE", "LT", "LTE", "IN"].includes(String(predicate.comparator))) {
      invalid(`${pathName}.comparator`, "COMPARATOR");
    }
  } else if (op === "MIN_COMPARE") {
    exact(predicate, ["op", "factRefs", "comparator", "value"], pathName);
    stringArray(predicate.factRefs, `${pathName}.factRefs`, true, true);
    if (!["GT", "GTE", "LT", "LTE"].includes(String(predicate.comparator))) {
      invalid(`${pathName}.comparator`, "ORDER_COMPARATOR");
    }
    finite(predicate.value, `${pathName}.value`);
  } else if (op === "DEFAULT") {
    exact(predicate, ["op"], pathName);
  } else {
    invalid(`${pathName}.op`, "PREDICATE_OP");
  }
  return predicate as unknown as SangtianSettlementPredicateV1;
}

function validateFinale(value: unknown): void {
  const finale = object(value, "content.finale");
  exact(finale, [
    "policyVersion",
    "ruleSchemaVersion",
    "worldOutcomeRuleRefs",
    "seatVerdictRuleRefs",
    "disclosureRuleRefs",
    "sourceRefs",
  ], "content.finale");
  literal(finale.policyVersion, SANGTIAN_CONTENT_FINALE_POLICY_VERSION_V1, "content.finale.policyVersion");
  literal(finale.ruleSchemaVersion, SANGTIAN_CONTENT_FINALE_RULE_SCHEMA_VERSION_V1, "content.finale.ruleSchemaVersion");
  equalCatalog(finale.worldOutcomeRuleRefs, expectedWorldOutcomeRuleRefsV1(), "content.finale.worldOutcomeRuleRefs");
  const seatRules = object(finale.seatVerdictRuleRefs, "content.finale.seatVerdictRuleRefs");
  exact(seatRules, PRESSURE_CHAPTER_SEAT_IDS_V1, "content.finale.seatVerdictRuleRefs");
  const expected = expectedSeatVerdictRuleRefsV1();
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    equalCatalog(seatRules[seatId], expected[seatId], `content.finale.seatVerdictRuleRefs.${seatId}`);
  }
  equalCatalog(
    finale.disclosureRuleRefs,
    [...SANGTIAN_DISCLOSURE_RULE_REFS_V1],
    "content.finale.disclosureRuleRefs",
  );
  stringArray(finale.sourceRefs, "content.finale.sourceRefs", true, true);
}

function compileChapter(
  chapter: SangtianChapterContentV1,
  content: SangtianPressureChapterContentV1,
): CompiledSangtianChapterContentV1 {
  const decisionPoints = chapter.decisionPoints.map((point) =>
    compileSangtianDecisionPointDefinitionV1(point, chapter.chapterId, content.defaultPolicies),
  );
  return deepFreeze({
    chapterId: chapter.chapterId,
    decisionPlan: chapter.decisionPlan,
    decisionPoints,
    closePolicy: structuredClone(chapter.closePolicy),
    settlementPolicy: structuredClone(chapter.settlementPolicy),
  });
}

function findForbiddenField(
  value: unknown,
  forbidden: Set<string>,
  pathName: string,
): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenField(value[index], forbidden, `${pathName}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  for (const [field, child] of Object.entries(value as Raw)) {
    if (forbidden.has(field)) return `${pathName}.${field}`;
    const found = findForbiddenField(child, forbidden, `${pathName}.${field}`);
    if (found) return found;
  }
  return null;
}

function object(value: unknown, pathName: string): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(pathName, "OBJECT");
  return value as Raw;
}

function exact(value: Raw, fields: readonly string[], pathName: string): void {
  const extra = Object.keys(value).find((field) => !fields.includes(field));
  if (extra) invalid(`${pathName}.${extra}`, "UNKNOWN_FIELD");
  const missing = fields.find((field) => !(field in value));
  if (missing) invalid(`${pathName}.${missing}`, "MISSING_FIELD");
}

function nonEmpty(value: unknown, pathName: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) invalid(pathName, "NON_EMPTY_STRING");
}

function version(value: unknown, pathName: string): asserts value is string {
  nonEmpty(value, pathName);
  if (/^(?:TBD|TODO|UNKNOWN)$/iu.test(value)) invalid(pathName, "VERSION");
}

function literal<T>(value: unknown, expected: T, pathName: string): T {
  if (value !== expected) invalid(pathName, `EXPECTED_${String(expected)}`);
  return expected;
}

function sha(value: unknown, pathName: string): asserts value is string {
  if (!isSha256(value)) invalid(pathName, "SHA256");
}

function hex(value: unknown, length: number, pathName: string): asserts value is string {
  if (typeof value !== "string" || !new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value)) {
    invalid(pathName, `LOWER_HEX_${length}`);
  }
}

function finite(value: unknown, pathName: string, minimum?: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    invalid(pathName, minimum === undefined ? "FINITE_NUMBER" : `NUMBER_GTE_${minimum}`);
  }
}

function stringArray(
  value: unknown,
  pathName: string,
  nonEmptyArray = false,
  sorted = false,
): string[] {
  if (!Array.isArray(value) || (nonEmptyArray && value.length === 0)) invalid(pathName, "STRING_ARRAY");
  const result = value.map((item, index) => {
    nonEmpty(item, `${pathName}[${index}]`);
    return item;
  });
  if (new Set(result).size !== result.length) invalid(pathName, "DUPLICATE");
  if (sorted) assertSorted(result, (item) => item, pathName);
  return result;
}

function seatArray(value: unknown, pathName: string, nonEmptyArray = false): SeatIdV1[] {
  const seats = stringArray(value, pathName, nonEmptyArray) as SeatIdV1[];
  if (seats.some((seat) => !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seat))) invalid(pathName, "SEAT");
  assertSorted(seats, (seat) => seat, pathName, PRESSURE_CHAPTER_SEAT_IDS_V1);
  return seats;
}

function scalarRecord(value: unknown, pathName: string): void {
  const record = object(value, pathName);
  for (const [key, item] of Object.entries(record)) {
    nonEmpty(key, `${pathName}.key`);
    if (!["string", "number", "boolean"].includes(typeof item) && item !== null) {
      invalid(`${pathName}.${key}`, "SCALAR");
    }
  }
}

function numberRecord(value: unknown, pathName: string): void {
  const record = object(value, pathName);
  for (const [key, item] of Object.entries(record)) {
    nonEmpty(key, `${pathName}.key`);
    finite(item, `${pathName}.${key}`, 0);
  }
}

function equalCatalog(actual: unknown, expected: readonly string[], pathName: string): void {
  const catalog = stringArray(actual, pathName, true, true);
  if (sha256Canonical(catalog) !== sha256Canonical(expected)) {
    failSangtianContentV1(ERROR.FINALE_RULE_MISMATCH, pathName, "CATALOG_MISMATCH");
  }
}

function assertSorted<T>(
  values: readonly T[],
  selector: (value: T) => string,
  pathName: string,
  canonicalOrder?: readonly string[],
): void {
  for (let index = 1; index < values.length; index += 1) {
    const left = selector(values[index - 1]!);
    const right = selector(values[index]!);
    const comparison = canonicalOrder
      ? canonicalOrder.indexOf(left) - canonicalOrder.indexOf(right)
      : compareCanonicalText(left, right);
    if (comparison >= 0) invalid(pathName, "SORTED_UNIQUE");
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Raw)) deepFreeze(child);
  return value;
}

function invalid(pathName: string, detail?: string): never {
  failSangtianContentV1(ERROR.PACKAGE_INVALID, pathName, detail);
}
