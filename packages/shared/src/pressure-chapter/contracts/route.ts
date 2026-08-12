import { hashWithoutField, sha256Canonical } from "./canonical";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
} from "./errors";
import {
  assertHashEqual,
  assertSelfHash,
  contractArray,
  contractEnum,
  contractLiteral,
  contractObject,
  contractSha256,
  contractString,
  contractVersion,
  exactContractKeys,
  type RawContract,
} from "./validation";

export const PRESSURE_CHAPTER_ROUTE_V1 = Object.freeze({
  engineVersion: "pressure_chapter_v1",
  strategyVersion: "sangtian_pressure_chapter_v1_0",
  runtimeProfile: "SANGTIAN_CONTINUOUS_CHAPTER_V1",
  endgamePolicyVersion: "sangtian_content_finale_v1",
  resultSchemaVersion: "sangtian_pressure_result_v1",
} as const);

export const PRESSURE_CHAPTER_SEAT_IDS_V1 = Object.freeze([
  "cabinet_finance",
  "jiangnan_merchant",
  "qingliu_law",
  "sili_weaving",
  "zhejiang_administration",
  "zhejiang_governor",
] as const);

export type ParticipantModeV1 = "SOLO" | "MULTIPLAYER";

export interface FrozenRunRouteV1 {
  engineVersion: string;
  strategyVersion: string;
  runtimeProfile: string;
  endgamePolicyVersion: string;
  resultSchemaVersion: string;
}

export interface FrozenRunExecutionRefV1 {
  route: FrozenRunRouteV1;
  contentPackageVersion: string;
  contentPackageSha256: string;
  orchestrationPackageVersion: string;
  orchestrationPackageSha256: string;
  runtimeContractVersion: string;
  runtimeContractSha256: string;
  testMatrixVersion: string;
  testMatrixSha256: string;
  runSeed: string;
  narrativeProfileVersion: string;
  featureSetVersion: string;
  resultContractRegistryVersion: string;
  participantMode: ParticipantModeV1;
  seatIds: string[];
  humanSeatIdsAtStart: string[];
  controlTopologyVersion: string;
  initialRoleControlSnapshotHash: string;
}

export interface RunRouteSnapshotV1 extends FrozenRunExecutionRefV1 {
  schemaVersion: "pressure_run_route_snapshot_v1";
  runId: string;
  routeHash: string;
}

export interface ExpectedPressureRunRouteRegistrationV1 {
  route: FrozenRunRouteV1;
  contentPackageVersion: string;
  contentPackageSha256: string;
  orchestrationPackageVersion: string;
  orchestrationPackageSha256: string;
  runtimeContractVersion: string;
  runtimeContractSha256: string;
  testMatrixVersion: string;
  testMatrixSha256: string;
  narrativeProfileVersion: string;
  featureSetVersion: string;
  resultContractRegistryVersion: string;
  controlTopologyVersion: string;
}

const ROUTE_KEYS = [
  "engineVersion",
  "strategyVersion",
  "runtimeProfile",
  "endgamePolicyVersion",
  "resultSchemaVersion",
] as const;

const SNAPSHOT_KEYS = [
  "schemaVersion",
  "runId",
  "route",
  "contentPackageVersion",
  "contentPackageSha256",
  "orchestrationPackageVersion",
  "orchestrationPackageSha256",
  "runtimeContractVersion",
  "runtimeContractSha256",
  "testMatrixVersion",
  "testMatrixSha256",
  "runSeed",
  "narrativeProfileVersion",
  "featureSetVersion",
  "resultContractRegistryVersion",
  "participantMode",
  "seatIds",
  "humanSeatIdsAtStart",
  "controlTopologyVersion",
  "initialRoleControlSnapshotHash",
  "routeHash",
] as const;

export function validateFrozenRunRouteV1(value: unknown): FrozenRunRouteV1 {
  const route = contractObject(value, "route");
  exactContractKeys(route, ROUTE_KEYS, "route");
  for (const key of ROUTE_KEYS) contractVersion(route[key], `route.${key}`);
  return route as unknown as FrozenRunRouteV1;
}

export function assertSangtianPressureRouteV1(route: FrozenRunRouteV1): void {
  if (route.engineVersion !== PRESSURE_CHAPTER_ROUTE_V1.engineVersion) {
    failPressureContract(
      ERROR.RUN_ROUTE_UNREGISTERED,
      "route.engineVersion",
      route.engineVersion,
    );
  }
  if (route.strategyVersion !== PRESSURE_CHAPTER_ROUTE_V1.strategyVersion) {
    failPressureContract(
      ERROR.RUN_ROUTE_UNREGISTERED,
      "route.strategyVersion",
      route.strategyVersion,
    );
  }
  if (route.runtimeProfile !== PRESSURE_CHAPTER_ROUTE_V1.runtimeProfile) {
    failPressureContract(
      ERROR.RUNTIME_PROFILE_UNSUPPORTED,
      "route.runtimeProfile",
      route.runtimeProfile,
    );
  }
  if (route.endgamePolicyVersion !== PRESSURE_CHAPTER_ROUTE_V1.endgamePolicyVersion) {
    failPressureContract(
      ERROR.ENDGAME_POLICY_MISMATCH,
      "route.endgamePolicyVersion",
      route.endgamePolicyVersion,
    );
  }
  if (route.resultSchemaVersion !== PRESSURE_CHAPTER_ROUTE_V1.resultSchemaVersion) {
    failPressureContract(
      ERROR.RESULT_SCHEMA_UNSUPPORTED,
      "route.resultSchemaVersion",
      route.resultSchemaVersion,
    );
  }
}

export function computeRunRouteHash(
  snapshot: Omit<RunRouteSnapshotV1, "routeHash">,
): string {
  return sha256Canonical(snapshot);
}

export function withRunRouteHash(
  snapshot: Omit<RunRouteSnapshotV1, "routeHash">,
): RunRouteSnapshotV1 {
  return { ...snapshot, routeHash: computeRunRouteHash(snapshot) };
}

export function validateRunRouteSnapshotV1(
  value: unknown,
  expected?: ExpectedPressureRunRouteRegistrationV1,
): RunRouteSnapshotV1 {
  const snapshot = contractObject(value, "runRouteSnapshot");
  exactContractKeys(snapshot, SNAPSHOT_KEYS, "runRouteSnapshot");
  contractLiteral(
    snapshot.schemaVersion,
    "pressure_run_route_snapshot_v1",
    "runRouteSnapshot.schemaVersion",
    ERROR.SCHEMA_VERSION_UNSUPPORTED,
  );
  contractString(snapshot.runId, "runRouteSnapshot.runId");
  const route = validateFrozenRunRouteV1(snapshot.route);
  assertSangtianPressureRouteV1(route);

  for (const field of [
    "contentPackageVersion",
    "orchestrationPackageVersion",
    "runtimeContractVersion",
    "testMatrixVersion",
    "narrativeProfileVersion",
    "featureSetVersion",
    "resultContractRegistryVersion",
    "controlTopologyVersion",
  ] as const) {
    contractVersion(snapshot[field], `runRouteSnapshot.${field}`);
  }
  for (const field of [
    "contentPackageSha256",
    "orchestrationPackageSha256",
    "runtimeContractSha256",
    "testMatrixSha256",
    "initialRoleControlSnapshotHash",
  ] as const) {
    contractSha256(snapshot[field], `runRouteSnapshot.${field}`);
  }
  contractString(snapshot.runSeed, "runRouteSnapshot.runSeed");
  const participantMode = contractEnum(
    snapshot.participantMode,
    ["SOLO", "MULTIPLAYER"] as const,
    "runRouteSnapshot.participantMode",
  );
  validateSeatTopology(
    snapshot.seatIds,
    snapshot.humanSeatIdsAtStart,
    participantMode,
  );
  assertSelfHash(
    snapshot,
    "routeHash",
    "runRouteSnapshot",
    ERROR.RUN_ROUTE_HASH_MISMATCH,
  );
  if (expected) assertExpectedRegistration(snapshot, route, expected);
  return snapshot as unknown as RunRouteSnapshotV1;
}

function validateSeatTopology(
  seatIdsValue: unknown,
  humanSeatIdsValue: unknown,
  participantMode: ParticipantModeV1,
): void {
  const seatIds = contractArray(seatIdsValue, "runRouteSnapshot.seatIds");
  if (
    seatIds.length !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    seatIds.some((seatId, index) => seatId !== PRESSURE_CHAPTER_SEAT_IDS_V1[index])
  ) {
    failPressureContract(
      ERROR.CONTRACT_FIELD_INVALID,
      "runRouteSnapshot.seatIds",
      "EXACT_SIX_SEAT_ORDER",
    );
  }
  const humans = contractArray(
    humanSeatIdsValue,
    "runRouteSnapshot.humanSeatIdsAtStart",
  );
  if (
    humans.some((seatId) => !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(seatId as never)) ||
    new Set(humans).size !== humans.length
  ) {
    failPressureContract(
      ERROR.CONTRACT_FIELD_INVALID,
      "runRouteSnapshot.humanSeatIdsAtStart",
      "UNIQUE_SEAT_SUBSET",
    );
  }
  const ranks = humans.map((seatId) => PRESSURE_CHAPTER_SEAT_IDS_V1.indexOf(seatId as never));
  if (ranks.some((rank, index) => index > 0 && ranks[index - 1]! >= rank)) {
    failPressureContract(
      ERROR.CONTRACT_ORDER_INVALID,
      "runRouteSnapshot.humanSeatIdsAtStart",
    );
  }
  const validCount = participantMode === "SOLO"
    ? humans.length === 1
    : humans.length >= 2 && humans.length <= 6;
  if (!validCount) {
    failPressureContract(
      ERROR.CONTRACT_FIELD_INVALID,
      "runRouteSnapshot.humanSeatIdsAtStart",
      participantMode === "SOLO" ? "EXACTLY_ONE" : "BETWEEN_TWO_AND_SIX",
    );
  }
}

function assertExpectedRegistration(
  snapshot: RawContract,
  route: FrozenRunRouteV1,
  expected: ExpectedPressureRunRouteRegistrationV1,
): void {
  for (const key of ROUTE_KEYS) {
    if (route[key] !== expected.route[key]) {
      const code = key === "runtimeProfile"
        ? ERROR.RUNTIME_PROFILE_UNSUPPORTED
        : key === "endgamePolicyVersion"
          ? ERROR.ENDGAME_POLICY_MISMATCH
          : key === "resultSchemaVersion"
            ? ERROR.RESULT_SCHEMA_UNSUPPORTED
            : ERROR.RUN_ROUTE_UNREGISTERED;
      failPressureContract(code, `route.${key}`, `EXPECTED_${expected.route[key]}`);
    }
  }
  const hashCodes = {
    contentPackageSha256: ERROR.CONTENT_PACKAGE_HASH_MISMATCH,
    orchestrationPackageSha256: ERROR.ORCHESTRATION_PACKAGE_HASH_MISMATCH,
    runtimeContractSha256: ERROR.RUNTIME_CONTRACT_HASH_MISMATCH,
    testMatrixSha256: ERROR.TEST_MATRIX_HASH_MISMATCH,
  } as const;
  for (const [field, code] of Object.entries(hashCodes) as Array<
    [keyof typeof hashCodes, (typeof hashCodes)[keyof typeof hashCodes]]
  >) {
    assertHashEqual(
      snapshot[field],
      expected[field],
      `runRouteSnapshot.${field}`,
      code,
    );
  }
  for (const field of [
    "contentPackageVersion",
    "orchestrationPackageVersion",
    "runtimeContractVersion",
    "testMatrixVersion",
    "narrativeProfileVersion",
    "featureSetVersion",
    "resultContractRegistryVersion",
    "controlTopologyVersion",
  ] as const) {
    if (snapshot[field] !== expected[field]) {
      failPressureContract(
        ERROR.CONTRACT_REFERENCE_MISMATCH,
        `runRouteSnapshot.${field}`,
        `EXPECTED_${expected[field]}`,
      );
    }
  }
}

export function recomputeRunRouteHash(snapshot: RunRouteSnapshotV1): string {
  return hashWithoutField(snapshot as unknown as RawContract, "routeHash");
}
