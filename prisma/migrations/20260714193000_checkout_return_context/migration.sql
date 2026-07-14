-- Preserve the safe in-product destination that initiated a purchase.  This
-- lets the client resume a room unlock only after the payment webhook marks
-- the purchase as PAID.
ALTER TABLE "CreemPurchase" ADD COLUMN "checkoutContext" JSONB;
