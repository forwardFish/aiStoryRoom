import { HttpException, HttpStatus } from "@nestjs/common";
import { withPressureDbRequestMetricsV1 } from "../observability/pressure-db-metrics";

export const PRESSURE_CHAPTER_HTTP_ERROR_CODES = Object.freeze({
  INPUT_INVALID: "PRESSURE_HTTP_INPUT_INVALID",
  ACCESS_DENIED: "PRESSURE_HTTP_ACCESS_DENIED",
  ROUTE_NOT_FOUND: "PRESSURE_HTTP_ROUTE_NOT_FOUND",
  ROUTE_MISMATCH: "PRESSURE_HTTP_ROUTE_MISMATCH",
  RESULT_NOT_READY: "PRESSURE_HTTP_RESULT_NOT_READY",
  COMMAND_REJECTED: "PRESSURE_HTTP_COMMAND_REJECTED",
  STALE_DECISION: "PRESSURE_HTTP_STALE_DECISION",
  IDEMPOTENCY_CONFLICT: "PRESSURE_HTTP_IDEMPOTENCY_CONFLICT",
  LEGACY_SLOT_ENDPOINT_REJECTED: "PRESSURE_HTTP_LEGACY_SLOT_ENDPOINT_REJECTED",
  DEPENDENCY_FAILURE: "PRESSURE_HTTP_DEPENDENCY_FAILURE",
} as const);

export type PressureChapterHttpErrorCodeV1 =
  (typeof PRESSURE_CHAPTER_HTTP_ERROR_CODES)[keyof typeof PRESSURE_CHAPTER_HTTP_ERROR_CODES];

export class PressureChapterHttpException extends HttpException {
  constructor(
    readonly code: PressureChapterHttpErrorCodeV1,
    status: number,
    readonly path: string,
  ) {
    super(
      {
        statusCode: status,
        code,
        message: publicMessage(code),
        path,
      },
      status,
    );
    this.name = "PressureChapterHttpException";
  }
}

export function failPressureChapterHttp(
  code: PressureChapterHttpErrorCodeV1,
  path: string,
  status = defaultStatus(code),
): never {
  throw new PressureChapterHttpException(code, status, path);
}

export async function pressureHttpBoundary<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return withPressureDbRequestMetricsV1(async () => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PressureChapterHttpException) throw error;
      const diagnostic = error && typeof error === "object"
        ? {
            name: "name" in error ? String(error.name) : "UNKNOWN",
            code: "code" in error ? String(error.code) : "UNKNOWN",
            path: "path" in error ? String(error.path) : "pressureChapter",
            message: "message" in error
              ? String(error.message).replace(/[\r\n]+/g, " ").slice(0, 1_000)
              : "UNKNOWN",
          }
        : { name: typeof error, code: "UNKNOWN", path: "pressureChapter", message: "UNKNOWN" };
      console.error("Pressure chapter dependency failure", diagnostic);
      if (error instanceof HttpException) {
        const status = error.getStatus();
        if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN) {
          throw new PressureChapterHttpException(
            PRESSURE_CHAPTER_HTTP_ERROR_CODES.ACCESS_DENIED,
            HttpStatus.FORBIDDEN,
            "pressureChapter",
          );
        }
        if (status === HttpStatus.NOT_FOUND) {
          throw new PressureChapterHttpException(
            PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_NOT_FOUND,
            HttpStatus.NOT_FOUND,
            "pressureChapter",
          );
        }
        if (status === HttpStatus.BAD_REQUEST) {
          throw new PressureChapterHttpException(
            PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID,
            HttpStatus.BAD_REQUEST,
            "pressureChapter",
          );
        }
        if (
          status === HttpStatus.CONFLICT ||
          status === HttpStatus.UNPROCESSABLE_ENTITY
        ) {
          throw new PressureChapterHttpException(
            PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED,
            status,
            "pressureChapter",
          );
        }
        throw new PressureChapterHttpException(
          PRESSURE_CHAPTER_HTTP_ERROR_CODES.DEPENDENCY_FAILURE,
          HttpStatus.INTERNAL_SERVER_ERROR,
          "pressureChapter",
        );
      }
      throw mapPressureDependencyError(error);
    }
  }, (metrics) => {
    if (process.env.PRESSURE_CHAPTER_DIAGNOSTIC_ERRORS !== "1") return;
    console.error("Pressure request DB metrics", metrics);
  });
}

function mapPressureDependencyError(error: unknown): PressureChapterHttpException {
  const code = readCode(error);
  const path = readPath(error);
  if (isRecoverableStaleDecision(error)) {
    return new PressureChapterHttpException(
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.STALE_DECISION,
      HttpStatus.CONFLICT,
      "pressureChapter",
    );
  }
  if (
    code === "RUN_ROUTE_NOT_FOUND" ||
    code === "PRESSURE_GAME_ROUTE_NOT_FOUND" ||
    code === "RESULT_NOT_FOUND"
  ) {
    return new PressureChapterHttpException(
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_NOT_FOUND,
      HttpStatus.NOT_FOUND,
      path,
    );
  }
  if (
    code === "RESULT_ACCESS_DENIED" ||
    code === "PRESSURE_GAME_VIEWER_NOT_FOUND" ||
    code === "PRESSURE_INTERACTION_SEAT_NOT_CONTROLLED" ||
    code === "SEAT_CONTROL_CONTROLLER_FORBIDDEN"
  ) {
    return new PressureChapterHttpException(
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.ACCESS_DENIED,
      HttpStatus.FORBIDDEN,
      path,
    );
  }
  if (code === "RESULT_NOT_READY") {
    return new PressureChapterHttpException(
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.RESULT_NOT_READY,
      HttpStatus.CONFLICT,
      path,
    );
  }
  if (code === "AUTHORITY_FENCE_MISMATCH") {
    return new PressureChapterHttpException(
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED,
      HttpStatus.CONFLICT,
      path,
    );
  }
  if (
    code === "INVALID_PLAN" ||
    code === "PERSISTED_COUNT_MISMATCH" ||
    code === "QUERY_BUDGET_EXCEEDED"
  ) {
    return new PressureChapterHttpException(
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.DEPENDENCY_FAILURE,
      HttpStatus.INTERNAL_SERVER_ERROR,
      path,
    );
  }
  if (
    code === "P2002" ||
    code.includes("IDEMPOTENCY") ||
    code.includes("FINGERPRINT_MISMATCH")
  ) {
    return new PressureChapterHttpException(
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      HttpStatus.CONFLICT,
      path,
    );
  }
  if (
    code.includes("ROUTE") ||
    code.includes("CONTEXT_MISMATCH") ||
    code.includes("SCOPE_MISMATCH")
  ) {
    return new PressureChapterHttpException(
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_MISMATCH,
      HttpStatus.CONFLICT,
      path,
    );
  }
  if (
    code.startsWith("PRESSURE_INTERACTION_") ||
    code.startsWith("PRESSURE_CHAT_") ||
    code.startsWith("REPLAY_") ||
    code.startsWith("SEAT_CONTROL_") ||
    code.startsWith("CHAPTER_ORCHESTRATOR_") ||
    code.startsWith("PRESSURE_DECISION_COMPILER_") ||
    code === "INTEGRATION_DECISION_COMMAND_MISMATCH"
  ) {
    return new PressureChapterHttpException(
      PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED,
      HttpStatus.UNPROCESSABLE_ENTITY,
      path,
    );
  }
  return new PressureChapterHttpException(
    PRESSURE_CHAPTER_HTTP_ERROR_CODES.DEPENDENCY_FAILURE,
    HttpStatus.INTERNAL_SERVER_ERROR,
    "pressureChapter",
  );
}

function readCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function readPath(error: unknown): string {
  if (error && typeof error === "object" && "path" in error) {
    const path = (error as { path?: unknown }).path;
    if (
      typeof path === "string" &&
      /^[A-Za-z][A-Za-z0-9_.\[\]-]{0,120}$/.test(path)
    ) {
      return path;
    }
  }
  return "pressureChapter";
}

function defaultStatus(code: PressureChapterHttpErrorCodeV1): number {
  switch (code) {
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID:
      return HttpStatus.BAD_REQUEST;
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.ACCESS_DENIED:
      return HttpStatus.FORBIDDEN;
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_NOT_FOUND:
      return HttpStatus.NOT_FOUND;
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED:
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.DEPENDENCY_FAILURE:
      return HttpStatus.INTERNAL_SERVER_ERROR;
    default:
      return HttpStatus.CONFLICT;
  }
}

function publicMessage(code: PressureChapterHttpErrorCodeV1): string {
  switch (code) {
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.INPUT_INVALID:
      return "The Pressure chapter request is invalid.";
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.ACCESS_DENIED:
      return "You do not have access to this run.";
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_NOT_FOUND:
      return "The Pressure chapter run was not found.";
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.RESULT_NOT_READY:
      return "The authoritative result is not ready.";
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.LEGACY_SLOT_ENDPOINT_REJECTED:
      return "This Pressure chapter run does not accept legacy slot commands.";
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.IDEMPOTENCY_CONFLICT:
      return "The idempotency key was reused with different input.";
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.ROUTE_MISMATCH:
      return "The stored run route does not match this operation.";
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.COMMAND_REJECTED:
      return "The Pressure chapter command was rejected.";
    case PRESSURE_CHAPTER_HTTP_ERROR_CODES.STALE_DECISION:
      return "This decision has changed. The latest state must be loaded.";
    default:
      return "The Pressure chapter request could not be completed.";
  }
}

const RECOVERABLE_STALE_DECISION_KEYS = new Set([
  "chapter.phase",
  "chapter.runtime",
  "decision.point",
  "decision.requirement",
  "decision.completion",
  "working.revision",
  "runtime.state",
]);

function isRecoverableStaleDecision(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("details" in error)) return false;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return false;
  const record = details as Record<string, unknown>;
  if (record.detail !== "STALE_OR_NOT_AUTHORIZED") return false;
  const mismatchKeys = record.mismatchKeys;
  return Array.isArray(mismatchKeys)
    && mismatchKeys.length > 0
    && mismatchKeys.every((key) => (
      typeof key === "string" && RECOVERABLE_STALE_DECISION_KEYS.has(key)
    ));
}
