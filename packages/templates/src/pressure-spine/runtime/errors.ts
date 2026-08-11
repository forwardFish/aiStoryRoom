import type { PressureKernelErrorCode } from "./types";

export class PressureKernelError extends Error {
  readonly name = "PressureKernelError";

  constructor(
    readonly code: PressureKernelErrorCode,
    message: string,
    readonly safeMessage = "The requested action cannot be applied to the current state.",
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function isPressureKernelError(value: unknown): value is PressureKernelError {
  return value instanceof PressureKernelError;
}
