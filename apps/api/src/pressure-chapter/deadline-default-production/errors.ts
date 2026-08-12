export const DEADLINE_DEFAULT_PRODUCTION_ERROR_CODES_V1 = Object.freeze({
  AUTHORITY_INVALID: "PRESSURE_DEADLINE_DEFAULT_AUTHORITY_INVALID",
  CONTENT_INVALID: "PRESSURE_DEADLINE_DEFAULT_CONTENT_INVALID",
  DEADLINE_NOT_APPLICABLE: "PRESSURE_DEADLINE_DEFAULT_NOT_APPLICABLE",
  PROOF_PERSISTENCE_INVALID: "PRESSURE_DEADLINE_DEFAULT_PROOF_PERSISTENCE_INVALID",
  RUNTIME_RESULT_INVALID: "PRESSURE_DEADLINE_DEFAULT_RUNTIME_RESULT_INVALID",
} as const);

export type DeadlineDefaultProductionErrorCodeV1 =
  (typeof DEADLINE_DEFAULT_PRODUCTION_ERROR_CODES_V1)[keyof typeof DEADLINE_DEFAULT_PRODUCTION_ERROR_CODES_V1];

export class DeadlineDefaultProductionErrorV1 extends Error {
  constructor(
    public readonly code: DeadlineDefaultProductionErrorCodeV1,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "DeadlineDefaultProductionErrorV1";
  }
}

export function failDeadlineDefaultProductionV1(
  code: DeadlineDefaultProductionErrorCodeV1,
  path: string,
  detail: string,
): never {
  throw new DeadlineDefaultProductionErrorV1(
    code,
    `Pressure deadline/default production validation failed at ${path}`,
    { path, detail },
  );
}
