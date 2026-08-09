import { createHash } from "node:crypto";

export const OPENOVEL_RESULT_INTEGRITY_SCHEMA = "openovel_result_integrity_v1" as const;

export type OpenNovelResultIntegrityV1 = {
  schemaVersion: typeof OPENOVEL_RESULT_INTEGRITY_SCHEMA;
  endingInputHash: string;
  endingHash: string;
  presentationHash: string;
};

/**
 * Add deterministic integrity hashes to an already-authorized result. The
 * hashes are a read contract only: they never participate in ending
 * classification and never make narration authoritative.
 */
export function withOpenNovelResultIntegrity<T>(value: T): T | (T & {
  integrity: OpenNovelResultIntegrityV1;
}) {
  const root = record(value);
  if (root.schemaVersion !== "openovel_result_v2") return value;

  const ending = root.ending ?? null;
  const presentation = root.presentation ?? null;
  const room = record(root.room);
  const causes = Array.isArray(record(presentation).causes)
    ? record(presentation).causes
    : [];

  const endingInput = {
    runId: String(room.id || ""),
    worldId: String(room.worldId || ""),
    completedNodes: finiteInteger(root.completedNodes),
    ending,
    // Causes are the player-safe projection of the committed action/event
    // chain. Including their immutable references detects a partial DB mirror
    // without hashing private Runtime evidence into an owner-facing response.
    causes: causes.map((candidate: unknown) => {
      const cause = record(candidate);
      return {
        stageIndex: cause.stageIndex ?? null,
        sourceActionId: cause.sourceActionId ?? null,
        sourceRoleName: cause.sourceRoleName ?? null,
        actionTitle: String(cause.actionTitle || ""),
        factText: String(cause.factText || ""),
        direction: String(cause.direction || ""),
      };
    }),
  };

  return {
    ...(root as T & Record<string, unknown>),
    integrity: {
      schemaVersion: OPENOVEL_RESULT_INTEGRITY_SCHEMA,
      endingInputHash: canonicalOpenNovelHash(endingInput),
      endingHash: canonicalOpenNovelHash(ending),
      presentationHash: canonicalOpenNovelHash(presentation),
    },
  };
}

export function canonicalOpenNovelHash(value: unknown) {
  return createHash("sha256")
    .update(stableCanonicalJson(value))
    .digest("hex");
}

export function stableCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableCanonicalJson).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(object[key])}`)
    .join(",")}}`;
}

function finiteInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
