# B0 Stage 8 Verification Trigger

- productParentSha: `72d2c4e5aaf5db50ffe526edd7403b1d73c72daa`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after active-window winner recovery
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
