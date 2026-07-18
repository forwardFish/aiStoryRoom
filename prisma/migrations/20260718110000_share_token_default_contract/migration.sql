-- Align the live ShareToken defaults with the checked-in Prisma contract.
-- Existing rows are unchanged; these defaults only affect future inserts.
ALTER TABLE "ShareToken"
  ALTER COLUMN "scene" SET DEFAULT 'result',
  ALTER COLUMN "channel" SET DEFAULT 'LINK',
  ALTER COLUMN "updatedAt" DROP DEFAULT;
