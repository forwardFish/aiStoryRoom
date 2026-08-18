export const PRESSURE_POST_COMMIT_PROJECTION_MODE_ENV_V1 =
  "PRESSURE_POST_COMMIT_PROJECTION_MODE" as const;

export const PRESSURE_POST_COMMIT_PROJECTION_MODES_V1 = Object.freeze([
  "REPLAY",
  "SHADOW",
  "FAST",
] as const);

export type PressurePostCommitProjectionModeV1 =
  (typeof PRESSURE_POST_COMMIT_PROJECTION_MODES_V1)[number];

export function resolvePressurePostCommitProjectionModeV1(
  environment: Readonly<Record<string, string | undefined>>,
): PressurePostCommitProjectionModeV1 {
  const value = environment[PRESSURE_POST_COMMIT_PROJECTION_MODE_ENV_V1];
  if (value === undefined || value === "") return "REPLAY";
  if (value === "REPLAY" || value === "SHADOW" || value === "FAST") return value;
  throw new Error("PRESSURE_POST_COMMIT_PROJECTION_MODE_INVALID");
}
