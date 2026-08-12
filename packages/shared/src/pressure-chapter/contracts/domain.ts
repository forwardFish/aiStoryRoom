import type { CanonicalJsonValue } from "./canonical";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
} from "./errors";
import { PRESSURE_CHAPTER_SEAT_IDS_V1 } from "./route";
import {
  assertOrderedBy,
  assertSelfHash,
  contractArray,
  contractEnum,
  contractInteger,
  contractLiteral,
  contractNumber,
  contractObject,
  contractSha256,
  contractString,
  contractStringArray,
  exactContractKeys,
  exactRecordKeys,
  scalarFact,
  type RawContract,
} from "./validation";

export const CHAPTER_IDS_V1 = Object.freeze([
  "N1",
  "N2",
  "N3",
  "N4",
  "N5",
  "N6",
  "N7",
] as const);

export const TRACK_IDS_V1 = Object.freeze([
  "civilian_land",
  "mulberry_silk",
  "fiscal_military",
  "evidence_responsibility",
  "court_imperial_face",
] as const);

export type ChapterIdV1 = (typeof CHAPTER_IDS_V1)[number];
export type SeatIdV1 = (typeof PRESSURE_CHAPTER_SEAT_IDS_V1)[number];
export type TrackIdV1 = (typeof TRACK_IDS_V1)[number];
export type ScalarFactValueV1 = string | number | boolean | null;

export interface TrackStateV1 {
  schemaVersion: "sangtian_track_state_v1";
  values: Record<TrackIdV1, number>;
  stateHash: string;
}

export interface ObjectStateV1 {
  objectId: string;
  version: number;
  stateCode: string;
  holderSeatId: SeatIdV1 | null;
  quantity: number | null;
  tags: string[];
  factRefs: string[];
}

export interface KnowledgeStateV1 {
  seatId: SeatIdV1;
  knownFactRefs: string[];
  secretRefs: string[];
  disclosedToSeatIds: SeatIdV1[];
  stateHash: string;
}

export interface EvidenceStateV1 {
  evidenceId: string;
  version: number;
  status: "ACTIVE" | "CONTESTED" | "INVALIDATED" | "SEALED";
  holderSeatIds: SeatIdV1[];
  supportsFactRefs: string[];
  visibilityPolicyRef: string;
}

export interface ResponsibilityStateV1 {
  responsibilityId: string;
  subjectSeatId: SeatIdV1;
  sourceFactRefs: string[];
  level: number;
  status: "OPEN" | "ACKNOWLEDGED" | "TRANSFERRED" | "RESOLVED";
}

export interface SeatArcStateV1 {
  seatId: SeatIdV1;
  arcStage: string;
  publicGoalProgress: number;
  privateGoalProgress: number;
  gainRefs: string[];
  lossRefs: string[];
  costRefs: string[];
  stateHash: string;
}

export interface WorldStateV1 {
  schemaVersion: "sangtian_world_state_v1";
  worldSequence: number;
  factValues: Record<string, ScalarFactValueV1>;
  resources: Record<string, number>;
  tracks: TrackStateV1;
  objects: ObjectStateV1[];
  knowledgeBySeat: Record<SeatIdV1, KnowledgeStateV1>;
  evidence: EvidenceStateV1[];
  responsibilities: ResponsibilityStateV1[];
  seatArcs: Record<SeatIdV1, SeatArcStateV1>;
  stateHash: string;
}

export interface CausalEdgeV1 {
  causeRef: string;
  effectRef: string;
  relation:
    | "ENABLES"
    | "PREVENTS"
    | "SUPPORTS"
    | "CONFLICTS"
    | "COSTS"
    | "REVEALS"
    | "ASSIGNS_RESPONSIBILITY";
  evidenceRefs: string[];
}

export interface WorkingDeltaV1 {
  workingFactMutations: Array<{
    factRef: string;
    before: ScalarFactValueV1;
    after: ScalarFactValueV1;
  }>;
  commitmentMutations: Array<{
    commitmentId: string;
    operation: "CREATE" | "FULFILL" | "BREAK" | "CANCEL";
    seatIds: SeatIdV1[];
    sourceActionId: string;
  }>;
  knowledgeMutations: Array<{
    seatId: SeatIdV1;
    addFactRefs: string[];
    removeFactRefs: string[];
  }>;
  seatArcWorkingMutations: Array<{
    seatId: SeatIdV1;
    progressDelta: number;
    sourceActionId: string;
  }>;
}

export interface ResourceReservationMutationV1 {
  reservationKey: string;
  seatId: SeatIdV1;
  resourceId: string;
  amount: number;
  operation: "RESERVE" | "RELEASE" | "CONSUME";
  sourceActionId: string;
}

export interface WorldDeltaV1 {
  factMutations: Array<{
    factRef: string;
    before: ScalarFactValueV1;
    after: ScalarFactValueV1;
  }>;
  resourceMutations: Array<{
    resourceId: string;
    before: number;
    after: number;
    sourceRefs: string[];
  }>;
}

export interface SeatArcDeltaV1 {
  seatId: SeatIdV1;
  beforeStateHash: string;
  afterState: SeatArcStateV1;
  sourceRefs: string[];
}

export type TrackDeltaV1 = Partial<Record<TrackIdV1, number>>;

export interface ObjectKnowledgeEvidenceResponsibilityDeltaV1 {
  objectStates: ObjectStateV1[];
  knowledgeStates: KnowledgeStateV1[];
  evidenceStates: EvidenceStateV1[];
  responsibilityStates: ResponsibilityStateV1[];
}

export interface CarryForwardV1 {
  nextChapterId: ChapterIdV1 | "FINALE";
  unlockedContentRefs: string[];
  unresolvedCommitmentRefs: string[];
  pendingConsequenceRefs: string[];
  carryForwardHash: string;
}

export type DeterministicPredicateV1 =
  | { op: "ALL" | "ANY"; clauses: DeterministicPredicateV1[] }
  | { op: "NOT"; clause: DeterministicPredicateV1 }
  | {
      op: "COMPARE";
      factRef: string;
      comparator: "EQ" | "NE" | "GT" | "GTE" | "LT" | "LTE" | "IN";
      value: ScalarFactValueV1 | ScalarFactValueV1[];
    };

export interface DeadlinePolicyV1 {
  durationMs: number;
  clock: "SERVER_MONOTONIC";
  expiryAction: "APPLY_DEFAULT" | "FAIL_CLOSED";
}

export interface DeterministicDefaultPolicyV1 {
  policyRef: string;
  actionType: string;
  payload: Record<string, ScalarFactValueV1>;
  policyHash: string;
}

export interface SangtianFinaleCompiledRulesV1 {
  schemaVersion: "sangtian_finale_compiled_rules_v1";
  worldOutcomeRuleRefs: string[];
  seatVerdictRuleRefs: Record<SeatIdV1, string[]>;
  disclosureRuleRefs: string[];
  rulesHash: string;
}

export function chapterSequence(chapterId: ChapterIdV1): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return (CHAPTER_IDS_V1.indexOf(chapterId) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export function nextChapterId(chapterId: ChapterIdV1): ChapterIdV1 | "FINALE" {
  const next = (CHAPTER_IDS_V1 as readonly ChapterIdV1[])[chapterSequence(chapterId)];
  return next ?? "FINALE";
}

export function validateChapterIdV1(value: unknown, path: string): ChapterIdV1 {
  return contractEnum(value, CHAPTER_IDS_V1, path);
}

export function validateSeatIdV1(value: unknown, path: string): SeatIdV1 {
  return contractEnum(value, PRESSURE_CHAPTER_SEAT_IDS_V1, path);
}

export function validateTrackIdV1(value: unknown, path: string): TrackIdV1 {
  return contractEnum(value, TRACK_IDS_V1, path);
}

export function validateWorldStateV1(value: unknown, path = "worldState"): WorldStateV1 {
  const world = contractObject(value, path);
  exactContractKeys(world, [
    "schemaVersion",
    "worldSequence",
    "factValues",
    "resources",
    "tracks",
    "objects",
    "knowledgeBySeat",
    "evidence",
    "responsibilities",
    "seatArcs",
    "stateHash",
  ], path);
  contractLiteral(
    world.schemaVersion,
    "sangtian_world_state_v1",
    `${path}.schemaVersion`,
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractInteger(world.worldSequence, `${path}.worldSequence`, 0, 7);
  validateScalarRecord(world.factValues, `${path}.factValues`);
  validateNumberRecord(world.resources, `${path}.resources`, 0);
  validateTrackState(world.tracks, `${path}.tracks`);
  validateObjectStates(world.objects, `${path}.objects`);

  const knowledge = exactRecordKeys(
    world.knowledgeBySeat,
    PRESSURE_CHAPTER_SEAT_IDS_V1,
    `${path}.knowledgeBySeat`,
  );
  const arcs = exactRecordKeys(
    world.seatArcs,
    PRESSURE_CHAPTER_SEAT_IDS_V1,
    `${path}.seatArcs`,
  );
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    const knowledgeState = validateKnowledgeState(
      knowledge[seatId],
      `${path}.knowledgeBySeat.${seatId}`,
    );
    const arc = validateSeatArcState(arcs[seatId], `${path}.seatArcs.${seatId}`);
    if (knowledgeState.seatId !== seatId || arc.seatId !== seatId) {
      failPressureContract(
        ERROR.CONTRACT_REFERENCE_MISMATCH,
        `${path}.${seatId}`,
        "MAP_KEY_SEAT_MISMATCH",
      );
    }
  }
  validateEvidenceStates(world.evidence, `${path}.evidence`);
  validateResponsibilityStates(world.responsibilities, `${path}.responsibilities`);
  assertSelfHash(world, "stateHash", path);
  return world as unknown as WorldStateV1;
}

export function validateWorkingDeltaV1(value: unknown, path = "workingDelta"): WorkingDeltaV1 {
  const delta = contractObject(value, path);
  exactContractKeys(delta, [
    "workingFactMutations",
    "commitmentMutations",
    "knowledgeMutations",
    "seatArcWorkingMutations",
  ], path);
  validateFactMutations(delta.workingFactMutations, `${path}.workingFactMutations`);

  const commitments = contractArray(delta.commitmentMutations, `${path}.commitmentMutations`)
    .map((item, index) => {
      const itemPath = `${path}.commitmentMutations[${index}]`;
      const mutation = contractObject(item, itemPath);
      exactContractKeys(
        mutation,
        ["commitmentId", "operation", "seatIds", "sourceActionId"],
        itemPath,
      );
      contractString(mutation.commitmentId, `${itemPath}.commitmentId`);
      contractEnum(
        mutation.operation,
        ["CREATE", "FULFILL", "BREAK", "CANCEL"] as const,
        `${itemPath}.operation`,
      );
      validateOrderedSeatArray(mutation.seatIds, `${itemPath}.seatIds`, true);
      contractString(mutation.sourceActionId, `${itemPath}.sourceActionId`);
      return mutation;
    });
  assertOrderedBy(commitments, (item) => String(item.commitmentId), `${path}.commitmentMutations`);

  const knowledge = contractArray(delta.knowledgeMutations, `${path}.knowledgeMutations`)
    .map((item, index) => {
      const itemPath = `${path}.knowledgeMutations[${index}]`;
      const mutation = contractObject(item, itemPath);
      exactContractKeys(mutation, ["seatId", "addFactRefs", "removeFactRefs"], itemPath);
      validateSeatIdV1(mutation.seatId, `${itemPath}.seatId`);
      contractStringArray(mutation.addFactRefs, `${itemPath}.addFactRefs`, { sorted: true });
      contractStringArray(mutation.removeFactRefs, `${itemPath}.removeFactRefs`, { sorted: true });
      return mutation;
    });
  assertOrderedBy(
    knowledge,
    (item) => String(item.seatId),
    `${path}.knowledgeMutations`,
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );

  const arcs = contractArray(delta.seatArcWorkingMutations, `${path}.seatArcWorkingMutations`)
    .map((item, index) => {
      const itemPath = `${path}.seatArcWorkingMutations[${index}]`;
      const mutation = contractObject(item, itemPath);
      exactContractKeys(mutation, ["seatId", "progressDelta", "sourceActionId"], itemPath);
      validateSeatIdV1(mutation.seatId, `${itemPath}.seatId`);
      contractNumber(mutation.progressDelta, `${itemPath}.progressDelta`);
      contractString(mutation.sourceActionId, `${itemPath}.sourceActionId`);
      return mutation;
    });
  assertOrderedBy(
    arcs,
    (item) => String(item.seatId),
    `${path}.seatArcWorkingMutations`,
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );
  return delta as unknown as WorkingDeltaV1;
}

export function validateResourceReservationMutationsV1(
  value: unknown,
  path = "reservationMutations",
): ResourceReservationMutationV1[] {
  const mutations = contractArray(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const mutation = contractObject(item, itemPath);
    exactContractKeys(mutation, [
      "reservationKey",
      "seatId",
      "resourceId",
      "amount",
      "operation",
      "sourceActionId",
    ], itemPath);
    contractString(mutation.reservationKey, `${itemPath}.reservationKey`);
    validateSeatIdV1(mutation.seatId, `${itemPath}.seatId`);
    contractString(mutation.resourceId, `${itemPath}.resourceId`);
    contractNumber(mutation.amount, `${itemPath}.amount`, 0);
    contractEnum(
      mutation.operation,
      ["RESERVE", "RELEASE", "CONSUME"] as const,
      `${itemPath}.operation`,
    );
    contractString(mutation.sourceActionId, `${itemPath}.sourceActionId`);
    return mutation;
  });
  assertOrderedBy(mutations, (item) => String(item.reservationKey), path);
  return mutations as unknown as ResourceReservationMutationV1[];
}

export function validateWorldDeltaV1(value: unknown, path = "worldDelta"): WorldDeltaV1 {
  const delta = contractObject(value, path);
  exactContractKeys(delta, ["factMutations", "resourceMutations"], path);
  validateFactMutations(delta.factMutations, `${path}.factMutations`);
  const resources = contractArray(delta.resourceMutations, `${path}.resourceMutations`)
    .map((item, index) => {
      const itemPath = `${path}.resourceMutations[${index}]`;
      const mutation = contractObject(item, itemPath);
      exactContractKeys(mutation, ["resourceId", "before", "after", "sourceRefs"], itemPath);
      contractString(mutation.resourceId, `${itemPath}.resourceId`);
      contractNumber(mutation.before, `${itemPath}.before`, 0);
      contractNumber(mutation.after, `${itemPath}.after`, 0);
      contractStringArray(mutation.sourceRefs, `${itemPath}.sourceRefs`, {
        nonEmpty: true,
        sorted: true,
      });
      return mutation;
    });
  assertOrderedBy(resources, (item) => String(item.resourceId), `${path}.resourceMutations`);
  return delta as unknown as WorldDeltaV1;
}

export function validateSeatArcDeltasV1(value: unknown, path = "seatArcDeltas"): SeatArcDeltaV1[] {
  const deltas = contractArray(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const delta = contractObject(item, itemPath);
    exactContractKeys(delta, ["seatId", "beforeStateHash", "afterState", "sourceRefs"], itemPath);
    const seatId = validateSeatIdV1(delta.seatId, `${itemPath}.seatId`);
    contractSha256(delta.beforeStateHash, `${itemPath}.beforeStateHash`);
    const after = validateSeatArcState(delta.afterState, `${itemPath}.afterState`);
    if (after.seatId !== seatId) {
      failPressureContract(ERROR.CONTRACT_REFERENCE_MISMATCH, `${itemPath}.afterState.seatId`);
    }
    contractStringArray(delta.sourceRefs, `${itemPath}.sourceRefs`, { nonEmpty: true, sorted: true });
    return delta;
  });
  assertOrderedBy(deltas, (item) => String(item.seatId), path, PRESSURE_CHAPTER_SEAT_IDS_V1);
  return deltas as unknown as SeatArcDeltaV1[];
}

export function validateTrackDeltaV1(value: unknown, path = "trackDelta"): TrackDeltaV1 {
  const delta = contractObject(value, path);
  const unknown = Object.keys(delta).find((key) => !TRACK_IDS_V1.includes(key as TrackIdV1));
  if (unknown) failPressureContract(ERROR.CONTRACT_UNKNOWN_FIELD, `${path}.${unknown}`);
  for (const [trackId, amount] of Object.entries(delta)) {
    validateTrackIdV1(trackId, `${path}.${trackId}`);
    contractNumber(amount, `${path}.${trackId}`);
  }
  return delta as TrackDeltaV1;
}

export function validateObjectKnowledgeEvidenceResponsibilityDeltaV1(
  value: unknown,
  path = "objectKnowledgeEvidenceResponsibilityDelta",
): ObjectKnowledgeEvidenceResponsibilityDeltaV1 {
  const delta = contractObject(value, path);
  exactContractKeys(delta, [
    "objectStates",
    "knowledgeStates",
    "evidenceStates",
    "responsibilityStates",
  ], path);
  validateObjectStates(delta.objectStates, `${path}.objectStates`);
  const knowledge = contractArray(delta.knowledgeStates, `${path}.knowledgeStates`)
    .map((item, index) => validateKnowledgeState(item, `${path}.knowledgeStates[${index}]`));
  assertOrderedBy(
    knowledge,
    (item) => item.seatId,
    `${path}.knowledgeStates`,
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );
  validateEvidenceStates(delta.evidenceStates, `${path}.evidenceStates`);
  validateResponsibilityStates(delta.responsibilityStates, `${path}.responsibilityStates`);
  return delta as unknown as ObjectKnowledgeEvidenceResponsibilityDeltaV1;
}

export function validateCausalEdgesV1(value: unknown, path = "causalEdges"): CausalEdgeV1[] {
  const edges = contractArray(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const edge = contractObject(item, itemPath);
    exactContractKeys(edge, ["causeRef", "effectRef", "relation", "evidenceRefs"], itemPath);
    contractString(edge.causeRef, `${itemPath}.causeRef`);
    contractString(edge.effectRef, `${itemPath}.effectRef`);
    contractEnum(edge.relation, [
      "ENABLES",
      "PREVENTS",
      "SUPPORTS",
      "CONFLICTS",
      "COSTS",
      "REVEALS",
      "ASSIGNS_RESPONSIBILITY",
    ] as const, `${itemPath}.relation`);
    contractStringArray(edge.evidenceRefs, `${itemPath}.evidenceRefs`, { sorted: true });
    return edge;
  });
  assertOrderedBy(
    edges,
    (edge) => `${String(edge.causeRef)}\u0000${String(edge.effectRef)}\u0000${String(edge.relation)}`,
    path,
  );
  return edges as unknown as CausalEdgeV1[];
}

export function validateCarryForwardV1(value: unknown, path = "carryForward"): CarryForwardV1 {
  const carry = contractObject(value, path);
  exactContractKeys(carry, [
    "nextChapterId",
    "unlockedContentRefs",
    "unresolvedCommitmentRefs",
    "pendingConsequenceRefs",
    "carryForwardHash",
  ], path);
  contractEnum(carry.nextChapterId, [...CHAPTER_IDS_V1, "FINALE"] as const, `${path}.nextChapterId`);
  for (const field of [
    "unlockedContentRefs",
    "unresolvedCommitmentRefs",
    "pendingConsequenceRefs",
  ] as const) {
    contractStringArray(carry[field], `${path}.${field}`, { sorted: true });
  }
  assertSelfHash(carry, "carryForwardHash", path);
  return carry as unknown as CarryForwardV1;
}

export function validateDeterministicPredicateV1(
  value: unknown,
  path = "predicate",
): DeterministicPredicateV1 {
  const predicate = contractObject(value, path);
  const op = contractEnum(
    predicate.op,
    ["ALL", "ANY", "NOT", "COMPARE"] as const,
    `${path}.op`,
  );
  if (op === "ALL" || op === "ANY") {
    exactContractKeys(predicate, ["op", "clauses"], path);
    const clauses = contractArray(predicate.clauses, `${path}.clauses`);
    if (clauses.length === 0) {
      failPressureContract(ERROR.CONTRACT_FIELD_INVALID, `${path}.clauses`, "NON_EMPTY_ARRAY");
    }
    clauses.forEach((clause, index) =>
      validateDeterministicPredicateV1(clause, `${path}.clauses[${index}]`),
    );
  } else if (op === "NOT") {
    exactContractKeys(predicate, ["op", "clause"], path);
    validateDeterministicPredicateV1(predicate.clause, `${path}.clause`);
  } else {
    exactContractKeys(predicate, ["op", "factRef", "comparator", "value"], path);
    contractString(predicate.factRef, `${path}.factRef`);
    const comparator = contractEnum(
      predicate.comparator,
      ["EQ", "NE", "GT", "GTE", "LT", "LTE", "IN"] as const,
      `${path}.comparator`,
    );
    if (Array.isArray(predicate.value)) {
      if (comparator !== "IN" || predicate.value.length === 0) {
        failPressureContract(ERROR.CONTRACT_FIELD_INVALID, `${path}.value`, "IN_NON_EMPTY_ARRAY");
      }
      predicate.value.forEach((item, index) => scalarFact(item, `${path}.value[${index}]`));
    } else {
      if (comparator === "IN") {
        failPressureContract(ERROR.CONTRACT_FIELD_INVALID, `${path}.value`, "IN_REQUIRES_ARRAY");
      }
      scalarFact(predicate.value, `${path}.value`);
    }
  }
  return predicate as unknown as DeterministicPredicateV1;
}

export function validateDeadlinePolicyV1(value: unknown, path = "deadlinePolicy"): DeadlinePolicyV1 {
  const policy = contractObject(value, path);
  exactContractKeys(policy, ["durationMs", "clock", "expiryAction"], path);
  contractInteger(policy.durationMs, `${path}.durationMs`, 1);
  contractLiteral(policy.clock, "SERVER_MONOTONIC", `${path}.clock`);
  contractEnum(policy.expiryAction, ["APPLY_DEFAULT", "FAIL_CLOSED"] as const, `${path}.expiryAction`);
  return policy as unknown as DeadlinePolicyV1;
}

export function validateDeterministicDefaultPolicyV1(
  value: unknown,
  path = "defaultPolicy",
): DeterministicDefaultPolicyV1 {
  const policy = contractObject(value, path);
  exactContractKeys(policy, ["policyRef", "actionType", "payload", "policyHash"], path);
  contractString(policy.policyRef, `${path}.policyRef`);
  contractString(policy.actionType, `${path}.actionType`);
  validateScalarRecord(policy.payload, `${path}.payload`);
  assertSelfHash(policy, "policyHash", path);
  return policy as unknown as DeterministicDefaultPolicyV1;
}

export function validateSangtianFinaleCompiledRulesV1(
  value: unknown,
  path = "compiledRules",
): SangtianFinaleCompiledRulesV1 {
  const rules = contractObject(value, path);
  exactContractKeys(rules, [
    "schemaVersion",
    "worldOutcomeRuleRefs",
    "seatVerdictRuleRefs",
    "disclosureRuleRefs",
    "rulesHash",
  ], path);
  contractLiteral(
    rules.schemaVersion,
    "sangtian_finale_compiled_rules_v1",
    `${path}.schemaVersion`,
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractStringArray(rules.worldOutcomeRuleRefs, `${path}.worldOutcomeRuleRefs`, {
    nonEmpty: true,
    sorted: true,
  });
  const seatRules = exactRecordKeys(
    rules.seatVerdictRuleRefs,
    PRESSURE_CHAPTER_SEAT_IDS_V1,
    `${path}.seatVerdictRuleRefs`,
  );
  for (const seatId of PRESSURE_CHAPTER_SEAT_IDS_V1) {
    contractStringArray(seatRules[seatId], `${path}.seatVerdictRuleRefs.${seatId}`, {
      nonEmpty: true,
      sorted: true,
    });
  }
  contractStringArray(rules.disclosureRuleRefs, `${path}.disclosureRuleRefs`, { sorted: true });
  assertSelfHash(rules, "rulesHash", path);
  return rules as unknown as SangtianFinaleCompiledRulesV1;
}

function validateTrackState(value: unknown, path: string): TrackStateV1 {
  const tracks = contractObject(value, path);
  exactContractKeys(tracks, ["schemaVersion", "values", "stateHash"], path);
  contractLiteral(
    tracks.schemaVersion,
    "sangtian_track_state_v1",
    `${path}.schemaVersion`,
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  const values = exactRecordKeys(tracks.values, TRACK_IDS_V1, `${path}.values`);
  for (const trackId of TRACK_IDS_V1) contractNumber(values[trackId], `${path}.values.${trackId}`);
  assertSelfHash(tracks, "stateHash", path);
  return tracks as unknown as TrackStateV1;
}

function validateObjectStates(value: unknown, path: string): ObjectStateV1[] {
  const objects = contractArray(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const object = contractObject(item, itemPath);
    exactContractKeys(object, [
      "objectId",
      "version",
      "stateCode",
      "holderSeatId",
      "quantity",
      "tags",
      "factRefs",
    ], itemPath);
    contractString(object.objectId, `${itemPath}.objectId`);
    contractInteger(object.version, `${itemPath}.version`, 0);
    contractString(object.stateCode, `${itemPath}.stateCode`);
    if (object.holderSeatId !== null) validateSeatIdV1(object.holderSeatId, `${itemPath}.holderSeatId`);
    if (object.quantity !== null) contractNumber(object.quantity, `${itemPath}.quantity`, 0);
    contractStringArray(object.tags, `${itemPath}.tags`, { sorted: true });
    contractStringArray(object.factRefs, `${itemPath}.factRefs`, { sorted: true });
    return object;
  });
  assertOrderedBy(objects, (item) => String(item.objectId), path);
  return objects as unknown as ObjectStateV1[];
}

function validateKnowledgeState(value: unknown, path: string): KnowledgeStateV1 {
  const knowledge = contractObject(value, path);
  exactContractKeys(knowledge, [
    "seatId",
    "knownFactRefs",
    "secretRefs",
    "disclosedToSeatIds",
    "stateHash",
  ], path);
  validateSeatIdV1(knowledge.seatId, `${path}.seatId`);
  contractStringArray(knowledge.knownFactRefs, `${path}.knownFactRefs`, { sorted: true });
  contractStringArray(knowledge.secretRefs, `${path}.secretRefs`, { sorted: true });
  validateOrderedSeatArray(knowledge.disclosedToSeatIds, `${path}.disclosedToSeatIds`);
  assertSelfHash(knowledge, "stateHash", path);
  return knowledge as unknown as KnowledgeStateV1;
}

function validateEvidenceStates(value: unknown, path: string): EvidenceStateV1[] {
  const evidence = contractArray(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const state = contractObject(item, itemPath);
    exactContractKeys(state, [
      "evidenceId",
      "version",
      "status",
      "holderSeatIds",
      "supportsFactRefs",
      "visibilityPolicyRef",
    ], itemPath);
    contractString(state.evidenceId, `${itemPath}.evidenceId`);
    contractInteger(state.version, `${itemPath}.version`, 0);
    contractEnum(state.status, ["ACTIVE", "CONTESTED", "INVALIDATED", "SEALED"] as const, `${itemPath}.status`);
    validateOrderedSeatArray(state.holderSeatIds, `${itemPath}.holderSeatIds`);
    contractStringArray(state.supportsFactRefs, `${itemPath}.supportsFactRefs`, { sorted: true });
    contractString(state.visibilityPolicyRef, `${itemPath}.visibilityPolicyRef`);
    return state;
  });
  assertOrderedBy(evidence, (item) => String(item.evidenceId), path);
  return evidence as unknown as EvidenceStateV1[];
}

function validateResponsibilityStates(value: unknown, path: string): ResponsibilityStateV1[] {
  const responsibilities = contractArray(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const state = contractObject(item, itemPath);
    exactContractKeys(state, [
      "responsibilityId",
      "subjectSeatId",
      "sourceFactRefs",
      "level",
      "status",
    ], itemPath);
    contractString(state.responsibilityId, `${itemPath}.responsibilityId`);
    validateSeatIdV1(state.subjectSeatId, `${itemPath}.subjectSeatId`);
    contractStringArray(state.sourceFactRefs, `${itemPath}.sourceFactRefs`, { nonEmpty: true, sorted: true });
    contractNumber(state.level, `${itemPath}.level`, 0);
    contractEnum(state.status, ["OPEN", "ACKNOWLEDGED", "TRANSFERRED", "RESOLVED"] as const, `${itemPath}.status`);
    return state;
  });
  assertOrderedBy(responsibilities, (item) => String(item.responsibilityId), path);
  return responsibilities as unknown as ResponsibilityStateV1[];
}

function validateSeatArcState(value: unknown, path: string): SeatArcStateV1 {
  const arc = contractObject(value, path);
  exactContractKeys(arc, [
    "seatId",
    "arcStage",
    "publicGoalProgress",
    "privateGoalProgress",
    "gainRefs",
    "lossRefs",
    "costRefs",
    "stateHash",
  ], path);
  validateSeatIdV1(arc.seatId, `${path}.seatId`);
  contractString(arc.arcStage, `${path}.arcStage`);
  contractNumber(arc.publicGoalProgress, `${path}.publicGoalProgress`);
  contractNumber(arc.privateGoalProgress, `${path}.privateGoalProgress`);
  for (const field of ["gainRefs", "lossRefs", "costRefs"] as const) {
    contractStringArray(arc[field], `${path}.${field}`, { sorted: true });
  }
  assertSelfHash(arc, "stateHash", path);
  return arc as unknown as SeatArcStateV1;
}

function validateOrderedSeatArray(value: unknown, path: string, nonEmpty = false): SeatIdV1[] {
  const seats = contractArray(value, path).map((seatId, index) =>
    validateSeatIdV1(seatId, `${path}[${index}]`),
  );
  if (nonEmpty && seats.length === 0) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, path, "NON_EMPTY_ARRAY");
  }
  assertOrderedBy(seats, (seatId) => seatId, path, PRESSURE_CHAPTER_SEAT_IDS_V1);
  return seats;
}

function validateScalarRecord(value: unknown, path: string): Record<string, ScalarFactValueV1> {
  const record = contractObject(value, path);
  for (const [key, item] of Object.entries(record)) {
    contractString(key, `${path}.[key]`);
    scalarFact(item, `${path}.${key}`);
  }
  return record as Record<string, ScalarFactValueV1>;
}

function validateNumberRecord(value: unknown, path: string, minimum: number): Record<string, number> {
  const record = contractObject(value, path);
  for (const [key, item] of Object.entries(record)) {
    contractString(key, `${path}.[key]`);
    contractNumber(item, `${path}.${key}`, minimum);
  }
  return record as Record<string, number>;
}

function validateFactMutations(value: unknown, path: string): RawContract[] {
  const mutations = contractArray(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const mutation = contractObject(item, itemPath);
    exactContractKeys(mutation, ["factRef", "before", "after"], itemPath);
    contractString(mutation.factRef, `${itemPath}.factRef`);
    scalarFact(mutation.before, `${itemPath}.before`);
    scalarFact(mutation.after, `${itemPath}.after`);
    return mutation;
  });
  assertOrderedBy(mutations, (item) => String(item.factRef), path);
  return mutations;
}

export type DomainCanonicalValueV1 = CanonicalJsonValue;
