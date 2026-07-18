-- One scene node owns multiple independent task identities: three Role Agent
-- slots plus one resolution workflow. The dedupe key, not nodeId, is the
-- authoritative idempotency boundary.
DROP INDEX IF EXISTS "StoryTaskOutbox_nodeId_key";
CREATE INDEX IF NOT EXISTS "StoryTaskOutbox_nodeId_idx" ON "StoryTaskOutbox"("nodeId");

UPDATE "StoryTaskOutbox"
SET "dedupeKey" = COALESCE("dedupeKey", 'RESOLVE_LEGACY:' || "nodeId");

ALTER TABLE "StoryTaskOutbox"
  ALTER COLUMN "dedupeKey" SET NOT NULL;
