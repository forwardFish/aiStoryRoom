export const RUN_ROUTER_ERROR_CODES = {
  RUN_ROUTE_NOT_FOUND: "RUN_ROUTE_NOT_FOUND",
  RUN_CREATE_FINGERPRINT_MISMATCH: "RUN_CREATE_FINGERPRINT_MISMATCH",
  RUN_ROUTE_RECORD_INVALID: "RUN_ROUTE_RECORD_INVALID",
  RUN_ROUTE_RECORD_HASH_MISMATCH: "RUN_ROUTE_RECORD_HASH_MISMATCH",
  PARTICIPANT_MODE_INVALID: "PARTICIPANT_MODE_INVALID",
  HUMAN_SEAT_SELECTION_INVALID: "HUMAN_SEAT_SELECTION_INVALID",
  RUN_ROUTE_REPOSITORY_CONFLICT: "RUN_ROUTE_REPOSITORY_CONFLICT",
} as const;

export type RunRouterErrorCode =
  (typeof RUN_ROUTER_ERROR_CODES)[keyof typeof RUN_ROUTER_ERROR_CODES];

export class RunRouterError extends Error {
  constructor(
    readonly code: RunRouterErrorCode,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
    this.name = "RunRouterError";
  }
}

export function failRunRouter(
  code: RunRouterErrorCode,
  path: string,
  detail?: string,
): never {
  throw new RunRouterError(code, path, detail);
}
