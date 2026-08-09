# B0 Stage 15 Verification Trigger

- productParentSha: `7a4ccc22297cde04f2c5370228a204d06e792bb3`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after making the independent-worker acceptance distinguish the two valid pre-worker crash boundaries without allowing world advancement
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
