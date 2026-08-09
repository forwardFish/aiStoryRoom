# B0 Stage 9 Verification Trigger

- productParentSha: `203ee559ce9df17b82c8d282b134764072026edb`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after deriving ActionContract context from the synchronized B0 window
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
