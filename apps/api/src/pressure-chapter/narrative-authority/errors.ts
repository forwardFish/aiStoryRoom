export const PRESSURE_NARRATIVE_AUTHORITY_ERROR_CODES_V1 = Object.freeze({
  RELEASE_BINDING_INVALID: "PRESSURE_NARRATIVE_AUTHORITY_RELEASE_BINDING_INVALID",
  SOURCE_INVALID: "PRESSURE_NARRATIVE_AUTHORITY_SOURCE_INVALID",
  SOURCE_BINDING_MISMATCH: "PRESSURE_NARRATIVE_AUTHORITY_SOURCE_BINDING_MISMATCH",
  PRESENTATION_BINDING_MISSING: "PRESSURE_NARRATIVE_AUTHORITY_PRESENTATION_BINDING_MISSING",
  AUDIENCE_ALLOWLIST_MISMATCH: "PRESSURE_NARRATIVE_AUTHORITY_AUDIENCE_ALLOWLIST_MISMATCH",
  UNSUPPORTED_AUTHORITY: "PRESSURE_NARRATIVE_AUTHORITY_UNSUPPORTED",
  BEAT_CONTEXT_MISSING: "PRESSURE_NARRATIVE_AUTHORITY_BEAT_CONTEXT_MISSING",
} as const);

export type PressureNarrativeAuthorityErrorCodeV1 =
  (typeof PRESSURE_NARRATIVE_AUTHORITY_ERROR_CODES_V1)[keyof typeof PRESSURE_NARRATIVE_AUTHORITY_ERROR_CODES_V1];

export class PressureNarrativeAuthorityErrorV1 extends Error {
  readonly name = "PressureNarrativeAuthorityErrorV1";

  constructor(
    readonly code: PressureNarrativeAuthorityErrorCodeV1,
    readonly path: string,
    readonly detail?: string,
  ) {
    super(`${code}:${path}${detail ? `:${detail}` : ""}`);
  }
}

export function failPressureNarrativeAuthorityV1(
  code: PressureNarrativeAuthorityErrorCodeV1,
  path: string,
  detail?: string,
): never {
  throw new PressureNarrativeAuthorityErrorV1(code, path, detail);
}
