export const DECISION_AUTOMATION_ERROR_CODES = Object.freeze({
  INVALID_CONFIGURATION: "PRESSURE_DECISION_AUTOMATION_INVALID_CONFIGURATION",
  CLAIM_INVALID: "PRESSURE_DECISION_AUTOMATION_CLAIM_INVALID",
  ROUTE_MISMATCH: "PRESSURE_DECISION_AUTOMATION_ROUTE_MISMATCH",
  AUTHORITY_MISMATCH: "PRESSURE_DECISION_AUTOMATION_AUTHORITY_MISMATCH",
  CONTENT_MISMATCH: "PRESSURE_DECISION_AUTOMATION_CONTENT_MISMATCH",
  POLICY_INVALID: "PRESSURE_DECISION_AUTOMATION_POLICY_INVALID",
  COMPILER_INVALID: "PRESSURE_DECISION_AUTOMATION_COMPILER_INVALID",
  PORT_RESULT_INVALID: "PRESSURE_DECISION_AUTOMATION_PORT_RESULT_INVALID",
  LEASE_LOST: "PRESSURE_DECISION_AUTOMATION_LEASE_LOST",
} as const);

export type DecisionAutomationErrorCode =
  (typeof DECISION_AUTOMATION_ERROR_CODES)[keyof typeof DECISION_AUTOMATION_ERROR_CODES];

export class DecisionAutomationError extends Error {
  constructor(
    public readonly code: DecisionAutomationErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "DecisionAutomationError";
  }
}

export function failDecisionAutomation(
  code: DecisionAutomationErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new DecisionAutomationError(code, message, details);
}
