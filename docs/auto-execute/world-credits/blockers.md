# World Credits Blockers

## B-WC-001 - Missing Creem Test credentials and external payment authority

Status: `RESOLVED`

Test API credentials, Webhook Signing Secret, Dashboard endpoint and public HTTPS access are configured and verified for both real payment flows.

The two documented Creem Test payment links are reachable with HTTP 200, but using them would not prove the required server-created dynamic Checkout or correlate a local `CreemPurchase` through metadata.

Impact: no environment blocker remains; only final Dashboard evidence and the final gate are outstanding before pure PASS.

Recovery: capture Dashboard evidence and rerun the final gate.

## B-WC-002 - Existing Prisma migration history drift

Status: `DOCUMENTED_BLOCKER`

The local database was previously created through schema push while the checked-in migration history does not reproduce the existing schema. `prisma migrate dev` requests a reset. This run used `db push` without reset to preserve user data. A clean migration-history reconciliation is still required before production deployment.
