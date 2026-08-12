import type {
  NarrativeAudienceV1,
  NarrativeProjectionKindV1,
  NarrativeSourceAuthorityV1,
  OpenNovelNarrativeProjectionJobV1,
  SeatIdV1,
} from "@ai-story/shared";

export type NarrativeAuthorityVisibilityV1 = "PUBLIC" | "AUTHORIZED";

export interface NarrativeAuthorityAclV1 {
  visibility: NarrativeAuthorityVisibilityV1;
  authorizedSeatIds: SeatIdV1[];
}

export interface AuthoritativeNarrativeFactV1 extends NarrativeAuthorityAclV1 {
  factId: string;
  text: string;
  temporalStatus: "FROZEN" | "COMMITTED_WORKING" | "PENDING";
}

export interface AuthoritativeNarrativeObjectV1 extends NarrativeAuthorityAclV1 {
  objectVersionId: string;
  label: string;
  stateText: string;
}

export interface AuthoritativeNarrativeKnowledgeV1 extends NarrativeAuthorityAclV1 {
  knowledgeId: string;
  text: string;
}

export interface AuthoritativeNarrativeClaimV1 extends NarrativeAuthorityAclV1 {
  kind: "FACT" | "OUTCOME" | "VERDICT" | "OBJECT" | "KNOWLEDGE" | "TEMPORAL";
  refId: string;
  statement: string;
  required: boolean;
}

export type NonFinaleNarrativeVariantV1 =
  | { kind: "GENESIS"; stageId: "P0"; openingHook: string }
  | {
      kind: "BEAT";
      chapterId: "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
      workingRevision: number;
      temporalBoundary: "WORKING_NOT_FROZEN";
    }
  | {
      kind: "CHAPTER";
      chapterId: "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
      committedWorldSequence: number;
      nextChapterId: "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7" | null;
    };

export interface AuthoritativeNarrativeSourceSnapshotV1 {
  schemaVersion: "authoritative_narrative_source_snapshot_v1";
  runId: string;
  projectionKind: NarrativeProjectionKindV1;
  sourceAuthority: NarrativeSourceAuthorityV1;
  sourceId: string;
  sourceCommitHash: string;
  sourceContentHash: string;
  facts: AuthoritativeNarrativeFactV1[];
  objects: AuthoritativeNarrativeObjectV1[];
  knowledge: AuthoritativeNarrativeKnowledgeV1[];
  claims: AuthoritativeNarrativeClaimV1[];
  publicVariant: NonFinaleNarrativeVariantV1;
  seatVariants: Array<{
    seatId: SeatIdV1;
    variant: NonFinaleNarrativeVariantV1;
  }>;
}

/**
 * Current PressureBeatResolution columns do not contain chapter identity or
 * sealed action presentation bindings. The read adapter must enrich the
 * committed row with these already-persisted relations before compilation.
 * Nothing in this envelope may come from Provider or narrative text.
 */
export interface CommittedBeatNarrativeAuthorityV1 {
  schemaVersion: "pressure_committed_beat_narrative_authority_v1";
  runId: string;
  chapterRuntimeId: string;
  chapterId: "N1" | "N2" | "N3" | "N4" | "N5" | "N6" | "N7";
  decisionPointId: string;
  decisionPointKey: string;
  baseWorkingRevision: number;
  committedWorkingRevision: number;
  inputWorkingStateHash: string;
  sealedActionIds: string[];
  sealedActionsHash: string;
  sealedActions: unknown[];
  resolverVersion: string;
  workingDelta: unknown;
  workingDeltaHash: string;
  reservationMutations: unknown;
  reactionContextRef: { sourceHash: string } | null;
  nextDecisionContextRef: { sourceHash: string } | null;
  resolutionHash: string;
  contentPackageSha256: string;
}

export interface NarrativeAuthorityAudienceAllowlistV1 {
  audience: NarrativeAudienceV1;
  allowedFactIds: string[];
  allowedObjectVersionIds: string[];
  allowedKnowledgeIds: string[];
}

export interface ExtendedAuthoritativeNarrativeSnapshotCompilerPortV1 {
  compile(
    job: Readonly<OpenNovelNarrativeProjectionJobV1>,
    rawAuthority: Readonly<unknown>,
  ): unknown;
  deriveAudienceAllowlist(
    job: Readonly<OpenNovelNarrativeProjectionJobV1>,
    rawAuthority: Readonly<unknown>,
  ): NarrativeAuthorityAudienceAllowlistV1;
}
