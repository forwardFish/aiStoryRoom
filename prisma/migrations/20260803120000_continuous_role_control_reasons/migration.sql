-- Continuous actor threads and Solo actor turns both make a scheduled reclaim
-- effective only after the already-sealed AI action commits. Keep those
-- concrete runtime reasons inside the database authority allowlist.
ALTER TABLE "RoleControl" DROP CONSTRAINT IF EXISTS "RoleControl_reason_check";

ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_reason_check"
CHECK (
    "reason" IS NULL
    OR "reason" IN (
        'ROOM_STARTED', 'INITIAL_AI_AGENT', 'SYSTEM_ROLE', 'EXPLICIT_HANDOFF', 'EXPLICIT_EXIT',
        'DISCONNECT_DETECTED', 'DISCONNECT_TIMEOUT', 'HUMAN_RECLAIM',
        'PLAYER_RECLAIMED', 'PLAYER_RECLAIM_SCHEDULED',
        'RECLAIM_EFFECTIVE_NEXT_WINDOW', 'RECLAIM_EFFECTIVE_NEXT_ACTOR_TURN',
        'RECLAIM_EFFECTIVE_NEXT_SOLO_TURN', 'HEARTBEAT_RECOVERED',
        'PLAYER_LEFT_STAGE_AFTER_DONE', 'SYSTEM'
    )
);
