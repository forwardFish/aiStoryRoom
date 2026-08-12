import { sha256Canonical } from "./canonical";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
} from "./errors";
import { PRESSURE_CHAPTER_ROUTE_V1, PRESSURE_CHAPTER_SEAT_IDS_V1 } from "./route";
import {
  CHAPTER_IDS_V1,
  TRACK_IDS_V1,
  validateCausalEdgesV1,
  validateSangtianFinaleCompiledRulesV1,
  validateSeatIdV1,
  validateTrackIdV1,
  validateWorldStateV1,
  type CausalEdgeV1,
  type SangtianFinaleCompiledRulesV1,
  type SeatIdV1,
  type TrackIdV1,
  type WorldStateV1,
} from "./domain";
import {
  validateFrozenChapterBundleV1,
  type FrozenChapterBundleV1,
} from "./chapter";
import {
  assertHashEqual,
  assertOrderedBy,
  assertSelfHash,
  contractArray,
  contractEnum,
  contractLiteral,
  contractObject,
  contractSha256,
  contractString,
  contractStringArray,
  contractVersion,
  exactContractKeys,
  isoTimestamp,
  type RawContract,
} from "./validation";

export interface SangtianFinaleInputV1 {
  schemaVersion: "sangtian_finale_input_v1";
  runId: string;
  routeHash: string;
  runSeed: string;
  genesisHash: string;
  frozenChapterBundles: FrozenChapterBundleV1[];
  finalWorldState: WorldStateV1;
  causalEdges: CausalEdgeV1[];
  policyVersion: string;
  policyHash: string;
  inputHash: string;
}

export interface FrozenFinalePolicyV1 {
  policyVersion: string;
  policyHash: string;
  contentPackageVersion: string;
  contentPackageSha256: string;
  ruleSchemaVersion: string;
  compiledRules: SangtianFinaleCompiledRulesV1;
}

export interface SangtianPressureFinaleDecisionV1 {
  schemaVersion: "sangtian_pressure_finale_decision_v1";
  runId: string;
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1";
  policyVersion: string;
  packageSha256: string;
  routeHash: string;
  genesisHash: string;
  frozenChapterBundleHashes: string[];
  worldOutcome: {
    outcomeId: string;
    titleKey: string;
    verdictLineKey: string;
  };
  tracks: Array<{
    trackId: TrackIdV1;
    level: "LOW" | "MID" | "HIGH";
    evidenceRefs: string[];
  }>;
  seats: Array<{
    seatId: SeatIdV1;
    verdict: "WIN" | "COSTLY_WIN" | "LOSS";
    gainRefs: string[];
    lossRefs: string[];
    causeRefs: string[];
  }>;
  objectOutcomeRefs: string[];
  evidenceAndResponsibilityRefs: string[];
  semanticOutcomeHash: string;
  executionFingerprint: string;
  decidedAt: string;
}

export function validateSangtianFinaleInputV1(value: unknown): SangtianFinaleInputV1 {
  const input = contractObject(value, "finaleInput");
  exactContractKeys(input, [
    "schemaVersion",
    "runId",
    "routeHash",
    "runSeed",
    "genesisHash",
    "frozenChapterBundles",
    "finalWorldState",
    "causalEdges",
    "policyVersion",
    "policyHash",
    "inputHash",
  ], "finaleInput");
  contractLiteral(
    input.schemaVersion,
    "sangtian_finale_input_v1",
    "finaleInput.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractString(input.runId, "finaleInput.runId");
  contractString(input.runSeed, "finaleInput.runSeed");
  for (const field of ["routeHash", "genesisHash", "policyHash"] as const) {
    contractSha256(input[field], `finaleInput.${field}`);
  }
  contractVersion(input.policyVersion, "finaleInput.policyVersion");

  const rawBundles = contractArray(input.frozenChapterBundles, "finaleInput.frozenChapterBundles");
  if (rawBundles.length !== 7) {
    failPressureContract(
      ERROR.CONTRACT_SEQUENCE_MISMATCH,
      "finaleInput.frozenChapterBundles",
      "EXPECTED_N1_TO_N7",
    );
  }
  const bundles: FrozenChapterBundleV1[] = [];
  let previousHash = String(input.genesisHash);
  for (let index = 0; index < rawBundles.length; index += 1) {
    const bundle = validateFrozenChapterBundleV1(rawBundles[index], previousHash);
    if (
      bundle.chapterId !== CHAPTER_IDS_V1[index] ||
      bundle.chapterSequence !== index + 1 ||
      bundle.runId !== input.runId
    ) {
      failPressureContract(
        ERROR.CONTRACT_SEQUENCE_MISMATCH,
        `finaleInput.frozenChapterBundles[${index}]`,
      );
    }
    bundles.push(bundle);
    previousHash = bundle.bundleHash;
  }
  const finalWorld = validateWorldStateV1(input.finalWorldState, "finaleInput.finalWorldState");
  const n7 = bundles[6]!;
  if (
    finalWorld.worldSequence !== 7 ||
    finalWorld.stateHash !== n7.committedWorldStateHash ||
    finalWorld.stateHash !== n7.frozenWorldState.stateHash
  ) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "finaleInput.finalWorldState",
      "N7_WORLD_MISMATCH",
    );
  }
  validateCausalEdgesV1(input.causalEdges, "finaleInput.causalEdges");
  assertSelfHash(input, "inputHash", "finaleInput");
  return input as unknown as SangtianFinaleInputV1;
}

export function validateFrozenFinalePolicyV1(value: unknown): FrozenFinalePolicyV1 {
  const policy = contractObject(value, "finalePolicy");
  exactContractKeys(policy, [
    "policyVersion",
    "policyHash",
    "contentPackageVersion",
    "contentPackageSha256",
    "ruleSchemaVersion",
    "compiledRules",
  ], "finalePolicy");
  contractVersion(policy.policyVersion, "finalePolicy.policyVersion");
  contractVersion(policy.contentPackageVersion, "finalePolicy.contentPackageVersion");
  contractSha256(policy.contentPackageSha256, "finalePolicy.contentPackageSha256");
  contractVersion(policy.ruleSchemaVersion, "finalePolicy.ruleSchemaVersion");
  validateSangtianFinaleCompiledRulesV1(policy.compiledRules, "finalePolicy.compiledRules");
  assertSelfHash(policy, "policyHash", "finalePolicy");
  return policy as unknown as FrozenFinalePolicyV1;
}

export function computeFinaleSemanticOutcomeHash(
  decision: Pick<
    SangtianPressureFinaleDecisionV1,
    | "worldOutcome"
    | "tracks"
    | "seats"
    | "objectOutcomeRefs"
    | "evidenceAndResponsibilityRefs"
  >,
): string {
  return sha256Canonical({
    worldOutcome: decision.worldOutcome,
    tracks: decision.tracks,
    seats: decision.seats,
    objectOutcomeRefs: decision.objectOutcomeRefs,
    evidenceAndResponsibilityRefs: decision.evidenceAndResponsibilityRefs,
  });
}

export function computeFinaleExecutionFingerprint(
  decision: Pick<
    SangtianPressureFinaleDecisionV1,
    | "runId"
    | "runtimeProfile"
    | "policyVersion"
    | "packageSha256"
    | "routeHash"
    | "genesisHash"
    | "frozenChapterBundleHashes"
    | "semanticOutcomeHash"
  >,
): string {
  return sha256Canonical({
    runId: decision.runId,
    runtimeProfile: decision.runtimeProfile,
    policyVersion: decision.policyVersion,
    packageSha256: decision.packageSha256,
    routeHash: decision.routeHash,
    genesisHash: decision.genesisHash,
    frozenChapterBundleHashes: decision.frozenChapterBundleHashes,
    semanticOutcomeHash: decision.semanticOutcomeHash,
  });
}

export function validateSangtianPressureFinaleDecisionV1(
  value: unknown,
  input?: SangtianFinaleInputV1,
  policy?: FrozenFinalePolicyV1,
): SangtianPressureFinaleDecisionV1 {
  const decision = contractObject(value, "finaleDecision");
  exactContractKeys(decision, [
    "schemaVersion",
    "runId",
    "runtimeProfile",
    "policyVersion",
    "packageSha256",
    "routeHash",
    "genesisHash",
    "frozenChapterBundleHashes",
    "worldOutcome",
    "tracks",
    "seats",
    "objectOutcomeRefs",
    "evidenceAndResponsibilityRefs",
    "semanticOutcomeHash",
    "executionFingerprint",
    "decidedAt",
  ], "finaleDecision");
  contractLiteral(
    decision.schemaVersion,
    "sangtian_pressure_finale_decision_v1",
    "finaleDecision.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractString(decision.runId, "finaleDecision.runId");
  contractLiteral(
    decision.runtimeProfile,
    PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile,
    "finaleDecision.runtimeProfile",
    ERROR.RUNTIME_PROFILE_UNSUPPORTED,
  );
  contractVersion(decision.policyVersion, "finaleDecision.policyVersion");
  for (const field of ["packageSha256", "routeHash", "genesisHash"] as const) {
    contractSha256(decision[field], `finaleDecision.${field}`);
  }
  const bundleHashes = contractStringArray(
    decision.frozenChapterBundleHashes,
    "finaleDecision.frozenChapterBundleHashes",
    { nonEmpty: true },
  );
  if (bundleHashes.length !== 7) {
    failPressureContract(
      ERROR.CONTRACT_SEQUENCE_MISMATCH,
      "finaleDecision.frozenChapterBundleHashes",
      "EXPECTED_SEVEN",
    );
  }
  bundleHashes.forEach((hash, index) =>
    contractSha256(hash, `finaleDecision.frozenChapterBundleHashes[${index}]`),
  );
  validateWorldOutcome(decision.worldOutcome);
  validateFinaleTracks(decision.tracks);
  validateFinaleSeats(decision.seats);
  contractStringArray(decision.objectOutcomeRefs, "finaleDecision.objectOutcomeRefs", {
    sorted: true,
  });
  contractStringArray(
    decision.evidenceAndResponsibilityRefs,
    "finaleDecision.evidenceAndResponsibilityRefs",
    { sorted: true },
  );
  const typed = decision as unknown as SangtianPressureFinaleDecisionV1;
  assertHashEqual(
    decision.semanticOutcomeHash,
    computeFinaleSemanticOutcomeHash(typed),
    "finaleDecision.semanticOutcomeHash",
    ERROR.CONTRACT_HASH_MISMATCH,
  );
  assertHashEqual(
    decision.executionFingerprint,
    computeFinaleExecutionFingerprint(typed),
    "finaleDecision.executionFingerprint",
    ERROR.CONTRACT_FINGERPRINT_MISMATCH,
  );
  isoTimestamp(decision.decidedAt, "finaleDecision.decidedAt");
  if (input) assertInputReferences(decision, input);
  if (policy) assertPolicyReferences(decision, policy);
  if (input && policy) {
    if (input.policyVersion !== policy.policyVersion) {
      failPressureContract(
        ERROR.ENDGAME_POLICY_MISMATCH,
        "finaleInput.policyVersion",
        `EXPECTED_${policy.policyVersion}`,
      );
    }
    if (input.policyHash !== policy.policyHash) {
      failPressureContract(
        ERROR.CONTRACT_HASH_MISMATCH,
        "finaleInput.policyHash",
        `EXPECTED_${policy.policyHash}`,
      );
    }
  }
  return typed;
}

function validateWorldOutcome(value: unknown): void {
  const outcome = contractObject(value, "finaleDecision.worldOutcome");
  exactContractKeys(outcome, ["outcomeId", "titleKey", "verdictLineKey"], "finaleDecision.worldOutcome");
  for (const field of ["outcomeId", "titleKey", "verdictLineKey"] as const) {
    contractString(outcome[field], `finaleDecision.worldOutcome.${field}`);
  }
}

function validateFinaleTracks(value: unknown): void {
  const tracks = contractArray(value, "finaleDecision.tracks").map((item, index) => {
    const path = `finaleDecision.tracks[${index}]`;
    const track = contractObject(item, path);
    exactContractKeys(track, ["trackId", "level", "evidenceRefs"], path);
    validateTrackIdV1(track.trackId, `${path}.trackId`);
    contractEnum(track.level, ["LOW", "MID", "HIGH"] as const, `${path}.level`);
    contractStringArray(track.evidenceRefs, `${path}.evidenceRefs`, { sorted: true });
    return track;
  });
  if (tracks.length !== TRACK_IDS_V1.length) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, "finaleDecision.tracks", "EXACT_FIVE_TRACKS");
  }
  assertOrderedBy(tracks, (track) => String(track.trackId), "finaleDecision.tracks", TRACK_IDS_V1);
}

function validateFinaleSeats(value: unknown): void {
  const seats = contractArray(value, "finaleDecision.seats").map((item, index) => {
    const path = `finaleDecision.seats[${index}]`;
    const seat = contractObject(item, path);
    exactContractKeys(seat, ["seatId", "verdict", "gainRefs", "lossRefs", "causeRefs"], path);
    validateSeatIdV1(seat.seatId, `${path}.seatId`);
    contractEnum(seat.verdict, ["WIN", "COSTLY_WIN", "LOSS"] as const, `${path}.verdict`);
    for (const field of ["gainRefs", "lossRefs", "causeRefs"] as const) {
      contractStringArray(seat[field], `${path}.${field}`, { sorted: true });
    }
    return seat;
  });
  if (seats.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length) {
    failPressureContract(ERROR.CONTRACT_FIELD_INVALID, "finaleDecision.seats", "EXACT_SIX_SEATS");
  }
  assertOrderedBy(
    seats,
    (seat) => String(seat.seatId),
    "finaleDecision.seats",
    PRESSURE_CHAPTER_SEAT_IDS_V1,
  );
}

function assertInputReferences(decision: RawContract, input: SangtianFinaleInputV1): void {
  for (const field of ["runId", "routeHash", "genesisHash", "policyVersion"] as const) {
    if (decision[field] !== input[field]) {
      failPressureContract(
        ERROR.CONTRACT_REFERENCE_MISMATCH,
        `finaleDecision.${field}`,
        `EXPECTED_${input[field]}`,
      );
    }
  }
  const expectedHashes = input.frozenChapterBundles.map((bundle) => bundle.bundleHash);
  if (JSON.stringify(decision.frozenChapterBundleHashes) !== JSON.stringify(expectedHashes)) {
    failPressureContract(
      ERROR.CONTRACT_REFERENCE_MISMATCH,
      "finaleDecision.frozenChapterBundleHashes",
    );
  }
}

function assertPolicyReferences(decision: RawContract, policy: FrozenFinalePolicyV1): void {
  if (decision.policyVersion !== policy.policyVersion) {
    failPressureContract(
      ERROR.ENDGAME_POLICY_MISMATCH,
      "finaleDecision.policyVersion",
      `EXPECTED_${policy.policyVersion}`,
    );
  }
  if (decision.packageSha256 !== policy.contentPackageSha256) {
    failPressureContract(
      ERROR.CONTENT_PACKAGE_HASH_MISMATCH,
      "finaleDecision.packageSha256",
      `EXPECTED_${policy.contentPackageSha256}`,
    );
  }
}
