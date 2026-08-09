# B0 Stage 13 Verification Trigger

- productParentSha: `a461ac7941653f6048a487889670c86ae2f8b9f4`
- purpose: run every exact-SHA engineering gate and both acceptance tiers after aligning independent-worker acceptance with AI-filled role ActionContract preparation
- engineeringDatabase: official self-hosted `supabase/postgres` in a random isolated schema
- engineeringClassification: `PASS_ENGINEERING_ONLY`; never formal C8
- formalC8Database: real managed non-production Supabase in a random isolated schema
- formalC8Provider: real DeepSeek API
- productionDataAccess: forbidden
- skipCi: false
