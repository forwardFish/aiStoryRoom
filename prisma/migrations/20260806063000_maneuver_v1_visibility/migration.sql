-- Maneuver V1 distinguishes a private action from an action addressed to a
-- specific role. Preserve every existing PlayerAction visibility while
-- admitting that world-independent TARGETED audience contract.
ALTER TABLE "PlayerAction" DROP CONSTRAINT IF EXISTS "PlayerAction_visibility_check";
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_visibility_check"
CHECK (
    "visibility" IS NULL
    OR "visibility" IN ('PUBLIC', 'OBSERVABLE', 'LIMITED', 'PRIVATE', 'TARGETED')
);
