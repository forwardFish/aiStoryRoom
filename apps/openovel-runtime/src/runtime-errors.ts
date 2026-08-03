export class RuntimeActionError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 409,
  ) {
    super(code);
    this.name = "RuntimeActionError";
  }
}

export function actionRejected(code: string) {
  return new RuntimeActionError(code, 400);
}

export function actionConflict(code: string) {
  return new RuntimeActionError(code, 409);
}

export function isRuntimeActionError(error: unknown): error is RuntimeActionError {
  return error instanceof RuntimeActionError;
}
