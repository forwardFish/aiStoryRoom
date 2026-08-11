export class PressureSpineValidationError extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(`${code}:${path}:${message}`);
    this.name = "PressureSpineValidationError";
  }
}
