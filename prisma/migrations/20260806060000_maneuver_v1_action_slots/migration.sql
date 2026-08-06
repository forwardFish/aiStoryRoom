-- Maneuver V1 gives each role two independently idempotent opportunities in
-- the same scene. Keep the existing action-slot vocabulary while admitting
-- the two bounded slots used by the authoritative Preview/Commit engine.
ALTER TABLE "PlayerAction" DROP CONSTRAINT IF EXISTS "PlayerAction_action_slot_check";
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_action_slot_check"
CHECK (
    "actionSlot" IS NULL
    OR "actionSlot" IN (
        'MAIN',
        'MANEUVER',
        'MANEUVER_1',
        'MANEUVER_2',
        'REACTION',
        'SYSTEM_ACTION'
    )
    OR "actionSlot" LIKE 'TURN:%'
    OR "actionSlot" LIKE 'SOLO:%'
    OR "actionSlot" LIKE 'SOLO_CLARIFICATION:%'
);
