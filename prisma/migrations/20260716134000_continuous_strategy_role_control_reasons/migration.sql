-- Keep the database authority contract aligned with every control transition
-- emitted by the continuous multiplayer engine.  The earlier allowlist only
-- covered design-time reason names and rejected the concrete startup/reclaim
-- values used by the implementation.
ALTER TABLE "RoleControl" DROP CONSTRAINT IF EXISTS "RoleControl_reason_check";

ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_reason_check"
CHECK (
    "reason" IS NULL
    OR "reason" IN (
        'ROOM_STARTED',
        'INITIAL_AI_AGENT',
        'SYSTEM_ROLE',
        'EXPLICIT_HANDOFF',
        'EXPLICIT_EXIT',
        'DISCONNECT_TIMEOUT',
        'HUMAN_RECLAIM',
        'PLAYER_RECLAIMED',
        'PLAYER_RECLAIM_SCHEDULED',
        'RECLAIM_EFFECTIVE_NEXT_WINDOW',
        'HEARTBEAT_RECOVERED',
        'PLAYER_LEFT_STAGE_AFTER_DONE',
        'SYSTEM'
    )
);
