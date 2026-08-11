# B0 Stage 14 Verification Trigger

- productParentSha: `8a674c156700cf4441f9731c02bd13c1df0cb643`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after teaching the standalone worker recovery loop to reconcile AI-filled role ActionContracts before deadline recovery
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
