-- Continuous ActorTurn and Solo control transitions use durable turn-scoped
-- slot identities in addition to the original ActionWindow slot vocabulary.
ALTER TABLE "RoleControlTransition" DROP CONSTRAINT IF EXISTS "RoleControlTransition_effective_slot_check";
ALTER TABLE "RoleControlTransition" ADD CONSTRAINT "RoleControlTransition_effective_slot_check"
CHECK (
    "effectiveSlot" IS NULL
    OR "effectiveSlot" IN (
        'MAIN',
        'MANEUVER',
        'REACTION',
        'NEXT_WINDOW',
        'NEXT_ACTOR_TURN',
        'STORY_COMPLETED'
    )
    OR "effectiveSlot" ~ '^TURN:[A-Za-z0-9_-]+$'
    OR "effectiveSlot" ~ '^SOLO:[A-Za-z0-9_-]+$'
);
