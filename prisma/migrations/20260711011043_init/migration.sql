-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "openid" TEXT NOT NULL,
    "unionid" TEXT,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "policyAgreedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "worldBase" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "configJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryRun" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'invite',
    "templateKey" TEXT NOT NULL DEFAULT 'sangtian',
    "userId" TEXT,
    "selectedRoleKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting_players',
    "currentDay" INTEGER NOT NULL DEFAULT 1,
    "totalDays" INTEGER NOT NULL DEFAULT 7,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currentChapter" INTEGER NOT NULL DEFAULT 1,
    "currentNodeId" TEXT,
    "maxPlayers" INTEGER NOT NULL DEFAULT 5,
    "activeHumanCount" INTEGER NOT NULL DEFAULT 1,
    "aiPlayerCount" INTEGER NOT NULL DEFAULT 0,
    "dangerLevel" INTEGER NOT NULL DEFAULT 1,
    "maxDangerLevel" INTEGER NOT NULL DEFAULT 5,
    "chapterCount" INTEGER NOT NULL DEFAULT 0,
    "completedNodeCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "stateJson" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'link',
    "inviteCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'system',
    "roleKey" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'player_visible',
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryPlayer" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT,
    "roleId" TEXT,
    "playerType" TEXT NOT NULL DEFAULT 'human',
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "StoryPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryRole" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "publicInfo" TEXT NOT NULL,
    "hiddenSecret" TEXT,
    "personalGoal" TEXT NOT NULL,
    "currentState" TEXT NOT NULL,
    "abilityText" TEXT,
    "arcText" TEXT,
    "knownInfoJson" JSONB NOT NULL,
    "cannotDoJson" JSONB NOT NULL,
    "isAiControlled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleRelation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fromRoleId" TEXT NOT NULL,
    "toRoleId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "publicNote" TEXT,
    "hiddenNote" TEXT,
    "updatedByNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapterSandbox" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "mainLocation" TEXT NOT NULL,
    "chapterGoal" TEXT NOT NULL,
    "currentQuestion" TEXT NOT NULL,
    "sandboxJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChapterSandbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneNode" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "nodeIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "publicNarration" TEXT NOT NULL,
    "nodeGoal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open_for_actions',
    "actionOptionsJson" JSONB NOT NULL,
    "resolutionId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SceneNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAction" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "userId" TEXT,
    "roleId" TEXT NOT NULL,
    "playerType" TEXT NOT NULL DEFAULT 'human',
    "actionType" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetText" TEXT,
    "method" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL DEFAULT 'normal',
    "freeText" TEXT,
    "normalizedJson" JSONB,
    "guardStatus" TEXT NOT NULL DEFAULT 'pending',
    "guardReason" TEXT,
    "auditStatus" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectorResolution" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "publicNarration" TEXT NOT NULL,
    "privateResultsJson" JSONB NOT NULL,
    "actionResultsJson" JSONB NOT NULL,
    "statePatchJson" JSONB NOT NULL,
    "clueChangesJson" JSONB NOT NULL,
    "relationChangesJson" JSONB NOT NULL,
    "dangerBefore" INTEGER NOT NULL,
    "dangerAfter" INTEGER NOT NULL,
    "nextNodeHook" TEXT,
    "nextOptionsJson" JSONB,
    "auditStatus" TEXT NOT NULL DEFAULT 'ok',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectorResolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeSegment" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "resolutionId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contributorJson" JSONB NOT NULL,
    "auditStatus" TEXT NOT NULL DEFAULT 'ok',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NarrativeSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clue" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "clueKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "ownerRoleId" TEXT,
    "discoveredNodeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldStateSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT,
    "chapterIndex" INTEGER NOT NULL,
    "stateJson" JSONB NOT NULL,
    "factsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorldStateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "highlightsJson" JSONB NOT NULL,
    "keyChoicesJson" JSONB NOT NULL,
    "contributorJson" JSONB NOT NULL,
    "nextHook" TEXT,
    "auditStatus" TEXT NOT NULL DEFAULT 'ok',
    "status" TEXT NOT NULL DEFAULT 'generated',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "nodeId" TEXT,
    "chapterId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTask" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "nodeId" TEXT,
    "actionId" TEXT,
    "chapterId" TEXT,
    "taskType" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "promptVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputJson" JSONB,
    "resultJson" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cost" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "content" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "riskType" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "runId" TEXT,
    "nodeId" TEXT,
    "actionId" TEXT,
    "eventName" TEXT NOT NULL,
    "source" TEXT,
    "shareToken" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chapterId" TEXT,
    "shareUserId" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_openid_key" ON "User"("openid");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "WorldTemplate_status_idx" ON "WorldTemplate"("status");

-- CreateIndex
CREATE INDEX "WorldTemplate_genre_idx" ON "WorldTemplate"("genre");

-- CreateIndex
CREATE UNIQUE INDEX "StoryRun_inviteCode_key" ON "StoryRun"("inviteCode");

-- CreateIndex
CREATE INDEX "StoryRun_templateId_idx" ON "StoryRun"("templateId");

-- CreateIndex
CREATE INDEX "StoryRun_ownerUserId_idx" ON "StoryRun"("ownerUserId");

-- CreateIndex
CREATE INDEX "StoryRun_status_updatedAt_idx" ON "StoryRun"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "StoryRun_visibility_status_idx" ON "StoryRun"("visibility", "status");

-- CreateIndex
CREATE INDEX "StoryRun_templateKey_status_idx" ON "StoryRun"("templateKey", "status");

-- CreateIndex
CREATE INDEX "StoryEvent_runId_day_createdAt_idx" ON "StoryEvent"("runId", "day", "createdAt");

-- CreateIndex
CREATE INDEX "StoryEvent_runId_type_idx" ON "StoryEvent"("runId", "type");

-- CreateIndex
CREATE INDEX "StoryPlayer_runId_status_idx" ON "StoryPlayer"("runId", "status");

-- CreateIndex
CREATE INDEX "StoryPlayer_userId_idx" ON "StoryPlayer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryPlayer_runId_userId_key" ON "StoryPlayer"("runId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryPlayer_runId_roleId_key" ON "StoryPlayer"("runId", "roleId");

-- CreateIndex
CREATE INDEX "StoryRole_runId_status_idx" ON "StoryRole"("runId", "status");

-- CreateIndex
CREATE INDEX "StoryRole_isAiControlled_idx" ON "StoryRole"("isAiControlled");

-- CreateIndex
CREATE UNIQUE INDEX "StoryRole_runId_roleKey_key" ON "StoryRole"("runId", "roleKey");

-- CreateIndex
CREATE INDEX "RoleRelation_runId_idx" ON "RoleRelation"("runId");

-- CreateIndex
CREATE INDEX "RoleRelation_fromRoleId_idx" ON "RoleRelation"("fromRoleId");

-- CreateIndex
CREATE INDEX "RoleRelation_toRoleId_idx" ON "RoleRelation"("toRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleRelation_runId_fromRoleId_toRoleId_relationType_key" ON "RoleRelation"("runId", "fromRoleId", "toRoleId", "relationType");

-- CreateIndex
CREATE INDEX "ChapterSandbox_runId_status_idx" ON "ChapterSandbox"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChapterSandbox_runId_chapterIndex_key" ON "ChapterSandbox"("runId", "chapterIndex");

-- CreateIndex
CREATE INDEX "SceneNode_runId_status_idx" ON "SceneNode"("runId", "status");

-- CreateIndex
CREATE INDEX "SceneNode_chapterIndex_idx" ON "SceneNode"("chapterIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SceneNode_runId_chapterIndex_nodeIndex_key" ON "SceneNode"("runId", "chapterIndex", "nodeIndex");

-- CreateIndex
CREATE INDEX "PlayerAction_runId_nodeId_idx" ON "PlayerAction"("runId", "nodeId");

-- CreateIndex
CREATE INDEX "PlayerAction_userId_idx" ON "PlayerAction"("userId");

-- CreateIndex
CREATE INDEX "PlayerAction_status_auditStatus_guardStatus_idx" ON "PlayerAction"("status", "auditStatus", "guardStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAction_nodeId_roleId_key" ON "PlayerAction"("nodeId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "DirectorResolution_nodeId_key" ON "DirectorResolution"("nodeId");

-- CreateIndex
CREATE INDEX "DirectorResolution_runId_chapterIndex_idx" ON "DirectorResolution"("runId", "chapterIndex");

-- CreateIndex
CREATE INDEX "DirectorResolution_auditStatus_idx" ON "DirectorResolution"("auditStatus");

-- CreateIndex
CREATE INDEX "NarrativeSegment_runId_chapterIndex_idx" ON "NarrativeSegment"("runId", "chapterIndex");

-- CreateIndex
CREATE INDEX "NarrativeSegment_nodeId_idx" ON "NarrativeSegment"("nodeId");

-- CreateIndex
CREATE INDEX "NarrativeSegment_auditStatus_idx" ON "NarrativeSegment"("auditStatus");

-- CreateIndex
CREATE INDEX "Clue_runId_visibility_status_idx" ON "Clue"("runId", "visibility", "status");

-- CreateIndex
CREATE INDEX "Clue_ownerRoleId_idx" ON "Clue"("ownerRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "Clue_runId_clueKey_key" ON "Clue"("runId", "clueKey");

-- CreateIndex
CREATE INDEX "WorldStateSnapshot_runId_createdAt_idx" ON "WorldStateSnapshot"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "WorldStateSnapshot_nodeId_idx" ON "WorldStateSnapshot"("nodeId");

-- CreateIndex
CREATE INDEX "Chapter_runId_status_idx" ON "Chapter"("runId", "status");

-- CreateIndex
CREATE INDEX "Chapter_auditStatus_idx" ON "Chapter"("auditStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_runId_chapterIndex_key" ON "Chapter"("runId", "chapterIndex");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_runId_idx" ON "Notification"("runId");

-- CreateIndex
CREATE INDEX "AiTask_taskType_status_idx" ON "AiTask"("taskType", "status");

-- CreateIndex
CREATE INDEX "AiTask_runId_idx" ON "AiTask"("runId");

-- CreateIndex
CREATE INDEX "AiTask_nodeId_idx" ON "AiTask"("nodeId");

-- CreateIndex
CREATE INDEX "AiTask_chapterId_idx" ON "AiTask"("chapterId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_result_createdAt_idx" ON "AuditLog"("result", "createdAt");

-- CreateIndex
CREATE INDEX "EventLog_eventName_createdAt_idx" ON "EventLog"("eventName", "createdAt");

-- CreateIndex
CREATE INDEX "EventLog_userId_idx" ON "EventLog"("userId");

-- CreateIndex
CREATE INDEX "EventLog_runId_idx" ON "EventLog"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareToken_token_key" ON "ShareToken"("token");

-- CreateIndex
CREATE INDEX "ShareToken_runId_idx" ON "ShareToken"("runId");

-- CreateIndex
CREATE INDEX "ShareToken_chapterId_idx" ON "ShareToken"("chapterId");

-- CreateIndex
CREATE INDEX "ShareToken_shareUserId_idx" ON "ShareToken"("shareUserId");

-- AddForeignKey
ALTER TABLE "StoryRun" ADD CONSTRAINT "StoryRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorldTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryRun" ADD CONSTRAINT "StoryRun_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryEvent" ADD CONSTRAINT "StoryEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryPlayer" ADD CONSTRAINT "StoryPlayer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryPlayer" ADD CONSTRAINT "StoryPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryPlayer" ADD CONSTRAINT "StoryPlayer_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryRole" ADD CONSTRAINT "StoryRole_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleRelation" ADD CONSTRAINT "RoleRelation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleRelation" ADD CONSTRAINT "RoleRelation_fromRoleId_fkey" FOREIGN KEY ("fromRoleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleRelation" ADD CONSTRAINT "RoleRelation_toRoleId_fkey" FOREIGN KEY ("toRoleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapterSandbox" ADD CONSTRAINT "ChapterSandbox_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneNode" ADD CONSTRAINT "SceneNode_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAction" ADD CONSTRAINT "PlayerAction_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectorResolution" ADD CONSTRAINT "DirectorResolution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectorResolution" ADD CONSTRAINT "DirectorResolution_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeSegment" ADD CONSTRAINT "NarrativeSegment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeSegment" ADD CONSTRAINT "NarrativeSegment_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeSegment" ADD CONSTRAINT "NarrativeSegment_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "DirectorResolution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clue" ADD CONSTRAINT "Clue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clue" ADD CONSTRAINT "Clue_ownerRoleId_fkey" FOREIGN KEY ("ownerRoleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldStateSnapshot" ADD CONSTRAINT "WorldStateSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldStateSnapshot" ADD CONSTRAINT "WorldStateSnapshot_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "PlayerAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiTask" ADD CONSTRAINT "AiTask_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "PlayerAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareToken" ADD CONSTRAINT "ShareToken_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareToken" ADD CONSTRAINT "ShareToken_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareToken" ADD CONSTRAINT "ShareToken_shareUserId_fkey" FOREIGN KEY ("shareUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
