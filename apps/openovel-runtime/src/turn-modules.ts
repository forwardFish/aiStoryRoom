import { createHash } from "node:crypto";

export const turnModuleKinds = [
  "ACTION_GATEWAY",
  "PLAYER_PROJECTION",
  "CONTEXT_COMPILER",
  "FACT_SETTLEMENT",
  "NEXT_BEAT_PLANNER",
  "SCENE_RENDER_PLANNER",
  "PROTECTED_SCENE_RENDERER",
  "NARRATIVE_RENDERER",
  "SURFACE_GUARD",
  "TRUTH_OBSERVER",
  "REVIEW_POLICY",
  "ATOMIC_COMMITTER",
  "OPTIONS_AND_MEMORY",
] as const;

export type TurnModuleKind = (typeof turnModuleKinds)[number];
export type TurnModuleMode = "REQUIRED" | "OPTIONAL" | "DISABLED" | "FALLBACK_ONLY";

export type TurnModuleDescriptor = {
  kind: TurnModuleKind;
  moduleId: string;
  mode: TurnModuleMode;
  fallbackModuleId?: string;
};

export type TurnModuleExecutionRecord = {
  schemaVersion: "omw.turn-module-execution.v1";
  runId: string;
  turnId: string;
  kind: TurnModuleKind;
  moduleId: string;
  mode: TurnModuleMode;
  inputHash: string;
  outputHash: string | null;
  status: "PASS" | "FAILED" | "SKIPPED" | "FALLBACK";
  latencyMs: number;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCostUsd?: number | null;
  errorCode?: string | null;
  fallbackModuleId?: string | null;
};

const requiredKinds = new Set<TurnModuleKind>([
  "ACTION_GATEWAY",
  "PLAYER_PROJECTION",
  "CONTEXT_COMPILER",
  "FACT_SETTLEMENT",
  "NEXT_BEAT_PLANNER",
  "SCENE_RENDER_PLANNER",
  "PROTECTED_SCENE_RENDERER",
  "NARRATIVE_RENDERER",
  "SURFACE_GUARD",
  "ATOMIC_COMMITTER",
  "OPTIONS_AND_MEMORY",
]);

/**
 * Runtime-owned module registry. It validates composition before a run starts;
 * it does not contain world-specific branching or story semantics.
 */
export class TurnModuleRegistry {
  private readonly byKind = new Map<TurnModuleKind, TurnModuleDescriptor>();

  constructor(descriptors: TurnModuleDescriptor[]) {
    for (const descriptor of descriptors) {
      if (!turnModuleKinds.includes(descriptor.kind)) {
        throw new Error(`TURN_MODULE_KIND_UNKNOWN:${descriptor.kind}`);
      }
      if (!descriptor.moduleId.trim()) throw new Error(`TURN_MODULE_ID_EMPTY:${descriptor.kind}`);
      if (this.byKind.has(descriptor.kind)) {
        throw new Error(`TURN_MODULE_DUPLICATE:${descriptor.kind}`);
      }
      this.byKind.set(descriptor.kind, { ...descriptor });
    }
    for (const kind of requiredKinds) {
      const descriptor = this.byKind.get(kind);
      if (!descriptor) throw new Error(`TURN_MODULE_REQUIRED_MISSING:${kind}`);
      if (descriptor.mode === "DISABLED") throw new Error(`TURN_MODULE_REQUIRED_DISABLED:${kind}`);
      if (descriptor.mode === "FALLBACK_ONLY" && !descriptor.fallbackModuleId) {
        throw new Error(`TURN_MODULE_FALLBACK_MISSING:${kind}`);
      }
    }
  }

  descriptor(kind: TurnModuleKind): TurnModuleDescriptor | null {
    const value = this.byKind.get(kind);
    return value ? { ...value } : null;
  }

  enabled(kind: TurnModuleKind): boolean {
    const descriptor = this.byKind.get(kind);
    return Boolean(descriptor && descriptor.mode !== "DISABLED");
  }

  list(): TurnModuleDescriptor[] {
    return turnModuleKinds
      .map((kind) => this.byKind.get(kind))
      .filter((value): value is TurnModuleDescriptor => Boolean(value))
      .map((value) => ({ ...value }));
  }
}

export async function executeTurnModule<T>(input: {
  runId: string;
  turnId: string;
  descriptor: TurnModuleDescriptor;
  value: unknown;
  execute: () => Promise<T> | T;
  telemetry?: (result: T) => Partial<Pick<
    TurnModuleExecutionRecord,
    "model" | "inputTokens" | "outputTokens" | "estimatedCostUsd"
  >>;
  onRecord?: (record: TurnModuleExecutionRecord) => Promise<void> | void;
}): Promise<T> {
  if (input.descriptor.mode === "DISABLED") {
    const record = executionRecord(input, "SKIPPED", 0, null, "TURN_MODULE_DISABLED");
    await input.onRecord?.(record);
    throw new Error(`TURN_MODULE_DISABLED:${input.descriptor.kind}`);
  }
  const started = Date.now();
  try {
    const result = await input.execute();
    const status = input.descriptor.mode === "FALLBACK_ONLY" ? "FALLBACK" : "PASS";
    const record = {
      ...executionRecord(
        input,
        status,
        Date.now() - started,
        stableHash(result),
        null,
      ),
      ...(input.telemetry?.(result) || {}),
    };
    await input.onRecord?.(record);
    return result;
  } catch (error) {
    const code = String((error as Error)?.message || error || "UNKNOWN").split(":", 1)[0];
    const record = executionRecord(input, "FAILED", Date.now() - started, null, code);
    await input.onRecord?.(record);
    throw error;
  }
}

function executionRecord(
  input: {
    runId: string;
    turnId: string;
    descriptor: TurnModuleDescriptor;
    value: unknown;
  },
  status: TurnModuleExecutionRecord["status"],
  latencyMs: number,
  outputHash: string | null,
  errorCode: string | null,
): TurnModuleExecutionRecord {
  return {
    schemaVersion: "omw.turn-module-execution.v1",
    runId: input.runId,
    turnId: input.turnId,
    kind: input.descriptor.kind,
    moduleId: input.descriptor.moduleId,
    mode: input.descriptor.mode,
    inputHash: stableHash(input.value),
    outputHash,
    status,
    latencyMs,
    errorCode,
    fallbackModuleId: input.descriptor.fallbackModuleId || null,
  };
}

function stableHash(value: unknown) {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
