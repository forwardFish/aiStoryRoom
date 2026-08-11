import type { Prisma } from "@prisma/client";
import type { NarrativeProjectionStatus } from "@ai-story/shared";

export const OPENOVEL_NARRATIVE_SOURCE_SCHEMA_V1 = "openovel-narrative-source-v1" as const;

export type OpenNovelNarrativeSourceV1 = Readonly<{
  schemaVersion: typeof OPENOVEL_NARRATIVE_SOURCE_SCHEMA_V1;
  sourceKind: "B0_SETTLEMENT" | "FINALE" | "LEGACY_TERMINAL";
  sourceCommitHash: string;
  runId: string;
  nodeId: string | null;
  windowId: string | null;
  roleId: string | null;
  entryType: string;
  visibility: string;
  worldSequence: number | null;
  dedupeKey: string;
  providerInput: unknown;
  fallbackLines: readonly string[];
  forbiddenPhrases: readonly string[];
  forbiddenClaims: readonly string[];
  sourceTaskResult: Prisma.JsonValue | null;
}>;

export type NarrativeRenderOutputV1 = Readonly<{
  text: string;
  model: string | null;
  providerRequestId: string | null;
}>;

export type NarrativeTruthGuardResultV1 = Readonly<{
  ok: boolean;
  normalizedText: string;
  failureCode: string | null;
}>;

export type NarrativePublicationInputV1 = Readonly<{
  taskId: string;
  leaseOwner: string;
  leaseVersion: number;
  source: OpenNovelNarrativeSourceV1;
  content: string;
  narrativeStatus: Extract<NarrativeProjectionStatus, "PUBLISHED" | "FALLBACK_PUBLISHED">;
  failureCode: string | null;
  model: string | null;
  providerRequestId: string | null;
}>;

export type NarrativePublicationResultV1 = Readonly<{
  outcome: "PUBLISHED" | "FALLBACK_PUBLISHED" | "LEASE_LOST";
  narrativeEntryId?: string;
  sourceCommitHash?: string;
  presentationHash?: string;
  sourceFinalization?: Readonly<{
    schemaVersion: "story-task-source-finalization-v1";
    taskId: string;
    leaseOwner: string;
    leaseVersion: number;
  }>;
}>;
