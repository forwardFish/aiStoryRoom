import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadPressureSpinePackage } from "../loader";
import { pressureHash } from "./canonical";
import type {
  PressureContentBranch,
  PressureContentDefaultPolicy,
  PressureContentHandoff,
  PressureContentInputFallback,
  PressureContentKnownFact,
  PressureContentNode,
  PressureContentObject,
  PressureContentOpeningVariant,
  PressureContentReaction,
  PressureContentSeat,
  PressureKnowledgeProvenance,
  PressureRuntimeContent,
  PressureVisibility,
  PressureWorldActionType,
  SelectorRule,
} from "./types";

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function array<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function strings(value: unknown): string[] {
  return array(value).map(String).filter(Boolean);
}

function visibility(value: unknown): PressureVisibility {
  const normalized = String(value || "PRIVATE").toUpperCase();
  return ["PUBLIC", "OBSERVABLE", "LIMITED", "PRIVATE", "PRIVATE_SYSTEM"].includes(normalized)
    ? normalized as PressureVisibility
    : "PRIVATE";
}

function parseWindowSeconds(value: unknown): number {
  const match = String(value || "").match(/(\d+)\s*秒/u);
  return match ? Number(match[1]) : 0;
}

function parseReaction(value: unknown): PressureContentReaction | null {
  const raw = record(value);
  if (!raw.trigger) return null;
  const allowedActionTypes = strings(raw.actions).filter((entry) =>
    ["ALLOCATE", "SIGN", "TRANSFER", "SEIZE", "DISCLOSE", "DISPATCH"].includes(entry),
  ) as PressureWorldActionType[];
  const trigger = String(raw.trigger);
  return {
    trigger,
    triggerId: `reaction.${pressureHash(trigger).slice(0, 24).toLowerCase()}`,
    eligibleSeatIds: strings(raw.eligible),
    allowedActionTypes,
    windowSeconds: parseWindowSeconds(raw.window),
    maxReseals: /重新封印一次|只允许.*一次/u.test(String(raw.window || "")) ? 1 : 0,
  };
}

function parseOpeningVariants(flow: Record<string, any>): PressureContentOpeningVariant[] {
  const variants: PressureContentOpeningVariant[] = [];
  for (const scene of array<Record<string, any>>(flow.scenes)) {
    for (const rawVariant of array<Record<string, any>>(scene.openingProjectionVariants)) {
      variants.push({
        openingProjectionId: String(rawVariant.openingProjectionId || ""),
        predecessorBranchId: String(rawVariant.predecessorBranchId || ""),
        predecessorFrozenResultId: String(rawVariant.predecessorFrozenResultId || ""),
        requiredFrozenFactIds: strings(rawVariant.requiredFrozenFactIds),
        requiredObjectVersionIds: strings(rawVariant.requiredObjectVersionIds),
        publicReferencedObjectVersionIds: strings(rawVariant.publicReferencedObjectVersionIds),
        seatPrivateProjections: array<Record<string, any>>(rawVariant.seatPrivateProjections).map((projection) => ({
          seatId: String(projection.seatId || ""),
          grantedFrozenFactIds: strings(projection.grantedFrozenFactIds),
          grantedObjectVersionIds: strings(projection.grantedObjectVersionIds),
          currentActorId: String(projection.currentActorId || ""),
        })),
        publicSceneId: typeof scene.sceneId === "string" ? scene.sceneId : undefined,
        raw: rawVariant,
      });
    }
  }
  return variants.sort((left, right) => left.openingProjectionId.localeCompare(right.openingProjectionId));
}

function knowledgeProvenance(raw: Record<string, any>): PressureKnowledgeProvenance {
  const sourceKind = String(raw.sourceKind || "").toUpperCase();
  if (sourceKind === "HANDOFF" || raw.handoffId) return "TRANSFERRED";
  if (sourceKind === "EVENT" || raw.eventId) return "SEAT_RECORD";
  if (sourceKind === "CLAIM" && strings(raw.knownBy).length > 1) return "PUBLIC";
  return "PRIVATE_ACTOR";
}

function parseKnownFact(raw: Record<string, any>): PressureContentKnownFact {
  return {
    factId: String(raw.factRefId || raw.factId || ""),
    provenance: knowledgeProvenance(raw),
    claimId: raw.claimId ? String(raw.claimId) : null,
    objectId: raw.objectId ? String(raw.objectId) : null,
    objectVersionId: raw.objectVersionId ? String(raw.objectVersionId) : null,
    handoffId: raw.handoffId ? String(raw.handoffId) : null,
    eventId: raw.eventId ? String(raw.eventId) : null,
  };
}

function parseSeat(raw: Record<string, any>): PressureContentSeat {
  const knownFacts = array<Record<string, any>>(raw.knownFacts).map(parseKnownFact).filter((fact) => fact.factId);
  const knownFactIds = strings(raw.knownFactIds);
  return {
    seatId: String(raw.seatId || ""),
    roleKey: String(raw.roleKey || ""),
    currentActorId: String(raw.currentActorId || ""),
    knownFactIds: knownFactIds.length ? knownFactIds : knownFacts.map((fact) => fact.factId),
    unknownFactIds: strings(raw.unknownFactIds),
    knownFacts,
    resources: strings(raw.resources),
    permissions: strings(raw.permissions),
    keyLeverageObjectIds: strings(raw.keyLeverageObjectIds),
    defaultPrepare: String(raw.defaultPrepare || ""),
    defaultCommit: String(raw.defaultCommit || ""),
  };
}

function parseBranch(raw: Record<string, any>): PressureContentBranch {
  const rawOutcomes: Record<string, any>[] = array<Record<string, any>>(raw.objectOutcomes).length
    ? array<Record<string, any>>(raw.objectOutcomes)
    : array<Record<string, any>>(raw.objectMutations).map((entry) => ({
        ...entry,
        resultVersionId: entry.resultVersionId || `${String(entry.objectId || "")}@${String(raw.frozenResultId || raw.branchId || "LOCKED")}`,
        status: entry.status || "LOCKED",
        custodyMode: entry.custodyMode || "FIXED",
      }));
  return {
    branchId: String(raw.branchId || ""),
    level: String(raw.level || "LOCKED").toUpperCase() as PressureContentBranch["level"],
    frozenResultId: String(raw.frozenResultId || ""),
    sceneId: typeof raw.sceneId === "string" ? raw.sceneId : undefined,
    transitionSceneId: typeof raw.transitionSceneId === "string" ? raw.transitionSceneId : undefined,
    frozenFactIds: strings(raw.frozenFactIds),
    objectOutcomes: rawOutcomes.map((outcome) => ({
      objectId: String(outcome.objectId || ""),
      versionId: String(outcome.versionId || outcome.resultVersionId || ""),
      status: String(outcome.status || "UNCHANGED"),
      custodyMode: String(outcome.custodyMode || "FIXED"),
      custodyRule: String(outcome.custodyRule || ""),
      knownBy: strings(outcome.knownBy),
      visibility: visibility(outcome.visibility),
      availableFrom: String(outcome.availableFrom || raw.frozenResultId || ""),
    })),
    responsibilityAndEvidenceFreeze: strings(raw.responsibilityAndEvidenceFreeze),
    trackDeltas: Object.fromEntries(Object.entries(record(raw.trackDeltas)).map(([key, value]) => [key, Number(value || 0)])),
    carryForward: strings(raw.carryForward),
    knownBy: strings(raw.knownBy),
    visibility: visibility(raw.visibility),
    raw,
  };
}

function parseHandoff(raw: Record<string, any>): PressureContentHandoff {
  return {
    handoffId: String(raw.handoffId || ""),
    afterNode: String(raw.afterNode || ""),
    seatId: String(raw.seatId || ""),
    fromActorId: String(raw.fromActorId || ""),
    toActorId: String(raw.toActorId || ""),
    permissionChange: strings(raw.permissionChange),
    inheritIf: strings(raw.inheritIf),
    neverAutoInherit: strings(raw.neverAutoInherit),
  };
}

function parseSignedNumber(value: unknown): number {
  const match = String(value || "").match(/[+-]?\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : 0;
}

function parseTimeDeltaMinutes(value: unknown): number {
  const text = String(value || "");
  if (/半日/u.test(text)) return 360;
  const hours = text.match(/([0-9]+)\s*(?:小时|时辰)/u);
  if (hours) return Number(hours[1]) * (/时辰/u.test(hours[0]) ? 120 : 60);
  const periods = text.match(/([0-9]+)\s*时段/u);
  if (periods) return Number(periods[1]) * 180;
  return /\+?1\s*时段/u.test(text) ? 180 : 0;
}

function parseDefaultPolicies(document: Record<string, any>): PressureContentDefaultPolicy[] {
  return array<Record<string, any>>(document.seatDefaults).map((entry) => ({
    defaultPolicyId: String(entry.defaultPolicyId || ""),
    seatId: String(entry.seatId || ""),
    currentActorId: String(entry.currentActorId || ""),
    prepareText: String(record(entry.normalNoSubmission).prepare || ""),
    commitText: String(record(entry.normalNoSubmission).commit || ""),
  }));
}

function parseInputFallbacks(document: Record<string, any>): PressureContentInputFallback[] {
  return array<Record<string, any>>(document.inputFallbackPolicies).map((entry) => ({
    fallbackId: String(entry.fallbackId || ""),
    inputClass: String(entry.inputClass || ""),
    actionRealization: String(entry.actionRealization || ""),
    timeDeltaMinutes: parseTimeDeltaMinutes(entry.timeAdvance),
    pressureDelta: parseSignedNumber(entry.pressureDelta),
  }));
}

export function loadPressureRuntimeContent(registryPath: string, strategyVersion: string): PressureRuntimeContent {
  const loaded = loadPressureSpinePackage(registryPath, strategyVersion);
  const sourceRoot = resolve(loaded.artifactRoot, loaded.registrationManifest.sourceDirectory);
  const seatsDocument = readJson<Record<string, any>>(resolve(sourceRoot, "global/seats.json"));
  const objectsDocument = readJson<Record<string, any>>(resolve(sourceRoot, "global/objects.json"));
  const handoffsDocument = readJson<Record<string, any>>(resolve(sourceRoot, "global/knowledge-and-handoffs.json"));
  const tracksDocument = readJson<Record<string, any>>(resolve(sourceRoot, "global/world-tracks.json"));
  const seatsById = new Map(array<Record<string, any>>(seatsDocument.seats).map((seat) => [String(seat.seatId), seat]));
  const objects: Record<string, PressureContentObject> = {};
  for (const raw of array<Record<string, any>>(objectsDocument.objects)) {
    const objectId = String(raw.objectId || "");
    objects[objectId] = {
      objectId,
      kind: String(raw.kind || "UNKNOWN"),
      initialCustody: String(raw.initialCustody || "UNKNOWN"),
      sourceStatus: String(raw.sourceStatus || "UNKNOWN"),
    };
  }

  const nodes: Record<string, PressureContentNode> = {};
  for (const nodeId of loaded.runtimeIndex.nodeIds) {
    const node = readJson<Record<string, any>>(resolve(sourceRoot, `nodes/${nodeId}/node.json`));
    const flow = readJson<Record<string, any>>(resolve(sourceRoot, `nodes/${nodeId}/scene-flow.json`));
    const seatContent = readJson<Record<string, any>>(resolve(sourceRoot, `nodes/${nodeId}/seat-content.json`));
    const defaults = readJson<Record<string, any>>(resolve(sourceRoot, `nodes/${nodeId}/npc-defaults.json`));
    const settlement = readJson<Record<string, any>>(resolve(sourceRoot, `nodes/${nodeId}/settlement.json`));
    const selector = record(settlement.branchSelector);
    const selectorMap = record(selector.selectors);
    const runtimeSeats = array<Record<string, any>>(seatContent.seats).map(parseSeat);
    for (const runtimeSeat of runtimeSeats) {
      if (!runtimeSeat.roleKey) runtimeSeat.roleKey = String(seatsById.get(runtimeSeat.seatId)?.roleKey || "");
    }
    const budget = record(node.actionBudget);
    const startState = record(node.startState);
    nodes[nodeId] = {
      nodeId,
      sequence: Number(node.sequence || 0),
      title: String(node.title || nodeId),
      nextNodeId: typeof node.nextNodeId === "string" ? node.nextNodeId : null,
      initialPressureLevel: Number(startState.pressureLevel || 0),
      initialTimeUsed: Number(startState.timeUsed || 0),
      actionBudget: {
        preparePerSeat: Number(budget.preparePerSeat || 0),
        commitPerSeat: Number(budget.commitPerSeat || 0),
        reactionPerSeat: Number(budget.reactionPerSeat || 0),
      },
      contestedObjectIds: strings(node.contestedObjectIds),
      secondaryObjectIds: strings(node.secondaryObjectIds),
      selectorInputKeys: array<Record<string, any>>(settlement.selectorInputs).map((input) => String(input.inputKey || "")).filter(Boolean),
      branchEvaluationOrder: strings(selector.evaluationOrder) as PressureContentNode["branchEvaluationOrder"],
      branchSelectors: Object.fromEntries(
        Object.entries(selectorMap).map(([level, rule]) => [level, rule as SelectorRule]),
      ) as PressureContentNode["branchSelectors"],
      defaultInputState: record(record(settlement.defaultTrajectory).defaultInputState),
      defaultBranchId: String(record(settlement.defaultTrajectory).defaultBranchId || array<Record<string, any>>(settlement.branches)[0]?.branchId || ""),
      branches: array<Record<string, any>>(settlement.branches).map(parseBranch),
      conflictPriorityOrder: strings(record(settlement.conflictComparator).priorityOrder),
      reaction: parseReaction(settlement.conditionalReaction),
      openingVariants: parseOpeningVariants(flow),
      seats: runtimeSeats,
      defaultPolicies: parseDefaultPolicies(defaults),
      inputFallbacks: parseInputFallbacks(defaults),
    };
  }

  return {
    schemaVersion: "pressure_runtime_content_v1",
    worldId: loaded.registrationManifest.templateKey,
    runtimeProfile: loaded.registrationManifest.runtimeProfile,
    strategyVersion,
    packageId: loaded.registrationManifest.packageId,
    packageVersion: loaded.registrationManifest.packageVersion,
    packageSha256: loaded.registrationManifest.sourcePackageSha256,
    contentTreeSha256: loaded.manifestLock.contentTreeSha256,
    sourceSha256: loaded.registrationManifest.sourceSha256,
    nodeIds: [...loaded.runtimeIndex.nodeIds],
    seatIds: [...loaded.runtimeIndex.seatIds],
    nodes,
    objects,
    handoffs: array<Record<string, any>>(handoffsDocument.handoffs).map(parseHandoff),
    worldTrackIds: array<Record<string, any>>(tracksDocument.tracks).map((track) => String(track.trackId || "")).filter(Boolean),
  };
}
