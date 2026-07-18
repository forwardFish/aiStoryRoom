-- World-driven actions and world-owned assets are not player-role records.
-- A NULL role/owner is reserved for the configured worldActor; normal human
-- and AI Agent actions continue to reference a StoryRole.
ALTER TABLE "PlayerAction" ALTER COLUMN "roleId" DROP NOT NULL;
ALTER TABLE "RoleAsset" ALTER COLUMN "ownerRoleId" DROP NOT NULL;
ALTER TABLE "RoleAsset" ADD COLUMN "ownerActorKey" TEXT;
CREATE INDEX "RoleAsset_ownerActorKey_status_idx" ON "RoleAsset"("ownerActorKey", "status");
