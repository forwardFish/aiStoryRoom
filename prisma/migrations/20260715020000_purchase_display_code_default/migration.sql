-- Keep the schema backward compatible during Railway rolling deployments.
-- An older API instance does not know about orderDisplayCode and therefore
-- omits the column from INSERT statements. The database must generate it until
-- every running instance is on the new application version.
ALTER TABLE "CreemPurchase"
ALTER COLUMN "orderDisplayCode"
SET DEFAULT ('MW-' || UPPER(LEFT(REPLACE(gen_random_uuid()::text, '-', ''), 12)));
