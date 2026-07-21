-- Solo Story Engine seals one PlayerAction per independent ActorTurn.
-- Preserve existing slots while allowing Solo turn ids and clarification markers.
ALTER TABLE "PlayerAction" DROP CONSTRAINT IF EXISTS "PlayerAction_action_slot_check";
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_action_slot_check"
CHECK (
    "actionSlot" IS NULL
    OR "actionSlot" IN ('MAIN', 'MANEUVER', 'REACTION', 'SYSTEM_ACTION')
    OR "actionSlot" LIKE 'TURN:%'
    OR "actionSlot" LIKE 'SOLO:%'
    OR "actionSlot" LIKE 'SOLO_CLARIFICATION:%'
);

