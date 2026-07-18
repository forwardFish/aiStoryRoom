-- Align the database state-machine vocabulary with the concrete runtime
-- commands.  These remain strict allowlists; the change adds only values
-- emitted by the continuous engine and its leased worker.

ALTER TABLE "ActionWindow" DROP CONSTRAINT IF EXISTS "ActionWindow_closing_reason_check";
ALTER TABLE "ActionWindow" ADD CONSTRAINT "ActionWindow_closing_reason_check"
CHECK (
    "closingReason" IS NULL
    OR "closingReason" IN (
        'ALL_DONE',
        'ALL_LAYOUTS_DONE',
        'MAIN_TIMEOUT',
        'GRACE_TIMEOUT',
        'GRACE_DEADLINE',
        'ADMIN_FORCE'
    )
);

ALTER TABLE "InteractionRequest" DROP CONSTRAINT IF EXISTS "InteractionRequest_status_check";
ALTER TABLE "InteractionRequest" ADD CONSTRAINT "InteractionRequest_status_check"
CHECK ("status" IN ('OPEN', 'RESPONDED', 'DEFAULTED', 'EXPIRED', 'DOWNGRADED'));

ALTER TABLE "StoryEvent" DROP CONSTRAINT IF EXISTS "StoryEvent_audience_type_check";
ALTER TABLE "StoryEvent" ADD CONSTRAINT "StoryEvent_audience_type_check"
CHECK (
    "audienceType" IS NULL
    OR "audienceType" IN (
        'ALL_MEMBERS',
        'ROLE',
        'MEMBER',
        'PUBLIC',
        'OBSERVABLE',
        'LIMITED',
        'PRIVATE'
    )
);

ALTER TABLE "StoryTaskOutbox" DROP CONSTRAINT IF EXISTS "StoryTaskOutbox_outcome_check";
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_outcome_check"
CHECK (
    "outcome" IS NULL
    OR "outcome" IN (
        'SEALED_ACT',
        'SEALED_FALLBACK',
        'PASS',
        'STALE',
        'NO_OP',
        'RESOLVED',
        'REPAIRED',
        'COMPLETED'
    )
);

ALTER TABLE "StoryTaskOutbox" DROP CONSTRAINT IF EXISTS "StoryTaskOutbox_dedupe_format_check";
ALTER TABLE "StoryTaskOutbox" ADD CONSTRAINT "StoryTaskOutbox_dedupe_format_check"
CHECK (
    "dedupeKey" LIKE 'RESOLVE_LEGACY:%'
    OR "dedupeKey" LIKE 'RESOLVE:%'
    OR "dedupeKey" LIKE 'RESOLVE_WINDOW:%'
    OR "dedupeKey" LIKE 'PROJECT_REPAIR:%'
    OR "dedupeKey" LIKE 'AI_TAKEOVER:%'
    OR "dedupeKey" LIKE 'ROLE_AGENT:%'
);
