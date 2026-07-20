-- V2 seals one PlayerAction per ActorTurn. The turn id in the slot preserves
-- the existing unique(node, role, slot) invariant without collapsing seven
-- independent decisions into the old single MAIN slot.
ALTER TABLE "PlayerAction" DROP CONSTRAINT IF EXISTS "PlayerAction_action_slot_check";
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_action_slot_check"
CHECK (
    "actionSlot" IS NULL
    OR "actionSlot" IN ('MAIN', 'MANEUVER', 'REACTION', 'SYSTEM_ACTION')
    OR "actionSlot" LIKE 'TURN:%'
);
