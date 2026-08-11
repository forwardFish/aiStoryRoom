import {
  AUTHORITATIVE_RESULT_STATUS_FINALIZED,
  NARRATIVE_PENDING_MESSAGE_ZH,
  isNarrativeProjectionStatus,
  type NarrativeProjectionStatus,
} from "./narrative-projection";

export const OPENOVEL_RESULT_SCHEMA_V2 = "openovel-result-v2" as const;
export const OPENOVEL_AUTHORITATIVE_RESULT_STATE_KEY = "openNovelResultV2" as const;

export type OpenNovelEndingV2 = Readonly<{
  scope: "STORY" | "PART";
  endingKey: string;
  title: string;
  summary: string;
  protagonistFate: string;
  aftermath: readonly string[];
}>;

export type OpenNovelSeatResultV2 = Readonly<{
  roleId: string;
  roleKey: string;
  roleName: string;
  outcome: "WIN" | "COSTLY_WIN" | "LOSS" | "RESOLVED";
  title: string;
  summary: string;
  causes: readonly string[];
}>;

export type StoredOpenNovelResultV2 = Readonly<{
  schemaVersion: typeof OPENOVEL_RESULT_SCHEMA_V2;
  authoritativeResultStatus: typeof AUTHORITATIVE_RESULT_STATUS_FINALIZED;
  structuredResultReady: true;
  sourceKind: "B0_FINALE" | "LEGACY_TERMINAL" | "HISTORICAL_READ_ONLY";
  sourceCommitHash: string;
  decisionHash: string;
  worldSequence: number;
  completedAt: string;
  room: Readonly<{
    id: string;
    title: string;
    worldId: string;
  }>;
  ending: OpenNovelEndingV2;
  canon: readonly Readonly<{ factKey: string; content: string }>[];
  result: Readonly<{
    title: string;
    summary: string;
    worldOutcome: string;
  }>;
  seatResults: readonly OpenNovelSeatResultV2[];
  narrativeStatus: NarrativeProjectionStatus;
}>;

export type OpenNovelResultV2 = Readonly<{
  schemaVersion: typeof OPENOVEL_RESULT_SCHEMA_V2;
  authoritativeResultStatus: typeof AUTHORITATIVE_RESULT_STATUS_FINALIZED;
  structuredResultReady: true;
  sourceKind: StoredOpenNovelResultV2["sourceKind"];
  sourceCommitHash: string;
  decisionHash: string;
  worldSequence: number;
  completedAt: string;
  room: StoredOpenNovelResultV2["room"];
  ending: OpenNovelEndingV2;
  canon: StoredOpenNovelResultV2["canon"];
  result: StoredOpenNovelResultV2["result"];
  player: OpenNovelSeatResultV2 | null;
  narrativeStatus: NarrativeProjectionStatus;
  narrative: Readonly<{
    status: NarrativeProjectionStatus;
    content: string | null;
    presentationHash: string | null;
    updatedAt: string | null;
    message: string | null;
  }>;
}>;

export type OpenNovelNarrativeReadV2 = Readonly<{
  status: NarrativeProjectionStatus;
  content?: string | null;
  presentationHash?: string | null;
  updatedAt?: string | null;
}>;

export function parseStoredOpenNovelResultV2(value: unknown): StoredOpenNovelResultV2 | null {
  const record = asRecord(value);
  if (!record || record.schemaVersion !== OPENOVEL_RESULT_SCHEMA_V2) return null;
  if (record.authoritativeResultStatus !== AUTHORITATIVE_RESULT_STATUS_FINALIZED
    || record.structuredResultReady !== true
    || typeof record.sourceCommitHash !== "string"
    || typeof record.decisionHash !== "string"
    || !Number.isInteger(record.worldSequence)
    || typeof record.completedAt !== "string"
    || !asRecord(record.room)
    || !asRecord(record.ending)
    || !asRecord(record.result)
    || !Array.isArray(record.canon)
    || !Array.isArray(record.seatResults)
    || !isNarrativeProjectionStatus(record.narrativeStatus)) {
    return null;
  }
  return record as unknown as StoredOpenNovelResultV2;
}

export function projectOpenNovelResultV2(
  stored: StoredOpenNovelResultV2,
  roleId: string | null,
  narrative: OpenNovelNarrativeReadV2,
): OpenNovelResultV2 {
  const status = isNarrativeProjectionStatus(narrative.status)
    ? narrative.status
    : stored.narrativeStatus;
  const published = status === "PUBLISHED" || status === "FALLBACK_PUBLISHED";
  return Object.freeze({
    schemaVersion: OPENOVEL_RESULT_SCHEMA_V2,
    authoritativeResultStatus: AUTHORITATIVE_RESULT_STATUS_FINALIZED,
    structuredResultReady: true,
    sourceKind: stored.sourceKind,
    sourceCommitHash: stored.sourceCommitHash,
    decisionHash: stored.decisionHash,
    worldSequence: stored.worldSequence,
    completedAt: stored.completedAt,
    room: stored.room,
    ending: stored.ending,
    canon: stored.canon,
    result: stored.result,
    player: roleId ? stored.seatResults.find((seat) => seat.roleId === roleId) ?? null : null,
    narrativeStatus: status,
    narrative: Object.freeze({
      status,
      content: published ? String(narrative.content ?? "") || null : null,
      presentationHash: published ? narrative.presentationHash ?? null : null,
      updatedAt: narrative.updatedAt ?? null,
      message: published ? null : NARRATIVE_PENDING_MESSAGE_ZH,
    }),
  });
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}
