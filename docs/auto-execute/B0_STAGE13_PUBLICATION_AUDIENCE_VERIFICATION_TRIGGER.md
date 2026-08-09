# B0 Stage 13 Publication Audience Verification Trigger

- productParentSha: `13db56ff46546e7eb2d8f761b6f33ec55f8969bc`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after mapping structured result visibility to durable role-scoped StoryEvent audience routing
- regression: `B0 structured delivery persists recipient routing with the durable ROLE audience vocabulary`
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
