import schemaBundleJson from "./pressure-chapter-v1.schema.json";
import {
  canonicalJson,
  sha256Canonical,
} from "../contracts/canonical";
import {
  PRESSURE_CHAPTER_CONTRACT_ERROR_CODES as ERROR,
  failPressureContract,
} from "../contracts/errors";
import {
  PRESSURE_CHAPTER_SEAT_IDS_V1,
  validateRunRouteSnapshotV1,
} from "../contracts/route";
import {
  validateSangtianFinaleCompiledRulesV1,
  validateWorldStateV1,
} from "../contracts/domain";
import {
  validateB0SettlementCommitResultV1,
  validateBeatResolutionV1,
  validateChapterSettlementEvaluationV1,
  validateDecisionActionV1,
  validateFrozenChapterBundleV1,
  validateGenesisSnapshotV1,
  validateSealedChapterSettlementInputV1,
} from "../contracts/chapter";
import {
  validateSangtianFinaleInputV1,
  validateSangtianPressureFinaleDecisionV1,
} from "../contracts/finale";
import {
  validateOpenNovelNarrativeArtifactV1,
  validateOpenNovelNarrativeProjectionJobV1,
} from "../contracts/narrative";
import {
  validatePressureReplayCommandV1,
  validateReplayCreationReceiptV1,
  validateSangtianPressureResultEnvelopeV1,
  validateSangtianPressureResultV1,
} from "../contracts/result";
import {
  validateAuthoritativePressureResultSnapshotV1,
  validateFrozenSangtianResultCatalogV1,
  validateTerminalResultContextV1,
} from "../contracts/result-authority";

export interface JsonSchemaDocumentV1 {
  readonly $schema: "https://json-schema.org/draft/2020-12/schema";
  readonly $id: string;
  readonly title: string;
  readonly description: string;
  readonly oneOf: ReadonlyArray<{ readonly $ref: string }>;
  readonly $defs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export const PRESSURE_CHAPTER_SCHEMA_BUNDLE_V1 = deepFreeze(
  schemaBundleJson as unknown as JsonSchemaDocumentV1,
);

export const PRESSURE_CHAPTER_SCHEMA_DOCUMENT_HASH_V1 = sha256Canonical(
  PRESSURE_CHAPTER_SCHEMA_BUNDLE_V1,
);

type ContractValidator = (value: unknown) => unknown;

export type PressureEmbeddedHashRuleV1 =
  | { readonly kind: "NONE" }
  | { readonly kind: "SELF_HASH_EXCLUDING_FIELD"; readonly field: string }
  | { readonly kind: "COMPUTED_FIELDS"; readonly fields: readonly string[] };

interface RegistryEntryV1 {
  readonly definitionName: string;
  readonly discriminatorField: "schemaVersion" | "envelopeSchemaVersion";
  readonly validator: ContractValidator;
  readonly embeddedHashRule: PressureEmbeddedHashRuleV1;
}

const NONE = Object.freeze({ kind: "NONE" } as const);
const selfHash = (field: string): PressureEmbeddedHashRuleV1 =>
  Object.freeze({ kind: "SELF_HASH_EXCLUDING_FIELD", field });
const computed = (...fields: string[]): PressureEmbeddedHashRuleV1 =>
  Object.freeze({ kind: "COMPUTED_FIELDS", fields: Object.freeze(fields) });

const REGISTRY = Object.freeze({
  pressure_run_route_snapshot_v1: entry(
    "RunRouteSnapshotV1",
    validateRunRouteSnapshotV1,
    selfHash("routeHash"),
  ),
  sangtian_track_state_v1: entry(
    "TrackStateV1",
    validateTrackStateThroughWorldContract,
    selfHash("stateHash"),
  ),
  sangtian_world_state_v1: entry(
    "WorldStateV1",
    validateWorldStateV1,
    selfHash("stateHash"),
  ),
  sangtian_finale_compiled_rules_v1: entry(
    "SangtianFinaleCompiledRulesV1",
    validateSangtianFinaleCompiledRulesV1,
    selfHash("rulesHash"),
  ),
  sangtian_genesis_snapshot_v1: entry(
    "GenesisSnapshotV1",
    validateGenesisSnapshotV1,
    selfHash("genesisHash"),
  ),
  sangtian_decision_action_v1: entry(
    "DecisionActionV1",
    validateDecisionActionV1,
    computed("payloadHash", "requestFingerprint", "sealedHash"),
  ),
  sangtian_beat_resolution_v1: entry(
    "BeatResolutionV1",
    validateBeatResolutionV1,
    computed("sealedActionsHash", "resolutionHash"),
  ),
  sangtian_chapter_settlement_input_v1: entry(
    "ChapterSettlementInputV1",
    validateSealedChapterSettlementInputV1,
    selfHash("inputHash"),
  ),
  sangtian_chapter_settlement_evaluation_v1: entry(
    "ChapterSettlementEvaluationV1",
    validateChapterSettlementEvaluationV1,
    selfHash("evaluationHash"),
  ),
  b0_settlement_commit_result_v1: entry(
    "B0SettlementCommitResultV1",
    validateB0SettlementCommitResultV1,
    computed("worldDeltaHash", "commitManifestHash", "bundleHash", "commitHash"),
  ),
  sangtian_frozen_chapter_bundle_v1: entry(
    "FrozenChapterBundleV1",
    validateFrozenChapterBundleV1,
    selfHash("bundleHash"),
  ),
  sangtian_finale_input_v1: entry(
    "SangtianFinaleInputV1",
    validateSangtianFinaleInputV1,
    selfHash("inputHash"),
  ),
  sangtian_pressure_finale_decision_v1: entry(
    "SangtianPressureFinaleDecisionV1",
    validateSangtianPressureFinaleDecisionV1,
    computed("semanticOutcomeHash", "executionFingerprint"),
  ),
  openovel_narrative_projection_job_v1: entry(
    "OpenNovelNarrativeProjectionJobV1",
    validateOpenNovelNarrativeProjectionJobV1,
    NONE,
  ),
  openovel_narrative_artifact_v1: entry(
    "OpenNovelNarrativeArtifactV1",
    validateOpenNovelNarrativeArtifactV1,
    computed("validationReportHash", "contentHash"),
  ),
  pressure_replay_command_v1: entry(
    "PressureReplayCommandV1",
    validatePressureReplayCommandV1,
    computed("actionFingerprint", "requestFingerprint"),
  ),
  replay_creation_receipt_v1: entry(
    "ReplayCreationReceiptV1",
    validateReplayCreationReceiptV1,
    selfHash("receiptHash"),
  ),
  sangtian_pressure_result_v1: entry(
    "SangtianPressureResultV1",
    validateSangtianPressureResultV1,
    computed("decisionHash", "structuredResultHash", "presentationHash"),
  ),
  frozen_sangtian_result_catalog_v1: entry(
    "FrozenSangtianResultCatalogV1",
    validateFrozenSangtianResultCatalogV1,
    selfHash("catalogHash"),
  ),
  terminal_result_context_v1: entry(
    "TerminalResultContextV1",
    validateTerminalResultContextV1,
    selfHash("contextHash"),
  ),
  authoritative_pressure_result_snapshot_v1: entry(
    "AuthoritativePressureResultSnapshotV1",
    validateAuthoritativePressureResultSnapshotV1,
    selfHash("snapshotHash"),
  ),
  endgame_result_envelope_v1: entry(
    "SangtianPressureResultEnvelopeV1",
    validateSangtianPressureResultEnvelopeV1,
    computed("sourceCommitHash", "decisionHash", "presentationHash"),
    "envelopeSchemaVersion",
  ),
} as const);

export type PressureChapterSchemaVersionV1 = keyof typeof REGISTRY;

export interface PressureChapterSchemaDescriptorV1 {
  readonly schemaVersion: PressureChapterSchemaVersionV1;
  readonly definitionName: string;
  readonly rootRef: string;
  readonly discriminatorField: "schemaVersion" | "envelopeSchemaVersion";
  readonly embeddedHashRule: PressureEmbeddedHashRuleV1;
  readonly schemaDocumentHash: string;
}

export const PRESSURE_CHAPTER_SCHEMA_VERSIONS_V1 = Object.freeze(
  Object.keys(REGISTRY) as PressureChapterSchemaVersionV1[],
);

export function isPressureChapterSchemaVersionV1(
  value: unknown,
): value is PressureChapterSchemaVersionV1 {
  return typeof value === "string" && value in REGISTRY;
}

export function getPressureChapterSchemaDescriptorV1(
  schemaVersion: unknown,
): PressureChapterSchemaDescriptorV1 {
  const version = requireRegisteredVersion(schemaVersion);
  const registered = REGISTRY[version];
  return Object.freeze({
    schemaVersion: version,
    definitionName: registered.definitionName,
    rootRef: `#/$defs/${registered.definitionName}`,
    discriminatorField: registered.discriminatorField,
    embeddedHashRule: registered.embeddedHashRule,
    schemaDocumentHash: PRESSURE_CHAPTER_SCHEMA_DOCUMENT_HASH_V1,
  });
}

export function loadPressureChapterSchemaV1(schemaVersion: unknown): {
  readonly document: JsonSchemaDocumentV1;
  readonly descriptor: PressureChapterSchemaDescriptorV1;
} {
  return Object.freeze({
    document: PRESSURE_CHAPTER_SCHEMA_BUNDLE_V1,
    descriptor: getPressureChapterSchemaDescriptorV1(schemaVersion),
  });
}

/**
 * Dispatches to the existing shared semantic validator. JSON Schema is a
 * machine-readable shape contract, not a second source of game semantics.
 */
export function validatePressureChapterContractV1(
  schemaVersion: unknown,
  value: unknown,
): unknown {
  const version = requireRegisteredVersion(schemaVersion);
  const registered = REGISTRY[version];
  const record = requirePlainObject(value, version);
  if (record[registered.discriminatorField] !== version) {
    failPressureContract(
      ERROR.SCHEMA_VERSION_UNSUPPORTED,
      `pressureSchema.${registered.discriminatorField}`,
      `EXPECTED_${version}`,
    );
  }
  return registered.validator(value);
}

export function canonicalPressureChapterContractV1(
  schemaVersion: unknown,
  value: unknown,
): string {
  return canonicalJson(validatePressureChapterContractV1(schemaVersion, value));
}

export function hashPressureChapterContractV1(
  schemaVersion: unknown,
  value: unknown,
): string {
  return sha256Canonical(validatePressureChapterContractV1(schemaVersion, value));
}

function entry(
  definitionName: string,
  validator: ContractValidator,
  embeddedHashRule: PressureEmbeddedHashRuleV1,
  discriminatorField: RegistryEntryV1["discriminatorField"] = "schemaVersion",
): RegistryEntryV1 {
  return Object.freeze({
    definitionName,
    validator,
    embeddedHashRule,
    discriminatorField,
  });
}

function requireRegisteredVersion(value: unknown): PressureChapterSchemaVersionV1 {
  if (!isPressureChapterSchemaVersionV1(value)) {
    failPressureContract(
      ERROR.SCHEMA_VERSION_UNSUPPORTED,
      "pressureSchema.schemaVersion",
      typeof value === "string" ? value : typeof value,
    );
  }
  return value;
}

function requirePlainObject(
  value: unknown,
  schemaVersion: PressureChapterSchemaVersionV1,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failPressureContract(
      ERROR.CONTRACT_NOT_OBJECT,
      `pressureSchema.${schemaVersion}`,
    );
  }
  return value as Record<string, unknown>;
}

/**
 * TrackStateV1 is a nested contract whose validator intentionally remains
 * private to WorldStateV1. This adapter exercises it through a minimal valid
 * six-seat world instead of copying the domain validation rules.
 */
function validateTrackStateThroughWorldContract(value: unknown): unknown {
  const knowledgeBySeat = Object.fromEntries(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const base = {
        seatId,
        knownFactRefs: [],
        secretRefs: [],
        disclosedToSeatIds: [],
      };
      return [seatId, { ...base, stateHash: sha256Canonical(base) }];
    }),
  );
  const seatArcs = Object.fromEntries(
    PRESSURE_CHAPTER_SEAT_IDS_V1.map((seatId) => {
      const base = {
        seatId,
        arcStage: "SCHEMA_VALIDATION",
        publicGoalProgress: 0,
        privateGoalProgress: 0,
        gainRefs: [],
        lossRefs: [],
        costRefs: [],
      };
      return [seatId, { ...base, stateHash: sha256Canonical(base) }];
    }),
  );
  const baseWorld = {
    schemaVersion: "sangtian_world_state_v1" as const,
    worldSequence: 0,
    factValues: {},
    resources: {},
    tracks: value,
    objects: [],
    knowledgeBySeat,
    evidence: [],
    responsibilities: [],
    seatArcs,
  };
  const validated = validateWorldStateV1({
    ...baseWorld,
    stateHash: sha256Canonical(baseWorld),
  });
  return validated.tracks;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
