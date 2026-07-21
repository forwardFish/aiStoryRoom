import type {
  RuntimeStoryPackage,
  StoryPackageAdaptationDecision,
  StoryPackageCard,
  StoryPackageFloorObligation,
  StoryPackageLatentTruth,
  StoryPackageMainlineQuestion,
  StoryPackageManifest,
  StoryPackageNode,
  StoryPackagePressure,
  StoryPackageRoleAcl,
  StoryPackageSourceMap,
  StoryPackageSourceMapEntry
} from "./types";

type JsonRecord = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`STORY_PACKAGE_INVALID:${message}`);
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, label: string, keys: readonly string[]) {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) fail(`${label} has unknown property ${key}`);
  for (const key of keys) if (!(key in value)) fail(`${label} is missing ${key}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string`);
  return value;
}

function key(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(result)) fail(`${label} must be a stable key`);
  return result;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) fail(`${label} must be an integer`);
  return value as number;
}

function textArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((item, index) => text(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates`);
  return result;
}

function keyArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((item, index) => key(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates`);
  return result;
}

function safeRelativePath(value: unknown, label: string): string {
  const result = text(value, label).replace(/\\/g, "/");
  if (result.startsWith("/") || result.includes("../") || /^[a-z]+:/i.test(result)) fail(`${label} must stay inside the story-package directory`);
  return result;
}

function sha256(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-f0-9]{64}$/.test(result)) fail(`${label} must be a sha256 hex digest`);
  return result;
}

function validateSourceMapEntry(value: unknown, label: string): StoryPackageSourceMapEntry {
  const entry = record(value, label);
  exactKeys(entry, label, ["sourceId", "kind", "origin", "chapterLabel", "excerptLabel", "sourceRefs", "adaptationDecisionId", "adaptationNote"]);
  const kind = text(entry.kind, `${label}.kind`);
  if (!["t0", "t1", "t2", "t3"].includes(kind)) fail(`${label}.kind is invalid`);
  const origin = text(entry.origin, `${label}.origin`);
  if (!["original_fact", "derived_constraint", "adapted", "invented_for_game"].includes(origin)) fail(`${label}.origin is invalid`);
  if (!Array.isArray(entry.sourceRefs) || !entry.sourceRefs.length) fail(`${label}.sourceRefs must not be empty`);
  const sourceRefs = entry.sourceRefs.map((value, index) => {
    const sourceRef = record(value, `${label}.sourceRefs[${index}]`);
    exactKeys(sourceRef, `${label}.sourceRefs[${index}]`, ["sourcePath", "sourceSha256", "lineStart", "lineEnd"]);
    const lineStart = integer(sourceRef.lineStart, `${label}.sourceRefs[${index}].lineStart`);
    const lineEnd = integer(sourceRef.lineEnd, `${label}.sourceRefs[${index}].lineEnd`);
    if (lineStart < 1 || lineEnd < lineStart) fail(`${label}.sourceRefs[${index}] line range is invalid`);
    return {
      sourcePath: safeRelativePath(sourceRef.sourcePath, `${label}.sourceRefs[${index}].sourcePath`),
      sourceSha256: sha256(sourceRef.sourceSha256, `${label}.sourceRefs[${index}].sourceSha256`),
      lineStart,
      lineEnd
    };
  });
  const adaptationDecisionId = entry.adaptationDecisionId === null
    ? null
    : key(entry.adaptationDecisionId, `${label}.adaptationDecisionId`);
  if (kind === "t0" && origin !== "original_fact") fail(`${label} t0 entries must be original_fact`);
  if (kind === "t0" && adaptationDecisionId !== null) fail(`${label} t0 entries must not have an adaptationDecisionId`);
  if ((origin === "adapted" || origin === "invented_for_game") && adaptationDecisionId === null) {
    fail(`${label} adapted or invented entries require an adaptationDecisionId`);
  }
  return {
    sourceId: key(entry.sourceId, `${label}.sourceId`),
    kind: kind as StoryPackageSourceMapEntry["kind"],
    origin: origin as StoryPackageSourceMapEntry["origin"],
    chapterLabel: text(entry.chapterLabel, `${label}.chapterLabel`),
    excerptLabel: text(entry.excerptLabel, `${label}.excerptLabel`),
    sourceRefs,
    adaptationDecisionId,
    adaptationNote: text(entry.adaptationNote, `${label}.adaptationNote`)
  };
}

function validateAdaptationDecision(value: unknown, label: string): StoryPackageAdaptationDecision {
  const decision = record(value, label);
  exactKeys(decision, label, ["adaptationDecisionId", "title", "decision", "rationale", "basedOnSourceIds"]);
  return {
    adaptationDecisionId: key(decision.adaptationDecisionId, `${label}.adaptationDecisionId`),
    title: text(decision.title, `${label}.title`),
    decision: text(decision.decision, `${label}.decision`),
    rationale: text(decision.rationale, `${label}.rationale`),
    basedOnSourceIds: keyArray(decision.basedOnSourceIds, `${label}.basedOnSourceIds`)
  };
}

function validateRoleAcl(value: unknown, label: string): StoryPackageRoleAcl {
  const role = record(value, label);
  exactKeys(role, label, ["roleKey", "visibleCardIds", "hiddenCardIds", "visibleLatentTruthIds", "blockedLatentTruthIds"]);
  return {
    roleKey: key(role.roleKey, `${label}.roleKey`),
    visibleCardIds: keyArray(role.visibleCardIds, `${label}.visibleCardIds`),
    hiddenCardIds: keyArray(role.hiddenCardIds, `${label}.hiddenCardIds`),
    visibleLatentTruthIds: keyArray(role.visibleLatentTruthIds, `${label}.visibleLatentTruthIds`),
    blockedLatentTruthIds: keyArray(role.blockedLatentTruthIds, `${label}.blockedLatentTruthIds`)
  };
}

function validateCard(value: unknown, label: string): StoryPackageCard {
  const card = record(value, label);
  exactKeys(card, label, ["cardId", "kind", "title", "summary", "sourceIds", "visibility", "visibleToRoleKeys", "relatedNodeIds", "tags"]);
  const kind = text(card.kind, `${label}.kind`);
  if (!["role", "location", "institution", "evidence", "pressure", "material", "latent_truth"].includes(kind)) fail(`${label}.kind is invalid`);
  const visibility = text(card.visibility, `${label}.visibility`);
  if (!["public", "role_scoped", "hidden_until_revealed"].includes(visibility)) fail(`${label}.visibility is invalid`);
  return {
    cardId: key(card.cardId, `${label}.cardId`),
    kind: kind as StoryPackageCard["kind"],
    title: text(card.title, `${label}.title`),
    summary: text(card.summary, `${label}.summary`),
    sourceIds: keyArray(card.sourceIds, `${label}.sourceIds`),
    visibility: visibility as StoryPackageCard["visibility"],
    visibleToRoleKeys: keyArray(card.visibleToRoleKeys, `${label}.visibleToRoleKeys`),
    relatedNodeIds: keyArray(card.relatedNodeIds, `${label}.relatedNodeIds`),
    tags: textArray(card.tags, `${label}.tags`)
  };
}

function validateMainlineQuestion(value: unknown, label: string): StoryPackageMainlineQuestion {
  const question = record(value, label);
  exactKeys(question, label, ["questionId", "prompt", "resolutionSignals", "sourceIds"]);
  return {
    questionId: key(question.questionId, `${label}.questionId`),
    prompt: text(question.prompt, `${label}.prompt`),
    resolutionSignals: textArray(question.resolutionSignals, `${label}.resolutionSignals`),
    sourceIds: keyArray(question.sourceIds, `${label}.sourceIds`)
  };
}

function validateLatentTruth(value: unknown, label: string): StoryPackageLatentTruth {
  const truth = record(value, label);
  exactKeys(truth, label, ["truthId", "title", "statement", "sourceIds", "revealWhen", "visibility", "visibleToRoleKeys"]);
  const visibility = text(truth.visibility, `${label}.visibility`);
  if (!["public", "role_scoped", "hidden_until_revealed"].includes(visibility)) fail(`${label}.visibility is invalid`);
  return {
    truthId: key(truth.truthId, `${label}.truthId`),
    title: text(truth.title, `${label}.title`),
    statement: text(truth.statement, `${label}.statement`),
    sourceIds: keyArray(truth.sourceIds, `${label}.sourceIds`),
    revealWhen: textArray(truth.revealWhen, `${label}.revealWhen`),
    visibility: visibility as StoryPackageLatentTruth["visibility"],
    visibleToRoleKeys: keyArray(truth.visibleToRoleKeys, `${label}.visibleToRoleKeys`)
  };
}

function validatePressure(value: unknown, label: string): StoryPackagePressure {
  const pressure = record(value, label);
  exactKeys(pressure, label, ["pressureId", "label", "summary", "urgency", "sourceIds", "relatedNodeIds"]);
  const urgency = text(pressure.urgency, `${label}.urgency`);
  if (!["low", "medium", "high"].includes(urgency)) fail(`${label}.urgency is invalid`);
  return {
    pressureId: key(pressure.pressureId, `${label}.pressureId`),
    label: text(pressure.label, `${label}.label`),
    summary: text(pressure.summary, `${label}.summary`),
    urgency: urgency as StoryPackagePressure["urgency"],
    sourceIds: keyArray(pressure.sourceIds, `${label}.sourceIds`),
    relatedNodeIds: keyArray(pressure.relatedNodeIds, `${label}.relatedNodeIds`)
  };
}

function validateFloorObligation(value: unknown, label: string): StoryPackageFloorObligation {
  const floor = record(value, label);
  exactKeys(floor, label, ["obligationId", "dramaticPurpose", "floorKind", "earliestAtTurn", "floorAtTurn", "sourceIds", "preconditions", "satisfiedByAnyFactKeys", "directedBeatTemplate"]);
  const floorKind = text(floor.floorKind, `${label}.floorKind`);
  if (!["terminal", "player_consequence", "mainline", "setup_payoff", "actor_agency", "stagnation"].includes(floorKind)) fail(`${label}.floorKind is invalid`);
  const directedBeatTemplate = floor.directedBeatTemplate === null ? null : record(floor.directedBeatTemplate, `${label}.directedBeatTemplate`);
  if (directedBeatTemplate) {
    exactKeys(directedBeatTemplate, `${label}.directedBeatTemplate`, ["beatId", "externalWorldMove", "physicalPreconditions", "allowedSourceIds", "targetNodeId"]);
  }
  return {
    obligationId: key(floor.obligationId, `${label}.obligationId`),
    dramaticPurpose: text(floor.dramaticPurpose, `${label}.dramaticPurpose`),
    floorKind: floorKind as StoryPackageFloorObligation["floorKind"],
    earliestAtTurn: floor.earliestAtTurn === null || floor.earliestAtTurn === undefined ? undefined : integer(floor.earliestAtTurn, `${label}.earliestAtTurn`),
    floorAtTurn: integer(floor.floorAtTurn, `${label}.floorAtTurn`),
    sourceIds: keyArray(floor.sourceIds, `${label}.sourceIds`),
    preconditions: textArray(floor.preconditions, `${label}.preconditions`),
    satisfiedByAnyFactKeys: keyArray(floor.satisfiedByAnyFactKeys, `${label}.satisfiedByAnyFactKeys`),
    directedBeatTemplate: directedBeatTemplate ? {
      beatId: key(directedBeatTemplate.beatId, `${label}.directedBeatTemplate.beatId`),
      externalWorldMove: text(directedBeatTemplate.externalWorldMove, `${label}.directedBeatTemplate.externalWorldMove`),
      physicalPreconditions: textArray(directedBeatTemplate.physicalPreconditions, `${label}.directedBeatTemplate.physicalPreconditions`),
      allowedSourceIds: keyArray(directedBeatTemplate.allowedSourceIds, `${label}.directedBeatTemplate.allowedSourceIds`),
      targetNodeId: key(directedBeatTemplate.targetNodeId, `${label}.directedBeatTemplate.targetNodeId`)
    } : undefined
  };
}

function validateNode(value: unknown, label: string): StoryPackageNode {
  const node = record(value, label);
  exactKeys(node, label, ["nodeId", "title", "stageKey", "perspectiveRoleKey", "sceneLabel", "situationBoundary", "allowedAdjacentNodeIds", "publicEntryBeat", "relevantCardIds", "mainlineQuestionIds", "activePressureIds", "latentTruthIds", "floorObligationIds"]);
  return {
    nodeId: key(node.nodeId, `${label}.nodeId`),
    title: text(node.title, `${label}.title`),
    stageKey: key(node.stageKey, `${label}.stageKey`),
    perspectiveRoleKey: key(node.perspectiveRoleKey, `${label}.perspectiveRoleKey`),
    sceneLabel: text(node.sceneLabel, `${label}.sceneLabel`),
    situationBoundary: text(node.situationBoundary, `${label}.situationBoundary`),
    allowedAdjacentNodeIds: keyArray(node.allowedAdjacentNodeIds, `${label}.allowedAdjacentNodeIds`),
    publicEntryBeat: text(node.publicEntryBeat, `${label}.publicEntryBeat`),
    relevantCardIds: keyArray(node.relevantCardIds, `${label}.relevantCardIds`),
    mainlineQuestionIds: keyArray(node.mainlineQuestionIds, `${label}.mainlineQuestionIds`),
    activePressureIds: keyArray(node.activePressureIds, `${label}.activePressureIds`),
    latentTruthIds: keyArray(node.latentTruthIds, `${label}.latentTruthIds`),
    floorObligationIds: keyArray(node.floorObligationIds, `${label}.floorObligationIds`)
  };
}

export function validateStoryPackageManifest(value: unknown): StoryPackageManifest {
  const manifest = record(value, "story-package manifest");
  exactKeys(manifest, "story-package manifest", ["schemaVersion", "worldId", "packageId", "packageVersion", "storyPackagePath", "sourceMapPath", "storyPackageSha256", "sourceMapSha256"]);
  if (manifest.schemaVersion !== "story_package_manifest_v1") fail("manifest schemaVersion is invalid");
  return {
    schemaVersion: "story_package_manifest_v1",
    worldId: key(manifest.worldId, "manifest.worldId"),
    packageId: key(manifest.packageId, "manifest.packageId"),
    packageVersion: text(manifest.packageVersion, "manifest.packageVersion"),
    storyPackagePath: safeRelativePath(manifest.storyPackagePath, "manifest.storyPackagePath"),
    sourceMapPath: safeRelativePath(manifest.sourceMapPath, "manifest.sourceMapPath"),
    storyPackageSha256: sha256(manifest.storyPackageSha256, "manifest.storyPackageSha256"),
    sourceMapSha256: sha256(manifest.sourceMapSha256, "manifest.sourceMapSha256")
  };
}

export function validateStoryPackageSourceMap(value: unknown): StoryPackageSourceMap {
  const sourceMap = record(value, "story-package source map");
  exactKeys(sourceMap, "story-package source map", ["schemaVersion", "worldId", "packageId", "packageVersion", "adaptationDecisions", "entries"]);
  if (sourceMap.schemaVersion !== "story_source_map_v2") fail("source map schemaVersion is invalid");
  if (!Array.isArray(sourceMap.adaptationDecisions)) fail("source map adaptationDecisions must be an array");
  const adaptationDecisions = sourceMap.adaptationDecisions.map((decision, index) => validateAdaptationDecision(decision, `sourceMap.adaptationDecisions[${index}]`));
  if (!Array.isArray(sourceMap.entries) || !sourceMap.entries.length) fail("source map entries must not be empty");
  const entries = sourceMap.entries.map((entry, index) => validateSourceMapEntry(entry, `sourceMap.entries[${index}]`));
  if (new Set(entries.map((entry) => entry.sourceId)).size !== entries.length) fail("source map sourceId values must be unique");
  if (new Set(adaptationDecisions.map((decision) => decision.adaptationDecisionId)).size !== adaptationDecisions.length) fail("source map adaptationDecisionId values must be unique");
  const sourceIds = new Set(entries.map((entry) => entry.sourceId));
  const adaptationDecisionIds = new Set(adaptationDecisions.map((decision) => decision.adaptationDecisionId));
  if (!entries.some((entry) => entry.kind === "t0")) fail("source map must contain at least one t0 entry");
  for (const entry of entries) {
    if (entry.adaptationDecisionId && !adaptationDecisionIds.has(entry.adaptationDecisionId)) {
      fail(`source map entry ${entry.sourceId} references unknown adaptationDecisionId ${entry.adaptationDecisionId}`);
    }
  }
  for (const decision of adaptationDecisions) {
    decision.basedOnSourceIds.forEach((sourceId) => {
      if (!sourceIds.has(sourceId)) fail(`adaptation decision ${decision.adaptationDecisionId} references unknown sourceId ${sourceId}`);
    });
  }
  return {
    schemaVersion: "story_source_map_v2",
    worldId: key(sourceMap.worldId, "sourceMap.worldId"),
    packageId: key(sourceMap.packageId, "sourceMap.packageId"),
    packageVersion: text(sourceMap.packageVersion, "sourceMap.packageVersion"),
    adaptationDecisions,
    entries
  };
}

export function validateRuntimeStoryPackage(value: unknown): RuntimeStoryPackage {
  const storyPackage = record(value, "runtime story package");
  exactKeys(storyPackage, "runtime story package", ["schemaVersion", "worldId", "packageId", "packageVersion", "sourceMapSha256", "roles", "cards", "mainlineQuestions", "latentTruths", "pressures", "floorPolicy", "directedBeatPolicy", "floorObligations", "nodes", "openingNodeId"]);
  if (storyPackage.schemaVersion !== "runtime_story_package_v1") fail("runtime story package schemaVersion is invalid");
  const roles = Array.isArray(storyPackage.roles) ? storyPackage.roles.map((role, index) => validateRoleAcl(role, `roles[${index}]`)) : fail("roles must be an array");
  const cards = Array.isArray(storyPackage.cards) ? storyPackage.cards.map((card, index) => validateCard(card, `cards[${index}]`)) : fail("cards must be an array");
  const questions = Array.isArray(storyPackage.mainlineQuestions) ? storyPackage.mainlineQuestions.map((question, index) => validateMainlineQuestion(question, `mainlineQuestions[${index}]`)) : fail("mainlineQuestions must be an array");
  const truths = Array.isArray(storyPackage.latentTruths) ? storyPackage.latentTruths.map((truth, index) => validateLatentTruth(truth, `latentTruths[${index}]`)) : fail("latentTruths must be an array");
  const pressures = Array.isArray(storyPackage.pressures) ? storyPackage.pressures.map((pressure, index) => validatePressure(pressure, `pressures[${index}]`)) : fail("pressures must be an array");
  const floors = Array.isArray(storyPackage.floorObligations) ? storyPackage.floorObligations.map((floor, index) => validateFloorObligation(floor, `floorObligations[${index}]`)) : fail("floorObligations must be an array");
  const nodes = Array.isArray(storyPackage.nodes) ? storyPackage.nodes.map((node, index) => validateNode(node, `nodes[${index}]`)) : fail("nodes must be an array");
  const cardIds = new Set(cards.map((card) => card.cardId));
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const questionIds = new Set(questions.map((question) => question.questionId));
  const pressureIds = new Set(pressures.map((pressure) => pressure.pressureId));
  const truthIds = new Set(truths.map((truth) => truth.truthId));
  const floorIds = new Set(floors.map((floor) => floor.obligationId));
  if (new Set(roles.map((role) => role.roleKey)).size !== roles.length) fail("roles must have unique roleKey values");
  if (cardIds.size !== cards.length) fail("cards must have unique cardId values");
  if (questionIds.size !== questions.length) fail("mainlineQuestions must have unique questionId values");
  if (pressureIds.size !== pressures.length) fail("pressures must have unique pressureId values");
  if (truthIds.size !== truths.length) fail("latentTruths must have unique truthId values");
  if (floorIds.size !== floors.length) fail("floorObligations must have unique obligationId values");
  if (nodeIds.size !== nodes.length) fail("nodes must have unique nodeId values");
  for (const role of roles) {
    role.visibleCardIds.forEach((cardId) => { if (!cardIds.has(cardId)) fail(`role ${role.roleKey} references unknown visibleCardId ${cardId}`); });
    role.hiddenCardIds.forEach((cardId) => { if (!cardIds.has(cardId)) fail(`role ${role.roleKey} references unknown hiddenCardId ${cardId}`); });
    role.visibleLatentTruthIds.forEach((truthId) => { if (!truthIds.has(truthId)) fail(`role ${role.roleKey} references unknown visibleLatentTruthId ${truthId}`); });
    role.blockedLatentTruthIds.forEach((truthId) => { if (!truthIds.has(truthId)) fail(`role ${role.roleKey} references unknown blockedLatentTruthId ${truthId}`); });
  }
  for (const node of nodes) {
    node.allowedAdjacentNodeIds.forEach((nodeId) => { if (!nodeIds.has(nodeId)) fail(`node ${node.nodeId} references unknown adjacent node ${nodeId}`); });
    node.relevantCardIds.forEach((cardId) => { if (!cardIds.has(cardId)) fail(`node ${node.nodeId} references unknown relevant card ${cardId}`); });
    node.mainlineQuestionIds.forEach((questionId) => { if (!questionIds.has(questionId)) fail(`node ${node.nodeId} references unknown mainlineQuestion ${questionId}`); });
    node.activePressureIds.forEach((pressureId) => { if (!pressureIds.has(pressureId)) fail(`node ${node.nodeId} references unknown pressure ${pressureId}`); });
    node.latentTruthIds.forEach((truthId) => { if (!truthIds.has(truthId)) fail(`node ${node.nodeId} references unknown latentTruth ${truthId}`); });
    node.floorObligationIds.forEach((floorId) => { if (!floorIds.has(floorId)) fail(`node ${node.nodeId} references unknown floorObligation ${floorId}`); });
  }
  const floorPolicy = record(storyPackage.floorPolicy, "floorPolicy");
  exactKeys(floorPolicy, "floorPolicy", ["recentCanonOverridesDefaults", "satisfiedFloorClosesPermanently", "preconditionFailureRequiresRetargetOrSilence", "maxDirectedBeatsPerTurn"]);
  if (floorPolicy.recentCanonOverridesDefaults !== true) fail("floorPolicy.recentCanonOverridesDefaults must be true");
  if (floorPolicy.satisfiedFloorClosesPermanently !== true) fail("floorPolicy.satisfiedFloorClosesPermanently must be true");
  if (floorPolicy.preconditionFailureRequiresRetargetOrSilence !== true) fail("floorPolicy.preconditionFailureRequiresRetargetOrSilence must be true");
  if (integer(floorPolicy.maxDirectedBeatsPerTurn, "floorPolicy.maxDirectedBeatsPerTurn") !== 1) fail("floorPolicy.maxDirectedBeatsPerTurn must remain 1");
  const directedBeatPolicy = record(storyPackage.directedBeatPolicy, "directedBeatPolicy");
  exactKeys(directedBeatPolicy, "directedBeatPolicy", ["maxBeatsPerTurn", "mayNotDecideForPlayer", "mayNotInventKeyEvidence", "mayOnlyMoveNpcOrWorld"]);
  if (integer(directedBeatPolicy.maxBeatsPerTurn, "directedBeatPolicy.maxBeatsPerTurn") !== 1) fail("directedBeatPolicy.maxBeatsPerTurn must remain 1");
  if (directedBeatPolicy.mayNotDecideForPlayer !== true) fail("directedBeatPolicy.mayNotDecideForPlayer must be true");
  if (directedBeatPolicy.mayNotInventKeyEvidence !== true) fail("directedBeatPolicy.mayNotInventKeyEvidence must be true");
  if (directedBeatPolicy.mayOnlyMoveNpcOrWorld !== true) fail("directedBeatPolicy.mayOnlyMoveNpcOrWorld must be true");
  const openingNodeId = key(storyPackage.openingNodeId, "openingNodeId");
  if (!nodeIds.has(openingNodeId)) fail("openingNodeId must reference a known node");
  return {
    schemaVersion: "runtime_story_package_v1",
    worldId: key(storyPackage.worldId, "worldId"),
    packageId: key(storyPackage.packageId, "packageId"),
    packageVersion: text(storyPackage.packageVersion, "packageVersion"),
    sourceMapSha256: sha256(storyPackage.sourceMapSha256, "sourceMapSha256"),
    roles,
    cards,
    mainlineQuestions: questions,
    latentTruths: truths,
    pressures,
    floorPolicy: {
      recentCanonOverridesDefaults: true,
      satisfiedFloorClosesPermanently: true,
      preconditionFailureRequiresRetargetOrSilence: true,
      maxDirectedBeatsPerTurn: 1
    },
    directedBeatPolicy: {
      maxBeatsPerTurn: 1,
      mayNotDecideForPlayer: true,
      mayNotInventKeyEvidence: true,
      mayOnlyMoveNpcOrWorld: true
    },
    floorObligations: floors,
    nodes,
    openingNodeId
  };
}
