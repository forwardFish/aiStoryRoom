import { createHash } from "node:crypto";
import {
  AUTHORITATIVE_RESULT_STATUS_FINALIZED,
  OPENOVEL_RESULT_SCHEMA_V2,
  type OpenNovelEndingV2,
  type OpenNovelSeatResultV2,
  type StoredOpenNovelResultV2,
} from "@ai-story/shared";

export type BuildAuthoritativeResultV2Input = Readonly<{
  sourceKind: StoredOpenNovelResultV2["sourceKind"];
  runId: string;
  title: string;
  worldId: string;
  decisionHash: string;
  worldSequence: number;
  completedAt: string;
  ending: OpenNovelEndingV2;
  canon: readonly Readonly<{ factKey: string; content: string }>[];
  result: StoredOpenNovelResultV2["result"];
  seatResults: readonly OpenNovelSeatResultV2[];
}>;

export function buildOpenNovelAuthoritativeResultV2(
  input: BuildAuthoritativeResultV2Input,
): StoredOpenNovelResultV2 {
  const immutable = {
    sourceKind: input.sourceKind,
    runId: input.runId,
    title: input.title,
    worldId: input.worldId,
    decisionHash: input.decisionHash,
    worldSequence: input.worldSequence,
    completedAt: input.completedAt,
    ending: input.ending,
    canon: [...input.canon].sort((left, right) => left.factKey.localeCompare(right.factKey)),
    result: input.result,
    seatResults: [...input.seatResults].sort((left, right) => left.roleId.localeCompare(right.roleId)),
  };
  const sourceCommitHash = sha256CanonicalValue(immutable);
  return Object.freeze({
    schemaVersion: OPENOVEL_RESULT_SCHEMA_V2,
    authoritativeResultStatus: AUTHORITATIVE_RESULT_STATUS_FINALIZED,
    structuredResultReady: true,
    sourceKind: input.sourceKind,
    sourceCommitHash,
    decisionHash: input.decisionHash,
    worldSequence: input.worldSequence,
    completedAt: input.completedAt,
    room: Object.freeze({
      id: input.runId,
      title: input.title,
      worldId: input.worldId,
    }),
    ending: input.ending,
    canon: immutable.canon,
    result: input.result,
    seatResults: immutable.seatResults,
    narrativeStatus: "PENDING",
  });
}

export function sha256CanonicalValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)]),
  );
}
