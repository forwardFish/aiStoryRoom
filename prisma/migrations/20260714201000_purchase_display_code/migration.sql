-- A short, user-facing receipt code that is safe to show before the provider
-- webhook arrives and stable across payment-status refreshes.
ALTER TABLE "CreemPurchase" ADD COLUMN "orderDisplayCode" TEXT;

UPDATE "CreemPurchase"
SET "orderDisplayCode" = 'MW-' || UPPER(RIGHT("id", 8))
WHERE "orderDisplayCode" IS NULL;

ALTER TABLE "CreemPurchase" ALTER COLUMN "orderDisplayCode" SET NOT NULL;
CREATE UNIQUE INDEX "CreemPurchase_orderDisplayCode_key" ON "CreemPurchase"("orderDisplayCode");
