-- AlterTable
ALTER TABLE "AiTask" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "eventId" TEXT,
ADD COLUMN     "modelName" TEXT,
ADD COLUMN     "normalizedJson" JSONB,
ADD COLUMN     "outputJson" JSONB,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "rawResponse" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "tokenUsageJson" JSONB;

-- CreateIndex
CREATE INDEX "AiTask_eventId_idx" ON "AiTask"("eventId");
