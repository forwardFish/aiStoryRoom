# B0 Stage 14 Narrative Dedupe Verification Trigger

- productParentSha: `7beac04750dd721e3ef51c63e4ecae9b057f7bbb`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after moving B0 narrative generation tasks into the durable `b0-narrative:*` dedupe namespace
- regression: `B0 narrative tasks use the durable b0 dedupe namespace for create and lookup`
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
