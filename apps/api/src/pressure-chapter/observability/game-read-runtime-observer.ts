import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { setImmediate } from "node:timers";
import type {
  PressureGameReadShadowDiagnosticPortV1,
  PressureGameReadShadowDiagnosticV1,
} from "../game-projection/game-read-mode-selector";
import {
  createPressureGameReadObservationV1,
  validatePressureGameReadObservationV1,
  type PressureGameReadModeV1,
  type PressureGameReadObservationV1,
  type PressureGameReadOutcomeV1,
  type PressureGameReadShadowStatusV1,
} from "./game-read-observation";
import {
  readPressureDbRequestMetricsV1,
  type PressureDbRequestMetricsV1,
} from "./pressure-db-metrics";

export const PRESSURE_GAME_READ_OBSERVATION_LOG_ENV_V1 =
  "PRESSURE_GAME_READ_OBSERVATION_LOG" as const;

const REQUEST_DIGEST_SCHEMA_V1 =
  "pressure_game_read_runtime_request_digest_v1" as const;
const SCENARIO_DIGEST_SCHEMA_V1 =
  "pressure_game_read_runtime_scenario_digest_v1" as const;

const ZERO_DB_METRICS_V1: Readonly<PressureDbRequestMetricsV1> = Object.freeze({
  applicationSqlStatementCount: 0,
  databaseProtocolRoundtripCountIncludingBeginCommit: 0,
  transactionAttemptCount: 0,
  committedTransactionCount: 0,
  rolledBackTransactionCount: 0,
  transactionRetryCount: 0,
  queryDurationMs: 0,
  queryHashes: [],
});

export interface PressureGameReadSafeRequestInputV1 {
  /** Raw values are used only as ephemeral hash input and are never retained or emitted. */
  readonly roomId: unknown;
  readonly principal: unknown;
  readonly query: unknown;
}

export interface PressureGameReadObservationSinkV1 {
  write(observation: PressureGameReadObservationV1): void | Promise<void>;
}

export interface PressureGameReadRuntimeClockPortV1 {
  nowMs(): number;
}

export interface PressureGameReadRuntimeNoncePortV1 {
  createNonce(): string;
}

export interface PressureGameReadRuntimeObserverPortV1
extends PressureGameReadShadowDiagnosticPortV1 {
  observe<T>(
    mode: PressureGameReadModeV1,
    safeRequestInput: Readonly<PressureGameReadSafeRequestInputV1>,
    operation: () => Promise<T>,
  ): Promise<T>;
}

export interface PressureGameReadRuntimeObserverDependenciesV1 {
  readonly sink?: PressureGameReadObservationSinkV1;
  readonly clock?: PressureGameReadRuntimeClockPortV1;
  readonly nonce?: PressureGameReadRuntimeNoncePortV1;
}

interface MutablePressureGameReadRuntimeContextV1 {
  readonly mode: PressureGameReadModeV1;
  readonly requestDigest: string;
  readonly scenarioDigest: string;
  readonly startedAtMs: number;
  observabilityFailure: boolean;
  diagnosticReported: boolean;
  shadowStatus: PressureGameReadShadowStatusV1 | null;
}

interface RuntimeDigestsV1 {
  readonly requestDigest: string;
  readonly scenarioDigest: string;
  readonly observabilityFailure: boolean;
}

interface SafeReadV1<T> {
  readonly value: T;
  readonly observabilityFailure: boolean;
}

interface SafeMaterialValueV1 {
  readonly type: string;
  readonly value?: string | number | boolean | null;
}

export class NoopPressureGameReadObservationSinkV1
implements PressureGameReadObservationSinkV1 {
  write(_observation: PressureGameReadObservationV1): void {}
}

/** Internal JSONL sink; disabled unless the dedicated flag is exactly `1`. */
export class EnvironmentPressureGameReadObservationSinkV1
implements PressureGameReadObservationSinkV1 {
  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> =
      process.env,
    private readonly writeLine: (line: string) => void =
      (line) => console.error(line),
  ) {}

  write(observation: PressureGameReadObservationV1): void {
    if (this.environment[PRESSURE_GAME_READ_OBSERVATION_LOG_ENV_V1] !== "1") return;
    this.writeLine(JSON.stringify(observation));
  }
}

/** Direct facade construction remains behaviorally inert unless ProductRoot wires M5B. */
export class NoopPressureGameReadRuntimeObserverV1
implements PressureGameReadRuntimeObserverPortV1 {
  observe<T>(
    _mode: PressureGameReadModeV1,
    _safeRequestInput: Readonly<PressureGameReadSafeRequestInputV1>,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }

  report(_diagnostic: PressureGameReadShadowDiagnosticV1): void {}
}

/**
 * Request-local M5B observer. It owns no query counter or projection logic;
 * its only database metric source is readPressureDbRequestMetricsV1().
 */
export class PressureGameReadRuntimeObserverV1
implements PressureGameReadRuntimeObserverPortV1 {
  private readonly storage =
    new AsyncLocalStorage<MutablePressureGameReadRuntimeContextV1>();
  private readonly sink: PressureGameReadObservationSinkV1;
  private readonly clock: PressureGameReadRuntimeClockPortV1;
  private readonly nonce: PressureGameReadRuntimeNoncePortV1;

  constructor(
    dependencies: Readonly<PressureGameReadRuntimeObserverDependenciesV1> = {},
  ) {
    this.sink = dependencies.sink ?? new NoopPressureGameReadObservationSinkV1();
    this.clock = dependencies.clock ?? { nowMs: () => Date.now() };
    this.nonce = dependencies.nonce ?? {
      createNonce: () => randomBytes(32).toString("hex"),
    };
  }

  observe<T>(
    modeValue: PressureGameReadModeV1,
    safeRequestInput: Readonly<PressureGameReadSafeRequestInputV1>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const mode = normalizeMode(modeValue);
    const started = readStartedAtMs(this.clock);
    let digests: RuntimeDigestsV1;
    try {
      digests = createRuntimeDigests(mode, safeRequestInput, this.nonce);
    } catch {
      return operation();
    }

    const context: MutablePressureGameReadRuntimeContextV1 = {
      mode,
      requestDigest: digests.requestDigest,
      scenarioDigest: digests.scenarioDigest,
      startedAtMs: started.value,
      observabilityFailure:
        started.observabilityFailure
        || digests.observabilityFailure
        || mode !== modeValue,
      diagnosticReported: false,
      shadowStatus: null,
    };

    try {
      return this.storage.run(context, () => this.runObserved(context, operation));
    } catch {
      // AsyncLocalStorage setup must never prevent the one business invocation.
      return operation();
    }
  }

  report(diagnostic: PressureGameReadShadowDiagnosticV1): void {
    const context = this.storage.getStore();
    if (!context) return;

    if (context.mode !== "SHADOW") {
      context.diagnosticReported = true;
      context.observabilityFailure = true;
      return;
    }
    if (context.diagnosticReported) {
      context.shadowStatus = "ERROR";
      context.observabilityFailure = true;
      return;
    }

    context.diagnosticReported = true;
    context.shadowStatus = readShadowStatus(diagnostic);
    if (context.shadowStatus === "ERROR") {
      context.observabilityFailure = true;
    }
  }

  private async runObserved<T>(
    context: MutablePressureGameReadRuntimeContextV1,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      const value = await operation();
      this.finish(context, "SUCCESS");
      return value;
    } catch (error) {
      this.finish(context, classifyPressureGameReadOutcomeV1(error));
      throw error;
    }
  }

  private finish(
    context: MutablePressureGameReadRuntimeContextV1,
    outcome: PressureGameReadOutcomeV1,
  ): void {
    try {
      const finished = readFinishedAtMs(this.clock, context.startedAtMs);
      const metrics = readMetricsSnapshot();
      if (finished.observabilityFailure || metrics.observabilityFailure) {
        context.observabilityFailure = true;
      }

      const shadowStatus = resolveShadowStatus(context);
      let observation: PressureGameReadObservationV1;
      try {
        observation = createValidatedObservation(
          context,
          outcome,
          shadowStatus,
          finished.value,
          metrics.value,
        );
      } catch {
        context.observabilityFailure = true;
        observation = createValidatedObservation(
          context,
          outcome,
          shadowStatus,
          finished.value,
          ZERO_DB_METRICS_V1,
        );
      }
      deliverAfterSettlement(this.sink, observation);
    } catch {
      return;
    }
  }
}

export function classifyPressureGameReadOutcomeV1(
  error: unknown,
): Exclude<PressureGameReadOutcomeV1, "SUCCESS"> {
  const code = safeErrorCode(error);
  if (code === "PRESSURE_HTTP_DEPENDENCY_FAILURE") return "DEPENDENCY_ERROR";
  if (code.startsWith("PRESSURE_HTTP_")) return "BUSINESS_ERROR";

  const status = safeHttpStatus(error);
  if (status !== null) {
    if (status >= 400 && status < 500) return "BUSINESS_ERROR";
    if (status >= 500) return "DEPENDENCY_ERROR";
  }

  if (isBusinessDomainCode(code)) return "BUSINESS_ERROR";
  if (isDependencyCode(code)) return "DEPENDENCY_ERROR";
  return "INTERNAL_ERROR";
}

function createValidatedObservation(
  context: MutablePressureGameReadRuntimeContextV1,
  outcome: PressureGameReadOutcomeV1,
  shadowStatus: PressureGameReadShadowStatusV1,
  finishedAtMs: number,
  metrics: Readonly<PressureDbRequestMetricsV1>,
): PressureGameReadObservationV1 {
  const created = createPressureGameReadObservationV1({
    mode: context.mode,
    shadowStatus,
    outcome,
    requestDigest: context.requestDigest,
    scenarioDigest: context.scenarioDigest,
    startedAtMs: context.startedAtMs,
    finishedAtMs,
    wallTimeMs: finishedAtMs - context.startedAtMs,
    metrics,
    observabilityFailure: context.observabilityFailure,
  });
  return validatePressureGameReadObservationV1(created);
}

function resolveShadowStatus(
  context: MutablePressureGameReadRuntimeContextV1,
): PressureGameReadShadowStatusV1 {
  if (context.mode !== "SHADOW") return "NOT_RUN";
  if (!context.diagnosticReported || context.shadowStatus === null) {
    context.observabilityFailure = true;
    return "ERROR";
  }
  return context.shadowStatus;
}

function readMetricsSnapshot(): SafeReadV1<Readonly<PressureDbRequestMetricsV1>> {
  try {
    const value = readPressureDbRequestMetricsV1();
    return value === null
      ? { value: ZERO_DB_METRICS_V1, observabilityFailure: true }
      : { value, observabilityFailure: false };
  } catch {
    return { value: ZERO_DB_METRICS_V1, observabilityFailure: true };
  }
}

function deliverAfterSettlement(
  sink: PressureGameReadObservationSinkV1,
  observation: PressureGameReadObservationV1,
): void {
  try {
    const scheduled = setImmediate(() => {
      try {
        const delivery = sink.write(observation);
        if (delivery && typeof (delivery as PromiseLike<void>).then === "function") {
          void Promise.resolve(delivery).catch(() => undefined);
        }
      } catch {
        return;
      }
    });
    scheduled.unref();
  } catch {
    return;
  }
}

function createRuntimeDigests(
  mode: PressureGameReadModeV1,
  input: Readonly<PressureGameReadSafeRequestInputV1>,
  noncePort: PressureGameReadRuntimeNoncePortV1,
): RuntimeDigestsV1 {
  const scenario = readScenarioMaterial(mode, input);
  const scenarioDigest = sha256(JSON.stringify(scenario.value));
  const nonce = readNonce(noncePort);
  const requestDigest = sha256(JSON.stringify({
    schemaVersion: REQUEST_DIGEST_SCHEMA_V1,
    scenarioDigest,
    nonce: nonce.value,
  }));
  return {
    requestDigest,
    scenarioDigest,
    observabilityFailure:
      scenario.observabilityFailure || nonce.observabilityFailure,
  };
}

function readScenarioMaterial(
  mode: PressureGameReadModeV1,
  input: Readonly<PressureGameReadSafeRequestInputV1>,
): SafeReadV1<unknown> {
  try {
    const subjectId = readOwnMaterialValue(input.principal, "subjectId", undefined);
    const viewerId = readOwnMaterialValue(input.principal, "viewerId", undefined);
    const feedCursor = readOwnMaterialValue(input.query, "feedCursor", null);
    const feedLimit = readOwnMaterialValue(input.query, "feedLimit", 10);
    return {
      value: Object.freeze({
        schemaVersion: SCENARIO_DIGEST_SCHEMA_V1,
        mode,
        roomId: materialValue(input.roomId),
        subjectId: subjectId.value,
        viewerId: viewerId.value,
        feedCursor: feedCursor.value,
        feedLimit: feedLimit.value,
      }),
      observabilityFailure:
        subjectId.observabilityFailure
        || viewerId.observabilityFailure
        || feedCursor.observabilityFailure
        || feedLimit.observabilityFailure,
    };
  } catch {
    return {
      value: Object.freeze({
        schemaVersion: SCENARIO_DIGEST_SCHEMA_V1,
        mode,
        requestMaterial: "UNAVAILABLE",
      }),
      observabilityFailure: true,
    };
  }
}

function readOwnMaterialValue(
  record: unknown,
  key: string,
  defaultValue: unknown,
): SafeReadV1<SafeMaterialValueV1> {
  try {
    if (record === null || typeof record !== "object") {
      return { value: materialValue(defaultValue), observabilityFailure: false };
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
      return { value: materialValue(defaultValue), observabilityFailure: false };
    }
    if (!("value" in descriptor) || !descriptor.enumerable) {
      return {
        value: Object.freeze({ type: "UNAVAILABLE" }),
        observabilityFailure: true,
      };
    }
    return { value: materialValue(descriptor.value), observabilityFailure: false };
  } catch {
    return {
      value: Object.freeze({ type: "UNAVAILABLE" }),
      observabilityFailure: true,
    };
  }
}

function materialValue(value: unknown): SafeMaterialValueV1 {
  if (value === null) return Object.freeze({ type: "null", value: null });
  switch (typeof value) {
    case "string":
      return Object.freeze({ type: "string", value });
    case "number":
      return Number.isFinite(value)
        ? Object.freeze({ type: "number", value: Object.is(value, -0) ? 0 : value })
        : Object.freeze({ type: "number", value: String(value) });
    case "boolean":
      return Object.freeze({ type: "boolean", value });
    case "bigint":
      return Object.freeze({ type: "bigint", value: value.toString(10) });
    case "undefined":
      return Object.freeze({ type: "undefined" });
    default:
      return Object.freeze({ type: typeof value });
  }
}

function readNonce(
  noncePort: PressureGameReadRuntimeNoncePortV1,
): SafeReadV1<string> {
  try {
    const value = noncePort.createNonce();
    if (typeof value === "string" && value.length > 0 && value.length <= 1_024) {
      return { value, observabilityFailure: false };
    }
  } catch {
    // Fall through to local entropy; the observation is marked degraded.
  }
  return { value: fallbackNonce(), observabilityFailure: true };
}

function fallbackNonce(): string {
  try {
    return randomBytes(32).toString("hex");
  } catch {
    try {
      return sha256([
        safeDateNow(),
        process.hrtime.bigint().toString(10),
        Math.random(),
      ].join(":"));
    } catch {
      return sha256(String(safeDateNow()));
    }
  }
}

function readStartedAtMs(clock: PressureGameReadRuntimeClockPortV1): SafeReadV1<number> {
  try {
    const value = normalizeClockValue(clock.nowMs());
    if (value !== null) return { value, observabilityFailure: false };
  } catch {
    // Use a safe local envelope timestamp only for diagnostics.
  }
  return { value: safeDateNow(), observabilityFailure: true };
}

function readFinishedAtMs(
  clock: PressureGameReadRuntimeClockPortV1,
  startedAtMs: number,
): SafeReadV1<number> {
  try {
    const value = normalizeClockValue(clock.nowMs());
    if (value !== null && value >= startedAtMs) {
      return { value, observabilityFailure: false };
    }
  } catch {
    // A failed diagnostic clock cannot affect the business promise.
  }
  return { value: startedAtMs, observabilityFailure: true };
}

function normalizeClockValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function safeDateNow(): number {
  try {
    const value = Date.now();
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function normalizeMode(value: unknown): PressureGameReadModeV1 {
  return value === "SHADOW" || value === "FAST" || value === "REPLAY"
    ? value
    : "REPLAY";
}

function readShadowStatus(
  diagnostic: PressureGameReadShadowDiagnosticV1,
): PressureGameReadShadowStatusV1 {
  try {
    if (
      diagnostic.schemaVersion !== "pressure_game_read_shadow_diagnostic_v1"
      || diagnostic.mode !== "SHADOW"
    ) {
      return "ERROR";
    }
    if (diagnostic.outcome === "ERROR") return "ERROR";
    if (diagnostic.stage !== "COMPARE") return "ERROR";
    const equal = diagnostic.deepEqual && diagnostic.canonicalEqual;
    return (diagnostic.outcome === "MATCH") === equal
      ? diagnostic.outcome
      : "ERROR";
  } catch {
    return "ERROR";
  }
}

function safeErrorCode(error: unknown): string {
  try {
    if (error && typeof error === "object") {
      const descriptor = Object.getOwnPropertyDescriptor(error, "code");
      if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
        return descriptor.value;
      }
    }
  } catch {
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

function safeHttpStatus(error: unknown): number | null {
  try {
    if (!error || typeof error !== "object") return null;
    const candidate = (error as { getStatus?: unknown }).getStatus;
    if (typeof candidate !== "function") return null;
    const status = candidate.call(error);
    return Number.isSafeInteger(status) ? status : null;
  } catch {
    return null;
  }
}

function isBusinessDomainCode(code: string): boolean {
  return code === "RUN_ROUTE_NOT_FOUND"
    || code === "PRESSURE_GAME_ROUTE_NOT_FOUND"
    || code === "RESULT_NOT_FOUND"
    || code === "RESULT_ACCESS_DENIED"
    || code === "PRESSURE_GAME_VIEWER_NOT_FOUND"
    || code === "AUTHORITY_FENCE_MISMATCH"
    || code === "P2002"
    || code.includes("IDEMPOTENCY")
    || code.includes("FINGERPRINT_MISMATCH")
    || code.includes("ROUTE")
    || code.includes("CONTEXT_MISMATCH")
    || code.includes("SCOPE_MISMATCH")
    || code.startsWith("PRESSURE_INTERACTION_")
    || code.startsWith("PRESSURE_CHAT_")
    || code.startsWith("REPLAY_")
    || code.startsWith("SEAT_CONTROL_")
    || code.startsWith("CHAPTER_ORCHESTRATOR_")
    || code.startsWith("PRESSURE_DECISION_COMPILER_")
    || code === "INTEGRATION_DECISION_COMMAND_MISMATCH";
}

function isDependencyCode(code: string): boolean {
  return /^P\d{4}$/u.test(code)
    || /^(?:E(?:CONN|HOST|NET|PIPE|AI_|TIMEDOUT)|UND_ERR_)/u.test(code)
    || code.endsWith("_QUERY_FAILED")
    || code.endsWith("_DEPENDENCY_FAILURE")
    || code === "INVALID_PLAN"
    || code === "PERSISTED_COUNT_MISMATCH"
    || code === "QUERY_BUDGET_EXCEEDED";
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
