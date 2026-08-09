# B0 Stage 10 Verification Trigger

- productParentSha: `149dc96eef7a827af9df6e082368907e1264a916`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after mounting synchronized B0 controls on historical `/game`
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
