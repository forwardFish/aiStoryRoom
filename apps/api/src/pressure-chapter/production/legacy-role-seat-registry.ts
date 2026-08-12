import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  sha256Canonical,
  type SeatIdV1,
} from "@ai-story/shared";
import {
  PRESSURE_PRODUCTION_ERROR_CODES as ERROR,
  failPressureProduction,
} from "./errors";

/**
 * These are the six room role keys stored by the pre-Pressure Sangtian game
 * definition. They are boundary input only; Pressure domain code must use the
 * accepted SeatIdV1 vocabulary below.
 */
export const LEGACY_SANGTIAN_ROOM_ROLE_KEYS_V1 = Object.freeze([
  "zhejiang_governor",
  "xunfu",
  "county_magistrate",
  "clerk",
  "merchant",
  "sili_jian",
] as const);

export type LegacySangtianRoomRoleKeyV1 =
  (typeof LEGACY_SANGTIAN_ROOM_ROLE_KEYS_V1)[number];

export const CANONICAL_PRESSURE_STORY_ROLE_KEYS_V1 =
  PRESSURE_CHAPTER_SEAT_IDS_V1;

export interface LegacyRoleMappingEvidenceV1 {
  authorityRef: string;
  sourceRefs: readonly string[];
}

export interface RequiredLegacyRoleMappingV1
  extends LegacyRoleMappingEvidenceV1 {
  legacyRoleKey: Exclude<
    LegacySangtianRoomRoleKeyV1,
    "zhejiang_governor"
  >;
  seatId: SeatIdV1;
}

export interface LegacyRoleSeatRegistryEntryV1 {
  legacyRoleKey: LegacySangtianRoomRoleKeyV1;
  resolution: "EXACT_ACCEPTED_ROLE_KEY" | "REQUIRED_AUTHORITY_INPUT";
  seatId: SeatIdV1 | null;
  requiredInputKey: string | null;
  evidence: LegacyRoleMappingEvidenceV1;
}

export interface LegacyRoleSeatRegistryV1 {
  schemaVersion: "pressure_legacy_room_role_seat_registry_v1";
  acceptedSeatIds: readonly SeatIdV1[];
  entries: readonly LegacyRoleSeatRegistryEntryV1[];
  registryHash: string;
}

const ACCEPTED_SEAT_SOURCE =
  "packages/templates/config/sangtian/pressure-spine-v1.0/source/global/seats.json";
const LEGACY_ROLE_SOURCE = "packages/templates/config/sangtian/game.json";
const ROLE_CONTRACT_SOURCE =
  "docs/Our_Many_Worlds_桑田诏_MVP游戏运行机制开发与测试统一规格_v1.0.1.md";

const unresolvedEntry = (
  legacyRoleKey: Exclude<
    LegacySangtianRoomRoleKeyV1,
    "zhejiang_governor"
  >,
): LegacyRoleSeatRegistryEntryV1 => ({
  legacyRoleKey,
  resolution: "REQUIRED_AUTHORITY_INPUT",
  seatId: null,
  requiredInputKey: `legacy-room-role:${legacyRoleKey}:accepted-seat-id`,
  evidence: {
    authorityRef: "accepted-institutional-equivalence-required",
    sourceRefs: [LEGACY_ROLE_SOURCE, ACCEPTED_SEAT_SOURCE, ROLE_CONTRACT_SOURCE],
  },
});

const baseEntries: LegacyRoleSeatRegistryEntryV1[] = [
  {
    legacyRoleKey: "zhejiang_governor",
    resolution: "EXACT_ACCEPTED_ROLE_KEY",
    seatId: "zhejiang_governor",
    requiredInputKey: null,
    evidence: {
      authorityRef: "exact-role-key-equality",
      sourceRefs: [LEGACY_ROLE_SOURCE, ACCEPTED_SEAT_SOURCE],
    },
  },
  unresolvedEntry("xunfu"),
  unresolvedEntry("county_magistrate"),
  unresolvedEntry("clerk"),
  unresolvedEntry("merchant"),
  unresolvedEntry("sili_jian"),
];

const registryBase = {
  schemaVersion: "pressure_legacy_room_role_seat_registry_v1" as const,
  acceptedSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
  entries: baseEntries,
};

/**
 * Deliberately incomplete and therefore fail-closed. In particular, the
 * legacy `clerk` role is not an alias for `cabinet_finance`. A future accepted
 * mapping must be supplied with explicit authority and source references.
 */
export const LEGACY_ROOM_ROLE_TO_PRESSURE_SEAT_REGISTRY_V1 = deepFreeze({
  ...registryBase,
  registryHash: sha256Canonical(registryBase),
}) as LegacyRoleSeatRegistryV1;

export interface FinalizedLegacyRoleSeatRegistryV1
  extends Omit<LegacyRoleSeatRegistryV1, "entries"> {
  entries: readonly (LegacyRoleSeatRegistryEntryV1 & {
    resolution: "EXACT_ACCEPTED_ROLE_KEY" | "EXPLICIT_ACCEPTED_MAPPING";
    seatId: SeatIdV1;
    requiredInputKey: null;
  })[];
}

/**
 * Finalization is intentionally an integration-time action. It requires one
 * source-referenced decision for every irreducible legacy alias and validates
 * a one-to-one mapping onto the accepted six-seat set.
 */
export function finalizeLegacyRoleSeatRegistryV1(
  requiredMappings: readonly RequiredLegacyRoleMappingV1[],
): FinalizedLegacyRoleSeatRegistryV1 {
  if (!Array.isArray(requiredMappings)) {
    failPressureProduction(ERROR.LEGACY_MAPPING_INVALID, "mappings:ARRAY");
  }
  const byRole = new Map<LegacySangtianRoomRoleKeyV1, RequiredLegacyRoleMappingV1>();
  for (const mapping of requiredMappings) {
    if (
      !mapping ||
      !LEGACY_SANGTIAN_ROOM_ROLE_KEYS_V1.includes(mapping.legacyRoleKey) ||
      mapping.legacyRoleKey === "zhejiang_governor" ||
      !PRESSURE_CHAPTER_SEAT_IDS_V1.includes(mapping.seatId) ||
      !nonEmpty(mapping.authorityRef) ||
      !Array.isArray(mapping.sourceRefs) ||
      mapping.sourceRefs.length === 0 ||
      mapping.sourceRefs.some((sourceRef: string) => !nonEmpty(sourceRef))
    ) {
      failPressureProduction(ERROR.LEGACY_MAPPING_INVALID, "mapping:SHAPE");
    }
    if (byRole.has(mapping.legacyRoleKey)) {
      failPressureProduction(
        ERROR.LEGACY_MAPPING_INVALID,
        `mapping:DUPLICATE_ROLE:${mapping.legacyRoleKey}`,
      );
    }
    byRole.set(mapping.legacyRoleKey, mapping);
  }

  const entries = LEGACY_ROOM_ROLE_TO_PRESSURE_SEAT_REGISTRY_V1.entries.map(
    (entry) => {
      if (entry.resolution === "EXACT_ACCEPTED_ROLE_KEY") {
        return {
          ...entry,
          resolution: "EXACT_ACCEPTED_ROLE_KEY" as const,
          seatId: entry.seatId!,
          requiredInputKey: null,
        };
      }
      const supplied = byRole.get(entry.legacyRoleKey);
      if (!supplied) {
        failPressureProduction(
          ERROR.LEGACY_MAPPING_REQUIRED,
          entry.requiredInputKey!,
        );
      }
      return {
        legacyRoleKey: entry.legacyRoleKey,
        resolution: "EXPLICIT_ACCEPTED_MAPPING" as const,
        seatId: supplied.seatId,
        requiredInputKey: null,
        evidence: {
          authorityRef: supplied.authorityRef,
          sourceRefs: [...supplied.sourceRefs],
        },
      };
    },
  );

  const seats = entries.map((entry) => entry.seatId);
  if (
    new Set(seats).size !== PRESSURE_CHAPTER_SEAT_IDS_V1.length ||
    PRESSURE_CHAPTER_SEAT_IDS_V1.some((seatId) => !seats.includes(seatId))
  ) {
    failPressureProduction(
      ERROR.LEGACY_MAPPING_INVALID,
      "mapping:NOT_A_BIJECTION_TO_ACCEPTED_SIX_SEATS",
    );
  }

  const base = {
    schemaVersion: "pressure_legacy_room_role_seat_registry_v1" as const,
    acceptedSeatIds: [...PRESSURE_CHAPTER_SEAT_IDS_V1],
    entries,
  };
  return deepFreeze({
    ...base,
    registryHash: sha256Canonical(base),
  }) as FinalizedLegacyRoleSeatRegistryV1;
}

/** New Pressure StoryRole.roleKey values pass directly; legacy aliases do not. */
export function resolvePressureSeatAtEntryBoundaryV1(
  roleKey: string,
  finalizedLegacyRegistry?: FinalizedLegacyRoleSeatRegistryV1,
): SeatIdV1 {
  if (PRESSURE_CHAPTER_SEAT_IDS_V1.includes(roleKey as SeatIdV1)) {
    return roleKey as SeatIdV1;
  }
  if (!LEGACY_SANGTIAN_ROOM_ROLE_KEYS_V1.includes(roleKey as LegacySangtianRoomRoleKeyV1)) {
    failPressureProduction(
      ERROR.LEGACY_MAPPING_INVALID,
      `roleKey:UNKNOWN:${roleKey}`,
    );
  }
  const legacyRoleKey = roleKey as LegacySangtianRoomRoleKeyV1;
  const entry = finalizedLegacyRegistry?.entries.find(
    (candidate) => candidate.legacyRoleKey === legacyRoleKey,
  );
  if (!entry) {
    const required = LEGACY_ROOM_ROLE_TO_PRESSURE_SEAT_REGISTRY_V1.entries.find(
      (candidate) => candidate.legacyRoleKey === legacyRoleKey,
    );
    failPressureProduction(
      ERROR.LEGACY_MAPPING_REQUIRED,
      required?.requiredInputKey ?? `legacy-room-role:${legacyRoleKey}`,
    );
  }
  return entry.seatId;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
