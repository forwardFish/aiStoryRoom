import assert from "node:assert/strict";
import test from "node:test";
import {
  PRESSURE_GAME_READ_MODE_ERROR_CODES_V1,
  PressureGameReadModeErrorV1,
} from "../game-projection/game-read-mode-selector";
import {
  PRESSURE_GAME_READ_CONFIGURATION_SCHEMA_V1,
  PRESSURE_GAME_READ_MODE_ENV_V1,
  resolvePressureGameReadConfigurationV1,
} from "./game-read-mode";

test("missing and empty game-read configuration resolve to REPLAY", () => {
  assert.deepEqual(resolvePressureGameReadConfigurationV1({}), {
    schemaVersion: PRESSURE_GAME_READ_CONFIGURATION_SCHEMA_V1,
    mode: "REPLAY",
  });
  assert.deepEqual(resolvePressureGameReadConfigurationV1({
    [PRESSURE_GAME_READ_MODE_ENV_V1]: "",
  }), {
    schemaVersion: PRESSURE_GAME_READ_CONFIGURATION_SCHEMA_V1,
    mode: "REPLAY",
  });
});

for (const mode of ["REPLAY", "SHADOW", "FAST"] as const) {
  test(`exact game-read configuration accepts ${mode}`, () => {
    const configuration = resolvePressureGameReadConfigurationV1({
      [PRESSURE_GAME_READ_MODE_ENV_V1]: mode,
    });
    assert.equal(configuration.mode, mode);
    assert.equal(Object.isFrozen(configuration), true);
  });
}

for (const invalid of ["replay", "FAST ", " SHADOW", "UNKNOWN"] as const) {
  test(`invalid game-read configuration fails closed: ${JSON.stringify(invalid)}`, () => {
    assert.throws(
      () => resolvePressureGameReadConfigurationV1({
        [PRESSURE_GAME_READ_MODE_ENV_V1]: invalid,
      }),
      (error: unknown) => (
        error instanceof PressureGameReadModeErrorV1
        && error.code === PRESSURE_GAME_READ_MODE_ERROR_CODES_V1.MODE_INVALID
      ),
    );
  });
}
