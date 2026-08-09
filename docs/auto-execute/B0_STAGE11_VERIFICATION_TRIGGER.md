# B0 Stage 11 Verification Trigger

- productParentSha: `bd553540e320742a4fc7d8a415f9ea4e98dddd03`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after separating human-player and AI-fill settlement limits
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
