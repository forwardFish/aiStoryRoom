import {
  parsePressureGameReadModeV1,
  type PressureGameReadModeV1,
} from "../game-projection/game-read-mode-selector";

export const PRESSURE_GAME_READ_MODE_ENV_V1 =
  "PRESSURE_GAME_READ_MODE" as const;

export const PRESSURE_GAME_READ_CONFIGURATION_SCHEMA_V1 =
  "pressure_game_read_configuration_v1" as const;

export interface PressureGameReadConfigurationV1 {
  schemaVersion: typeof PRESSURE_GAME_READ_CONFIGURATION_SCHEMA_V1;
  mode: PressureGameReadModeV1;
}

/**
 * Sole production configuration authority for GET /game read selection.
 * Missing/empty input preserves REPLAY; every other non-exact value fails
 * during composition via M4A's frozen parser.
 */
export function resolvePressureGameReadConfigurationV1(
  environment: Readonly<Record<string, string | undefined>>,
): PressureGameReadConfigurationV1 {
  return Object.freeze({
    schemaVersion: PRESSURE_GAME_READ_CONFIGURATION_SCHEMA_V1,
    mode: parsePressureGameReadModeV1(
      environment[PRESSURE_GAME_READ_MODE_ENV_V1],
    ),
  });
}
