-- Foundation repair: bring a fresh `prisma migrate deploy` database up to the
-- current checked-in Prisma schema before continuous-strategy expand work.
-- These six models already exist in prisma/schema.prisma but were never
-- represented by an immutable migration.

-- CreateTable
CREATE TABLE "CanonFact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceNodeId" TEXT,
    "factKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "sourceEventIdsJson" JSONB NOT NULL,
    "sourceActionIdsJson" JSONB NOT NULL,
    "knownByRoleIdsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterMind" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "confirmedFactKeysJson" JSONB NOT NULL,
    "believedFactKeysJson" JSONB NOT NULL,
    "activeGoalsJson" JSONB NOT NULL,
    "knowledgeBoundaryJson" JSONB NOT NULL,
    "lastNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterMind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryThread" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "tension" INTEGER NOT NULL DEFAULT 1,
    "deadlineNodeIndex" INTEGER,
    "sourceFactKeysJson" JSONB NOT NULL,
    "stateJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT,
    "roleId" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'public',
    "stateJson" JSONB NOT NULL,
    "knownFactKeysJson" JSONB NOT NULL,
    "activeThreadKeysJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SceneSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeEntry" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT,
    "resolutionId" TEXT,
    "roleId" TEXT,
    "entryType" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "content" TEXT NOT NULL,
    "factKeysJson" JSONB NOT NULL,
    "threadKeysJson" JSONB NOT NULL,
    "sourceEventIdsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NarrativeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryTaskOutbox" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultJson" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryTaskOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanonFact_runId_factKey_key" ON "CanonFact"("runId", "factKey");

-- CreateIndex
CREATE INDEX "CanonFact_runId_visibility_status_idx" ON "CanonFact"("runId", "visibility", "status");

-- CreateIndex
CREATE INDEX "CanonFact_sourceNodeId_idx" ON "CanonFact"("sourceNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterMind_roleId_key" ON "CharacterMind"("roleId");

-- CreateIndex
CREATE INDEX "CharacterMind_runId_updatedAt_idx" ON "CharacterMind"("runId", "updatedAt");

-- CreateIndex
CREATE INDEX "CharacterMind_roleId_idx" ON "CharacterMind"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryThread_runId_threadKey_key" ON "StoryThread"("runId", "threadKey");

-- CreateIndex
CREATE INDEX "StoryThread_runId_status_idx" ON "StoryThread"("runId", "status");

-- CreateIndex
CREATE INDEX "SceneSnapshot_runId_scope_createdAt_idx" ON "SceneSnapshot"("runId", "scope", "createdAt");

-- CreateIndex
CREATE INDEX "SceneSnapshot_nodeId_idx" ON "SceneSnapshot"("nodeId");

-- CreateIndex
CREATE INDEX "SceneSnapshot_roleId_idx" ON "SceneSnapshot"("roleId");

-- CreateIndex
CREATE INDEX "NarrativeEntry_runId_visibility_createdAt_idx" ON "NarrativeEntry"("runId", "visibility", "createdAt");

-- CreateIndex
CREATE INDEX "NarrativeEntry_nodeId_idx" ON "NarrativeEntry"("nodeId");

-- CreateIndex
CREATE INDEX "NarrativeEntry_roleId_idx" ON "NarrativeEntry"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryTaskOutbox_nodeId_key" ON "StoryTaskOutbox"("nodeId");

-- CreateIndex
CREATE INDEX "StoryTaskOutbox_status_nextRetryAt_idx" ON "StoryTaskOutbox"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "StoryTaskOutbox_runId_createdAt_idx" ON "StoryTaskOutbox"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "StoryTaskOutbox_leaseExpiresAt_idx" ON "StoryTaskOutbox"("leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonFact" ADD CONSTRAINT "CanonFact_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterMind" ADD CONSTRAINT "CharacterMind_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterMind" ADD CONSTRAINT "CharacterMind_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryThread" ADD CONSTRAINT "StoryThread_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneSnapshot" ADD CONSTRAINT "SceneSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneSnapshot" ADD CONSTRAINT "SceneSnapshot_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneSnapshot" ADD CONSTRAINT "SceneSnapshot_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeEntry" ADD CONSTRAINT "NarrativeEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeEntry" ADD CONSTRAINT "NarrativeEntry_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeEntry" ADD CONSTRAINT "NarrativeEntry_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "DirectorResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeEntry" ADD CONSTRAINT "NarrativeEntry_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "StoryRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StoryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SceneNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
