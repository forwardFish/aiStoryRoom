-- Durable per-browser heartbeat cursor.  Presence cannot be kept in process
-- memory because API restarts and horizontally scaled instances must agree on
-- replay ordering and disconnect takeover.
CREATE TABLE "PresenceSession" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "sessionInstanceId" TEXT NOT NULL,
    "lastHeartbeatSequence" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedDeliverySequence" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenceSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PresenceSession_heartbeat_sequence_check" CHECK ("lastHeartbeatSequence" >= 0),
    CONSTRAINT "PresenceSession_delivery_sequence_check" CHECK ("lastAppliedDeliverySequence" >= 0),
    CONSTRAINT "PresenceSession_expiry_check" CHECK ("expiresAt" >= "lastHeartbeatAt")
);

CREATE UNIQUE INDEX "PresenceSession_runId_userId_sessionInstanceId_key"
    ON "PresenceSession"("runId", "userId", "sessionInstanceId");
CREATE INDEX "PresenceSession_runId_lastHeartbeatAt_idx"
    ON "PresenceSession"("runId", "lastHeartbeatAt");
CREATE INDEX "PresenceSession_playerId_expiresAt_idx"
    ON "PresenceSession"("playerId", "expiresAt");
CREATE INDEX "PresenceSession_roleId_lastHeartbeatAt_idx"
    ON "PresenceSession"("roleId", "lastHeartbeatAt");

ALTER TABLE "PresenceSession" ADD CONSTRAINT "PresenceSession_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresenceSession" ADD CONSTRAINT "PresenceSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresenceSession" ADD CONSTRAINT "PresenceSession_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "StoryPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PresenceSession" ADD CONSTRAINT "PresenceSession_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoleControl" DROP CONSTRAINT IF EXISTS "RoleControl_reason_check";
ALTER TABLE "RoleControl" ADD CONSTRAINT "RoleControl_reason_check"
CHECK (
    "reason" IS NULL
    OR "reason" IN (
        'ROOM_STARTED', 'INITIAL_AI_AGENT', 'SYSTEM_ROLE', 'EXPLICIT_HANDOFF', 'EXPLICIT_EXIT',
        'DISCONNECT_DETECTED', 'DISCONNECT_TIMEOUT', 'HUMAN_RECLAIM',
        'PLAYER_RECLAIMED', 'PLAYER_RECLAIM_SCHEDULED',
        'RECLAIM_EFFECTIVE_NEXT_WINDOW', 'HEARTBEAT_RECOVERED',
        'PLAYER_LEFT_STAGE_AFTER_DONE', 'SYSTEM'
    )
);
