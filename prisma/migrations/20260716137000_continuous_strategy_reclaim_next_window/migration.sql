-- A reclaim can be scheduled for the next action window after an AI action has
-- already sealed the current slot.  Preserve that boundary in the transition
-- ledger instead of overloading a concrete action slot.
ALTER TABLE "RoleControlTransition"
    DROP CONSTRAINT IF EXISTS "RoleControlTransition_effective_slot_check";

ALTER TABLE "RoleControlTransition"
    ADD CONSTRAINT "RoleControlTransition_effective_slot_check"
    CHECK (
        "effectiveSlot" IS NULL
        OR "effectiveSlot" IN ('MAIN', 'MANEUVER', 'REACTION', 'NEXT_WINDOW')
    );
