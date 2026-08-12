import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";

const DRAFT = "https://json-schema.org/draft/2020-12/schema";
const BASE_ID = "https://our-many-worlds.local/schemas/pressure-chapter/pressure-chapter-v1.schema.json";

const CHAPTER_IDS = ["N1", "N2", "N3", "N4", "N5", "N6", "N7"];
const SEAT_IDS = [
  "cabinet_finance",
  "jiangnan_merchant",
  "qingliu_law",
  "sili_weaving",
  "zhejiang_administration",
  "zhejiang_governor",
];
const TRACK_IDS = [
  "civilian_land",
  "mulberry_silk",
  "fiscal_military",
  "evidence_responsibility",
  "court_imperial_face",
];

const ref = (name) => ({ $ref: `#/$defs/${name}` });
const literal = (value) => ({ const: value });
const enumString = (values) => ({ type: "string", enum: values });
const string = { type: "string", minLength: 1 };
const nullableString = { anyOf: [string, { type: "null" }] };
const number = { type: "number" };
const nonNegativeNumber = { type: "number", minimum: 0 };
const integer = (minimum = 0, maximum = 9007199254740991) => ({
  type: "integer",
  minimum,
  maximum,
});
const sha256 = { type: "string", pattern: "^[a-f0-9]{64}$" };
const isoTimestamp = { type: "string", format: "date-time" };
const array = (items, options = {}) => ({ type: "array", items, ...options });
const strings = (options = {}) => array(string, { uniqueItems: true, ...options });
const exact = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
const record = (value) => ({
  type: "object",
  propertyNames: { type: "string", minLength: 1 },
  additionalProperties: value,
});
const fixedRecord = (keys, value) => exact(Object.fromEntries(keys.map((key) => [key, value])));
const fixedTuple = (items) => ({
  type: "array",
  prefixItems: items,
  items: false,
  minItems: items.length,
  maxItems: items.length,
});

const root = (schemaVersion, properties, required = Object.keys(properties)) => exact({
  schemaVersion: literal(schemaVersion),
  ...properties,
}, required.includes("schemaVersion") ? required : ["schemaVersion", ...required]);

const defs = {};

defs.ChapterIdV1 = enumString(CHAPTER_IDS);
defs.SeatIdV1 = enumString(SEAT_IDS);
defs.TrackIdV1 = enumString(TRACK_IDS);
defs.ScalarFactValueV1 = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
};
defs.CanonicalJsonValue = {
  anyOf: [
    ref("ScalarFactValueV1"),
    array(ref("CanonicalJsonValue")),
    { type: "object", additionalProperties: ref("CanonicalJsonValue") },
  ],
};
defs.CanonicalJsonObject = {
  type: "object",
  additionalProperties: ref("CanonicalJsonValue"),
};
defs.Sha256 = sha256;
defs.NonEmptyString = string;
defs.SeatIdArray = array(ref("SeatIdV1"), { uniqueItems: true });
defs.StringSet = strings();
defs.ScalarFactRecord = record(ref("ScalarFactValueV1"));
defs.NonNegativeNumberRecord = record(nonNegativeNumber);

defs.TrackStateV1 = root("sangtian_track_state_v1", {
  values: fixedRecord(TRACK_IDS, number),
  stateHash: ref("Sha256"),
});
defs.ObjectStateV1 = exact({
  objectId: string,
  version: integer(),
  stateCode: string,
  holderSeatId: { anyOf: [ref("SeatIdV1"), { type: "null" }] },
  quantity: { anyOf: [nonNegativeNumber, { type: "null" }] },
  tags: ref("StringSet"),
  factRefs: ref("StringSet"),
});
defs.KnowledgeStateV1 = exact({
  seatId: ref("SeatIdV1"),
  knownFactRefs: ref("StringSet"),
  secretRefs: ref("StringSet"),
  disclosedToSeatIds: ref("SeatIdArray"),
  stateHash: ref("Sha256"),
});
defs.EvidenceStateV1 = exact({
  evidenceId: string,
  version: integer(),
  status: enumString(["ACTIVE", "CONTESTED", "INVALIDATED", "SEALED"]),
  holderSeatIds: ref("SeatIdArray"),
  supportsFactRefs: ref("StringSet"),
  visibilityPolicyRef: string,
});
defs.ResponsibilityStateV1 = exact({
  responsibilityId: string,
  subjectSeatId: ref("SeatIdV1"),
  sourceFactRefs: strings({ minItems: 1 }),
  level: nonNegativeNumber,
  status: enumString(["OPEN", "ACKNOWLEDGED", "TRANSFERRED", "RESOLVED"]),
});
defs.SeatArcStateV1 = exact({
  seatId: ref("SeatIdV1"),
  arcStage: string,
  publicGoalProgress: number,
  privateGoalProgress: number,
  gainRefs: ref("StringSet"),
  lossRefs: ref("StringSet"),
  costRefs: ref("StringSet"),
  stateHash: ref("Sha256"),
});
defs.WorldStateV1 = root("sangtian_world_state_v1", {
  worldSequence: integer(0, 7),
  factValues: ref("ScalarFactRecord"),
  resources: ref("NonNegativeNumberRecord"),
  tracks: ref("TrackStateV1"),
  objects: array(ref("ObjectStateV1"), { uniqueItems: true }),
  knowledgeBySeat: fixedRecord(SEAT_IDS, ref("KnowledgeStateV1")),
  evidence: array(ref("EvidenceStateV1"), { uniqueItems: true }),
  responsibilities: array(ref("ResponsibilityStateV1"), { uniqueItems: true }),
  seatArcs: fixedRecord(SEAT_IDS, ref("SeatArcStateV1")),
  stateHash: ref("Sha256"),
});
defs.CausalEdgeV1 = exact({
  causeRef: string,
  effectRef: string,
  relation: enumString([
    "ENABLES",
    "PREVENTS",
    "SUPPORTS",
    "CONFLICTS",
    "COSTS",
    "REVEALS",
    "ASSIGNS_RESPONSIBILITY",
  ]),
  evidenceRefs: ref("StringSet"),
});
defs.FactMutationV1 = exact({
  factRef: string,
  before: ref("ScalarFactValueV1"),
  after: ref("ScalarFactValueV1"),
});
defs.CommitmentMutationV1 = exact({
  commitmentId: string,
  operation: enumString(["CREATE", "FULFILL", "BREAK", "CANCEL"]),
  seatIds: array(ref("SeatIdV1"), { minItems: 1, uniqueItems: true }),
  sourceActionId: string,
});
defs.KnowledgeMutationV1 = exact({
  seatId: ref("SeatIdV1"),
  addFactRefs: ref("StringSet"),
  removeFactRefs: ref("StringSet"),
});
defs.SeatArcWorkingMutationV1 = exact({
  seatId: ref("SeatIdV1"),
  progressDelta: number,
  sourceActionId: string,
});
defs.WorkingDeltaV1 = exact({
  workingFactMutations: array(ref("FactMutationV1"), { uniqueItems: true }),
  commitmentMutations: array(ref("CommitmentMutationV1"), { uniqueItems: true }),
  knowledgeMutations: array(ref("KnowledgeMutationV1"), { uniqueItems: true }),
  seatArcWorkingMutations: array(ref("SeatArcWorkingMutationV1"), { uniqueItems: true }),
});
defs.ResourceReservationMutationV1 = exact({
  reservationKey: string,
  seatId: ref("SeatIdV1"),
  resourceId: string,
  amount: nonNegativeNumber,
  operation: enumString(["RESERVE", "RELEASE", "CONSUME"]),
  sourceActionId: string,
});
defs.ResourceMutationV1 = exact({
  resourceId: string,
  before: nonNegativeNumber,
  after: nonNegativeNumber,
  sourceRefs: strings({ minItems: 1 }),
});
defs.WorldDeltaV1 = exact({
  factMutations: array(ref("FactMutationV1"), { uniqueItems: true }),
  resourceMutations: array(ref("ResourceMutationV1"), { uniqueItems: true }),
});
defs.SeatArcDeltaV1 = exact({
  seatId: ref("SeatIdV1"),
  beforeStateHash: ref("Sha256"),
  afterState: ref("SeatArcStateV1"),
  sourceRefs: strings({ minItems: 1 }),
});
defs.TrackDeltaV1 = exact(
  Object.fromEntries(TRACK_IDS.map((trackId) => [trackId, number])),
  [],
);
defs.ObjectKnowledgeEvidenceResponsibilityDeltaV1 = exact({
  objectStates: array(ref("ObjectStateV1"), { uniqueItems: true }),
  knowledgeStates: array(ref("KnowledgeStateV1"), { uniqueItems: true }),
  evidenceStates: array(ref("EvidenceStateV1"), { uniqueItems: true }),
  responsibilityStates: array(ref("ResponsibilityStateV1"), { uniqueItems: true }),
});
defs.CarryForwardV1 = exact({
  nextChapterId: enumString([...CHAPTER_IDS, "FINALE"]),
  unlockedContentRefs: ref("StringSet"),
  unresolvedCommitmentRefs: ref("StringSet"),
  pendingConsequenceRefs: ref("StringSet"),
  carryForwardHash: ref("Sha256"),
});
defs.DeterministicPredicateV1 = {
  oneOf: [
    exact({
      op: enumString(["ALL", "ANY"]),
      clauses: array(ref("DeterministicPredicateV1"), { minItems: 1 }),
    }),
    exact({ op: literal("NOT"), clause: ref("DeterministicPredicateV1") }),
    exact({
      op: literal("COMPARE"),
      factRef: string,
      comparator: enumString(["EQ", "NE", "GT", "GTE", "LT", "LTE"]),
      value: ref("ScalarFactValueV1"),
    }),
    exact({
      op: literal("COMPARE"),
      factRef: string,
      comparator: literal("IN"),
      value: array(ref("ScalarFactValueV1"), { minItems: 1 }),
    }),
  ],
};
defs.DeadlinePolicyV1 = exact({
  durationMs: integer(1),
  clock: literal("SERVER_MONOTONIC"),
  expiryAction: enumString(["APPLY_DEFAULT", "FAIL_CLOSED"]),
});
defs.DeterministicDefaultPolicyV1 = exact({
  policyRef: string,
  actionType: string,
  payload: ref("ScalarFactRecord"),
  policyHash: ref("Sha256"),
});
defs.SangtianFinaleCompiledRulesV1 = root("sangtian_finale_compiled_rules_v1", {
  worldOutcomeRuleRefs: strings({ minItems: 1 }),
  seatVerdictRuleRefs: fixedRecord(SEAT_IDS, strings({ minItems: 1 })),
  disclosureRuleRefs: ref("StringSet"),
  rulesHash: ref("Sha256"),
});

defs.FrozenRunRouteV1 = exact({
  engineVersion: literal("pressure_chapter_v1"),
  strategyVersion: literal("sangtian_pressure_chapter_v1_0"),
  runtimeProfile: literal("SANGTIAN_CONTINUOUS_CHAPTER_V1"),
  endgamePolicyVersion: literal("sangtian_content_finale_v1"),
  resultSchemaVersion: literal("sangtian_pressure_result_v1"),
});
const runExecutionProperties = {
  route: ref("FrozenRunRouteV1"),
  contentPackageVersion: string,
  contentPackageSha256: ref("Sha256"),
  orchestrationPackageVersion: string,
  orchestrationPackageSha256: ref("Sha256"),
  runtimeContractVersion: string,
  runtimeContractSha256: ref("Sha256"),
  testMatrixVersion: string,
  testMatrixSha256: ref("Sha256"),
  runSeed: string,
  narrativeProfileVersion: string,
  featureSetVersion: string,
  resultContractRegistryVersion: string,
  participantMode: enumString(["SOLO", "MULTIPLAYER"]),
  seatIds: fixedTuple(SEAT_IDS.map(literal)),
  humanSeatIdsAtStart: array(ref("SeatIdV1"), { minItems: 1, maxItems: 6, uniqueItems: true }),
  controlTopologyVersion: string,
  initialRoleControlSnapshotHash: ref("Sha256"),
};
defs.FrozenRunExecutionRefV1 = exact(runExecutionProperties);
defs.RunRouteSnapshotV1 = root("pressure_run_route_snapshot_v1", {
  runId: string,
  ...runExecutionProperties,
  routeHash: ref("Sha256"),
});

defs.GenesisSnapshotV1 = root("sangtian_genesis_snapshot_v1", {
  runId: string,
  nodeId: literal("P0"),
  sequence: literal(0),
  routeHash: ref("Sha256"),
  contentPackageSha256: ref("Sha256"),
  orchestrationPackageSha256: ref("Sha256"),
  initialWorldState: ref("WorldStateV1"),
  genesisHash: ref("Sha256"),
});
defs.DecisionPointReactionPolicyV1 = exact({
  enabled: { type: "boolean" },
  eligibleSeatIds: ref("SeatIdArray"),
  trigger: { anyOf: [ref("DeterministicPredicateV1"), { type: "null" }] },
  maxDepth: { enum: [0, 1] },
});
defs.DecisionPointDefinitionV1 = exact({
  decisionPointKey: string,
  chapterId: ref("ChapterIdV1"),
  ordinal: integer(1),
  mode: enumString(["SOLO_BEAT", "TARGETED_INTERACTION", "SYNC_CONTEST"]),
  purpose: string,
  requiredSeatIds: array(ref("SeatIdV1"), { minItems: 1, uniqueItems: true }),
  allowedActionTypes: strings({ minItems: 1 }),
  perSeatActionBudget: {
    type: "object",
    propertyNames: ref("SeatIdV1"),
    additionalProperties: integer(1),
  },
  closeCondition: ref("DeterministicPredicateV1"),
  deadlinePolicy: { anyOf: [ref("DeadlinePolicyV1"), { type: "null" }] },
  absenceDefaultPolicy: ref("DeterministicDefaultPolicyV1"),
  aiFailureDefaultPolicy: ref("DeterministicDefaultPolicyV1"),
  beatResolutionPolicy: string,
  allowedWorkingDeltaTypes: strings({ minItems: 1 }),
  feedbackVisibilityPolicy: string,
  reactionPolicy: ref("DecisionPointReactionPolicyV1"),
});
defs.DecisionActionV1 = root("sangtian_decision_action_v1", {
  actionId: string,
  runId: string,
  chapterRuntimeId: string,
  chapterId: ref("ChapterIdV1"),
  decisionPointId: string,
  seatId: ref("SeatIdV1"),
  actionOrdinal: integer(1),
  actionRevision: integer(1),
  controlEpoch: integer(),
  expectedWorkingRevision: integer(),
  status: literal("SEALED"),
  actionType: string,
  payload: ref("CanonicalJsonObject"),
  payloadHash: ref("Sha256"),
  idempotencyKey: string,
  requestFingerprint: ref("Sha256"),
  sealedHash: ref("Sha256"),
});
defs.SourceHashRefV1 = exact({ sourceHash: ref("Sha256") });
defs.BeatResolutionV1 = root("sangtian_beat_resolution_v1", {
  runId: string,
  chapterRuntimeId: string,
  decisionPointId: string,
  baseWorkingRevision: integer(),
  committedWorkingRevision: integer(1),
  inputWorkingStateHash: ref("Sha256"),
  sealedActionIds: strings({ minItems: 1 }),
  sealedActionsHash: ref("Sha256"),
  resolverVersion: string,
  workingDelta: ref("WorkingDeltaV1"),
  reservationMutations: array(ref("ResourceReservationMutationV1"), { uniqueItems: true }),
  reactionContextRef: { anyOf: [ref("SourceHashRefV1"), { type: "null" }] },
  nextDecisionContextRef: { anyOf: [ref("SourceHashRefV1"), { type: "null" }] },
  resolutionHash: ref("Sha256"),
});
defs.ChapterSettlementInputV1 = root("sangtian_chapter_settlement_input_v1", {
  runId: string,
  chapterRuntimeId: string,
  chapterId: ref("ChapterIdV1"),
  baseWorldSequence: integer(0, 6),
  baseWorldStateHash: ref("Sha256"),
  runRouteHash: ref("Sha256"),
  previousFrozenHash: ref("Sha256"),
  decisionLedgerHash: ref("Sha256"),
  finalWorkingStateHash: ref("Sha256"),
  sealedDecisionActionIds: ref("StringSet"),
  reservationLedgerHash: ref("Sha256"),
  contentPolicyVersion: string,
  contentPolicyHash: ref("Sha256"),
  settlementContractVersion: string,
  settlementContractHash: ref("Sha256"),
  inputHash: ref("Sha256"),
});
defs.ChapterSettlementEvaluationV1 = root("sangtian_chapter_settlement_evaluation_v1", {
  inputHash: ref("Sha256"),
  worldDelta: ref("WorldDeltaV1"),
  seatArcDeltas: array(ref("SeatArcDeltaV1"), { uniqueItems: true }),
  trackDelta: ref("TrackDeltaV1"),
  objectKnowledgeEvidenceResponsibilityDelta: ref("ObjectKnowledgeEvidenceResponsibilityDeltaV1"),
  causalEdges: array(ref("CausalEdgeV1"), { uniqueItems: true }),
  carryForward: ref("CarryForwardV1"),
  evaluationHash: ref("Sha256"),
});
defs.B0SettlementCommitResultV1 = root("b0_settlement_commit_result_v1", {
  settlementId: string,
  frozenChapterBundleId: string,
  runId: string,
  chapterRuntimeId: string,
  chapterId: ref("ChapterIdV1"),
  inputHash: ref("Sha256"),
  evaluationHash: ref("Sha256"),
  baseWorldSequence: integer(0, 6),
  committedWorldSequence: integer(1, 7),
  baseWorldStateHash: ref("Sha256"),
  committedWorldStateHash: ref("Sha256"),
  worldDeltaHash: ref("Sha256"),
  commitManifestHash: ref("Sha256"),
  bundleHash: ref("Sha256"),
  rootEventId: string,
  outboxDedupeKeys: ref("StringSet"),
  commitHash: ref("Sha256"),
});
defs.FrozenChapterBundleV1 = root("sangtian_frozen_chapter_bundle_v1", {
  runId: string,
  chapterId: ref("ChapterIdV1"),
  chapterSequence: integer(1, 7),
  baseWorldSequence: integer(0, 6),
  committedWorldSequence: integer(1, 7),
  previousFrozenHash: ref("Sha256"),
  decisionLedgerHash: ref("Sha256"),
  finalWorkingStateHash: ref("Sha256"),
  settlementPolicyVersion: string,
  worldDelta: ref("WorldDeltaV1"),
  committedWorldStateHash: ref("Sha256"),
  frozenWorldState: ref("WorldStateV1"),
  causalEdges: array(ref("CausalEdgeV1"), { uniqueItems: true }),
  carryForward: ref("CarryForwardV1"),
  bundleHash: ref("Sha256"),
});

defs.SangtianFinaleInputV1 = root("sangtian_finale_input_v1", {
  runId: string,
  routeHash: ref("Sha256"),
  runSeed: string,
  genesisHash: ref("Sha256"),
  frozenChapterBundles: fixedTuple(CHAPTER_IDS.map(() => ref("FrozenChapterBundleV1"))),
  finalWorldState: ref("WorldStateV1"),
  causalEdges: array(ref("CausalEdgeV1"), { uniqueItems: true }),
  policyVersion: string,
  policyHash: ref("Sha256"),
  inputHash: ref("Sha256"),
});
defs.FrozenFinalePolicyV1 = exact({
  policyVersion: string,
  policyHash: ref("Sha256"),
  contentPackageVersion: string,
  contentPackageSha256: ref("Sha256"),
  ruleSchemaVersion: string,
  compiledRules: ref("SangtianFinaleCompiledRulesV1"),
});
defs.FinaleWorldOutcomeV1 = exact({ outcomeId: string, titleKey: string, verdictLineKey: string });
defs.FinaleTrackOutcomeV1 = exact({
  trackId: ref("TrackIdV1"),
  level: enumString(["LOW", "MID", "HIGH"]),
  evidenceRefs: ref("StringSet"),
});
defs.FinaleSeatOutcomeV1 = exact({
  seatId: ref("SeatIdV1"),
  verdict: enumString(["WIN", "COSTLY_WIN", "LOSS"]),
  gainRefs: ref("StringSet"),
  lossRefs: ref("StringSet"),
  causeRefs: ref("StringSet"),
});
defs.SangtianPressureFinaleDecisionV1 = root("sangtian_pressure_finale_decision_v1", {
  runId: string,
  runtimeProfile: literal("SANGTIAN_CONTINUOUS_CHAPTER_V1"),
  policyVersion: string,
  packageSha256: ref("Sha256"),
  routeHash: ref("Sha256"),
  genesisHash: ref("Sha256"),
  frozenChapterBundleHashes: fixedTuple(CHAPTER_IDS.map(() => ref("Sha256"))),
  worldOutcome: ref("FinaleWorldOutcomeV1"),
  tracks: fixedTuple(TRACK_IDS.map(() => ref("FinaleTrackOutcomeV1"))),
  seats: fixedTuple(SEAT_IDS.map(() => ref("FinaleSeatOutcomeV1"))),
  objectOutcomeRefs: ref("StringSet"),
  evidenceAndResponsibilityRefs: ref("StringSet"),
  semanticOutcomeHash: ref("Sha256"),
  executionFingerprint: ref("Sha256"),
  decidedAt: isoTimestamp,
});

defs.NarrativeProjectionKindV1 = enumString([
  "GENESIS_NARRATIVE",
  "BEAT_NARRATIVE",
  "CHAPTER_NARRATIVE",
  "FINALE_NARRATIVE",
]);
defs.NarrativeStatusV1 = enumString([
  "PENDING",
  "GENERATING",
  "VALIDATING",
  "PUBLISHED",
  "FALLBACK_PUBLISHED",
  "FAILED_RETRYABLE",
]);
defs.NarrativeAudienceV1 = {
  oneOf: [
    exact({ kind: literal("PUBLIC"), seatId: { type: "null" } }),
    exact({ kind: literal("SEAT"), seatId: ref("SeatIdV1") }),
  ],
};
defs.OpenNovelNarrativeProjectionJobV1 = root("openovel_narrative_projection_job_v1", {
  jobId: string,
  runId: string,
  audience: ref("NarrativeAudienceV1"),
  sourceRuntimeProfile: string,
  projectionKind: ref("NarrativeProjectionKindV1"),
  sourceAuthority: enumString([
    "GENESIS_FROZEN",
    "CHAPTER_WORKING",
    "CHAPTER_FROZEN",
    "FINALE_FROZEN",
    "LEGACY_TERMINAL_COMMITTED",
  ]),
  sourceId: string,
  sourceCommitHash: ref("Sha256"),
  sourceContentHash: ref("Sha256"),
  allowedFactIds: ref("StringSet"),
  allowedObjectVersionIds: ref("StringSet"),
  allowedKnowledgeIds: ref("StringSet"),
  narrativeProfileVersion: string,
  idempotencyKey: string,
});
defs.OpenNovelNarrativeArtifactV1 = root("openovel_narrative_artifact_v1", {
  jobId: string,
  runId: string,
  projectionKind: ref("NarrativeProjectionKindV1"),
  sourceId: string,
  sourceCommitHash: ref("Sha256"),
  sourceContentHash: ref("Sha256"),
  audience: ref("NarrativeAudienceV1"),
  narrativeProfileVersion: string,
  projectorVersion: string,
  text: string,
  usedFactRefs: ref("StringSet"),
  validationReportHash: ref("Sha256"),
  contentHash: ref("Sha256"),
  renderMode: enumString(["PROVIDER", "AUTHORED_FALLBACK"]),
  status: enumString(["PUBLISHED", "FALLBACK_PUBLISHED"]),
});

defs.PressureResultCauseV1 = exact({
  sourceStageId: enumString(["P0", ...CHAPTER_IDS]),
  sourceKind: enumString(["GENESIS", "CHAPTER_SETTLEMENT"]),
  chapterSettlementId: nullableString,
  frozenSourceHash: ref("Sha256"),
  sourceDecisionActionIds: ref("StringSet"),
  frozenFactRef: string,
  title: string,
  factText: string,
  direction: enumString(["HELPED", "HURT", "DECISIVE"]),
});
defs.PressureReplayActionV1 = exact({
  actionId: string,
  requestSchemaVersion: literal("pressure_replay_command_v1"),
  type: enumString([
    "RESTART_SAME_EXPERIENCE",
    "START_LATEST_EXPERIENCE",
    "CHANGE_ROLE",
    "BACK_TO_WORLDS",
  ]),
  label: string,
  targetExperience: {
    anyOf: [enumString(["SAME_FROZEN_ROUTE", "LATEST_REGISTERED_ROUTE"]), { type: "null" }],
  },
  targetParticipantMode: { anyOf: [enumString(["SOLO", "MULTIPLAYER"]), { type: "null" }] },
  launchKind: enumString(["CREATE_RUN", "CREATE_LOBBY", "NAVIGATE"]),
  href: nullableString,
  enabled: { type: "boolean" },
  disabledReason: nullableString,
  actionFingerprint: ref("Sha256"),
});
defs.PressureReplayCommandV1 = root("pressure_replay_command_v1", {
  sourceRunId: string,
  actionId: string,
  actionFingerprint: ref("Sha256"),
  requestedRoleId: { anyOf: [ref("SeatIdV1"), { type: "null" }] },
  idempotencyKey: string,
  requestFingerprint: ref("Sha256"),
});
defs.ReplayCreationReceiptV1 = root("replay_creation_receipt_v1", {
  sourceRunId: string,
  actionId: string,
  launchKind: enumString(["CREATE_RUN", "CREATE_LOBBY", "NAVIGATE"]),
  createdRunId: nullableString,
  createdLobbyId: nullableString,
  navigationTarget: nullableString,
  frozenTargetRouteHash: { anyOf: [ref("Sha256"), { type: "null" }] },
  receiptHash: ref("Sha256"),
});
defs.ResultRoomV1 = exact({
  roomId: string,
  runId: string,
  worldId: literal("sangtian"),
  participantMode: enumString(["SOLO", "MULTIPLAYER"]),
  completedAt: isoTimestamp,
});
defs.ResultRouteV1 = exact({
  engineVersion: literal("pressure_chapter_v1"),
  strategyVersion: literal("sangtian_pressure_chapter_v1_0"),
  runtimeProfile: literal("SANGTIAN_CONTINUOUS_CHAPTER_V1"),
  endgamePolicyVersion: literal("sangtian_content_finale_v1"),
  contentPackageVersion: string,
  contentPackageSha256: ref("Sha256"),
});
defs.ResultWorldOutcomeV1 = exact({ outcomeId: string, title: string, verdictLine: string, summary: string });
defs.ResultTrackV1 = exact({
  trackId: ref("TrackIdV1"),
  label: string,
  level: enumString(["LOW", "MID", "HIGH"]),
  summary: string,
  evidenceRefs: ref("StringSet"),
});
defs.ResultViewerSeatV1 = exact({
  seatId: ref("SeatIdV1"),
  roleKey: string,
  roleName: string,
  verdict: enumString(["WIN", "COSTLY_WIN", "LOSS"]),
  verdictLabel: string,
  gain: ref("StringSet"),
  loss: ref("StringSet"),
  causes: array(ref("PressureResultCauseV1"), { maxItems: 3 }),
});
defs.VisibleOutcomeV1 = exact({
  kind: enumString(["OBJECT", "EVIDENCE", "RESPONSIBILITY"]),
  outcomeId: string,
  title: string,
  summary: string,
  sourceRefs: strings({ minItems: 1 }),
});
defs.ResultRevealV1 = exact({ title: string, text: string, sourceRefs: strings({ minItems: 1 }) });
defs.ResultNarrativeV1 = exact({
  status: ref("NarrativeStatusV1"),
  text: nullableString,
  contentHash: { anyOf: [ref("Sha256"), { type: "null" }] },
  sourceCommitHash: ref("Sha256"),
  sourceDecisionHash: ref("Sha256"),
});
defs.SangtianPressureResultV1 = root("sangtian_pressure_result_v1", {
  resultType: enumString(["SANGTIAN_PRESSURE_SOLO_END", "SANGTIAN_PRESSURE_SHARED_END"]),
  room: ref("ResultRoomV1"),
  route: ref("ResultRouteV1"),
  worldOutcome: ref("ResultWorldOutcomeV1"),
  tracks: fixedTuple(TRACK_IDS.map(() => ref("ResultTrackV1"))),
  viewerSeat: ref("ResultViewerSeatV1"),
  visibleOutcomes: array(ref("VisibleOutcomeV1"), { uniqueItems: true }),
  reveal: { anyOf: [ref("ResultRevealV1"), { type: "null" }] },
  narrative: ref("ResultNarrativeV1"),
  replayHint: string,
  replayActions: array(ref("PressureReplayActionV1"), { uniqueItems: true }),
  continueNextPartCapability: { type: "null" },
  decisionHash: ref("Sha256"),
  structuredResultHash: ref("Sha256"),
  presentationHash: { anyOf: [ref("Sha256"), { type: "null" }] },
});
defs.SangtianPressureResultEnvelopeV1 = exact({
  envelopeSchemaVersion: literal("endgame_result_envelope_v1"),
  roomId: string,
  runId: string,
  worldId: literal("sangtian"),
  frozenRoute: ref("FrozenRunRouteV1"),
  resultContractRegistryVersion: string,
  payloadSchemaVersion: literal("sangtian_pressure_result_v1"),
  presentationSchemaVersion: literal("sangtian_pressure_result_v1"),
  rendererKey: literal("sangtian_pressure_endgame_v1"),
  authoritativeResultStatus: literal("FINALIZED"),
  runtimeTerminalState: literal("FINALE_FROZEN"),
  narrativeStatus: ref("NarrativeStatusV1"),
  sourceCommitHash: ref("Sha256"),
  decisionHash: ref("Sha256"),
  presentationHash: { anyOf: [ref("Sha256"), { type: "null" }] },
  payload: ref("SangtianPressureResultV1"),
});

defs.FrozenResultReferenceV1 = exact({
  referenceId: string,
  kind: enumString(["FACT", "RULE", "OBJECT", "EVIDENCE", "RESPONSIBILITY"]),
  title: string,
  summary: string,
  sourceRefs: strings({ minItems: 1 }),
  visibility: enumString(["PUBLIC", "AUTHORIZED"]),
  authorizedSeatIds: ref("SeatIdArray"),
  privateOriginSeatId: { anyOf: [ref("SeatIdV1"), { type: "null" }] },
  sourceStageId: enumString(["P0", ...CHAPTER_IDS]),
  sourceKind: enumString(["GENESIS", "CHAPTER_SETTLEMENT"]),
  chapterSettlementId: nullableString,
  frozenSourceHash: ref("Sha256"),
  sourceDecisionActionIds: ref("StringSet"),
  revealEligible: { type: "boolean" },
  revealText: nullableString,
});
defs.ResultCatalogWorldOutcomeV1 = exact({
  outcomeId: string,
  sourceRuleRef: string,
  title: string,
  verdictLine: string,
  summary: string,
});
defs.ResultCatalogTrackV1 = exact({
  trackId: ref("TrackIdV1"),
  label: string,
  summaries: exact({ LOW: string, MID: string, HIGH: string }),
});
defs.ResultCatalogSeatV1 = exact({
  seatId: ref("SeatIdV1"),
  roleKey: string,
  roleName: string,
  verdictLabels: exact({ WIN: string, COSTLY_WIN: string, LOSS: string }),
});
defs.FrozenSangtianResultCatalogV1 = root("frozen_sangtian_result_catalog_v1", {
  locale: literal("zh-CN"),
  worldOutcomes: array(ref("ResultCatalogWorldOutcomeV1"), { uniqueItems: true }),
  tracks: fixedTuple(TRACK_IDS.map(() => ref("ResultCatalogTrackV1"))),
  seats: fixedTuple(SEAT_IDS.map(() => ref("ResultCatalogSeatV1"))),
  references: array(ref("FrozenResultReferenceV1"), { uniqueItems: true }),
  replayHint: string,
  catalogHash: ref("Sha256"),
});
const terminalContextProperties = {
  roomId: string,
  runId: string,
  worldId: literal("sangtian"),
  participantMode: enumString(["SOLO", "MULTIPLAYER"]),
  completedAt: isoTimestamp,
  frozenRoute: ref("FrozenRunRouteV1"),
  frozenRouteHash: ref("Sha256"),
  resultContractRegistryVersion: string,
  payloadSchemaVersion: literal("sangtian_pressure_result_v1"),
  presentationSchemaVersion: literal("sangtian_pressure_result_v1"),
  rendererKey: literal("sangtian_pressure_endgame_v1"),
  contentPackageVersion: string,
  contentPackageSha256: ref("Sha256"),
};
defs.TerminalResultContextV1 = root("terminal_result_context_v1", {
  ...terminalContextProperties,
  narrativeProfileVersion: string,
  catalog: ref("FrozenSangtianResultCatalogV1"),
  contextHash: ref("Sha256"),
});
defs.AuthoritativeImpactV1 = exact({
  kind: enumString(["OBJECT", "EVIDENCE", "RESPONSIBILITY"]),
  outcomeId: string,
  title: string,
  summary: string,
  sourceRefs: strings({ minItems: 1 }),
  visibility: enumString(["PUBLIC", "AUTHORIZED"]),
  authorizedSeatIds: ref("SeatIdArray"),
  privateOriginSeatId: { anyOf: [ref("SeatIdV1"), { type: "null" }] },
});
defs.AuthoritativeRevealV1 = exact({
  revealId: string,
  authorizedSeatIds: array(ref("SeatIdV1"), { minItems: 1, uniqueItems: true }),
  title: string,
  text: string,
  sourceRefs: strings({ minItems: 1 }),
});
defs.AuthoritativePressureResultSnapshotV1 = root("authoritative_pressure_result_snapshot_v1", {
  ...terminalContextProperties,
  authoritativeResultStatus: literal("FINALIZED"),
  runtimeTerminalState: literal("FINALE_FROZEN"),
  sourceCommitHash: ref("Sha256"),
  decisionHash: ref("Sha256"),
  terminalContextHash: ref("Sha256"),
  worldOutcome: ref("ResultCatalogWorldOutcomeV1"),
  tracks: fixedTuple(TRACK_IDS.map(() => ref("ResultTrackV1"))),
  seatOutcomes: fixedTuple(SEAT_IDS.map(() => ref("ResultViewerSeatV1"))),
  impacts: array(ref("AuthoritativeImpactV1"), { uniqueItems: true }),
  reveals: array(ref("AuthoritativeRevealV1"), { uniqueItems: true }),
  replayHint: string,
  snapshotHash: ref("Sha256"),
});

const ROOT_DEFINITIONS = [
  "RunRouteSnapshotV1",
  "TrackStateV1",
  "WorldStateV1",
  "SangtianFinaleCompiledRulesV1",
  "GenesisSnapshotV1",
  "DecisionActionV1",
  "BeatResolutionV1",
  "ChapterSettlementInputV1",
  "ChapterSettlementEvaluationV1",
  "B0SettlementCommitResultV1",
  "FrozenChapterBundleV1",
  "SangtianFinaleInputV1",
  "SangtianPressureFinaleDecisionV1",
  "OpenNovelNarrativeProjectionJobV1",
  "OpenNovelNarrativeArtifactV1",
  "PressureReplayCommandV1",
  "ReplayCreationReceiptV1",
  "SangtianPressureResultV1",
  "SangtianPressureResultEnvelopeV1",
  "FrozenSangtianResultCatalogV1",
  "TerminalResultContextV1",
  "AuthoritativePressureResultSnapshotV1",
];

export function buildPressureChapterSchemaBundleV1() {
  return {
    $schema: DRAFT,
    $id: BASE_ID,
    title: "Our Many Worlds Pressure Chapter V1 shared contracts",
    description: "Machine-readable structural schemas. Existing shared validators remain authoritative for ordering, cross-reference and hash semantics.",
    oneOf: ROOT_DEFINITIONS.map(ref),
    $defs: defs,
  };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly && process.argv.includes("--write")) {
  const outputPath = join(dirname(fileURLToPath(import.meta.url)), "pressure-chapter-v1.schema.json");
  writeFileSync(outputPath, `${JSON.stringify(buildPressureChapterSchemaBundleV1(), null, 2)}\n`, "utf8");
}
