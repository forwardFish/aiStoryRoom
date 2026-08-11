-- Keep the durable RoleControl audit vocabulary aligned with every reason
-- emitted by the current multiplayer, Solo and B0 runtimes. The prior
-- presence-session migration predates B0 and later credit/reclaim paths, so a
-- fresh PostgreSQL migration rejected legitimate runtime rows with SQLSTATE
-- 23514 before the first synchronized window could open.
ALTER TABLE "RoleControl" DROP CONSTRAINT IF EXISTS "RoleControl_reason_check";

ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_reason_check"
CHECK (
    "reason" IS NULL
    OR "reason" IN (
        'B0_INITIAL_ROLE_BINDING',
        'CREDITS_INSUFFICIENT',
        'DISCONNECT_DETECTED',
        'DISCONNECT_TIMEOUT',
        'EXPLICIT_EXIT',
        'EXPLICIT_HANDOFF',
        'HEARTBEAT_RECOVERED',
        'HUMAN_RECLAIM',
        'INITIAL_AI_AGENT',
        'INSUFFICIENT_WORLD_CREDITS',
        'PLAYER_LEFT_STAGE_AFTER_DONE',
        'PLAYER_RECLAIMED',
        'PLAYER_RECLAIM_SCHEDULED',
        'RECLAIM_EFFECTIVE_NEXT_ACTOR_TURN',
        'RECLAIM_EFFECTIVE_NEXT_WINDOW',
        'ROOM_STARTED',
        'SYSTEM',
        'SYSTEM_ROLE'
    )
);
